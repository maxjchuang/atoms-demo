import {buildCoordinatorPrompt,COORDINATOR_SYSTEM_PROMPT} from './coordinator-prompt.js';
import { saveRouterProposal } from './coordinator-diagnostics.js';
import { requirementsPrompt, scopeReviewDirective } from './requirements-context.js';
import type { RequirementsCoordinationRequestDto } from '@atoms/contracts/requirements';
import { DSH_NATIVE_READONLY_ENV } from './dsh-native-env.js';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DeepSeekHarnessOptions } from '@deepseek-ai/dsh-sdk-client';
import type { StartCoordinationRequestDto } from '@atoms/contracts/conversation';
import { verifyDshToolPolicy } from './dsh-policy.js';
import { sha256 } from './files.js';
import { parseModelJson } from './structured-output.js';
import { buildAliases, CoordinationError, type SemanticDecision, type SourceRead } from './coordination-context.js';
import type { DeliveryFactsDto } from '@atoms/contracts/delivery';
import { ProjectSessionFence } from './project-session-fence.js';
import { NativeUsageAccounting, UsageAccountingError, nativeEventIdentity, type NativeTokenUsage } from './native-usage.js';

export interface CoordinationModelContext {
  validationFeedback?:{kind:'requirements_mapping'|'coordinator_structure';issues:{code:string;path:(string|number)[];refs:string[]}[];rule:string};requirements?:RequirementsCoordinationRequestDto; deliveryFacts?: DeliveryFactsDto; request: StartCoordinationRequestDto; signal: AbortSignal;
  projectHome: string; stableWorkspace: string; sources: SourceRead[];
  report: (text: string) => void;
  meter: (usage: { modelSteps?: number; inputTokens?: number; outputTokens?: number }) => void;
  remainingOutputTokens: () => number;
  excludedTurnIds: ReadonlySet<string>;
}
export interface CoordinatorAdapter {
  readonly mode: 'fake' | 'dsh';
  ready(): boolean;
  decide(context: CoordinationModelContext, retry: boolean): Promise<SemanticDecision>;
  close(turnId: string): Promise<void>;
  commit?(projectId: string, turnId: string): Promise<void>;
  invalidate?(projectId: string): Promise<void>;
}
const assertActive = (signal: AbortSignal) => { if (signal.aborted) throw new Error('Coordination aborted'); };
const base = { references: [], memoryUpdates: [] };

/** Explicit deterministic examples, never a production intent classifier. */
export class FakeCoordinatorAdapter implements CoordinatorAdapter {
  readonly mode = 'fake' as const;
  ready() { return true; }
  async decide(context: CoordinationModelContext, _retry: boolean): Promise<SemanticDecision> {
    const { request } = context; assertActive(context.signal); context.meter({ modelSteps: 1 });
    context.report('当前为显式 Fake Router：仅用于协议和确定性场景验证，不代表真实语义模型。');
    if (request.content.includes('[slow]')) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 500);
      context.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Coordination aborted')); }, { once: true });
    });
    if(context.requirements&&context.requirements.purpose.kind==='scope_review'){const q=context.requirements;const entries=q.requirements.entries.filter(e=>e.state==='active'&&e.authorization!=='suggested');const refs=entries.map(e=>'q'+q.requirements.entries.indexOf(e));return{kind:'change_proposal',origin:'explicit_request',summary:'Explicit Fake complete review, no execution',goal:(q.requirements.base.kind==='empty_project'?'从零完整实现：':'基于实际发布版本修改：')+entries.map(e=>e.text).join('；'),acceptance:entries.map(e=>({description:e.text})),evidence:[{message:'u0',quote:request.content}],references:[],memoryUpdates:[],scope:{implementation:q.requirements.base.kind==='empty_project'?'new_app':'modify_app',included:refs,exclusions:q.requirements.entries.filter(e=>e.state==='active'&&e.authorization==='suggested').map(e=>({ref:'q'+q.requirements.entries.indexOf(e),reason:'unaccepted_suggestion'})),coverage:refs.map((ref,i)=>({acceptanceIndex:i,requirements:[ref]})),kind:'goal'}};}
    const aliases = buildAliases(request, context.excludedTurnIds);
    const evidence = [{ message: 'u0', quote: request.content.slice(0, 1000) }];
    if (request.operation.kind === 'proposal_refresh') {
      const proposalId = request.operation.proposalId;
      const previous = request.context.relevantProposals.find((item) => item.id === proposalId)!;
      return { kind: 'change_proposal', summary: previous.summary, goal: previous.goal,
        acceptance: previous.acceptance, basePolicy: 'exact_version', evidence, ...base };
    }
    if (request.operation.kind === 'clarification_answer') {
      const operation = request.operation;
      const answer = operation.answer.kind === 'selection' ? operation.answer.label : operation.answer.content;
      if (answer === '说明如何分享') return { kind: 'consult', answer: request.context.facts.deployment.publicDeployment
        ? '已有公开部署能力，请使用界面的分享操作。' : '当前仅本机预览，尚无公网分享链接；可下载源码后部署。', ...base };
      return { kind: 'change_proposal', summary: `根据已绑定的问题继续：${answer}`,
        goal: `${operation.questionSnapshot.question}；已确认：${answer}`,
        acceptance: [{ description: '应用符合该次明确回答的要求' }], evidence, ...base };
    }
    const input = request.operation.input;
    if (input.kind === 'status' || /^(现在|当前|任务).*(状态|进度)|^进度如何/.test(request.content)) {
      return { kind: 'status', answer: request.context.facts.runs.length ? '任务状态以当前可信快照为准。' : '当前没有正在运行的任务。',
        references: aliases.runs.map((item) => ({ kind: 'run', ref: item.alias })), memoryUpdates: [] };
    }
    if (input.kind === 'sharing_help' || /如何分享|怎么分享|分享给别人/.test(request.content)) {
      return { kind: 'consult', answer: request.context.facts.deployment.publicDeployment
        ? '当前已有公开部署能力，请使用界面的可用分享操作。'
        : '当前预览仅限本机，尚不能作为公网链接分享。可使用源码下载；公网分享需要完成部署。',
        references: aliases.actions.map((item) => ({ kind: 'available_action', ref: item.alias })), memoryUpdates: [] };
    }
    if (request.content === '帮我处理分享') return { kind: 'clarify', question: '你是想了解如何分享，还是要修改应用增加分享入口？',
      options: [{ label: '说明如何分享' }, { label: '给应用增加分享入口' }], allowText: true, ...base };
    const readMarker = request.content.match(/\[read-source:([^\]]+)\]/);
    if (readMarker && context.sources.length === 0) return { kind: 'read_sources', paths: readMarker[1].split(',') };
    if (context.sources.length) return { kind: 'consult', answer: '已读取授权的发布版本源码。源码内容只作为解释依据，不授予执行权限。',
      references: context.sources.map((source) => ({ kind: 'file', path: source.path })), memoryUpdates: [] };
    if (/停止|取消生成/.test(request.content)) {
      const candidates = aliases.runs.filter((item) => ['queued', 'running', 'waiting_input', 'cancelling'].includes(item.value.status));
      if (candidates.length !== 1) return { kind: 'clarify', question: '需要停止哪一个任务？',
        options: candidates.map((item) => ({ label: `任务 ${item.value.id}` })), allowText: true, ...base };
      return { kind: 'control', targetRun: candidates[0].alias, evidence, ...base };
    }
    if (/^(可以|好的|就这样)[。！!]?\s*$/.test(request.content)) return { kind: 'clarify',
      question: '你希望确认哪项建议或执行什么修改？', options: [], allowText: true, ...base };
    if (/记住|偏好.*改成|偏好.*是/.test(request.content) && !/什么|哪种|记得/.test(request.content)) {
      const active = aliases.decisions.find((item) => item.value.status === 'active' && item.value.kind === 'preference');
      return { kind: 'consult', answer: '已记录这条明确表达的偏好，最终记忆由服务端核对来源后保存。', references: [],
        memoryUpdates: [{ kind: 'preference', message: 'u0', quote: request.content, supersedes: active?.alias ?? null }] };
    }
    if (/偏好|记得|决定/.test(request.content)) return { kind: 'consult', answer: aliases.decisions.filter((item) => item.value.status === 'active').map((item) => item.value.text).join('；') || '当前没有已确认的项目决定。',
      references: aliases.decisions.filter((item) => item.value.status === 'active').map((item) => ({ kind: 'decision', ref: item.alias })), memoryUpdates: [] };
    if (/^(增加|新增|修改|把|请增加|请修改|帮我增加|创建|做一个)/.test(request.content)) return { kind: 'change_proposal',
      summary: request.content, goal: request.content, origin: 'explicit_request', acceptance: [{ description: '实现并验证用户明确提出的修改' }], evidence, ...base };
    return { kind: 'consult', answer: '这是显式 Fake Router 的只读样例回答。真实问答需要使用 DSH 模式。', ...base };
  }
  async close(_turnId: string) { }
}

export class DshCoordinatorAdapter implements CoordinatorAdapter {
  readonly mode = 'dsh' as const;
  private harnesses = new Map<string, { close(): Promise<void> }>();
  private projectHomes = new Map<string, string>();
  constructor(private options: { apiKey?: string; model?: string; harnessFactory?: (options: DeepSeekHarnessOptions) => import('@deepseek-ai/dsh-sdk-client').DeepSeekHarness }) { }
  ready() { return Boolean(this.options.apiKey); }
  async decide(context: CoordinationModelContext, retry: boolean): Promise<SemanticDecision> {
    assertActive(context.signal);
    if (!this.options.apiKey) throw new CoordinationError(503, 'RUNTIME_UNAVAILABLE', 'DeepSeek credentials are not configured');
    const remaining = context.remainingOutputTokens();
    if (remaining <= 0) throw new CoordinationError(400, 'BUDGET_EXCEEDED', 'Coordination output budget exhausted');
    const prepared=buildCoordinatorPrompt(context,retry);await mkdir(context.projectHome,{recursive:true});await appendFile(path.join(context.projectHome,'model-input-projections.jsonl'),JSON.stringify(prepared.metadata)+'\n',{mode:0o600});
    const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client');
    await mkdir(context.projectHome, { recursive: true }); await mkdir(context.stableWorkspace, { recursive: true });
    this.projectHomes.set(context.request.projectId, context.projectHome);
    const generation = new ProjectSessionFence(context.projectHome).begin(context.request.turnId);
    const patch = path.join(context.projectHome, 'atoms-no-tools.yml');
    await writeFile(patch, ['tool-fs', 'tool-working-directory', 'persistent-bash', 'persistent-pwsh']
      .map((id) => `- id: ${id}\n  disabled: true\n`).join('\n'));
    verifyDshToolPolicy(context.projectHome, patch);
    const model = this.options.model || 'deepseek-flash';
    const harness = (this.options.harnessFactory || ((options) => new DeepSeekHarness(options)))({ profile: 'sdk-minimal', patches: [patch],
      cwd: context.stableWorkspace, processCwd: context.stableWorkspace, dshHome: context.projectHome,
      provider: 'deepseek-official', model, reasoningEffort: 'low' as DeepSeekHarnessOptions['reasoningEffort'],
      maxTokens: Math.min(remaining, 4000), initializeTimeoutMs: 30000,
      requestTimeoutMs: context.request.budget.maxWallTimeMs, disposeEofGraceMs: 1000, disposeGraceMs: 1000,
      env: { ...DSH_NATIVE_READONLY_ENV, PATH: process.env.PATH, HOME: context.projectHome, DEEPSEEK_API_KEY: this.options.apiKey,
        DSH_SYSTEM_PROMPT: COORDINATOR_SYSTEM_PROMPT },
    });
    this.harnesses.set(context.request.turnId, harness);
    const onAbort = () => { void harness.close(); };
    const accounting = new NativeUsageAccounting();
    context.signal.addEventListener('abort', onAbort, { once: true });
    try {
      context.report('正在恢复项目协调会话与最新可信上下文。');
      await harness.start();
      const markerFile = path.join(context.projectHome, `router-session-${generation}.json`);
      // Requirements/memory are API-owned durable context. Never replay opaque native
      // history alongside that full snapshot: it duplicates every earlier scope.
      const freshSnapshotSession = context.requirements !== undefined;
      const marker = !freshSnapshotSession && existsSync(markerFile) ? JSON.parse(await readFile(markerFile, 'utf8')) as { sessionId: string; model: string } : null;
      if (marker && marker.model !== model) throw new CoordinationError(409, 'INFERENCE_INTERRUPTED', 'Project Router model changed; explicit context migration is required');
      const sessionName = freshSnapshotSession
        ? `router_${sha256(context.request.projectId).slice(0,16)}_turn_${sha256(context.request.turnId).slice(0,16)}_${randomUUID().replaceAll('-','')}`
        : `router_${sha256(context.request.projectId).slice(0, 24)}_g${generation}`;
      const session = marker ? await harness.resumeSession(marker.sessionId) : harness.session(sessionName);
      context.report('项目协调会话已就绪，正在理解本次消息。');
      const prompt=prepared.prompt;
      const result = await session.run(prompt, { onNotification(notification) {
        if (notification.method !== 'session.event') return;
        const event = notification.params.event as { type?: string; seq?: unknown; data?: { turn?: unknown; step?: unknown; usage?: NativeTokenUsage } } | undefined;
        const identity = event ? nativeEventIdentity(notification.params.sessionId, event) : undefined;
        if (event?.type === 'step/start' && accounting.step(identity)) context.meter({ modelSteps: 1 });
        if (event?.type === 'assistant/message' && event.data?.usage) {
          const usage = accounting.add(identity, event.data.usage);
          if (usage) context.meter({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
        }
      } });
      assertActive(context.signal);
      try { accounting.assertObservable(); }
      catch (error) { if (error instanceof UsageAccountingError) throw new CoordinationError(400, 'BUDGET_EXCEEDED', '模型未提供可核验用量，项目协调不会继续推理或派生操作。'); throw error; }
      if (!freshSnapshotSession) await writeFile(markerFile, JSON.stringify({ sessionId: result.sessionId, model }));
      await appendFile(path.join(context.projectHome, 'coordination-diagnostics.jsonl'), JSON.stringify({
        time: new Date().toISOString(), turnId: context.request.turnId, finishReason: result.finishReason,
        responseLength: result.finalResponse.length, sessionContext: freshSnapshotSession ? 'authoritative_snapshot' : 'legacy_native_history', promptBytes: Buffer.byteLength(prompt),
      }) + '\n');
      if (['error', 'aborted'].includes(result.finishReason || '')) throw new CoordinationError(503, 'RUNTIME_UNAVAILABLE', 'Project Router model request did not complete');
      const raw = parseModelJson({ text: result.finalResponse, finishReason: result.finishReason }, 'coordinator');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof (raw as { kind?: unknown }).kind !== 'string') {
        throw new CoordinationError(400, 'INVALID_REQUEST', 'Project Router returned an invalid semantic result');
      }
      await saveRouterProposal(context.projectHome,context.request.turnId,raw,context.request.budget.maxModelSteps);
      return raw as SemanticDecision;
    } finally {
      await appendFile(path.join(context.projectHome, 'token-accounting.jsonl'), JSON.stringify({
        time: new Date().toISOString(), turnId: context.request.turnId, ...accounting.metadata(),
      }) + '\n').catch(() => {});
      context.signal.removeEventListener('abort', onAbort);
      await harness.close(); this.harnesses.delete(context.request.turnId);
    }
  }
  async close(turnId: string) { await this.harnesses.get(turnId)?.close(); }
  async commit(projectId: string, turnId: string) {
    const home = this.projectHomes.get(projectId); if (home) new ProjectSessionFence(home).commit(turnId);
  }
  async invalidate(projectId: string) {
    const home = this.projectHomes.get(projectId); if (home) new ProjectSessionFence(home).invalidate();
  }
}
