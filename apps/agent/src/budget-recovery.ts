import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BudgetDiagnostic, RecoveryCheckpoint, RecoveryStopRequest, RecoveryStopReceipt, RecoveryRuntimeView, RecoveryExecutionRequest, recoverySemanticBody, type RecoveryExecutionRequestDto } from '@atoms/contracts/budget-recovery';
import { canonicalDeliveryJson, type DeliveryExecutionRequestDto } from '@atoms/contracts/delivery';
import type { AgentRuntime } from './runtime.js';
import type { DeliveryExecutionRuntime } from './delivery-execution.js';
import { fingerprints, inventoryHash, seal, assertSealed, sameToolchain } from './delivery-files.js';
import { sha256, safeFile, putFile } from './files.js';
import { trustedTemplate } from './trusted-template.js';
import { auditHostStop } from './recovery-stop-audit.js';
import { reviewPlanSemantics, verifiedSemanticSource } from './planning-semantics.js';
export class RecoveryError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const now = () => new Date().toISOString();
export class BudgetRecoveryRuntime {
    private epoch = 'control_' + randomUUID().replaceAll('-', '');
    private receipts = new Map<string, {
        request: string;
        receipt: ReturnType<typeof RecoveryStopReceipt.parse>;
    }>();
    constructor(private runtime: AgentRuntime, private delivery: DeliveryExecutionRuntime, private options: {
        dataDir: string;
        backend?: string;
        testAudit?: () => Promise<{
            confirmed: boolean;
            reason?: string | null;
        }>;
    }) { }
    private root(id: string) { return path.join(this.options.dataDir, 'executions', id); }
    private async checkpoint(id: string) { const r = this.runtime.get(id), report = this.delivery.report(id); if (!r.delivery || !report?.final || r.snapshot.status !== 'failed' || r.snapshot.artifactId || r.events.some(e => e.event.type === 'artifact.ready'))
        return null; const a = report.attempts.at(-1); if (!a || a.sourceBeforeHash !== a.sourceAfterHash || !['failed', 'passed'].includes(a.status))
        return null; const index = report.attempts.length - 1, root = path.join(this.root(id), 'source-snapshots', 'attempt_' + index); try {
        const raw = await readFile(path.join(root, 'manifest.json'), 'utf8'), m = JSON.parse(raw);
        if (m.sourceSnapshotHash !== a.sourceBeforeHash || m.files.length > 100 || inventoryHash(m.files) !== a.sourceBeforeHash)
            return null;
        for (const f of m.files) {
            const b = await readFile(await safeFile(root, f.path));
            if (b.length !== f.bytes || sha256(b) !== f.sha256)
                return null;
        }
        const b = r.delivery.bundle.binding;
        const cp = seal({ protocolVersion: '0.1.0' as const, id: 'checkpoint_' + sha256(id + raw).slice(0, 32), hash: '0'.repeat(64), projectId: r.request.projectId, runId: r.request.runId, executionId: id, backend: 'host_local' as const, sourceSnapshotHash: a.sourceBeforeHash, manifestHash: sha256(raw), fileCount: m.files.length, bytes: m.files.reduce((n: number, f: {
                bytes: number;
            }) => n + f.bytes, 0), packageJsonHash: sha256(await readFile(path.join(root, 'source/package.json'))), lockfileHash: sha256(await readFile(path.join(root, 'source/pnpm-lock.yaml'))), scriptsHash: sha256(canonicalDeliveryJson(JSON.parse(await readFile(path.join(root, 'source/package.json'), 'utf8')).scripts)), toolchainId: b.toolchain.id, originSeed: b.seed, originSpec: b.spec, originPlan: b.plan, originBinding: { id: b.id, hash: b.hash }, latestAttemptId: a.id, savedAt: a.startedAt, verification: 'actual_bytes_verified' as const, storage: 'agent_private_immutable' as const });
        return { descriptor: RecoveryCheckpoint.parse(cp), root, manifest: m };
    }
    catch {
        return null;
    } }
    private diagnosis(id: string) { const r = this.runtime.get(id), b = r.delivery?.bundle.binding; if (!b)
        return null; const failure = [...r.events].reverse().find(e => e.event.type === 'execution.failed')?.event; const budgetFailed = failure?.type === 'execution.failed' && failure.payload.code === 'BUDGET_EXCEEDED'; const planning = b.planningUsage; const lower = { inputTokens: r.usage.inputTokens + planning.inputTokens, outputTokens: r.usage.outputTokens + planning.outputTokens, modelSteps: r.usage.modelSteps + planning.modelSteps, activeMs: r.activeMs + planning.activeMs }; let dimension: 'input_tokens' | 'output_tokens' | 'model_steps' | 'active_ms' | 'repair_rounds' | 'unknown' = 'unknown', observed: number | null = null, limit: number | null = null; let classification: 'token_budget' | 'model_step_budget' | 'active_time_budget' | 'repair_budget' | 'unknown' = 'unknown'; if (budgetFailed && lower.inputTokens > b.totalBudget.maxInputTokens) {
        dimension = 'input_tokens';
        observed = lower.inputTokens;
        limit = b.totalBudget.maxInputTokens;
        classification = 'token_budget';
    }
    else if (budgetFailed && lower.outputTokens >= b.totalBudget.maxOutputTokens) {
        dimension = 'output_tokens';
        observed = lower.outputTokens;
        limit = b.totalBudget.maxOutputTokens;
        classification = 'token_budget';
    }
    else if (budgetFailed && lower.modelSteps > b.totalBudget.maxModelSteps) {
        dimension = 'model_steps';
        observed = lower.modelSteps;
        limit = b.totalBudget.maxModelSteps;
        classification = 'model_step_budget';
    }
    else if (budgetFailed && lower.activeMs >= b.totalBudget.maxWallTimeMs) {
        dimension = 'active_ms';
        observed = lower.activeMs;
        limit = b.totalBudget.maxWallTimeMs;
        classification = 'active_time_budget';
    } if (classification === 'unknown' && failure?.type === 'execution.failed' && failure.payload.code === 'VERIFICATION_FAILED' && r.request.budget.maxRepairRounds > 0 && r.repairRoundsUsed >= r.request.budget.maxRepairRounds) {
        classification = 'repair_budget';
        dimension = 'repair_rounds';
        observed = r.repairRoundsUsed;
        limit = r.request.budget.maxRepairRounds;
    } const usage = this.delivery.snapshot(id).cumulativeUsage; return BudgetDiagnostic.parse({ protocolVersion: '0.1.0', id: 'diagnosis_' + sha256(id + JSON.stringify(lower)).slice(0, 24), revision: 1, projectId: r.request.projectId, runId: r.request.runId, executionId: id, classification, dimension, trigger: classification === 'unknown' ? 'unknown' : 'segment_limit_reached', observedLowerBound: observed, settledTotal: r.usageKnown !== false ? observed : null, limit, nextRequestReservation: null, accountingSource: classification === 'unknown' ? 'unavailable' : 'host_meter', asOf: r.snapshot.updatedAt, historicalUsage: usage, summary: classification === 'unknown' ? 'No token exhaustion is established by trusted measured counters.' : `${dimension} reached its original cumulative Run limit; observed values may be lower bounds and unknown totals remain null.` }); }
    async view(id: string) {
        const r = this.runtime.get(id);
        if (!r.delivery)
            throw new RecoveryError(404, 'NOT_FOUND', 'No immutable delivery origin');
        const report = this.delivery.report(id);
        const docker = this.options.backend === 'docker_linux' || r.executionBackend === 'docker_linux';
        const cp = docker ? null : await this.checkpoint(id);
        let planReview: ReturnType<typeof RecoveryRuntimeView.parse>['planReview'] = null;
        const semanticHash = sha256(canonicalDeliveryJson(recoverySemanticBody(r.delivery.bundle)));
        if (cp) {
            try {
                let bytes = 0;
                const sources = [];
                for (const f of cp.manifest.files.filter((f: {
                    path: string;
                }) => /^source\/src\/.*\.(tsx?|jsx?)$/.test(f.path)).slice(0, 5)) {
                    if (bytes + f.bytes > 24576)
                        break;
                    const text = await readFile(await safeFile(cp.root, f.path), 'utf8');
                    sources.push(verifiedSemanticSource(f.path, text, f.sha256));
                    bytes += f.bytes;
                }
                const review = reviewPlanSemantics(r.delivery.bundle.plan, sources);
                planReview = { status: review.issues.length ? 'review_required' : 'reusable', semanticHash, reviewedAt: now(), reasons: review.issues.slice(0, 20).map(i => `${i.code}:${i.caseId}/${i.stepId}`) };
            }
            catch {
                planReview = { status: 'unverified', semanticHash, reviewedAt: null, reasons: ['Bounded host semantic policy could not verify source/plan mapping.'] };
            }
        }
        const receipt = [...this.receipts.values()].map(v => v.receipt).find(v => v.executionId === id && v.privateControlEpoch === this.epoch && v.reportHash === report?.hash && v.checkpoint.hash === cp?.descriptor.hash) || null;
        return RecoveryRuntimeView.parse({ protocolVersion: '0.1.0', projectId: r.request.projectId, runId: r.request.runId, executionId: id, requestHash: sha256(canonicalDeliveryJson(r.delivery)), backend: docker ? 'docker_linux' : 'host_local', diagnosis: this.diagnosis(id), checkpoint: cp?.descriptor ?? null, stopReceipt: receipt, origin: r.delivery, report: report ? { id: report.id, hash: report.hash } : null, planReview });
    }
    async confirmStop(id: string, raw: unknown) { const request = RecoveryStopRequest.parse(raw); const requestHash = sha256(canonicalDeliveryJson(request)); const old = this.receipts.get(request.commandId); if (old) {
        if (old.request !== requestHash)
            throw new RecoveryError(409, 'CONFLICT', 'Stop command changed');
        return old.receipt;
    } const view = await this.view(id); if (view.backend !== 'host_local' || !view.checkpoint || !view.report || view.requestHash !== request.expectedRequestHash || view.report.hash !== request.expectedReportHash || canonicalDeliveryJson(request.expectedCheckpoint) !== canonicalDeliveryJson({ id: view.checkpoint.id, hash: view.checkpoint.hash }))
        throw new RecoveryError(409, 'NOT_ELIGIBLE', 'Origin/report/checkpoint stop fence mismatch'); if (this.runtime.isExecutionActive(id))
        throw new RecoveryError(409, 'NOT_ELIGIBLE', 'STOP_UNCONFIRMED'); await this.runtime.disposeOwnedExecution(id); const audited = await (this.options.testAudit?.() || auditHostStop({ workspace: path.join(this.root(id), 'workspace'), home: path.join(this.options.dataDir, 'dsh', view.projectId) })); if (!audited.confirmed)
        throw new RecoveryError(409, 'NOT_ELIGIBLE', 'STOP_UNCONFIRMED'); const receipt = RecoveryStopReceipt.parse(seal({ protocolVersion: '0.1.0' as const, id: 'stop_' + randomUUID().replaceAll('-', ''), hash: '0'.repeat(64), commandId: request.commandId, projectId: view.projectId, runId: view.runId, executionId: id, requestHash: view.requestHash, reportHash: view.report.hash, checkpoint: { id: view.checkpoint.id, hash: view.checkpoint.hash }, backend: 'host_local' as const, status: 'confirmed' as const, method: 'independent_process_audit' as const, privateControlEpoch: this.epoch, checkedAt: now() })); const dir = path.join(this.options.dataDir, 'budget-recovery'); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, receipt.id + '.json'), JSON.stringify({ requestHash, receipt, audit: { ...audited, synthetic: !!this.options.testAudit } })); this.receipts.set(request.commandId, { request: requestHash, receipt }); return receipt; }
    async start(raw: unknown, id: string) { const recovery = RecoveryExecutionRequest.parse(raw); if (id !== recovery.request.execution.executionId)
        throw new RecoveryError(400, 'INVALID_REQUEST', 'Recovery execution ID mismatch'); try {
        assertSealed(recovery);
    }
    catch {
        throw new RecoveryError(400, 'INVALID_REQUEST', 'Recovery wrapper fingerprint mismatch');
    } const previous = this.runtime.records.get(id); if (previous) {
        if (!previous.recovery || canonicalDeliveryJson(previous.recovery) !== canonicalDeliveryJson(recovery))
            throw new RecoveryError(409, 'CONFLICT', 'Recovery wrapper changed');
        return { created: false, snapshot: this.delivery.snapshot(id) };
    } if (this.options.backend === 'docker_linux')
        throw new RecoveryError(409, 'NOT_ELIGIBLE', 'BACKEND_UNSUPPORTED'); if ([...this.runtime.records.values()].some(r => r.recovery?.predecessorRunId === recovery.predecessorRunId))
        throw new RecoveryError(409, 'CONFLICT', 'Predecessor already has a linked successor'); const origin = await this.view(recovery.origin.execution.executionId); if (origin.backend !== 'host_local' || canonicalDeliveryJson(origin.origin) !== canonicalDeliveryJson(recovery.origin) || origin.requestHash !== recovery.originRequestHash || origin.report?.hash !== recovery.originReport.hash || origin.checkpoint?.hash !== recovery.checkpoint.hash || origin.stopReceipt?.hash !== recovery.stopReceipt.hash || origin.planReview?.status !== 'reusable')
        throw new RecoveryError(409, 'NOT_ELIGIBLE', 'Recovery source/stop/plan fence changed'); if (Date.now() >= Date.parse(recovery.authorization.startBefore))
        throw new RecoveryError(409, 'NOT_ELIGIBLE', 'Recovery start authorization expired'); if (!sameToolchain(recovery.request.bundle.binding.toolchain, (await trustedTemplate()).descriptor))
        throw new RecoveryError(409, 'NOT_ELIGIBLE', 'Source toolchain changed'); for (const part of [recovery.request.bundle.seed, recovery.request.bundle.spec, recovery.request.bundle.plan, recovery.request.bundle.binding])
        assertSealed(part); try {
        assertSealed(recovery.checkpoint);
        assertSealed(recovery.stopReceipt);
    }
    catch {
        throw new RecoveryError(400, 'INVALID_REQUEST', 'Source/stop descriptor fingerprint mismatch');
    } const answers = structuredClone(this.runtime.get(recovery.origin.execution.executionId).answers || []); const inherited = { originExecutionId: recovery.origin.execution.executionId, originRequestHash: origin.requestHash, originReportHash: origin.report!.hash, checkpoint: { id: recovery.checkpoint.id, hash: recovery.checkpoint.hash }, answers, answersHash: sha256(canonicalDeliveryJson(answers)) }; const inheritedDir = this.root(id); await mkdir(inheritedDir, { recursive: true }); const inheritedFile = path.join(inheritedDir, 'inherited-implementation-context.json'); try {
        await writeFile(inheritedFile, canonicalDeliveryJson(inherited), { flag: 'wx', mode: 0o400 });
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(inheritedFile, 'utf8') !== canonicalDeliveryJson(inherited))
            throw new RecoveryError(409, 'CONFLICT', 'Inherited implementation context changed');
    } const result = this.runtime.start(recovery.request.execution, id, recovery.request, recovery); const row = this.runtime.get(id); const last = this.delivery.report(recovery.origin.execution.executionId)?.attempts.at(-1); row.recoveryInitialFeedback = JSON.stringify([...(last?.caseResults.filter(c => c.status === 'failed').map(c => ({ caseId: c.caseId, failure: c.failure })) || []), ...Object.entries(last?.checks || {}).filter(([, v]) => v.status === 'failed').map(([kind, v]) => ({ caseId: 'host_' + kind, failure: { stepId: 'gate_' + kind, message: v.reason || kind, actual: JSON.stringify({ untrusted: true, gate: kind, detail: v.reason || kind }) } }))]); return { created: result.created, snapshot: this.delivery.snapshot(id) }; }
    async copySource(recovery: RecoveryExecutionRequestDto, workspace: string) { const view = await this.view(recovery.origin.execution.executionId); if (view.stopReceipt?.hash !== recovery.stopReceipt.hash || view.checkpoint?.hash !== recovery.checkpoint.hash)
        throw new RecoveryError(409, 'NOT_ELIGIBLE', 'Source/stop changed before dispatch'); const cp = await this.checkpoint(recovery.origin.execution.executionId); if (!cp)
        throw new RecoveryError(409, 'NOT_ELIGIBLE', 'Checkpoint unavailable'); await mkdir(workspace, { recursive: true }); for (const f of cp.manifest.files)
        await putFile(workspace, f.path.slice(7), await readFile(await safeFile(cp.root, f.path))); if (inventoryHash(await fingerprints(workspace, 'source/')) !== recovery.checkpoint.sourceSnapshotHash)
        throw new RecoveryError(409, 'NOT_ELIGIBLE', 'Copied checkpoint integrity mismatch'); }
}
