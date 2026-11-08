import { z } from 'zod';
import {
  ApiError, Session, Project, ProjectList, WorkspaceSnapshot, RunMutationResponse,
  ProjectEventPage, VersionList, FileList, RestoreVersionResponse,
  type AnswerRequestDto,
} from '@atoms/contracts';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable = false) { super(message); }
}
export const requestKey = () => `web_${crypto.randomUUID()}`;
async function request<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}, key?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options, credentials: 'same-origin',
      headers: { ...((options.body || options.method === 'POST') ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}), ...options.headers },
    });
  } catch { throw new HttpError(0, 'NETWORK_ERROR', '网络连接暂时中断，正在等待重连。', true); }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = ApiError.safeParse(data);
    throw new HttpError(response.status, error.success ? error.data.error.code : 'HTTP_ERROR',
      error.success ? error.data.error.message : `服务返回错误（${response.status}）`, error.success && error.data.error.retryable);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new HttpError(502, 'PROTOCOL_ERROR', '服务返回的数据与协议不一致，请刷新后重试。');
  return parsed.data;
}
const pendingKeys = new Map<string, string>();
async function post<T>(path: string, body: unknown, schema: z.ZodType<T>, key?: string): Promise<T> {
  const serialized = JSON.stringify(body);
  const fingerprint = `${path}:${serialized}`;
  const selectedKey = key ?? pendingKeys.get(fingerprint) ?? requestKey();
  pendingKeys.set(fingerprint, selectedKey);
  try {
    const result = await request(path, schema, { method: 'POST', body: serialized }, selectedKey);
    pendingKeys.delete(fingerprint); return result;
  } catch (error) {
    // A lost response may already have committed. An explicit retry of the same
    // operation keeps its key until success or a definitive rejection.
    if (error instanceof HttpError && error.status > 0 && error.status < 500) pendingKeys.delete(fingerprint);
    throw error;
  }
}
export const api = {
  session: () => request('/session', Session),
  redeem: (code: string, key?: string) => post('/sessions', { code }, Session, key),
  logout: () => request('/session', z.null(), { method: 'DELETE' }, requestKey()),
  projects: () => request('/projects?limit=100', ProjectList),
  createProject: (title: string, key?: string) => post('/projects', { title }, Project, key),
  workspace: (id: string) => request(`/projects/${id}/workspace`, WorkspaceSnapshot),
  events: (id: string, after: number) => request(`/projects/${id}/events?after=${after}&limit=100`, ProjectEventPage),
  createRun: (id: string, prompt: string, mode: 'build' | 'plan', key?: string) => post(`/projects/${id}/runs`, { prompt, mode }, RunMutationResponse, key),
  answer: (id: string, answer: AnswerRequestDto, key?: string) => post(`/runs/${id}/answers`, answer, RunMutationResponse, key),
  cancel: (id: string, key?: string) => post(`/runs/${id}/cancel`, {}, RunMutationResponse, key),
  versions: (id: string) => request(`/projects/${id}/versions?limit=100`, VersionList),
  restore: (id: string, versionId: string, expectedProjectRevision: number, key?: string) => post(`/projects/${id}/restore`, { versionId, expectedProjectRevision }, RestoreVersionResponse, key),
  files: (id: string) => request(`/versions/${id}/files`, FileList),
  async file(id: string, path: string): Promise<string> {
    const res = await fetch(`/api/v1/versions/${id}/file?path=${encodeURIComponent(path)}`, { credentials: 'same-origin' });
    if (!res.ok) throw new HttpError(res.status, 'FILE_ERROR', '源码暂时无法读取。');
    return res.text();
  },
};
