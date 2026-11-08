import assert from 'node:assert/strict';
import {CoordinationUsage,CoordinationBudget} from '../../packages/contracts/src/conversation.ts';

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
