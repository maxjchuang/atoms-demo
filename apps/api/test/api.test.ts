import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceSnapshot, ProjectEventPage, Session, Run, VersionList, FileList, EvidenceList } from '@atoms/contracts';
import { createApi } from '../src/server.js';
import { createFakeRuntime } from '../src/fake-runtime.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'atoms-api-test-'));
  const fake = createFakeRuntime('test-service-token');
  const address = await fake.app.listen({ host: '127.0.0.1', port: 0 });
  let service = await createApi({ dataDir: directory, agentUrl: address, serviceToken: 'test-service-token', previewSecret: 'test-preview-signing-secret',
    previewOrigin: 'http://127.0.0.1:3002', demoCode: 'test-demo-2026', autoSchedule: false, allowedOrigins: ['http://localhost:5173'] });
  let cookie = '';
  const request = async (method: 'GET'|'POST'|'DELETE', path: string, body?: unknown, key = randomUUID()) => {
    const response = await service.app.inject({ method, url: `/api/v1${path}`, headers: {
      ...(cookie ? { cookie } : {}), origin: 'http://localhost:5173', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(method !== 'GET' ? { 'idempotency-key': key } : {}),
    }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
    return { status: response.statusCode, data: response.body ? response.json() : null, headers: response.headers };
  };
  const login = async (code = 'test-demo-2026') => {
    const response = await request('POST', '/sessions', { code }); assert.equal(response.status, 201); Session.parse(response.data);
    cookie = String(response.headers['set-cookie']).split(';')[0]; return response;
  };
  const project = async () => (await request('POST', '/projects', { title: '便签墙' })).data;
  return { fake, request, login, project, get service() { return service; },
    async restart() { await service.close(); service = await createApi({ dataDir: directory, agentUrl: address, serviceToken: 'test-service-token', previewSecret: 'test-preview-signing-secret', previewOrigin: 'http://127.0.0.1:3002', autoSchedule: false, allowedOrigins: ['http://localhost:5173'] }); },
    async close() { await service.close(); await fake.app.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('HTTP loop: identity, idempotent run, artifact publication, preview, files, events, restore and restart', async () => {
  const f = await fixture();
  try {
    await f.login(); const project = await f.project(); const key = randomUUID();
    const first = await f.request('POST', `/projects/${project.id}/runs`, { prompt: '便签墙', mode: 'build' }, key);
    const duplicate = await f.request('POST', `/projects/${project.id}/runs`, { prompt: '便签墙', mode: 'build' }, key);
    assert.equal(first.data.run.id, duplicate.data.run.id);
    assert.equal((await f.request('POST', `/projects/${project.id}/runs`, { prompt: 'different', mode: 'build' }, key)).status, 409);
    await f.service.tick();
    const completed = Run.parse((await f.request('GET', `/runs/${first.data.run.id}`)).data);
    assert.equal(completed.status, 'succeeded'); assert.equal(f.fake.startCalls, 1);
    let workspace = WorkspaceSnapshot.parse((await f.request('GET', `/projects/${project.id}/workspace`)).data);
    assert.equal(workspace.latestRun?.status, 'succeeded'); assert.equal(workspace.currentVersion?.id, completed.resultVersionId);
    const versionId = workspace.currentVersion!.id;
    const previewPath = new URL(workspace.currentVersion!.previewUrl).pathname;
    const preview = await f.service.preview.inject(previewPath);
    assert.equal(preview.statusCode, 200); assert.match(preview.body, /Fake Runtime fixture/);
    assert.equal((await f.service.preview.inject('/api/v1/session')).statusCode, 404);
    assert.equal((await f.service.preview.inject('/p/invalid/index.html')).statusCode, 403);
    assert.ok(FileList.parse((await f.request('GET', `/versions/${versionId}/files`)).data).files.length >= 2);
    assert.equal(EvidenceList.parse((await f.request('GET', `/versions/${versionId}/evidence`)).data).items.length, 3);
    assert.equal((await f.request('GET', `/versions/${versionId}/file?path=../secret`)).status, 404);
    const session = Session.parse((await f.request('GET', '/session')).data); assert.equal(session.quota.runsUsed, 1); assert.equal(session.quota.runsReserved, 0);
    let after = 0; let count = 0;
    while (true) {
      const page = ProjectEventPage.parse((await f.request('GET', `/projects/${project.id}/events?after=${after}&limit=2`)).data);
      for (const item of page.items) { assert.equal(item.seq, ++after); count++; }
      assert.equal(page.nextCursor, after); if (!page.hasMore) break;
    }
    assert.ok(count > 5);
    const restored = await f.request('POST', `/projects/${project.id}/restore`, { versionId, expectedProjectRevision: workspace.project.revision });
    assert.equal(restored.status, 201); assert.notEqual(restored.data.version.id, versionId);
    assert.equal(restored.data.version.restoredFromVersionId, versionId);
    const second = await f.request('POST', `/projects/${project.id}/runs`, { prompt: '增加搜索', mode: 'build' });
    await f.service.tick();
    assert.equal((await f.request('GET', `/runs/${second.data.run.id}`)).data.baseVersionId, restored.data.version.id);
    assert.equal(VersionList.parse((await f.request('GET', `/projects/${project.id}/versions`)).data).items.length, 3);
    await f.restart();
    workspace = WorkspaceSnapshot.parse((await f.request('GET', `/projects/${project.id}/workspace`)).data);
    assert.equal(workspace.latestRun?.status, 'succeeded'); assert.equal(workspace.messages.length, 2);
  } finally { await f.close(); }
});

test('plan answers are durable, stale-safe and do not double-charge execution', async () => {
  const f = await fixture();
  try {
    await f.login(); const project = await f.project();
    const created = await f.request('POST', `/projects/${project.id}/runs`, { prompt: '计划便签墙', mode: 'plan' });
    await f.service.tick(); const waiting = (await f.request('GET', `/runs/${created.data.run.id}`)).data;
    assert.equal(waiting.status, 'waiting_input');
    const body = { attentionId: waiting.pendingAttention.id, expectedRevision: 1, answer: { kind: 'approve_plan' } };
    assert.equal((await f.request('POST', `/runs/${waiting.id}/answers`, { ...body, expectedRevision: 2 })).status, 409);
    const key = randomUUID(); const answer = await f.request('POST', `/runs/${waiting.id}/answers`, body, key);
    assert.equal(answer.data.run.pendingAnswer.status, 'pending');
    assert.equal((await f.request('POST', `/runs/${waiting.id}/answers`, body, key)).status, 202);
    await f.service.tick(); assert.equal((await f.request('GET', `/runs/${waiting.id}`)).data.status, 'succeeded');
    assert.equal((await f.request('GET', '/session')).data.quota.runsUsed, 1);
  } finally { await f.close(); }
});

test('response loss retries the same execution; corrupted artifacts do not replace a success', async () => {
  const f = await fixture();
  try {
    await f.login(); const project = await f.project(); f.fake.loseNextStartResponse();
    const created = await f.request('POST', `/projects/${project.id}/runs`, { prompt: '生成', mode: 'build' });
    await f.service.tick(); await f.service.tick();
    assert.equal(f.fake.startCalls, 1); assert.equal((await f.request('GET', `/runs/${created.data.run.id}`)).data.status, 'succeeded');
    const previous = (await f.request('GET', `/projects/${project.id}/workspace`)).data.currentVersion.id;
    f.fake.setCorruptArtifact(true);
    const second = await f.request('POST', `/projects/${project.id}/runs`, { prompt: '修改', mode: 'build' });
    await f.service.tick();
    assert.equal((await f.request('GET', `/runs/${second.data.run.id}`)).data.status, 'failed');
    assert.equal((await f.request('GET', `/projects/${project.id}/workspace`)).data.currentVersion.id, previous);
  } finally { await f.close(); }
});

test('cancel is confirmed by Runtime, same-project tasks serialize, and foreign visitors cannot access resources', async () => {
  const f = await fixture();
  try {
    await f.login(); const project = await f.project();
    const held = (await f.request('POST', `/projects/${project.id}/runs`, { prompt: '[hold]', mode: 'build' })).data.run;
    const queued = (await f.request('POST', `/projects/${project.id}/runs`, { prompt: 'next', mode: 'build' })).data.run;
    await f.service.tick(); assert.equal(f.fake.startCalls, 1);
    assert.equal((await f.request('GET', `/runs/${queued.id}`)).data.executionId, null);
    const cancelled = await f.request('POST', `/runs/${held.id}/cancel`, {});
    assert.equal(cancelled.data.run.status, 'cancelling');
    await f.service.tick(); assert.equal((await f.request('GET', `/runs/${held.id}`)).data.status, 'cancelled');
    await f.service.tick(); assert.equal((await f.request('GET', `/runs/${queued.id}`)).data.status, 'succeeded');
    f.service.seedCode('another-demo-code'); await f.login('another-demo-code');
    assert.equal((await f.request('GET', `/runs/${held.id}`)).status, 404);
    assert.equal((await f.request('GET', `/projects/${project.id}/workspace`)).status, 404);
  } finally { await f.close(); }
});

test('quota, authentication, origin, idempotency and internal token are enforced', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('GET', '/session')).status, 401);
    assert.equal((await f.request('POST', '/sessions', { code: 'not-a-code' })).status, 401);
    f.service.seedCode('limited-code-2026', { projectLimit: 1, runLimit: 1 }); await f.login('limited-code-2026');
    const project = await f.project(); assert.equal((await f.request('POST', '/projects', { title: 'Extra' })).status, 403);
    await f.request('POST', `/projects/${project.id}/runs`, { prompt: '[hold]', mode: 'build' });
    assert.equal((await f.request('POST', `/projects/${project.id}/runs`, { prompt: 'Extra', mode: 'build' })).status, 403);
    assert.equal((await f.service.app.inject({ method: 'POST', url: '/api/v1/projects', headers: { origin: 'https://evil.test' }, payload: { title: 'No' } })).statusCode, 403);
    assert.equal((await f.service.app.inject('/internal/v1/input-artifacts/anything/manifest')).statusCode, 401);
    assert.equal((await f.request('DELETE', '/session')).status, 204);
    assert.equal((await f.request('GET', '/session')).status, 401);
  } finally { await f.close(); }
});

test('queued cancellation releases reserved quota; cancellation wins against a late completed event', async () => {
  const f = await fixture();
  try {
    await f.login(); const project = await f.project();
    const queued = (await f.request('POST', `/projects/${project.id}/runs`, { prompt: 'not started', mode: 'build' })).data.run;
    await f.request('POST', `/runs/${queued.id}/cancel`, {});
    assert.equal((await f.request('GET', '/session')).data.quota.runsReserved, 0);
    assert.equal(f.fake.startCalls, 0);
    const held = (await f.request('POST', `/projects/${project.id}/runs`, { prompt: '[hold]', mode: 'build' })).data.run;
    await f.service.tick();
    const running = (await f.request('GET', `/runs/${held.id}`)).data;
    f.fake.complete(running.executionId);
    await f.request('POST', `/runs/${held.id}/cancel`, {});
    await f.service.tick();
    const final = (await f.request('GET', `/runs/${held.id}`)).data;
    assert.equal(final.status, 'cancelled');
    assert.equal((await f.request('GET', `/projects/${project.id}/workspace`)).data.currentVersion, null);
  } finally { await f.close(); }
});

test('active execution reconciles after API restart without repeat start or duplicated events', async () => {
  const f = await fixture();
  try {
    await f.login(); const project = await f.project();
    const created = (await f.request('POST', `/projects/${project.id}/runs`, { prompt: '[hold]', mode: 'build' })).data.run;
    await f.service.tick();
    const before = (await f.request('GET', `/projects/${project.id}/workspace`)).data;
    await f.restart(); await f.service.tick();
    const after = (await f.request('GET', `/projects/${project.id}/workspace`)).data;
    assert.equal(after.activeRun.id, created.id); assert.equal(after.eventCursor, before.eventCursor); assert.equal(f.fake.startCalls, 1);
    assert.equal((await f.request('GET', '/session')).data.quota.runsUsed, 1);
  } finally { await f.close(); }
});
