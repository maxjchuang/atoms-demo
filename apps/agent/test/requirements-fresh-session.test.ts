import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DeepSeekHarness, DeepSeekHarnessOptions } from '@deepseek-ai/dsh-sdk-client';
import { coordinationRequest, snapshot as fullRequirements } from '@atoms/contracts/requirements-fixtures';
import { continuationCoordination, startCoordination } from '@atoms/contracts/conversation-fixtures';
import { DshCoordinatorAdapter, type CoordinationModelContext } from '../src/coordinator-adapters.js';
import { sha256 } from '../src/files.js';
test('eight requirements turns and same-turn retry each use a fresh disposed SDK session with full current authority, corrected memory and bound question', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-requirements-fresh-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const home = path.join(root, 'project-home');
    await mkdir(home);
    await writeFile(path.join(home, 'router-session-1.json'), JSON.stringify({ sessionId: 'opaque_old_native_session', model: 'prior-model' }));
    const markerBefore = await readFile(path.join(home, 'router-session-1.json'), 'utf8');
    const options: DeepSeekHarnessOptions[] = [], names: string[] = [], prompts: string[] = [];
    let closes = 0, resumes = 0, calls = 0;
    const histories = new Map<string, string[]>();
    const adapter = new DshCoordinatorAdapter({ apiKey: 'synthetic-no-provider', harnessFactory: optionsValue => {
            options.push(optionsValue);
            return { async start() { }, session(name: string) {
                    names.push(name);
                    assert.ok(!histories.has(name), 'even retries/read-source passes cannot resume another native context');
                    histories.set(name, []);
                    return { async run(prompt: string, callbacks: any) {
                            calls++;
                            const nativeHistory = histories.get(name)!;
                            assert.equal(nativeHistory.length, 0);
                            nativeHistory.push(prompt);
                            prompts.push(prompt);
                            callbacks.onNotification({ method: 'session.event', params: { sessionId: name, event: { type: 'step/start', seq: 1, data: { turn: 1, step: 0 } } } });
                            callbacks.onNotification({ method: 'session.event', params: { sessionId: name, event: { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, usage: { inputTokens: 5, cacheReadTokens: 10, cacheWriteTokens: 0, outputTokens: 20, totalTokens: 35 } } } } });
                            return { sessionId: name, finishReason: 'stop', finalResponse: JSON.stringify({ kind: 'consult', answer: 'Synthetic snapshot-only replay', references: [], memoryUpdates: [] }) };
                        } };
                }, async resumeSession() { resumes++; throw new Error('Requirements must not load opaque native history'); }, async close() { closes++; } } as unknown as DeepSeekHarness;
        } });
    const perTurnUsage = new Map<string, {
        modelSteps: number;
        inputTokens: number;
        outputTokens: number;
    }>();
    for (let turn = 0; turn < 8; turn++) {
        const wrapped = structuredClone(coordinationRequest);
        wrapped.requirements = structuredClone(fullRequirements);
        const req = wrapped.coordination.coordination;
        req.turnId = 'turn_fresh_' + turn;
        req.inputMessageId = 'message_fresh_' + turn;
        req.content = 'Inspect complete scope ' + turn;
        req.operation = { kind: 'message', input: { kind: 'text', content: req.content } };
        req.context.projectMemory.revision = turn + 1;
        req.context.projectMemory.decisions = [{ id: 'decision_theme', projectId: req.projectId, revision: turn + 1, kind: 'preference', text: turn < 3 ? 'Warm preference' : 'Corrected dark preference', status: 'active', sourceTurnId: 'turn_preference', sourceMessageIds: ['message_preference'], sourceProposalId: null, sourceClarificationId: null, supersedesDecisionId: null, confirmedAt: req.context.asOf, createdAt: req.context.asOf, updatedAt: req.context.asOf }];
        req.context.recentMessages = []; // Canonical memory and scope survive eviction from bounded recent history.
        if (turn === 7) {
            req.content = '深色';
            req.operation = structuredClone(continuationCoordination.operation);
        }
        const usage = { modelSteps: 0, inputTokens: 0, outputTokens: 0 };
        perTurnUsage.set(req.turnId, usage);
        const context: CoordinationModelContext = { requirements: wrapped, deliveryFacts: wrapped.coordination.deliveryFacts, request: req, signal: new AbortController().signal, projectHome: home, stableWorkspace: path.join(root, 'workspace'), sources: [{ path: 'source/src/View.tsx', text: 'export const canonicalSource = "published";', sha256: sha256('export const canonicalSource = "published";') }], report: () => { }, meter: u => { usage.modelSteps += u.modelSteps || 0; usage.inputTokens += u.inputTokens || 0; usage.outputTokens += u.outputTokens || 0; }, remainingOutputTokens: () => 1000 - usage.outputTokens, excludedTurnIds: new Set() };
        await adapter.decide(context, false);
        if (turn === 7)
            await adapter.decide(context, true);
        await adapter.commit(req.projectId, req.turnId);
    }
    assert.equal(calls, 9);
    assert.equal(resumes, 0);
    assert.equal(closes, 9);
    assert.equal(new Set(names).size, 9);
    assert.equal(await readFile(path.join(home, 'router-session-1.json'), 'utf8'), markerBefore);
    for (const [index, prompt] of prompts.entries()) {
        for (const entry of fullRequirements.entries)
            assert.ok(prompt.includes(entry.text));
        assert.equal(prompt.split('AUTHORITATIVE ACCUMULATED REQUIREMENTS:').length - 1, 1);
        assert.ok(prompt.includes('published'));
        assert.ok(prompt.includes('deliveryVerificationFacts'));
        assert.ok(!prompt.includes('opaque_old_native_session'));
        assert.ok(prompt.includes(index < 3 ? 'Warm preference' : 'Corrected dark preference'));
        if (index >= 3)
            assert.ok(!prompt.includes('Warm preference'), 'old native preferences cannot shadow corrected API memory');
    }
    const last = prompts.at(-1)!;
    assert.ok(last.includes(continuationCoordination.operation.kind === 'clarification_answer' ? continuationCoordination.operation.questionSnapshot.question : ''));
    assert.match(last, /"answerRef":"u0"/);assert.match(last,/"currentInput":\{"ref":"u0","text":"深色"\}/);
    assert.equal(perTurnUsage.get('turn_fresh_7')!.modelSteps, 2);
    assert.equal(perTurnUsage.get('turn_fresh_7')!.inputTokens, 30);
    assert.equal(perTurnUsage.get('turn_fresh_7')!.outputTokens, 40);
    assert.equal(options[7].maxTokens, 1000);
    assert.equal(options[8].maxTokens, 980, 'same-turn retry does not reset output budget');
    assert.ok(Math.max(...prompts.map(p => Buffer.byteLength(p))) - Math.min(...prompts.map(p => Buffer.byteLength(p))) < 2000, 'growth is current snapshot/question delta, not cumulative native replay');
    const diagnostics = (await readFile(path.join(home, 'coordination-diagnostics.jsonl'), 'utf8')).trim().split('\n').map(x => JSON.parse(x));
    assert.equal(diagnostics.length, 9);
    assert.ok(diagnostics.every(d => d.sessionContext === 'authoritative_snapshot' && d.promptBytes > 0));
});
test('legacy coordination still resumes its existing native session', async (t) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'atoms-legacy-coordination-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    await writeFile(path.join(home, 'router-session-1.json'), JSON.stringify({ sessionId: 'session_legacy_native', model: 'deepseek-flash' }));
    let resumes = 0;
    const adapter = new DshCoordinatorAdapter({ apiKey: 'synthetic-no-provider', harnessFactory: () => ({ async start() { }, session() { throw new Error('legacy should resume'); }, async resumeSession(id: string) { assert.equal(id, 'session_legacy_native'); resumes++; return { async run(_prompt: string, callback: any) { callback.onNotification({ method: 'session.event', params: { sessionId: id, event: { type: 'step/start', seq: 1, data: { turn: 1, step: 0 } } } }); callback.onNotification({ method: 'session.event', params: { sessionId: id, event: { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } } } }); return { sessionId: id, finishReason: 'stop', finalResponse: '{"kind":"consult","answer":"legacy","references":[],"memoryUpdates":[]}' }; } }; }, async close() { } } as unknown as DeepSeekHarness) });
    await adapter.decide({ request: structuredClone(startCoordination), signal: new AbortController().signal, projectHome: home, stableWorkspace: home, sources: [], report: () => { }, meter: () => { }, remainingOutputTokens: () => 1000, excludedTurnIds: new Set() }, false);
    assert.equal(resumes, 1);
});
