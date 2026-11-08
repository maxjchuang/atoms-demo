import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentEvent, AgentEventPage, ApiError, ArtifactManifest, AnswerRequest,
  ProjectEvent, ProjectEventPage, RelativePath, Run, StartExecutionRequest, WorkspaceSnapshot,
  ExecutionSnapshot,
} from '../src/index.js';
import { agentEvents, artifact, errorFixtures, scenarios, startExecution, run, time } from '../src/fixtures.js';

for (const scenario of scenarios) {
  test(`fixture: ${scenario.name} is a consistent wire timeline`, () => {
    WorkspaceSnapshot.parse(scenario.initial);
    WorkspaceSnapshot.parse(scenario.final);
    Run.parse(scenario.finalRun);
    let lastSeq = scenario.initial.eventCursor;
    let lastRevision = 0;
    for (const event of scenario.events) {
      ProjectEvent.parse(event);
      assert.equal(event.seq, ++lastSeq);
      assert.equal(event.projectId, scenario.initial.project.id);
      if (event.event.type === 'run.updated') {
        assert.ok(event.event.payload.revision > lastRevision);
        lastRevision = event.event.payload.revision;
      }
    }
    assert.equal(lastSeq, scenario.final.eventCursor);
    const publications = scenario.events.filter((item) => item.event.type === 'version.published');
    const lastPublication = publications.at(-1);
    if (lastPublication?.event.type === 'version.published') {
      assert.equal(scenario.final.project.revision, lastPublication.event.payload.project.revision);
      assert.equal(scenario.final.project.currentVersionId, lastPublication.event.payload.version.id);
    }
  });
}
test('failed, cancelled, and interrupted fixtures never switch preview', () => {
  for (const scenario of scenarios.filter((item) => ['failed', 'cancelled', 'interrupted'].includes(item.name))) {
    assert.equal(scenario.final.currentVersion?.id, scenario.initial.currentVersion?.id);
    assert.ok(!scenario.events.some((event) => event.event.type === 'version.published'));
    assert.equal(scenario.finalRun.resultVersionId, null);
  }
});
test('internal start request and event fixtures conform', () => {
  StartExecutionRequest.parse(startExecution);
  agentEvents.forEach((event, index) => {
    AgentEvent.parse(event);
    assert.equal(event.sourceSeq, index + 1);
  });
});
test('wire contracts reject DSH payload leakage and unsupported protocol versions', () => {
  assert.equal(StartExecutionRequest.safeParse({ ...startExecution, dshSession: {} }).success, false);
  assert.equal(AgentEvent.safeParse({ ...agentEvents[0], protocolVersion: '9.0.0' }).success, false);
  assert.equal(AgentEvent.safeParse({ ...agentEvents[0], event: { type: 'dsh/raw', payload: {} } }).success, false);
});
test('start request rejects mismatched version baseline', () => {
  assert.equal(StartExecutionRequest.safeParse({ ...startExecution, baseVersionId: 'version_other' }).success, false);
});
test('runtime cannot claim publishing phase', () => {
  assert.equal(AgentEvent.safeParse({ ...agentEvents[1], event: { type: 'phase.changed', payload: { phase: 'publishing' } } }).success, false);
});
test('artifact requires all mandatory checks and entry files', () => {
  ArtifactManifest.parse(artifact);
  assert.equal(ArtifactManifest.safeParse({ ...artifact, checks: [] }).success, false);
  assert.equal(ArtifactManifest.safeParse({ ...artifact, files: artifact.files.slice(0, 1) }).success, false);
  assert.equal(ArtifactManifest.safeParse({ ...artifact, checks: artifact.checks.map((check) => ({ ...check, status: 'not_run' })) }).success, false);
});
test('artifact rejects duplicate paths', () => {
  assert.equal(ArtifactManifest.safeParse({ ...artifact, files: [...artifact.files, artifact.files[0]] }).success, false);
});
test('artifact path syntax blocks traversal, absolute paths, backslashes and drive prefixes', () => {
  for (const path of ['../secret', '/etc/passwd', 'src/../secret', 'src//file', 'C:/secret', 'src\\file', 'src/./file', 'src/\u0000file']) {
    assert.equal(RelativePath.safeParse(path).success, false, path);
  }
  assert.equal(RelativePath.safeParse('source/src/components/便签.tsx').success, true);
});
test('answer requests require explicit attention and revision', () => {
  AnswerRequest.parse({ attentionId: 'attention_plan', expectedRevision: 1, answer: { kind: 'approve_plan' } });
  assert.equal(AnswerRequest.safeParse({ answer: { kind: 'approve_plan' } }).success, false);
  assert.equal(AnswerRequest.safeParse({ attentionId: 'attention_plan', expectedRevision: 1, answer: { kind: 'select' } }).success, false);
});
test('both event transports have explicit cursor and pagination', () => {
  ProjectEventPage.parse({ items: scenarios[0].events.slice(0, 2), nextCursor: 2, hasMore: true });
  AgentEventPage.parse({ items: agentEvents, nextCursor: 5, hasMore: false });
  ProjectEventPage.parse({ items: [], nextCursor: 5, hasMore: false });
});
test('errors have stable codes, retryability, and a request correlation id', () => {
  ApiError.parse({ error: { code: 'QUOTA_EXCEEDED', message: '体验额度已用完', retryable: false, requestId: 'request_demo' } });
  assert.equal(ApiError.safeParse({ error: { code: 'anything', message: 'oops' } }).success, false);
});
test('all error fixtures conform to the shared error envelope', () => {
  errorFixtures.forEach((fixture) => ApiError.parse(fixture.body));
});
test('terminal run results survive workspace refresh through latestRun', () => {
  for (const scenario of scenarios.filter((item) => ['success', 'failed', 'cancelled', 'interrupted'].includes(item.name))) {
    assert.equal(scenario.final.activeRun, null);
    assert.equal(scenario.final.latestRun?.status, scenario.finalRun.status);
  }
});
test('waiting and success status have semantic requirements', () => {
  assert.equal(Run.safeParse({ ...run, status: 'waiting_input' }).success, false);
  assert.equal(Run.safeParse({ ...run, status: 'succeeded' }).success, false);
  assert.equal(ExecutionSnapshot.safeParse({
    protocolVersion: '0.1.0', id: 'execution_demo', runId: run.id, status: 'succeeded',
    phase: 'verifying', revision: 1, lastSourceSeq: 5, pendingAttention: null,
    artifactId: null, updatedAt: time,
  }).success, false);
});
test('artifact evidence IDs resolve to files and required checks contain evidence', () => {
  assert.equal(ArtifactManifest.safeParse({ ...artifact, evidence: [] }).success, false);
  assert.equal(ArtifactManifest.safeParse({ ...artifact,
    checks: artifact.checks.map((check) => ({ ...check, evidenceIds: [] })),
  }).success, false);
});
test('opaque message cursors are not constrained to entity ID format', () => {
  WorkspaceSnapshot.parse({ ...scenarios[0].initial, olderMessagesCursor: '0.eyJpZCI6MX0=' });
});
