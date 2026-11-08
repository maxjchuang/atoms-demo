import { z } from 'zod';
import { DeliveryProtocolVersion, DeliveryApiError, DeliveryReadView, AttemptPage, EvidenceDescriptor, ExportReadView, VersionDiffPage, type DeliveryReadViewDto, type DeliveryReportDto, ReportBinding, sameReportBinding } from '@atoms/contracts/delivery';
import { HttpError } from './api';
type ReportBindingDto = z.infer<typeof ReportBinding>;
const root = '/api/delivery/v1';
const part = encodeURIComponent;
export async function deliveryRequest<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${root}${path}`, { credentials: 'same-origin', signal, headers: { 'X-Atoms-Delivery-Version': DeliveryProtocolVersion } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = DeliveryApiError.safeParse(body);
    throw new HttpError(response.status, parsed.success ? parsed.data.error.code : 'HTTP_ERROR', parsed.success ? parsed.data.error.message : `交付服务读取失败（${response.status}）`, parsed.success && parsed.data.error.retryable);
  }
  const value = schema.safeParse(body);
  if (!value.success) throw new HttpError(502, 'PROTOCOL_ERROR', '交付数据或来源绑定不符合协议，不能作为验收结果。');
  return value.data;
}
export type DeliverySubject = { kind: 'runs' | 'versions'; id: string; projectId: string };
export function validateSubject(view: DeliveryReadViewDto, subject: DeliverySubject) {
  if (view.projectId !== subject.projectId || (subject.kind === 'versions' ? view.subjectVersionId !== subject.id : view.runId !== subject.id)) throw new HttpError(502, 'SUBJECT_MISMATCH', '交付报告与当前任务或版本不一致。');
  return view;
}
export const deliveryApi = {
  async read(subject: DeliverySubject, signal?: AbortSignal) { return validateSubject(await deliveryRequest(`/${subject.kind}/${part(subject.id)}`, DeliveryReadView, signal), subject); },
  attempts: (id: string, cursor?: string) => deliveryRequest(`/deliveries/${part(id)}/attempts?limit=20${cursor ? `&cursor=${part(cursor)}` : ''}`, AttemptPage),
  evidence: (id: string, evidenceId: string) => deliveryRequest(`/deliveries/${part(id)}/evidence/${part(evidenceId)}`, EvidenceDescriptor),
  export: (id: string) => deliveryRequest(`/versions/${part(id)}/export`, ExportReadView),
  diff: (projectId: string, head: string, base?: string, cursor?: string) => deliveryRequest(`/projects/${part(projectId)}/version-diff?headVersionId=${part(head)}${base ? `&baseVersionId=${part(base)}` : ''}${cursor ? `&cursor=${part(cursor)}` : ''}`, VersionDiffPage),
};
export function assertReportBinding(expected: ReportBindingDto, actual: ReportBindingDto) {
  if (!sameReportBinding(expected, actual)) throw new HttpError(409, 'STALE_REVISION', '报告版本已变化，请重新读取，未合并旧证据。');
}
export function shouldPollDelivery(view: DeliveryReadViewDto) {
  return view.state === 'pending' || view.state === 'available' && (!view.reportFinal || view.apiVerification === 'pending' || ['not_published', 'publishing'].includes(view.publication.status) && ['complete', 'partial'].includes(view.quality));
}
export function criterionResult(report: DeliveryReportDto, criterionId: string) {
  const gap = report.gaps.find(item => item.criterionId === criterionId);
  if (gap) return gap.result;
  const coverage = report.bundle?.plan.coverage.find(item => item.criterionId === criterionId);
  if (!coverage || coverage.method !== 'automated') return 'not_run';
  const attempt = report.attempts.find(item => item.id === report.finalAttemptId);
  return coverage.caseIds.every(id => attempt?.caseResults.find(item => item.caseId === id)?.status === 'passed' && report.cleanBuild?.caseResults.find(item => item.caseId === id)?.status === 'passed') ? 'passed' : 'not_run';
}
export async function verifiedBytes(path: string, hash: string, expectedBytes?: number, mediaType?: string): Promise<Blob> {
  const response = await fetch(`${root}${path}`, { credentials: 'same-origin', headers: { 'X-Atoms-Delivery-Version': DeliveryProtocolVersion } });
  if (!response.ok) throw new HttpError(response.status, 'CONTENT_ERROR', `内容暂不可读或已过期（${response.status}），请重新读取描述。`);
  const type = response.headers.get('content-type')?.split(';')[0].trim();
  if (mediaType && type !== mediaType) throw new Error('内容类型与授权描述不一致，已拒绝显示。');
  const bytes = await response.arrayBuffer();
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) throw new Error('内容大小与报告不一致，已拒绝显示。');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== hash) throw new Error('内容指纹与报告不一致，已拒绝显示或下载。');
  return new Blob([bytes], { type: mediaType ?? type ?? 'application/octet-stream' });
}
export function saveBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
