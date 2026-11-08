import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectEventDto } from '@atoms/contracts';
import { run, scenarios, checks } from '@atoms/contracts/fixtures';
import { feedbackTiming, mergeActivityEvents, readActivityHistory, stageState, summarizeActivity, formatDuration } from '../src/activity.js';
import { applyEvents } from '../src/state.js';

const time = '2026-11-08T08:00:00.000Z';
const event = (seq: number, body: ProjectEventDto['event'], occurredAt = time): ProjectEventDto => ({
  protocolVersion: '0.1.0', projectId: run.projectId, runId: run.id, seq, occurredAt, event: body,
});
const file = event(1, { type: 'activity.recorded', payload: { type: 'file.changed', payload: { path: 'src/App.tsx', operation: 'added' } } });
test('history and incremental activities deduplicate by project sequence', () => {
  const events = mergeActivityEvents([file], [file, { ...file, projectId: 'project_other' }], run.projectId);
  assert.equal(events.length, 1);
  assert.equal(summarizeActivity(run, events).files.length, 1);
});
test('API recovery messages and empty polls do not pretend the Runtime made progress', () => {
  const recovery = event(2, { type: 'message.updated', payload: {
    id: 'message_recovery', projectId: run.projectId, runId: run.id, role: 'assistant', status: 'complete', content: 'API 状态同步已恢复', createdAt: '2026-11-08T08:02:00.000Z',
  } }, '2026-11-08T08:02:00.000Z');
  const before = summarizeActivity(run, [file]);
  const after = summarizeActivity(run, mergeActivityEvents([file], [recovery], run.projectId));
  assert.equal(after.lastActivityAt, before.lastActivityAt);
  assert.equal(summarizeActivity(run, mergeActivityEvents([file], [], run.projectId)).lastActivityAt, time);
  assert.ok(after.entries.some((item) => item.title.includes('同步已恢复')));
});
test('delayed source facts keep their occurredAt and timeline stays in sequence order', () => {
  const older = event(2, { type: 'activity.recorded', payload: { type: 'phase.changed', payload: { phase: 'generating' } } }, '2026-11-08T07:59:30.000Z');
  const summary = summarizeActivity({ ...run, status: 'running', phase: 'generating' }, [file, older]);
  assert.equal(summary.lastActivityAt, older.occurredAt);
  assert.deepEqual(summary.entries.map((item) => item.seq), [1, 2]);
  assert.equal(summary.phaseStartedAt, older.occurredAt);
});
test('historical N+1 cannot consume the workspace incremental cursor', async () => {
  const fixture = scenarios.find((item) => item.name === 'success')!;
  const historical = await readActivityHistory(run.projectId, 3, async (_id, after) => ({
    items: fixture.events.filter((item) => item.seq > after), nextCursor: 5, hasMore: false,
  }));
  assert.deepEqual(historical.map((item) => item.seq), [1, 2, 3]);
  const snapshotAtThree = applyEvents(fixture.initial, fixture.events.slice(0, 3));
  assert.equal(snapshotAtThree.eventCursor, 3);
  const final = applyEvents(snapshotAtThree, fixture.events.slice(3));
  assert.equal(final.currentVersion?.id, fixture.final.currentVersion?.id);
  assert.equal(final.latestRun?.status, 'succeeded');
});
test('history loader follows pagination and rejects gaps', async () => {
  const fixture = scenarios[0]; const requested: number[] = [];
  const history = await readActivityHistory(run.projectId, 5, async (_id, after) => {
    requested.push(after); const items = fixture.events.filter((item) => item.seq > after).slice(0, 2);
    return { items, nextCursor: items.at(-1)!.seq, hasMore: items.at(-1)!.seq < 5 };
  });
  assert.deepEqual(requested, [0, 2, 4]); assert.equal(history.length, 5);
  await assert.rejects(readActivityHistory(run.projectId, 5, async () => ({ items: [fixture.events[1]], nextCursor: 2, hasMore: true })));
});
test('required check count is actual returned verdicts, not a progress percentage', () => {
  const checking = event(2, { type: 'activity.recorded', payload: { type: 'check.completed', payload: { ...checks[0], status: 'failed' } } });
  assert.equal(summarizeActivity(run, []).completedChecks, 0);
  assert.equal(summarizeActivity(run, [checking]).completedChecks, 1);
  assert.equal(summarizeActivity({ ...run, checks }, [checking]).completedChecks, 3);
});
test('repair keeps planning/generation milestones complete and verification active', () => {
  const repairing = { ...run, status: 'running' as const, phase: 'repairing' as const };
  assert.equal(stageState(repairing, 'planning'), 'done');
  assert.equal(stageState(repairing, 'generating'), 'done');
  assert.equal(stageState(repairing, 'verifying'), 'active');
  assert.equal(stageState(repairing, 'publishing'), '');
});
test('activity history is task-scoped, and long history retains its phase start', () => {
  const phase = event(1, { type: 'activity.recorded', payload: { type: 'phase.changed', payload: { phase: 'generating' } } });
  const many = Array.from({ length: 220 }, (_, index) => ({ ...file, seq: index + 2 }));
  const summary = summarizeActivity({ ...run, phase: 'generating' }, [phase, ...many]);
  assert.equal(summary.phaseStartedAt, time); assert.equal(summary.entries.length, 221);
  assert.equal(summarizeActivity({ ...run, id: 'run_other' }, [file]).entries.length, 0);
});
test('duration output is bounded at zero and supports multi-minute waits', () => {
  assert.equal(formatDuration(-1), '0秒'); assert.equal(formatDuration(125000), '2分05秒');
});
test('terminal durations freeze but last execution activity remains relative to now', () => {
  const finished = { ...run, status: 'succeeded' as const, resultVersionId: 'version_demo',
    createdAt: '2026-11-08T08:00:00.000Z', updatedAt: '2026-11-08T08:02:00.000Z' };
  const first = feedbackTiming(finished, time, time, Date.parse('2026-11-08T08:03:00.000Z'));
  const later = feedbackTiming(finished, time, time, Date.parse('2026-11-08T08:04:00.000Z'));
  assert.equal(first.total, later.total); assert.equal(first.phase, later.phase);
  assert.equal(later.idle - first.idle, 60000);
});
