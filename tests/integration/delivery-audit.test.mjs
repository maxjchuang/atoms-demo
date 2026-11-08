import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCoordinationUsage} from './delivery-audit.mjs';
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
