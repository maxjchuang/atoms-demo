import { sha256 } from '../src/files.js';
import { canonicalDeliveryJson } from '@atoms/contracts/delivery';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { controllerDecision, beginControllerEffect, finishControllerEffect, commitController, validateController, failureFingerprint, type BudgetObservation, type StageBinding, type ControllerOwner } from '../src/repair-controller.js';
import { atomicLedger } from '../src/atomic-ledger.js';
const budget: BudgetObservation = { known: true, used: { modelSteps: 1, inputTokens: 100, outputTokens: 100, activeMs: 10 }, remaining: { modelSteps: 7, inputTokens: 65000, outputTokens: 24000, activeMs: 899990 }, repairUsed: 0, repairLimit: 2 };
const binding: StageBinding = { sourceHash: 'a'.repeat(64), specHash: 'b'.repeat(64), planHash: 'c'.repeat(64), bindingHash: 'd'.repeat(64), toolchainHash: 'e'.repeat(64), requestHash: 'f'.repeat(64) };
const failed = (category: 'clean_behavior' | 'required_behavior' | 'trust') => ({ outcome: 'failed' as const, failure: { category, fingerprint: failureFingerprint(category, { caseId: 'case_one', stepId: 'step_one' }), evidenceRefs: ['evidence_one'] } });
test('one typed reducer covers preparation, verification, clean, finalization and nonrepairable/budget exits', () => {
    assert.deepEqual(controllerDecision('prepare_plan', { outcome: 'passed' }, budget), { action: 'advance', stage: 'await_api_freeze' });
    assert.equal(controllerDecision('prepare_plan', { outcome: 'failed', failure: { ...failed('trust').failure, category: 'plan_format' } }, budget, 1).action, 'retry_plan');
    for (const stage of ['workspace_verify', 'export_clean'] as const)
        assert.equal(controllerDecision(stage, failed(stage === 'workspace_verify' ? 'required_behavior' : 'clean_behavior'), budget).action, 'repair');
    for (const category of ['infrastructure', 'trust', 'usage_unknown', 'budget', 'cancelled', 'interrupted', 'replan_required', 'no_progress'] as const)
        assert.deepEqual(controllerDecision('export_clean', { outcome: 'failed', failure: { ...failed('trust').failure, category } }, budget), { action: 'stop', reason: category });
    assert.equal(controllerDecision('workspace_verify', failed('required_behavior'), { ...budget, repairUsed: 2 }).action, 'stop');
    assert.deepEqual(controllerDecision('export_clean', failed('clean_behavior'), { ...budget, known: false }), { action: 'stop', reason: 'usage_unknown' });
    assert.deepEqual(controllerDecision('workspace_verify', failed('required_behavior'), { ...budget, remaining: { ...budget.remaining, inputTokens: 0 } }), { action: 'stop', reason: 'budget' });
    assert.deepEqual(controllerDecision('finalize', { outcome: 'passed' }, budget), { action: 'advance', stage: 'candidate' });
});
test('authoritative atomic ledger contains matching counters+journal; stale/corrupt/pending effect or failed write cannot authorize another effect', t => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'atoms-controller-atomic-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'ledger.json');
    const owner: ControllerOwner & {
        nativeUsed: number;
    } = { nativeUsed: 100 };
    const persist = () => atomicLedger(file, owner);
    const id = beginControllerEffect(owner, 'generate', binding, budget, persist);
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(disk.nativeUsed, 100);
    assert.equal(disk.repairController.revision, 1);
    assert.equal(disk.repairController.pendingEffect, id);
    validateController(disk.repairController);
    assert.throws(() => beginControllerEffect(owner, 'generate', binding, budget, persist), /Unsettled/);
    assert.throws(() => commitController(owner, 0, () => { }, persist), /Stale/);
    const before = readFileSync(file, 'utf8');
    assert.throws(() => commitController(owner, 1, () => { }, () => { throw new Error('synthetic commit unavailable'); }), /unavailable/);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.equal(owner.repairController!.pendingEffect, id);
    assert.throws(() => atomicLedger(file, { bad: 1n }));
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.deepEqual(readdirSync(dir), ['ledger.json']);
    finishControllerEffect(owner, id, 'generate', { ...binding, sourceHash: '1'.repeat(64) }, budget, { outcome: 'passed' }, persist);
    assert.equal(owner.repairController!.revision, 2);
    assert.equal(owner.repairController!.pendingEffect, null);
    const corrupt = structuredClone(owner.repairController!);
    corrupt.entries[0].binding.sourceHash = '2'.repeat(64);
    assert.throws(() => validateController(corrupt), /integrity/);
});
test('same frozen source no-op/cycle and verifier source mutation stop instead of retry roulette', () => {
    const prepared = () => { const owner: ControllerOwner = {}; const id = beginControllerEffect(owner, 'generate', binding, budget, () => { }); finishControllerEffect(owner, id, 'generate', binding, budget, { outcome: 'passed' }, () => { }); return owner; };
    const owner = prepared();
    let id = beginControllerEffect(owner, 'workspace_verify', binding, budget, () => { });
    finishControllerEffect(owner, id, 'workspace_verify', binding, budget, failed('required_behavior'), () => { });
    id = beginControllerEffect(owner, 'repair', binding, budget, () => { });
    assert.deepEqual(finishControllerEffect(owner, id, 'repair', binding, budget, { outcome: 'passed' }, () => { }), { action: 'stop', reason: 'no_progress' });
    assert.throws(() => beginControllerEffect(owner, 'repair', binding, budget, () => { }), /phase/);
    const final = prepared();
    for (const stage of ['workspace_verify', 'export_clean'] as const) {
        const effect = beginControllerEffect(final, stage, binding, budget, () => { });
        finishControllerEffect(final, effect, stage, binding, budget, { outcome: 'passed' }, () => { });
    }
    id = beginControllerEffect(final, 'finalize', binding, budget, () => { });
    assert.deepEqual(finishControllerEffect(final, id, 'finalize', { ...binding, sourceHash: '3'.repeat(64) }, budget, { outcome: 'passed' }, () => { }), { action: 'stop', reason: 'trust' });
});
test('a valid rehashed chain cannot disguise wrong stage/subject/derived cache or authorize a pending replay', () => {
    const owner: ControllerOwner = {};
    const id = beginControllerEffect(owner, 'generate', binding, budget, () => { });
    finishControllerEffect(owner, id, 'generate', { ...binding, sourceHash: '1'.repeat(64) }, budget, { outcome: 'passed' }, () => { });
    const rehash = (s: NonNullable<ControllerOwner['repairController']>) => { let last: string | null = null; for (const e of s.entries) {
        e.previousHash = last;
        const { hash, ...body } = e;
        e.hash = sha256(canonicalDeliveryJson(body));
        last = e.hash;
    } return s; };
    for (const mutate of [(s: any) => s.pendingEffect = 'forged', (s: any) => s.failedSources = ['0'.repeat(64)], (s: any) => s.lastFailure = 'forged', (s: any) => s.repeatedFailure = 99]) {
        const s = structuredClone(owner.repairController!);
        mutate(s);
        assert.throws(() => validateController(s), /cache/);
    }
    const stage = structuredClone(owner.repairController!);
    stage.entries[1].stage = 'export_clean';
    assert.throws(() => validateController(rehash(stage)), /pairing/);
    const subject = structuredClone(owner.repairController!);
    subject.entries[1].binding.planHash = '2'.repeat(64);
    assert.throws(() => validateController(rehash(subject)), /scope|subject/);
    const forged = structuredClone(owner.repairController!);
    for (const e of forged.entries)
        e.binding.requestHash = '3'.repeat(64);
    assert.throws(() => validateController(rehash(forged), { requestHash: binding.requestHash }), /authoritative|pairing/);
    const pending: ControllerOwner = {};
    beginControllerEffect(pending, 'generate', binding, budget, () => { });
    pending.repairController!.pendingEffect = null;
    assert.throws(() => beginControllerEffect(pending, 'generate', binding, budget, () => { }), /cache/);
});

test('v2 aggregate failure fingerprints retain semantic failure identity instead of drifting with pixel positions',()=>{const row=(x:number)=>({caseId:'case_one',failure:{stepId:'step_one',expected:JSON.stringify({frozenStep:{op:'expect_box_moved',dx:20,dy:0}}),actual:JSON.stringify({op:'expect_box_moved',delta:{dx:x,dy:x},baseline:{x},box:{x:x+1},stableForMs:0,requiredStableMs:120,matchCount:1})}});assert.equal(failureFingerprint('required_behavior',JSON.stringify({formatVersion:'repair-feedback-v2',checks:[],failures:[row(21)]})),failureFingerprint('required_behavior',JSON.stringify({formatVersion:'repair-feedback-v2',checks:[],failures:[row(29)]})));});
