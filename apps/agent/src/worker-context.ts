import { canonicalDeliveryJson } from '@atoms/contracts/delivery';
import { sha256 } from './files.js';
export const WORKER_CONTEXT_LIMITS = Object.freeze({ maxPromptBytes: 131072, maxFrozenScopeBytes: 65536, maxRepairBytes: 12288, maxCases: 10 });
const trim = (v: unknown, max = 160, depth = 0): unknown => depth > 4 ? '[bounded-depth]' : typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, max) : Array.isArray(v) ? v.slice(0, 2).map(x => trim(x, max, depth + 1)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).slice(0, 16).map(([k, x]) => [k, trim(x, max, depth + 1)])) : v;
/** A bounded summary, not a replacement for immutable full logs/receipts. */
export function compactRepairFeedback(errors: string, passedCaseIds: string[] = []) { let entries: unknown; try {
    entries = JSON.parse(errors);
}
catch {
    entries = null;
} const envelope=entries&&typeof entries==='object'&&!Array.isArray(entries)&&(entries as {formatVersion?:unknown}).formatVersion==='repair-feedback-v2'?entries as {checks?:unknown;failures?:unknown}:null;const list = Array.isArray(entries) ? entries : Array.isArray(envelope?.failures)?envelope.failures:[];const checks=Array.isArray(envelope?.checks)?envelope.checks.slice(0,3).map((c:any)=>({kind:['typecheck','build','smoke'].includes(c.kind)?c.kind:'host',category:c.category==='code_check'?'code_check':'infrastructure',message:trim(c.message,1024)})):[]; if (list.length > WORKER_CONTEXT_LIMITS.maxCases)
    throw new Error('Repair case summary exceeds frozen case limit'); const failures = list.map((x: any) => { let actual: unknown = x.failure?.actual; try {
    actual = JSON.parse(String(actual));
}
catch { } let expected:unknown=x.failure?.expected;try{expected=JSON.parse(String(expected));}catch{}const expectedObject=expected&&typeof expected==='object'&&'frozenStep'in expected?(expected as {frozenStep:unknown}).frozenStep:expected;
 const observed=actual&&typeof actual==='object'?Object.fromEntries(['op','locator','matchCount','count','expectedCount','delta','expectedDelta','baseline','box','value','visible','stableForMs','requiredStableMs','nodes','actionCenter','lastDrag','observationUnavailable'].filter(k=>k in (actual as object)).map(k=>[k,(actual as Record<string,unknown>)[k]])):actual;
 return { caseId: x.caseId, stage:trim(x.stage??'workspace_verify',32),stepId: x.failure?.stepId, message: trim(x.failure?.message, 160),expected:trim(expectedObject,96), actual: trim(observed,96), observationTruncated: true }; }); const summary = { untrusted: true, passedCaseIds: passedCaseIds.slice(0, 10), checks,failures, ...(!list.length&&!checks.length ? { compilerOrHostMessage: errors.slice(0, 4096) } : {}), fullEvidenceRetained: true }; const text = JSON.stringify(summary); if (Buffer.byteLength(text) > WORKER_CONTEXT_LIMITS.maxRepairBytes)
    throw new Error('Bounded repair summary exceeds context policy; no model request'); return text; }
export function assertWorkerContext(prompt: string, scope: unknown) { const scopeBytes = Buffer.byteLength(canonicalDeliveryJson(scope)); const promptBytes = Buffer.byteLength(prompt); if (scopeBytes > WORKER_CONTEXT_LIMITS.maxFrozenScopeBytes || promptBytes > WORKER_CONTEXT_LIMITS.maxPromptBytes)
    throw new Error('Complete frozen scope/source exceeds bounded Worker context; no truncation or model request'); return { promptBytes, scopeBytes, promptHash: sha256(prompt), policy: 'bounded-worker-v2' }; }
