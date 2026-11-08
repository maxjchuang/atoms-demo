import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAgentServer } from './runtime.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const mode = process.env.AGENT_MODE;
const coordinationMode = process.env.COORDINATOR_MODE;
if (mode !== undefined && mode !== 'fake' && mode !== 'dsh') throw new Error('AGENT_MODE must be fake or dsh');
if (coordinationMode !== undefined && coordinationMode !== 'fake' && coordinationMode !== 'dsh') throw new Error('COORDINATOR_MODE must be fake or dsh');
if (!process.env.ATOMS_SERVICE_TOKEN || process.env.ATOMS_SERVICE_TOKEN.length < 16) throw new Error('ATOMS_SERVICE_TOKEN must contain at least 16 characters');
const app = createAgentServer({ dataDir: path.resolve(process.env.AGENT_DATA_DIR || path.join(root, 'data/agent')),
  serviceToken: process.env.ATOMS_SERVICE_TOKEN, apiInternalUrl: process.env.API_INTERNAL_URL || 'http://127.0.0.1:3001',
  allowControlledRegression: process.env.ATOMS_TEST_CONTROLLED_REGRESSION === '1' && mode === 'fake',
  mode: mode || 'dsh', coordinationMode, apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL });
console.log(`Agent runtime (${mode || 'dsh'}) listening on ${await app.listen(Number(process.env.AGENT_PORT || 4100), process.env.AGENT_HOST || '127.0.0.1')}`);
const shutdown = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
