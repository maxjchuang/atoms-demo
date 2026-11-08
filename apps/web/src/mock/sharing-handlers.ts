import { delay, http, HttpResponse } from 'msw';
import { SharingDescriptor, SharingProtocolVersion, ResolveSharingRequest, ResolvedSharing } from '@atoms/contracts/sharing';
import * as fixture from '@atoms/contracts/sharing-fixtures';
import { mockExecutionStore as execution } from './handlers';

// Synthetic HTTPS origins are injected only by the explicitly selected Mock app.
// They are never contacted and do not claim external deployment or real signatures.
const key = 'atoms_web_mock_sharing';
type Config = { scenario?: string; delayMs?: number; resolveDelayMs?: number };
const headers = { 'X-Atoms-Sharing-Version': SharingProtocolVersion, 'Cache-Control': 'private, no-store' };
function config(): Config { try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; } }
function error(status: number) { return HttpResponse.json({ error: { code: ({ 401: 'UNAUTHENTICATED', 403: 'QUOTA_EXCEEDED', 404: 'NOT_FOUND', 409: 'CONFLICT', 429: 'RATE_LIMITED', 503: 'RUNTIME_UNAVAILABLE' } as Record<number, string>)[status], message: 'Synthetic sharing response only.', retryable: status >= 500 || status === 429, requestId: 'request_sharing_mock' } }, { status, headers: { ...headers, ...(status === 429 ? { 'Retry-After': '2' } : {}) } }); }
function descriptor(projectId: string, versionId: string | null, scenario?: string) {
  const base = scenario === 'local' ? fixture.localOnly : scenario === 'unavailable' ? fixture.unavailable : !versionId ? fixture.noPublishedVersion : scenario === 'verified' ? fixture.externallyVerified : fixture.configured;
  return SharingDescriptor.parse({ ...base, projectId, subjectVersionId: versionId, asOf: execution.now(), deploymentInstanceId: scenario === 'rotated' ? 'deployment_mock_rotated' : base.deploymentInstanceId,
    externalVerification: scenario === 'verified' && versionId ? { status: 'verified', verifiedAt: execution.now(), subjectVersionId: versionId } : { status: 'unverified', verifiedAt: null, subjectVersionId: null } });
}
export const sharingHandlers = [
  http.post('/__mock/sharing/seed', async ({ request }) => { localStorage.setItem(key, JSON.stringify(await request.json())); return HttpResponse.json({ ok: true }); }),
  http.get('/api/sharing/v1/projects/:id', async ({ params, request }) => {
    const settings = config(); if (settings.delayMs) await delay(settings.delayMs);
    if (settings.scenario === 'descriptor-network') return HttpResponse.error();
    if (request.headers.get('X-Atoms-Sharing-Version') !== SharingProtocolVersion) return new HttpResponse(null, { status: 400 });
    if (!execution.state.authenticated || settings.scenario === 'descriptor-401') return error(401);
    const status = /^descriptor-(403|404|429|503)$/.exec(settings.scenario ?? ''); if (status) return error(Number(status[1]));
    const record = execution.find(params.id); if (!record) return error(404);
    const versionId = new URL(request.url).searchParams.get('versionId') ?? record.project.currentVersionId;
    if (versionId && !record.versions.some(value => value.id === versionId)) return error(404);
    return HttpResponse.json(descriptor(record.project.id, versionId, settings.scenario), { headers });
  }),
  http.post('/api/sharing/v1/projects/:id/resolve', async ({ params, request }) => {
    const settings = config(); if (settings.resolveDelayMs) await delay(settings.resolveDelayMs);
    if (settings.scenario === 'resolve-network') return HttpResponse.error();
    if (!execution.state.authenticated) return error(401);
    const status = /^resolve-(401|403|404|409|429|503)$/.exec(settings.scenario ?? ''); if (status) return error(Number(status[1]));
    const parsed = ResolveSharingRequest.safeParse(await request.json()); if (!parsed.success) return new HttpResponse(null, { status: 400 });
    const record = execution.find(params.id); if (!record) return error(404);
    const body = parsed.data, versionId = body.kind === 'app_preview' ? body.versionId : record.project.currentVersionId;
    if (body.kind === 'app_preview' && !record.versions.some(value => value.id === body.versionId)) return error(404);
    const state = descriptor(record.project.id, versionId, settings.scenario);
    if (body.expectedDeploymentInstanceId !== state.deploymentInstanceId || state.scope !== 'public_temporary') return error(409);
    const old = settings.scenario === 'expired', issuedAt = new Date(Date.now() - (old ? 120_000 : 0)).toISOString();
    let value = body.kind === 'app_preview' ? { ...fixture.preview, projectId: record.project.id, subjectVersionId: body.versionId,
      deploymentInstanceId: state.deploymentInstanceId, issuedAt, expiresAt: new Date(Date.now() + (old ? -60_000 : settings.scenario === 'short-expiry' ? 2000 : 900_000)).toISOString() }
      : { ...fixture.buildEntry, projectId: record.project.id, deploymentInstanceId: state.deploymentInstanceId, issuedAt };
    if (settings.scenario === 'foreign-subject' && value.kind === 'app_preview') value = { ...value, subjectVersionId: 'version_foreign' };
    if (settings.scenario === 'unsafe-origin' && value.kind === 'app_preview') value = { ...value, url: value.url.replace('preview-demo', 'workbench-demo') };
    return HttpResponse.json(ResolvedSharing.parse(value), { headers });
  }),
];
