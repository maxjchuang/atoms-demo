import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExecutionSnapshot } from '@atoms/contracts';
import { startExecution } from '@atoms/contracts/fixtures';
import { createAgentServer } from '../src/runtime.js';

const token = 'question-test-service-token';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function setup(t: { after: (callback: () => Promise<void>) => void }, dataDir?: string) {
  const directory = dataDir || await mkdtemp(path.join(os.tmpdir(), 'atoms-question-'));
  const app = createAgentServer({ dataDir: directory, serviceToken: token, mode: 'fake' });
  const origin = await app.listen();
  t.after(async () => { await app.close(); if (!dataDir) await rm(directory, { recursive: true, force: true }); });
  const call = (suffix = '', method = 'GET', body?: unknown) => fetch(`${origin}/internal/v1/executions/${startExecution.executionId}${suffix}`, {
    method, headers: { authorization: `Bearer ${token}`, 'x-atoms-protocol-version': '0.1.0', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { app, call, directory };
}
async function wait(call: Awaited<ReturnType<typeof setup>>['call'], statuses: string[]) {
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    const value = ExecutionSnapshot.parse(await (await call()).json());
    if (statuses.includes(value.status)) return value;
    if (['failed', 'cancelled', 'interrupted'].includes(value.status)) throw new Error(JSON.stringify(value));
    await delay(25);
  }
  throw new Error('Question run timeout');
}

test('ordinary question survives restart, receives validated answer and resumes immutable original Run', { timeout: 60000 }, async (t) => {
  const first = await setup(t);
  const request = { ...startExecution, prompt: '[question] 创建便签墙', mode: 'build' };
  assert.equal((await first.call('', 'PUT', request)).status, 201);
  const waiting = await wait(first.call, ['waiting_input']);
  assert.equal(waiting.pendingAttention?.kind, 'question');
  const before = first.app.runtime.get(startExecution.executionId);
  const originalHash = before.hash; const originalRequest = JSON.stringify(before.request);
  await first.app.close();
  const restarted = await setup(t, first.directory);
  const restored = await wait(restarted.call, ['waiting_input']);
  assert.equal(restored.pendingAttention?.id, waiting.pendingAttention?.id);
  const input = { commandId: 'command_answer', attentionId: restored.pendingAttention!.id,
    expectedRevision: restored.pendingAttention!.revision, answer: { kind: 'select', optionId: 'option_2' } };
  assert.equal((await restarted.call('/inputs', 'POST', { ...input, expectedRevision: 99 })).status, 409);
  assert.equal((await restarted.call('/inputs', 'POST', { ...input, answer: { kind: 'select', optionId: 'option_wrong' } })).status, 400);
  assert.equal((await restarted.call('/inputs', 'POST', input)).status, 202);
  assert.equal((await restarted.call('/inputs', 'POST', input)).status, 202);
  const complete = await wait(restarted.call, ['succeeded']);
  const after = restarted.app.runtime.get(startExecution.executionId);
  assert.equal(after.hash, originalHash); assert.equal(JSON.stringify(after.request), originalRequest);
  assert.equal(after.ordinaryQuestions, 1); assert.equal(after.answers.length, 1);
  assert.equal(after.events.filter((event) => event.event.type === 'execution.started').length, 1);
  const css = await restarted.app.runtime.artifact(startExecution.executionId, complete.artifactId!, 'source/src/style.css');
  assert.match(css.toString(), /#20211e/, 'confirmed dark answer reaches the actual resumed Worker');
  assert.equal(restarted.app.coordinator.records.size, 0, 'Run answer does not create a coordination Turn');
});

test('question policy is capped at two and excludes plan confirmation without resetting budgets', { timeout: 15000 }, async (t) => {
  const { app, call } = await setup(t);
  const request = { ...startExecution, mode: 'plan', prompt: '[questions:3] 创建便签墙' };
  await call('', 'PUT', request);
  const plan = await wait(call, ['waiting_input']); assert.equal(plan.pendingAttention?.kind, 'plan_confirmation');
  await call('/inputs', 'POST', { commandId: 'command_plan', attentionId: plan.pendingAttention!.id,
    expectedRevision: plan.pendingAttention!.revision, answer: { kind: 'approve_plan' } });
  for (let index = 0; index < 2; index++) {
    const question = await wait(call, ['waiting_input']); assert.equal(question.pendingAttention?.kind, 'question');
    await call('/inputs', 'POST', { commandId: `command_question_${index}`, attentionId: question.pendingAttention!.id,
      expectedRevision: question.pendingAttention!.revision, answer: { kind: 'text', text: '深色' } });
  }
  await wait(call, ['failed']);
  const record = app.runtime.get(startExecution.executionId);
  assert.equal(record.ordinaryQuestions, 2); assert.equal(record.answers.length, 2);
  const error = [...record.events].reverse().find((event) => event.event.type === 'execution.failed');
  assert.equal(error?.event.type === 'execution.failed' && error.event.payload.code, 'BUDGET_EXCEEDED');
  assert.ok(!record.events.some((event) => event.event.type === 'artifact.ready'));
  assert.equal(record.request.budget.maxModelSteps, request.budget.maxModelSteps);
  const persisted = JSON.parse(await readFile(path.join(app.runtime.options.dataDir, 'executions.json'), 'utf8'));
  assert.equal(persisted[0].ordinaryQuestions, 2);
});

test('cancelling a waiting ordinary question terminates only that execution', async (t) => {
  const { app, call } = await setup(t);
  await call('', 'PUT', { ...startExecution, prompt: '[question] 创建便签墙' });
  const waiting = await wait(call, ['waiting_input']); assert.equal(waiting.pendingAttention?.kind, 'question');
  await call('/cancel', 'POST', { commandId: 'command_cancel_question' });
  const cancelled = await wait(call, ['cancelled']); assert.equal(cancelled.pendingAttention, null);
  assert.equal(app.runtime.get(startExecution.executionId).answers.length, 0);
  assert.ok(!app.runtime.get(startExecution.executionId).events.some((event) => event.event.type === 'artifact.ready'));
});
