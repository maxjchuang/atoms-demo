import { z } from 'zod';
import { RequirementsProtocolVersion, RequirementsVersionHeader, RequirementsPublicPrefix, RequirementsReadView, RequirementSummary, AcceptRequirementSummaryRequest, AcceptRequirementSummaryResponse, ReviewRequirementsRequest, ReviewRequirementsResponse, RequirementsError, type ProjectRequirementSnapshotDto } from '@atoms/contracts/requirements';
import { canonicalDeliveryJson, deliveryHashBody } from '@atoms/contracts/delivery';
import { HttpError, requestKey } from './api';
export type RequirementsView = z.infer<typeof RequirementsReadView>;
export type Summary = z.infer<typeof RequirementSummary>;
export type ReviewBody = z.infer<typeof ReviewRequirementsRequest>;
export const snapshotRef = (snapshot: ProjectRequirementSnapshotDto) => ({ id: snapshot.id, hash: snapshot.hash, revision: snapshot.revision });
export function reviewSubjectMatches(snapshotProjectId: string, stateProjectId: string | null, routeProjectId: string | null) { return snapshotProjectId === stateProjectId && stateProjectId === routeProjectId; }
export async function requirementHash(value: Record<string, unknown>) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(deliveryHashBody(value))))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function verifyRequirementHash(value: Record<string, unknown>) { if (await requirementHash(value) !== value.hash) throw new HttpError(502, 'HASH_MISMATCH', '需求快照或完整方案指纹不一致，不能用于授权。'); }
export function isCurrentSummary(summary: Summary, snapshot: ProjectRequirementSnapshotDto) {
  return summary.projectId === snapshot.projectId && canonicalDeliveryJson(summary.draft.snapshot) === canonicalDeliveryJson(snapshotRef(snapshot)) && canonicalDeliveryJson(summary.snapshot.base) === canonicalDeliveryJson(snapshot.base);
}
export function acceptanceFor(summary: Summary) { return AcceptRequirementSummaryRequest.parse({ expectedSummaryRevision: summary.revision, expectedProposalRevision: summary.proposal.revision, expectedSnapshot: snapshotRef(summary.snapshot), expectedBase: summary.snapshot.base }); }
export function reviewFor(snapshot: ProjectRequirementSnapshotDto, content: string): ReviewBody { return ReviewRequirementsRequest.parse({ input: { kind: 'text', content }, expectedSnapshot: snapshotRef(snapshot) }); }
async function verifiedSummary(summary: Summary) { await verifyRequirementHash(summary.snapshot); await verifyRequirementHash(summary); return summary; }
async function request<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, body?: unknown, signal?: AbortSignal, key?: string): Promise<T> {
  let response: Response;
  try { response = await fetch(`${RequirementsPublicPrefix}${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { [RequirementsVersionHeader]: RequirementsProtocolVersion, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key! }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch (error) { if (signal?.aborted) throw error; throw new HttpError(0, 'NETWORK_ERROR', '完整需求请求结果尚未确认，请核对后重试原请求。', true); }
  const value = await response.json().catch(() => null);
  if (!response.ok) { const parsed = RequirementsError.safeParse(value); throw new HttpError(response.status, parsed.success ? parsed.data.error.code : 'HTTP_ERROR', parsed.success ? parsed.data.error.message : `完整需求服务暂不可读（${response.status}）。`, parsed.success && parsed.data.error.retryable); }
  if (response.headers.get(RequirementsVersionHeader) !== RequirementsProtocolVersion) throw new HttpError(502, 'PROTOCOL_ERROR', '完整需求服务版本不一致。');
  const parsed = schema.safeParse(value); if (!parsed.success) throw new HttpError(502, 'PROTOCOL_ERROR', '完整目标、来源或验收映射不符合协议，不能授权。'); return parsed.data;
}
const mutations = new Map<string, string>();
async function mutate<T>(path: string, body: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>, signal?: AbortSignal, verify?: (value: T) => Promise<void>) {
  const bodyHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalDeliveryJson(body))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const fingerprint = `atoms_requirements_pending_v1:${path}:${bodyHash}`;
  let storage: Storage | null = null; try { if (typeof sessionStorage !== 'undefined') storage = sessionStorage; } catch { /* Memory fallback retains key while this page is open. */ }
  let key = mutations.get(fingerprint); if (!key) { key = storage?.getItem(fingerprint) ?? requestKey(); mutations.set(fingerprint, key); storage?.setItem(fingerprint, key); }
  try { const value = await request(path, schema, body, signal, key); await verify?.(value); mutations.delete(fingerprint); storage?.removeItem(fingerprint); return value; }
  catch (error) { if (error instanceof HttpError && [400, 401, 403, 404, 409].includes(error.status) && error.code !== 'HTTP_ERROR') { mutations.delete(fingerprint); storage?.removeItem(fingerprint); } throw error; }
}
export const requirementsApi = {
  async read(projectId: string, signal?: AbortSignal) {
    const view = await request(`/projects/${encodeURIComponent(projectId)}`, RequirementsReadView, undefined, signal);
    if (view.snapshot.projectId !== projectId) throw new HttpError(502, 'SUBJECT_MISMATCH', '需求快照属于其他项目。');
    await verifyRequirementHash(view.snapshot); await Promise.all(view.pendingSummaries.map(verifiedSummary)); return view;
  },
  async summary(projectId: string, proposalId: string, signal?: AbortSignal) {
    const value = await request(`/proposals/${encodeURIComponent(proposalId)}`, RequirementSummary, undefined, signal);
    if (value.projectId !== projectId || value.proposal.id !== proposalId) throw new HttpError(502, 'SUBJECT_MISMATCH', '完整方案与当前提案不一致。'); return verifiedSummary(value);
  },
  async accept(summary: Summary, snapshot: ProjectRequirementSnapshotDto, signal?: AbortSignal) {
    if (!isCurrentSummary(summary, snapshot)) throw new HttpError(409, 'STALE_REQUIREMENTS', '此方案引用旧需求或基线，请重新整理后明确接受。');
    return mutate(`/proposals/${encodeURIComponent(summary.proposal.id)}/accept`, acceptanceFor(summary), AcceptRequirementSummaryResponse, signal, async value => {
      if (value.summary.id !== summary.id || value.summary.proposal.id !== summary.proposal.id || value.run.projectId !== summary.projectId || canonicalDeliveryJson(value.summary.draft) !== canonicalDeliveryJson(summary.draft)) throw new HttpError(502, 'SUBJECT_MISMATCH', '接受回执没有绑定刚才审阅的完整范围。');
      await verifiedSummary(value.summary);
    });
  },
  async review(projectId: string, body: ReviewBody, signal?: AbortSignal) {
    return mutate(`/projects/${encodeURIComponent(projectId)}/review`, ReviewRequirementsRequest.parse(body), ReviewRequirementsResponse, signal, async value => {
      if (value.userMessage.projectId !== projectId || value.userMessage.content !== body.input.content || value.turn.projectId !== projectId || value.turn.mode !== 'ask' || value.turn.runMode !== 'plan') throw new HttpError(502, 'SUBJECT_MISMATCH', '整理回执必须保留实际草稿及只读 ask/plan 意图。');
    });
  },
};
