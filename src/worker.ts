import { FormData, File, R2Bucket, Request } from '@cloudflare/workers-types';

export interface Env {
	CAPTURE_BUCKET: R2Bucket;
	CAPTURE_KV: KVNamespace;
}

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


async function handlePost(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const category = url.pathname.replace(/^\/|\/$/g, '');
	const formData = await request.formData();
	const file = formData.get('file') as unknown as File;

	if (!file) {
		return new Response('No file uploaded', { status: 400 });
	}
	const buffer = await file.arrayBuffer();

	const today = new Date()
	const timestamp = today.getTime().toString();
	const combinedBuffer = new Uint8Array([
		...new Uint8Array(buffer),
		...new TextEncoder().encode(timestamp)
	]);

	const hash = await sha1(combinedBuffer);
	const extension = getExtension(file.name);
	const key = `${hash}${extension}`;

	if (category == "static") { // for special files
		const filename = `static/${key}`;
		await env.CAPTURE_BUCKET.put(filename, buffer);
		return new Response(`${url.origin}/${hash}`);
	}

	const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: 'Asia/Tokyo'
	});
	const capValue = { timestamp: timestamp, date: dateTimeFormat.format(today), category: category, extension: extension };
	const fileName = (category != "" ? category + "/" : category) + `${capValue.date}/${key}`;

	await env.CAPTURE_BUCKET.put(fileName, buffer);
	await env.CAPTURE_KV.put(hash, JSON.stringify(capValue), { expirationTtl: 60 * 60 * 24 * 365 });

	return new Response(`${url.origin}/${hash}`);
}

async function handleGet(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);

	// try static file first
	const staticFile = await env.CAPTURE_BUCKET.get(`static${url.pathname}`);
	if (staticFile) {	
		return new Response(staticFile.body, { headers: { 'Content-Type': staticFile.httpMetadata?.contentType || 'image/png' } });
	}

	// find key from KV
	const key = url.pathname.substring(1).replace(/\.*$/g, ''); // trim '^/', '.ext$'
	if (key == "") {
		return new Response('Forbidden', { status: 403 });
	}
	const value = await env.CAPTURE_KV.get(key); 
	if (!value) {
		return new Response('Key not found', { status: 404 });
	}
	const capValue = JSON.parse(value);
	const fileName = (capValue.category != "" ? capValue.category + "/" : "") + `${capValue.date}/${key}${capValue.extension}`;
	const object = await env.CAPTURE_BUCKET.get(fileName);
	if (!object) {
		return new Response('Image not found', { status: 404 });
	}
	return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'image/png' } });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'POST') {
			return handlePost(request, env);
		}
		if (request.method === 'GET') {
			return handleGet(request, env);
		}
		return new Response('Method not allowed', { status: 405 });
	}
};
