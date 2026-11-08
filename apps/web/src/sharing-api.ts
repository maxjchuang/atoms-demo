import { z } from 'zod';
import { SharingProtocolVersion, SharingDescriptor, SharingDescriptorQuery, ResolveSharingRequest, ResolvedSharing, SharingApiError, type SharingDescriptorDto, type ResolveSharingRequestDto, type ResolvedSharingDto } from '@atoms/contracts/sharing';
import { HttpError } from './api';

const root = '/api/sharing/v1';
export class SharingError extends HttpError {
  constructor(status: number, code: string, message: string, retryable = false, public retryAfterSeconds = 0) { super(status, code, message, retryable); }
}
export function retryDelay(value: string | null, now = Date.now()) {
  if (!value) return 0;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.min(60, Math.ceil(seconds))) : 0;
}
async function request<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, body?: ResolveSharingRequestDto, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${root}${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { 'X-Atoms-Sharing-Version': SharingProtocolVersion, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(ResolveSharingRequest.parse(body)) } : {}) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new SharingError(0, 'NETWORK_ERROR', '连接中断，尚未确认链接状态。重试不会创建构建任务。', true);
  }
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const error = SharingApiError.safeParse(value);
    // Never reflect arbitrary server text, potentially containing a capability, into logs/UI.
    const messages: Record<number, string> = { 400: '分享请求未通过校验，请重新读取。', 401: '体验会话已失效，请重新输入体验码。', 403: '当前操作不可用，请检查体验权限与额度；已有版本不会因此变成失败。', 404: '项目或已发布版本不存在，或当前无权访问。', 409: '部署入口已变化或尚不支持公网分享，请重新读取并核对。', 429: '请求过于频繁，请稍后重试。', 503: '公网入口暂不可用；不代表应用版本已被删除。' };
    throw new SharingError(response.status, error.success ? error.data.error.code : 'HTTP_ERROR', messages[response.status] ?? `分享服务暂不可读（${response.status}）。`, error.success && error.data.error.retryable, retryDelay(response.headers.get('Retry-After')));
  }
  if (response.headers.get('X-Atoms-Sharing-Version') !== SharingProtocolVersion) throw new SharingError(502, 'PROTOCOL_ERROR', '分享响应版本不一致，未使用返回链接。');
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SharingError(502, 'PROTOCOL_ERROR', '分享响应不符合协议，未使用返回链接。');
  return parsed.data;
}
export function assertDescriptor(value: SharingDescriptorDto, projectId: string, versionId: string | null) {
  if (value.projectId !== projectId || versionId !== null && value.subjectVersionId !== versionId) throw new SharingError(502, 'SUBJECT_MISMATCH', '分享描述与选定项目或版本不一致。');
  return value;
}
export function assertResolution(value: ResolvedSharingDto, descriptor: SharingDescriptorDto, kind: ResolveSharingRequestDto['kind'], workbenchOrigin: string, now = Date.now()) {
  if (value.kind !== kind || value.projectId !== descriptor.projectId || value.deploymentInstanceId !== descriptor.deploymentInstanceId || value.kind === 'app_preview' && value.subjectVersionId !== descriptor.subjectVersionId) throw new SharingError(502, 'SUBJECT_MISMATCH', '链接与选定项目、版本或部署代际不一致，已拒绝使用。');
  const url = new URL(value.url), workbench = new URL(workbenchOrigin);
  if (value.kind === 'build_entry' ? url.origin !== workbench.origin : url.hostname === workbench.hostname) throw new SharingError(502, 'ORIGIN_MISMATCH', '分享地址不符合工作台与预览主机边界，已拒绝使用。');
  // The authenticated exact API endpoint is the canonical authority. An older
  // Version.previewUrl cannot veto legitimate host rotation; models supply no URL.
  if (value.kind === 'app_preview' && Date.parse(value.expiresAt) <= now) throw new SharingError(409, 'CAPABILITY_EXPIRED', '返回链接已到期，请更新链接；旧链接不会因此延长。');
  if (Date.parse(value.issuedAt) > now + 60_000) throw new SharingError(502, 'CLOCK_MISMATCH', '服务时间与浏览器偏差过大，暂未使用链接。');
  return value;
}
export const sharingApi = {
  async descriptor(projectId: string, versionId: string | null, signal?: AbortSignal) {
    SharingDescriptorQuery.parse(versionId === null ? {} : { versionId });
    return assertDescriptor(await request(`/projects/${encodeURIComponent(projectId)}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''}`, SharingDescriptor, undefined, signal), projectId, versionId);
  },
  resolve: (projectId: string, body: ResolveSharingRequestDto, signal?: AbortSignal) => request(`/projects/${encodeURIComponent(projectId)}/resolve`, ResolvedSharing, body, signal),
};

export async function copyLink(url: string, clipboard: Pick<Clipboard, 'writeText'> | undefined): Promise<'copied' | 'manual'> {
  if (!clipboard) return 'manual';
  try { await clipboard.writeText(url); return 'copied'; } catch { return 'manual'; }
}
