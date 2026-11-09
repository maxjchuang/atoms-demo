import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentServer } from '../src/runtime.js';
import { startExecution } from '@atoms/contracts/fixtures';
import { beginControllerEffect, validateController } from '../src/repair-controller.js';
import { atomicLedger } from '../src/atomic-ledger.js';
import { FakeDshAdapter } from '../src/adapters.js';
test('actual Runtime restart marks a valid pending effect interrupted/unknown without a new model or replayed journal effect', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-controller-restart-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    let calls = 0;
    class NeverModel extends FakeDshAdapter {
        async generate(): Promise<never> { calls++; throw new Error('must not infer'); }
    }
    const first = createAgentServer({ dataDir: root, mode: 'fake', serviceToken: 'controller-restart-token', adapter: new NeverModel() });
    first.runtime.start(structuredClone(startExecution), startExecution.executionId);
    const record = first.runtime.get(startExecution.executionId);
    record.snapshot.status = 'running';
    record.pendingModelRequest = true;
    const b = { sourceHash: null, specHash: null, planHash: null, bindingHash: null, toolchainHash: null, requestHash: record.hash };
    const budget = { known: true, used: { modelSteps: 0, inputTokens: 0, outputTokens: 0, activeMs: 0 }, remaining: { modelSteps: 8, inputTokens: 65536, outputTokens: 24576, activeMs: 900000 }, repairUsed: 0, repairLimit: 2 };
    beginControllerEffect(record, 'generate', b, budget, () => atomicLedger(path.join(root, 'executions.json'), [record]));
    const hash = record.repairController!.entries[0].hash;
    await first.close();
    const second = createAgentServer({ dataDir: root, mode: 'fake', serviceToken: 'controller-restart-token', adapter: new NeverModel() });
    t.after(() => second.close());
    await new Promise(r => setTimeout(r, 20));
    const restarted = second.runtime.get(startExecution.executionId);
    assert.equal(restarted.snapshot.status, 'interrupted');
    assert.equal(restarted.usageKnown, false);
    assert.equal(calls, 0);
    assert.equal(restarted.repairController!.revision, 1);
    assert.equal(restarted.repairController!.entries[0].hash, hash);
    assert.ok(restarted.repairController!.pendingEffect);
    validateController(restarted.repairController!);
    assert.equal(restarted.snapshot.artifactId, null);
});
