import type { BrowserTestPlanDto } from '@atoms/contracts/delivery';
/** Finite measurement-boundary policy, not entity-identity or natural-language semantic proof. */
export function geometryBoundaryIssues(plan: BrowserTestPlanDto) {
    const issues: {
        caseId: string;
        stepId: string;
        effectStepIds: string[];
        detail: string;
    }[] = [];
    for (const c of plan.cases) {
        const baselines = new Map<string, number>();
        for (const [index, s] of c.steps.entries()) {
            if (s.op === 'save_box')
                baselines.set(s.variable, index);
            if (s.op !== 'expect_box_moved' && s.op !== 'expect_box_same')
                continue;
            const before = baselines.get(s.baseline);
            if (before === undefined)
                continue;
            const effects = c.steps.slice(before + 1, index).filter(x => ['click', 'fill', 'check', 'press', 'drag_by', 'reload'].includes(x.op));
            if (effects.length > 1 || s.op === 'expect_box_moved' && effects.length !== 1)
                issues.push({ caseId: c.id, stepId: s.id, effectStepIds: effects.map(e => e.id), detail: 'Geometry must measure exactly one explicit effect after its saved baseline. Initialization/selection/explicit focus belongs before save_box (new IR setupActions). A target.press implicitly focuses its target; no extra focus click is needed. Never silently reorder a frozen plan.' });
        }
    }
    return issues;
}
export class GeometryBoundaryError extends Error {
    readonly controllerCategory = 'replan_required';
    constructor() { super('冻结几何步骤在基线与断言间包含多个交互或缺少明确效果；需要先审阅前置与测量边界，不能继续消耗源码修复。'); }
}
export function assertGeometryBoundary(plan: BrowserTestPlanDto) { if (geometryBoundaryIssues(plan).length)
    throw new GeometryBoundaryError(); }
