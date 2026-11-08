import assert from 'node:assert/strict';
import test from 'node:test';
import { CoordinationWorkspace } from '@atoms/contracts/conversation';
import { workspace, consultEvents, consultTurn, consultUser, consultReply, legacyConversationMessage } from '@atoms/contracts/conversation-fixtures';
import { hydrateConversation, mergeMessages, mergeOlderMessages, applyConversationEvents, applyExecutionEvents, actorLabels } from '../src/conversation-state.js';

test('message IDs/revisions upsert and historySeq controls order, not event timestamp', () => {
  const first = { ...consultReply, revision: 2, content: 'newest' };
  const messages = mergeMessages([first, legacyConversationMessage], [{ ...consultReply, revision: 1, content: 'stale' }, consultUser, first]);
  assert.equal(messages.length, 3); assert.deepEqual(messages.map(item => item.historySeq), [1, 2, 3]);
  assert.equal(messages.at(-1)?.content, 'newest');
});
test('v1 message events cannot overwrite v2 actor, content, metadata or history order', () => {
  const view = hydrateConversation(null, workspace);
  const next = applyExecutionEvents(view, [{ protocolVersion: '0.1.0', projectId: 'project_demo', runId: null,
    seq: view.workspace.executionEventCursor + 1, occurredAt: '2026-11-08T08:00:00.000Z', event: {
      type: 'message.updated', payload: { id: consultReply.id, projectId: 'project_demo', runId: null, role: 'assistant', status: 'complete', content: 'old shape', createdAt: consultReply.createdAt },
    } }]);
  assert.deepEqual(next.messages, view.messages);
  assert.equal(next.workspace.executionEventCursor, view.workspace.executionEventCursor + 1);
  assert.equal(next.workspace.conversationEventCursor, view.workspace.conversationEventCursor);
});
test('dual stream cursors are independent and coordinator history does not rewind execution', () => {
  const initial = { ...workspace, conversationEventCursor: 0, messages: [legacyConversationMessage], latestCoordinationTurn: null };
  const view = hydrateConversation(null, initial);
  const next = applyConversationEvents(view, consultEvents);
  CoordinationWorkspace.parse(next.workspace);
  assert.equal(next.workspace.conversationEventCursor, 4);
  assert.equal(next.workspace.executionEventCursor, workspace.executionEventCursor);
  assert.equal(next.workspace.execution.currentVersion?.id, workspace.execution.currentVersion?.id);
  assert.equal(next.messages.filter(item => item.id === consultReply.id).length, 1);
  assert.deepEqual(applyConversationEvents(next, consultEvents), next);
});
test('conversation event gaps require atomic snapshot recovery', () => {
  const view = hydrateConversation(null, { ...workspace, conversationEventCursor: 0 });
  assert.throws(() => applyConversationEvents(view, [consultEvents[2]]));
});
test('a stale snapshot cannot roll either cursor backwards', () => {
  const view = hydrateConversation(null, workspace);
  assert.equal(hydrateConversation(view, { ...workspace, conversationEventCursor: 3 }), view);
  assert.equal(hydrateConversation(view, { ...workspace, execution: { ...workspace.execution, eventCursor: 0 }, executionEventCursor: 0 }), view);
});
test('older pages stay available after a fresh recent-message snapshot', () => {
  const initial = hydrateConversation(null, { ...workspace, messages: [consultReply], olderMessagesCursor: 'cursor_recent' });
  const expanded = mergeOlderMessages(initial, [legacyConversationMessage, consultUser], null);
  const refreshed = hydrateConversation(expanded, { ...workspace, messages: [consultReply], olderMessagesCursor: 'cursor_recent' });
  assert.equal(refreshed.messages.length, 3); assert.equal(refreshed.olderCursor, null);
});
test('legacy actor is explicit and never guessed from a report text', () => {
  const legacy = { ...consultReply, actor: 'legacy_assistant' as const, coordinationTurnId: null };
  assert.equal(mergeMessages([], [legacy])[0].actor, 'legacy_assistant');
  assert.equal(actorLabels.legacy_assistant, '历史助手');
});
test('clarification completion is not an active Run or an indefinitely processing turn', () => {
  const view = hydrateConversation(null, { ...workspace, conversationEventCursor: 0 });
  const completed = applyConversationEvents(view, [{ ...consultEvents[0], seq: 1, event: { type: 'turn.updated', payload: consultTurn } }]);
  assert.equal(completed.workspace.pendingCoordinationTurns.length, 0);
  assert.equal(completed.workspace.execution.latestRun?.id, workspace.execution.latestRun?.id);
});
