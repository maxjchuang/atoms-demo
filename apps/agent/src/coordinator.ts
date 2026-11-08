import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  COORDINATION_DEFAULTS, CoordinationCancelRequest, CoordinationExecutionSnapshot, CoordinationProtocolVersion,
  CoordinationSourceEvent, RouterMemory, StartCoordinationRequest,
  type CoordinationExecutionSnapshotDto, type CoordinationSourceEventDto, type StartCoordinationRequestDto,
} from '@atoms/contracts/conversation';
import { sha256 } from './files.js';
import { StructuredOutputError } from './structured-output.js';
import {
  canonicalJson, CoordinationError, readPublishedSources, settleDecision, usedContext, validateContext,
  type SemanticDecision, type SourceRead,
} from './coordination-context.js';
import { DshCoordinatorAdapter, FakeCoordinatorAdapter, type CoordinatorAdapter, type CoordinationModelContext } from './coordinator-adapters.js';
import { ProjectSessionFence } from './project-session-fence.js';

type CoordinatorRecord = {
  request: StartCoordinationRequestDto; requestHash: string; order: number;
  snapshot: CoordinationExecutionSnapshotDto; events: CoordinationSourceEventDto[];
  commands: Record<string, { hash: string; snapshot: CoordinationExecutionSnapshotDto }>;
};
type SourceBody = CoordinationSourceEventDto['event'];
const now = () => new Date().toISOString();
const terminal = new Set(['completed', 'cancelled', 'failed', 'interrupted']);
export interface CoordinatorOptions {
  dataDir: string; serviceToken: string; apiInternalUrl?: string; mode?: 'fake' | 'dsh';
  apiKey?: string; model?: string; coordinatorAdapter?: CoordinatorAdapter;
}
export class CoordinatorRuntime {
  readonly adapter: CoordinatorAdapter;
  readonly records = new Map<string, CoordinatorRecord>();
  private controllers = new Map<string, AbortController>();
  private memories = new Map<string, ReturnType<typeof RouterMemory.parse>>();
  private excludedTurns = new Set<string>();
  private pumping: Promise<void> | null = null;
  private closed = false;
  private root: string;
  constructor(readonly options: CoordinatorOptions) {
    this.root = path.join(options.dataDir, 'coordination'); mkdirSync(this.root, { recursive: true });
    this.adapter = options.coordinatorAdapter || (options.mode === 'fake' ? new FakeCoordinatorAdapter()
      : new DshCoordinatorAdapter({ apiKey: options.apiKey, model: options.model }));
    if (existsSync(this.ledgerPath())) {
      const saved = JSON.parse(readFileSync(this.ledgerPath(), 'utf8')) as { records: CoordinatorRecord[]; memories: ReturnType<typeof RouterMemory.parse>[]; excludedTurns?: string[] };
      this.excludedTurns = new Set(saved.excludedTurns || []);
      for (const memory of saved.memories) this.memories.set(memory.projectId, RouterMemory.parse(memory));
      for (const record of saved.records) {
        StartCoordinationRequest.parse(record.request); CoordinationExecutionSnapshot.parse(record.snapshot);
        this.records.set(record.request.turnId, record);
        if (!terminal.has(record.snapshot.status) && record.snapshot.status !== 'accepted') {
          record.snapshot.status = 'interrupted'; record.snapshot.result = null;
          this.excludedTurns.add(record.request.turnId);
          new ProjectSessionFence(path.join(this.root, 'projects', record.request.projectId, 'dsh')).invalidate();
          record.snapshot.error = { code: 'INFERENCE_INTERRUPTED', message: '协调服务重启，未确认的推理不会自动重跑。', retryable: false };
          this.emit(record, { type: 'coordination.interrupted', payload: record.snapshot.error });
        }
      }
    }
    this.schedule();
  }
  private ledgerPath() { return path.join(this.root, 'turns.json'); }
  private persist() {
    const file = this.ledgerPath();
    writeFileSync(file + '.tmp', JSON.stringify({ records: [...this.records.values()], memories: [...this.memories.values()], excludedTurns: [...this.excludedTurns] }));
    renameSync(file + '.tmp', file);
  }
  private emit(record: CoordinatorRecord, event: SourceBody) {
    record.snapshot.lastSourceSeq = record.events.length + 1; record.snapshot.updatedAt = now();
    record.events.push(CoordinationSourceEvent.parse({ protocolVersion: CoordinationProtocolVersion,
      projectId: record.request.projectId, turnId: record.request.turnId,
      sourceSeq: record.snapshot.lastSourceSeq, occurredAt: now(), event }));
    this.persist();
  }
  get(id: string) {
    const record = this.records.get(id);
    if (!record) throw new CoordinationError(404, 'NOT_FOUND', 'Coordination turn not found');
    return record;
  }
  start(raw: unknown, pathId: string) {
    const request = StartCoordinationRequest.parse(raw);
    if (request.turnId !== pathId) throw new CoordinationError(400, 'INVALID_REQUEST', 'Coordination turn ID mismatch');
    validateContext(request);
    const requestHash = sha256(canonicalJson(request)); const previous = this.records.get(pathId);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new CoordinationError(409, 'CONFLICT', 'Turn ID already has a different immutable request');
      return { created: false, snapshot: structuredClone(previous.snapshot) };
    }
    if (!this.adapter.ready()) throw new CoordinationError(503, 'RUNTIME_UNAVAILABLE', 'Project Router credentials are not configured');
    if ([...this.records.values()].filter((record) => record.request.projectId === request.projectId && !terminal.has(record.snapshot.status)).length >= COORDINATION_DEFAULTS.maxPendingTurnsPerProject) {
      throw new CoordinationError(429, 'RATE_LIMITED', 'Project Router queue is full');
    }
    const record: CoordinatorRecord = { request, requestHash, order: Date.now(), events: [], commands: {},
      snapshot: { protocolVersion: CoordinationProtocolVersion, id: request.turnId, projectId: request.projectId,
        revision: 1, status: 'accepted', lastSourceSeq: 0, contextUsed: usedContext(request), result: null, error: null,
        usage: { modelSteps: 0, inputTokens: null, outputTokens: null }, updatedAt: now() } };
    this.records.set(pathId, record); this.emit(record, { type: 'coordination.accepted', payload: {} });
    const snapshot = structuredClone(record.snapshot); this.schedule(); return { created: true, snapshot };
  }
  events(id: string, after: number, limit: number) {
    const record = this.get(id); const items = record.events.filter((event) => event.sourceSeq > after).slice(0, limit);
    const nextCursor = items.at(-1)?.sourceSeq ?? after;
    return { items: structuredClone(items), nextCursor, hasMore: record.events.some((event) => event.sourceSeq > nextCursor) };
  }
  async cancel(id: string, raw: unknown) {
    const request = CoordinationCancelRequest.parse(raw); const record = this.get(id); const hash = sha256(canonicalJson(request));
    const previous = record.commands[request.commandId];
    if (previous) {
      if (previous.hash !== hash) throw new CoordinationError(409, 'CONFLICT', 'Command ID already used');
      return structuredClone(previous.snapshot);
    }
    // API may cancel after native completion but before its own admission transaction.
    // Invalidate technical history even if the immutable Agent result is already terminal.
    this.excludedTurns.add(id);
    new ProjectSessionFence(path.join(this.root, 'projects', record.request.projectId, 'dsh')).invalidate();
    await this.adapter.invalidate?.(record.request.projectId);
    if (!terminal.has(record.snapshot.status)) {
      record.snapshot.status = 'cancelling'; record.snapshot.revision++;
      this.emit(record, { type: 'coordination.progress', payload: { messageId: `message_${randomUUID().replaceAll('-', '')}`, content: '正在停止本次协调问答；不会停止已有构建任务。' } });
      const controller = this.controllers.get(id);
      if (controller) controller.abort('cancel');
      else {
        record.snapshot.status = 'cancelled'; record.snapshot.revision++;
        this.emit(record, { type: 'coordination.cancelled', payload: {} });
      }
    }
    record.commands[request.commandId] = { hash, snapshot: structuredClone(record.snapshot) }; this.persist();
    return structuredClone(record.snapshot);
  }
  private schedule() {
    if (this.closed || this.pumping) return;
    this.pumping = new Promise<void>((resolve) => setImmediate(resolve)).then(async () => {
      while (!this.closed) {
        const next = [...this.records.values()].filter((record) => record.snapshot.status === 'accepted').sort((a, b) => a.order - b.order)[0];
        if (!next) break;
        await this.process(next);
      }
    }).finally(() => { this.pumping = null;
      if (!this.closed && [...this.records.values()].some((record) => record.snapshot.status === 'accepted')) this.schedule(); });
  }
  private async process(record: CoordinatorRecord) {
    const request = record.request; const controller = new AbortController(); this.controllers.set(request.turnId, controller);
    const timer = setTimeout(() => controller.abort('budget'), request.budget.maxWallTimeMs);
    const report = (content: string) => {
      if (controller.signal.aborted || terminal.has(record.snapshot.status)) return;
      this.emit(record, { type: 'coordination.progress', payload: { messageId: `message_${randomUUID().replaceAll('-', '')}`, content } });
    };
    const context: CoordinationModelContext = { request, signal: controller.signal,
      projectHome: path.join(this.root, 'projects', request.projectId, 'dsh'),
      stableWorkspace: path.join(this.root, 'projects', request.projectId, 'context'), sources: [], report,
      remainingOutputTokens: () => request.budget.maxOutputTokens - (record.snapshot.usage.outputTokens || 0),
      excludedTurnIds: this.excludedTurns,
      meter: (usage) => {
        for (const key of ['modelSteps', 'inputTokens', 'outputTokens'] as const) {
          const amount = usage[key];
          if (amount === undefined) continue;
          if (!Number.isSafeInteger(amount) || amount < 0) throw new CoordinationError(400, 'INVALID_REQUEST', 'Invalid model usage metadata');
          record.snapshot.usage[key] = (record.snapshot.usage[key] || 0) + amount;
        }
        this.persist();
        const used = record.snapshot.usage;
        if (used.modelSteps > request.budget.maxModelSteps || (used.inputTokens || 0) > request.budget.maxInputTokens
          || (used.outputTokens || 0) > request.budget.maxOutputTokens) {
          controller.abort('budget'); throw new CoordinationError(400, 'BUDGET_EXCEEDED', 'Project Router budget exceeded');
        }
      },
    };
    try {
      record.snapshot.status = 'running'; record.snapshot.revision++;
      this.emit(record, { type: 'coordination.started', payload: {} });
      const memory = this.memories.get(request.projectId);
      if (memory && request.context.projectMemory.revision < memory.revision) throw new CoordinationError(409, 'STALE_REVISION', 'Project memory snapshot is older than the last coordinated context');
      let decision: SemanticDecision;
      const operation = request.operation;
      if (operation.kind === 'message' && ['status', 'sharing_help'].includes(operation.input.kind)) {
        record.snapshot.usage.inputTokens = 0; record.snapshot.usage.outputTokens = 0;
        if (operation.input.kind === 'status') {
          const target = operation.input.targetRunId;
          const index = target ? request.context.facts.runs.findIndex((run) => run.id === target) : -1;
          if (target && index < 0) throw new CoordinationError(404, 'NOT_FOUND', 'Requested task is not in the authorized status snapshot');
          decision = { kind: 'status', answer: request.context.facts.runs.length
            ? '任务状态以本次可信快照为准。' : '当前没有正在运行的任务。',
            ...(target ? { targetRuns: [`r${index}`] } : {}), references: [], memoryUpdates: [] };
        }
        else decision = { kind: 'consult', answer: request.context.facts.deployment.publicDeployment
          ? '已具备公开部署能力，请使用界面提供的分享操作。' : '当前预览仅限本机，尚不能作为公网链接分享。可下载源码，公网分享需完成部署。',
          references: request.context.facts.availableActions.map((_item, index) => ({ kind: 'available_action', ref: `a${index}` })), memoryUpdates: [] };
        report('已依据服务端当前能力和任务事实整理回复，未调用模型。');
      } else {
        let retries = 0; let sourcePass = false;
        while (true) {
          if (controller.signal.aborted) throw new Error('Coordination aborted');
          try { decision = await this.adapter.decide(context, retries > 0); }
          catch (error) {
            if (!(error instanceof StructuredOutputError) || retries >= request.budget.maxStructuredRetries) throw error;
            retries++; report(`协调模型结构化结果不完整，开始有界重试（${retries}/${request.budget.maxStructuredRetries}）。`); continue;
          }
          if (decision.kind !== 'read_sources') break;
          if (sourcePass) throw new CoordinationError(400, 'BUDGET_EXCEEDED', 'Only one bounded source-read pass is allowed');
          sourcePass = true;
          if (!Array.isArray(decision.paths) || decision.paths.some((item) => typeof item !== 'string')) throw new CoordinationError(400, 'INVALID_REQUEST', 'Invalid source selection');
          const paths = decision.paths as string[];
          if (paths.length > COORDINATION_DEFAULTS.maxSourceFiles) throw new CoordinationError(400, 'BUDGET_EXCEEDED', 'Source file policy exceeded');
          report('正在核对发布版本的源码读取范围、完整性和预算。');
          const sourceRequest = { ...request, budget: { ...request.budget,
            maxSourceFiles: Math.min(request.budget.maxSourceFiles, COORDINATION_DEFAULTS.maxSourceFiles),
            maxSourceBytes: Math.min(request.budget.maxSourceBytes, COORDINATION_DEFAULTS.maxSourceBytes) } };
          context.sources = await readPublishedSources(sourceRequest, paths, this.options.apiInternalUrl, this.options.serviceToken, controller.signal);
          report(`已核验 ${context.sources.length} 个发布版本源码文件；源码只作为解释依据。`);
        }
      }
      if (controller.signal.aborted) throw new Error('Coordination aborted');
      const result = settleDecision(request, decision!, context.sources, this.excludedTurns);
      record.snapshot.result = result; record.snapshot.status = 'completed'; record.snapshot.revision++;
      this.memories.set(request.projectId, RouterMemory.parse({ projectId: request.projectId,
        revision: request.context.projectMemory.revision, summary: request.context.projectMemory.summary,
        decisionIds: request.context.projectMemory.decisions.filter((item) => item.status === 'active').map((item) => item.id),
        summaryThroughHistorySeq: Math.max(0, ...request.context.recentMessages.map((item) => item.historySeq)),
        consumedConversationRevision: request.context.conversationRevision, lastCompletedTurnId: request.turnId, updatedAt: now() }));
      this.emit(record, { type: 'coordination.completed', payload: result });
      await this.adapter.commit?.(request.projectId, request.turnId).catch(() => {});
    } catch (error) {
      await this.adapter.close(request.turnId).catch(() => {});
      this.excludedTurns.add(request.turnId);
      new ProjectSessionFence(path.join(this.root, 'projects', request.projectId, 'dsh')).invalidate();
      await this.adapter.invalidate?.(request.projectId).catch(() => {});
      record.snapshot.result = null; record.snapshot.revision++;
      if (record.snapshot.status === 'cancelling' || this.closed) {
        record.snapshot.status = 'cancelled'; record.snapshot.error = null;
        this.emit(record, { type: 'coordination.cancelled', payload: {} });
      } else {
        record.snapshot.status = 'failed';
        const code = controller.signal.aborted ? 'BUDGET_EXCEEDED' : error instanceof CoordinationError ? error.code : 'INTERNAL_ERROR';
        const message = controller.signal.aborted ? '项目协调已达到执行预算，未产生写入操作。'
          : error instanceof CoordinationError || error instanceof StructuredOutputError ? error.message : '项目协调失败，未产生写入操作。';
        record.snapshot.error = { code: code as NonNullable<CoordinationExecutionSnapshotDto['error']>['code'], message, retryable: false };
        this.emit(record, { type: 'coordination.failed', payload: record.snapshot.error });
      }
    } finally { clearTimeout(timer); this.controllers.delete(request.turnId); this.persist(); }
  }
  async close() {
    this.closed = true;
    for (const controller of this.controllers.values()) controller.abort('shutdown');
    await this.pumping;
  }
}
