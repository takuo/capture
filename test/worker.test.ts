import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { detectImageType } from '../src/worker';

const AUTH = { Authorization: 'Bearer test-token' };

function upload(path: string, file?: File | string, headers: Record<string, string> = AUTH) {
	const form = new FormData();
	if (file !== undefined) {
		form.append('file', file);
	}
	return exports.default.fetch(`https://capture.example.com${path}`, { method: 'POST', body: form, headers });
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];

function bytes(...parts: (string | number[])[]) {
	return new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (ch) => ch.charCodeAt(0)) : p)));
}

function png(type = 'image/png') {
	return new File([bytes(PNG, [0, 0, 0, 0])], 'image.png', { type });
}

describe('POST /*', () => {
	it('requires a bearer token', async () => {
		const res = await upload('/tmp', png(), {});
		expect(res.status).toBe(401);
	});

	it('stores the file with content type and metadata', async () => {
		const res = await upload('/temporary/foo/', png());
		expect(res.status).toBe(201);

		const url = await res.text();
		expect(url).toMatch(/^https:\/\/r2\.example\.com\/temporary\/foo\/[0-9a-f-]{36}\.png$/);

		const key = new URL(url).pathname.slice(1);
		const object = await env.CAPTURE_BUCKET.get(key);
		expect(object?.httpMetadata?.contentType).toBe('image/png');
		expect(object?.customMetadata?.category).toBe('temporary/foo');
	});

	it('detects the type from magic bytes regardless of declared type and name', async () => {
		const res = await upload('/tmp', new File([bytes(JPEG)], 'noext', { type: 'application/octet-stream' }));
		expect(res.status).toBe(201);
		const key = new URL(await res.text()).pathname.slice(1);
		expect(key).toMatch(/\.jpg$/);
		const object = await env.CAPTURE_BUCKET.head(key);
		expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
	});

	it('rejects content that is not an image even if declared as one', async () => {
		const file = new File(['<script></script>'], 'x.png', { type: 'image/png' });
		expect((await upload('/tmp', file)).status).toBe(415);
	});

	it('rejects a missing or non-file field', async () => {
		expect((await upload('/tmp')).status).toBe(400);
		expect((await upload('/tmp', 'not a file')).status).toBe(400);
	});

	it('rejects unsupported media types', async () => {
		const file = new File(['<script></script>'], 'x.html', { type: 'text/html' });
		expect((await upload('/tmp', file)).status).toBe(415);
	});

	it('rejects invalid categories', async () => {
		expect((await upload('/', png())).status).toBe(400);
		expect((await upload('/a%20b', png())).status).toBe(400);
		expect((await upload('/a//b', png())).status).toBe(400);
	});
});

describe('detectImageType', () => {
	it.each([
		['png', bytes(PNG)],
		['jpg', bytes(JPEG)],
		['gif', bytes('GIF89a')],
		['gif', bytes('GIF87a')],
		['webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')],
		['avif', bytes([0, 0, 0, 0x14], 'ftypavif', [0, 0, 0, 0], 'mif1')],
		['avif', bytes([0, 0, 0, 0x18], 'ftypmif1', [0, 0, 0, 0], 'mif1avif')],
	])('detects %s', (extension, data) => {
		expect(detectImageType(data)?.extension).toBe(extension);
	});

	it.each([
		['empty', bytes()],
		['truncated png', bytes(PNG.slice(0, 4))],
		['heic', bytes([0, 0, 0, 0x14], 'ftypheic', [0, 0, 0, 0], 'mif1')],
		['svg', bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
	])('rejects %s', (_, data) => {
		expect(detectImageType(data)).toBeUndefined();
	});
});

describe('GET /*', () => {
	it('serves static files without authorization', async () => {
		await env.CAPTURE_BUCKET.put('static/logo.png', new Uint8Array([1, 2, 3]), {
			httpMetadata: { contentType: 'image/png' },
		});
		const res = await exports.default.fetch('https://capture.example.com/logo.png');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.headers.get('etag')).toBeTruthy();
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
	});

	it('returns 404 for missing files', async () => {
		const res = await exports.default.fetch('https://capture.example.com/missing.png');
		expect(res.status).toBe(404);
	});

	it('returns 403 for the root', async () => {
		const res = await exports.default.fetch('https://capture.example.com/');
		expect(res.status).toBe(403);
	});
});

describe('CORS', () => {
	it('allows configured origins', async () => {
		const res = await exports.default.fetch('https://capture.example.com/', {
			method: 'OPTIONS',
			headers: { Origin: 'https://other.example.com', 'Access-Control-Request-Method': 'POST' },
		});
		expect(res.headers.get('access-control-allow-origin')).toBe('https://other.example.com');
	});
});
