import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { BrowserStep, LocatorSpec, canonicalDeliveryJson, type BrowserTestPlanDto } from '@atoms/contracts/delivery';
import { ModelPlanSchemaError, type SafePlanIssue } from './planning-format.js';
import { reviewPlanSemantics, type SemanticSource } from './planning-semantics.js';
import { sha256 } from './files.js';
const stepFields = new Set(['op', 'target', 'key', 'checked', 'visible', 'comparison', 'value', 'expected', 'variable', 'baseline', 'relativeTo', 'dx', 'dy', 'tolerancePx']);
const clip = (v: unknown, n: number): unknown => typeof v === 'string' ? v.slice(0, n) : v === null || typeof v === 'boolean' || typeof v === 'number' ? v : '[invalid type]';
/** Allowlisted public proposal fields only: never native blocks, analysis, tool history or unknown field values. */
export function sanitizePlanningProposal(raw: unknown) { const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}; const list = (v: unknown, max: number) => Array.isArray(v) ? v.slice(0, max) : []; const strings = (v: unknown) => list(v, 50).map(x => clip(x, 128)); return { criteria: list(o.criteria, 50).map((c: any) => ({ ref: clip(c?.ref, 128), description: clip(c?.description, 20000), sourceSeedRefs: strings(c?.sourceSeedRefs) })), cases: list(o.cases, 10).map((c: any) => ({ ref: clip(c?.ref, 128), name: clip(c?.name, 240), criterionRefs: strings(c?.criterionRefs), steps: list(c?.steps, 120).map((s: any) => Object.fromEntries(Object.entries(s && typeof s === 'object' ? s : {}).filter(([k]) => stepFields.has(k)).map(([k, v]) => [k, k === 'target' || k === 'relativeTo' ? Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([key]) => ['by', 'role', 'name', 'exact', 'nth', 'value'].includes(key)).map(([key, value]) => [key, clip(value, 240)])) : k === 'expected' ? Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([key]) => ['kind', 'value', 'variable', 'offset'].includes(key)).map(([key, value]) => [key, clip(value, 240)])) : clip(v, 20000)]))) })), coverage: list(o.coverage, 50).map((c: any) => ({ criterionRef: clip(c?.criterionRef, 128), method: clip(c?.method, 32), caseRefs: strings(c?.caseRefs), reason: clip(c?.reason, 20000) })) }; }
export async function savePlanningProposal(home: string, index: number, raw: unknown, compiled?: unknown, issues: SafePlanIssue[] = []) { if (index < 0 || index > 1)
    throw new Error('Planning proposal receipt count exceeded'); const proposal = sanitizePlanningProposal(raw); const payload = { version: 1, attempt: index, proposal, compiled: compiled ?? null, issues: issues.slice(0, 120) }; const text = canonicalDeliveryJson(payload); const stored = Buffer.byteLength(text) <= 130000 ? payload : { version: 1, attempt: index, omitted: true, reason: 'sanitized_proposal_size_limit', proposalHash: sha256(canonicalDeliveryJson(proposal)), bytes: Buffer.byteLength(text), issues: issues.slice(0, 120) }; const body = canonicalDeliveryJson(stored); const envelope = canonicalDeliveryJson({ hash: sha256(body), bytes: Buffer.byteLength(body), payload: stored }); const dir = path.join(home, 'planner-proposals'); await mkdir(dir, { recursive: true, mode: 0o700 }); const file = path.join(dir, 'attempt_' + index + '.json'); try {
    await writeFile(file, envelope, { flag: 'wx', mode: 0o600 });
    await chmod(file, 0o600);
}
catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(file, 'utf8') !== envelope)
        throw new Error('Immutable planner proposal receipt conflict');
} return file; }
/** Diagnostic projection only. Original malformed steps are never mutated or accepted. */
export function inspectPlanningCandidate(raw: unknown, sources: SemanticSource[] = []) { const o = raw as {
    cases?: unknown;
}; const issues: SafePlanIssue[] = []; const cases: BrowserTestPlanDto['cases'] = []; if (Array.isArray(o?.cases))
    for (const [cidx, value] of o.cases.slice(0, 10).entries()) {
        const c = value as {
            steps?: unknown;
        };
        const steps: BrowserTestPlanDto['cases'][number]['steps'] = [];
        if (Array.isArray(c?.steps))
            for (const [sidx, value] of c.steps.slice(0, 120).entries()) {
                const original = value && typeof value === 'object' ? value as Record<string, unknown> : {};
                const candidate: Record<string, unknown> = { ...original, id: `step_${cidx + 1}_${sidx + 1}`, timeoutMs: 5000 };
                const parsed = BrowserStep.safeParse(candidate);
                if (parsed.success)
                    steps.push(parsed.data);
                else {
                    for (const e of parsed.error.issues)
                        issues.push({ code: e.code, path: ['cases', cidx, 'steps', sidx, ...e.path], requirement: e.path.at(-1) === 'comparison' ? 'comparison must be exactly exact or contains.' : 'Use the exact shared operation fields and types.' });
                    const comparisonOnly = parsed.error.issues.every(e => e.path.length === 1 && e.path[0] === 'comparison');
                    if (comparisonOnly && LocatorSpec.safeParse(candidate.target).success)
                        steps.push(candidate as never);
                }
            }
        if (steps.length)
            cases.push({ id: 'case_' + (cidx + 1), name: 'diagnostic projection', criterionIds: [], steps });
    } const receipt = reviewPlanSemantics({ hash: sha256(canonicalDeliveryJson(sanitizePlanningProposal(raw))), cases } as BrowserTestPlanDto, sources); for (const e of receipt.issues) {
    const cidx = Number(e.caseId.slice(5)) - 1;
    const parts = e.stepId.split('_');
    const sidx = Number(parts.at(-1)) - 1;
    issues.push({ code: e.code, path: ['cases', cidx, 'steps', sidx], requirement: e.detail + ' Unknown mappings must remain required manual/unsupported; do not weaken the goal.' });
} return { issues, receipt }; }
const semantics = new Set(['COUNT_ON_SCALAR_VALUE', 'COUNT_ON_INDEXED_LOCATOR', 'COLLECTION_UNPROVEN', 'STATE_TRIGGER_UNPROVEN', 'ACTION_WITHOUT_POSTCONDITION', 'CASE_WITHOUT_ASSERTION']);
export function combinedPlanIssues(...groups: SafePlanIssue[][]) { const by = new Map<string, SafePlanIssue>(); for (const group of groups)
    for (const issue of group) {
        const key = issue.code + ':' + JSON.stringify(issue.path);
        if (!by.has(key))
            by.set(key, issue);
    } return [...by.values()].slice(0, 120); }
export function safePlanFailure(error: unknown) { if (!(error instanceof ModelPlanSchemaError))
    return null; const counts = new Map<string, number>(); for (const i of error.issues.slice(0, 120)) {
    const category = semantics.has(i.code) ? i.code : i.path.at(-1) === 'comparison' ? 'SCHEMA_COMPARISON' : ['invalid_type', 'unrecognized_keys'].includes(i.code) ? 'SCHEMA_FIELDS' : /ref|coverage|seed|mapping|backlink/.test(i.code) ? 'SCHEMA_REFERENCE' : 'SCHEMA_OTHER';
    counts.set(category, (counts.get(category) || 0) + 1);
} const schema = [...counts].filter(([k]) => !semantics.has(k)).reduce((n, [, v]) => n + v, 0), semantic = [...counts].filter(([k]) => semantics.has(k)).reduce((n, [, v]) => n + v, 0); if (!schema && !semantic)
    return null; return `PLAN_REVIEW_V1 schema=${schema} semantic=${semantic} categories=${[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + ':' + v).join(',')}。请先修正计划的字段、初始条件或可验证效果；未启动代码生成。`; }
