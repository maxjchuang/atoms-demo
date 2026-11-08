import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startExecution } from '@atoms/contracts/fixtures';
import { startCoordination } from '@atoms/contracts/conversation-fixtures';
import { createAgentServer } from '../src/runtime.js';
import { FakeDshAdapter, type AdapterContext, type GenerationResult } from '../src/adapters.js';
import { FakeCoordinatorAdapter, type CoordinationModelContext } from '../src/coordinator-adapters.js';
import { contextDigest, type SemanticDecision } from '../src/coordination-context.js';
import { StructuredOutputError } from '../src/structured-output.js';
import { NativeUsageAccounting, UsageAccountingError, nativeEventIdentity, normalizeNativeUsage } from '../src/native-usage.js';

// Numeric-only transcription of the six committed native usage reports from
// atoms-m1-integration-Ty23Ah. No prompts, keys, or assistant content are fixtures.
const nativeSample = [
  { inputTokens: 887, outputTokens: 321, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1208 },
  { inputTokens: 1182, outputTokens: 133, cacheReadTokens: 768, cacheWriteTokens: 0, totalTokens: 2083 },
  { inputTokens: 1199, outputTokens: 131, cacheReadTokens: 1920, cacheWriteTokens: 0, totalTokens: 3250 },
  { inputTokens: 1444, outputTokens: 236, cacheReadTokens: 3072, cacheWriteTokens: 0, totalTokens: 4752 },
  { inputTokens: 2011, outputTokens: 443, cacheReadTokens: 4480, cacheWriteTokens: 0, totalTokens: 6934 },
  { inputTokens: 2371, outputTokens: 137, cacheReadTokens: 6400, cacheWriteTokens: 0, totalTokens: 8908 },
];

test('effective input includes disjoint SDK cache reads/writes, but never adds output to input', () => {
  const accounting = new NativeUsageAccounting();
  nativeSample.forEach((usage, index) => {
    const normalized = accounting.add(`event_${index}`, usage)!;
    assert.equal(normalized.inputTokens, usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens);
    assert.equal(normalized.mode, 'disjoint');
  });
  accounting.assertObservable();
  assert.deepEqual(accounting.metadata(), { accountingVersion: 'effective-input-v1', samples: 6, modes: ['disjoint'], missingEventIdentity: 0,
    unknownInputSamples: 0, unknownOutputSamples: 0, effectiveInputTokens: 25734, outputTokens: 1401,
    reportedInputTokens: 9094, cacheReadTokens: 16640, cacheWriteTokens: 0, reportedTotalTokens: 27135 });
  assert.equal(normalizeNativeUsage({ inputTokens: 10, cacheReadTokens: 40, cacheWriteTokens: 5, outputTokens: 2, totalTokens: 57 }).inputTokens, 55);
});

test('already-inclusive input is not charged a second cache component when total confirms the convention', () => {
  const normalized = normalizeNativeUsage({ inputTokens: 2000, cacheReadTokens: 800, cacheWriteTokens: 100,
    outputTokens: 200, totalTokens: 2200 });
  assert.equal(normalized.inputTokens, 2000); assert.equal(normalized.outputTokens, 200);
  assert.equal(normalized.mode, 'cache_already_in_input');
});

test('duplicate settled event/step is counted once; identical usage in a distinct step is still counted', () => {
  const accounting = new NativeUsageAccounting();
  const key = nativeEventIdentity('session_test', { seq: 7, data: { turn: 1, step: 1 } });
  assert.equal(accounting.step(key), true); assert.equal(accounting.step(key), false);
  const raw = nativeSample[1];
  assert.ok(accounting.add(key, raw));
  assert.equal(accounting.add(key, raw), null, 'a final/replayed record with the same identity is not re-added');
  assert.ok(accounting.add(nativeEventIdentity('session_test', { data: { turn: 1, step: 2 } }), raw));
  assert.equal(accounting.metadata().effectiveInputTokens, 3900);
  assert.equal(accounting.metadata().samples, 2);
});

test('ambiguous/incomplete fields use conservative reported bounds and expose numerical accounting metadata only', () => {
  const accounting = new NativeUsageAccounting();
  const contradictory = accounting.add(undefined, { inputTokens: 100, cacheReadTokens: 50, outputTokens: 10, totalTokens: 300 })!;
  assert.equal(contradictory.inputTokens, 290); assert.equal(contradictory.mode, 'conservative');
  const missingOutput = accounting.add('missing_output', { inputTokens: 100, cacheReadTokens: 50, totalTokens: 160 })!;
  assert.equal(missingOutput.inputTokens, 160); assert.equal(missingOutput.outputTokens, 160);
  const derived = normalizeNativeUsage({ cacheReadTokens: 20, outputTokens: 10, totalTokens: 50 });
  assert.equal(derived.inputTokens, 40); assert.equal(derived.mode, 'derived_from_total');
  assert.equal(accounting.metadata().missingEventIdentity, 1);
  assert.throws(() => normalizeNativeUsage({ inputTokens: -1 }), UsageAccountingError);
  const absent = new NativeUsageAccounting(); absent.add('empty', {});
  assert.throws(() => absent.assertObservable(), UsageAccountingError);
  assert.ok(!JSON.stringify(accounting.metadata()).includes('prompt'));
});

const cachedStep = { inputTokens: 10, cacheReadTokens: 40, cacheWriteTokens: 0, outputTokens: 5, totalTokens: 55 };
const feed = (context: { meter: (usage: { modelSteps?: number; inputTokens?: number; outputTokens?: number }) => void }) => {
  const usage = normalizeNativeUsage(cachedStep); context.meter({ modelSteps: 1, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
};
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Usage budget test timeout'); await new Promise((resolve) => setTimeout(resolve, 10)); }
}

test('Worker cumulative input budget includes cached input across planning/generation and prevents source delivery', async (t) => {
  class CachedWorker extends FakeDshAdapter {
    override async plan(context: AdapterContext) { feed(context); return { summary: 'budget fixture', tasks: ['check budget'], acceptance: [{ id: 'acceptance_budget', description: 'budget enforced' }] }; }
    override async generate(context: AdapterContext): Promise<GenerationResult> { feed(context); throw new Error('must stop at the budget boundary'); }
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'atoms-worker-cache-budget-'));
  const app = createAgentServer({ dataDir: directory, serviceToken: 'usage-test-service-token', mode: 'fake', adapter: new CachedWorker() });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = { ...startExecution, budget: { ...startExecution.budget, maxInputTokens: 75 } };
  app.runtime.start(request, request.executionId);
  await until(() => app.runtime.get(request.executionId).snapshot.status === 'failed');
  const record = app.runtime.get(request.executionId);
  assert.equal(record.usage.inputTokens, 100, 'two 50-token effective inputs cross the original 75-token bound');
  const failure = [...record.events].reverse().find((event) => event.event.type === 'execution.failed');
  assert.equal(failure?.event.type === 'execution.failed' && failure.event.payload.code, 'BUDGET_EXCEEDED');
  assert.ok(!record.events.some((event) => event.event.type === 'artifact.ready' || event.event.type === 'file.changed'));
});

test('Router cached input accumulates across a bounded retry and stops without returning a decision', async (t) => {
  class CachedRouter extends FakeCoordinatorAdapter {
    calls = 0;
    override async decide(context: CoordinationModelContext): Promise<SemanticDecision> {
      this.calls++; feed(context);
      throw new StructuredOutputError('coordinator', 0, 'completed');
    }
  }
  const adapter = new CachedRouter(); const directory = await mkdtemp(path.join(os.tmpdir(), 'atoms-router-cache-budget-'));
  const app = createAgentServer({ dataDir: directory, serviceToken: 'usage-test-service-token', mode: 'fake', coordinatorAdapter: adapter });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = structuredClone(startCoordination); request.context.hash = contextDigest(request.context); request.budget.maxInputTokens = 75;
  app.coordinator.start(request, request.turnId);
  await until(() => app.coordinator.get(request.turnId).snapshot.status === 'failed');
  const state = app.coordinator.get(request.turnId).snapshot;
  assert.equal(state.usage.inputTokens, 100); assert.equal(state.error?.code, 'BUDGET_EXCEEDED');
  assert.equal(state.result, null); assert.equal(adapter.calls, 2); assert.equal(app.runtime.records.size, 0);
});
