import type { DeliveryReportDto } from '@atoms/contracts/delivery';
import { hasDerivedModelCriteria } from '@atoms/contracts/delivery-projection';
/** Presentation only: preserve all authoritative objects, methods, results and order within each group. */
export function deliveryGroups(report: DeliveryReportDto | null) {
  const spec = report?.bundle?.spec;
  const derived = !!report && !!spec && hasDerivedModelCriteria(report.seed, spec);
  const parents = new Set(derived ? report!.seed.items.map(item => item.id) : []);
  return {
    derived,
    criteria: (spec?.criteria ?? []).filter(item => !parents.has(item.id)),
    parents: (spec?.criteria ?? []).filter(item => parents.has(item.id)),
    gaps: (report?.gaps ?? []).filter(item => !parents.has(item.criterionId)),
    parentGaps: (report?.gaps ?? []).filter(item => parents.has(item.criterionId)),
  };
}

export function verificationCounts(results: NonNullable<DeliveryReportDto['cleanBuild']>['caseResults'], expected?: number) {
  return { passed: results.filter(item => item.status === 'passed').length, failed: results.filter(item => item.status === 'failed').length,
    other: results.filter(item => !['passed', 'failed'].includes(item.status)).length, missing: Math.max(0, (expected ?? results.length) - results.length), returned: results.length, expected: expected ?? results.length };
}
/** Typed facts only: no inference from provider/console/error-message keywords. */
export function cleanFailureSummary(report: DeliveryReportDto | null) {
  if (!report?.cleanBuild) return null;
  const failed = report.cleanBuild.caseResults.filter(item => item.status === 'failed');
  if (failed.length) return `独立源码 ZIP 行为复验有 ${failed.length} 项失败；候选验证通过不等于交付成功。`;
  const stages = Object.entries(report.cleanBuild.stages).filter(([, value]) => value.status === 'failed').map(([name]) => ({ install: '干净安装', typecheck: '类型检查', build: '构建', smoke: '页面运行' })[name as 'install' | 'typecheck' | 'build' | 'smoke']);
  return stages.length ? `独立源码 ZIP 的${stages.join('、')}未通过；不是单凭候选结果可以发布。` : null;
}
