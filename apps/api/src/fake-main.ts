import { createFakeRuntime } from './fake-runtime.js';
if (process.env.NODE_ENV === 'production') throw new Error('Fake Runtime is not permitted in production');
const token = process.env.ATOMS_SERVICE_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN;
if (!token) throw new Error('ATOMS_SERVICE_TOKEN required');
const fake = createFakeRuntime(token);
await fake.app.listen({ host: '127.0.0.1', port: Number(process.env.AGENT_PORT ?? 4100) });
console.log('Explicit Fake Runtime listening on 4100 — synthetic HTTP fixtures, no model or compiler invoked.');
