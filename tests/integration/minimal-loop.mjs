import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import {
  WorkspaceSnapshot, Run, Project, VersionList, RestoreVersionResponse,
  ProjectEventPage, FileList, EvidenceList,
} from '../../packages/contracts/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const real = process.argv.includes('--real');
if (real && existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
if (real && !process.env.DEEPSEEK_API_KEY) throw new Error('Real integration requires DEEPSEEK_API_KEY in the local root .env. No fake fallback.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'atoms-integration-'));
const children = [];
const redact = (value) => env.DEEPSEEK_API_KEY ? String(value).split(env.DEEPSEEK_API_KEY).join('[REDACTED]') : String(value);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
const [apiPort, previewPort, agentPort] = await Promise.all([port(), port(), port()]);
const origin = `http://localhost:${apiPort}`;
const agentOrigin = `http://127.0.0.1:${agentPort}`;
const token = `integration-${randomUUID()}`;
const env = {
  ...process.env, NODE_ENV: 'test', DEEPSEEK_API_KEY: real ? process.env.DEEPSEEK_API_KEY : '',
  API_PORT: String(apiPort), PREVIEW_PORT: String(previewPort), AGENT_PORT: String(agentPort),
  API_DATA_DIR: path.join(directory, 'api'), AGENT_DATA_DIR: path.join(directory, 'agent'),
  ATOMS_SERVICE_TOKEN: token, INTERNAL_SERVICE_TOKEN: token,
  AGENT_URL: agentOrigin, API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
  PREVIEW_SECRET: randomUUID(), PREVIEW_ORIGIN: `http://127.0.0.1:${previewPort}`,
  PREVIEW_PUBLIC_URL: `http://127.0.0.1:${previewPort}`,
  ALLOWED_ORIGINS: origin, ATOMS_ALLOWED_ORIGINS: origin,
  API_ENABLE_DEMO_SEED: '1', API_DEMO_CODE: 'integration-demo-2026',
  ATOMS_ENABLE_DEMO: 'true', ATOMS_DEMO_CODE: 'integration-demo-2026',
  AGENT_MODE: real ? 'dsh' : 'fake', ATOMS_AGENT_MODE: real ? 'dsh' : 'fake',
};
function start(name) {
  const childEnv = { ...env };
  if (name !== '@atoms/agent') delete childEnv.DEEPSEEK_API_KEY;
  const child = spawn('pnpm', ['--filter', name, 'start'], {
    cwd: root, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => { child.output = redact(child.output + data).slice(-16000); });
  }
  children.push(child);
  return child;
}
async function stop(child) {
  child.intentionalStop = true;
  if (child.exitCode !== null) return;
  const ended = once(child, 'exit').catch(() => {});
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
  await Promise.race([ended, delay(2000)]);
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group is gone */ }
}
async function ready(url, headers = {}) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
      if (response.status === 200 || (url.endsWith('/api/v1/session') && response.status === 401)) return;
    } catch { /* process booting */ }
    const dead = children.find((child) => child.exitCode !== null && !child.intentionalStop);
    if (dead) throw new Error(`Service stopped: ${dead.output}`);
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
let cookie = '';
let integrationFailed = false;
async function request(method, route, body, key = randomUUID()) {
  const response = await fetch(`${origin}/api/v1${route}`, {
    method, headers: { 'Content-Type': 'application/json', Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}), ...(method === 'GET' ? {} : { 'Idempotency-Key': key }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${route} -> ${response.status}: ${JSON.stringify(data)}`);
  return { response, data };
}
async function waitRun(id, statuses, timeout = real ? 660000 : 150000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const { data } = await request('GET', `/runs/${id}`);
    const run = Run.parse(data);
    if (statuses.includes(run.status)) return run;
    assert.ok(!['failed', 'cancelled', 'interrupted'].includes(run.status),
      `Run ${id} unexpectedly ${run.status}: ${JSON.stringify(run.error)}`);
    await delay(200);
  }
  throw new Error(`Run ${id} did not reach ${statuses.join('/')}`);
}
try {
  start('@atoms/agent');
  let api = start('@atoms/api');
  await ready(`${agentOrigin}/internal/v1/health`, { Authorization: `Bearer ${token}`, 'X-Atoms-Protocol-Version': '0.1.0' });
  await ready(`${origin}/api/v1/session`);
  console.log(`Services ready: actual API + Runtime HTTP, ${real ? 'REAL DSH + DeepSeek API' : 'deterministic Fake DSH'}.`);

  const login = await request('POST', '/sessions', { code: 'integration-demo-2026' });
  cookie = login.response.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.ok(cookie.includes('atoms_session='), 'Session cookie was not issued');
  const project = Project.parse((await request('POST', '/projects', { title: 'Integration 便签墙' })).data);
  const createKey = randomUUID();
  const firstRequest = { prompt: '创建一个支持新增、删除、拖拽和本地保存的便签墙', mode: 'plan' };
  const first = Run.parse((await request('POST', `/projects/${project.id}/runs`, firstRequest, createKey)).data.run);
  const duplicate = (await request('POST', `/projects/${project.id}/runs`, firstRequest, createKey)).data.run;
  assert.equal(duplicate.id, first.id, 'Duplicate create must not create a second task');
  const waiting = await waitRun(first.id, ['waiting_input']);
  assert.equal(waiting.pendingAttention?.kind, 'plan_confirmation');
  await request('POST', `/runs/${first.id}/answers`, {
    attentionId: waiting.pendingAttention.id, expectedRevision: waiting.pendingAttention.revision,
    answer: { kind: 'approve_plan' },
  });
  const completed = await waitRun(first.id, ['succeeded']);
  assert.ok(completed.resultVersionId);
  let workspace = WorkspaceSnapshot.parse((await request('GET', `/projects/${project.id}/workspace`)).data);
  assert.equal(workspace.currentVersion.id, completed.resultVersionId);
  assert.equal(workspace.latestRun.status, 'succeeded');
  for (const kind of ['typecheck', 'build', 'smoke']) {
    assert.ok(workspace.currentVersion.checks.some((check) => check.kind === kind && check.status === 'passed'));
  }
  const firstVersion = workspace.currentVersion;
  const preview = await fetch(firstVersion.previewUrl);
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /<html|<!doctype/i);
  const files = FileList.parse((await request('GET', `/versions/${firstVersion.id}/files`)).data);
  assert.ok(files.files.filter((file) => /\.(tsx|ts)$/.test(file.path)).length >= 2, 'Expected a genuine multi-file source');
  const evidence = EvidenceList.parse((await request('GET', `/versions/${firstVersion.id}/evidence`)).data);
  assert.ok(evidence.items.length >= 3, 'Checks need actual evidence');
  console.log('PASS: login, idempotent create, plan approval, React build, signed preview, evidence.');

  const second = (await request('POST', `/projects/${project.id}/runs`, {
    prompt: '增加一个搜索框，按便签内容筛选', mode: 'build',
  })).data.run;
  await waitRun(second.id, ['succeeded']);
  workspace = WorkspaceSnapshot.parse((await request('GET', `/projects/${project.id}/workspace`)).data);
  assert.equal(workspace.currentVersion.parentVersionId, firstVersion.id);
  assert.notEqual(workspace.currentVersion.id, firstVersion.id);
  const restore = RestoreVersionResponse.parse((await request('POST', `/projects/${project.id}/restore`, {
    versionId: firstVersion.id, expectedProjectRevision: workspace.project.revision,
  })).data);
  assert.equal(restore.version.restoredFromVersionId, firstVersion.id);
  assert.notEqual(restore.version.id, firstVersion.id);
  const versions = VersionList.parse((await request('GET', `/projects/${project.id}/versions`)).data);
  assert.equal(versions.items.length, 3);
  console.log('PASS: incremental modification and immutable restore to a new third version.');
  let finalVersionId = restore.version.id;
  if (!real) {
    const afterRestore = (await request('POST', `/projects/${project.id}/runs`, {
      prompt: '在恢复后的便签墙上增加深色模式切换', mode: 'build',
    })).data.run;
    const afterRestoreCompleted = await waitRun(afterRestore.id, ['succeeded']);
    assert.equal(afterRestoreCompleted.baseVersionId, restore.version.id, 'Post-restore edit must use the new restored version as baseline');
    workspace = WorkspaceSnapshot.parse((await request('GET', `/projects/${project.id}/workspace`)).data);
    assert.equal(workspace.currentVersion.parentVersionId, restore.version.id, 'Post-restore delivery must preserve restored parentage');
    assert.notEqual(workspace.currentVersion.id, restore.version.id);
    assert.equal((await fetch(workspace.currentVersion.previewUrl)).status, 200, 'Post-restore result must have a working signed preview');
    finalVersionId = workspace.currentVersion.id;
    console.log('PASS: editing after restore uses the restored baseline, publishes a fourth child version, and serves its preview.');
  }

  let after = 0;
  let count = 0;
  for (let page = 0; page < 100; page++) {
    const data = ProjectEventPage.parse((await request('GET', `/projects/${project.id}/events?after=${after}&limit=3`)).data);
    for (const item of data.items) { assert.equal(item.seq, ++after); count++; }
    assert.equal(data.nextCursor, after);
    if (!data.hasMore) break;
  }
  assert.ok(count > 3, 'Expected persisted execution events');
  await stop(api);
  api = start('@atoms/api');
  await ready(`${origin}/api/v1/session`);
  const recovered = WorkspaceSnapshot.parse((await request('GET', `/projects/${project.id}/workspace`)).data);
  assert.equal(recovered.currentVersion.id, finalVersionId);
  assert.equal(recovered.eventCursor, after);
  console.log('PASS: paginated event replay and API restart with persisted session, project, and versions.');
  console.log(real ? 'G4 real-model minimum-loop integration passed (generation, modification, publication, restore and persistence).' : 'G3 minimum-loop integration passed. This is not a real model inference result.');
} catch (error) {
  integrationFailed = true;
  for (let index = 0; index < children.length; index++) console.error(`Service ${index} output:\n${children[index].output}`);
  throw error;
} finally {
  await Promise.all(children.map(stop));
  if (!integrationFailed && process.env.ATOMS_KEEP_TEST_DATA !== '1') await rm(directory, { recursive: true, force: true });
  else console.log(`Test data retained for diagnosis: ${directory}`);
}
