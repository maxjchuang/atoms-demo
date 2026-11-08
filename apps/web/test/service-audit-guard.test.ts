import test from 'node:test';
import assert from 'node:assert/strict';
import { readAuditConfig, auditRequestAllowed, assertDshSource } from '../scripts/service-audit-guard';
import { complete, dshSourceReport, fakeSourceReport, controlledSourceReport } from '@atoms/contracts/delivery-fixtures';
const env = { ATOMS_WEB_URL: 'http://localhost:5185', ATOMS_DELIVERY_PROJECT: 'project_existing' };
for (const flag of ['ATOMS_FAKE_SERVICES', 'ATOMS_READONLY_REAL_SERVICES']) test(`${flag} rejects all business mutations and permits only exact login`, () => {
  readAuditConfig({ ...env, [flag]: '1' });
  for (const path of ['/api/v2/projects/project_existing/messages', '/api/v1/projects/project_existing/runs', '/api/v1/runs/run_existing/cancel', '/api/v1/projects/project_existing/restore', '/api/v2/proposals/proposal_existing/accept']) for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(auditRequestAllowed(method, env.ATOMS_WEB_URL + path, env.ATOMS_WEB_URL), false);
  assert.equal(auditRequestAllowed('POST', env.ATOMS_WEB_URL + '/api/v1/sessions', env.ATOMS_WEB_URL), true);
  for (const url of [env.ATOMS_WEB_URL + '/api/v1/sessions/', env.ATOMS_WEB_URL + '/api/v1/sessions?x=1', 'http://127.0.0.1:5301/api/v1/sessions']) assert.equal(auditRequestAllowed('POST', url, env.ATOMS_WEB_URL), false);
  assert.equal(auditRequestAllowed('GET', env.ATOMS_WEB_URL + '/api/v1/session', env.ATOMS_WEB_URL), true);
});
test('flags are mutually exclusive; explicit existing project and safe isolated URL required before browser starts', () => {
  assert.throws(() => readAuditConfig(env)); assert.throws(() => readAuditConfig({ ...env, ATOMS_FAKE_SERVICES: '1', ATOMS_READONLY_REAL_SERVICES: '1' }));
  for (const value of [{ ATOMS_WEB_URL: 'http://localhost:5173' }, { ATOMS_DELIVERY_PROJECT: '' }, { ATOMS_WEB_URL: 'https://remote.example' }, { ATOMS_WEB_URL: 'http://user:password@localhost:5185' }]) assert.throws(() => readAuditConfig({ ...env, ATOMS_READONLY_REAL_SERVICES: '1', ...value }));
});
test('real provenance cannot be inferred from success, omitted metadata, Fake or controlled-only final source', () => {
  assertDshSource(dshSourceReport);
  for (const report of [null, complete, fakeSourceReport, controlledSourceReport]) assert.throws(() => assertDshSource(report));
});
