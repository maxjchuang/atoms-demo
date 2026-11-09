import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RequirementSummary, RequirementsReadView, ProjectRequirementSnapshot, RequirementsVersionHeader, RequirementsProtocolVersion } from '@atoms/contracts/requirements';
import { canonicalDeliveryJson, deliveryHashBody } from '@atoms/contracts/delivery';
import * as fixture from '@atoms/contracts/requirements-fixtures';
import { consultUser, consultTurn } from '@atoms/contracts/conversation-fixtures';
import { requirementHash, verifyRequirementHash, snapshotRef, isCurrentSummary, acceptanceFor, reviewFor, requirementsApi, reviewSubjectMatches } from '../src/requirements-api';

async function sealed() { const snapshot = { ...fixture.snapshot, hash: await requirementHash(fixture.snapshot) }; const summary = { ...fixture.summary, snapshot, draft: { ...fixture.summary.draft, snapshot: snapshotRef(snapshot) } }; return { snapshot, summary: { ...summary, hash: await requirementHash(summary) } }; }
test('typed review requires exact snapshot/state/route project, never silently downgrades its purpose', () => {
  assert.equal(reviewSubjectMatches('project_a', 'project_a', 'project_a'), true);
  for (const [state, route] of [[null, null], ['project_b', 'project_b'], ['project_a', 'project_b'], ['project_b', 'project_a']] as const) assert.equal(reviewSubjectMatches('project_a', state, route), false);
});
test('browser canonical SHA256 matches independent Node computation; raw authority mutations are rejected', async () => {
  const { snapshot, summary } = await sealed(); await verifyRequirementHash(snapshot); await verifyRequirementHash(summary);
  assert.equal(snapshot.hash, createHash('sha256').update(deliveryHashBody(snapshot)).digest('hex'));
  await assert.rejects(verifyRequirementHash({ ...snapshot, entries: snapshot.entries.slice(1) }), /指纹不一致/);
  assert.equal(RequirementSummary.safeParse({ ...summary, draft: { ...summary.draft, includedEntryIds: [snapshot.entries.at(-1)!.id] } }).success, false);
});
test('complete review includes original goal plus all requested increments, not merely latest text or automatic confirmation', async () => {
  const { snapshot, summary } = await sealed(); assert.equal(snapshot.base.kind, 'empty_project'); assert.equal(snapshot.entries.length, 3);
  assert.ok(snapshot.entries.every(entry => entry.authorization === 'requested')); assert.ok(summary.draft.goal.includes('3D')); assert.equal(summary.draft.includedEntryIds.length, 3);
  assert.deepEqual(acceptanceFor(summary).expectedBase, { kind: 'empty_project' }); assert.deepEqual(acceptanceFor(summary).expectedSnapshot, snapshotRef(snapshot));
  assert.equal(isCurrentSummary(summary, snapshot), true); assert.equal(isCurrentSummary(summary, { ...snapshot, revision: snapshot.revision + 1 }), false);
});
test('published-source basis and stale scope cannot silently substitute current/source authority', async () => {
  const { snapshot, summary } = await sealed();
  assert.equal(isCurrentSummary(summary, ProjectRequirementSnapshot.parse({ ...snapshot, base: { kind: 'published_version', versionId: 'version_other', sourceAvailable: true, sourceSnapshotHash: 'a'.repeat(64) } })), false);
  await assert.rejects(requirementsApi.accept(summary, { ...snapshot, hash: 'f'.repeat(64) }), /旧需求或基线/);
});
test('typed review preserves actual editable user text and exact snapshot; no request has build/control flags', async () => {
  const { snapshot } = await sealed(), text = '我修改过的整理草稿：只整理现有要求，保留原始目标。', body = reviewFor(snapshot, text);
  assert.equal(body.input.content, text); assert.deepEqual(body.expectedSnapshot, snapshotRef(snapshot)); assert.deepEqual(Object.keys(body).sort(), ['expectedSnapshot', 'input']);
  const original = globalThis.fetch;
  try { globalThis.fetch = async (url, init) => {
    assert.equal(String(url), `/api/requirements/v1/projects/${snapshot.projectId}/review`); assert.equal(init?.method, 'POST'); assert.equal(init?.credentials, 'same-origin'); assert.equal(new Headers(init?.headers).get(RequirementsVersionHeader), RequirementsProtocolVersion); assert.deepEqual(JSON.parse(init!.body as string), body);
    return new Response(JSON.stringify({ userMessage: { ...consultUser, content: text }, turn: { ...consultTurn, mode: 'ask', runMode: 'plan' } }), { status: 202, headers: { [RequirementsVersionHeader]: RequirementsProtocolVersion } });
  }; await requirementsApi.review(snapshot.projectId, body); } finally { globalThis.fetch = original; }
});
test('lost typed review response keeps a stable key; arbitrary version/hash errors never become legacy success', async () => {
  const { snapshot } = await sealed(), original = globalThis.fetch, keys: string[] = [];
  try { globalThis.fetch = async (_url, init) => { keys.push(new Headers(init?.headers).get('Idempotency-Key')!); throw new Error('lost'); };
    const body = reviewFor(snapshot, '另一个实际草稿，不能静默重造'); await assert.rejects(requirementsApi.review(snapshot.projectId, body)); await assert.rejects(requirementsApi.review(snapshot.projectId, body)); assert.equal(keys[0], keys[1]);
    globalThis.fetch = async () => new Response(JSON.stringify({ protocolVersion: RequirementsProtocolVersion, snapshot, pendingSummaries: [] })); await assert.rejects(requirementsApi.read(snapshot.projectId), /版本不一致/);
    globalThis.fetch = async () => new Response(JSON.stringify({ protocolVersion: RequirementsProtocolVersion, snapshot: { ...snapshot, hash: 'f'.repeat(64) }, pendingSummaries: [] }), { headers: { [RequirementsVersionHeader]: RequirementsProtocolVersion } }); await assert.rejects(requirementsApi.read(snapshot.projectId), /指纹不一致/);
  } finally { globalThis.fetch = original; }
});
test('requirements read rejects foreign project even with otherwise conforming source graph', async () => {
  const { snapshot, summary } = await sealed(); RequirementsReadView.parse({ protocolVersion: RequirementsProtocolVersion, snapshot, pendingSummaries: [summary] });
  const original = globalThis.fetch;
  try { globalThis.fetch = async () => new Response(JSON.stringify({ protocolVersion: RequirementsProtocolVersion, snapshot, pendingSummaries: [summary] }), { headers: { [RequirementsVersionHeader]: RequirementsProtocolVersion } });
    await assert.rejects(requirementsApi.read('project_other'), /其他项目/);
    const value = await requirementsApi.read(snapshot.projectId); assert.equal(canonicalDeliveryJson(value.snapshot), canonicalDeliveryJson(snapshot));
  } finally { globalThis.fetch = original; }
});
