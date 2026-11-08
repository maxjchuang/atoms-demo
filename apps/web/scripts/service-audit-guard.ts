import type { DeliveryReportDto } from '@atoms/contracts/delivery';
export function readAuditConfig(env: Readonly<Record<string, string | undefined>>) {
  const fake = env.ATOMS_FAKE_SERVICES === '1', real = env.ATOMS_READONLY_REAL_SERVICES === '1';
  if (fake === real) throw new Error('Set exactly one of ATOMS_FAKE_SERVICES=1 or ATOMS_READONLY_REAL_SERVICES=1.');
  if (!env.ATOMS_WEB_URL || !env.ATOMS_DELIVERY_PROJECT) throw new Error('Explicit isolated URL and existing project ID required; this tool never creates projects or Runs.');
  const target = new URL(env.ATOMS_WEB_URL);
  if (!['http:', 'https:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.port === '5173' || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('Only isolated local workbench origins are allowed; live 5173 is forbidden.');
  if (!/^project_[a-z0-9_-]+$/.test(env.ATOMS_DELIVERY_PROJECT)) throw new Error('An explicit valid existing project ID is required.');
  return { mode: real ? 'readonly_real' as const : 'fake' as const, target, projectId: env.ATOMS_DELIVERY_PROJECT };
}
export function auditRequestAllowed(method: string, url: string, workbenchOrigin: string) {
  const target = new URL(url);
  if (method === 'GET' || method === 'HEAD') return true;
  return method === 'POST' && target.origin === workbenchOrigin && target.pathname === '/api/v1/sessions' && target.search === '';
}
export function assertDshSource(report: DeliveryReportDto | null) {
  const final = report?.attempts.find(attempt => attempt.id === report.finalAttemptId);
  if (!final || final.sourceProvenance?.kind !== 'model_output' || final.sourceProvenance.adapterMode !== 'dsh') throw new Error('Readonly real mode requires explicit final model_output/dsh provenance; omitted metadata is not real-model evidence.');
  if (report!.attempts.some(attempt => !attempt.sourceProvenance || attempt.sourceProvenance.kind === 'synthetic_fixture' || attempt.sourceProvenance.kind === 'model_output' && attempt.sourceProvenance.adapterMode !== 'dsh')) throw new Error('Readonly real mode rejects fake, synthetic or unrecorded attempts.');
}
