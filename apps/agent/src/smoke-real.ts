import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startExecution } from '@atoms/contracts/fixtures';
import { createAgentServer } from './runtime.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
if (!process.env.DEEPSEEK_API_KEY) throw new Error('Configure DEEPSEEK_API_KEY locally before smoke:real. No fake fallback is used.');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atoms-real-smoke-'));
const app = createAgentServer({ dataDir, serviceToken: 'real-smoke-internal-token', mode: 'dsh',
  apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL });
try {
  app.runtime.start({ ...startExecution, prompt: 'Create a compact interactive notes app with a React component in src/components/. Support adding a note, editing its text, and saving notes in localStorage. Use a calm light theme.',
    budget: { ...startExecution.budget, maxWallTimeMs: 300000, maxRepairRounds: 1 } }, startExecution.executionId);
  let cursor = 0;
  while (true) {
    const events = app.runtime.events(startExecution.executionId, cursor, 100);
    for (const event of events.items) {
      // Print only stable metadata; never model credential or raw SDK requests.
      console.log(`${event.sourceSeq} ${event.event.type}`);
      if (event.event.type === 'execution.failed') console.error(event.event.payload.message);
    }
    cursor = events.nextCursor;
    const state = app.runtime.get(startExecution.executionId).snapshot;
    if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state.status)) {
      console.log(JSON.stringify({ status: state.status, artifactId: state.artifactId, evidenceDirectory: dataDir }));
      if (state.status !== 'succeeded') process.exitCode = 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} finally { await app.close(); }
