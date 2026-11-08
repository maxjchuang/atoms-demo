import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {unexpectedServiceExit,awaitOneShot,assertOneShotSucceeded} from './delivery-process.mjs';
const child=script=>spawn(process.execPath,['-e',script],{detached:true,stdio:['ignore','pipe','pipe']});
test('one-shot normal exit zero passes and never appears as a dead long-lived service',async()=>{
 const cli=child("console.log(JSON.stringify({createdRuns:0,submittedMessages:0}));");const result=await awaitOneShot(cli,{timeoutMs:5000});assertOneShotSucceeded(result);assert.equal(result.code,0);assert.equal(unexpectedServiceExit([cli]),undefined);
 cli.lifecycle='service';assert.equal(unexpectedServiceExit([cli]),cli,'Unexpected long-lived exit zero remains fatal.');cli.stopping=true;assert.equal(unexpectedServiceExit([cli]),undefined);
});
test('one-shot nonzero still fails independently of the service monitor',async()=>{
 const cli=child('process.exit(7)');const result=await awaitOneShot(cli,{timeoutMs:5000});assert.equal(result.code,7);assert.equal(unexpectedServiceExit([cli]),undefined);assert.throws(()=>assertOneShotSucceeded(result),/code=7/);
});
test('one-shot timeout escalates cleanup and fails; service signal exits remain fatal',async()=>{
 const cli=child("process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000);");await once(cli.stdout,'data');const result=await awaitOneShot(cli,{timeoutMs:20,killGraceMs:20});assert.equal(result.timedOut,true);assert.equal(result.signal,'SIGKILL');assert.throws(()=>assertOneShotSucceeded(result),/timedOut=true/);assert.throws(()=>process.kill(cli.pid,0),{code:'ESRCH'});
 cli.lifecycle='service';assert.equal(unexpectedServiceExit([cli]),cli);
});
