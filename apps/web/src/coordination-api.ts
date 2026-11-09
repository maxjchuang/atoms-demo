import { z } from 'zod';
import {
  CoordinationProtocolVersion, CoordinationApiError, CoordinationSession, CoordinationWorkspace,
  CoordinationTurn, SubmitMessageResponse, ConversationMessagePage, ConversationEventPage,
  CancelCoordinationResponse, AcceptProposalResponse, ChangeProposal, Clarification, ProjectMemoryView,
  TurnActionDescriptor, ResolveActionResponse, type SubmitMessageRequestDto,
} from '@atoms/contracts/conversation';
import { HttpError, requestKey } from './api';

const retainedKeys = new Map<string, string>();
async function request<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}, key?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v2${path}`, { ...options, credentials: 'same-origin',
      headers: { 'X-Atoms-Coordination-Version': CoordinationProtocolVersion,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}), ...options.headers } });
  } catch { throw new HttpError(0, 'NETWORK_ERROR', '项目对话连接暂时中断，请稍后重试。', true); }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = CoordinationApiError.safeParse(body);
    throw new HttpError(response.status, error.success ? error.data.error.code : 'HTTP_ERROR',
      error.success ? error.data.error.message : `项目协调服务返回错误（${response.status}）`, error.success && error.data.error.retryable);
  }
  const value = schema.safeParse(body);
  if (!value.success) throw new HttpError(502, 'PROTOCOL_ERROR', '项目协调数据不符合 v0.2 协议，请刷新重试。');
  return value.data;
}
async function post<T>(path: string, body: unknown, schema: z.ZodType<T>, key?: string): Promise<T> {
  const serialized = JSON.stringify(body), fingerprint = `${path}:${serialized}`;
  const mutationKey = key ?? retainedKeys.get(fingerprint) ?? requestKey();
  retainedKeys.set(fingerprint, mutationKey);
  try {
    const result = await request(path, schema, { method: 'POST', body: serialized }, mutationKey);
    retainedKeys.delete(fingerprint); return result;
  } catch (error) {
    if (error instanceof HttpError && error.status > 0 && error.status < 500) retainedKeys.delete(fingerprint);
    throw error;
  }
}
export const coordinationApi = {
  session: () => request('/session', CoordinationSession),
  workspace: (id: string) => request(`/projects/${id}/workspace`, CoordinationWorkspace),
  submit: (id: string, body: SubmitMessageRequestDto, key?: string) => post(`/projects/${id}/messages`, body, SubmitMessageResponse, key),
  messages: (id: string, before?: string) => request(`/projects/${id}/messages?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`, ConversationMessagePage),
  events: (id: string, after: number) => request(`/projects/${id}/conversation-events?after=${after}&limit=100`, ConversationEventPage),
  turn: (id: string) => request(`/coordination-turns/${id}`, CoordinationTurn),
  cancel: (id: string, expectedRevision: number, key?: string) => post(`/coordination-turns/${id}/cancel`, { expectedRevision }, CancelCoordinationResponse, key),
  retry: (id: string, expectedRevision: number, key?: string) => post(`/coordination-turns/${id}/retry`, { expectedRevision }, SubmitMessageResponse, key),
  proposal: (id: string) => request(`/proposals/${id}`, ChangeProposal),
  accept: (id: string, expectedRevision: number, runMode: 'build' | 'plan', key?: string) => post(`/proposals/${id}/accept`, { expectedRevision, runMode }, AcceptProposalResponse, key),
  refreshProposal: (id: string, expectedRevision: number, key?: string) => post(`/proposals/${id}/refresh`, { expectedRevision }, SubmitMessageResponse, key),
  dismissProposal: (id: string, expectedRevision: number, key?: string) => post(`/proposals/${id}/dismiss`, { expectedRevision }, z.object({ proposal: ChangeProposal }).strict(), key),
  clarification: (id: string) => request(`/clarifications/${id}`, Clarification),
  dismissClarification: (id: string, expectedRevision: number, key?: string) => post(`/clarifications/${id}/dismiss`, { expectedRevision }, z.object({ clarification: Clarification }).strict(), key),
  memory: (id: string) => request(`/projects/${id}/memory`, ProjectMemoryView),
  action: (turnId: string, actionId: string) => request(`/coordination-turns/${turnId}/actions/${actionId}`, TurnActionDescriptor),
  resolveAction: (turnId: string, actionId: string, key?: string) => post(`/coordination-turns/${turnId}/actions/${actionId}/resolve`, {}, ResolveActionResponse, key),
};
