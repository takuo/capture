import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';

export interface Bindings {
	CAPTURE_BUCKET: R2Bucket;
	R2_DOMAIN: string;
	CORS_ORIGINS?: string;
	API_TOKEN?: string;
}

export const MAX_SIZE = 20 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/avif': 'avif',
};

const CATEGORY_RE = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

const app = new Hono<{ Bindings: Bindings }>();

// CORS should be called before the route
app.use('*', (c, next) => {
	const origins = (c.env.CORS_ORIGINS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return cors({ origin: origins })(c, next);
});

// Authorization is required only for uploads; static files are public
app.use('*', (c, next) => {
	if (c.req.method !== 'POST' || !c.env.API_TOKEN) {
		return next();
	}
	return bearerAuth<{ Bindings: Bindings }>({ token: c.env.API_TOKEN })(c, next);
});

app.post('/*', async (c) => {
	const category = c.req.path.replace(/^\/+|\/+$/g, '');
	if (!CATEGORY_RE.test(category)) {
		return c.text('Invalid category', 400);
	}

	const body = await c.req.parseBody();
	const file = body['file'];
	if (!(file instanceof File)) {
		return c.text('No file uploaded', 400);
	}
	if (file.size > MAX_SIZE) {
		return c.text('File too large', 413);
	}
	const extension = ALLOWED_TYPES[file.type];
	if (!extension) {
		return c.text('Unsupported media type', 415);
	}

	const key = `${category}/${crypto.randomUUID()}.${extension}`;
	await c.env.CAPTURE_BUCKET.put(key, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type },
		customMetadata: {
			datetime: new Date().toISOString(),
			category,
		},
	});
	return c.text(`https://${c.env.R2_DOMAIN}/${key}`, 201);
});

app.get('/*', async (c) => {
	if (c.req.path === '/') {
		return c.text('Forbidden', 403);
	}

	const cacheKey = new Request(c.req.url);
	const cache = caches.default;
	const cached = await cache.match(cacheKey);
	if (cached) {
		return cached;
	}

	const object = await c.env.CAPTURE_BUCKET.get(`static${c.req.path}`);
	if (!object) {
		return c.text('Not Found', 404);
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('cache-control', 'public, max-age=86400');
	const response = new Response(object.body, { headers });
	c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
	return response;
});

export default app;
