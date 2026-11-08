import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAgentServer } from './runtime.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const secret = (name: string) => process.env[name + '_FILE'] ? readFileSync(process.env[name + '_FILE']!, 'utf8').trim() : process.env[name];
const mode = process.env.AGENT_MODE;
const executionBackend = process.env.AGENT_EXECUTION_BACKEND || 'host_local';
if (!['host_local','docker_linux'].includes(executionBackend)) throw new Error('Invalid execution backend');
const serviceToken = secret('ATOMS_SERVICE_TOKEN');
const coordinationMode = process.env.COORDINATOR_MODE;
if (mode !== undefined && mode !== 'fake' && mode !== 'dsh') throw new Error('AGENT_MODE must be fake or dsh');
if (coordinationMode !== undefined && coordinationMode !== 'fake' && coordinationMode !== 'dsh') throw new Error('COORDINATOR_MODE must be fake or dsh');
if (!serviceToken || serviceToken.length < 16) throw new Error('ATOMS_SERVICE_TOKEN must contain at least 16 characters');
const app = createAgentServer({ dataDir: path.resolve(process.env.AGENT_DATA_DIR || path.join(root, 'data/agent')),
  serviceToken, executionBackend: executionBackend as 'host_local'|'docker_linux', brokerUrl: process.env.BROKER_URL, brokerToken: executionBackend === 'docker_linux' ? secret('AGENT_BROKER_TOKEN') : undefined, apiInternalUrl: process.env.API_INTERNAL_URL || 'http://127.0.0.1:3001',
  allowControlledRegression: process.env.ATOMS_TEST_CONTROLLED_REGRESSION === '1' && mode === 'fake',
  mode: mode || 'dsh', coordinationMode, apiKey: mode === 'fake' ? undefined : secret('DEEPSEEK_API_KEY'), model: process.env.DEEPSEEK_MODEL });
console.log(`Agent runtime (${mode || 'dsh'}) listening on ${await app.listen(Number(process.env.AGENT_PORT || 4100), process.env.AGENT_HOST || '127.0.0.1')}`);
const shutdown = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
