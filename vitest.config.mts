import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			// wrangler.json contains ${...} placeholders expanded at deploy time
			wrangler: { configPath: './test/wrangler.test.json' },
		}),
	],
});
