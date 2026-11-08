import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const demo = process.argv.includes('--demo');
if (!demo && !process.env.DEEPSEEK_API_KEY) {
  console.error('Missing DEEPSEEK_API_KEY. Configure .env for real DSH, or explicitly use pnpm dev:demo for Fake DSH.');
  process.exit(1);
}
const dataRoot = path.resolve(root, process.env.ATOMS_DATA_ROOT || 'data');
const secretsPath = path.join(dataRoot, 'local-secrets.json');
mkdirSync(path.dirname(secretsPath), { recursive: true });
let localSecrets;
try { localSecrets = JSON.parse(readFileSync(secretsPath, 'utf8')); } catch {
  localSecrets = { serviceToken: randomBytes(32).toString('hex'), previewSecret: randomBytes(32).toString('hex') };
  writeFileSync(secretsPath, JSON.stringify(localSecrets), { mode: 0o600, flag: 'wx' });
}
const apiPort = process.env.API_PORT || '3001';
const previewPort = process.env.PREVIEW_PORT || '3002';
const agentPort = process.env.AGENT_PORT || '4100';
const env = {
  ...process.env,
  ATOMS_SERVICE_TOKEN: process.env.ATOMS_SERVICE_TOKEN || localSecrets.serviceToken,
  API_PORT: apiPort,
  PREVIEW_PORT: previewPort,
  AGENT_PORT: agentPort,
  ATOMS_ENABLE_DEMO: process.env.ATOMS_ENABLE_DEMO || 'true',
  ATOMS_DEMO_CODE: process.env.ATOMS_DEMO_CODE || 'atoms-demo-2026',
  ATOMS_ALLOWED_ORIGINS: 'http://localhost:5173',
  AGENT_URL: `http://127.0.0.1:${agentPort}`,
  API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
  PREVIEW_PUBLIC_URL: `http://127.0.0.1:${previewPort}`,
  VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
  ATOMS_AGENT_MODE: demo ? 'fake' : 'dsh',
  AGENT_MODE: demo ? 'fake' : 'dsh',
  VITE_RUNTIME_MODE: demo ? 'fake' : 'dsh',
  API_ENABLE_DEMO_SEED: '1',
  API_DEMO_CODE: process.env.ATOMS_DEMO_CODE || 'atoms-demo-2026',
  API_DATA_DIR: process.env.API_DATA_DIR || path.join(dataRoot, 'api'),
  AGENT_DATA_DIR: process.env.AGENT_DATA_DIR || path.join(dataRoot, 'agent'),
  ALLOWED_ORIGINS: 'http://localhost:5173',
  PREVIEW_ORIGIN: `http://127.0.0.1:${previewPort}`,
};
env.INTERNAL_SERVICE_TOKEN = env.ATOMS_SERVICE_TOKEN;
env.PREVIEW_SECRET = process.env.PREVIEW_SECRET || localSecrets.previewSecret;
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
  setTimeout(() => {
    for (const child of children) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already stopped */ }
    }
    process.exit(code);
  }, 1200);
}
for (const name of ['@atoms/agent', '@atoms/api', '@atoms/web']) {
  const childEnv = { ...env };
  if (name !== '@atoms/agent') delete childEnv.DEEPSEEK_API_KEY;
  if (name === '@atoms/web') {
    delete childEnv.ATOMS_SERVICE_TOKEN;
    delete childEnv.INTERNAL_SERVICE_TOKEN;
    delete childEnv.PREVIEW_SECRET;
  }
  const child = spawn('pnpm', ['--filter', name, name === '@atoms/web' ? 'dev' : 'start'], {
    cwd: root, env: childEnv, stdio: 'inherit', detached: true,
  });
  children.push(child);
  child.on('error', (error) => { console.error(`${name}: ${error.message}`); stop(1); });
  child.on('exit', (code, signal) => {
    if (!stopping) { console.error(`${name} stopped (${code ?? signal})`); stop(code || 1); }
  });
}
console.log(`\n${demo ? 'DEMO MODE: deterministic Fake DSH; no model inference' : 'REAL MODE: DSH + DeepSeek API'}`);
console.log('Workspace: http://localhost:5173');
console.log('Preview uses a different host (127.0.0.1) to avoid sharing workspace cookies.');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
