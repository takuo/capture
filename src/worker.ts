import { Hono } from 'hono';

export interface Env {
	CAPTURE_BUCKET: R2Bucket;
	CAPTURE_KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

async function sha1(data: ArrayBuffer): Promise<string> {
	const hash = await crypto.subtle.digest('SHA-1', data);
	return Array.from(new Uint8Array(hash))
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
}

function getExtension(filename: string): string {
	const ext = filename.split('.').pop();
	return ext ? `.${ext}` : '.png';
}

app.all('/', async (c) => {  return c.text('Forbidden', 403) });

app.post('/*', async (c) => {
	const url = new URL(c.req.url);
	const category = url.pathname.replace(/^\/|\/$/g, '');
	const body = await c.req.parseBody();
	const file = body['file'] as File;

	if (!file) {
		return c.text('No file uploaded', 400);
	}
	const buffer = await file.arrayBuffer();

	const today = new Date();
	const timestamp = today.getTime().toString();
	const combinedBuffer = new Uint8Array([
		...new Uint8Array(buffer),
		...new TextEncoder().encode(timestamp)
	]);

	const hash = await sha1(combinedBuffer);
	const extension = getExtension(file.name);
	const key = `${hash}${extension}`;

	if (category == "static") {
		const filename = `static/${key}`;
		await c.env.CAPTURE_BUCKET.put(filename, buffer);
		return c.text(`${url.origin}/${hash}`);
	}

	const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: 'Asia/Tokyo'
	});
	const capValue = { timestamp: timestamp, date: dateTimeFormat.format(today), category: category, extension: extension };
	const fileName = (category != "" ? category + "/" : category) + `${capValue.date}/${key}`;

	await c.env.CAPTURE_BUCKET.put(fileName, buffer);
	c.executionCtx.waitUntil(c.env.CAPTURE_KV.put(hash, JSON.stringify(capValue), { expirationTtl: 60 * 60 * 24 * 365 }));
	return c.text(`${url.origin}/${hash}`);
});

app.get('/*', async (c) => {
	const url = new URL(c.req.url);
	const cacheKey = new Request(url.toString(), c.req.raw);
	const cache = caches.default;
	let response = await cache.match(cacheKey);
	if (response) {
		return response;
	}

	const staticFile = await c.env.CAPTURE_BUCKET.get(`static${url.pathname}`);
	if (staticFile) {
		response = new Response(staticFile.body, { headers: { 'Content-Type': staticFile.httpMetadata?.contentType || 'image/png' } });
		c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
		return response;
	}

	const key = url.pathname.substring(1).replace(/\.*$/g, '');
	if (key == "") {
		return c.text('Forbidden', 403);
	}
	const value = await c.env.CAPTURE_KV.get(key);
	if (!value) {
		return c.text('Key not found', 404);
	}
	const capValue = JSON.parse(value);
	const fileName = (capValue.category != "" ? capValue.category + "/" : "") + `${capValue.date}/${key}${capValue.extension}`;
	const object = await c.env.CAPTURE_BUCKET.get(fileName);
	if (!object) {
		return c.text('Image not found', 404);
	}
	response = new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'image/png' } });
	c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
	return response;
});

export default app;
