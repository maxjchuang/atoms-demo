import { http, HttpResponse, delay, type JsonBodyType, type StrictResponse } from 'msw';
import { PROTOCOL_VERSION, type ProjectDto, type RunDto, type VersionDto, type WorkspaceSnapshotDto, type ProjectEventDto } from '@atoms/contracts';
import { attention as baseAttention, checks as fixtureChecks } from '@atoms/contracts/fixtures';

type Record = { project: ProjectDto; runs: RunDto[]; versions: VersionDto[]; messages: WorkspaceSnapshotDto['messages']; events: ProjectEventDto[]; prompts: { [runId: string]: string }; ticks: { [runId: string]: number } };
type Store = { authenticated: boolean; projects: Record[]; used: number; reserved: number; idempotency: { [key: string]: { body: string; value: unknown; status: number } }; actors: { [messageId: string]: 'user' | 'worker' | 'system' } };
const key = 'atoms_web_mock_v1';
const fresh = (): Store => ({ authenticated: false, projects: [], used: 0, reserved: 0, idempotency: {}, actors: {} });
let store: Store;
try { store = JSON.parse(localStorage.getItem(key) ?? 'null') ?? fresh(); } catch { store = fresh(); }
store.actors ??= {};
const save = () => localStorage.setItem(key, JSON.stringify(store));
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const error = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message, retryable: false, requestId: id('request') } }, { status });
const unauthorized = () => store.authenticated ? null : error(401, 'UNAUTHENTICATED', '请先输入体验码，开启创作空间。');
const find = (projectId: string | readonly string[] | undefined) => store.projects.find((record) => record.project.id === projectId);
const findRun = (runId: string | readonly string[] | undefined) => { const record = store.projects.find((item) => item.runs.some((run) => run.id === runId)); return record ? { record, run: record.runs.find((run) => run.id === runId)! } : null; };
const terminal = (run: RunDto) => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status);
const session = () => ({ id: 'session_mock', expiresAt: new Date(Date.now() + 86400000).toISOString(), quota: { projectLimit: 3, runLimit: 10, projectsUsed: store.projects.length, runsUsed: store.used, runsReserved: store.reserved } });
const checks = () => fixtureChecks.map((check) => ({ ...check, summary: 'Mock 模式的模拟检查结果，不代表真实执行。' }));
function append(record: Record, runId: string | null, event: ProjectEventDto['event']) {
  record.events.push({ protocolVersion: PROTOCOL_VERSION, projectId: record.project.id, runId, seq: record.events.length + 1, occurredAt: now(), event: structuredClone(event) }); save();
}
function update(record: Record, run: RunDto, patch: Partial<RunDto>) {
  Object.assign(run, patch, { revision: run.revision + 1, updatedAt: now() });
  append(record, run.id, { type: 'run.updated', payload: structuredClone(run) });
}
function message(record: Record, runId: string, role: 'user' | 'assistant', content: string) {
  const value = { id: id('message'), projectId: record.project.id, runId, role, status: 'complete' as const, content, createdAt: now() };
  store.actors[value.id] = role === 'user' ? 'user' : 'worker';
  record.messages.push(value); append(record, runId, { type: 'message.updated', payload: value });
}
function snapshot(record: Record): WorkspaceSnapshotDto {
  return { protocolVersion: PROTOCOL_VERSION, project: record.project,
    activeRun: record.runs.find((run) => run.id === record.project.activeRunId && !terminal(run)) ?? null,
    queuedRuns: record.runs.filter((run) => run.status === 'queued' && run.id !== record.project.activeRunId),
    latestRun: record.runs.at(-1) ?? null,
    currentVersion: record.versions.find((version) => version.id === record.project.currentVersionId) ?? null,
    messages: record.messages, olderMessagesCursor: null, eventCursor: record.events.length };
}
function advance(record: Record) {
  let run = record.runs.find((run) => run.id === record.project.activeRunId);
  if (!run || terminal(run)) {
    run = record.runs.find((run) => run.status === 'queued');
    if (!run) return;
    record.project.activeRunId = run.id; run.baseVersionId = record.project.currentVersionId;
  }
  if (run.status === 'waiting_input') return;
  if (run.status === 'cancelling') { record.project.activeRunId = null; update(record, run, { status: 'cancelled', pendingAttention: null, pendingAnswer: null }); return; }
  const tick = record.ticks[run.id] = (record.ticks[run.id] ?? 0) + 1;
  if (run.status === 'queued') {
    if (!run.executionId) {
      store.reserved--; store.used++;
      append(record, run.id, { type: 'activity.recorded', payload: { type: 'execution.started', payload: {} } });
    }
    update(record, run, { status: 'running', phase: 'planning', executionId: run.executionId ?? id('execution') });
    append(record, run.id, { type: 'activity.recorded', payload: { type: 'phase.changed', payload: { phase: 'planning' } } });
    message(record, run.id, 'assistant', '已收到你的需求。我会先整理实现范围，再构建并验证应用。此处为独立 Mock 演示。'); return;
  }
  if (tick === 2 && record.prompts[run.id].includes('[run-question]') && !run.pendingAnswer) {
    update(record, run, { status: 'waiting_input', pendingAttention: { id: id('attention'), runId: run.id, revision: 1, kind: 'question', title: '构建需要补充配色信息', description: '这是已有Run执行中的问题。', options: [{ id: 'option_warm', label: '暖色' }, { id: 'option_dark', label: '深色' }], allowText: true, createdAt: now() } }); return;
  }
  if (tick === 2 && run.mode === 'plan' && !run.pendingAnswer) {
    update(record, run, { status: 'waiting_input', pendingAttention: { ...baseAttention, id: id('attention'), runId: run.id, createdAt: now() } }); return;
  }
  if (record.prompts[run.id].includes('[long-wait]') && tick > 2) return;
  if (tick <= 3) {
    if (run.phase !== 'generating') {
      update(record, run, { phase: 'generating' });
      append(record, run.id, { type: 'activity.recorded', payload: { type: 'phase.changed', payload: { phase: 'generating' } } });
      for (const path of ['src/App.tsx', 'src/components/Note.tsx']) append(record, run.id, {
        type: 'activity.recorded', payload: { type: 'file.changed', payload: { path, operation: 'added' } },
      });
    }
    return;
  }
  if (tick === 4) {
    update(record, run, { phase: 'verifying' });
    append(record, run.id, { type: 'activity.recorded', payload: { type: 'phase.changed', payload: { phase: 'verifying' } } });
    return;
  }
  if (tick === 5 && record.prompts[run.id].includes('修复')) {
    append(record, run.id, { type: 'activity.recorded', payload: { type: 'check.completed', payload: { ...checks()[1], status: 'failed', summary: 'Mock: unresolved import' } } });
    update(record, run, { phase: 'repairing' });
    append(record, run.id, { type: 'activity.recorded', payload: { type: 'phase.changed', payload: { phase: 'repairing' } } });
    return;
  }
  if (record.prompts[run.id].includes('失败')) {
    record.project.activeRunId = null;
    update(record, run, { status: 'failed', error: { code: 'VERIFICATION_FAILED', message: '模拟验证失败。上一成功版本已保留，可修改需求后重试。' }, pendingAnswer: null }); return;
  }
  if (tick <= 6) {
    if (run.phase !== 'publishing') {
      for (const check of checks()) append(record, run.id, { type: 'activity.recorded', payload: { type: 'check.completed', payload: check } });
      update(record, run, { phase: 'publishing', checks: checks() });
    }
    return;
  }
  const versionId = id('version');
  const version: VersionDto = { id: versionId, projectId: record.project.id, runId: run.id,
    parentVersionId: record.project.currentVersionId, restoredFromVersionId: null,
    summary: record.versions.length ? '更新应用交互与搜索功能' : '交付可交互的灵感便签墙', checks: checks(),
    previewUrl: `${location.origin}/mock-preview.html#${versionId}`, previewExpiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now() };
  record.versions.unshift(version); Object.assign(record.project, { currentVersionId: versionId, activeRunId: null, revision: record.project.revision + 1, updatedAt: now() });
  append(record, run.id, { type: 'version.published', payload: { project: structuredClone(record.project), version } });
  update(record, run, { status: 'succeeded', resultVersionId: versionId, pendingAnswer: null });
  message(record, run.id, 'assistant', '应用已交付并保存版本。右侧可直接体验，也可以继续提出修改要求。Mock 检查结果仅用于前端流程验证。');
}
async function mutation(request: Request, operation: (body: any) => { value: unknown; status: number } | StrictResponse<JsonBodyType>): Promise<StrictResponse<JsonBodyType>> {
  const body = await request.json().catch(() => ({}));
  const requestId = request.headers.get('Idempotency-Key');
  if (!requestId) return error(400, 'INVALID_REQUEST', '缺少幂等请求标识。');
  const identifier = `${request.method}:${new URL(request.url).pathname}:${requestId}`;
  const existing = store.idempotency[identifier];
  if (existing) return existing.body === JSON.stringify(body) ? HttpResponse.json(existing.value as JsonBodyType, { status: existing.status }) : error(409, 'CONFLICT', '请求内容与原请求不一致。');
  const result = operation(body);
  if (result instanceof Response) return result;
  store.idempotency[identifier] = { body: JSON.stringify(body), value: structuredClone(result.value), status: result.status }; save();
  return HttpResponse.json(result.value as JsonBodyType, { status: result.status });
}

function enqueue(record: Record, prompt: string, mode: 'build' | 'plan', inputMessageId?: string, inputContent = prompt): RunDto {
  const run: RunDto = { id: id('run'), projectId: record.project.id, status: 'queued', phase: null, revision: 1, mode, baseVersionId: null, executionId: null, resultVersionId: null, pendingAttention: null, pendingAnswer: null, checks: [], error: null, createdAt: now(), updatedAt: now() };
  record.runs.push(run); record.prompts[run.id] = prompt; store.reserved++; record.project.updatedAt = now();
  if (inputMessageId) {
    const user = { id: inputMessageId, projectId: record.project.id, runId: run.id, role: 'user' as const, status: 'complete' as const, content: inputContent, createdAt: now() };
    store.actors[user.id] = 'user'; record.messages.push(user); append(record, run.id, { type: 'message.updated', payload: user });
  } else message(record, run.id, 'user', prompt);
  append(record, run.id, { type: 'run.updated', payload: run }); return run;
}
export const mockExecutionStore = {
  get state() { return store; }, find, findRun, snapshot, advance, enqueue, update, append, save, now, id, mutation, unauthorized, session, error,
};

export const handlers = [
  http.get('/api/v1/session', () => unauthorized() ?? HttpResponse.json(session())),
  http.post('/api/v1/sessions', ({ request }) => mutation(request, (body) => {
    if (body.code !== 'atoms-demo-2026') return error(403, 'FORBIDDEN', '体验码无效，请确认后重试。');
    store.authenticated = true; save(); return { value: session(), status: 201 };
  })),
  http.delete('/api/v1/session', () => { store.authenticated = false; save(); return new HttpResponse(null, { status: 204 }); }),
  http.get('/api/v1/projects', () => unauthorized() ?? HttpResponse.json({ items: store.projects.map((record) => record.project).reverse(), nextCursor: null })),
  http.post('/api/v1/projects', ({ request }) => unauthorized() ?? mutation(request, (body) => {
    if (store.projects.length >= 3) return error(403, 'QUOTA_EXCEEDED', '体验项目数已达上限（3 个）。');
    const project: ProjectDto = { id: id('project'), title: body.title, revision: 1, activeRunId: null, currentVersionId: null, createdAt: now(), updatedAt: now() };
    store.projects.push({ project, runs: [], versions: [], messages: [], events: [], prompts: {}, ticks: {} }); return { value: project, status: 201 };
  })),
  http.get('/api/v1/projects/:id/workspace', ({ params }) => unauthorized() ?? (find(params.id) ? HttpResponse.json(snapshot(find(params.id)!)) : error(404, 'NOT_FOUND', '找不到项目。'))),
  http.get('/api/v1/projects/:id/events', ({ params, request }) => {
    const auth = unauthorized(); if (auth) return auth;
    const record = find(params.id); if (!record) return error(404, 'NOT_FOUND', '找不到项目。');
    advance(record); const after = Number(new URL(request.url).searchParams.get('after') ?? 0);
    const items = record.events.filter((event) => event.seq > after).slice(0, 100);
    const nextCursor = items.at(-1)?.seq ?? after;
    return HttpResponse.json({ items, nextCursor, hasMore: record.events.length > nextCursor });
  }),
  http.post('/api/v1/projects/:id/runs', async ({ params, request }) => {
    // Ensure an empty-project snapshot can win the race before creation commits.
    // The client must refresh workspace after the accepted run response.
    await delay(150);
    return unauthorized() ?? mutation(request, (body) => {
    const record = find(params.id); if (!record) return error(404, 'NOT_FOUND', '找不到项目。');
    if (store.used + store.reserved >= 10) return error(403, 'QUOTA_EXCEEDED', '体验构建额度已用完。');
    const run = enqueue(record, body.prompt, body.mode);
    return { value: { run }, status: 202 };
  }); }),
  http.get('/api/v1/runs/:id', ({ params }) => unauthorized() ?? (findRun(params.id) ? HttpResponse.json(findRun(params.id)!.run) : error(404, 'NOT_FOUND', '任务不存在。'))),
  http.post('/api/v1/runs/:id/answers', ({ params, request }) => unauthorized() ?? mutation(request, (body) => {
    const item = findRun(params.id); if (!item) return error(404, 'NOT_FOUND', '任务不存在。');
    const { record, run } = item;
    if (!run.pendingAttention || run.pendingAttention.id !== body.attentionId || run.pendingAttention.revision !== body.expectedRevision) return error(409, 'STALE_REVISION', '问题已更新，请刷新后重试。');
    update(record, run, { status: 'queued', pendingAttention: null, pendingAnswer: { attentionId: body.attentionId, status: 'accepted', submittedAt: now() } });
    record.ticks[run.id] = 1; return { value: { run }, status: 202 };
  })),
  http.post('/api/v1/runs/:id/cancel', ({ params, request }) => unauthorized() ?? mutation(request, () => {
    const item = findRun(params.id); if (!item) return error(404, 'NOT_FOUND', '任务不存在。');
    if (terminal(item.run)) return { value: { run: item.run }, status: 200 };
    if (!item.run.executionId) store.reserved--;
    update(item.record, item.run, { status: 'cancelling', pendingAttention: null, pendingAnswer: null });
    item.record.project.activeRunId = item.run.id;
    return { value: { run: item.run }, status: 202 };
  })),
  http.get('/api/v1/projects/:id/versions', ({ params }) => unauthorized() ?? (find(params.id) ? HttpResponse.json({ items: find(params.id)!.versions, nextCursor: null }) : error(404, 'NOT_FOUND', '项目不存在。'))),
  http.post('/api/v1/projects/:id/restore', ({ params, request }) => unauthorized() ?? mutation(request, (body) => {
    const record = find(params.id); if (!record) return error(404, 'NOT_FOUND', '项目不存在。');
    if (record.project.activeRunId || record.project.revision !== body.expectedProjectRevision) return error(409, 'CONFLICT', '项目正在执行或版本已更新，请刷新后重试。');
    const source = record.versions.find((version) => version.id === body.versionId); if (!source) return error(404, 'NOT_FOUND', '版本不存在。');
    const versionId = id('version'); const version = { ...source, id: versionId, parentVersionId: record.project.currentVersionId, restoredFromVersionId: source.id, runId: null, summary: '恢复历史版本', createdAt: now(), previewUrl: `${location.origin}/mock-preview.html#${versionId}` };
    record.versions.unshift(version); record.project.currentVersionId = version.id; record.project.revision++;
    append(record, null, { type: 'version.published', payload: { project: record.project, version } });
    return { value: { project: record.project, version }, status: 201 };
  })),
  http.get('/api/v1/versions/:id/files', ({ params }) => unauthorized() ?? HttpResponse.json({ versionId: params.id, files: ['source/package.json', 'source/index.html', 'source/src/App.tsx', 'source/src/components/Note.tsx', 'source/src/styles.css'].map((path) => ({ path, bytes: 100, sha256: 'a'.repeat(64), mediaType: 'text/plain' })) })),
  http.get('/api/v1/versions/:id/file', ({ request }) => unauthorized() ?? new HttpResponse(mockSourceFiles[new URL(request.url).searchParams.get('path') ?? ''] ?? '// Mock fixture: no source recorded.', { headers: { 'Content-Type': 'text/plain' } })),
  http.get('/api/v1/versions/:id/source.zip', () => unauthorized() ?? new HttpResponse(new Uint8Array([80,75,5,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="mock-empty-source.zip"' } })),
  http.get('/__mock_preview/:id', () => new HttpResponse(mockPreview, { headers: { 'Content-Type': 'text/html' } })),
];
const mockSource = `// Independent frontend Mock fixture. Real source comes from the published artifact.\nimport { useState } from 'react';\nimport Note from './components/Note';\n\nexport default function App() {\n  const [notes, setNotes] = useState(['把灵感写下来']);\n  return <main><h1>灵感便签墙</h1>\n    <button onClick={() => setNotes([...notes, '新的想法'])}>新增便签</button>\n    {notes.map((note, i) => <Note key={i} text={note} />)}\n  </main>;\n}`;
const mockSourceFiles: { [path: string]: string } = {
  'source/src/App.tsx': mockSource,
  'source/src/components/Note.tsx': "// Independent Mock fixture.\nexport default function Note() { return <article>灵感便签</article>; }",
  'source/src/styles.css': '/* Independent Mock fixture. */\n.note { background: #fff4c8; padding: 16px; }\n',
  'source/package.json': JSON.stringify({ name: 'mock-notes', private: true, scripts: { build: 'vite build' } }, null, 2) + '\n',
  'source/index.html': '<!doctype html>\n<html lang="zh-CN"><body><div id="root"></div></body></html>\n',
};
const mockPreview = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:40px;background:#f8f3e8;color:#665744;font-family:system-ui}header{display:flex;justify-content:space-between;align-items:center}h1{font-size:26px;margin:5px 0}p{color:#a69a87;font-size:12px}button{border:0;padding:10px 16px;border-radius:8px;background:#746653;color:white;cursor:pointer}small{font-size:10px;color:#b3a48c}.notes{display:flex;flex-wrap:wrap;gap:18px;margin-top:30px}article{width:170px;min-height:150px;padding:20px;background:#f5d98c;border-radius:3px;box-shadow:0 5px 12px #58452c0a;transform:rotate(-2deg)}article:nth-child(2n){background:#e4c5bb;transform:rotate(2deg)}article:nth-child(3n){background:#cbd4b8}textarea{border:0;background:none;width:100%;height:90px;resize:none;font:14px/1.8 system-ui;color:#736042;outline:none}</style><header><div><small>MOCK PREVIEW · 模拟应用</small><h1>灵感便签墙</h1><p>给每一个稍纵即逝的想法，留一个位置。</p></div><button id="add">＋ 新增便签</button></header><div class="notes" id="notes"><article><textarea>把灵感写下来 ✦\n\n今天也要创造一点什么。</textarea></article><article><textarea>周末的小计划\n\n去散步，读一本书。</textarea></article><article><textarea>下一个好点子\n\n从一张便签开始。</textarea></article></div><script>document.getElementById('add').onclick=function(){const a=document.createElement('article');const t=document.createElement('textarea');t.value='新的想法';a.appendChild(t);document.getElementById('notes').appendChild(a);t.focus()}</script></html>`;
