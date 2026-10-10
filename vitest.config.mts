import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				// wrangler.json contains ${...} placeholders expanded at deploy time
				wrangler: { configPath: './test/wrangler.test.json' },
				// R2's sqlite -shm files break isolated storage snapshots
				isolatedStorage: false,
			},
		},
	},
});
