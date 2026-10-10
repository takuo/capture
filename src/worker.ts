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

interface ImageType {
	contentType: string;
	extension: string;
}

function startsWith(bytes: Uint8Array, signature: string | number[], offset = 0): boolean {
	const sig = typeof signature === 'string' ? Array.from(signature, (ch) => ch.charCodeAt(0)) : signature;
	return bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);
}

// Detect the image type from magic bytes; the client-declared MIME type is not trusted
export function detectImageType(bytes: Uint8Array): ImageType | undefined {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return { contentType: 'image/png', extension: 'png' };
	}
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
		return { contentType: 'image/jpeg', extension: 'jpg' };
	}
	if (startsWith(bytes, 'GIF87a') || startsWith(bytes, 'GIF89a')) {
		return { contentType: 'image/gif', extension: 'gif' };
	}
	if (startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8)) {
		return { contentType: 'image/webp', extension: 'webp' };
	}
	// ISO BMFF: [box size][ftyp][major brand][minor version][compatible brands...]
	if (startsWith(bytes, 'ftyp', 4)) {
		const boxSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
		const end = Math.min(boxSize, bytes.length);
		for (let offset = 8; offset + 4 <= end; offset += offset === 8 ? 8 : 4) {
			if (startsWith(bytes, 'avif', offset) || startsWith(bytes, 'avis', offset)) {
				return { contentType: 'image/avif', extension: 'avif' };
			}
		}
	}
	return undefined;
}

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
	const buffer = await file.arrayBuffer();
	const type = detectImageType(new Uint8Array(buffer));
	if (!type) {
		return c.text('Unsupported media type', 415);
	}

	const key = `${category}/${crypto.randomUUID()}.${type.extension}`;
	await c.env.CAPTURE_BUCKET.put(key, buffer, {
		httpMetadata: { contentType: type.contentType },
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
