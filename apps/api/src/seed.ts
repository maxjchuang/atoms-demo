import { createApi } from './server.js';
import { configFromEnvironment } from './config.js';
const config = configFromEnvironment();
if (!config.demoCode) throw new Error('Explicitly enable ATOMS_ENABLE_DEMO=true before seeding');
const service = await createApi({ ...config, autoSchedule: false });
console.log('Development access code provisioned. Use the configured ATOMS_DEMO_CODE.');
await service.close();
