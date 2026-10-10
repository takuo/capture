import type { Bindings } from '../src/worker';

declare global {
	namespace Cloudflare {
		interface Env extends Bindings {}
		interface GlobalProps {
			mainModule: typeof import('../src/worker');
		}
	}
}
