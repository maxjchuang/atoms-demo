import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { zipSync } from 'fflate';
import {
  PROTOCOL_VERSION, AgentEvent, AgentEventPage, ArtifactManifest, ExecutionSnapshot,
  CreateProjectRequest, CreateRunRequest, RedeemCodeRequest, AnswerRequest,
  RestoreVersionRequest, Run, WorkspaceSnapshot, RelativePath,
  type AgentEventDto, type ProjectEventDto, type RunDto, type StartExecutionDto, type VersionDto,
} from '@atoms/contracts';
import { Store, type Code, type IdempotentResult, type RunRecord, type SessionRecord, type VersionRecord } from './store.js';

export interface ApiOptions {
  dataDir: string; agentUrl: string; serviceToken: string; previewSecret: string; previewOrigin: string;
  allowedOrigins?: string[]; secureCookies?: boolean; demoCode?: string; pollMs?: number; autoSchedule?: boolean;
}
type Result = { status: number; body?: unknown; cookie?: string };
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomBytes(10).toString('hex')}`;
export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const terminal = (status: string) => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(status);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
class HttpError extends Error { constructor(readonly status: number, readonly code: string, message: string, readonly retryable = false) { super(message); } }
const fail = (status: number, code: string, message: string): never => { throw new HttpError(status, code, message); };
const param = (request: FastifyRequest, key: string) => String((request.params as Record<string, string>)[key]);
const query = (request: FastifyRequest) => request.query as Record<string, string | undefined>;
const integer = (value: string | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER) => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) > max || (fallback > 0 && Number(value) < 1)) return fail(400, 'INVALID_REQUEST', 'Invalid pagination');
  return Number(value);
};
const safeSecretEqual = (a: string, b: string) => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export async function createApi(options: ApiOptions) {
  const dataDir = resolve(options.dataDir);
  await mkdir(join(dataDir, 'versions'), { recursive: true });
  const store = new Store(join(dataDir, 'api.sqlite'));
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  const preview = Fastify({ logger: false, routerOptions: { maxParamLength: 4096 } });
  let busy = false; let closed = false;
  const loginAttempts = new Map<string, { since: number; count: number }>();
  const authHeaders = { authorization: `Bearer ${options.serviceToken}`, 'X-Atoms-Protocol-Version': PROTOCOL_VERSION, 'content-type': 'application/json' };
  const cookie = (token: string, clear = false) => `atoms_session=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax${options.secureCookies ? '; Secure' : ''}; Max-Age=${clear ? 0 : 604800}`;
  const emit = (projectId: string, runId: string | null, event: ProjectEventDto['event'], occurredAt = now()) => {
    const seq = store.state.events.filter((entry) => entry.projectId === projectId).at(-1)?.seq ?? 0;
    store.state.events.push({ protocolVersion: PROTOCOL_VERSION, projectId, runId, seq: seq + 1, occurredAt, event: structuredClone(event) });
  };
  const updateRun = (record: RunRecord, change: Partial<RunDto>) => {
    record.dto = Run.parse({ ...record.dto, ...change, revision: record.dto.revision + 1, updatedAt: now() });
    emit(record.dto.projectId, record.dto.id, { type: 'run.updated', payload: record.dto });
  };
  // Connection reports are visible business messages, not execution state transitions.
  // The persisted flag deduplicates each outage cycle even across API restarts.
  const reportRuntimeConnection = (runId: string, connected: boolean) => {
    const record = store.state.runs.find((entry) => entry.dto.id === runId);
    if (!record || (connected ? !record.runtimeDisconnected : record.runtimeDisconnected)) return;
    store.transaction(() => {
      record.runtimeDisconnected = !connected;
      const message = {
        id: id('message'), projectId: record.dto.projectId, runId: record.dto.id,
        role: 'assistant' as const, status: 'complete' as const,
        content: connected
          ? '与 Agent 执行服务的连接已恢复，任务进度已重新同步。'
          : '暂时无法同步 Agent 执行服务的进度，正在重试。任务尚未被确认停止，当前版本不会因此被替换。',
        createdAt: now(),
      };
      store.state.messages.push(message);
      emit(record.dto.projectId, record.dto.id, { type: 'message.updated', payload: message });
    });
  };
  const codeFor = (session: SessionRecord) => store.state.codes.find((entry) => entry.id === session.codeId)!;
  const sessionDto = (session: SessionRecord) => {
    const code = codeFor(session); const records = store.state.runs.filter((entry) => entry.codeId === code.id);
    return { id: session.id, expiresAt: session.expiresAt, quota: { projectLimit: code.projectLimit, runLimit: code.runLimit,
      projectsUsed: store.state.projects.filter((entry) => entry.codeId === code.id).length,
      runsReserved: records.filter((entry) => !entry.started && !terminal(entry.dto.status)).length,
      runsUsed: records.filter((entry) => entry.started).length } };
  };
  const authorize = (request: FastifyRequest) => {
    const token = String(request.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith('atoms_session='))?.slice(14);
    const session = token && store.state.sessions.find((entry) => entry.tokenHash === hash(token));
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return fail(401, 'UNAUTHENTICATED', '会话已过期，请重新输入体验码');
    const code = codeFor(session);
    if (!code || code.revoked || Date.parse(code.expiresAt) <= Date.now()) return fail(401, 'UNAUTHENTICATED', '体验码已失效');
    return session;
  };
  const ownProject = (projectId: string, session: SessionRecord) => {
    const project = store.state.projects.find((entry) => entry.dto.id === projectId && entry.codeId === session.codeId);
    if (!project) return fail(404, 'NOT_FOUND', '项目不存在或不可访问');
    return project;
  };
  const ownRun = (runId: string, session: SessionRecord) => {
    const run = store.state.runs.find((entry) => entry.dto.id === runId && entry.codeId === session.codeId);
    if (!run) return fail(404, 'NOT_FOUND', '任务不存在或不可访问');
    return run;
  };
  const ownVersion = (versionId: string, session: SessionRecord) => {
    const version = store.state.versions.find((entry) => entry.dto.id === versionId);
    if (!version) return fail(404, 'NOT_FOUND', '版本不存在或不可访问');
    ownProject(version.dto.projectId, session); return version;
  };
  const mutation = (request: FastifyRequest, reply: FastifyReply, actor: string, fn: () => Result) => {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[\x20-\x7e]{8,128}$/.test(key)) return fail(400, 'INVALID_REQUEST', 'Idempotency-Key is required');
    const scope = `${actor}:${request.method}:${request.url}:${key}`;
    const bodyHash = hash(canonical(request.body ?? {}));
    const previous = store.state.idempotency[scope];
    let result: IdempotentResult;
    if (previous) {
      if (previous.hash !== bodyHash) return fail(409, 'CONFLICT', '同一幂等键不能提交不同内容');
      result = previous;
    } else result = store.transaction(() => {
      const value = fn(); const entry = { ...structuredClone(value), hash: bodyHash };
      store.state.idempotency[scope] = entry; return entry;
    });
    if (result.cookie) reply.header('set-cookie', result.cookie);
    return reply.code(result.status).send(result.body);
  };
  const signedPreview = (versionId: string, expiresAt: string) => {
    const payload = Buffer.from(JSON.stringify({ versionId, exp: Date.parse(expiresAt) })).toString('base64url');
    const signature = createHmac('sha256', options.previewSecret).update(payload).digest('base64url');
    return `${options.previewOrigin.replace(/\/$/, '')}/p/${payload}.${signature}/index.html`;
  };
  const freshVersion = (record: VersionRecord) => {
    if (Date.parse(record.dto.previewExpiresAt) - Date.now() < 60000) {
      // URL cache metadata only; no business revision/event changes.
      const expiresAt = new Date(Math.ceil((Date.now() + 7200000) / 60000) * 60000).toISOString();
      record.dto = { ...record.dto, previewExpiresAt: expiresAt, previewUrl: signedPreview(record.dto.id, expiresAt) };
    }
    return record.dto;
  };
  const release = (record: RunRecord) => {
    const project = store.state.projects.find((entry) => entry.dto.id === record.dto.projectId)!;
    if (project.dto.activeRunId === record.dto.id) project.dto.activeRunId = null;
  };

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Atoms-Protocol-Version', PROTOCOL_VERSION).header('X-Content-Type-Options', 'nosniff');
    if (request.url.startsWith('/internal/')) {
      if (!safeSecretEqual(String(request.headers.authorization ?? ''), `Bearer ${options.serviceToken}`)) fail(401, 'UNAUTHENTICATED', 'Internal authentication required');
      return;
    }
    if (request.method === 'POST' && request.url === '/api/v1/sessions') {
      const current = loginAttempts.get(request.ip);
      if (!current || Date.now() - current.since >= 60000) loginAttempts.set(request.ip, { since: Date.now(), count: 1 });
      else {
        current.count++;
        if (current.count > 20) { reply.header('Retry-After', '60'); fail(429, 'RATE_LIMITED', '体验码请求过于频繁，请稍后再试'); }
      }
    }
    if (['POST', 'DELETE', 'PUT', 'PATCH'].includes(request.method)) {
      const origin = request.headers.origin;
      const permitted = options.allowedOrigins ?? [];
      const ownOrigin = `${options.secureCookies ? 'https' : 'http'}://${request.headers.host}`;
      if ((origin && origin !== ownOrigin && !permitted.includes(origin)) || (!origin && request.headers['sec-fetch-site'] === 'cross-site')) fail(403, 'FORBIDDEN', 'Cross-origin mutation denied');
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const known = error instanceof HttpError;
    const validation = (error as Error).name === 'ZodError' || (error as { statusCode?: number }).statusCode === 400;
    reply.code(known ? error.status : validation ? 400 : 500).send({ error: {
      code: known ? error.code : validation ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
      message: known ? error.message : validation ? '请求数据不符合协议' : '服务暂时无法完成请求',
      retryable: known ? error.retryable : false, requestId: id('request'),
    } });
  });
  app.get('/health', async () => ({ ready: true, protocolVersion: PROTOCOL_VERSION }));
  app.post('/api/v1/sessions', (request, reply) => {
    const body = RedeemCodeRequest.parse(request.body); const codeHash = hash(body.code);
    return mutation(request, reply, `code_${codeHash}`, () => {
      const code = store.state.codes.find((entry) => entry.hash === codeHash && !entry.revoked && Date.parse(entry.expiresAt) > Date.now());
      if (!code) fail(401, 'UNAUTHENTICATED', '体验码无效或已过期');
      const token = randomBytes(32).toString('base64url');
      const session = { id: id('session'), codeId: code!.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 604800000).toISOString() };
      store.state.sessions.push(session); return { status: 201, body: sessionDto(session), cookie: cookie(token) };
    });
  });
  app.get('/api/v1/session', (request) => sessionDto(authorize(request)));
  app.delete('/api/v1/session', (request, reply) => {
    const token = String(request.headers.cookie ?? '');
    return mutation(request, reply, `logout_${hash(token)}`, () => {
      const raw = token.split(';').map((part) => part.trim()).find((part) => part.startsWith('atoms_session='))?.slice(14);
      if (raw) store.state.sessions = store.state.sessions.filter((entry) => entry.tokenHash !== hash(raw));
      return { status: 204, cookie: cookie('', true) };
    });
  });
  const page = <T>(items: T[], cursor: string | undefined, limit: number) => {
    let offset = 0;
    if (cursor) { try { offset = Number(Buffer.from(cursor, 'base64url').toString()); } catch { fail(400, 'INVALID_REQUEST', 'Invalid cursor'); } }
    if (!Number.isInteger(offset) || offset < 0) fail(400, 'INVALID_REQUEST', 'Invalid cursor');
    return { items: items.slice(offset, offset + limit), nextCursor: offset + limit < items.length ? Buffer.from(String(offset + limit)).toString('base64url') : null };
  };
  app.get('/api/v1/projects', (request) => {
    const session = authorize(request); const q = query(request);
    const rows = store.state.projects.filter((entry) => entry.codeId === session.codeId).map((entry) => entry.dto).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    return page(rows, q.cursor, integer(q.limit, 20, 100));
  });
  app.post('/api/v1/projects', (request, reply) => {
    const session = authorize(request); const body = CreateProjectRequest.parse(request.body);
    return mutation(request, reply, session.id, () => {
      if (sessionDto(session).quota.projectsUsed >= codeFor(session).projectLimit) fail(403, 'QUOTA_EXCEEDED', '项目额度已用完');
      const project = { id: id('project'), title: body.title, revision: 1, currentVersionId: null, activeRunId: null, createdAt: now(), updatedAt: now() };
      store.state.projects.push({ dto: project, codeId: session.codeId }); return { status: 201, body: project };
    });
  });
  app.get('/api/v1/projects/:projectId/workspace', (request) => {
    const project = ownProject(param(request, 'projectId'), authorize(request));
    const runs = store.state.runs.filter((entry) => entry.dto.projectId === project.dto.id);
    const messages = store.state.messages.filter((entry) => entry.projectId === project.dto.id);
    const version = store.state.versions.find((entry) => entry.dto.id === project.dto.currentVersionId);
    return WorkspaceSnapshot.parse({ protocolVersion: PROTOCOL_VERSION, project: project.dto,
      activeRun: runs.find((entry) => entry.dto.id === project.dto.activeRunId)?.dto ?? null,
      queuedRuns: runs.filter((entry) => entry.dto.status === 'queued' && entry.dto.id !== project.dto.activeRunId).map((entry) => entry.dto),
      latestRun: runs.at(-1)?.dto ?? null, currentVersion: version ? freshVersion(version) : null,
      messages: messages.slice(-50), olderMessagesCursor: messages.length > 50 ? Buffer.from(String(messages.length - 50)).toString('base64url') : null,
      eventCursor: store.state.events.filter((entry) => entry.projectId === project.dto.id).at(-1)?.seq ?? 0 });
  });
  app.get('/api/v1/projects/:projectId/messages', (request) => {
    const project = ownProject(param(request, 'projectId'), authorize(request)); const q = query(request);
    const rows = store.state.messages.filter((entry) => entry.projectId === project.dto.id);
    const end = q.before ? Number(Buffer.from(q.before, 'base64url').toString()) : rows.length;
    if (!Number.isInteger(end) || end < 0 || end > rows.length) fail(400, 'INVALID_REQUEST', 'Invalid cursor');
    const start = Math.max(0, end - integer(q.limit, 50, 100));
    return { items: rows.slice(start, end), nextCursor: start > 0 ? Buffer.from(String(start)).toString('base64url') : null };
  });
  app.get('/api/v1/projects/:projectId/events', (request) => {
    const project = ownProject(param(request, 'projectId'), authorize(request)); const q = query(request);
    const after = integer(q.after, 0); const limit = integer(q.limit, 100, 100);
    const rows = store.state.events.filter((entry) => entry.projectId === project.dto.id && entry.seq > after);
    const items = rows.slice(0, limit); return { items, nextCursor: items.at(-1)?.seq ?? after, hasMore: rows.length > items.length };
  });
  app.post('/api/v1/projects/:projectId/runs', (request, reply) => {
    const session = authorize(request); const project = ownProject(param(request, 'projectId'), session); const body = CreateRunRequest.parse(request.body);
    return mutation(request, reply, session.id, () => {
      const quota = sessionDto(session).quota;
      if (quota.runsReserved + quota.runsUsed >= quota.runLimit) fail(403, 'QUOTA_EXCEEDED', '生成额度已用完');
      const run = Run.parse({ id: id('run'), projectId: project.dto.id, revision: 1, status: 'queued', phase: null,
        mode: body.mode, baseVersionId: null, resultVersionId: null, executionId: null, pendingAttention: null,
        pendingAnswer: null, checks: [], createdAt: now(), updatedAt: now(), error: null });
      store.state.runs.push({ dto: run, prompt: body.prompt, codeId: session.codeId, started: false, sourceSeq: 0 });
      const message = { id: id('message'), projectId: project.dto.id, runId: run.id, role: 'user' as const, status: 'complete' as const, content: body.prompt, createdAt: now() };
      store.state.messages.push(message); emit(project.dto.id, run.id, { type: 'message.updated', payload: message });
      emit(project.dto.id, run.id, { type: 'run.updated', payload: run }); return { status: 202, body: { run } };
    });
  });
  app.get('/api/v1/runs/:runId', (request) => ownRun(param(request, 'runId'), authorize(request)).dto);
  app.post('/api/v1/runs/:runId/answers', (request, reply) => {
    const session = authorize(request); const record = ownRun(param(request, 'runId'), session); const body = AnswerRequest.parse(request.body);
    return mutation(request, reply, session.id, () => {
      const attention = record.dto.pendingAttention;
      if (!attention || attention.id !== body.attentionId || attention.revision !== body.expectedRevision || record.dto.pendingAnswer) fail(409, 'STALE_REVISION', '问题已更新或回答已提交');
      if ((body.answer.kind === 'approve_plan' && attention!.kind !== 'plan_confirmation') ||
        (body.answer.kind === 'select' && !attention!.options.some((option) => option.id === (body.answer as { optionId: string }).optionId)) ||
        (body.answer.kind === 'text' && !attention!.allowText)) fail(400, 'INVALID_REQUEST', '回答与问题不匹配');
      record.answerCommand = { ...body, commandId: id('command') };
      updateRun(record, { pendingAnswer: { attentionId: body.attentionId, status: 'pending', submittedAt: now() } });
      return { status: 202, body: { run: record.dto } };
    });
  });
  app.post('/api/v1/runs/:runId/cancel', (request, reply) => {
    const session = authorize(request); const record = ownRun(param(request, 'runId'), session);
    return mutation(request, reply, session.id, () => {
      if (terminal(record.dto.status)) return { status: 200, body: { run: record.dto } };
      updateRun(record, { status: 'cancelling', pendingAttention: null, pendingAnswer: null });
      record.answerCommand = undefined;
      if (!record.dto.executionId) { updateRun(record, { status: 'cancelled' }); release(record); }
      else record.cancelCommand ??= { commandId: id('command') };
      return { status: 202, body: { run: record.dto } };
    });
  });

  app.get('/api/v1/projects/:projectId/versions', (request) => {
    const project = ownProject(param(request, 'projectId'), authorize(request)); const q = query(request);
    const rows = store.state.versions.filter((entry) => entry.dto.projectId === project.dto.id).map(freshVersion).reverse();
    return page(rows, q.cursor, integer(q.limit, 20, 100));
  });
  app.post('/api/v1/projects/:projectId/restore', (request, reply) => {
    const session = authorize(request); const project = ownProject(param(request, 'projectId'), session); const body = RestoreVersionRequest.parse(request.body);
    const original = ownVersion(body.versionId, session);
    if (original.dto.projectId !== project.dto.id) fail(404, 'NOT_FOUND', 'Version not found');
    return mutation(request, reply, session.id, () => {
      if (project.dto.revision !== body.expectedProjectRevision || project.dto.activeRunId) fail(409, 'CONFLICT', '项目状态已变化或任务仍在执行');
      const versionId = id('version'); const expiresAt = new Date(Date.now() + 7200000).toISOString();
      const dto: VersionDto = { ...original.dto, id: versionId, parentVersionId: project.dto.currentVersionId,
        restoredFromVersionId: original.dto.id, runId: null, summary: `恢复：${original.dto.summary}`, createdAt: now(),
        previewExpiresAt: expiresAt, previewUrl: signedPreview(versionId, expiresAt) };
      store.state.versions.push({ ...original, dto });
      project.dto = { ...project.dto, revision: project.dto.revision + 1, currentVersionId: versionId, updatedAt: now() };
      emit(project.dto.id, null, { type: 'version.published', payload: { project: project.dto, version: dto } });
      return { status: 201, body: { project: project.dto, version: dto } };
    });
  });
  app.get('/api/v1/versions/:versionId/files', (request) => {
    const version = ownVersion(param(request, 'versionId'), authorize(request));
    return { versionId: version.dto.id, files: version.manifest.files.filter((entry) => entry.path.startsWith('source/')) };
  });
  const readStored = async (version: VersionRecord, filePath: string) => {
    if (!RelativePath.safeParse(filePath).success || !version.manifest.files.some((entry) => entry.path === filePath)) fail(404, 'NOT_FOUND', 'File not found');
    return readFile(join(version.directory, filePath));
  };
  app.get('/api/v1/versions/:versionId/file', async (request, reply) => {
    const version = ownVersion(param(request, 'versionId'), authorize(request)); const path = query(request).path ?? '';
    if (!path.startsWith('source/')) fail(404, 'NOT_FOUND', 'Source file not found');
    return reply.type('text/plain; charset=utf-8').send(await readStored(version, path));
  });
  app.get('/api/v1/versions/:versionId/evidence', (request) => {
    const version = ownVersion(param(request, 'versionId'), authorize(request));
    return { items: version.manifest.evidence.map((entry) => ({ ...entry, ...Object.fromEntries(Object.entries(version.manifest.files.find((file) => file.path === entry.path)!).filter(([key]) => ['bytes', 'mediaType'].includes(key))) })) };
  });
  app.get('/api/v1/versions/:versionId/evidence/:evidenceId', async (request, reply) => {
    const version = ownVersion(param(request, 'versionId'), authorize(request));
    const evidence = version.manifest.evidence.find((entry) => entry.id === param(request, 'evidenceId'));
    if (!evidence) fail(404, 'NOT_FOUND', 'Evidence not found');
    const mime = evidence!.kind === 'screenshot' && evidence!.path.endsWith('.png') ? 'image/png' : 'text/plain; charset=utf-8';
    return reply.type(mime).send(await readStored(version, evidence!.path));
  });
  app.get('/api/v1/versions/:versionId/source.zip', async (request, reply) => {
    const version = ownVersion(param(request, 'versionId'), authorize(request)); const files: Record<string, Uint8Array> = {};
    for (const file of version.manifest.files.filter((entry) => entry.path.startsWith('source/'))) files[file.path.slice(7)] = await readStored(version, file.path);
    return reply.header('Content-Disposition', `attachment; filename="${version.dto.id}.zip"`).type('application/zip').send(Buffer.from(zipSync(files)));
  });
  app.get('/internal/v1/input-artifacts/:artifactId/manifest', (request, reply) => {
    const version = store.state.versions.find((entry) => entry.artifactId === param(request, 'artifactId'));
    if (!version) fail(404, 'NOT_FOUND', 'Artifact not found');
    return reply.type('application/json').send(version!.manifestRaw);
  });
  app.get('/internal/v1/input-artifacts/:artifactId/file', async (request, reply) => {
    const version = store.state.versions.find((entry) => entry.artifactId === param(request, 'artifactId'));
    if (!version) fail(404, 'NOT_FOUND', 'Artifact not found');
    return reply.type('application/octet-stream').send(await readStored(version!, query(request).path ?? ''));
  });

  const mediaType = (path: string) => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }[extname(path)] ?? 'application/octet-stream');
  preview.get('/p/:token/*', async (request, reply) => {
    const token = param(request, 'token'); const [payload, signature] = token.split('.');
    const expected = createHmac('sha256', options.previewSecret).update(payload ?? '').digest('base64url');
    if (!signature || !safeSecretEqual(signature, expected)) return reply.code(403).send('Invalid preview token');
    let decoded: { versionId: string; exp: number };
    try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return reply.code(403).send('Invalid preview token'); }
    if (!Number.isFinite(decoded.exp) || decoded.exp < Date.now()) return reply.code(403).send('Preview expired');
    const version = store.state.versions.find((entry) => entry.dto.id === decoded.versionId);
    if (!version) return reply.code(404).send('Preview not found');
    const path = param(request, '*') || 'index.html';
    if (!RelativePath.safeParse(path).success || !version.manifest.files.some((entry) => entry.path === `dist/${path}`)) return reply.code(404).send('File not found');
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
    return reply.type(mediaType(path)).send(await readStored(version, `dist/${path}`));
  });

  const runtime = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${options.agentUrl.replace(/\/$/, '')}${path}`, { method, headers: authHeaders,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Runtime HTTP ${response.status}`);
    return response;
  };
  const finish = (record: RunRecord, status: 'failed'|'cancelled'|'interrupted', code?: string, message?: string) => {
    updateRun(record, { status, pendingAttention: null, pendingAnswer: null,
      error: code ? { code: code as 'INTERNAL_ERROR', message: message ?? code } : null });
    release(record);
  };
  const publish = async (record: RunRecord, artifactId: string) => {
    if (!record.manifestHash) throw new Error('Missing artifact.ready manifest hash');
    const executionId = record.dto.executionId!;
    const prefix = `/internal/v1/executions/${executionId}/artifacts/${artifactId}`;
    const manifestRaw = await (await runtime(`${prefix}/manifest`)).text();
    if (hash(manifestRaw) !== record.manifestHash) throw new Error('Manifest hash mismatch');
    const manifest = ArtifactManifest.parse(JSON.parse(manifestRaw));
    if (manifest.id !== artifactId || manifest.executionId !== executionId || manifest.runId !== record.dto.id || manifest.baseVersionId !== record.dto.baseVersionId) throw new Error('Artifact ownership mismatch');
    if (manifest.files.length > 2000 || manifest.files.reduce((sum, entry) => sum + entry.bytes, 0) > (record.request?.budget.maxArtifactBytes ?? 20971520)) throw new Error('Artifact too large');
    for (const file of manifest.files) {
      if (!/^(source|dist|evidence)\//.test(file.path) || /(^|\/)(\.env(?:\..*)?|node_modules|\.git|\.dsh)(\/|$)/.test(file.path)) throw new Error('Forbidden artifact path');
    }
    const versionId = id('version'); const staging = join(dataDir, 'versions', `${versionId}.staging`); const directory = join(dataDir, 'versions', versionId);
    await mkdir(staging, { recursive: true });
    try {
      for (const file of manifest.files) {
        const response = await runtime(`${prefix}/file?path=${encodeURIComponent(file.path)}`);
        const chunks: Uint8Array[] = []; let received = 0;
        if (!response.body) throw new Error('Missing artifact body');
        const reader = response.body.getReader();
        while (true) {
          const next = await reader.read(); if (next.done) break;
          received += next.value.byteLength;
          if (received > file.bytes) { await reader.cancel(); throw new Error('Artifact exceeds declared size'); }
          chunks.push(next.value);
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.byteLength !== file.bytes || hash(bytes) !== file.sha256) throw new Error('Artifact checksum mismatch');
        const target = join(staging, file.path); await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' });
      }
      await rename(staging, directory);
      store.transaction(() => {
        const current = store.state.runs.find((entry) => entry.dto.id === record.dto.id)!;
        const project = store.state.projects.find((entry) => entry.dto.id === current.dto.projectId)!;
        if (current.dto.status === 'cancelling') { finish(current, 'cancelled'); return; }
        if (terminal(current.dto.status) || current.dto.executionId !== executionId || project.dto.activeRunId !== current.dto.id || project.dto.currentVersionId !== current.dto.baseVersionId) throw new Error('Publication fence mismatch');
        const expiresAt = new Date(Date.now() + 7200000).toISOString();
        const version: VersionDto = { id: versionId, projectId: project.dto.id, parentVersionId: project.dto.currentVersionId,
          restoredFromVersionId: null, runId: current.dto.id, summary: manifest.summary, checks: manifest.checks,
          previewUrl: signedPreview(versionId, expiresAt), previewExpiresAt: expiresAt, createdAt: now() };
        store.state.versions.push({ dto: version, artifactId, manifest, manifestRaw, directory });
        project.dto = { ...project.dto, revision: project.dto.revision + 1, currentVersionId: versionId, activeRunId: null, updatedAt: now() };
        emit(project.dto.id, current.dto.id, { type: 'version.published', payload: { project: project.dto, version } });
        updateRun(current, { status: 'succeeded', phase: 'publishing', resultVersionId: versionId, checks: manifest.checks, pendingAttention: null, pendingAnswer: null });
      });
    } finally { await rm(staging, { recursive: true, force: true }); }
  };
  const ingest = async (reference: RunRecord, source: AgentEventDto) => {
    const record = store.state.runs.find((entry) => entry.dto.id === reference.dto.id)!;
    if (source.executionId !== record.dto.executionId || source.runId !== record.dto.id) throw new Error('Source event ownership mismatch');
    if (source.sourceSeq <= record.sourceSeq) return;
    if (source.sourceSeq !== record.sourceSeq + 1) throw new Error('Source event sequence gap');
    let artifactToPublish: string | undefined;
    store.transaction(() => {
      const event = source.event;
      if (terminal(record.dto.status)) { record.sourceSeq = source.sourceSeq; return; }
      store.state.sourceEvents.push(source);
      emit(record.dto.projectId, record.dto.id, { type: 'activity.recorded', payload: event }, source.occurredAt);
      const cancelling = record.dto.status === 'cancelling';
      if (event.type === 'execution.started') record.started = true;
      if (event.type === 'execution.updated' && !cancelling) {
        const state = event.payload;
        if (!terminal(state.status)) updateRun(record, { status: state.status === 'accepted' ? 'queued' : state.status,
          phase: state.phase, pendingAttention: state.pendingAttention,
          pendingAnswer: state.status === 'accepted' && record.dto.pendingAnswer ? { ...record.dto.pendingAnswer, status: 'accepted' } : record.dto.pendingAnswer });
      }
      if (event.type === 'phase.changed' && !cancelling) updateRun(record, { status: 'running', phase: event.payload.phase, pendingAttention: null });
      if (event.type === 'attention.created' && !cancelling) updateRun(record, { status: 'waiting_input', pendingAttention: event.payload, pendingAnswer: null });
      if (event.type === 'attention.resolved' && !cancelling) updateRun(record, { status: 'queued', pendingAttention: null,
        pendingAnswer: record.dto.pendingAnswer ? { ...record.dto.pendingAnswer, status: 'accepted' } : null });
      if (event.type === 'check.completed' && !cancelling) updateRun(record, { checks: [...record.dto.checks.filter((check) => check.id !== event.payload.id), event.payload] });
      if (event.type === 'message.delta' || event.type === 'message.completed') {
        let message = store.state.messages.find((entry) => entry.id === event.payload.messageId && entry.projectId === record.dto.projectId);
        if (!message) { message = { id: event.payload.messageId, projectId: record.dto.projectId, runId: record.dto.id, role: 'assistant', status: 'streaming', content: '', createdAt: source.occurredAt }; store.state.messages.push(message); }
        if (event.type === 'message.delta') message.content += event.payload.delta;
        else { message.content = event.payload.content; message.status = 'complete'; }
        emit(record.dto.projectId, record.dto.id, { type: 'message.updated', payload: message }, source.occurredAt);
      }
      if (event.type === 'artifact.ready') record.manifestHash = event.payload.manifestSha256;
      if (event.type === 'execution.completed') {
        if (cancelling) finish(record, 'cancelled');
        else { updateRun(record, { status: 'running', phase: 'publishing', pendingAttention: null, pendingAnswer: null }); artifactToPublish = event.payload.artifactId; }
      }
      if (event.type === 'execution.failed') finish(record, cancelling ? 'cancelled' : 'failed', cancelling ? undefined : event.payload.code, event.payload.message);
      if (event.type === 'execution.cancelled') finish(record, 'cancelled');
      if (event.type === 'execution.interrupted') finish(record, cancelling ? 'cancelled' : 'interrupted', cancelling ? undefined : 'EXECUTION_INTERRUPTED', event.payload.reason);
      record.sourceSeq = source.sourceSeq;
    });
    if (artifactToPublish) {
      try { await publish(record, artifactToPublish); }
      catch { store.transaction(() => { const current = store.state.runs.find((entry) => entry.dto.id === record.dto.id)!; if (!terminal(current.dto.status)) finish(current, current.dto.status === 'cancelling' ? 'cancelled' : 'failed', 'ARTIFACT_INVALID', '候选产物未通过完整性校验'); }); }
    }
  };
  const tick = async () => {
    if (busy || closed) return; busy = true;
    try {
      let runtimeReady = false;
      try { runtimeReady = Boolean((await (await runtime('/internal/v1/health')).json() as { ready: boolean }).ready); }
      catch {
        for (const record of store.state.runs.filter((entry) => !terminal(entry.dto.status))) reportRuntimeConnection(record.dto.id, false);
        // Existing work still retains its lock. A health error is not a stop confirmation.
      }
      for (const project of runtimeReady ? store.state.projects : []) {
        if (project.dto.activeRunId) continue;
        const record = store.state.runs.find((entry) => entry.dto.projectId === project.dto.id && entry.dto.status === 'queued' && !entry.dto.executionId);
        if (!record) continue;
        store.transaction(() => {
          const base = store.state.versions.find((entry) => entry.dto.id === project.dto.currentVersionId);
          const executionId = id('execution');
          record.request = { protocolVersion: PROTOCOL_VERSION, executionId, runId: record.dto.id, projectId: project.dto.id,
            attempt: 1, prompt: record.prompt, mode: record.dto.mode, baseVersionId: project.dto.currentVersionId,
            input: base ? { kind: 'version', versionId: base.dto.id, artifactId: base.artifactId, manifestSha256: hash(base.manifestRaw) } : { kind: 'template', templateId: 'react-vite-v1' },
            mandate: { scope: 'react_frontend', allowDependencyChanges: false, allowPublicDeployment: false, allowExternalMessaging: false,
              projectMemory: base?.dto.summary ?? '' },
            budget: { maxWallTimeMs: 600000, maxWaitingInputMs: 86400000, maxRepairRounds: 2, maxModelSteps: 30, maxInputTokens: 100000,
              maxOutputTokens: 30000, maxArtifactBytes: 20971520 } };
          project.dto.activeRunId = record.dto.id;
          updateRun(record, { executionId, baseVersionId: project.dto.currentVersionId });
        });
      }
      for (const reference of store.state.runs.filter((entry) => entry.dto.executionId && !terminal(entry.dto.status))) {
        let record = store.state.runs.find((entry) => entry.dto.id === reference.dto.id)!;
        const path = `/internal/v1/executions/${record.dto.executionId}`;
        try {
          // PUT is an idempotent outbox delivery, including after response loss or API restart.
          await runtime(path, 'PUT', record.request);
          record = store.state.runs.find((entry) => entry.dto.id === reference.dto.id)!;
          if (record.cancelCommand) { await runtime(`${path}/cancel`, 'POST', record.cancelCommand); store.transaction(() => { store.state.runs.find((entry) => entry.dto.id === reference.dto.id)!.cancelCommand = undefined; }); }
          else if (record.answerCommand) {
            await runtime(`${path}/inputs`, 'POST', record.answerCommand);
            store.transaction(() => { store.state.runs.find((entry) => entry.dto.id === reference.dto.id)!.answerCommand = undefined; });
          }
          const page = AgentEventPage.parse(await (await runtime(`${path}/events?after=${record.sourceSeq}&limit=100`)).json());
          for (const event of page.items) await ingest(record, AgentEvent.parse(event));
          record = store.state.runs.find((entry) => entry.dto.id === reference.dto.id)!;
          // Recover publication if API died after recording completed but before creating version.
          if (!terminal(record.dto.status) && record.dto.phase === 'publishing') {
            const snapshot = ExecutionSnapshot.parse(await (await runtime(path)).json());
            if (snapshot.status === 'succeeded' && snapshot.artifactId) await publish(record, snapshot.artifactId);
          }
          reportRuntimeConnection(record.dto.id, true);
        } catch {
          reportRuntimeConnection(record.dto.id, false);
          // Keep identity, pending commands and project lock; retry the same outbox next tick.
        }
      }
    } finally { busy = false; }
  };
  const seedCode = (code: string, limits = { projectLimit: 3, runLimit: 10 }) => store.transaction(() => {
    const existing = store.state.codes.find((entry) => entry.hash === hash(code)); if (existing) return existing.id;
    const record: Code = { id: id('code'), hash: hash(code), expiresAt: new Date(Date.now() + 604800000).toISOString(), revoked: false, ...limits };
    store.state.codes.push(record); return record.id;
  });
  if (options.demoCode) seedCode(options.demoCode);
  const timer = options.autoSchedule === false ? null : setInterval(() => { void tick(); }, options.pollMs ?? 500);
  timer?.unref();
  const close = async () => { closed = true; if (timer) clearInterval(timer); while (busy) await new Promise((resolve) => setTimeout(resolve, 10)); await app.close(); await preview.close(); store.close(); };
  return { app, preview, tick, close, seedCode, store };
}
