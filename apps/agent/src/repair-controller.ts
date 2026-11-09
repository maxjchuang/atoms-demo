import { AtomicLedgerCommitError } from './atomic-ledger.js';
/** Private deterministic orchestration policy; native/public ledgers keep budget and authority. */
import { canonicalDeliveryJson } from '@atoms/contracts/delivery';
import { sha256 } from './files.js';
export type RepairStage = 'prepare_plan' | 'validate_frozen' | 'generate' | 'repair' | 'workspace_verify' | 'export_clean' | 'finalize';
export type FailureCategory = 'plan_format' | 'source_format' | 'code_check' | 'required_behavior' | 'clean_behavior' | 'infrastructure' | 'trust' | 'usage_unknown' | 'budget' | 'cancelled' | 'interrupted' | 'replan_required' | 'no_progress';
export type BudgetObservation = {
    known: boolean;
    used: {
        modelSteps: number;
        inputTokens: number | null;
        outputTokens: number | null;
        activeMs: number;
    };
    remaining: {
        modelSteps: number;
        inputTokens: number | null;
        outputTokens: number | null;
        activeMs: number;
    };
    repairUsed: number;
    repairLimit: number;
};
export type StageBinding = {
    sourceHash: string | null;
    specHash: string | null;
    planHash: string | null;
    bindingHash: string | null;
    toolchainHash: string | null;
    requestHash: string;
};
export type StageFailure = {
    category: FailureCategory;
    fingerprint: string;
    evidenceRefs: string[];
};
export type StageResult = {
    outcome: 'passed';
} | {
    outcome: 'question';
} | {
    outcome: 'failed';
    failure: StageFailure;
};
export type RepairDecision = {
    action: 'advance';
    stage: RepairStage | 'await_api_freeze' | 'candidate';
} | {
    action: 'repair';
    reason: 'same_frozen_plan';
} | {
    action: 'retry_plan';
    reason: 'same_preparation';
} | {
    action: 'wait_answer';
} | {
    action: 'stop';
    reason: FailureCategory;
};
export type ControllerEntry = {
    revision: number;
    previousHash: string | null;
    hash: string;
    kind: 'intent' | 'result';
    effectId: string;
    stage: RepairStage;
    binding: StageBinding;
    budget: BudgetObservation;
    result: StageResult | null;
    structuredRetriesRemaining: number;
    decision: RepairDecision;
    time: string;
};
export type RepairControllerState = {
    version: 1;
    revision: number;
    pendingEffect: string | null;
    entries: ControllerEntry[];
    failedSources: string[];
    lastFailure: string | null;
    repeatedFailure: number;
};
export type ControllerOwner = {
    repairController?: RepairControllerState;
};
export function failureFingerprint(category: FailureCategory, observations: unknown) {
    let value = observations;
    if (typeof value === 'string')
        try {
            value = JSON.parse(value);
        }
        catch { }
    const envelope=value&&typeof value==='object'&&!Array.isArray(value)&&(value as {formatVersion?:unknown}).formatVersion==='repair-feedback-v2'?value as {checks?:unknown;failures?:unknown}:null;const rows=envelope?.failures??value;
    if (Array.isArray(rows) && rows.every(x => x && typeof x === 'object' && 'caseId' in x))
        {const normalized = rows.map((x: any) => { let expected = x.failure?.expected, actual = x.failure?.actual; try {
            expected = JSON.parse(expected);
        }
        catch { } try {
            actual = JSON.parse(actual);
        }
        catch { } return { caseId: x.caseId, stepId: x.failure?.stepId ?? null, expected: expected ?? null, actualClass: actual && typeof actual === 'object' ? { op: actual.op ?? null, matchCount: actual.matchCount ?? null, count: actual.count ?? null, valueMatched: actual.value?.matched ?? null, geometryStable: typeof actual.stableForMs === 'number' ? actual.stableForMs >= actual.requiredStableMs : null, hasGeometryDelta: Boolean(actual.delta), truncated: actual.truncated ?? false } : typeof actual }; }).sort((a, b) => String(a.caseId).localeCompare(String(b.caseId)));value=envelope?{checks:Array.isArray(envelope.checks)?envelope.checks.map((c:any)=>({kind:c.kind,category:c.category,diagnosticCodes:typeof c.message==='string'?(c.message.match(/TS[0-9]+/g)??[]):[]})):[],failures:normalized}:normalized;}
    return sha256(canonicalDeliveryJson({ category, observations: value }));
}
export function controllerDecision(stage: RepairStage, result: StageResult, budget: BudgetObservation, structuredRetriesRemaining = 0): RepairDecision {
    if (result.outcome !== 'failed' && !budget.known)
        return { action: 'stop', reason: 'usage_unknown' };
    if (result.outcome === 'question')
        return { action: 'wait_answer' };
    if (result.outcome === 'failed') {
        const c = result.failure.category;
        if (c === 'plan_format' && structuredRetriesRemaining > 0 && budget.known && budget.remaining.modelSteps > 0 && (budget.remaining.inputTokens ?? 0) > 0 && (budget.remaining.outputTokens ?? 0) > 0 && budget.remaining.activeMs > 0)
            return { action: 'retry_plan', reason: 'same_preparation' };
        if (['code_check', 'required_behavior', 'clean_behavior'].includes(c)) {
            if (!budget.known)
                return { action: 'stop', reason: 'usage_unknown' };
            if (budget.remaining.modelSteps <= 0 || (budget.remaining.inputTokens ?? 0) <= 0 || (budget.remaining.outputTokens ?? 0) <= 0 || budget.remaining.activeMs <= 0)
                return { action: 'stop', reason: 'budget' };
            return budget.repairUsed < budget.repairLimit ? { action: 'repair', reason: 'same_frozen_plan' } : { action: 'stop', reason: c };
        }
        return { action: 'stop', reason: c };
    }
    return { action: 'advance', stage: stage === 'prepare_plan' ? 'await_api_freeze' : stage === 'validate_frozen' ? 'generate' : stage === 'generate' || stage === 'repair' ? 'workspace_verify' : stage === 'workspace_verify' ? 'export_clean' : stage === 'export_clean' ? 'finalize' : 'candidate' };
}
export function validateController(state: RepairControllerState, expected?: Partial<StageBinding>) {
    let previousHash: string | null = null, pending: ControllerEntry | null = null, lastResult: ControllerEntry | null = null;
    const failedSources: string[] = [];
    let lastFailure: string | null = null, repeatedFailure = 0;
    if (state.version !== 1 || !Array.isArray(state.entries) || state.entries.length > 512 || state.revision !== state.entries.length)
        throw new Error('Controller revision mismatch');
    const identity = state.entries[0]?.binding;
    for (const [i, e] of state.entries.entries()) {
        for (const key of ['requestHash', 'toolchainHash'] as const)
            if (e.binding[key] !== identity[key])
                throw new Error('Controller subject changed between effects');
        if (state.entries[0].stage !== 'prepare_plan')
            for (const key of ['specHash', 'planHash', 'bindingHash'] as const)
                if (e.binding[key] !== identity[key])
                    throw new Error('Controller frozen scope changed between effects');
        if (expected)
            for (const [key, value] of Object.entries(expected))
                if (e.binding[key as keyof StageBinding] !== value)
                    throw new Error('Controller subject differs from authoritative request');
        const { hash, ...body } = e;
        if (e.revision !== i + 1 || e.previousHash !== previousHash || sha256(canonicalDeliveryJson(body)) !== hash)
            throw new Error('Controller journal integrity mismatch');
        if (!['prepare_plan', 'validate_frozen', 'generate', 'repair', 'workspace_verify', 'export_clean', 'finalize'].includes(e.stage) || !Number.isSafeInteger(e.structuredRetriesRemaining) || e.structuredRetriesRemaining < 0)
            throw new Error('Controller policy/stage mismatch');
        if (e.kind === 'intent') {
            const previous = lastResult?.decision;
            const expected = previous?.action === 'advance' ? previous.stage : previous?.action === 'repair' ? 'repair' : previous?.action === 'retry_plan' ? 'prepare_plan' : previous?.action === 'wait_answer' ? lastResult!.stage : null;
            if (lastResult && (expected === null || e.stage !== expected) || !lastResult && !['prepare_plan', 'validate_frozen', 'generate'].includes(e.stage))
                throw new Error('Controller phase transition mismatch');
            if (pending || e.result !== null || e.decision.action !== 'advance' || e.decision.stage !== e.stage || e.effectId !== 'effect_' + sha256(e.binding.requestHash + ':' + i + ':' + e.stage).slice(0, 32))
                throw new Error('Controller intent pairing mismatch');
            pending = e;
        }
        else if (e.kind === 'result') {
            if (!pending || pending.effectId !== e.effectId || pending.stage !== e.stage || !e.result)
                throw new Error('Controller result pairing mismatch');
            for (const key of ['requestHash', 'bindingHash', 'toolchainHash', 'specHash', 'planHash'] as const)
                if (!(e.stage === 'prepare_plan' && ['specHash', 'planHash'].includes(key)) && e.binding[key] !== pending.binding[key])
                    throw new Error('Controller frozen subject mismatch');
            for (const key of ['modelSteps', 'inputTokens', 'outputTokens', 'activeMs'] as const) {
                const a = pending.budget.used[key], b = e.budget.used[key];
                if (a !== null && b !== null && (!Number.isFinite(b) || b < a))
                    throw new Error('Controller usage observation regressed');
            }
            let decision = controllerDecision(e.stage, e.result, e.budget, e.structuredRetriesRemaining);
            if (['workspace_verify', 'export_clean', 'finalize'].includes(e.stage) && pending.binding.sourceHash !== e.binding.sourceHash)
                decision = { action: 'stop', reason: 'trust' };
            if (decision.action !== 'stop' && (e.stage === 'generate' || e.stage === 'repair') && e.result.outcome === 'passed' && e.binding.sourceHash && (e.stage === 'repair' && pending.binding.sourceHash === e.binding.sourceHash || failedSources.includes(e.binding.sourceHash)))
                decision = { action: 'stop', reason: 'no_progress' };
            if (e.result.outcome === 'failed') {
                if (e.binding.sourceHash && !failedSources.includes(e.binding.sourceHash))
                    failedSources.push(e.binding.sourceHash);
                if (lastFailure === e.result.failure.fingerprint)
                    repeatedFailure++;
                else {
                    lastFailure = e.result.failure.fingerprint;
                    repeatedFailure = 1;
                }
                if (repeatedFailure >= 3 && decision.action === 'repair')
                    decision = { action: 'stop', reason: 'no_progress' };
            }
            if (canonicalDeliveryJson(decision) !== canonicalDeliveryJson(e.decision))
                throw new Error('Controller decision differs from policy');
            pending = null;
            lastResult = e;
        }
        else
            throw new Error('Controller entry kind mismatch');
        previousHash = hash;
    }
    if (state.pendingEffect !== (pending?.effectId ?? null) || canonicalDeliveryJson(state.failedSources) !== canonicalDeliveryJson(failedSources) || state.lastFailure !== lastFailure || state.repeatedFailure !== repeatedFailure)
        throw new Error('Controller derived cache mismatch');
}
function stateFor(owner: ControllerOwner) { if (owner.repairController)
    validateController(owner.repairController); return structuredClone(owner.repairController ?? { version: 1, revision: 0, pendingEffect: null, entries: [], failedSources: [], lastFailure: null, repeatedFailure: 0 } as RepairControllerState); }
/** Controller and native counters are persisted together by the caller's ONE atomic ledger commit. */
export function commitController(owner: ControllerOwner, expectedRevision: number, change: (state: RepairControllerState) => void, persist: () => void) { const previous = owner.repairController, next = stateFor(owner); if (next.revision !== expectedRevision)
    throw new Error('Stale controller revision'); change(next); validateController(next); owner.repairController = next; try {
    persist();
}
catch (error) {
    if (!(error instanceof AtomicLedgerCommitError))
        owner.repairController = previous;
    throw error;
} return next; }
function entry(state: RepairControllerState, kind: ControllerEntry['kind'], effectId: string, stage: RepairStage, binding: StageBinding, budget: BudgetObservation, result: StageResult | null, decision: RepairDecision, structuredRetriesRemaining = 0) { const body = { revision: state.revision + 1, previousHash: state.entries.at(-1)?.hash ?? null, kind, effectId, stage, binding: structuredClone(binding), budget: structuredClone(budget), result, structuredRetriesRemaining, decision, time: new Date().toISOString() }; state.entries.push({ ...body, hash: sha256(canonicalDeliveryJson(body)) }); state.revision++; }
export function beginControllerEffect(owner: ControllerOwner, stage: RepairStage, binding: StageBinding, budget: BudgetObservation, persist: () => void) { const rev = owner.repairController?.revision ?? 0; const id = 'effect_' + sha256(binding.requestHash + ':' + rev + ':' + stage).slice(0, 32); commitController(owner, rev, s => { if (s.pendingEffect)
    throw new Error('Unsettled controller effect cannot be replayed'); s.pendingEffect = id; entry(s, 'intent', id, stage, binding, budget, null, { action: 'advance', stage }); }, persist); return id; }
export function finishControllerEffect(owner: ControllerOwner, id: string, stage: RepairStage, binding: StageBinding, budget: BudgetObservation, result: StageResult, persist: () => void, structuredRetriesRemaining = 0) {
    let decision = controllerDecision(stage, result, budget, structuredRetriesRemaining);
    const rev = owner.repairController?.revision ?? 0;
    commitController(owner, rev, s => {
        if (s.pendingEffect !== id)
            throw new Error('Controller effect/revision fence mismatch');
        const before = s.entries.slice().reverse().find(e => e.effectId === id && e.kind === 'intent')!;
        if (['workspace_verify', 'export_clean', 'finalize'].includes(stage) && before.binding.sourceHash !== binding.sourceHash)
            decision = { action: 'stop', reason: 'trust' };
        if (decision.action !== 'stop' && (stage === 'generate' || stage === 'repair') && result.outcome === 'passed' && binding.sourceHash) {
            if (stage === 'repair' && binding.sourceHash === before.binding.sourceHash || s.failedSources.includes(binding.sourceHash))
                decision = { action: 'stop', reason: 'no_progress' };
        }
        if (result.outcome === 'failed') {
            if (binding.sourceHash && !s.failedSources.includes(binding.sourceHash))
                s.failedSources.push(binding.sourceHash);
            if (s.lastFailure === result.failure.fingerprint)
                s.repeatedFailure++;
            else {
                s.lastFailure = result.failure.fingerprint;
                s.repeatedFailure = 1;
            }
            if (s.repeatedFailure >= 3 && decision.action === 'repair')
                decision = { action: 'stop', reason: 'no_progress' };
        }
        s.pendingEffect = null;
        entry(s, 'result', id, stage, binding, budget, result, decision, structuredRetriesRemaining);
    }, persist);
    return decision;
}
