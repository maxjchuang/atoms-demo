import { z } from 'zod';
import { BudgetRecoveryProtocolVersion, BudgetRecoveryVersionHeader, BudgetRecoveryPublicPrefix, BudgetRecoveryReadView, BudgetRecoveryError, ContinueBudgetRequest, ContinueBudgetResponse, type BudgetRecoveryReadViewDto } from '@atoms/contracts/budget-recovery';
import { HttpError, requestKey } from './api';

export type ContinuationRequest = z.infer<typeof ContinueBudgetRequest>;
export type ContinuationResponse = z.infer<typeof ContinueBudgetResponse>;
const Pending = z.object({ projectId: z.string(), runId: z.string(), key: z.string().min(8), request: ContinueBudgetRequest }).strict();
export type PendingContinuation = z.infer<typeof Pending>;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storageKey = (projectId: string, runId: string) => `atoms_budget_recovery_pending_v1:${projectId}:${runId}`;
export const recoverySelectionKey = (projectId: string) => `atoms_budget_recovery_selected_v1:${projectId}`;
export function readPending(store: Store, projectId: string, runId: string): PendingContinuation | null {
  try { const value = Pending.parse(JSON.parse(store.getItem(storageKey(projectId, runId)) ?? 'null')); return value.projectId === projectId && value.runId === runId ? value : null; } catch { return null; }
}
export function clearPending(store: Store, projectId: string, runId: string) { store.removeItem(storageKey(projectId, runId)); }
export function requestForOffer(view: BudgetRecoveryReadViewDto): ContinuationRequest {
  const offer = view.offer;
  if (!view.eligible || !offer) throw new HttpError(409, 'NOT_ELIGIBLE', '当前任务没有可用的续作授权。');
  return ContinueBudgetRequest.parse({ offerId: offer.id, expectedOfferRevision: offer.revision, checkpoint: offer.checkpoint, expectedSourceHash: offer.sourceSnapshotHash, expectedSemanticHash: offer.semanticHash, expectedProjectRevision: offer.expectedProjectRevision, expectedHeadVersionId: offer.expectedHeadVersionId });
}
export function retainPending(store: Store, view: BudgetRecoveryReadViewDto): PendingContinuation {
  const existing = readPending(store, view.projectId, view.runId); if (existing) return existing;
  const value = Pending.parse({ projectId: view.projectId, runId: view.runId, key: requestKey(), request: requestForOffer(view) });
  store.setItem(storageKey(view.projectId, view.runId), JSON.stringify(value)); store.setItem(recoverySelectionKey(view.projectId), view.runId); return value;
}
export function validateRecoveryView(value: BudgetRecoveryReadViewDto, projectId: string, runId: string) {
  if (value.projectId !== projectId || value.runId !== runId) throw new HttpError(502, 'SUBJECT_MISMATCH', '预算诊断与当前项目或任务不一致。');
  return value;
}
export function validateContinuation(value: ContinuationResponse, view: BudgetRecoveryReadViewDto) {
  if (value.projectId !== view.projectId || value.predecessorRunId !== view.runId || value.rootRunId !== view.lineage.rootRunId || value.segment !== view.lineage.segment + 1) throw new HttpError(502, 'SUBJECT_MISMATCH', '续作回执与原任务链不一致，尚未确认提交结果。');
  return value;
}
export function continuationRejectionIsDefinitive(error: unknown) {
  return error instanceof HttpError && [400, 401, 403, 404, 409].includes(error.status)
    && ['INVALID_REQUEST', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'STALE_OFFER', 'QUOTA_EXHAUSTED', 'NOT_ELIGIBLE', 'PLAN_REVIEW_REQUIRED'].includes(error.code);
}
async function request<T>(runId: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, pending?: PendingContinuation, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BudgetRecoveryPublicPrefix}/runs/${encodeURIComponent(runId)}${pending ? '/continue' : ''}`, { method: pending ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { [BudgetRecoveryVersionHeader]: BudgetRecoveryProtocolVersion, ...(pending ? { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key } : {}) },
      ...(pending ? { body: JSON.stringify(ContinueBudgetRequest.parse(pending.request)) } : {}) });
  } catch (error) { if (signal?.aborted) throw error; throw new HttpError(0, 'NETWORK_ERROR', pending ? '续作提交结果尚未确认，请先核对；不要再次创建任务。' : '预算诊断连接中断，请重试读取。', true); }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = BudgetRecoveryError.safeParse(body);
    const fallback: Record<number, string> = { 401: '会话已失效，请重新登录后核对原提交。', 403: '构建额度或当前权限不足，请重新读取权威余量。', 409: '续作报价或目标已变化，请重读并重新确认。', 429: '请求过于频繁，请稍后核对。', 503: '续作服务暂不可用；提交结果仍需核对。' };
    throw new HttpError(response.status, parsed.success ? parsed.data.error.code : 'HTTP_ERROR', parsed.success ? parsed.data.error.message : fallback[response.status] ?? `预算服务读取失败（${response.status}）。`, parsed.success && parsed.data.error.retryable);
  }
  if (response.headers.get(BudgetRecoveryVersionHeader) !== BudgetRecoveryProtocolVersion) throw new HttpError(502, 'PROTOCOL_ERROR', '预算服务版本不一致，不能确认续作。');
  const value = schema.safeParse(body); if (!value.success) throw new HttpError(502, 'PROTOCOL_ERROR', '预算服务响应不符合协议，不能确认续作。');
  return value.data;
}
export const recoveryApi = {
  async read(projectId: string, runId: string, signal?: AbortSignal) { return validateRecoveryView(await request(runId, BudgetRecoveryReadView, undefined, signal), projectId, runId); },
  async continue(view: BudgetRecoveryReadViewDto, pending: PendingContinuation, signal?: AbortSignal) {
    if (pending.projectId !== view.projectId || pending.runId !== view.runId) throw new HttpError(409, 'SUBJECT_MISMATCH', '本地待核对请求属于其他任务。');
    return validateContinuation(await request(view.runId, ContinueBudgetResponse, pending, signal), view);
  },
};
export function diagnosticSummary(diagnosis: BudgetRecoveryReadViewDto['diagnosis']) {
  if (!diagnosis || diagnosis.classification === 'unknown') return null;
  const names = { input_tokens: '输入 Token', output_tokens: '输出 Token', model_steps: '模型步骤', active_ms: '执行时长', repair_rounds: '修复轮数', tool_time_ms: '工具时限', unknown: '未知预算' };
  const cause = diagnosis.trigger === 'request_reservation_rejected' ? `后续请求预留超过剩余${names[diagnosis.dimension]}预算，任务已中止` : `${names[diagnosis.dimension]}达到本段上限，任务已中止`;
  return `${cause}；本段上限 ${diagnosis.limit === null ? '未知' : diagnosis.limit.toLocaleString('zh-CN')}`;
}
