import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, ProjectEvent, Run, WorkspaceSnapshot } from '../src/index.js';
import { agentEvents, scenarios as executionScenarios, startExecution } from '../src/fixtures.js';
import {
  CoordinationProtocolVersion, COORDINATION_DEFAULTS, CoordinationBudget, SubmitMessageRequest,
  ConversationMessage, ConversationEvent, ConversationEventPage, CoordinationTurn, CoordinationWorkspace,
  CoordinationFacts, ProjectMemoryView, RouterMemory, Clarification, ChangeProposal, RouterResult,
  StartCoordinationRequest, CoordinationExecutionSnapshot, CoordinationSourceEvent, CancelCoordinationResponse,
  CoordinationApiError, AcceptProposalResponse,
} from '../src/conversation.js';
import * as fixture from '../src/conversation-fixtures.js';

test('v0.2 is isolated: legacy versions, DTOs and execution event variants stay unchanged', () => {
  assert.equal(PROTOCOL_VERSION, '0.1.0'); assert.equal(CoordinationProtocolVersion, '0.2.0');
  WorkspaceSnapshot.parse(executionScenarios[0].final); Run.parse(executionScenarios[0].finalRun);
  assert.equal(WorkspaceSnapshot.safeParse({ ...executionScenarios[0].final, conversationRevision: 1 }).success, false);
  assert.equal(ProjectEvent.safeParse(fixture.consultEvents[0]).success, false);
  assert.equal(ConversationEvent.safeParse(executionScenarios[0].events[0]).success, false);
  assert.ok(agentEvents.every((event) => event.protocolVersion === '0.1.0'));
});

test('default mode is auto; typed selection requires explicit reply binding and forbids arbitrary labels', () => {
  const request = SubmitMessageRequest.parse(fixture.scenarios.consult.request);
  assert.equal(request.mode, 'auto'); assert.equal(request.runMode, 'build');
  SubmitMessageRequest.parse(fixture.selectionMessageRequest);
  assert.equal(SubmitMessageRequest.safeParse({ input: { kind: 'selection', optionId: 'option_dark' } }).success, false);
  assert.equal(SubmitMessageRequest.safeParse({ ...fixture.selectionMessageRequest,
    input: { kind: 'selection', optionId: 'option_dark', label: 'spoofed label' } }).success, false);
  assert.equal(SubmitMessageRequest.safeParse({ input: { kind: 'status' }, replyTo: fixture.selectionMessageRequest.replyTo }).success, false);
});

test('consult/status/changes/clarification/interruption fixtures are explicit coordination outcomes', () => {
  CoordinationTurn.parse(fixture.consultTurn); RouterResult.parse(fixture.consultRouterResult);
  RouterResult.parse(fixture.scenarios.status.routerResult);
  CoordinationTurn.parse(fixture.autoChangeTurn); RouterResult.parse(fixture.changeRouterResult);
  CoordinationTurn.parse(fixture.askProposalTurn); CoordinationTurn.parse(fixture.clarificationTurn);
  CoordinationTurn.parse(fixture.scenarios.quotaBlocked); CoordinationTurn.parse(fixture.scenarios.cancelled);
  CoordinationTurn.parse(fixture.scenarios.interrupted);
  CoordinationTurn.parse(fixture.controlTurn); RouterResult.parse(fixture.controlRouterResult);
  assert.equal(fixture.consultUser.runId, null); assert.equal(fixture.consultReply.runId, null);
});

test('ask is read-only; a completed turn needs a committed result and admitted run only exists after admission', () => {
  assert.equal(CoordinationTurn.safeParse({ ...fixture.autoChangeTurn, mode: 'ask' }).success, false);
  assert.equal(CoordinationTurn.safeParse({ ...fixture.controlTurn, mode: 'ask' }).success, false);
  assert.equal(CoordinationTurn.safeParse({ ...fixture.consultTurn, result: null }).success, false);
  assert.equal(CoordinationTurn.safeParse({ ...fixture.autoChangeTurn,
    result: { ...fixture.autoChangeTurn.result!, runId: null } }).success, false);
  assert.equal(ChangeProposal.safeParse({ ...fixture.proposal, status: 'accepted' }).success, false);
  AcceptProposalResponse.parse({ proposal: fixture.acceptedProposal, run: fixture.admittedRun });
});

test('short clarification answers stay bound and cannot silently become a new execution', () => {
  Clarification.parse(fixture.clarification); Clarification.parse(fixture.answeredClarification);
  StartCoordinationRequest.parse(fixture.continuationCoordination);
  assert.equal(Clarification.safeParse({ ...fixture.clarification, options: [], allowText: false }).success, false);
  assert.equal(Clarification.safeParse({ ...fixture.clarification, status: 'answered' }).success, false);
  assert.equal(Clarification.safeParse({ ...fixture.clarification, options: [fixture.clarification.options[0], fixture.clarification.options[0]] }).success, false);
  assert.equal(StartCoordinationRequest.safeParse({ ...fixture.continuationCoordination, replyTo: undefined }).success, false);
});

test('clarification answer carries its original question and trusted option even outside recent or pending history', () => {
  const request = StartCoordinationRequest.parse(fixture.continuationCoordination);
  assert.equal(request.context.pendingClarifications.length, 0);
  assert.ok(!request.context.recentMessages.some((message) => message.id === fixture.clarification.questionMessageId));
  assert.equal(request.operation.kind, 'clarification_answer');
  if (request.operation.kind !== 'clarification_answer') throw new Error('Expected a typed clarification answer');
  assert.equal(request.operation.questionSnapshot.id, fixture.clarification.id);
  assert.equal(request.operation.questionSnapshot.question, fixture.clarification.question);
  assert.deepEqual(request.operation.answer, { kind: 'selection', optionId: 'option_dark', label: '深色' });
  assert.equal(StartCoordinationRequest.safeParse({ ...request, operation: { ...request.operation,
    answer: { kind: 'selection', optionId: 'option_dark', label: '伪造标签' } } }).success, false);
});

test('latest intent and exact refresh remain distinct; refresh is typed and hard read-only', () => {
  ChangeProposal.parse(fixture.proposal); ChangeProposal.parse(fixture.staleExactProposal); ChangeProposal.parse(fixture.refreshedProposal);
  StartCoordinationRequest.parse(fixture.refreshCoordination);
  assert.equal(fixture.proposal.basePolicy.kind, 'latest_on_dispatch');
  assert.equal(fixture.staleExactProposal.basePolicy.kind, 'exact_version');
  assert.equal(fixture.refreshedProposal.supersedesProposalId, fixture.staleExactProposal.id);
  assert.equal(StartCoordinationRequest.safeParse({ ...fixture.refreshCoordination, mode: 'auto' }).success, false);
  assert.equal(StartCoordinationRequest.safeParse({ ...fixture.refreshCoordination, operation: {
    ...fixture.refreshCoordination.operation, forceProposalOnly: false,
  } }).success, false);
});

test('Agent facts reject full Version DTOs, signed links and host credentials', () => {
  CoordinationFacts.parse(fixture.startCoordination.context.facts);
  const facts = fixture.startCoordination.context.facts;
  for (const forbidden of ['cookie', 'serviceToken', 'apiKey', 'internalPath', 'previewUrl']) {
    assert.equal(CoordinationFacts.safeParse({ ...facts, [forbidden]: 'not-allowed' }).success, false);
  }
  assert.equal(CoordinationFacts.safeParse({ ...facts, versions: [fixture.workspace.execution.currentVersion] }).success, false);
  assert.equal(CoordinationFacts.safeParse({ ...facts, availableActions: [{ ...facts.availableActions[0], url: 'https://preview.example/p/signed/index.html' }] }).success, false);
});

test('memory has revisions, decision provenance and explicit supersession rather than session-only summary', () => {
  ProjectMemoryView.parse(fixture.persistedMemory);
  ProjectMemoryView.parse({ ...fixture.persistedMemory, revision: 2, decisions: [
    { ...fixture.decision, status: 'superseded' }, { ...fixture.decision, id: 'decision_dark', text: '明确改为深色',
      supersedesDecisionId: fixture.decision.id, sourceMessageIds: ['message_correction'], sourceTurnId: 'turn_correction' },
  ] });
  assert.equal(ProjectMemoryView.safeParse({ ...fixture.persistedMemory, decisions: [{ ...fixture.decision, sourceMessageIds: [] }] }).success, false);
  RouterMemory.parse({ projectId: 'project_demo', revision: 1, summary: '已确认暖色', decisionIds: [fixture.decision.id],
    summaryThroughHistorySeq: 3, consumedConversationRevision: 2, lastCompletedTurnId: 'turn_preference', updatedAt: fixture.consultTurn.updatedAt });
});

test('unified history preserves legacy IDs/history sequence and dual cursors without modifying old snapshot', () => {
  CoordinationWorkspace.parse(fixture.workspace);
  assert.equal(fixture.workspace.messages[0].id, fixture.legacyMessage.id);
  assert.equal(fixture.workspace.messages[0].historySeq, 1);
  assert.notEqual(fixture.workspace.executionEventCursor, fixture.workspace.conversationEventCursor);
  assert.equal(CoordinationWorkspace.safeParse({ ...fixture.workspace, executionEventCursor: 999 }).success, false);
  assert.equal(ConversationMessage.safeParse({ ...fixture.consultUser, historySeq: undefined }).success, false);
  const admittedMessage = { ...fixture.consultUser, runId: fixture.admittedRun.id, revision: 2 };
  ConversationMessage.parse(admittedMessage);
  assert.equal(admittedMessage.id, fixture.consultUser.id); assert.equal(admittedMessage.historySeq, fixture.consultUser.historySeq);
});

test('new conversation/source events have independent stable version and cursor envelopes', () => {
  fixture.consultEvents.forEach((event, index) => { ConversationEvent.parse(event); assert.equal(event.seq, index + 1); });
  ConversationEventPage.parse({ items: fixture.consultEvents, nextCursor: 4, hasMore: false });
  CoordinationSourceEvent.parse({ protocolVersion: CoordinationProtocolVersion, projectId: 'project_demo', turnId: fixture.consultTurn.id,
    sourceSeq: 1, occurredAt: fixture.consultTurn.createdAt, event: { type: 'coordination.completed', payload: fixture.consultRouterResult } });
  assert.equal(CoordinationSourceEvent.safeParse({ ...agentEvents[0], protocolVersion: CoordinationProtocolVersion }).success, false);
});

test('cancelling coordination after run admission reports dispatched and never pretends to stop the Worker', () => {
  CancelCoordinationResponse.parse({ turn: fixture.autoChangeTurn, disposition: 'already_dispatched', run: fixture.admittedRun });
  assert.equal(CancelCoordinationResponse.safeParse({ turn: fixture.autoChangeTurn, disposition: 'already_dispatched', run: null }).success, false);
  CoordinationExecutionSnapshot.parse({ protocolVersion: CoordinationProtocolVersion, id: fixture.consultTurn.id,
    projectId: 'project_demo', revision: 2, status: 'completed', lastSourceSeq: 3, contextUsed: fixture.contextUsed,
    result: fixture.consultRouterResult, error: null, usage: { modelSteps: 1, inputTokens: null, outputTokens: null }, updatedAt: fixture.consultTurn.updatedAt });
});

test('coordination defaults and errors are separate from generation quota and StartExecutionRequest', () => {
  const budget = CoordinationBudget.parse({});
  assert.equal(budget.maxModelSteps, 3); assert.equal(budget.maxWallTimeMs, 90000); assert.equal(budget.maxOutputTokens, 8192);
  assert.equal(budget.maxSourceFiles, 5); assert.equal(budget.maxSourceBytes, 24576);
  assert.equal(COORDINATION_DEFAULTS.maxOrdinaryRunQuestions, 2);
  CoordinationApiError.parse({ error: { code: 'COORDINATION_QUOTA_EXCEEDED', message: '对话额度不足', retryable: false, requestId: 'request_chat' } });
  assert.equal(startExecution.budget.maxWallTimeMs, 600000);
});
