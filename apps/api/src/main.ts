import { createApi } from './server.js';
import { configFromEnvironment } from './config.js';
const config = configFromEnvironment();
const service = await createApi(config);
await service.app.listen({ port: config.port, host: config.host });
await service.preview.listen({ port: config.previewPort, host: config.host });
console.log(`API listening on http://localhost:${config.port}; preview on ${config.previewOrigin}`);
const stop = async () => { await service.close(); process.exit(0); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
