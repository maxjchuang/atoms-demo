import assert from 'node:assert/strict';
import test from 'node:test';
import { scenarios } from '@atoms/contracts/fixtures';
import { WorkspaceSnapshot } from '@atoms/contracts';
import { applyEvents, EventGap, isTerminal } from '../src/state.js';

for (const scenario of scenarios) {
  test(`consumer applies ${scenario.name} shared timeline`, () => {
    const value = applyEvents(scenario.initial, scenario.events);
    WorkspaceSnapshot.parse(value);
    assert.equal(value.eventCursor, scenario.final.eventCursor);
    assert.equal(value.currentVersion?.id, scenario.final.currentVersion?.id);
    assert.equal(value.latestRun?.id, scenario.final.latestRun?.id);
    assert.equal(value.latestRun?.status, scenario.final.latestRun?.status);
    assert.equal(value.messages.at(-1)?.content, scenario.final.messages.at(-1)?.content);
  });
}
test('duplicate pages never append messages or advance twice', () => {
  const fixture = scenarios.find((scenario) => scenario.name === 'message-upsert')!;
  const once = applyEvents(fixture.initial, fixture.events);
  const twice = applyEvents(once, fixture.events);
  assert.deepEqual(twice, once);
  assert.equal(twice.messages.length, 1);
  assert.equal(twice.messages[0].status, 'complete');
});
test('cursor gaps force snapshot recovery rather than losing events', () => {
  assert.throws(() => applyEvents(scenarios[0].initial, [scenarios[0].events[2]]), EventGap);
});
test('another project cannot write into the current workspace', () => {
  const snapshot = scenarios[0].initial;
  assert.deepEqual(applyEvents(snapshot, [{ ...scenarios[0].events[0], projectId: 'project_other' }]), snapshot);
});
test('runtime completion is activity only and cannot publish a preview', () => {
  const initial = scenarios[0].initial;
  const next = applyEvents(initial, [{ ...scenarios[0].events[0], event: { type: 'activity.recorded', payload: { type: 'execution.completed', payload: { artifactId: 'artifact_demo' } } } }]);
  assert.equal(next.currentVersion, null);
  assert.equal(next.latestRun?.status, 'queued');
});
test('terminal states are explicit; waiting and cancelling remain nonterminal', () => {
  const run = scenarios[0].finalRun;
  for (const status of ['succeeded', 'failed', 'cancelled', 'interrupted'] as const) assert.equal(isTerminal({ ...run, status }), true);
  for (const status of ['queued', 'running', 'waiting_input', 'cancelling'] as const) assert.equal(isTerminal({ ...run, status }), false);
});
