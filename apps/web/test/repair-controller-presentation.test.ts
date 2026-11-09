import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectEventDto, RunDto } from '@atoms/contracts';
import { run, scenarios } from '@atoms/contracts/fixtures';
import { collectRunHistory } from '../src/run-history';
import { cleanFailureSummary, verificationCounts } from '../src/delivery-presentation';
import { cleanBehaviorFailure, cleanRepairProvisional, cleanRepairComplete } from '../src/mock/repair-controller-reports';
import { exportFailure } from '@atoms/contracts/delivery-fixtures';
import { phasePresentation, summarizeActivity } from '../src/activity';
import { shouldPollDelivery } from '../src/delivery-api';
import { view as reportView, reportBinding } from '@atoms/contracts/delivery-fixtures';

const event = (value: RunDto, seq: number): ProjectEventDto => ({ protocolVersion: '0.1.0', projectId: value.projectId, runId: value.id, seq, occurredAt: value.updatedAt, event: { type: 'run.updated', payload: value } });
test('history includes old failed tasks, deduplicates highest revision and never rewinds current workspace/preview', () => {
  const workspace = structuredClone(scenarios.find(item => item.name === 'success')!.final), before = JSON.stringify(workspace);
  const old: RunDto = { ...run, id: 'run_old_failed', status: 'failed', revision: 2, createdAt: '2026-11-08T07:00:00.000Z' };
  const events = [event(old, 1), event({ ...old, revision: 1, status: 'running' }, 2), event(workspace.latestRun!, 3), event(old, 1)];
  const found = collectRunHistory(workspace, events); assert.equal(found.length, 2); assert.equal(found.find(item => item.id === old.id)!.status, 'failed'); assert.equal(found.find(item => item.id === old.id)!.revision, 2); assert.equal(JSON.stringify(workspace), before);
});
test('foreign history payload/outer scope and mismatched run reference cannot enter task choices', () => {
  const workspace = structuredClone(scenarios.find(item => item.name === 'success')!.final);
  const old = { ...run, id: 'run_history' };
  const good = event(old, 1);
  assert.equal(collectRunHistory(workspace, [{ ...good, projectId: 'project_other' }, { ...good, event: { type: 'run.updated', payload: { ...old, projectId: 'project_other' } } }, { ...good, runId: 'run_different' }]).some(item => item.id === old.id), false);
});
test('candidate pass and independent clean behavior failure remain separate, with actual failed assertion preserved', () => {
  const report = cleanBehaviorFailure, cases = report.bundle!.plan.cases.length;
  assert.equal(verificationCounts(report.attempts[0].caseResults, cases).passed, cases); assert.equal(verificationCounts(report.cleanBuild!.caseResults, cases).failed, 1); assert.equal(report.quality, 'blocked');
  assert.match(cleanFailureSummary(report)!, /行为复验有 1 项失败/); assert.ok(report.cleanBuild!.caseResults.some(item => item.failure?.actual === 'dx=29, dy=174'));
  assert.match(cleanFailureSummary(exportFailure)!, /干净安装/);
});
test('nonfinal failed clean evidence keeps polling, new repair source and previous clean evidence survive', () => {
  const provisional = { ...reportView, subjectVersionId: null, reportFinal: false, report: cleanRepairProvisional, binding: reportBinding(cleanRepairProvisional), quality: cleanRepairProvisional.quality, publication: { status: 'not_published' as const, publishedVersionId: null } };
  assert.equal(shouldPollDelivery(provisional), true); assert.equal(cleanRepairComplete.attempts.at(-1)!.repairRound, 1); assert.notEqual(cleanRepairComplete.attempts[0].sourceBeforeHash, cleanRepairComplete.attempts[1].sourceBeforeHash);
  assert.ok(cleanRepairComplete.evidence.some(item => item.id === 'evidence_clean_previous' && item.scope === 'clean_export')); assert.equal(cleanRepairComplete.cleanBuild!.caseResults.every(item => item.status === 'passed'), true);
});
test('empty failed project never claims a previous successful preview; existing preview is conditional', () => {
  const failed = { ...run, status: 'failed' as const };
  assert.match(phasePresentation(failed, false).description, /当前没有可预览版本/); assert.doesNotMatch(phasePresentation(failed, false).description, /上一成功/);
  assert.match(phasePresentation(failed, true).description, /上一成功版本/);
});
test('phase-entry count is not presented as a trustworthy repair round; messages cannot grant publication', () => {
  const entry: ProjectEventDto = { protocolVersion: '0.1.0', projectId: run.projectId, runId: run.id, seq: 1, occurredAt: run.createdAt, event: { type: 'activity.recorded', payload: { type: 'phase.changed', payload: { phase: 'repairing' } } } };
  const summary = summarizeActivity({ ...run, status: 'running', phase: 'repairing' }, [entry, { ...entry, seq: 2 }]); assert.ok(summary.entries.some(item => item.title.includes('具体轮次以报告为准'))); assert.equal(summary.entries.some(item => /开始第 \d+ 轮/.test(item.title)), false);
});

test('missing frozen case results are explicit and never fabricated as passed, failed or returned not-run', () => {
  assert.deepEqual(verificationCounts([], 5), { passed: 0, failed: 0, other: 0, missing: 5, returned: 0, expected: 5 });
  assert.equal(verificationCounts(cleanBehaviorFailure.cleanBuild!.caseResults, cleanBehaviorFailure.bundle!.plan.cases.length).missing, 0);
});
