import type { Bindings } from '../src/worker';

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Bindings {}
}
