import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import {
  PROTOCOL_VERSION, StartExecutionRequest, AgentInputRequest, CancelExecutionRequest,
  type AgentEventDto, type ExecutionSnapshotDto, type StartExecutionDto, type ArtifactManifestDto,
} from '@atoms/contracts';

const now = () => new Date().toISOString();
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);

/** Deliberate HTTP test double. It never calls a model or claims a real build. */
export function createFakeRuntime(serviceToken = 'test-service-token') {
  const app = Fastify();
  const executions = new Map<string, { request: StartExecutionDto; snapshot: ExecutionSnapshotDto; events: AgentEventDto[];
    commands: Map<string, string>; files: Record<string, Buffer>; manifest?: ArtifactManifestDto; raw?: string }>();
  let calls = 0; let corruptArtifact = false; let dropStartOnce = false; let unavailable = false;
  const emit = (executionId: string, event: AgentEventDto['event']) => {
    const entry = executions.get(executionId)!;
    const sourceSeq = entry.events.length + 1;
    entry.events.push({ protocolVersion: PROTOCOL_VERSION, executionId, runId: entry.request.runId, sourceSeq, occurredAt: now(), event: clone(event) });
    entry.snapshot.lastSourceSeq = sourceSeq;
  };
  const update = (executionId: string, changes: Partial<ExecutionSnapshotDto>) => {
    const entry = executions.get(executionId)!;
    entry.snapshot = { ...entry.snapshot, ...changes, revision: entry.snapshot.revision + 1, updatedAt: now() };
    emit(executionId, { type: 'execution.updated', payload: clone(entry.snapshot) });
  };
  const complete = (executionId: string) => {
    const entry = executions.get(executionId)!; const artifactId = `artifact_${executionId.slice(10)}`;
    const files: Record<string, Buffer> = {
      'source/package.json': Buffer.from('{"name":"fake-runtime-fixture","private":true}'),
      'source/src/App.tsx': Buffer.from('export default function App(){return <main>Fake Runtime fixture</main>}'),
      'dist/index.html': Buffer.from('<!doctype html><html><body><h1>Fake Runtime fixture</h1><button onclick="this.textContent=\'Clicked\'">Click</button></body></html>'),
    };
    const checks = (['typecheck', 'build', 'smoke'] as const).map((kind) => {
      const evidenceId = `evidence_${kind}`; const path = `evidence/${kind}.txt`;
      files[path] = Buffer.from(`Fake Runtime fixture: ${kind}; not a real compiler/browser result.`);
      return { id: `check_${kind}`, kind, name: kind, required: true, status: 'passed' as const,
        summary: 'Synthetic HTTP fixture only; not a real build.', evidenceIds: [evidenceId] };
    });
    entry.manifest = { protocolVersion: PROTOCOL_VERSION, id: artifactId, executionId, runId: entry.request.runId,
      baseVersionId: entry.request.baseVersionId, summary: 'Fake Runtime fixture — no model invoked',
      files: Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.byteLength, sha256: sha(bytes), mediaType: path.endsWith('.html') ? 'text/html' : 'text/plain' })),
      checks, evidence: checks.map((check) => ({ id: check.evidenceIds[0], path: `evidence/${check.kind}.txt`, kind: 'log' as const })), createdAt: now() };
    entry.files = files; entry.raw = JSON.stringify(entry.manifest);
    for (const check of checks) emit(executionId, { type: 'check.completed', payload: check });
    emit(executionId, { type: 'artifact.ready', payload: { artifactId, manifestSha256: sha(entry.raw) } });
    update(executionId, { status: 'succeeded', phase: 'verifying', artifactId });
    emit(executionId, { type: 'execution.completed', payload: { artifactId } });
  };
  const started = (executionId: string) => {
    const entry = executions.get(executionId)!;
    emit(executionId, { type: 'execution.started', payload: {} });
    update(executionId, { status: 'running', phase: 'planning' });
    if (entry.request.mode === 'plan') {
      const attention = { id: `attention_${executionId.slice(10)}`, runId: entry.request.runId, revision: 1,
        kind: 'plan_confirmation' as const, title: '确认测试计划', description: 'Synthetic fixture', options: [], allowText: false,
        plan: { summary: 'Fixture plan', tasks: ['Build fixture'], acceptance: [{ id: 'acceptance_demo', description: 'Fixture only' }] }, createdAt: now() };
      update(executionId, { status: 'waiting_input', pendingAttention: attention });
      emit(executionId, { type: 'attention.created', payload: attention });
    } else if (!entry.request.prompt.includes('[hold]')) complete(executionId);
  };
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${serviceToken}`) return reply.code(401).send({ error: 'unauthorized' });
    if (unavailable) return reply.code(503).send({ error: 'Injected runtime outage' });
  });
  app.get('/internal/v1/health', async () => ({ protocolVersion: PROTOCOL_VERSION, ready: true,
    capabilities: { templates: ['react-vite-v1'], cancel: true, attention: true, artifacts: true } }));
  app.put('/internal/v1/executions/:executionId', (request, reply) => {
    const body = StartExecutionRequest.parse(request.body); const executionId = (request.params as { executionId: string }).executionId;
    if (body.executionId !== executionId) return reply.code(400).send({ error: 'id mismatch' });
    const previous = executions.get(executionId);
    if (previous) {
      if (JSON.stringify(previous.request) !== JSON.stringify(body)) return reply.code(409).send({ error: 'conflict' });
      return previous.snapshot;
    }
    calls++;
    executions.set(executionId, { request: body, events: [], commands: new Map(), files: {}, snapshot: {
      protocolVersion: PROTOCOL_VERSION, id: executionId, runId: body.runId, status: 'accepted', phase: null,
      revision: 1, lastSourceSeq: 0, pendingAttention: null, artifactId: null, updatedAt: now(),
    } });
    started(executionId);
    if (dropStartOnce) { dropStartOnce = false; return reply.code(503).send({ error: 'Injected response loss after acceptance' }); }
    return reply.code(201).send(executions.get(executionId)!.snapshot);
  });
  app.get('/internal/v1/executions/:executionId', (request, reply) => {
    const entry = executions.get((request.params as { executionId: string }).executionId);
    return entry ? entry.snapshot : reply.code(404).send({ error: 'not found' });
  });
  app.get('/internal/v1/executions/:executionId/events', (request, reply) => {
    const entry = executions.get((request.params as { executionId: string }).executionId);
    if (!entry) return reply.code(404).send({ error: 'not found' });
    const q = request.query as { after?: string; limit?: string }; const after = Number(q.after ?? 0); const limit = Number(q.limit ?? 100);
    const rows = entry.events.filter((event) => event.sourceSeq > after); const items = rows.slice(0, limit);
    return { items, nextCursor: items.at(-1)?.sourceSeq ?? after, hasMore: rows.length > items.length };
  });
  app.post('/internal/v1/executions/:executionId/inputs', (request, reply) => {
    const executionId = (request.params as { executionId: string }).executionId; const entry = executions.get(executionId);
    if (!entry) return reply.code(404).send({ error: 'not found' });
    const body = AgentInputRequest.parse(request.body); const old = entry.commands.get(body.commandId);
    if (old && old !== JSON.stringify(body)) return reply.code(409).send({ error: 'conflict' });
    if (old) return reply.code(202).send(entry.snapshot);
    if (entry.snapshot.pendingAttention?.id !== body.attentionId || entry.snapshot.pendingAttention.revision !== body.expectedRevision) return reply.code(409).send({ error: 'stale' });
    entry.commands.set(body.commandId, JSON.stringify(body));
    emit(executionId, { type: 'attention.resolved', payload: { attentionId: body.attentionId } });
    update(executionId, { status: 'accepted', pendingAttention: null });
    update(executionId, { status: 'running', phase: 'generating' }); complete(executionId);
    return reply.code(202).send(entry.snapshot);
  });
  app.post('/internal/v1/executions/:executionId/cancel', (request, reply) => {
    const executionId = (request.params as { executionId: string }).executionId; const entry = executions.get(executionId);
    if (!entry) return reply.code(404).send({ error: 'not found' });
    CancelExecutionRequest.parse(request.body);
    if (!['succeeded', 'failed', 'cancelled'].includes(entry.snapshot.status)) {
      update(executionId, { status: 'cancelled', pendingAttention: null }); emit(executionId, { type: 'execution.cancelled', payload: {} });
    }
    return reply.code(202).send(entry.snapshot);
  });
  app.get('/internal/v1/executions/:executionId/artifacts/:artifactId/manifest', (request, reply) => {
    const { executionId, artifactId } = request.params as { executionId: string; artifactId: string }; const entry = executions.get(executionId);
    if (!entry?.manifest || entry.manifest.id !== artifactId) return reply.code(404).send({ error: 'not found' });
    return reply.type('application/json').send(entry.raw);
  });
  app.get('/internal/v1/executions/:executionId/artifacts/:artifactId/file', (request, reply) => {
    const { executionId, artifactId } = request.params as { executionId: string; artifactId: string }; const entry = executions.get(executionId);
    const path = (request.query as { path?: string }).path ?? '';
    if (!entry?.manifest || entry.manifest.id !== artifactId || !entry.files[path]) return reply.code(404).send({ error: 'not found' });
    return reply.type('application/octet-stream').send(corruptArtifact ? Buffer.from('corrupt') : entry.files[path]);
  });
  return { app, executions, get startCalls() { return calls; }, complete,
    setCorruptArtifact(value: boolean) { corruptArtifact = value; }, loseNextStartResponse() { dropStartOnce = true; },
    setUnavailable(value: boolean) { unavailable = value; }, emit };
}
