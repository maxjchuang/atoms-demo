import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentEventPage, ArtifactManifest, ExecutionSnapshot } from '@atoms/contracts';
import { startExecution } from '@atoms/contracts/fixtures';
import { createAgentServer } from '../src/runtime.js';
import { sha256 } from '../src/files.js';
import { verifyDshToolPolicy } from '../src/dsh-policy.js';

const token = 'test-runtime-service-token';
async function setup(t: { after: (callback: () => Promise<void>) => void }) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atoms-runtime-test-'));
  const app = createAgentServer({ dataDir, serviceToken: token, mode: 'fake' });
  const url = await app.listen();
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const call = (route: string, method = 'GET', body?: unknown) => fetch(url + '/internal/v1' + route, {
    method, headers: { authorization: `Bearer ${token}`, 'x-atoms-protocol-version': '0.1.0', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { app, call, dataDir, url };
}
async function wait(call: Awaited<ReturnType<typeof setup>>['call'], status: string | string[], id = startExecution.executionId) {
  const accepted = Array.isArray(status) ? status : [status];
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    const response = await call(`/executions/${id}`);
    const value = ExecutionSnapshot.parse(await response.json());
    if (accepted.includes(value.status)) return value;
    if (['failed', 'cancelled', 'interrupted'].includes(value.status) && !accepted.includes(value.status)) {
      const events = await (await call(`/executions/${id}/events`)).json();
      throw new Error(`Unexpected ${value.status}: ${JSON.stringify(events)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for execution');
}

test('internal authentication, protocol version and missing credential readiness', async (t) => {
  const { url, call } = await setup(t);
  assert.equal((await fetch(url + '/internal/v1/health')).status, 401);
  const health = await (await call('/health')).json();
  assert.equal(health.ready, true);
  const noKeyDir = await mkdtemp(path.join(os.tmpdir(), 'atoms-no-key-'));
  const noKey = createAgentServer({ dataDir: noKeyDir, serviceToken: token, mode: 'dsh' });
  const noKeyUrl = await noKey.listen();
  t.after(async () => { await noKey.close(); await rm(noKeyDir, { recursive: true, force: true }); });
  const response = await fetch(noKeyUrl + '/internal/v1/executions/' + startExecution.executionId, { method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'x-atoms-protocol-version': '0.1.0', 'content-type': 'application/json' }, body: JSON.stringify(startExecution) });
  assert.equal(response.status, 503);
});

test('installed DSH profile disables every model-facing tool before inference', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'atoms-dsh-policy-'));
  t.after(async () => { await rm(home, { recursive: true, force: true }); });
  const result = verifyDshToolPolicy(home, path.resolve('config/no-tools.yml'));
  assert.equal(result.verified, true);
  assert.equal(result.disabledModelTools.length, 4);
});

test('real React typecheck/build/browser smoke, immutable artifact and idempotent start', { timeout: 60000 }, async (t) => {
  const { call, app, dataDir } = await setup(t);
  assert.equal((await call(`/executions/${startExecution.executionId}`, 'PUT', startExecution)).status, 201);
  assert.equal((await call(`/executions/${startExecution.executionId}`, 'PUT', startExecution)).status, 200);
  assert.equal((await call(`/executions/${startExecution.executionId}`, 'PUT', { ...startExecution, prompt: 'different' })).status, 409);
  const done = await wait(call, 'succeeded');
  const events = AgentEventPage.parse(await (await call(`/executions/${done.id}/events`)).json());
  assert.deepEqual(events.items.map((event) => event.sourceSeq), events.items.map((_, index) => index + 1));
  assert.equal(events.items.filter((event) => event.event.type === 'execution.started').length, 1);
  const raw = Buffer.from(await (await call(`/executions/${done.id}/artifacts/${done.artifactId}/manifest`)).arrayBuffer());
  const manifest = ArtifactManifest.parse(JSON.parse(raw.toString()));
  const ready = events.items.find((event) => event.event.type === 'artifact.ready');
  assert.equal(ready?.event.type === 'artifact.ready' && ready.event.payload.manifestSha256, sha256(raw));
  assert.ok(manifest.files.some((file) => file.path === 'source/src/components/NoteCard.tsx'));
  assert.ok(manifest.files.some((file) => file.path === 'dist/index.html'));
  assert.equal(manifest.checks.find((check) => check.kind === 'behavior')?.status, 'not_run');
  for (const file of manifest.files) {
    const response = await call(`/executions/${done.id}/artifacts/${done.artifactId}/file?path=${encodeURIComponent(file.path)}`);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(bytes), file.sha256);
    assert.equal(bytes.length, file.bytes);
  }
  assert.equal((await call(`/executions/${done.id}/artifacts/${done.artifactId}/file?path=../executions.json`)).status, 404);
  const replay = createAgentServer({ dataDir, serviceToken: token, mode: 'fake' });
  assert.equal(replay.runtime.get(done.id).snapshot.status, 'succeeded');
  await replay.close();
  assert.equal(app.runtime.get(done.id).snapshot.status, 'succeeded');
});

test('plan attention, stale answer rejection, durable resume and single started event', { timeout: 60000 }, async (t) => {
  const { call } = await setup(t);
  const request = { ...startExecution, mode: 'plan' };
  await call(`/executions/${request.executionId}`, 'PUT', request);
  const waiting = await wait(call, 'waiting_input');
  assert.ok(waiting.pendingAttention?.plan);
  const answer = { commandId: 'command_plan', attentionId: waiting.pendingAttention!.id,
    expectedRevision: 1, answer: { kind: 'approve_plan' } };
  assert.equal((await call(`/executions/${request.executionId}/inputs`, 'POST', { ...answer, expectedRevision: 99 })).status, 409);
  assert.equal((await call(`/executions/${request.executionId}/inputs`, 'POST', answer)).status, 202);
  assert.equal((await call(`/executions/${request.executionId}/inputs`, 'POST', answer)).status, 202);
  await wait(call, 'succeeded');
  const events = AgentEventPage.parse(await (await call(`/executions/${request.executionId}/events`)).json());
  assert.equal(events.items.filter((event) => event.event.type === 'execution.started').length, 1);
});

test('cancellation waits for the running fixture to stop and replay remains ordered', { timeout: 10000 }, async (t) => {
  const { call } = await setup(t);
  await call(`/executions/${startExecution.executionId}`, 'PUT', { ...startExecution, prompt: '[slow] build a notes app' });
  await wait(call, 'running');
  assert.equal((await call(`/executions/${startExecution.executionId}/cancel`, 'POST', { commandId: 'command_cancel' })).status, 202);
  const done = await wait(call, 'cancelled');
  const events = AgentEventPage.parse(await (await call(`/executions/${done.id}/events?after=0&limit=2`)).json());
  assert.equal(events.items.length, 2); assert.equal(events.hasMore, true); assert.equal(events.nextCursor, 2);
  const rest = AgentEventPage.parse(await (await call(`/executions/${done.id}/events?after=2&limit=100`)).json());
  assert.ok(!rest.items.some((event) => event.event.type === 'artifact.ready'));
  assert.equal(rest.items.at(-1)?.event.type, 'execution.cancelled');
});

test('actual type errors feed a bounded repair loop', { timeout: 60000 }, async (t) => {
  const { call } = await setup(t);
  await call(`/executions/${startExecution.executionId}`, 'PUT', { ...startExecution, prompt: '[repair] 生成便签墙' });
  const done = await wait(call, 'succeeded');
  const events = AgentEventPage.parse(await (await call(`/executions/${done.id}/events`)).json());
  assert.ok(events.items.some((event) => event.event.type === 'check.completed' && event.event.payload.status === 'failed'));
  assert.ok(events.items.some((event) => event.event.type === 'phase.changed' && event.event.payload.phase === 'repairing'));
});
