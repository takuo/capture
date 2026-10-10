import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const AUTH = { Authorization: 'Bearer test-token' };

function upload(path: string, file?: File | string, headers: Record<string, string> = AUTH) {
	const form = new FormData();
	if (file !== undefined) {
		form.append('file', file);
	}
	return SELF.fetch(`https://capture.example.com${path}`, { method: 'POST', body: form, headers });
}

function png(size = 8) {
	return new File([new Uint8Array(size)], 'image.png', { type: 'image/png' });
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

	it('derives the extension from the content type', async () => {
		const file = new File([new Uint8Array(8)], 'noext', { type: 'image/jpeg' });
		const res = await upload('/tmp', file);
		expect(await res.text()).toMatch(/\.jpg$/);
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

describe('GET /*', () => {
	it('serves static files without authorization', async () => {
		await env.CAPTURE_BUCKET.put('static/logo.png', new Uint8Array([1, 2, 3]), {
			httpMetadata: { contentType: 'image/png' },
		});
		const res = await SELF.fetch('https://capture.example.com/logo.png');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.headers.get('etag')).toBeTruthy();
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
	});

	it('returns 404 for missing files', async () => {
		const res = await SELF.fetch('https://capture.example.com/missing.png');
		expect(res.status).toBe(404);
	});

	it('returns 403 for the root', async () => {
		const res = await SELF.fetch('https://capture.example.com/');
		expect(res.status).toBe(403);
	});
});

describe('CORS', () => {
	it('allows configured origins', async () => {
		const res = await SELF.fetch('https://capture.example.com/', {
			method: 'OPTIONS',
			headers: { Origin: 'https://other.example.com', 'Access-Control-Request-Method': 'POST' },
		});
		expect(res.headers.get('access-control-allow-origin')).toBe('https://other.example.com');
	});
});
