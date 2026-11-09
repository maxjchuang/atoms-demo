import assert from 'node:assert/strict';
import test from 'node:test';
import { CoordinationWorkspace } from '@atoms/contracts/conversation';
import { workspace, consultEvents, consultTurn, consultUser, consultReply, legacyConversationMessage } from '@atoms/contracts/conversation-fixtures';
import { hydrateConversation, mergeMessages, mergeOlderMessages, applyConversationEvents, applyExecutionEvents, actorLabels, proposalMessageAnchor, conversationSegments, messageExcerpt } from '../src/conversation-state.js';

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

test('proposal card stays anchored to original reply regardless updated revision and falls back to its loaded user source', () => {
  const proposal = { id:'proposal_anchor', projectId:consultTurn.projectId, originatingTurnId:consultTurn.id } as Parameters<typeof proposalMessageAnchor>[0];
  const turn = { ...consultTurn, assistantMessageId:consultReply.id };
  assert.equal(proposalMessageAnchor(proposal,[turn],[consultUser,consultReply]),consultReply.id);
  assert.equal(proposalMessageAnchor({...proposal,revision:99,updatedAt:'2099-01-01T00:00:00Z'},[turn],[consultUser,consultReply]),consultReply.id);
  assert.equal(proposalMessageAnchor(proposal,[turn],[consultUser]),consultUser.id);
  assert.equal(proposalMessageAnchor(proposal,[turn],[]),null);
});

test('only consecutive same-run execution records group, never absorb later logs across a user or coordinator message', () => {
 const log=(id:string,seq:number,runId='run_a')=>({...consultReply,id,historySeq:seq,runId,actor:'worker' as const});
 const messages=[log('a',1),{...log('b',2),actor:'system' as const}, {...consultUser,historySeq:3},log('c',4),{...consultReply,historySeq:5},log('d',6),log('e',7,'run_b')];
 const grouped=conversationSegments(messages);assert.deepEqual(grouped.map(segment=>segment.kind!=='message'?segment.messages.map(message=>message.id):segment.message.id),[['a','b'],consultUser.id,['c'],consultReply.id,['d'],['e']]);
 assert.deepEqual(grouped.flatMap(segment=>segment.kind!=='message'?segment.messages:[segment.message]),messages);
 assert.equal(conversationSegments([log('protected',1)],new Set(['protected']))[0].kind,'message');
});

test('known-turn progress groups by turn without hiding final replies, protected cards or later separated progress; long text remains intact',()=>{const progress=(id:string)=>({...consultReply,id,coordinationTurnId:consultTurn.id});const final={...consultReply,id:'final_reply'};const turn={...consultTurn,assistantMessageId:final.id};const messages=[progress('p1'),progress('p2'),consultUser,progress('p3'),final];const segments=conversationSegments(messages,new Set([final.id]),[turn]);assert.deepEqual(segments.map(s=>s.kind==='message'?s.message.id:[s.kind,s.messages.map(m=>m.id)]),[['coordination',['p1','p2']],consultUser.id,['coordination',['p3']],final.id]);assert.equal(conversationSegments([progress('p1')],new Set(),[])[0].kind,'message');const text='原scope与JSON'.repeat(100);assert.ok(messageExcerpt(text).length<300);assert.equal(messages.at(-1)!.content,final.content);assert.equal(messageExcerpt('短答复'),'短答复');});
