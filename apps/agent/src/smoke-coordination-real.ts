import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startCoordination } from '@atoms/contracts/conversation-fixtures';
import { CoordinationExecutionSnapshot, CoordinationSourceEventPage } from '@atoms/contracts/conversation';
import { createAgentServer } from './runtime.js';
import { contextDigest } from './coordination-context.js';

if (process.env.ATOMS_ALLOW_REAL_COORDINATION_SMOKE !== '1') {
  throw new Error('Set ATOMS_ALLOW_REAL_COORDINATION_SMOKE=1 explicitly to authorize this bounded paid-model smoke. No fake fallback.');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
if (!process.env.DEEPSEEK_API_KEY) throw new Error('Configure DEEPSEEK_API_KEY locally before the real coordination smoke.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'atoms-real-coordination-'));
const serviceToken = 'coordination-smoke-internal-token';
const app = createAgentServer({ dataDir: directory, serviceToken, mode: 'fake', coordinationMode: 'dsh',
  apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL });
const origin = await app.listen();
const value = structuredClone(startCoordination);
value.content = process.env.ATOMS_COORDINATION_SMOKE_TEXT || '如何分享这个应用给别人？';
value.operation = { kind: 'message', input: { kind: 'text', content: value.content } };
value.mode = 'ask'; value.context.recentMessages = [];
value.context.hash = contextDigest(value.context);
const headers = { authorization: `Bearer ${serviceToken}`, 'x-atoms-coordination-version': '0.2.0', 'content-type': 'application/json' };
try {
  const accepted = await fetch(`${origin}/internal/v2/coordination-turns/${value.turnId}`, { method: 'PUT', headers, body: JSON.stringify(value) });
  if (!accepted.ok) throw new Error(`Coordination acceptance HTTP ${accepted.status}`);
  let cursor = 0;
  while (true) {
    const events = CoordinationSourceEventPage.parse(await (await fetch(`${origin}/internal/v2/coordination-turns/${value.turnId}/events?after=${cursor}&limit=100`, { headers })).json());
    for (const event of events.items) console.log(`${event.sourceSeq} ${event.event.type}`);
    cursor = events.nextCursor;
    const state = CoordinationExecutionSnapshot.parse(await (await fetch(`${origin}/internal/v2/coordination-turns/${value.turnId}`, { headers })).json());
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(state.status)) {
      console.log(JSON.stringify({ status: state.status, resultKind: state.result?.kind, usage: state.usage,
        workerRuns: app.runtime.records.size, evidenceDirectory: directory }));
      if (state.status !== 'completed' || app.runtime.records.size !== 0) process.exitCode = 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
} finally { await app.close(); }
