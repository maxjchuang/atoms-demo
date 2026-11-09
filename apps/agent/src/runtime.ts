import { RepairReflection, reflectionDescription, type RepairReflectionValue } from './repair-reflection.js';
import {canonicalDeliveryJson} from '@atoms/contracts/delivery';
import {atomicLedger} from './atomic-ledger.js';
import {beginControllerEffect,finishControllerEffect,failureFingerprint,validateController,type RepairControllerState,type RepairStage,type StageBinding,type BudgetObservation,type StageFailure} from './repair-controller.js';
import {fingerprints,inventoryHash} from './delivery-files.js';
import { RequirementsCoordinationRequest, RequirementsCoordinationSnapshot, RequirementsError } from '@atoms/contracts/requirements';
import { BudgetRecoveryRuntime, RecoveryError } from './budget-recovery.js';
import { BudgetRecoveryError, type RecoveryExecutionRequestDto } from '@atoms/contracts/budget-recovery';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AgentEvent, AgentInputRequest, ArtifactManifest, CancelExecutionRequest, ExecutionSnapshot, ErrorCode,
  PROTOCOL_VERSION, StartExecutionRequest,
  type AgentEventDto, type ArtifactManifestDto, type ExecutionSnapshotDto, type StartExecutionDto,
} from '@atoms/contracts';
import type { RuntimeEvent, Check } from '@atoms/contracts';
import { COORDINATION_DEFAULTS } from '@atoms/contracts/conversation';
import { FakeDshAdapter, DshAdapter, type ModelAdapter, type PlanValue, type AdapterContext, type ResolvedRunQuestion } from './adapters.js';
import { listFiles, putFile, safeFile, sha256 } from './files.js';
import { mediaType, verifyApplication } from './verify.js';
import { templateFiles } from './template.js';
import { CoordinatorRuntime } from './coordinator.js';
import { CoordinationError } from './coordination-context.js';
import type { CoordinatorAdapter } from './coordinator-adapters.js';
import { CoordinationProtocolVersion } from '@atoms/contracts/conversation';
import { TOKEN_ACCOUNTING_VERSION } from './native-usage.js';
import { GenerationPool } from './generation-pool.js';
import { DeliveryPlanningRuntime, DeliveryError, type PlanningAdapter, type TrustedHostPlan } from './delivery-planning.js';
import { DeliveryProtocolVersion, DeliveryCommand, DeliveryCoordinationRequest, type DeliveryExecutionRequestDto } from '@atoms/contracts/delivery';
import { trustedTemplate, TOOLCHAIN_ID } from './trusted-template.js';
import { IsolationCapabilitiesPath, IsolationProtocolVersion } from '@atoms/contracts/isolation';
import { DockerVerification } from './isolation/verification.js';
import { StopUnconfirmedError } from './isolation/client.js';
import { BrokerClient, hostLocalCapabilities } from './isolation/client.js';
import { SourceBaselineAdapter, type TrustedSourceFault } from './controlled-repair.js';
import { DeliveryExecutionRuntime } from './delivery-execution.js';

type RuntimeBody = ReturnType<typeof RuntimeEvent.parse>;
type CheckValue = ReturnType<typeof Check.parse>;
export type RecordValue = {repairController?:RepairControllerState;failureDiagnosis?:{kind:'replan_tests'|'environment';summary:string;revisions?:{caseId:string;stepId:string;fact:string;suggestion:string}[];sourceHash:string|null;specHash:string|null;planHash:string|null};
  isolationGeneration?: string; isolationPending?: boolean; isolationCancelRequested?: boolean;
  usageKnown?: boolean; pendingModelRequest?: boolean; usageObservationVersion?: 'settled-request-v1';
  executionBackend?:'host_local'|'docker_linux';recovery?: RecoveryExecutionRequestDto; recoveryInitialFeedback?:string|null; delivery?: DeliveryExecutionRequestDto;
  request: StartExecutionDto; hash: string; snapshot: ExecutionSnapshotDto;
  events: AgentEventDto[]; commands: Record<string, { hash: string; snapshot: ExecutionSnapshotDto }>;
  started: boolean; plan: PlanValue | null; planConfirmed: boolean; queueOrder: number;
  activeMs: number; waitingAt: number | null;
  usage: { modelSteps: number; inputTokens: number; outputTokens: number };
  ordinaryQuestions: number; answers: ResolvedRunQuestion[];
  repairRoundsUsed: number; verificationErrors: string | null; repairClaimed: boolean;
  reflection?: { status: 'started'|'completed'|'skipped'|'invalid'; review: RepairReflectionValue|null; reason: string; sourceHash: string|null };
  tokenAccountingVersion?: typeof TOKEN_ACCOUNTING_VERSION;
};
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, data) => data && typeof data === 'object' && !Array.isArray(data)
  ? Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b))) : data);
class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export interface AgentOptions {
  executionBackend?: 'host_local'|'docker_linux'; verification?: DockerVerification; dockerProbe?: boolean; brokerUrl?: string; brokerToken?: string;
  copyRecoverySource?: (request:RecoveryExecutionRequestDto,workspace:string)=>Promise<void>; recoveryAudit?:()=>Promise<{confirmed:boolean;reason?:string|null}>;
  dataDir: string; serviceToken: string; apiInternalUrl?: string;
  mode?: 'fake' | 'dsh'; apiKey?: string; model?: string; adapter?: ModelAdapter;
  coordinationMode?: 'fake' | 'dsh'; coordinatorAdapter?: CoordinatorAdapter;
  /** Trusted test constructors only; not wired to main/env/HTTP. */
  trustedCleanBrowserLocale?:string;trustedHostPlan?: TrustedHostPlan; trustedSourceFault?: TrustedSourceFault;
  allowControlledRegression?: boolean; generationPool?: GenerationPool; isDeliveryReserved?: (id: string) => boolean; planningAdapter?: PlanningAdapter;
}

export class AgentRuntime {
  readonly records = new Map<string, RecordValue>();
  readonly adapter: ModelAdapter;
  deliveryEngine?: DeliveryExecutionRuntime;
  readonly activeSince = new Map<string, number>();
  private controllers = new Map<string, AbortController>();
  private pumping: Promise<void> | null = null;
  private closed = false;
  private timer: ReturnType<typeof setInterval>;
  private pool: GenerationPool;
  constructor(readonly options: AgentOptions) {
    if (options.adapter instanceof SourceBaselineAdapter && !options.trustedSourceFault) throw new Error('Source baseline adapter requires the trusted controlled provenance hook');
    this.pool = options.generationPool || new GenerationPool();
    mkdirSync(options.dataDir, { recursive: true });
    this.adapter = options.adapter || (options.mode === 'fake' ? new FakeDshAdapter() : new DshAdapter({ apiKey: options.apiKey, model: options.model }));
    const ledger = this.ledgerPath();
    if (existsSync(ledger)) {
      for (const item of JSON.parse(readFileSync(ledger, 'utf8')) as RecordValue[]) {
        StartExecutionRequest.parse(item.request); ExecutionSnapshot.parse(item.snapshot);if(item.repairController)validateController(item.repairController,{requestHash:sha256(canonical(item.request)),...(item.delivery?{specHash:item.delivery.bundle.spec.hash,planHash:item.delivery.bundle.plan.hash,bindingHash:item.delivery.bundle.binding.hash,toolchainHash:sha256(canonicalDeliveryJson(item.delivery.bundle.binding.toolchain))}:{})});
        this.records.set(item.request.executionId, item);
        if (!terminal.has(item.snapshot.status) && item.snapshot.status !== 'waiting_input' && item.snapshot.status !== 'accepted') {
          // Children are owned by this process; a full restart is fenced by fresh execution directories.
          if (item.usageObservationVersion === 'settled-request-v1' && item.pendingModelRequest) item.usageKnown = false;
          item.snapshot.status = this.options.verification ? 'cancelling' : 'interrupted'; item.snapshot.pendingAttention = null;
          if(this.options.verification){item.isolationPending=true;continue;}
          this.emit(item, { type: 'execution.interrupted', payload: { reason: 'Runtime restarted; explicit retry required. External processes are not resumed.' } });
        }
      }
    }
    this.timer = setInterval(() => {
      if(this.options.verification)for(const item of this.records.values())if(item.isolationPending)void this.options.verification.reconcileExecution(item.request.executionId).then(stopped=>{if(!stopped||!item.isolationPending)return;item.isolationPending=false;item.snapshot.status=item.isolationCancelRequested?'cancelled':'interrupted';this.emit(item,item.isolationCancelRequested?{type:'execution.cancelled',payload:{}}:{type:'execution.interrupted',payload:{reason:'Isolated job stopped after reconciliation; no external work resumed.'}});if(item.delivery)this.deliveryEngine?.fail(item,item.isolationCancelRequested?'cancelled':'interrupted','Isolation cleanup confirmed');this.schedule();}).catch(()=>{});
      for (const item of this.records.values()) {
        if (item.snapshot.status === 'waiting_input' && item.waitingAt
          && Date.now() - item.waitingAt > item.request.budget.maxWaitingInputMs) {
          item.snapshot.status = 'failed'; item.snapshot.pendingAttention = null;
          this.emit(item, { type: 'execution.failed', payload: { code: 'BUDGET_EXCEEDED', message: '等待用户输入已超时' } });
        }
      }
    }, 1000);
    this.timer.unref();
    this.schedule();
  }
  private ledgerPath() { return path.join(this.options.dataDir, 'executions.json'); }
  private persist() {
    const filename = this.ledgerPath();
    atomicLedger(filename,[...this.records.values()]);
  }
  private emit(item: RecordValue, event: RuntimeBody) {
    const seq = item.events.length + 1;
    item.snapshot.lastSourceSeq = seq; item.snapshot.updatedAt = now();
    const envelope = AgentEvent.parse({ protocolVersion: PROTOCOL_VERSION, executionId: item.request.executionId,
      runId: item.request.runId, sourceSeq: seq, occurredAt: now(), event });
    item.events.push(envelope); this.persist();
  }
  checkEvent(item: RecordValue, check: CheckValue) { this.emit(item, { type: 'check.completed', payload: check }); }
  private update(item: RecordValue, changes: Partial<ExecutionSnapshotDto>) {
    item.snapshot = { ...item.snapshot, ...changes, revision: item.snapshot.revision + 1,
      lastSourceSeq: item.events.length + 1, updatedAt: now() };
    ExecutionSnapshot.parse(item.snapshot);
    this.emit(item, { type: 'execution.updated', payload: clone(item.snapshot) });
  }
  get(id: string) {
    const record = this.records.get(id);
    if (!record) throw new HttpError(404, 'NOT_FOUND', 'Execution not found');
    return record;
  }
  start(raw: unknown, pathId: string, delivery?: DeliveryExecutionRequestDto, recovery?:RecoveryExecutionRequestDto) {
    const request = StartExecutionRequest.parse(raw);
    if (pathId !== request.executionId) throw new HttpError(400, 'INVALID_REQUEST', 'Execution ID mismatch');
    if (!delivery && this.options.isDeliveryReserved?.(pathId)) throw new HttpError(409, 'CONFLICT', 'Execution ID belongs to delivery preparation, not legacy start');
    const hash = sha256(canonical(request));
    const existing = this.records.get(pathId);
    if (existing) {
      if(existing.recovery&&!recovery)throw new HttpError(409,'CONFLICT','Recovery wrapper required');
      if (existing.hash !== hash) throw new HttpError(409, 'CONFLICT', 'Execution ID already has a different request');
      return { created: false, snapshot: clone(existing.snapshot) };
    }
    if (!this.adapter.ready()) throw new HttpError(503, 'RUNTIME_UNAVAILABLE', 'DeepSeek credentials are not configured');
    const item: RecordValue = {
      request, hash,executionBackend:this.options.executionBackend||'host_local', ...(delivery ? { delivery } : {}),...(recovery?{recovery}:{}), snapshot: { protocolVersion: PROTOCOL_VERSION, id: pathId, runId: request.runId,
        status: 'accepted', phase: null, revision: 1, lastSourceSeq: 0, pendingAttention: null, artifactId: null, updatedAt: now() },
      events: [], commands: {}, started: false, plan: null, planConfirmed: recovery?true:request.mode === 'build',
      queueOrder: Date.now(), activeMs: 0, waitingAt: null, usage: { modelSteps: 0, inputTokens: 0, outputTokens: 0 },
      isolationGeneration: randomUUID().replaceAll('-',''),
      usageKnown: true, pendingModelRequest: false, usageObservationVersion: 'settled-request-v1',
      ordinaryQuestions: 0, answers: recovery?clone(this.records.get(recovery.origin.execution.executionId)?.answers||[]):[], repairRoundsUsed: 0, verificationErrors: null, repairClaimed: false,
      tokenAccountingVersion: TOKEN_ACCOUNTING_VERSION,
    };
    this.records.set(pathId, item);
    this.update(item, {}); const snapshot = clone(item.snapshot); this.schedule();
    return { created: true, snapshot };
  }
  answer(id: string, raw: unknown) {
    const input = AgentInputRequest.parse(raw); const item = this.get(id);
    const previous = item.commands[input.commandId]; const hash = sha256(canonical(input));
    if (previous) {
      if (previous.hash !== hash) throw new HttpError(409, 'CONFLICT', 'Command ID reused with different input');
      return clone(previous.snapshot);
    }
    const question = item.snapshot.pendingAttention;
    if (item.snapshot.status !== 'waiting_input' || !question || question.id !== input.attentionId
      || question.revision !== input.expectedRevision) throw new HttpError(409, 'STALE_REVISION', 'Question is no longer current');
    if (question.resolution === 'replan') throw new HttpError(409, 'CONFLICT', 'This reflection requires explicit replanning; the old execution cannot resume');
    const answer = input.answer;
    if ((answer.kind === 'approve_plan' && question.kind !== 'plan_confirmation')
      || (answer.kind === 'select' && !question.options.some((option) => option.id === answer.optionId))
      || (answer.kind === 'text' && !question.allowText)) throw new HttpError(400, 'INVALID_REQUEST', 'Answer does not match question');
    if (question.kind === 'plan_confirmation') item.planConfirmed = true;
    else {
      item.answers ??= [];
      item.answers.push({ question: { title: question.title, description: question.description, options: structuredClone(question.options) }, answer: structuredClone(answer) });
    }
    item.waitingAt = null; item.queueOrder = Date.now();
    this.update(item, { status: 'accepted', pendingAttention: null });
    this.emit(item, { type: 'attention.resolved', payload: { attentionId: question.id } });
    item.commands[input.commandId] = { hash, snapshot: clone(item.snapshot) }; this.persist();
    this.schedule(); return clone(item.snapshot);
  }
  async cancel(id: string, raw: unknown) {
    const input = CancelExecutionRequest.parse(raw); const item = this.get(id); const hash = sha256(canonical(input));
    const previous = item.commands[input.commandId];
    if (previous) {
      if (previous.hash !== hash) throw new HttpError(409, 'CONFLICT', 'Command ID reused');
      return clone(previous.snapshot);
    }
    if (!terminal.has(item.snapshot.status)) {
      this.update(item, { status: 'cancelling', pendingAttention: null });
      const controller = this.controllers.get(id);
      if (controller) controller.abort();
      else { item.snapshot.status = 'cancelled'; if (item.delivery) this.deliveryEngine?.fail(item, 'cancelled', 'Cancelled before execution or while waiting.'); this.emit(item, { type: 'execution.cancelled', payload: {} }); }
    }
    item.commands[input.commandId] = { hash, snapshot: clone(item.snapshot) }; this.persist();
    return clone(item.snapshot);
  }
  isExecutionActive(id:string){return this.controllers.has(id)||this.activeSince.has(id);}
  async disposeOwnedExecution(id:string){if(this.isExecutionActive(id))throw new HttpError(409,'CONFLICT','Execution resources are still active');await this.adapter.close(id);}
  events(id: string, after: number, limit: number) {
    const item = this.get(id);
    const items = item.events.filter((event) => event.sourceSeq > after).slice(0, limit);
    const nextCursor = items.at(-1)?.sourceSeq ?? after;
    return { items: clone(items), nextCursor, hasMore: item.events.some((event) => event.sourceSeq > nextCursor) };
  }
  private schedule() {
    if (this.closed || this.pumping) return;
    this.pumping = new Promise<void>((resolve) => setImmediate(resolve)).then(async () => {
      while (!this.closed) {
        if([...this.records.values()].some(item=>item.isolationPending))break;
        const next = [...this.records.values()].filter((item) => item.snapshot.status === 'accepted').sort((a, b) => a.queueOrder - b.queueOrder)[0];
        if (!next) break;
        await this.pool.run(async () => { if (!this.closed && next.snapshot.status === 'accepted') await this.process(next); });
      }
    }).finally(() => { this.pumping = null; if (!this.closed && ![...this.records.values()].some(item=>item.isolationPending) && [...this.records.values()].some((item) => item.snapshot.status === 'accepted')) this.schedule(); });
  }
  private async prepareWorkspace(item: RecordValue, workspace: string, signal: AbortSignal) {
    await mkdir(workspace, { recursive: true });
    if(item.recovery){if(!this.options.copyRecoverySource)throw new Error('Recovery source handler unavailable');await this.options.copyRecoverySource(item.recovery,workspace);return;}
    for (const [name, content] of Object.entries(templateFiles)) await putFile(workspace, name, content);
    if (item.request.input.kind === 'version') {
      if (!this.options.apiInternalUrl) throw new Error('API_INTERNAL_URL is not configured');
      const base = `${this.options.apiInternalUrl}/internal/v1/input-artifacts/${item.request.input.artifactId}`;
      const headers = { authorization: `Bearer ${this.options.serviceToken}`, 'x-atoms-protocol-version': PROTOCOL_VERSION };
      const response = await fetch(`${base}/manifest`, { headers, signal });
      if (!response.ok) throw new Error(`Input manifest HTTP ${response.status}`);
      const raw = Buffer.from(await response.arrayBuffer());
      if (sha256(raw) !== item.request.input.manifestSha256) throw new Error('Input manifest hash mismatch');
      const manifest = ArtifactManifest.parse(JSON.parse(raw.toString()));
      let total = 0;
      for (const file of manifest.files.filter((file) => file.path.startsWith('source/'))) {
        const result = await fetch(`${base}/file?path=${encodeURIComponent(file.path)}`, { headers, signal });
        if (!result.ok) throw new Error(`Input source HTTP ${result.status}`);
        const content = Buffer.from(await result.arrayBuffer()); total += content.length;
        if (content.length !== file.bytes || sha256(content) !== file.sha256 || total > item.request.budget.maxArtifactBytes) throw new Error('Input file integrity or budget mismatch');
        const name = file.path.slice('source/'.length);
        // Inputs cannot replace executable configs or dependency manifests from the trusted template.
        if (name.startsWith('src/') || name === 'index.html') await putFile(workspace, name, content);
      }
    }
  }
  private async process(item: RecordValue) {
    const id = item.request.executionId; const controller = new AbortController(); this.controllers.set(id, controller);
    const startedAt = Date.now(); this.activeSince.set(id, startedAt);
    const timer = setTimeout(() => controller.abort('budget'), Math.max(1, item.request.budget.maxWallTimeMs - item.activeMs));
    const root = path.join(this.options.dataDir, 'executions', id);
    const workspace = path.join(root, 'workspace'); const evidence = path.join(root, 'evidence');
    const context: AdapterContext = { request: item.request,sourceBasis:item.recovery?'verified_checkpoint':item.request.input.kind==='template'?'empty_project':'published_version', workspace,
      home: path.join(this.options.dataDir, 'dsh', item.request.projectId), signal: controller.signal,
      remainingInputTokens: () => item.usageKnown===false?0:item.request.budget.maxInputTokens-item.usage.inputTokens,
      remainingOutputTokens: () => item.usageKnown === false ? 0 : item.request.budget.maxOutputTokens - (item.usage?.outputTokens || 0),
      remainingActiveMs: () => Math.max(0, item.request.budget.maxWallTimeMs - item.activeMs - (Date.now() - startedAt)),
      usageIsKnown: () => item.usageKnown !== false, observedUsage: () => item.usage,
      beginModelRequest: () => {if(item.recovery&&!item.started&&Date.now()>=Date.parse(item.recovery.authorization.startBefore))throw new HttpError(409,'INVALID_REQUEST','Recovery authorization expired before provider dispatch'); item.pendingModelRequest = true; this.persist(); },
      settleModelRequest: () => { item.pendingModelRequest = false; this.persist(); },
      markUsageUnknown: () => { item.usageKnown = false; this.persist(); },
      report: (content) => this.emit(item, { type: 'message.completed', payload: { messageId: `message_${randomUUID().replaceAll('-', '')}`, content } }),
      fileChanged: (change) => this.emit(item, { type: 'file.changed', payload: change }),
      runAnswers: item.answers ?? [],
      meter: (usage) => {
        if (item.delivery && !item.started && ((usage.modelSteps || 0) > 0 || (usage.inputTokens || 0) > 0 || (usage.outputTokens || 0) > 0)) { item.started = true; this.emit(item, { type: 'execution.started', payload: {} }); }
        item.usage ??= { modelSteps: 0, inputTokens: 0, outputTokens: 0 };
        for (const key of ['modelSteps', 'inputTokens', 'outputTokens'] as const) item.usage[key] += usage[key] || 0;
        this.persist();
        if (item.usage.modelSteps > item.request.budget.maxModelSteps
          || item.usage.inputTokens > item.request.budget.maxInputTokens
          || item.usage.outputTokens > item.request.budget.maxOutputTokens) {
          controller.abort('budget'); throw new Error('Model budget exceeded');
        }
      },
    };
    if (item.delivery) this.deliveryEngine!.context(item, context);
    const budget=():BudgetObservation=>({known:item.usageKnown!==false&&!item.pendingModelRequest,used:{modelSteps:(item.delivery?.bundle.binding.planningUsage.modelSteps??0)+item.usage.modelSteps,inputTokens:item.usageKnown===false?null:(item.delivery?.bundle.binding.planningUsage.inputTokens??0)+item.usage.inputTokens,outputTokens:item.usageKnown===false?null:(item.delivery?.bundle.binding.planningUsage.outputTokens??0)+item.usage.outputTokens,activeMs:(item.delivery?.bundle.binding.planningUsage.activeMs??0)+item.activeMs+Date.now()-startedAt},remaining:{modelSteps:item.request.budget.maxModelSteps-item.usage.modelSteps,inputTokens:item.usageKnown===false?null:item.request.budget.maxInputTokens-item.usage.inputTokens,outputTokens:item.usageKnown===false?null:context.remainingOutputTokens(),activeMs:context.remainingActiveMs!()},repairUsed:item.repairRoundsUsed,repairLimit:item.request.budget.maxRepairRounds});
    const binding=async():Promise<StageBinding>=>({sourceHash:inventoryHash(await fingerprints(workspace,'source/')),specHash:item.delivery?.bundle.spec.hash??null,planHash:item.delivery?.bundle.plan.hash??null,bindingHash:item.delivery?.bundle.binding.hash??null,toolchainHash:item.delivery?sha256(canonicalDeliveryJson(item.delivery.bundle.binding.toolchain)):null,requestHash:item.hash});
    let effect:{id:string;stage:RepairStage}|null=null;
    const begin=async(stage:RepairStage)=>{if(controller.signal.aborted)throw new Error('Execution aborted');if(item.delivery)effect={id:beginControllerEffect(item,stage,await binding(),budget(),()=>this.persist()),stage};};
    const finish=async(result:Parameters<typeof finishControllerEffect>[5])=>{if(!effect)return null;const decision=finishControllerEffect(item,effect.id,effect.stage,await binding(),budget(),result,()=>this.persist());effect=null;return decision;};
    const failure=(category:StageFailure['category'],details:unknown,evidenceRefs:string[]=[]):StageFailure=>({category,fingerprint:failureFingerprint(category,details),evidenceRefs});
    const reflectAndWait = async (errors: string) => {
      if (controller.signal.aborted || this.closed) throw new Error('Execution aborted');
      const before = await binding();
      const authority=()=>canonical({request:item.request,delivery:item.delivery,plan:item.plan,repairRoundsUsed:item.repairRoundsUsed});const authorityBefore=authority();
      const assertReadOnly=async()=>{if((await binding()).sourceHash!==before.sourceHash||authority()!==authorityBefore)throw Object.assign(new Error('Read-only reflection changed source or frozen authority'),{controllerCategory:'trust'});};
      if (!item.reflection) {
        const remaining=budget().remaining;
        const skipReason=!budget().known?'模型用量尚未确认':remaining.modelSteps<=0?'剩余模型步骤已用完':(remaining.inputTokens??0)<16000?'剩余输入预算不足':(remaining.outputTokens??0)<1000?'剩余输出预算不足':remaining.activeMs<15000?'剩余执行时间不足':!this.adapter.review?'当前适配器不支持只读复盘':null;const allowed=skipReason===null;
        item.reflection={status:allowed?'started':'skipped',review:null,reason:allowed?'只读复盘进行中':skipReason!,sourceHash:before.sourceHash};this.persist();
        if(allowed){
          context.report('同计划修复次数已用完，正在执行一次只读复盘；不会修改源码或验收。');
          const soft=new AbortController();const duration=Math.min(20000,Math.max(1,remaining.activeMs-5000));const softTimer=setTimeout(()=>soft.abort('reflection_timeout'),duration);const cancelReview=()=>soft.abort(controller.signal.reason);controller.signal.addEventListener('abort',cancelReview,{once:true});
          try { const review=RepairReflection.parse(await this.adapter.review!({...context,request:clone(context.request),frozenSpecification:clone(context.frozenSpecification),frozenTestPlan:clone(context.frozenTestPlan),runAnswers:clone(context.runAnswers),signal:soft.signal,remainingActiveMs:()=>Math.max(1,Math.min(duration,context.remainingActiveMs!()-5000))},clone(item.plan!),errors));
            await assertReadOnly();
            item.reflection={status:'completed',review,reason:'已完成只读复盘',sourceHash:before.sourceHash};
          } catch(error) {if(controller.signal.aborted||this.closed)throw error;await assertReadOnly();item.reflection={status:'invalid',review:null,reason:soft.signal.aborted?'只读复盘已到软时限，未追加模型请求':'只读复盘未返回有效结论，未追加模型请求',sourceHash:before.sourceHash};}
          finally{clearTimeout(softTimer);controller.signal.removeEventListener('abort',cancelReview);}
          this.persist();
        }
      }
      item.verificationErrors=errors;item.waitingAt=Date.now();
      const attention={id:`attention_reflection_${id}`,runId:item.request.runId,revision:1,kind:'question' as const,resolution:'replan' as const,title:'自动修复已停止，请确认下一步方案',description:reflectionDescription(item.reflection.review,item.reflection.reason),options:[],allowText:true,createdAt:now()};
      this.update(item,{status:'waiting_input',pendingAttention:attention});this.emit(item,{type:'attention.created',payload:attention});
    };
    try {
      if(item.recovery&&!item.started&&Date.now()>=Date.parse(item.recovery.authorization.startBefore))throw new HttpError(409,'INVALID_REQUEST','Recovery start authorization expired before first model dispatch');
      if (this.options.executionBackend === 'docker_linux' && (!this.options.verification || !await this.options.verification.ready())) throw new HttpError(503, 'RUNTIME_UNAVAILABLE', 'Docker verification integration is not ready; host fallback is disabled');
      if (item.usageKnown === false) throw new Error('Model usage is unknown; further inference is fenced.');
      this.update(item, { status: 'running', pendingAttention: null,
        phase: !item.plan || !item.planConfirmed ? 'planning' : item.verificationErrors ? 'repairing' : 'generating' });
      if (!item.delivery && !item.started) { item.started = true; this.emit(item, { type: 'execution.started', payload: {} }); }
      if (!item.plan) {
        context.report(item.request.input.kind === 'template' ? '正在准备受控 React 模板。' : '正在载入并校验上一版本源码快照。');
        await this.prepareWorkspace(item, workspace, controller.signal);
        context.report('源码工作目录已准备完成，开始整理实现计划。');
        if(item.delivery){await begin('validate_frozen');item.plan=await this.deliveryEngine!.initialize(item,workspace);await finish({outcome:'passed'});}else item.plan=await this.adapter.plan(context); this.persist();
        context.report(`计划已整理：${item.plan.summary.slice(0, 240)}\n${item.plan.tasks.slice(0, 5).map((task, index) => `${index + 1}. ${task.slice(0, 120)}`).join('\n')}`);
      }
      if (!item.planConfirmed) {
        const attention = { id: `attention_${id}`, runId: item.request.runId, revision: 1,
          kind: 'plan_confirmation' as const, title: '确认实现计划', description: item.plan.summary,
          options: [], allowText: false, plan: item.plan, createdAt: now() };
        item.waitingAt = Date.now();
        this.update(item, { status: 'waiting_input', pendingAttention: attention, phase: 'planning' });
        this.emit(item, { type: 'attention.created', payload: attention }); return;
      }
      let summary = ''; let checks: CheckValue[] = []; let errors: string | null = item.verificationErrors ?? null;
      item.repairRoundsUsed ??= 0; item.repairClaimed ??= false; item.ordinaryQuestions ??= 0;
      while (true) {
        if (controller.signal.aborted) throw new Error('Execution aborted');
        if (errors && !item.repairClaimed) {
          if (item.repairRoundsUsed >= item.request.budget.maxRepairRounds) { await reflectAndWait(errors); return; }
          // The existing Worker call may ask a question; only accepted code consumes a repair round.
        }
        this.update(item, { phase: errors ? 'repairing' : 'generating' });
        this.emit(item, { type: 'phase.changed', payload: { phase: errors ? 'repairing' : 'generating' } });
        await begin(errors?'repair':'generate');if(item.delivery)this.deliveryEngine!.validateFrozen(item);
        let generated = await this.adapter.generate(context, item.plan, errors || item.recoveryInitialFeedback || undefined);
        if(typeof generated!=='string'&&item.delivery){const after=await binding();if(after.sourceHash!==item.repairController!.entries.at(-1)!.binding.sourceHash){await finish({outcome:'failed',failure:failure('trust',[],[])});throw new HttpError(422,'VERIFICATION_FAILED','A diagnosis/question cannot apply source edits');}}
        if(typeof generated!=='string'&&generated.kind!=='question'){
          const refs=await binding();item.failureDiagnosis={...generated,sourceHash:refs.sourceHash,specHash:refs.specHash,planHash:refs.planHash};this.persist();
          const category=generated.kind==='replan_tests'?'replan_required':'infrastructure';await finish({outcome:'failed',failure:failure(category,generated,[])});
          context.report(generated.kind==='replan_tests'?'当前验收需要重新规划：'+generated.summary+'。原计划未修改；请使用显式重新规划入口，确认后新Code需新的构建额度。':'模型提出环境诊断：'+generated.summary+'。未继续改代码，需宿主核对环境。');
          throw Object.assign(new HttpError(422,'VERIFICATION_FAILED',generated.kind==='replan_tests'?'验收解释需要重新规划，原任务未修改测试或源码；新方案需显式确认。':'环境诊断需要核对，未继续源码修复。'),{controllerCategory:category});
        }
        if(typeof generated==='string'&&errors&&!item.repairClaimed){item.repairRoundsUsed++;item.repairClaimed=true;this.persist();}
        if(typeof generated==='string'&&errors&&item.delivery&&item.repairRoundsUsed<item.request.budget.maxRepairRounds&&item.ordinaryQuestions<COORDINATION_DEFAULTS.maxOrdinaryRunQuestions&&budget().known&&(budget().remaining.outputTokens??0)>0&&budget().remaining.modelSteps>0){
          const after=await binding();const previous=item.repairController!.entries.at(-1)!.binding.sourceHash;
          if(after.sourceHash===previous){item.repairClaimed=false;generated={kind:'question',title:'请补充期望的实际表现',description:'自动修复尚未产生可验证进展。请用使用场景补充实现细节；回答只用于原有验收。若需改变目标或测试，请使用重新规划入口，确认后新Code需要构建额度。',options:[],allowText:true};}
        }
        const generationDecision=await finish({outcome:typeof generated==='string'?'passed':'question'});
        if(generationDecision?.action==='stop'&&generationDecision.reason==='no_progress'&&errors){await reflectAndWait(errors);return;}
        if(generationDecision?.action==='stop')throw new HttpError(422,generationDecision.reason==='usage_unknown'?'BUDGET_EXCEEDED':'VERIFICATION_FAILED',generationDecision.reason==='usage_unknown'?'模型用量未知，控制器已停止后续验证或推理。':'修复未改变源码或重复已失败源码，已停止无进展循环。');
        if(typeof generated==='string')item.recoveryInitialFeedback=null;
        if (typeof generated !== 'string') {
          if (item.ordinaryQuestions >= COORDINATION_DEFAULTS.maxOrdinaryRunQuestions) throw new HttpError(422, 'BUDGET_EXCEEDED', '执行中的问题次数已达到上限，未扩大任务预算。');
          item.ordinaryQuestions++; item.waitingAt = Date.now();
          const attention = { id: `attention_${sha256(id).slice(0, 24)}_${item.ordinaryQuestions}`, runId: item.request.runId,
            revision: item.ordinaryQuestions, kind: 'question' as const, title: generated.title,
            description: generated.description, options: generated.options.map((label, index) => ({ id: `option_${index + 1}`, label })),
            allowText: generated.allowText, createdAt: now() };
          this.update(item, { status: 'waiting_input', pendingAttention: attention });
          this.emit(item, { type: 'attention.created', payload: attention }); return;
        }
        summary = generated;
        this.update(item, { phase: 'verifying' });
        if(!item.delivery)await begin('workspace_verify');
        const verified = item.delivery ? await this.deliveryEngine!.verify(item, workspace, context,()=>begin('workspace_verify')) : this.options.verification ? await this.options.verification.verifyApplication(workspace,evidence,controller.signal,check=>this.checkEvent(item,check),context.report,{executionId:id,bindingHash:item.hash,attemptId:'attempt_'+id,generation:item.isolationGeneration!,remainingMs:context.remainingActiveMs!()}) : await verifyApplication(workspace, evidence, controller.signal,
          (check) => this.emit(item, { type: 'check.completed', payload: check }), context.report);
        checks = verified.checks; errors = verified.errors;
        const verificationCategory='failureCategory'in verified&&['code_check','required_behavior','trust'].includes(String(verified.failureCategory))?verified.failureCategory as StageFailure['category']:'infrastructure';
        const verifyDecision=await finish(errors?{outcome:'failed',failure:failure(verificationCategory,errors,checks.flatMap(c=>c.evidenceIds||[]))}:{outcome:'passed'});
        if(errors&&verifyDecision?.action==='stop'&&['code_check','required_behavior'].includes(verificationCategory)&&item.repairRoundsUsed>=item.request.budget.maxRepairRounds){await reflectAndWait(errors);return;}
        if(errors&&verifyDecision?.action==='stop')throw new HttpError(422,'VERIFICATION_FAILED',verifyDecision.reason==='budget'||verifyDecision.reason==='usage_unknown'?'修复预算不足或用量未知，已停止。':'验证失败且没有可用的同计划修复次数。');
        item.verificationErrors = errors; item.repairClaimed = false; this.persist();
        if (!errors&&item.delivery){
          await begin('export_clean');const clean=await this.deliveryEngine!.finish(item,workspace,context);errors=clean.errors;
          const cleanDecision=await finish(errors?{outcome:'failed',failure:failure(clean.failureCategory??'infrastructure',errors,clean.evidenceRefs)}:{outcome:'passed'});
          item.verificationErrors=errors;this.persist();
          if(errors&&cleanDecision?.action==='stop'&&clean.failureCategory==='clean_behavior'&&item.repairRoundsUsed>=item.request.budget.maxRepairRounds){await reflectAndWait(errors);return;}
          if(cleanDecision?.action==='stop')throw new HttpError(422,'VERIFICATION_FAILED','干净导出失败且控制器不允许继续：'+cleanDecision.reason);
        }
        if (!errors) break;
      }
      if (errors) throw new HttpError(422, 'VERIFICATION_FAILED', '验证失败且修复次数已用完：' + errors.slice(-1000));
      await begin('finalize');
      const behavior: CheckValue = { id: 'check_behavior', kind: 'behavior', name: '需求行为验收', required: false,
        status: 'not_run', summary: '最小闭环只验证类型、构建和页面加载；功能行为待人工验收。', evidenceIds: [] };
      if (!item.delivery) { checks.push(behavior); this.emit(item, { type: 'check.completed', payload: behavior }); }

      context.report('必要检查已通过，开始打包候选源码、预览产物和验证证据。');
      const artifactId = `artifact_${id}`;
      const artifactRoot = path.join(root, 'artifacts', artifactId); await mkdir(artifactRoot, { recursive: true });
      for (const file of await listFiles(workspace)) {
        const prefix = file.startsWith('dist/') ? '' : 'source/';
        await putFile(artifactRoot, prefix + file, await readFile(await safeFile(workspace, file)));
      }
      for (const file of await listFiles(evidence)) await putFile(artifactRoot, `evidence/${file}`, await readFile(await safeFile(evidence, file)));
      const names = await listFiles(artifactRoot); let total = 0;
      const files = await Promise.all(names.map(async (name) => {
        const bytes = await readFile(await safeFile(artifactRoot, name)); total += bytes.length;
        return { path: name, bytes: bytes.length, sha256: sha256(bytes), mediaType: mediaType(name) };
      }));
      if (total > item.request.budget.maxArtifactBytes) throw new HttpError(422, 'BUDGET_EXCEEDED', '产物大小超过预算');
      const manifest: ArtifactManifestDto = ArtifactManifest.parse({ protocolVersion: PROTOCOL_VERSION, id: artifactId,
        executionId: id, runId: item.request.runId, baseVersionId: item.request.baseVersionId,
        summary, files, checks, evidence: item.delivery ? this.deliveryEngine!.artifactEvidence(id) : [
          ...['typecheck', 'build', 'smoke'].map((kind) => ({ id: `evidence_${kind}`, path: `evidence/${kind}.log`, kind: 'log' })),
          { id: 'evidence_screenshot', path: 'evidence/screenshot.png', kind: 'screenshot' },
        ], createdAt: now() });
      if(item.delivery){const report=this.deliveryEngine!.report(id)!;const attempt=report.attempts.at(-1);if(!report.final||report.lifecycle!=='completed'||!['complete','partial'].includes(report.quality)||!attempt||inventoryHash(files.filter(f=>f.path.startsWith('source/')))!==attempt.sourceAfterHash||inventoryHash(files.filter(f=>f.path.startsWith('dist/')))!==attempt.distHash||report.cleanBuild?.sourceBeforeHash!==attempt.sourceAfterHash||report.cleanBuild.sourceAfterHash!==attempt.sourceAfterHash)throw new HttpError(422,'VERIFICATION_FAILED','Final candidate bytes do not match current source/clean evidence');const required=new Set(item.delivery.bundle.plan.coverage.filter(c=>item.delivery!.bundle.spec.criteria.find(s=>s.id===c.criterionId)?.required).flatMap(c=>c.caseIds));const diagnosticFailures=new Set(report.attempts.filter(a=>a.sourceBeforeHash===a.sourceAfterHash&&a.distHash&&a.checks.build.status==='passed'&&a.checks.smoke.status==='passed'&&!['invalid','cancelled','interrupted'].includes(a.status)).flatMap(a=>a.caseResults.filter(c=>required.has(c.caseId)&&c.status==='failed').map(c=>c.caseId)));for(const caseId of diagnosticFailures)if(attempt.caseResults.find(c=>c.caseId===caseId)?.status!=='passed'||report.cleanBuild.caseResults.find(c=>c.caseId===caseId)?.status!=='passed')throw new HttpError(422,'VERIFICATION_FAILED','Previously observed required diagnostic failures remain unresolved');}
      const raw = JSON.stringify(manifest); await putFile(artifactRoot, 'manifest.json', raw);
      if (controller.signal.aborted) throw new Error('Execution aborted');
      const finalizeDecision=await finish({outcome:'passed'});if(finalizeDecision?.action==='stop')throw new HttpError(422,'VERIFICATION_FAILED','Final artifact source/fence changed');if(controller.signal.aborted)throw new Error('Execution aborted before candidate');
      item.snapshot.artifactId = artifactId;
      this.emit(item, { type: 'artifact.ready', payload: { artifactId, manifestSha256: sha256(raw) } });
      context.report('候选产物与验证证据已就绪，等待后端校验并发布版本。');
      item.snapshot.status = 'succeeded'; item.snapshot.revision++;
      this.emit(item, { type: 'execution.completed', payload: { artifactId } });
    } catch (error) {
      if(error instanceof StopUnconfirmedError){item.isolationPending=true;item.isolationCancelRequested=item.snapshot.status==='cancelling';this.update(item,{status:'cancelling',pendingAttention:null});return;}
      await this.adapter.close(id).catch(() => {});
      if (effect) {const category=item.snapshot.status==='cancelling'||this.closed?'cancelled':item.usageKnown===false||item.pendingModelRequest?'usage_unknown':controller.signal.aborted?'budget':error&&typeof error==='object'&&'controllerCategory'in error&&['infrastructure','trust','budget','replan_required'].includes(String(error.controllerCategory))?error.controllerCategory as StageFailure['category']:'trust';await finish({outcome:'failed',failure:failure(category,[],[])}).catch(()=>{});}
      if (item.usageObservationVersion === 'settled-request-v1' && item.pendingModelRequest) item.usageKnown = false;
      item.snapshot.pendingAttention = null; item.snapshot.revision++;
      if (item.delivery) this.deliveryEngine!.fail(item, item.snapshot.status === 'cancelling' || this.closed ? 'cancelled' : 'failed', error instanceof Error ? error.message : 'Delivery execution failed', controller.signal.reason === 'budget' || (error instanceof DeliveryError && error.code === 'BUDGET_EXCEEDED') ? 'BUDGET_EXCEEDED' : error&&typeof error==='object'&&'controllerCategory'in error&&error.controllerCategory==='replan_required'?'PLAN_INVALID':undefined);
      if (item.snapshot.status === 'cancelling' || this.closed) {
        item.snapshot.status = 'cancelled'; if (item.delivery) this.deliveryEngine?.fail(item, 'cancelled', 'Cancelled before execution or while waiting.'); this.emit(item, { type: 'execution.cancelled', payload: {} });
      } else {
        item.snapshot.status = 'failed';
        const code = controller.signal.aborted ? 'BUDGET_EXCEEDED'
          : error&&typeof error==='object'&&'controllerCategory'in error&&error.controllerCategory==='replan_required'?'VERIFICATION_FAILED':error instanceof HttpError || error instanceof RecoveryError || error instanceof DeliveryError ? (ErrorCode.safeParse(error.code).success?ErrorCode.parse(error.code):'INVALID_REQUEST') : 'INTERNAL_ERROR';
        this.emit(item, { type: 'execution.failed', payload: { code,
          message: error instanceof Error ? error.message.slice(0, 1500) : '执行失败' } });
      }
    } finally {
      clearTimeout(timer); item.activeMs += Date.now() - startedAt; this.controllers.delete(id); this.activeSince.delete(id); this.persist();
    }
  }
  async artifact(id: string, artifactId: string, file: string) {
    const item = this.get(id);
    if (item.snapshot.artifactId !== artifactId) throw new HttpError(404, 'NOT_FOUND', 'Artifact not found');
    const root = path.join(this.options.dataDir, 'executions', id, 'artifacts', artifactId);
    if (file !== 'manifest.json') {
      const manifest = ArtifactManifest.parse(JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')));
      if (!manifest.files.some((entry) => entry.path === file)) throw new HttpError(404, 'NOT_FOUND', 'Artifact file not found');
    }
    return await readFile(await safeFile(root, file));
  }
  async close() {
    this.closed = true; clearInterval(this.timer);
    for (const controller of this.controllers.values()) controller.abort();
    await this.pumping;
  }
}

async function jsonBody(req: IncomingMessage, limit = 100000) {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw new HttpError(400, 'INVALID_REQUEST', 'Request too large'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw new HttpError(400, 'INVALID_REQUEST', 'Invalid JSON'); }
}
export function createAgentServer(options: AgentOptions) {
  if(options.trustedCleanBrowserLocale&&options.mode!=='fake')throw new Error('Controlled clean browser environment is constructor-only Fake testing');
  const broker = options.executionBackend === 'docker_linux' ? new BrokerClient(options.brokerUrl || 'http://broker:4310', options.brokerToken || '') : null;
  if(options.dockerProbe&&options.mode!=='fake')throw new Error('Unready Docker probe is restricted to explicit local Fake');
  const verification = broker ? new DockerVerification(broker,{dataDir:options.dataDir,allowUnreadyProbe:options.dockerProbe}) : undefined;
  options={...options,verification};
  const toolchainProvider=verification?()=>verification.toolchain():async()=>(await trustedTemplate()).descriptor;
  if(options.recoveryAudit&&options.mode!=='fake')throw new Error('Synthetic recovery audit is restricted to explicit Fake tests');
  let recovery!:BudgetRecoveryRuntime;const pool = new GenerationPool(); let planning!: DeliveryPlanningRuntime;
  const runtime = new AgentRuntime({ ...options,copyRecoverySource:(r,w)=>recovery.copySource(r,w), generationPool: pool, isDeliveryReserved: (id) => planning?.reserved(id) ?? false });
  planning = new DeliveryPlanningRuntime({ dataDir: path.join(options.dataDir, 'delivery'), pool, mode: options.mode,
    apiKey: options.apiKey, model: options.model, apiUrl: options.apiInternalUrl, serviceToken: options.serviceToken,
    legacyExists: (id, runId) => runtime.records.has(id) || [...runtime.records.values()].some((item) => item.request.runId === runId), executionStarted: (id) => runtime.records.has(id), adapter: options.planningAdapter, toolchainProvider, trustedHostPlan: options.trustedHostPlan });
  const delivery = new DeliveryExecutionRuntime(runtime, planning, {trustedCleanBrowserLocale:options.trustedCleanBrowserLocale, allowControlledRegression: options.allowControlledRegression, trustedSourceFault: options.trustedSourceFault }); runtime.deliveryEngine = delivery;recovery=new BudgetRecoveryRuntime(runtime,delivery,{dataDir:options.dataDir,backend:options.executionBackend,testAudit:options.recoveryAudit});
  for (const item of runtime.records.values()) if (item.delivery && ['interrupted', 'cancelled', 'failed'].includes(item.snapshot.status) && !delivery.report(item.request.executionId)) delivery.fail(item, item.snapshot.status as 'interrupted', 'Runtime restarted or execution terminated.');
  const coordinator = new CoordinatorRuntime({ ...options, mode: options.coordinationMode ?? options.mode });
  const server = createServer(async (req, res) => {
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const url = new URL(req.url || '/', 'http://runtime');
    const coordinationRequest = url.pathname.startsWith('/internal/v2/');
    const deliveryRequest = url.pathname.startsWith('/internal/delivery/v1/');
    const isolationRequest = url.pathname.startsWith('/internal/isolation/v1/');const recoveryRequest=url.pathname.startsWith('/internal/budget-recovery/v1/');const requirementsRequest=url.pathname.startsWith('/internal/requirements/v1/');
    res.setHeader(requirementsRequest?'x-atoms-requirements-version':recoveryRequest?'x-atoms-budget-recovery-version':isolationRequest ? 'x-atoms-isolation-version' : deliveryRequest ? 'x-atoms-delivery-version' : coordinationRequest ? 'x-atoms-coordination-version' : 'x-atoms-protocol-version', requirementsRequest||recoveryRequest?'0.1.0':isolationRequest ? IsolationProtocolVersion : deliveryRequest ? DeliveryProtocolVersion : coordinationRequest ? CoordinationProtocolVersion : PROTOCOL_VERSION);
    try {
      const expected = Buffer.from(`Bearer ${options.serviceToken}`); const actual = Buffer.from(req.headers.authorization || '');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new HttpError(401, 'UNAUTHENTICATED', 'Internal service authentication required');
      if(requirementsRequest){if(req.headers['x-atoms-requirements-version']!=='0.1.0')throw new CoordinationError(400,'INVALID_REQUEST','Unsupported requirements version');const route=url.pathname.match(/^\/internal\/requirements\/v1\/coordination-turns\/([a-z][a-z0-9_-]{2,127})(?:\/(events|cancel))?$/);if(!route)throw new CoordinationError(404,'NOT_FOUND','Requirements route not found');const[,id,action]=route;const outer=()=>{const record=coordinator.get(id);if(!record.requirements)throw new CoordinationError(404,'NOT_FOUND','No requirements wrapper');const wrapper=record.requirements,reference={id:wrapper.requirements.id,hash:wrapper.requirements.hash,revision:wrapper.requirements.revision},f=wrapper.coordination.deliveryFacts;return RequirementsCoordinationSnapshot.parse({protocolVersion:'0.1.0',requirementsUsed:reference,purposeUsed:wrapper.purpose,delivery:{protocolVersion:'0.1.0',coordination:record.snapshot,deliveryFactsUsed:{projectId:f.projectId,revision:f.revision,asOf:f.asOf,hash:f.hash}},interpretation:record.requirementsSnapshot?.interpretation??null});};if(!action&&req.method==='PUT'){const wrapper=RequirementsCoordinationRequest.parse(await jsonBody(req,2097152));const result=coordinator.start(wrapper.coordination.coordination,id,wrapper.coordination,wrapper);return json(result.created?201:200,outer());}if(!action&&req.method==='GET')return json(200,outer());if(action==='cancel'&&req.method==='POST'){await coordinator.cancel(id,await jsonBody(req));return json(202,outer());}if(action==='events'&&req.method==='GET'){const current=outer();return json(200,{protocolVersion:'0.1.0',requirementsUsed:current.requirementsUsed,purposeUsed:current.purposeUsed,delivery:{protocolVersion:'0.1.0',deliveryFactsUsed:current.delivery.deliveryFactsUsed,page:coordinator.events(id,(()=>{const n=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(n)||n<0)throw new CoordinationError(400,'INVALID_REQUEST','Invalid requirements cursor');return n;})(),(()=>{const n=Number(url.searchParams.get('limit')||100);if(!Number.isSafeInteger(n)||n<1||n>100)throw new CoordinationError(400,'INVALID_REQUEST','Invalid requirements page limit');return n;})())}});}throw new CoordinationError(404,'NOT_FOUND','Requirements route not found');}
      if(recoveryRequest){if(req.headers['x-atoms-budget-recovery-version']!=='0.1.0')throw new RecoveryError(400,'INVALID_REQUEST','Unsupported recovery version');const route=url.pathname.match(/^\/internal\/budget-recovery\/v1\/executions\/([a-z][a-z0-9_-]{2,127})(?:\/(confirm-stop))?$/);if(!route)throw new RecoveryError(404,'NOT_FOUND','Recovery route not found');const[,id,action]=route;if(!action&&req.method==='GET')return json(200,await recovery.view(id));if(action==='confirm-stop'&&req.method==='POST')return json(200,await recovery.confirmStop(id,await jsonBody(req)));if(!action&&req.method==='PUT'){const result=await recovery.start(await jsonBody(req,2097152),id);return json(result.created?201:200,result.snapshot);}throw new RecoveryError(404,'NOT_FOUND','Recovery route not found');}
      if (isolationRequest) {
        if (req.headers['x-atoms-isolation-version'] !== IsolationProtocolVersion) throw new HttpError(400, 'INVALID_REQUEST', 'Unsupported isolation version');
        if (url.pathname !== IsolationCapabilitiesPath || req.method !== 'GET') throw new HttpError(404, 'NOT_FOUND', 'Isolation route not found');
        return json(200, broker ? await broker.capabilities() : hostLocalCapabilities());
      }
      if (deliveryRequest) {
        if (req.headers['x-atoms-delivery-version'] !== DeliveryProtocolVersion) throw new DeliveryError(400, 'INVALID_REQUEST', 'Unsupported delivery version');
        if (url.pathname.startsWith('/internal/delivery/v1/toolchains/') && req.method === 'GET'){const descriptor=await toolchainProvider();if(url.pathname!=='/internal/delivery/v1/toolchains/'+descriptor.id)throw new DeliveryError(404,'NOT_FOUND','Toolchain not available');return json(200,descriptor);}
        const coordinationRoute = url.pathname.match(/^\/internal\/delivery\/v1\/coordination-turns\/([a-z][a-z0-9_-]{2,127})(?:\/(events|cancel))?$/);
        if (coordinationRoute) {
          const [, id, action] = coordinationRoute;
          const outer = () => { const record = coordinator.get(id); if (!record.delivery) throw new DeliveryError(404, 'NOT_FOUND', 'No delivery-aware coordination');
            const { projectId, revision, asOf, hash } = record.delivery.deliveryFacts; return { protocolVersion: DeliveryProtocolVersion, coordination: record.snapshot, deliveryFactsUsed: { projectId, revision, asOf, hash } }; };
          if (!action && req.method === 'PUT') { const wrapper = DeliveryCoordinationRequest.parse(await jsonBody(req, 2097152)); const result = coordinator.start(wrapper.coordination, id, wrapper); return json(result.created ? 201 : 200, outer()); }
          const snapshot = outer();
          if (!action && req.method === 'GET') return json(200, snapshot);
          if (action === 'events' && req.method === 'GET') { const after = Number(url.searchParams.get('after') || 0), limit = Number(url.searchParams.get('limit') || 100);
            if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new DeliveryError(400, 'INVALID_REQUEST', 'Invalid delivery cursor');
            return json(200, { protocolVersion: DeliveryProtocolVersion, deliveryFactsUsed: snapshot.deliveryFactsUsed, page: coordinator.events(id, after, limit) }); }
          if (action === 'cancel' && req.method === 'POST') { await coordinator.cancel(id, await jsonBody(req)); return json(202, outer()); }
          throw new DeliveryError(404, 'NOT_FOUND', 'Delivery coordination route not found');
        }
        const executionRoute = url.pathname.match(/^\/internal\/delivery\/v1\/executions\/([a-z][a-z0-9_-]{2,127})(?:\/(events|inputs|cancel|report|evidence\/([a-z][a-z0-9_-]{2,127})|export\/([a-z][a-z0-9_-]{2,127})))?$/);
        if (executionRoute) {
          const [, id, action, evidenceId, archiveId] = executionRoute;
          if (!action && req.method === 'PUT') { const result = await delivery.start(await jsonBody(req, 2097152), id); return json(result.created ? 201 : 200, result.snapshot); }
          const snapshot = delivery.snapshot(id);
          if (!action && req.method === 'GET') return json(200, snapshot);
          if (action === 'events' && req.method === 'GET') {
            const after = Number(url.searchParams.get('after') || 0), limit = Number(url.searchParams.get('limit') || 100);
            if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new DeliveryError(400, 'INVALID_REQUEST', 'Invalid delivery cursor');
            return json(200, { protocolVersion: DeliveryProtocolVersion, binding: snapshot.binding, page: runtime.events(id, after, limit) });
          }
          if (action === 'inputs' && req.method === 'POST') { runtime.answer(id, await jsonBody(req)); return json(202, delivery.snapshot(id)); }
          if (action === 'cancel' && req.method === 'POST') { await runtime.cancel(id, await jsonBody(req)); return json(202, delivery.snapshot(id)); }
          if (action === 'report' && req.method === 'GET') { const report = delivery.report(id); return json(200, report ? { protocolVersion: DeliveryProtocolVersion, state: 'available', binding: snapshot.report, report }
            : { protocolVersion: DeliveryProtocolVersion, state: 'pending', preparationId: runtime.get(id).delivery!.bundle.binding.preparationId, executionId: id, runId: snapshot.execution.runId, revision: snapshot.execution.revision }); }
          if (evidenceId && req.method === 'GET') { const entry = delivery.report(id)?.evidence.find((entry) => entry.id === evidenceId); res.setHeader('content-type', entry?.mediaType || 'application/octet-stream'); res.end(await delivery.evidence(id, evidenceId)); return; }
          if (archiveId && req.method === 'GET') { res.setHeader('content-type', 'application/zip'); res.end(await delivery.export(id, archiveId)); return; }
          throw new DeliveryError(404, 'NOT_FOUND', 'Delivery execution route not found');
        }
        const match = url.pathname.match(/^\/internal\/delivery\/v1\/preparations\/([a-z][a-z0-9_-]{2,127})(?:\/(events|cancel|report|evidence\/([a-z][a-z0-9_-]{2,127})))?$/);
        if (!match) throw new DeliveryError(404, 'NOT_FOUND', 'Delivery route not found');
        const [, id, action, evidenceId] = match;
        if (!action && req.method === 'PUT') { const result = await planning.start(await jsonBody(req, 2097152), id); return json(result.created ? 201 : 200, result.snapshot); }
        if (!action && req.method === 'GET') return json(200, planning.get(id).snapshot);
        if (action === 'events' && req.method === 'GET') {
          const after = Number(url.searchParams.get('after') || 0), limit = Number(url.searchParams.get('limit') || 100);
          if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new DeliveryError(400, 'INVALID_REQUEST', 'Invalid delivery cursor');
          return json(200, planning.events(id, after, limit));
        }
        if (action === 'cancel' && req.method === 'POST') { const command = DeliveryCommand.parse(await jsonBody(req)); return json(202, await planning.cancel(id, command.commandId)); }
        if (action === 'report' && req.method === 'GET') {
          const record = planning.get(id); const report = record.report;
          return json(200, report ? { protocolVersion: DeliveryProtocolVersion, state: 'available', binding: { deliveryId: report.id, reportHash: report.hash, reportRevision: report.revision, sourceSnapshotHash: null }, report }
            : { protocolVersion: DeliveryProtocolVersion, state: 'pending', preparationId: id, executionId: record.request.executionId, runId: record.request.runId, revision: record.snapshot.revision });
        }
        if (evidenceId && req.method === 'GET') { res.setHeader('content-type', 'text/plain; charset=utf-8'); res.end(await planning.evidence(id, evidenceId)); return; }
        throw new DeliveryError(404, 'NOT_FOUND', 'Delivery route not found');
      }
      if (coordinationRequest) {
        if (req.headers['x-atoms-coordination-version'] !== CoordinationProtocolVersion) throw new CoordinationError(400, 'INVALID_REQUEST', 'Unsupported coordination version');
        const route = url.pathname.match(/^\/internal\/v2\/coordination-turns\/([a-z][a-z0-9_-]{2,127})(?:\/(events|cancel))?$/);
        if (!route) throw new CoordinationError(404, 'NOT_FOUND', 'Coordination route not found');
        const [, turnId, action] = route;
        if (!action && req.method === 'PUT') {
          const result = coordinator.start(await jsonBody(req), turnId); return json(result.created ? 201 : 200, result.snapshot);
        }
        if (!action && req.method === 'GET') return json(200, coordinator.get(turnId).snapshot);
        if (action === 'events' && req.method === 'GET') {
          const after = Number(url.searchParams.get('after') || 0), limit = Number(url.searchParams.get('limit') || 100);
          if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new CoordinationError(400, 'INVALID_REQUEST', 'Invalid coordination cursor');
          return json(200, coordinator.events(turnId, after, limit));
        }
        if (action === 'cancel' && req.method === 'POST') {
          const ended = ['completed', 'failed', 'cancelled', 'interrupted'].includes(coordinator.get(turnId).snapshot.status);
          return json(ended ? 200 : 202, await coordinator.cancel(turnId, await jsonBody(req)));
        }
        throw new CoordinationError(404, 'NOT_FOUND', 'Coordination route not found');
      }
      if (req.headers['x-atoms-protocol-version'] !== PROTOCOL_VERSION) throw new HttpError(400, 'INVALID_REQUEST', 'Unsupported protocol version');
      if (url.pathname === '/internal/v1/health' && req.method === 'GET') return json(200, {
        protocolVersion: PROTOCOL_VERSION, ready: runtime.adapter.ready(),
        capabilities: { templates: ['react-vite-v1'], cancel: true, attention: true, artifacts: true },
      });
      const match = url.pathname.match(/^\/internal\/v1\/executions\/([a-z][a-z0-9_-]{2,127})(?:\/(.*))?$/);
      if (!match) throw new HttpError(404, 'NOT_FOUND', 'Route not found');
      const [, id, suffix = ''] = match;
      if (!suffix && req.method === 'PUT') { const result = runtime.start(await jsonBody(req), id); return json(result.created ? 201 : 200, result.snapshot); }
      if (!suffix && req.method === 'GET') return json(200, runtime.get(id).snapshot);
      if (suffix === 'events' && req.method === 'GET') {
        const after = Number(url.searchParams.get('after') || 0), limit = Number(url.searchParams.get('limit') || 100);
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'INVALID_REQUEST', 'Invalid event cursor');
        return json(200, runtime.events(id, after, limit));
      }
      if (suffix === 'inputs' && req.method === 'POST') return json(202, runtime.answer(id, await jsonBody(req)));
      if (suffix === 'cancel' && req.method === 'POST') {
        const wasTerminal = terminal.has(runtime.get(id).snapshot.status);
        return json(wasTerminal ? 200 : 202, await runtime.cancel(id, await jsonBody(req)));
      }
      const artifact = suffix.match(/^artifacts\/([a-z][a-z0-9_-]{2,127})\/(manifest|file)$/);
      if (artifact && req.method === 'GET') {
        const filename = artifact[2] === 'manifest' ? 'manifest.json' : url.searchParams.get('path') || '';
        const bytes = await runtime.artifact(id, artifact[1], filename);
        res.setHeader('content-type', mediaType(filename)); res.setHeader('x-content-type-options', 'nosniff'); res.end(bytes); return;
      }
      throw new HttpError(404, 'NOT_FOUND', 'Route not found');
    } catch (error) {
      const invalid = error && typeof error === 'object' && 'issues' in error;
      const known = error instanceof HttpError || error instanceof RecoveryError || error instanceof CoordinationError || error instanceof DeliveryError;
      const baseCode=known?error.code:invalid?'INVALID_REQUEST':'INTERNAL_ERROR';const code=requirementsRequest?(RequirementsError.shape.error.shape.code.safeParse(baseCode).success?baseCode:['RATE_LIMITED','BUDGET_EXCEEDED'].includes(baseCode)?'QUOTA_EXHAUSTED':baseCode==='STALE_REVISION'?'STALE_REQUIREMENTS':'RUNTIME_UNAVAILABLE'):recoveryRequest?(BudgetRecoveryError.shape.error.shape.code.safeParse(baseCode).success?baseCode:'RUNTIME_UNAVAILABLE'):baseCode;
      const status = known ? error.status : invalid ? 400 : 500;
      json(status, { error: { code, message: known ? error.message : invalid ? 'Request does not match protocol' : 'Internal runtime error',
        retryable: status === 503, requestId: `request_${randomUUID().replaceAll('-', '')}` } });
    }
  });
  return { server, runtime, coordinator, planning, delivery,recovery,
    async listen(port = 0, host = '127.0.0.1') {
      await new Promise<void>((resolve) => server.listen(port, host, resolve));
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No runtime address');
      return `http://${host}:${address.port}`;
    },
    async close() { await Promise.all([runtime.close(), coordinator.close(), planning.close()]); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}
