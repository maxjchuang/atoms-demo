import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryReport } from '@atoms/contracts/delivery';
import { complete, planningFailure } from '@atoms/contracts/delivery-fixtures';
import { mixedProjection, automaticProjection } from '../src/mock/projection-reports';
import { deliveryGroups } from '../src/delivery-presentation';
import { criterionResult } from '../src/delivery-api';
test('mixed projection preserves every concrete and canonical gap without double counting behavior', () => {
  const before = JSON.stringify(mixedProjection); const groups = deliveryGroups(DeliveryReport.parse(mixedProjection));
  assert.equal(groups.derived, true); assert.equal(groups.criteria.length, 5); assert.equal(groups.parents.length, 3);
  assert.equal(groups.gaps.length, 3); assert.equal(groups.parentGaps.length, 2);
  assert.deepEqual([...groups.gaps, ...groups.parentGaps].map(item => item.criterionId).sort(), mixedProjection.gaps.map(item => item.criterionId).sort());
  assert.ok(groups.gaps.some(item => item.required && item.coverage === 'manual'));
  assert.ok(groups.gaps.some(item => item.required && item.coverage === 'unsupported'));
  assert.equal(criterionResult(mixedProjection, groups.parents[0].id), 'not_run');
  assert.equal(mixedProjection.attempts[0].caseResults.length, 2); assert.equal(JSON.stringify(mixedProjection), before);
});
test('allauto canonical parent results reuse the same cases; host/seed-only and early failure stay unchanged', () => {
  const groups = deliveryGroups(automaticProjection); assert.equal(automaticProjection.quality, 'complete');
  assert.equal(groups.gaps.length + groups.parentGaps.length, 0);
  for (const criterion of [...groups.criteria, ...groups.parents]) assert.equal(criterionResult(automaticProjection, criterion.id), 'passed');
  assert.equal(automaticProjection.attempts[0].caseResults.length, 2);
  assert.equal(deliveryGroups(complete).derived, false); assert.equal(deliveryGroups(complete).criteria.length, complete.bundle!.spec.criteria.length);
  assert.equal(deliveryGroups(planningFailure).parents.length, 0);
});

test('invalid planning item stays a required concrete manual gap while valid automatic cases remain passed', async () => {
  const { manualDemotionProjection: report } = await import('../src/mock/projection-reports');
  const groups = deliveryGroups(report); assert.equal(report.quality, 'partial'); assert.equal(report.attempts[0].caseResults.length, 3);
  assert.ok(report.attempts[0].caseResults.every(item => item.status === 'passed')); assert.equal(groups.gaps.length, 1);
  assert.equal(groups.gaps[0].required, true); assert.equal(groups.gaps[0].coverage, 'manual'); assert.equal(groups.gaps[0].result, 'not_run');
  assert.match(groups.gaps[0].reason, /跨窗口排序/); assert.match(groups.gaps[0].reason, /未执行不代表通过/);
  assert.equal(groups.criteria.filter(item => criterionResult(report, item.id) === 'passed').length, 3);
  assert.equal(criterionResult(report, groups.gaps[0].criterionId), 'not_run'); assert.ok(report.bundle!.spec.originalGoal);
});
