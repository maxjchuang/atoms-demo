import {namespaceCleanRound,cleanBehaviorFailures} from './clean-round.js';
import { preserveAttemptSource } from './source-snapshot.js';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DeliveryExecutionRequest, DeliveryExecutionSnapshot, FreezeDeliveryPlanRequest, DeliveryReport, VerificationAttempt,
  deriveCriterionGaps, deriveDeliveryQuality, canonicalDeliveryJson, type DeliveryExecutionRequestDto, type DeliveryReportDto,
  type VerificationEvidenceBinding, type DeliveryReportDataDto } from '@atoms/contracts/delivery';
import { Check } from '@atoms/contracts';
import type { AgentRuntime, RecordValue } from './runtime.js';
import type { AdapterContext } from './adapters.js';
import { DeliveryError, type DeliveryPlanningRuntime } from './delivery-planning.js';
import { trustedTemplate } from './trusted-template.js';
import { assertSealed, seal, sameToolchain, fingerprints, inventoryHash } from './delivery-files.js';
import { putFile, safeFile, sha256, listFiles } from './files.js';
import type { TrustedSourceFault } from './controlled-repair.js';
import { assertControlledSource } from './source-policy.js';
import { verifyApplication } from './verify.js';
import { runBrowserPlan,assertGeometryObservationBudget } from './browser-dsl.js';
import { evidenceFiles, exportAndVerify, notRunCases, remapEvidenceIds } from './delivery-export.js';

type Evidence = ReturnType<typeof VerificationEvidenceBinding.parse>;
type Attempt = ReturnType<typeof VerificationAttempt.parse>;
type State = {cleanRounds?:{index:number;sourceHash:string;archiveHash:string;cleanHash:string;receiptEvidenceId:string}[]; phase?: 'clean_export'; attempts: Attempt[]; evidence: Evidence[]; report: DeliveryReportDto | null };
const now = () => new Date().toISOString();
export class DeliveryExecutionRuntime {
  private states = new Map<string, State>();
  constructor(readonly runtime: AgentRuntime, readonly planning: DeliveryPlanningRuntime, private options: {trustedCleanBrowserLocale?:string; allowControlledRegression?: boolean; trustedSourceFault?: TrustedSourceFault }) {}
  private root(id: string) { return path.join(this.runtime.options.dataDir, 'executions', id); }
  private state(id: string) {
    let state = this.states.get(id); if (!state) {
      const filename = path.join(this.root(id), 'delivery-state.json');
      state = existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8')) as State : { attempts: [], evidence: [], report: null };
      this.states.set(id, state);
    } return state;
  }
  private persist(id: string) { const filename = path.join(this.root(id), 'delivery-state.json'); mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename + '.tmp', JSON.stringify(this.state(id))); renameSync(filename + '.tmp', filename); }
  async start(raw: unknown, id: string) {
    const wrapper = DeliveryExecutionRequest.parse(raw); if (wrapper.execution.executionId !== id) throw new DeliveryError(400, 'INVALID_REQUEST', 'Execution ID mismatch');
    const prep = this.planning.get(wrapper.bundle.binding.preparationId);
    if (prep.report) throw new DeliveryError(409, 'CONFLICT', 'Preparation was cancelled or failed and cannot execute');
    FreezeDeliveryPlanRequest.parse({ preparationRequest: prep.request, preparation: prep.snapshot, bundle: wrapper.bundle });
    for (const value of [wrapper.bundle.seed, wrapper.bundle.spec, wrapper.bundle.plan, wrapper.bundle.binding]) {
      try { assertSealed(value); } catch { throw new DeliveryError(400, 'BINDING_MISMATCH', 'Frozen object fingerprint mismatch'); }
    }
    if (!sameToolchain(wrapper.bundle.binding.toolchain, this.runtime.options.verification?await this.runtime.options.verification.toolchain():(await trustedTemplate()).descriptor)) throw new DeliveryError(409, 'BINDING_MISMATCH', 'Trusted toolchain changed since planning');
    const previous = this.runtime.records.get(id);
    if (previous && (!previous.delivery || canonicalDeliveryJson(previous.delivery) !== canonicalDeliveryJson(wrapper))) throw new DeliveryError(409, 'CONFLICT', 'Immutable execution wrapper changed');
    const result = this.runtime.start(wrapper.execution, id, wrapper); return { created: result.created, snapshot: this.snapshot(id) };
  }
  snapshot(id: string) {
    const item = this.runtime.get(id); if (!item.delivery) throw new DeliveryError(404, 'NOT_FOUND', 'No delivery execution');
    const binding = item.delivery.bundle.binding; const report = this.state(id).report;
    const usage = item.usage; const live = this.runtime.activeSince.get(id); const activeMs = item.activeMs + (live ? Date.now() - live : 0);
    const phase = item.snapshot.status === 'succeeded' ? 'completed' : ['failed', 'cancelled', 'interrupted', 'accepted'].includes(item.snapshot.status) ? item.snapshot.status
      : item.snapshot.phase === 'repairing' ? 'repairing' : item.snapshot.phase === 'verifying' ? 'verifying' : 'implementing';
    return DeliveryExecutionSnapshot.parse({ protocolVersion: '0.1.0', execution: item.snapshot, binding: { id: binding.id, hash: binding.hash }, phase: !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(item.snapshot.status) && this.state(id).phase === 'clean_export' ? 'clean_export' : phase,
      report: report ? { deliveryId: report.id, reportHash: report.hash, reportRevision: report.revision, sourceSnapshotHash: report.attempts.at(-1)?.sourceBeforeHash ?? null } : null,
      cumulativeUsage: { activeMs: binding.planningUsage.activeMs + activeMs, modelSteps: binding.planningUsage.modelSteps + usage.modelSteps,
        inputTokens: item.usageKnown === false ? null : binding.planningUsage.inputTokens + usage.inputTokens, outputTokens: item.usageKnown === false ? null : binding.planningUsage.outputTokens + usage.outputTokens } });
  }
  async initialize(item: RecordValue, workspace: string) {
    assertGeometryObservationBudget(item.delivery!.bundle.plan);
    const template = await trustedTemplate(); if (!sameToolchain(item.delivery!.bundle.binding.toolchain, this.runtime.options.verification?await this.runtime.options.verification.toolchain():template.descriptor)) throw new Error('Trusted template fingerprint mismatch');
    for (const [name, content] of Object.entries(template.files)) if (!name.startsWith('src/') && name !== 'index.html') await putFile(workspace, name, content);
    return { summary: item.delivery!.bundle.seed.goal, tasks: ['实现已冻结的目标与浏览器交互约定', '真实检查并保留失败与修复证据', '精确导出并在独立目录复验'],
      acceptance: item.delivery!.bundle.spec.criteria.map((criterion) => ({ id: criterion.id, description: criterion.description })) };
  }
  context(item: RecordValue, context: AdapterContext) {
    context.frozenTestPlan = item.delivery!.bundle.plan;context.frozenSpecification=item.delivery!.bundle.spec;
    context.deliveryProfileId = this.planning.get(item.delivery!.bundle.binding.preparationId).request.profileHint?.id
      || (item.delivery!.bundle.seed.goal.includes('[calculator]') && this.runtime.adapter.mode === 'fake' ? 'profile_calculator_v1' : 'profile_notes_v1');
  }
  async verify(item: RecordValue, workspace: string, context: AdapterContext,beforeVerification?:()=>Promise<void>) {
    const bundle = item.delivery!.bundle, state = this.state(item.request.executionId); const index = state.attempts.length;
    const attemptId = `attempt_${index}_${item.request.executionId}`; const relative = `attempt_${index}`;
    const dir = path.join(this.root(item.request.executionId), 'evidence', relative); await mkdir(dir, { recursive: true });
    let sourceProvenance: Attempt['sourceProvenance'] = { kind: 'model_output', adapterMode: this.runtime.adapter.mode };
    if (index === 0 && this.options.trustedSourceFault) {
      const baseFiles = await fingerprints(workspace, 'source/'); const base = inventoryHash(baseFiles);
      const controlled = path.join(this.root(item.request.executionId), 'controlled'); await mkdir(controlled, { recursive: true });
      for (const file of baseFiles) await putFile(controlled, 'base/' + file.path, await readFile(await safeFile(workspace, file.path.slice(7))));
      const fault = await this.options.trustedSourceFault({ workspace, plan: bundle.plan, signal: context.signal, baselineEvidenceDir: path.join(controlled, 'baseline-evidence'), report: context.report });
      if (inventoryHash(await fingerprints(workspace, 'source/')) !== base) throw new Error('Trusted fault hook changed source before the recorded patch');
      if (!fault.edits.length || fault.origin.sourceHash !== base || new Set(fault.edits.map(edit => edit.path)).size !== fault.edits.length) throw new Error('Controlled fault baseline or edit set mismatch');
      const edits = [];
      for (const edit of fault.edits) {
        if (!edit.path.startsWith('src/') || !/\.(tsx?|css|json)$/.test(edit.path)) throw new Error('Controlled fault path must stay in permitted source files');
        const target = await safeFile(workspace, edit.path);
        const before = await readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if ((before === null ? null : sha256(before)) !== edit.expectedBeforeSha256 || edit.after === before) throw new Error('Controlled fault file fingerprint mismatch');
        edits.push({ path: edit.path, before, after: edit.after, beforeHash: before === null ? null : sha256(before), afterHash: sha256(edit.after) });
      }
      for (const edit of edits) { await putFile(workspace, edit.path, edit.after); context.fileChanged({ path: edit.path, operation: edit.before === null ? 'added' : 'modified' }); }
      const injected = inventoryHash(await fingerprints(workspace, 'source/'));
      for (const file of await fingerprints(workspace, 'source/')) await putFile(controlled, 'injected/' + file.path, await readFile(await safeFile(workspace, file.path.slice(7))));
      const patch = canonicalDeliveryJson({ kind: 'controlled_regression', edits, explanation: fault.explanation, origin: fault.origin, baseSourceHash: base, injectedSourceHash: injected, originalPlanHash: fault.origin.originalPlanHash, frozenPlanHash: bundle.plan.hash });
      await putFile(dir, 'controlled-patch.json', patch);
      sourceProvenance = { kind: 'controlled_regression', baseSourceHash: base, patchHash: sha256(patch), injectedSourceHash: injected, patchEvidenceId: `evidence_attempt_${index}_controlled-patch` };
      context.report('可信测试已对已核验源码副本注入受控故障；不是新模型生成或自然模型缺陷。原计划/断言未变。');
    } else if (index === 0 && this.options.allowControlledRegression && this.runtime.adapter.mode === 'fake' && item.request.prompt.includes('[controlled-persistence]')) {
      const base = inventoryHash(await fingerprints(workspace, 'source/')); const target = 'src/App.tsx'; const before = await readFile(await safeFile(workspace, target), 'utf8');
      const after = before.replace('useEffect(() => localStorage.setItem(key, JSON.stringify(notes)), [notes]);', 'useEffect(() => {}, [notes]);');
      if (after === before) throw new Error('Controlled regression target does not match explicit Fake sample');
      await putFile(workspace, target, after);
      const patch = canonicalDeliveryJson({ kind: 'controlled_regression', target: 'source/' + target, beforeHash: sha256(before), afterHash: sha256(after), change: 'Remove Fake sample persistence effect for a controlled regression test.' });
      await putFile(dir, 'controlled-patch.json', patch);
      sourceProvenance = { kind: 'controlled_regression', baseSourceHash: base, patchHash: sha256(patch), injectedSourceHash: inventoryHash(await fingerprints(workspace, 'source/')), patchEvidenceId: `evidence_attempt_${index}_controlled-patch` };
      context.report('宿主测试显式注入了持久化受控回归；此失败不代表模型自然缺陷。');
    }
    await beforeVerification?.();
    const sourceBeforeHash = inventoryHash(await fingerprints(workspace, 'source/')); await preserveAttemptSource({workspace,root:path.join(this.root(item.request.executionId),'source-snapshots'),attemptIndex:index,maxAttempts:item.request.budget.maxRepairRounds+1,maxBytes:item.request.budget.maxArtifactBytes,expectedHash:sourceBeforeHash}); const startedAt = now();
    let interruption: unknown; let browserInterrupted = false; let checked: { checks: ReturnType<typeof Check.parse>[]; errors: string | null;failureCategory?:'code_check'|'infrastructure' } = { checks: [], errors: null };
    let cases = notRunCases(bundle, 'A required application build/smoke gate failed.');
    try {
      try{await assertControlledSource(workspace);}catch(error){throw Object.assign(error instanceof Error?error:new Error('Source policy failed'),{controllerCategory:'trust'});}
      checked = this.runtime.options.verification?await this.runtime.options.verification.verifyApplication(workspace,dir,context.signal,()=>{},context.report,{executionId:item.request.executionId,bindingHash:bundle.binding.hash,expectedToolchainId:bundle.binding.toolchain.id,attemptId,generation:item.isolationGeneration!,remainingMs:context.remainingActiveMs!()}):await verifyApplication(workspace, dir, context.signal, () => {}, context.report);
      if (!checked.errors) { context.report(`开始执行冻结浏览器验收：${bundle.plan.cases.length} 个用例。`);
      const browser = this.runtime.options.verification?await this.runtime.options.verification.runBrowserPlan({dist:path.join(workspace,'dist'),plan:bundle.plan,evidenceDir:dir,signal:context.signal},{executionId:item.request.executionId,bindingHash:bundle.binding.hash,expectedToolchainId:bundle.binding.toolchain.id,attemptId,generation:item.isolationGeneration!,remainingMs:context.remainingActiveMs!()}):await runBrowserPlan({ dist: path.join(workspace, 'dist'), plan: bundle.plan, evidenceDir: dir, signal: context.signal }); cases = browser.caseResults;
      if (browser.interrupted) { browserInterrupted = true; interruption = new DeliveryError(422, 'BUDGET_EXCEEDED', 'Frozen browser verification was interrupted by its bounded budget.'); } }
    } catch (error) { interruption = error; checked.errors = 'Verification was interrupted before all gates completed.'; await putFile(dir, 'interruption.log', checked.errors); }
    const sourceAfterHash = inventoryHash(await fingerprints(workspace, 'source/'));
    const evidence = await evidenceFiles(dir, relative, 'verification', bundle, sourceBeforeHash, attemptId, `evidence_attempt_${index}`);
    cases = remapEvidenceIds(cases, evidence); state.evidence.push(...evidence);
    const gates = Object.fromEntries(['typecheck', 'build', 'smoke'].map((kind) => { const actual = checked.checks.find((entry) => entry.kind === kind);
      return [kind, actual ? { status: actual.status, evidenceIds: [evidence.find((entry) => entry.path.endsWith(`/${kind}.log`))!.id], reason: actual.status === 'passed' ? null : actual.summary }
        : { status: 'not_run', evidenceIds: [], reason: 'A prior required gate failed.' }]; }));
    const distHash = checked.errors ? null : inventoryHash(await fingerprints(path.join(workspace, 'dist'), 'dist/'));
    const failedCases = cases.filter((entry) => entry.status === 'failed'); const incomplete = cases.some((entry) => entry.status === 'not_run');
    const attempt = VerificationAttempt.parse(seal({ id: attemptId, hash: '0'.repeat(64), runId: item.request.runId, executionId: item.request.executionId,
      bindingHash: bundle.binding.hash, specHash: bundle.spec.hash, planHash: bundle.plan.hash, repairRound: index,
      previousAttemptId: state.attempts.at(-1)?.id ?? null, sourceBeforeHash, sourceAfterHash, distHash,
      lockfileHash: sha256(await readFile(path.join(workspace, 'pnpm-lock.yaml'))), toolchainId: bundle.binding.toolchain.id, sourceProvenance,
      status: interruption ? (browserInterrupted ? 'interrupted' : context.signal.aborted ? (context.signal.reason === 'budget' ? 'interrupted' : 'cancelled') : 'invalid') : sourceBeforeHash !== sourceAfterHash ? 'invalid' : checked.errors || failedCases.length ? 'failed' : incomplete ? 'incomplete' : 'passed',
      checks: gates, caseResults: cases, startedAt, finishedAt: now() }));
    if(index>0){const previous=JSON.parse(await readFile(path.join(this.root(item.request.executionId),'source-snapshots','attempt_'+(index-1),'manifest.json'),'utf8'));const current=JSON.parse(await readFile(path.join(this.root(item.request.executionId),'source-snapshots','attempt_'+index,'manifest.json'),'utf8'));const old=new Map<string,string>(previous.files.map((f:{path:string;sha256:string})=>[f.path,f.sha256]));const next=new Map<string,string>(current.files.map((f:{path:string;sha256:string})=>[f.path,f.sha256]));const changes=[...new Set([...old.keys(),...next.keys()])].filter(p=>old.get(p)!==next.get(p)).sort().map(p=>({path:p,operation:!old.has(p)?'added':!next.has(p)?'deleted':'modified'}));context.sourceDeltaSummary={fromSourceHash:previous.sourceSnapshotHash,toSourceHash:current.sourceSnapshotHash,files:changes.slice(0,20),omittedFiles:Math.max(0,changes.length-20)};}
    state.attempts.push(attempt);context.passedCaseIds=cases.filter(c=>c.status==='passed').map(c=>c.caseId); this.persist(item.request.executionId); this.makeReport(item, 'running', null);
    if (interruption){if(context.signal.aborted||interruption instanceof (await import('./isolation/client.js')).StopUnconfirmedError)throw interruption;throw Object.assign(interruption instanceof Error?interruption:new Error('Verification failed'),{controllerCategory:(interruption as {controllerCategory?:string}).controllerCategory??(browserInterrupted?'budget':'infrastructure')});}
    const checks = checked.checks.map((check) => ({ ...check, evidenceIds: evidence.filter((entry) => check.kind === 'smoke' ? /\/(smoke.log|screenshot.png)$/.test(entry.path) : entry.path.endsWith(`/${check.kind}.log`)).map((entry) => entry.id) }));
    const requiredCases = new Set(bundle.plan.coverage.filter((coverage) => bundle.spec.criteria.find((criterion) => criterion.id === coverage.criterionId)?.required).flatMap((coverage) => coverage.caseIds));
    const requiredFailed = cases.filter((entry) => requiredCases.has(entry.caseId) && entry.status === 'failed');
    const errors = sourceBeforeHash !== sourceAfterHash ? 'Verification changed source; immutable attempt is invalid.' : checked.errors || (requiredFailed.length ? JSON.stringify(requiredFailed.map((entry) => ({ caseId: entry.caseId, failure: entry.failure }))) : null);
    checks.push({ id: 'check_behavior', kind: 'behavior', name: '冻结行为结果（准入见交付报告）', required: false, status: cases.some((entry) => entry.status === 'failed') ? 'failed' : !cases.length || cases.some((entry) => entry.status === 'not_run') ? 'not_run' : 'passed',
      summary: `${cases.filter((entry) => entry.status === 'passed').length}/${cases.length} 自动用例通过；未覆盖声明保留在交付报告。`, evidenceIds: cases.flatMap((entry) => entry.evidenceIds) });
    context.report(`冻结浏览器验收结束：${cases.filter((entry) => entry.status === 'passed').length}/${cases.length} 用例通过；证据已绑定当前源码。`);
    for (const check of checks) this.runtime.checkEvent(item, check);
    return { checks, errors,failureCategory:errors?(sourceBeforeHash!==sourceAfterHash?'trust' as const:checked.errors?(checked.failureCategory??'infrastructure'):'required_behavior' as const):undefined };
  }
  private makeReport(item: RecordValue, lifecycle: DeliveryReportDto['lifecycle'], failure: DeliveryReportDto['failure'], exported: DeliveryReportDto['exportManifest'] = null, clean: DeliveryReportDto['cleanBuild'] = null) {
    const state = this.state(item.request.executionId); const report: DeliveryReportDataDto = { protocolVersion: '0.1.0', id: `delivery_${item.request.runId}`, hash: '0'.repeat(64), revision: (state.report?.revision || 0) + 1,
      final: lifecycle !== 'running', projectId: item.request.projectId, runId: item.request.runId, executionId: item.request.executionId,
      preparationId: item.delivery!.bundle.binding.preparationId, lifecycle, seed: item.delivery!.bundle.seed, bundle: item.delivery!.bundle,
      attempts: state.attempts, finalAttemptId: state.attempts.at(-1)?.id ?? null, exportManifest: exported, cleanBuild: clean,
      evidence: state.evidence, quality: 'pending', gaps: [], failure, policyRevision: 'delivery-auto-v1', updatedAt: now() };
    report.quality = deriveDeliveryQuality(report); report.gaps = deriveCriterionGaps(report); state.report = DeliveryReport.parse(seal(report)); this.persist(item.request.executionId); return state.report;
  }
  async finish(item: RecordValue, workspace: string, context: AdapterContext) {
    const state=this.state(item.request.executionId),bundle=item.delivery!.bundle;state.phase='clean_export';state.cleanRounds??=[];
    const round=state.cleanRounds.length;if(round>item.request.budget.maxRepairRounds)throw new DeliveryError(422,'BUDGET_EXCEEDED','Clean-round budget exhausted');
    const roundRoot=path.join(this.root(item.request.executionId),'delivery','round_'+round);await mkdir(path.dirname(roundRoot),{recursive:true});await mkdir(roundRoot,{recursive:false});
    this.persist(item.request.executionId);context.report(`开始第${round+1}轮精确源码 ZIP 独立安装与冻结复验；保留前轮证据。`);
    const result=await exportAndVerify({workspace,root:roundRoot,bundle,signal:context.signal,activity:context.report,trustedBrowserLocale:this.options.trustedCleanBrowserLocale,...(this.runtime.options.verification?{isolatedClean:(options:Parameters<import('./delivery-export.js').IsolatedClean>[0])=>this.runtime.options.verification!.cleanArchive(options,{executionId:item.request.executionId,bindingHash:bundle.binding.hash,expectedToolchainId:bundle.binding.toolchain.id,attemptId:'clean_'+round+'_'+item.request.executionId,generation:item.isolationGeneration!,remainingMs:context.remainingActiveMs!()})}:{})});
    const namespaced=namespaceCleanRound(result.clean,result.evidence,round);const evidenceRoot=path.join(this.root(item.request.executionId),'evidence');
    for(const original of result.evidence){const target=namespaced.evidence.find(e=>e.id==='clean_round_'+round+'_'+original.id)!;const bytes=await readFile(await safeFile(roundRoot,original.path));await putFile(this.root(item.request.executionId),target.path,bytes);}
    // Legacy latest aliases are not historical descriptors; all audited paths are round-specific.
    for(const file of await listFiles(path.join(roundRoot,'evidence')))await putFile(evidenceRoot,file,await readFile(await safeFile(path.join(roundRoot,'evidence'),file)));
    await putFile(path.join(this.root(item.request.executionId),'delivery'),'source.zip',result.archive);
    const prefix=namespaced.prefix;const receipt=canonicalDeliveryJson({version:1,round,bindingHash:bundle.binding.hash,specHash:bundle.spec.hash,planHash:bundle.plan.hash,sourceSnapshotHash:result.exported.sourceSnapshotHash,exportManifest:result.exported,cleanBuild:namespaced.clean,controlledEnvironment:this.options.trustedCleanBrowserLocale?{kind:'trusted_test_locale',locale:this.options.trustedCleanBrowserLocale}:null});
    const extras=[{name:'round-report.json',bytes:Buffer.from(receipt),kind:'report' as const,mediaType:'application/json' as const},{name:'source.zip',bytes:result.archive,kind:'trace' as const,mediaType:'application/zip' as const}];
    for(const extra of extras){const p='evidence/'+prefix+'/'+extra.name;await putFile(this.root(item.request.executionId),p,extra.bytes);namespaced.evidence.push({id:prefix+'_'+extra.name.replaceAll('.','_'),path:p,sha256:sha256(extra.bytes),bytes:extra.bytes.length,kind:extra.kind,mediaType:extra.mediaType,scope:'clean_export',attemptId:null,sourceSnapshotHash:result.exported.sourceSnapshotHash,specHash:bundle.spec.hash,planHash:bundle.plan.hash});}
    state.evidence.push(...namespaced.evidence);state.cleanRounds.push({index:round,sourceHash:result.exported.sourceSnapshotHash,archiveHash:result.exported.archive.sha256,cleanHash:namespaced.clean.hash,receiptEvidenceId:prefix+'_round-report_json'});this.persist(item.request.executionId);
    if(context.signal.aborted){this.makeReport(item,context.signal.reason==='budget'?'failed':'cancelled',{code:context.signal.reason==='budget'?'BUDGET_EXCEEDED':'CANCELLED',message:'Clean export stopped before completion.',retryable:false},result.exported,namespaced.clean);throw new Error('Export stopped');}
    const failures=cleanBehaviorFailures(namespaced.clean,result.exported,bundle);
    if(failures?.length&&context.usageIsKnown?.()!==false){
      this.makeReport(item,'running',null,result.exported,namespaced.clean);state.phase=undefined;this.persist(item.request.executionId);
      context.passedCaseIds=namespaced.clean.caseResults.filter(c=>c.status==='passed').map(c=>c.caseId);
      context.report(`干净导出第${round+1}轮有${failures.length}项必需行为失败，交由统一控制器判定剩余同计划修复额度；未发布候选。`);
      return{errors:JSON.stringify(failures.map(c=>({stage:'clean_verify',caseId:c.caseId,failure:c.failure}))),failureCategory:'clean_behavior' as const,evidenceRefs:failures.flatMap(c=>c.evidenceIds)};
    }
    const report=this.makeReport(item,'completed',null,result.exported,namespaced.clean);
    await putFile(evidenceRoot,'delivery-report.json',JSON.stringify(report));
    if(report.quality==='blocked'){this.makeReport(item,'failed',{code:'EXPORT_FAILED',message:'Frozen verification or independent clean export failed.',retryable:false},result.exported,namespaced.clean);return{errors:'Clean export infrastructure, integrity, incomplete verification or trust gate failed.',failureCategory:'infrastructure' as const,evidenceRefs:namespaced.evidence.map(e=>e.id)};}
    state.phase=undefined;this.persist(item.request.executionId);context.report(`交付报告为 ${report.quality}；${report.gaps.length} 项缺口。候选发布仍由后端决定。`);return{errors:null,failureCategory:undefined,evidenceRefs:namespaced.evidence.map(e=>e.id)};
  }
  fail(item: RecordValue, lifecycle: 'failed' | 'cancelled' | 'interrupted', message: string, code: 'BUDGET_EXCEEDED' | 'REQUIRED_BEHAVIOR_FAILED'|'PLAN_INVALID' = 'REQUIRED_BEHAVIOR_FAILED') {
    const state = this.state(item.request.executionId);
    if (state.report?.quality === 'blocked' && state.report.final) return;
    this.makeReport(item, lifecycle, { code: lifecycle === 'cancelled' ? 'CANCELLED' : lifecycle === 'interrupted' ? 'EXECUTION_INTERRUPTED' : code, message: message.slice(0, 2000) || 'Delivery failed.', retryable: false },state.report?.exportManifest??null,state.report?.cleanBuild??null);
  }
  report(id: string) { this.snapshot(id); return this.state(id).report; }
  evidence(id: string, evidenceId: string) { const report = this.report(id); const entry = report?.evidence.find((file) => file.id === evidenceId);
    if (!entry) throw new DeliveryError(404, 'NOT_FOUND', 'Delivery evidence not found'); return readFile(path.join(this.root(id), entry.path)); }
  export(id: string, archiveId: string) { const report = this.report(id); if (report?.exportManifest?.archive.id !== archiveId) throw new DeliveryError(404, 'NOT_FOUND', 'Archive not found');
    return readFile(path.join(this.root(id), 'delivery/source.zip')); }
  artifactEvidence(id: string) { return this.report(id)?.evidence.filter(file=>file.kind!=='trace').map(({ id, path, kind }) => ({ id, path, kind: kind === 'screenshot' ? 'screenshot' : kind === 'report'?'report':'log' })) || []; }
}
