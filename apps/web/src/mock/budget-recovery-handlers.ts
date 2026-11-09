import { http, HttpResponse, delay } from 'msw';
import { BudgetRecoveryProtocolVersion, BudgetRecoveryVersionHeader, BudgetRecoveryReadView, ContinueBudgetRequest, ContinueBudgetResponse } from '@atoms/contracts/budget-recovery';
import * as fixture from '@atoms/contracts/budget-recovery-fixtures';
import { mockExecutionStore as execution } from './handlers';
type Settings = { scenario: string; issuedAt: string; revision: number; delayMs?: number; postCount: number; successorId?: string; acceptedKey?: string; acceptedBody?: string };
const storageKey = 'atoms_web_mock_budget_recovery';
let store: Record<string, Settings>;
try { store = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); } catch { store = {}; }
const save = () => localStorage.setItem(storageKey, JSON.stringify(store));
const headers = { [BudgetRecoveryVersionHeader]: BudgetRecoveryProtocolVersion, 'Cache-Control': 'private, no-store' };
function error(status: number, code: string, message: string) { return HttpResponse.json({ error: { code, message, requestId: 'request_budget_mock', retryable: status >= 500 } }, { status, headers }); }
function view(runId: string) {
  const found = execution.findRun(runId); if (!found) return null;
  const { record, run } = found, settings = store[runId];
  const diagnosis = settings?.scenario === 'legacy' || !settings ? null : { ...fixture.diagnosis, projectId: run.projectId, runId: run.id, executionId: run.executionId!, asOf: execution.now(),
    ...(settings.scenario === 'output' ? { dimension: 'output_tokens' as const, trigger: 'segment_limit_reached' as const, observedLowerBound: 24576, limit: 24576, nextRequestReservation: null } : {}),
    ...(settings.scenario === 'steps' ? { classification: 'model_step_budget' as const, dimension: 'model_steps' as const, trigger: 'segment_limit_reached' as const, observedLowerBound: 8, limit: 8, nextRequestReservation: null } : {}) };
  const successorRun = settings?.successorId ? record.runs.find(value => value.id === settings.successorId)! : null;
  const reason = successorRun ? 'ALREADY_CONTINUED' : !diagnosis ? 'DIAGNOSIS_UNAVAILABLE' : settings.scenario === 'plan-review' ? 'PLAN_REVIEW_REQUIRED' : settings.scenario === 'steps' ? 'NOT_TOKEN_BUDGET' : settings.scenario === 'missing-source' ? 'CHECKPOINT_MISSING' : settings.scenario === 'stop-unconfirmed' ? 'STOP_UNCONFIRMED' : settings.scenario === 'no-quota' ? 'QUOTA_EXHAUSTED' : null;
  if (settings && Date.now() - Date.parse(settings.issuedAt) >= 60000) { settings.issuedAt = execution.now(); settings.revision++; save(); }
  const eligible = reason === null;
  return BudgetRecoveryReadView.parse({ ...fixture.readView, projectId: run.projectId, runId: run.id, revision: settings?.revision ?? 1, diagnosis, eligible, reason,
    quota: settings?.scenario === 'no-quota' ? { ...execution.session().quota, runLimit: execution.state.used + execution.state.reserved } : execution.session().quota,
    lineage: { rootRunId: run.id, parentRunId: null, segment: 0, successorRun },
    offer: !eligible ? null : { ...fixture.offer, runId: run.id, projectId: run.projectId, revision: settings.revision, expectedProjectRevision: record.project.revision,
      expectedHeadVersionId: record.project.currentVersionId, expectedLatestRunId: run.id, issuedAt: settings.issuedAt, expiresAt: new Date(Date.parse(settings.issuedAt) + 60000).toISOString() } });
}
export const budgetRecoveryHandlers = [
  http.post('/__mock/budget-recovery/seed', async ({ request }) => {
    const body = await request.json() as { projectId: string; runId?: string; scenario?: string; delayMs?: number };
    const record = execution.find(body.projectId); if (!record) return error(404, 'NOT_FOUND', 'Mock项目不存在。');
    let run = body.runId ? record.runs.find(value => value.id === body.runId) : record.runs.at(-1);
    if (!run) { run = { ...fixture.continueResponse.run, id: execution.id('run'), projectId: record.project.id, createdAt: execution.now(), updatedAt: execution.now() }; record.runs.push(run); execution.state.used++; }
    execution.update(record, run, { status: 'failed', phase: 'generating', executionId: execution.id('execution'), error: { code: 'BUDGET_EXCEEDED', message: 'DSH execution aborted (synthetic history only).' } }); record.project.activeRunId = null; execution.save();
    store[run.id] = { scenario: body.scenario ?? 'eligible', issuedAt: execution.now(), revision: 1, postCount: 0, delayMs: body.delayMs }; save();
    return HttpResponse.json({ runId: run.id });
  }),
  http.get('/__mock/budget-recovery/:runId/stats', ({ params }) => HttpResponse.json(store[String(params.runId)] ?? {})),
  http.get('/api/budget-recovery/v1/runs/:runId', async ({ params, request }) => {
    if (!execution.state.authenticated) return error(401, 'UNAUTHENTICATED', '请重新登录。');
    if (request.headers.get(BudgetRecoveryVersionHeader) !== BudgetRecoveryProtocolVersion) return error(400, 'INVALID_REQUEST', '版本不一致。');
    const settings = store[String(params.runId)]; if (settings?.delayMs) await delay(settings.delayMs);
    const value = view(String(params.runId)); return value ? HttpResponse.json(value, { headers }) : error(404, 'NOT_FOUND', '任务不存在。');
  }),
  http.post('/api/budget-recovery/v1/runs/:runId/continue', async ({ params, request }) => {
    const found = execution.findRun(params.runId); if (!found || !execution.state.authenticated) return error(401, 'UNAUTHENTICATED', '请重新登录后核对。');
    const settings = store[found.run.id], parsed = ContinueBudgetRequest.safeParse(await request.json()), key = request.headers.get('Idempotency-Key');
    if (!settings || !key || !parsed.success || request.headers.get(BudgetRecoveryVersionHeader) !== BudgetRecoveryProtocolVersion) return error(400, 'INVALID_REQUEST', '续作请求无效。');
    if (settings.scenario === 'slow-submit') await delay(700);
    settings.postCount++; save(); const current = view(found.run.id)!;
    if (!settings.successorId) {
      if (settings.scenario === 'stale') { settings.scenario = 'eligible'; settings.revision++; save(); return error(409, 'STALE_OFFER', '报价已变化，请重新读取并明确确认。'); }
      if (!current.eligible || !current.offer) return error(403, current.reason === 'PLAN_REVIEW_REQUIRED' ? 'PLAN_REVIEW_REQUIRED' : 'NOT_ELIGIBLE', '当前任务不可付额继续。');
      if (parsed.data.offerId !== current.offer.id || parsed.data.expectedOfferRevision !== current.offer.revision || parsed.data.expectedSourceHash !== current.offer.sourceSnapshotHash || parsed.data.expectedSemanticHash !== current.offer.semanticHash || parsed.data.expectedProjectRevision !== current.offer.expectedProjectRevision || parsed.data.expectedHeadVersionId !== current.offer.expectedHeadVersionId || JSON.stringify(parsed.data.checkpoint) !== JSON.stringify(current.offer.checkpoint)) return error(409, 'STALE_OFFER', '报价或恢复来源已变化。');
      const run = { ...fixture.continueResponse.run, id: execution.id('run'), projectId: found.run.projectId, createdAt: execution.now(), updatedAt: execution.now(), baseVersionId: found.run.baseVersionId };
      found.record.runs.push(run); found.record.prompts[run.id] = '[long-wait] synthetic continued saved source'; found.record.ticks[run.id] = 0; execution.state.reserved++;
      execution.append(found.record, run.id, { type: 'run.updated', payload: run }); settings.successorId = run.id; settings.acceptedKey = key; settings.acceptedBody = JSON.stringify(parsed.data); save(); execution.save();
      if (settings.scenario === 'response-lost') return HttpResponse.error();
      if (settings.scenario === 'gateway-408') return error(408, 'RUNTIME_UNAVAILABLE', '网关未确认接受结果。');
    }
    const successor = found.record.runs.find(value => value.id === settings.successorId)!;
    return HttpResponse.json(ContinueBudgetResponse.parse({ ...fixture.continueResponse, projectId: found.run.projectId, predecessorRunId: found.run.id, rootRunId: found.run.id, run: successor, disposition: settings.postCount > 1 ? 'already_created' : 'created', quota: execution.session().quota }), { headers });
  }),
];
