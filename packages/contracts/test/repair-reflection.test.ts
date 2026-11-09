import assert from 'node:assert/strict';
import test from 'node:test';
import {Attention,AnswerRequest,ExecutionSnapshot,Run} from '../src/index.js';
import {attention,run,time} from '../src/fixtures.js';
test('review question keeps old Attention compatible and crosses execution/public waiting snapshots',()=>{
 Attention.parse(attention);
 const review=Attention.parse({...attention,kind:'question',resolution:'replan',title:'需要重新规划',description:'已有两次修复仍未通过，请补充实际表现。',allowText:true});
 assert.equal(review.resolution,'replan');
 Run.parse({...run,status:'waiting_input',phase:'repairing',pendingAttention:review});
 ExecutionSnapshot.parse({protocolVersion:'0.1.0',id:'execution_reflection_test',runId:run.id,status:'waiting_input',phase:'repairing',revision:1,lastSourceSeq:0,pendingAttention:review,artifactId:null,updatedAt:time});
});
test('review marker cannot grant continuation or be smuggled into a user answer',()=>{
 assert.equal(Attention.safeParse({...attention,resolution:'continue'}).success,false);
 assert.equal(AnswerRequest.safeParse({attentionId:attention.id,expectedRevision:1,answer:{kind:'text',text:'补充情况'},resolution:'replan'}).success,false);
});
