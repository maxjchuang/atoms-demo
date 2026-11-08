import assert from 'node:assert/strict';
import {CoordinationUsage,CoordinationBudget,CoordinationWorkspace} from '../../packages/contracts/src/conversation.ts';

/** Integration evidence only; never fabricates provider usage or changes a production counter. */
export function auditCoordinationUsage(value,budgetValue,{real}){
 const usage=CoordinationUsage.parse(value),budget=CoordinationBudget.parse(budgetValue);
 assert.ok(usage.modelSteps<=budget.maxModelSteps,'Router observable model steps must stay within the frozen budget.');
 for(const [field,cap] of [['inputTokens','maxInputTokens'],['outputTokens','maxOutputTokens']]){
  if(usage[field]===null){assert.ok(!real,`Real Router ${field} must be known; no extra call or retry is permitted to replace unknown usage.`);}
  else assert.ok(usage[field]<=budget[cap],`Reported Router ${field} must stay within the frozen budget.`);
 }
 return {modelSteps:usage.modelSteps,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,
  inputAccounting:usage.inputTokens===null?'unknown_fake_provider':'reported_within_frozen_cap',
  outputAccounting:usage.outputTokens===null?'unknown_fake_provider':'reported_within_frozen_cap'};
}

/** A restart baseline is taken after all submitted work, including the final read-only answer. */
export function deliveryRestartCheckpoint(value,expectedVersionId){
 const workspace=CoordinationWorkspace.parse(value),execution=workspace.execution;
 assert.equal(execution.project.activeRunId,null,'Restart checkpoint requires the project writer to be idle.');
 assert.equal(execution.activeRun,null,'Restart checkpoint requires no active Run.');
 assert.equal(execution.queuedRuns.length,0,'Restart checkpoint requires an empty Run queue.');
 assert.equal(workspace.pendingCoordinationTurns.length,0,'Restart checkpoint requires all submitted coordination Turns to be terminal.');
 assert.equal(execution.latestRun?.status,'succeeded','Restart checkpoint requires the final delivery Run to have succeeded.');
 assert.equal(execution.latestRun?.resultVersionId,expectedVersionId,'Restart checkpoint requires the expected final Run result.');
 assert.equal(execution.currentVersion?.id,expectedVersionId,'Restart checkpoint requires the expected published version.');
 assert.equal(execution.latestRun?.pendingAttention,null,'Restart checkpoint cannot contain unresolved Run input.');
 assert.equal(execution.latestRun?.pendingAnswer,null,'Restart checkpoint cannot contain a pending Run answer.');
 return {currentVersionId:execution.currentVersion.id,latestRunId:execution.latestRun.id,projectRevision:execution.project.revision,
  executionEventCursor:workspace.executionEventCursor,conversationEventCursor:workspace.conversationEventCursor,
  conversationRevision:workspace.conversationRevision,latestCoordinationTurnId:workspace.latestCoordinationTurn?.id??null,
  latestCoordinationTurnStatus:workspace.latestCoordinationTurn?.status??null};
}
