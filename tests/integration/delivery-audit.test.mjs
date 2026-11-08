import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCoordinationUsage,deliveryRestartCheckpoint} from './delivery-audit.mjs';
import {workspace as fixtureWorkspace} from '../../packages/contracts/src/conversation-fixtures.ts';
const budget={maxModelSteps:3,maxWallTimeMs:90000,maxInputTokens:32768,maxOutputTokens:8192};
test('Fake typed nullable usage remains null and explicitly unknown, never measured zero',()=>{
 const proof=auditCoordinationUsage({modelSteps:1,inputTokens:null,outputTokens:null},budget,{real:false});
 assert.equal(proof.inputTokens,null);assert.equal(proof.outputTokens,null);assert.equal(proof.inputAccounting,'unknown_fake_provider');assert.equal(proof.outputAccounting,'unknown_fake_provider');assert.equal(proof.modelSteps,1);
});
test('real nullable usage still fails with a fixed reason; known real usage passes only within the caps',()=>{
 assert.throws(()=>auditCoordinationUsage({modelSteps:1,inputTokens:null,outputTokens:null},budget,{real:true}),/Real Router inputTokens must be known/);
 assert.throws(()=>auditCoordinationUsage({modelSteps:1,inputTokens:100,outputTokens:null},budget,{real:true}),/Real Router outputTokens must be known/);
 const proof=auditCoordinationUsage({modelSteps:2,inputTokens:32000,outputTokens:8000},budget,{real:true});assert.equal(proof.inputAccounting,'reported_within_frozen_cap');
});
test('Fake mode never bypasses observable steps or a reported token excess',()=>{
 assert.throws(()=>auditCoordinationUsage({modelSteps:4,inputTokens:null,outputTokens:null},budget,{real:false}),/observable model steps/);
 for(const real of [false,true]){assert.throws(()=>auditCoordinationUsage({modelSteps:1,inputTokens:32769,outputTokens:1},budget,{real}),/inputTokens must stay/);assert.throws(()=>auditCoordinationUsage({modelSteps:1,inputTokens:1,outputTokens:8193},budget,{real}),/outputTokens must stay/);}
});

test('restart checkpoint records the final ask tail rather than an earlier successful Run cursor',()=>{
 const before=structuredClone(fixtureWorkspace),versionId=before.execution.currentVersion.id;before.executionEventCursor=244;before.execution.eventCursor=244;
 const old=deliveryRestartCheckpoint(before,versionId);const after=structuredClone(before);after.executionEventCursor=247;after.execution.eventCursor=247;after.conversationEventCursor+=4;after.conversationRevision++;
 const sealed=deliveryRestartCheckpoint(after,versionId);assert.equal(sealed.executionEventCursor,247);assert.notDeepEqual(sealed,old);assert.deepEqual(deliveryRestartCheckpoint(structuredClone(after),versionId),sealed);
});
test('restart checkpoint rejects pending coordination and active or queued work',()=>{
 const value=structuredClone(fixtureWorkspace),versionId=value.execution.currentVersion.id;
 const pending=structuredClone(value);pending.pendingCoordinationTurns=[{...pending.latestCoordinationTurn,status:'processing',result:null,completedAt:null}];assert.throws(()=>deliveryRestartCheckpoint(pending,versionId),/coordination Turns to be terminal/);
 const active=structuredClone(value);active.execution.project.activeRunId=active.execution.latestRun.id;assert.throws(()=>deliveryRestartCheckpoint(active,versionId),/project writer to be idle/);
 const queued=structuredClone(value);queued.execution.queuedRuns=[{...queued.execution.latestRun,status:'queued',resultVersionId:null}];assert.throws(()=>deliveryRestartCheckpoint(queued,versionId),/empty Run queue/);
});
