import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {CoordinationWorkspace,CoordinationTurn,ConversationMessagePage,ConversationEventPage,ProjectMemoryView,
  ResolveActionResponse,type RouterResultDto,type StartCoordinationRequestDto} from '@atoms/contracts/conversation';
import {createApi,canonical,hash} from '../src/server.js';
import {startCoordination as canonicalVector} from '@atoms/contracts/conversation-fixtures';
import {createFakeRuntime} from '../src/fake-runtime.js';
import {addFakeCoordinator,fakeChange,fakeConsult,contextUsedFor} from '../src/fake-coordinator.js';

async function fixture(options:{limit?:number;rate?:number;defaultLimit?:boolean}={}){
  const directory=await mkdtemp(join(tmpdir(),'atoms-coordination-test-'));
  const runtime=createFakeRuntime('coordination-test-token');const coordinator=addFakeCoordinator(runtime.app);
  const address=await runtime.app.listen({host:'127.0.0.1',port:0});
  const config={legacyFixtureMode:true,dataDir:directory,agentUrl:address,serviceToken:'coordination-test-token',previewSecret:'coordination-preview-secret',previewOrigin:'http://127.0.0.1:3002',
    allowedOrigins:['http://localhost:5183'],autoSchedule:false,coordinationMessageLimit:options.defaultLimit?undefined:options.limit??50,coordinationMessagesPerMinute:options.rate??200};
  let service=await createApi(config);service.seedCode('coordination-demo-2026',{projectLimit:5,runLimit:10});let cookie='';
  const request=async(method:'GET'|'POST'|'DELETE',route:string,body?:unknown,key=randomUUID())=>{
    const reply=await service.app.inject({method,url:route,headers:{origin:'http://localhost:5183',...(cookie?{cookie}:{}),
      ...(method!=='GET'?{'idempotency-key':key}:{}),...(body===undefined?{}:{'content-type':'application/json'}),'x-atoms-coordination-version':'0.2.0'},
      ...(body===undefined?{}:{payload:JSON.stringify(body)})});
    return {status:reply.statusCode,data:reply.body?reply.json():null,headers:reply.headers};
  };
  const login=async(code='coordination-demo-2026')=>{const response=await request('POST','/api/v1/sessions',{code});assert.equal(response.status,201);cookie=String(response.headers['set-cookie']).split(';')[0];};
  const project=async()=>{const response=await request('POST','/api/v1/projects',{title:'协调测试项目'});assert.equal(response.status,201);return response.data;};
  const submit=async(projectId:string,content:string,mode='auto',key=randomUUID())=>{
    const response=await request('POST',`/api/v2/projects/${projectId}/messages`,{input:{kind:'text',content},mode},key);
    assert.equal(response.status,202,JSON.stringify(response.data));return response.data;
  };
  const turn=async(turnId:string)=>CoordinationTurn.parse((await request('GET',`/api/v2/coordination-turns/${turnId}`)).data);
  const workspace=async(projectId:string)=>CoordinationWorkspace.parse((await request('GET',`/api/v2/projects/${projectId}/workspace`)).data);
  return {runtime,coordinator,request,login,project,submit,turn,workspace,get service(){return service;},directory,
    async restart(){await service.close();service=await createApi(config);},
    async legacyRestart(){await service.close();const db=new DatabaseSync(join(directory,'api.sqlite'));const row=db.prepare('SELECT document FROM app_state WHERE id=1').get()!;
      const value=JSON.parse(String(row.document));delete value.coordination;db.prepare('UPDATE app_state SET document=? WHERE id=1').run(JSON.stringify(value));db.close();service=await createApi(config);},
    prepareUnsent(turnId:string,putPending=false){service.store.transaction(()=>{
      const record=service.store.state.coordination.turns.find(t=>t.dto.id===turnId)!;const request=structuredClone(canonicalVector);
      request.turnId=record.dto.id;request.projectId=record.dto.projectId;request.inputMessageId=record.dto.userMessageId;request.assistantMessageId='message_prepared_reply';
      request.content=record.inputContent;request.operation=record.operation;request.mode=record.dto.mode;
      request.context.projectId=record.dto.projectId;request.context.contextVersionId=null;request.context.facts.project.id=record.dto.projectId;
      request.context.facts.currentVersionId=null;request.context.facts.versions=[];request.context.facts.availableActions=[];
      request.context.projectMemory.projectId=record.dto.projectId;request.context.recentMessages=[];
      const {hash:_,...context}=request.context;request.context.hash=hash(canonical(context));
      record.request=request;record.requestHash=hash(canonical(request));record.putPending=putPending;record.dto.assistantMessageId=request.assistantMessageId;
    });},
    async close(){await service.close();await runtime.app.close();await rm(directory,{recursive:true,force:true});}};
}

test('context hash agrees with the shared cross-service UTF-8 canonical vector',()=>{
  const {hash:_,...context}=canonicalVector.context;
  assert.equal(Buffer.byteLength(canonical(context)),1534);
  assert.equal(hash(canonical(context)),'36b235ad27e086821bdcd8646b01ee834df106c83bafbe3fdbeffacdf80c65ed');
  assert.equal(canonical({b:undefined,a:[undefined,null]}),'{"a":[null,null]}');
});

test('consultation and structured status/sharing use independent messages, no Run or generation charge',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();
    const key=randomUUID();const first=await f.submit(project.id,'如何分享这个应用给别人？','auto',key);
    const duplicate=await f.submit(project.id,'如何分享这个应用给别人？','auto',key);assert.equal(first.turn.id,duplicate.turn.id);
    await f.service.tickCoordination();const turn=await f.turn(first.turn.id);assert.equal(turn.status,'completed');assert.equal(turn.result?.kind,'consult');
    let workspace=await f.workspace(project.id);assert.equal(workspace.execution.latestRun,null);assert.equal(workspace.messages.filter(m=>m.role==='user').length,1);
    assert.equal((await f.request('GET','/api/v1/session')).data.quota.runsUsed,0);assert.equal(f.coordinator.calls,1);
    const shortcut=await f.request('POST',`/api/v2/projects/${project.id}/messages`,{input:{kind:'sharing_help'}});await f.service.tickCoordination();
    assert.equal((await f.turn(shortcut.data.turn.id)).result?.kind,'consult');assert.equal(f.coordinator.calls,1,'Structured host shortcut must not call Router');
    const status=await f.request('POST',`/api/v2/projects/${project.id}/messages`,{input:{kind:'status'}});await f.service.tickCoordination();
    assert.equal((await f.turn(status.data.turn.id)).result?.kind,'status');assert.equal(f.coordinator.calls,1);
    assert.equal((await f.request('GET','/api/v2/session')).data.coordinationQuota.used,3);
  }finally{await f.close();}
});

test('auto clear change creates one Run and reuses original user message; ask and build consultations stay read-only',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();f.coordinator.setFactory(fakeChange);
    const submitted=await f.submit(project.id,'增加搜索框');await f.service.tickCoordination();
    const turn=await f.turn(submitted.turn.id);assert.equal(turn.result?.kind,'change_proposal');
    if(turn.result?.kind!=='change_proposal')throw new Error('Expected proposal');
    assert.equal(turn.result.admission,'run_queued');const runId=turn.result.runId!;
    let workspace=await f.workspace(project.id);assert.equal(workspace.execution.queuedRuns.length,1);
    assert.equal(workspace.messages.filter(m=>m.role==='user').length,1);assert.equal(workspace.messages.find(m=>m.id===submitted.userMessage.id)?.runId,runId);
    await f.service.tickCoordination();assert.equal(f.coordinator.calls,1);
    const proposal=(await f.request('GET',`/api/v2/proposals/${turn.result.proposalId}`)).data;
    const accepted=await f.request('POST',`/api/v2/proposals/${proposal.id}/accept`,{expectedRevision:proposal.revision,runMode:'build'});
    assert.equal(accepted.data.run.id,runId);
    const ask=await f.submit(project.id,'把按钮改为蓝色','ask');await f.service.tickCoordination();
    const askTurn=await f.turn(ask.turn.id);assert.equal(askTurn.result?.kind,'change_proposal');
    if(askTurn.result?.kind==='change_proposal')assert.equal(askTurn.result.runId,null);
    f.coordinator.setFactory(fakeConsult);const consult=await f.submit(project.id,'这个应用如何使用？','build');await f.service.tickCoordination();
    assert.equal((await f.turn(consult.turn.id)).result?.kind,'consult');
    workspace=await f.workspace(project.id);assert.equal(workspace.execution.queuedRuns.length,1);
  }finally{await f.close();}
});

test('clarification completes model turn, choices bind exact question and do not duplicate message/run',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();
    f.coordinator.setFactory(request=>({kind:'clarify',question:'选择哪一种配色？',options:[{id:'option_warm',label:'暖色'},{id:'option_dark',label:'深色'}],allowText:false,
      relatedProposalId:null,contextUsed:contextUsedFor(request),references:[],memoryUpdates:[]}));
    const initial=await f.submit(project.id,'调整一下配色');await f.service.tickCoordination();const first=await f.turn(initial.turn.id);
    assert.equal(first.status,'completed');if(first.result?.kind!=='clarify')throw new Error('Expected question');
    const question=(await f.request('GET',`/api/v2/clarifications/${first.result.clarificationId}`)).data;
    assert.equal((await f.workspace(project.id)).execution.latestRun,null);
    const bad=await f.request('POST',`/api/v2/projects/${project.id}/messages`,{input:{kind:'selection',optionId:'option_foreign'},replyTo:{clarificationId:question.id,expectedRevision:1,replyToMessageId:question.questionMessageId}});
    assert.equal(bad.status,400);
    const text=await f.request('POST',`/api/v2/projects/${project.id}/messages`,{input:{kind:'text',content:'深色'},replyTo:{clarificationId:question.id,expectedRevision:1,replyToMessageId:question.questionMessageId}});assert.equal(text.status,400);
    f.coordinator.setFactory(fakeConsult);
    for(let i=0;i<11;i++){await f.submit(project.id,`额外只读咨询${i}`);await f.service.tickCoordination();}
    f.coordinator.setFactory(fakeChange);
    const answerKey=randomUUID();const body={input:{kind:'selection',optionId:'option_dark'},replyTo:{clarificationId:question.id,expectedRevision:1,replyToMessageId:question.questionMessageId}};
    const answer=await f.request('POST',`/api/v2/projects/${project.id}/messages`,body,answerKey);assert.equal(answer.status,202);
    const retry=await f.request('POST',`/api/v2/projects/${project.id}/messages`,body,answerKey);assert.equal(retry.data.turn.id,answer.data.turn.id);
    const stale=await f.request('POST',`/api/v2/projects/${project.id}/messages`,body);assert.equal(stale.status,409);
    await f.service.tickCoordination();const request=f.coordinator.entries.get(answer.data.turn.id)!.request;
    assert.ok(!request.context.recentMessages.some(message=>message.id===question.questionMessageId),'Original question is outside recent history');
    assert.ok(!request.context.pendingClarifications.some(item=>item.id===question.id),'Answered question is no longer pending');
    assert.equal(request.operation.kind,'clarification_answer');if(request.operation.kind==='clarification_answer'){
      assert.equal(request.operation.questionSnapshot.question,question.question);assert.deepEqual(request.operation.answer,{kind:'selection',optionId:'option_dark',label:'深色'});
    }
    assert.equal((await f.request('GET',`/api/v2/clarifications/${question.id}`)).data.status,'answered');
    assert.equal((await f.workspace(project.id)).messages.filter(m=>m.role==='user').length,13);
  }finally{await f.close();}
});

test('persisted project decisions and corrections precede following queued context and survive API restart',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();
    f.coordinator.setFactory(request=>({...fakeConsult(request),memoryUpdates:[{kind:'preference',text:request.content,
      sourceMessageIds:[request.inputMessageId],supersedesDecisionId:request.context.projectMemory.decisions.find(d=>d.status==='active')?.id??null}]}));
    const first=await f.submit(project.id,'界面保持暖色');const second=await f.submit(project.id,'明确改成深色');
    await f.service.tickCoordination();assert.equal(f.coordinator.calls,1);await f.service.tickCoordination();assert.equal(f.coordinator.calls,2);
    const secondRequest=f.coordinator.entries.get(second.turn.id)!.request;
    assert.equal(secondRequest.context.projectMemory.revision,1);assert.equal(secondRequest.context.projectMemory.decisions[0].text,'界面保持暖色');
    await f.restart();const memory=ProjectMemoryView.parse((await f.request('GET',`/api/v2/projects/${project.id}/memory`)).data);
    assert.equal(memory.revision,2);assert.equal(memory.decisions[0].status,'superseded');assert.equal(memory.decisions[1].supersedesDecisionId,memory.decisions[0].id);
    assert.equal(memory.decisions[1].sourceTurnId,second.turn.id);assert.equal(memory.decisions[1].sourceMessageIds[0],second.userMessage.id);
    f.coordinator.setFactory(fakeConsult);const third=await f.submit(project.id,'此前确认的风格是什么？');await f.service.tickCoordination();
    assert.equal(f.coordinator.entries.get(third.turn.id)!.request.context.projectMemory.revision,2);
    assert.equal((await f.turn(first.turn.id)).status,'completed');
  }finally{await f.close();}
});

test('inferred/dismissed/cancelled proposal memory is unconfirmed; explicit accept records real scope once',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();
    const suggested=(request:StartCoordinationRequestDto):RouterResultDto=>({...fakeChange(request,'给应用增加分享入口'),origin:'inferred_suggestion',
      memoryUpdates:[{kind:'goal',text:'模型建议：用户已同意全部分享功能',sourceMessageIds:[request.inputMessageId],supersedesDecisionId:null}]});
    f.coordinator.setFactory(suggested);
    const first=await f.submit(project.id,'如何分享这个应用？');await f.service.tickCoordination();const firstResult=(await f.turn(first.turn.id)).result;
    if(firstResult?.kind!=='change_proposal')throw new Error('Expected suggestion');assert.equal(firstResult.runId,null);
    assert.equal((await f.request('GET',`/api/v2/projects/${project.id}/memory`)).data.decisions.length,0);
    const dismissed=(await f.request('GET',`/api/v2/proposals/${firstResult.proposalId}`)).data;
    await f.request('POST',`/api/v2/proposals/${dismissed.id}/dismiss`,{expectedRevision:dismissed.revision});
    assert.equal((await f.request('GET',`/api/v2/projects/${project.id}/memory`)).data.decisions.length,0);
    const second=await f.submit(project.id,'有哪些分享的建议？');await f.service.tickCoordination();const result=(await f.turn(second.turn.id)).result;
    if(result?.kind!=='change_proposal')throw new Error('Expected proposal');const proposal=(await f.request('GET',`/api/v2/proposals/${result.proposalId}`)).data;
    f.service.store.transaction(()=>{f.service.store.state.codes[0].runLimit=0;});
    const blocked=await f.request('POST',`/api/v2/proposals/${proposal.id}/accept`,{expectedRevision:proposal.revision,runMode:'build'});assert.equal(blocked.status,403);
    assert.equal((await f.request('GET',`/api/v2/projects/${project.id}/memory`)).data.decisions.length,0);
    f.service.store.transaction(()=>{f.service.store.state.codes[0].runLimit=10;});
    const accepted=await f.request('POST',`/api/v2/proposals/${proposal.id}/accept`,{expectedRevision:proposal.revision,runMode:'build'});assert.equal(accepted.status,202);
    const duplicate=await f.request('POST',`/api/v2/proposals/${proposal.id}/accept`,{expectedRevision:proposal.revision,runMode:'build'});assert.equal(duplicate.data.run.id,accepted.data.run.id);
    const mem=ProjectMemoryView.parse((await f.request('GET',`/api/v2/projects/${project.id}/memory`)).data);assert.equal(mem.decisions.length,1);
    assert.equal(mem.decisions[0].text,proposal.goal);assert.equal(mem.decisions[0].sourceProposalId,proposal.id);
    assert.equal(mem.decisions[0].sourceTurnId,second.turn.id);assert.deepEqual(mem.decisions[0].sourceMessageIds,[second.userMessage.id]);
    const receipt=f.service.store.state.coordination.proposalConfirmations.find(item=>item.proposalId===proposal.id)!;
    assert.equal(receipt.kind,'explicit_accept');assert.ok(receipt.actorSessionId);assert.equal(receipt.runId,accepted.data.run.id);
    assert.equal(f.service.store.state.coordination.proposalConfirmations.filter(item=>item.proposalId===proposal.id).length,1);
    f.coordinator.setFactory(()=>null);const cancelled=await f.submit(project.id,'还可以怎样分享？');await f.service.tickCoordination();const running=await f.turn(cancelled.turn.id);
    await f.request('POST',`/api/v2/coordination-turns/${running.id}/cancel`,{expectedRevision:running.revision});
    f.coordinator.complete(running.id,suggested(f.coordinator.entries.get(running.id)!.request));await f.service.tickCoordination();
    assert.equal((await f.turn(running.id)).status,'cancelled');assert.equal((await f.request('GET',`/api/v2/projects/${project.id}/memory`)).data.decisions.length,1);
    f.coordinator.setFactory(request=>({...fakeChange(request,'增加搜索框'),memoryUpdates:[{kind:'goal',text:'未被用户授权的额外目标',sourceMessageIds:[request.inputMessageId],supersedesDecisionId:null}]}));
    const clear=await f.submit(project.id,'增加搜索框');await f.service.tickCoordination();const clearResult=(await f.turn(clear.turn.id)).result;
    if(clearResult?.kind!=='change_proposal')throw new Error('Expected admitted change');assert.equal(clearResult.admission,'run_queued');
    const finalMemory=ProjectMemoryView.parse((await f.request('GET',`/api/v2/projects/${project.id}/memory`)).data);
    assert.equal(finalMemory.decisions.length,2);assert.ok(!finalMemory.decisions.some(decision=>decision.text.includes('额外目标')));
    assert.equal(finalMemory.decisions.find(decision=>decision.sourceProposalId===clearResult.proposalId)?.text,'增加搜索框');
  }finally{await f.close();}
});

test('response loss freezes context/hash across API restart instead of redispatching changed facts',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();f.coordinator.loseNextResponse();
    const message=await f.submit(project.id,'解释当前应用');await f.service.tickCoordination();
    const original=f.coordinator.entries.get(message.turn.id)!.request;
    f.service.store.transaction(()=>{f.service.store.state.projects.find(p=>p.dto.id===project.id)!.dto.revision++;});
    await f.restart();await f.service.tickCoordination();assert.equal(f.coordinator.calls,1);
    assert.deepEqual(f.coordinator.entries.get(message.turn.id)!.request,original);
    assert.equal((await f.turn(message.turn.id)).status,'completed');
  }finally{await f.close();}
});

test('coordination cancellation suppresses late change result but cannot cancel an already admitted Worker',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();f.coordinator.setFactory(()=>null);
    const message=await f.submit(project.id,'增加搜索框');await f.service.tickCoordination();const running=await f.turn(message.turn.id);
    await f.request('POST',`/api/v2/coordination-turns/${running.id}/cancel`,{expectedRevision:running.revision});
    const runtimeEntry=f.coordinator.entries.get(running.id)!;f.coordinator.complete(running.id,fakeChange(runtimeEntry.request));
    await f.service.tickCoordination();assert.equal((await f.turn(running.id)).status,'cancelled');assert.equal((await f.workspace(project.id)).execution.latestRun,null);
    f.coordinator.setFactory(fakeChange);const next=await f.submit(project.id,'增加搜索框');await f.service.tickCoordination();const done=await f.turn(next.turn.id);
    const cancelled=await f.request('POST',`/api/v2/coordination-turns/${done.id}/cancel`,{expectedRevision:done.revision});
    assert.equal(cancelled.data.disposition,'already_dispatched');assert.equal(cancelled.data.run.status,'queued');
    assert.equal(f.coordinator.cancels,1);assert.equal((await f.workspace(project.id)).execution.queuedRuns.length,1);
  }finally{await f.close();}
});

test('cancelling a prepared but never dispatched outbox does not PUT or start inference',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();const message=await f.submit(project.id,'增加搜索框');
    // Crash-window fixture: immutable request is persisted, but its HTTP PUT has not been sent.
    f.prepareUnsent(message.turn.id);
    await f.request('POST',`/api/v2/coordination-turns/${message.turn.id}/cancel`,{expectedRevision:1});
    await f.service.tickCoordination();
    assert.equal((await f.turn(message.turn.id)).status,'cancelled');assert.equal(f.coordinator.putRequests,0);assert.equal(f.coordinator.calls,0);
    assert.equal((await f.request('GET','/api/v2/session')).data.coordinationQuota.used,0);
    assert.equal((await f.request('GET','/api/v2/session')).data.coordinationQuota.reserved,0);
    assert.equal(f.service.store.state.runs.length,0);
  }finally{await f.close();}
});

test('uncertain in-flight PUT cancellation never recreates a turn or claims stopped on 404/network failure',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();const message=await f.submit(project.id,'增加搜索框');f.prepareUnsent(message.turn.id,true);
    await f.request('POST',`/api/v2/coordination-turns/${message.turn.id}/cancel`,{expectedRevision:1});
    f.coordinator.setUnavailable(true);await f.service.tickCoordination();assert.equal((await f.turn(message.turn.id)).status,'cancelling');
    f.coordinator.setUnavailable(false);await f.service.tickCoordination();assert.equal((await f.turn(message.turn.id)).status,'cancelling');
    assert.equal(f.coordinator.putRequests,0);assert.equal(f.coordinator.calls,0);assert.equal((await f.request('GET','/api/v2/session')).data.coordinationQuota.reserved,1);
    // The previously sent request arrives late. Only this simulated in-flight delivery may create RT.
    f.coordinator.setFactory(()=>null);const saved=f.service.store.state.coordination.turns.find(t=>t.dto.id===message.turn.id)!.request!;
    await f.runtime.app.inject({method:'PUT',url:`/internal/v2/coordination-turns/${message.turn.id}`,headers:{authorization:'Bearer coordination-test-token'},payload:saved});
    await f.service.tickCoordination();assert.equal((await f.turn(message.turn.id)).status,'cancelled');
    assert.equal(f.coordinator.putRequests,1);assert.equal(f.coordinator.calls,1);assert.equal((await f.request('GET','/api/v2/session')).data.coordinationQuota.used,1);
    assert.equal(f.service.store.state.runs.length,0);
  }finally{await f.close();}
});

test('evidence, status facts, memory and references are host-validated before side effects',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();
    for(const factory of [
      (request:StartCoordinationRequestDto)=>({...fakeChange(request),evidence:[{messageId:'message_forged',quote:'伪造'}]}),
      (request:StartCoordinationRequestDto)=>({...fakeConsult(request),references:[{kind:'version' as const,versionId:'version_foreign'}]}),
      (request:StartCoordinationRequestDto)=>({...fakeConsult(request),memoryUpdates:[{kind:'goal' as const,text:'伪造决定',sourceMessageIds:['message_missing'],supersedesDecisionId:null}]}),
    ]){
      f.coordinator.setFactory(factory);const message=await f.submit(project.id,'请解释当前应用');await f.service.tickCoordination();assert.equal((await f.turn(message.turn.id)).status,'failed');
    }
    const workspace=await f.workspace(project.id);assert.equal(workspace.execution.latestRun,null);assert.equal((await f.request('GET',`/api/v2/projects/${project.id}/memory`)).data.decisions.length,0);
  }finally{await f.close();}
});

test('generation quota and conversation quota are independent; pending cap and ownership are enforced',async()=>{
  const f=await fixture({limit:2});try{
    await f.login();const project=await f.project();
    const code=f.service.store.state.codes[0];f.service.store.transaction(()=>{code.runLimit=0;});
    f.coordinator.setFactory(fakeChange);const change=await f.submit(project.id,'增加搜索框');await f.service.tickCoordination();
    const outcome=(await f.turn(change.turn.id)).result;if(outcome?.kind!=='change_proposal')throw new Error('Expected proposal');assert.equal(outcome.admission,'blocked');
    f.coordinator.setFactory(fakeConsult);const consult=await f.submit(project.id,'解释一下应用');await f.service.tickCoordination();assert.equal((await f.turn(consult.turn.id)).status,'completed');
    const exhausted=await f.request('POST',`/api/v2/projects/${project.id}/messages`,{input:{kind:'text',content:'再次咨询'}});assert.equal(exhausted.status,403);assert.equal(exhausted.data.error.code,'COORDINATION_QUOTA_EXCEEDED');
    f.service.seedCode('foreign-demo-2026');await f.login('foreign-demo-2026');
    assert.equal((await f.request('GET',`/api/v2/coordination-turns/${change.turn.id}`)).status,404);
    assert.equal((await f.request('GET',`/api/v2/proposals/${outcome.proposalId}`)).status,404);
    assert.equal((await f.request('GET',`/api/v2/projects/${project.id}/workspace`)).status,404);
  }finally{await f.close();}
});

test('over fifty messages and legacy data remain paginated with stable ids and mirrored v1 execution updates',async()=>{
  const f=await fixture({limit:100,rate:200});try{
    await f.login();const project=await f.project();
    const legacy=(await f.request('POST',`/api/v1/projects/${project.id}/runs`,{prompt:'旧版直接构建',mode:'build'})).data.run;await f.service.tick();
    const v1Before=(await f.request('GET',`/api/v1/projects/${project.id}/workspace`)).data;
    for(let i=0;i<27;i++){await f.submit(project.id,`第${i+1}条只读咨询`);await f.service.tickCoordination();}
    const snapshot=await f.workspace(project.id);assert.ok(snapshot.olderMessagesCursor);assert.equal(snapshot.messages.length,50);
    const all=[];let cursor:string|null=null;
    do{const page=ConversationMessagePage.parse((await f.request('GET',`/api/v2/projects/${project.id}/messages?limit=13${cursor?'&before='+cursor:''}`)).data);all.unshift(...page.items);cursor=page.nextCursor;}while(cursor);
    assert.equal(new Set(all.map(m=>m.id)).size,all.length);assert.equal(all.length,55);assert.equal(all[0].id,v1Before.messages[0].id);assert.equal(all[0].runId,legacy.id);
    assert.deepEqual(all.map(m=>m.historySeq),Array.from({length:55},(_,i)=>i+1));
    let after=0;const events=[];while(true){const page=ConversationEventPage.parse((await f.request('GET',`/api/v2/projects/${project.id}/conversation-events?after=${after}&limit=11`)).data);events.push(...page.items);after=page.nextCursor;if(!page.hasMore)break;}
    assert.equal(after,snapshot.conversationEventCursor);assert.ok(events.some(e=>e.event.type==='message.upserted'&&e.event.payload.id===v1Before.messages[0].id));
    await f.restart();const restored=await f.workspace(project.id);assert.equal(restored.conversationEventCursor,after);assert.equal(restored.execution.currentVersion?.id,v1Before.currentVersion.id);
    const db=new DatabaseSync(join(f.directory,'api.sqlite'),{readOnly:true});const state=JSON.parse(String(db.prepare('SELECT document FROM app_state WHERE id=1').get()!.document));db.close();
    assert.equal(state.runs.length,1);assert.equal(state.coordination.turns.length,27);
  }finally{await f.close();}
});

test('exact proposal needs accept, stale dispatch fails before execution, refresh creates new readonly proposal',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();
    const initial=(await f.request('POST',`/api/v1/projects/${project.id}/runs`,{prompt:'初始版本',mode:'build'})).data.run;await f.service.tick();
    const oldVersion=(await f.workspace(project.id)).execution.currentVersion!;
    f.coordinator.setFactory(request=>({...fakeChange(request),basePolicy:{kind:'exact_version',expectedBaseVersionId:request.context.contextVersionId}}));
    const ask=await f.submit(project.id,'针对当前版本增加搜索','ask');await f.service.tickCoordination();const result=(await f.turn(ask.turn.id)).result;
    if(result?.kind!=='change_proposal')throw new Error('Expected proposal');let proposal=(await f.request('GET',`/api/v2/proposals/${result.proposalId}`)).data;
    const accepted=await f.request('POST',`/api/v2/proposals/${proposal.id}/accept`,{expectedRevision:proposal.revision,runMode:'build'});assert.equal(accepted.status,202);
    const oldProject=(await f.workspace(project.id)).execution.project;
    const restore=await f.request('POST',`/api/v1/projects/${project.id}/restore`,{versionId:oldVersion.id,expectedProjectRevision:oldProject.revision});assert.equal(restore.status,201);
    await f.service.tick();assert.equal((await f.request('GET',`/api/v1/runs/${accepted.data.run.id}`)).data.error.code,'CONFLICT');assert.equal(f.runtime.startCalls,1);
    proposal=(await f.request('GET',`/api/v2/proposals/${proposal.id}`)).data;assert.equal(proposal.status,'stale');
    const refresh=await f.request('POST',`/api/v2/proposals/${proposal.id}/refresh`,{expectedRevision:proposal.revision});assert.equal(refresh.status,202);
    await f.service.tickCoordination();const refreshed=(await f.turn(refresh.data.turn.id)).result;if(refreshed?.kind!=='change_proposal')throw new Error('Expected refreshed proposal');
    const next=(await f.request('GET',`/api/v2/proposals/${refreshed.proposalId}`)).data;
    assert.equal(next.supersedesProposalId,proposal.id);assert.equal(refreshed.runId,null);assert.equal(next.basePolicy.expectedBaseVersionId,restore.data.version.id);
    assert.equal((await f.request('GET',`/api/v1/runs/${initial.id}`)).data.status,'succeeded');
  }finally{await f.close();}
});

test('latest intent queued during a Worker run binds the newly published version without repeated confirmation',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();
    const head=(await f.request('POST',`/api/v1/projects/${project.id}/runs`,{prompt:'[hold]',mode:'build'})).data.run;await f.service.tick();
    f.coordinator.setFactory(fakeChange);const message=await f.submit(project.id,'接下来增加搜索框');await f.service.tickCoordination();
    const outcome=(await f.turn(message.turn.id)).result;if(outcome?.kind!=='change_proposal'||!outcome.runId)throw new Error('Expected one automatically queued run');
    assert.equal((await f.request('GET',`/api/v1/runs/${outcome.runId}`)).data.executionId,null);
    const running=(await f.request('GET',`/api/v1/runs/${head.id}`)).data;
    f.runtime.complete(running.executionId);await f.service.tick();
    const firstVersion=(await f.workspace(project.id)).execution.currentVersion!;await f.service.tick();
    const next=(await f.request('GET',`/api/v1/runs/${outcome.runId}`)).data;
    assert.equal(next.baseVersionId,firstVersion.id);assert.equal(next.status,'succeeded');assert.equal(f.coordinator.calls,1);
    assert.equal((await f.turn(message.turn.id)).result?.kind,'change_proposal');
  }finally{await f.close();}
});

test('host action lookup is scoped to immutable turn facts; resolution never creates or cancels a run',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();const run=(await f.request('POST',`/api/v1/projects/${project.id}/runs`,{prompt:'生成',mode:'build'})).data.run;await f.service.tick();
    const message=await f.submit(project.id,'如何分享应用？');await f.service.tickCoordination();
    const request=f.coordinator.entries.get(message.turn.id)!.request;
    const serialized=JSON.stringify(request.context);assert.ok(!serialized.includes('previewUrl'));assert.ok(!serialized.includes('coordination-test-token'));assert.ok(!serialized.includes('http://127.0.0.1'));
    const source=request.context.facts.availableActions.find(a=>a.kind==='source_download')!;
    const descriptor=await f.request('GET',`/api/v2/coordination-turns/${message.turn.id}/actions/${source.id}`);assert.equal(descriptor.status,200);
    const resolved=ResolveActionResponse.parse((await f.request('POST',`/api/v2/coordination-turns/${message.turn.id}/actions/${source.id}/resolve`,{})).data);assert.equal(resolved.resolution.kind,'source_download');
    const preview=request.context.facts.availableActions.find(a=>a.kind==='preview')!;
    const previewResolved=ResolveActionResponse.parse((await f.request('POST',`/api/v2/coordination-turns/${message.turn.id}/actions/${preview.id}/resolve`,{})).data);assert.equal(previewResolved.resolution.kind,'preview');
    assert.equal((await f.request('POST',`/api/v2/coordination-turns/${message.turn.id}/actions/action_guessed/resolve`,{})).status,404);
    assert.equal(f.service.store.state.runs.length,1);assert.equal((await f.request('GET',`/api/v1/runs/${run.id}`)).data.status,'succeeded');
    assert.ok(!JSON.stringify((await f.workspace(project.id)).messages).includes('/p/'));
  }finally{await f.close();}
});

test('host corrects stale status and typed sharing requests without classifying ordinary prose',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();const active=(await f.request('POST',`/api/v1/projects/${project.id}/runs`,{prompt:'[hold]',mode:'build'})).data.run;await f.service.tick();
    f.coordinator.setFactory(request=>({kind:'status',answer:'所有任务已经完成，可以直接使用。',observations:request.context.facts.runs,contextUsed:contextUsedFor(request),references:[],memoryUpdates:[]}));
    const message=await f.submit(project.id,'当前任务进行到哪一步？');await f.service.tickCoordination();
    const snapshot=await f.workspace(project.id);const reply=snapshot.messages.find(m=>m.id===(snapshot.latestCoordinationTurn?.assistantMessageId));
    assert.ok(reply?.content.includes('执行中'));assert.ok(!reply?.content.includes('所有任务已经完成'));
    f.coordinator.setFactory(request=>({...fakeConsult(request),answer:'应用已经公开发布，可以公网访问 https://invented.example/app',references:[{kind:'available_action',actionId:request.context.facts.availableActions.find(a=>a.kind==='deployment_help')!.id}]}));
    const help=await f.request('POST',`/api/v2/projects/${project.id}/messages`,{input:{kind:'sharing_help'},mode:'ask'});assert.equal(help.status,202);await f.service.tickCoordination();
    const latest=await f.workspace(project.id);const sharing=latest.messages.find(m=>m.id===latest.latestCoordinationTurn?.assistantMessageId);
    assert.match(sharing!.content,/公网部署.*尚未完成/);assert.ok(!sharing?.content.includes('invented.example'));
    assert.equal((await f.request('GET',`/api/v1/runs/${active.id}`)).data.status,'running');assert.equal(f.service.store.state.runs.length,1);
  }finally{await f.close();}
});

test('limited cancel_run reuses existing cancellation; ask control remains read-only',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();const active=(await f.request('POST',`/api/v1/projects/${project.id}/runs`,{prompt:'[hold]',mode:'build'})).data.run;await f.service.tick();
    f.coordinator.setFactory(request=>({kind:'control',action:'cancel_run',targetRunId:active.id,expectedRevision:request.context.facts.runs.find(r=>r.id===active.id)!.revision,
      sourceMessageIds:[request.inputMessageId],evidence:[{messageId:request.inputMessageId,quote:request.content}],contextUsed:contextUsedFor(request),references:[{kind:'run',runId:active.id}],memoryUpdates:[]}));
    const ask=await f.submit(project.id,'停止当前生成的任务','ask');await f.service.tickCoordination();const askResult=(await f.turn(ask.turn.id)).result;
    assert.equal(askResult?.kind,'control');if(askResult?.kind==='control')assert.equal(askResult.receipt,'not_applied');
    assert.equal((await f.request('GET',`/api/v1/runs/${active.id}`)).data.status,'running');
    const control=await f.submit(project.id,'停止当前生成的任务');await f.service.tickCoordination();const result=(await f.turn(control.turn.id)).result;
    if(result?.kind!=='control')throw new Error('Expected receipt');assert.equal(result.receipt,'cancellation_requested');
    await f.service.tick();assert.equal((await f.request('GET',`/api/v1/runs/${active.id}`)).data.status,'cancelled');
    assert.equal(f.service.store.state.runs.length,1);assert.equal((await f.request('GET','/api/v1/session')).data.quota.runsUsed,1);
  }finally{await f.close();}
});

test('pending-turn cap, question expiry and dismissed cards do not create execution side effects',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();f.coordinator.setFactory(()=>null);const queued=[];
    for(let i=0;i<5;i++)queued.push(await f.submit(project.id,`排队消息${i}`));
    const sixth=await f.request('POST',`/api/v2/projects/${project.id}/messages`,{input:{kind:'text',content:'第六条'}});assert.equal(sixth.status,429);
    for(const item of queued)await f.request('POST',`/api/v2/coordination-turns/${item.turn.id}/cancel`,{expectedRevision:1});
    assert.equal((await f.request('GET','/api/v2/session')).data.coordinationQuota.reserved,0);assert.equal(f.coordinator.calls,0);
    f.coordinator.setFactory(request=>({kind:'clarify',question:'请选择配色',options:[{id:'option_dark',label:'深色'}],allowText:false,relatedProposalId:null,contextUsed:contextUsedFor(request),references:[],memoryUpdates:[]}));
    const pending=await f.submit(project.id,'配色还没决定');await f.service.tickCoordination();const turn=await f.turn(pending.turn.id);
    if(turn.result?.kind!=='clarify')throw new Error('Expected clarification');const q=f.service.store.state.coordination.clarifications.find(c=>c.id===(turn.result as {clarificationId:string}).clarificationId)!;
    f.service.store.transaction(()=>{q.expiresAt='2020-01-01T00:00:00.000Z';});
    const expired=await f.request('POST',`/api/v2/projects/${project.id}/messages`,{input:{kind:'selection',optionId:'option_dark'},replyTo:{clarificationId:q.id,expectedRevision:q.revision,replyToMessageId:q.questionMessageId}});
    assert.equal(expired.status,409);assert.equal(expired.data.error.code,'CLARIFICATION_EXPIRED');
    assert.equal(f.service.store.state.runs.length,0);
  }finally{await f.close();}
});

test('opening a pre-v2 database imports original messages read-only without resetting quotas or replaying history',async()=>{
  const f=await fixture();try{
    await f.login();const project=await f.project();const run=(await f.request('POST',`/api/v1/projects/${project.id}/runs`,{prompt:'旧系统已有项目',mode:'build'})).data.run;await f.service.tick();
    const before=(await f.request('GET',`/api/v1/projects/${project.id}/workspace`)).data;const quota=(await f.request('GET','/api/v1/session')).data.quota;
    await f.legacyRestart();const after=await f.workspace(project.id);
    assert.deepEqual(after.execution,before);assert.deepEqual((await f.request('GET','/api/v1/session')).data.quota,quota);
    assert.equal(after.messages[0].id,before.messages[0].id);assert.equal(after.messages[0].historySeq,1);assert.equal(f.coordinator.calls,0);
    await f.service.tick();assert.equal(f.runtime.startCalls,1);assert.equal((await f.request('GET',`/api/v1/runs/${run.id}`)).data.status,'succeeded');
  }finally{await f.close();}
});

test('replan-only reflection survives waiting/restart, rejects ordinary answers and requires confirmed stop before one ask/plan draft with zero new Code',async()=>{
 const f=await fixture();try{
  await f.login();const project=await f.project(),goal='完整目标：创建可交互三维场景，保留键盘控制与响应式布局。';
  const admitted=await f.request('POST',`/api/v1/projects/${project.id}/runs`,{prompt:goal,mode:'plan'});assert.equal(admitted.status,202);await f.service.tick();
  let run=(await f.request('GET',`/api/v1/runs/${admitted.data.run.id}`)).data;const execution=f.runtime.executions.get(run.executionId)!;
  // Drive the HTTP Runtime double's event feed; no API database or Agent code is changed.
  const question={id:'attention_replan_fixture',runId:run.id,revision:1,kind:'question' as const,resolution:'replan' as const,title:'修复耗尽，需重新规划',description:'当前冻结方案保留键盘控制，是否需要调整需求？',options:[],allowText:true,createdAt:new Date().toISOString()};
  execution.snapshot={...execution.snapshot,status:'waiting_input',pendingAttention:question,revision:execution.snapshot.revision+1};f.runtime.emit(run.executionId,{type:'attention.created',payload:question});await f.service.tick();run=(await f.request('GET',`/api/v1/runs/${run.id}`)).data;assert.equal(run.pendingAttention.id,question.id);
  const originalRequest=JSON.stringify(execution.request),oldAnswer={attentionId:question.id,expectedRevision:1,answer:{kind:'text',text:'新增自动控制，但保留手动控制。'}};
  const beforeWaiting=await f.workspace(project.id),beforeQuota=(await f.request('GET','/api/v1/session')).data.quota;assert.equal(beforeWaiting.execution.activeRun!.status,'waiting_input');assert.deepEqual(beforeWaiting.execution.activeRun!.pendingAttention,question);const events=(await f.request('GET',`/api/v1/projects/${project.id}/events?after=0&limit=100`)).data.items;assert.ok(events.some((e:any)=>e.event.type==='run.updated'&&e.event.payload.pendingAttention?.resolution==='replan'));await f.restart();await f.service.tick();const restored=await f.workspace(project.id);assert.equal(restored.execution.activeRun!.status,'waiting_input');assert.deepEqual(restored.execution.activeRun!.pendingAttention,question);assert.equal(restored.execution.project.activeRunId,run.id);assert.deepEqual((await f.request('GET','/api/v1/session')).data.quota,beforeQuota);const refused=await f.request('POST',`/api/v1/runs/${run.id}/answers`,oldAnswer);assert.equal(refused.status,409);assert.match(refused.data.error.message,/停止原任务.*重新规划/);assert.equal((await f.request('GET',`/api/v1/runs/${run.id}`)).data.pendingAnswer,null);assert.equal(execution.commands.size,0);assert.equal(f.runtime.startCalls,1);assert.equal((await f.request('GET',`/api/v1/projects/${project.id}/versions`)).data.items.length,0);

  f.service.seedCode('replan-other-owner');await f.login('replan-other-owner');const foreignProject=await f.project();assert.equal((await f.request('POST',`/api/v1/runs/${run.id}/answers`,oldAnswer)).status,404);assert.equal((await f.request('POST',`/api/v1/runs/${run.id}/cancel`,{})).status,404);await f.login();
  const cancelKey=randomUUID(),cancel=await f.request('POST',`/api/v1/runs/${run.id}/cancel`,{},cancelKey);assert.equal(cancel.status,202);assert.equal(cancel.data.run.status,'cancelling');assert.equal((await f.request('POST',`/api/v1/runs/${run.id}/cancel`,{},cancelKey)).data.run.status,'cancelling');assert.equal((await f.request('GET',`/api/v1/projects/${project.id}/workspace`)).data.project.activeRunId,run.id);assert.equal((await f.request('POST',`/api/v1/runs/${run.id}/answers`,oldAnswer)).status,409);assert.equal(f.coordinator.calls,0);
  await f.service.tick();assert.equal((await f.request('GET',`/api/v1/runs/${run.id}`)).data.status,'cancelled');assert.equal((await f.request('GET',`/api/v1/projects/${project.id}/workspace`)).data.project.activeRunId,null);assert.equal(execution.commands.size,0);assert.equal(JSON.stringify(execution.request),originalRequest);
  const answer='新增自动控制，但保留手动控制。',content=`请先重新规划，不构建。\n原完整目标：${goal}\n原Run：${run.id}\n原问题：${question.description}\n我的回答：${answer}`,body={input:{kind:'text',content},mode:'ask',runMode:'plan'},key=randomUUID();f.coordinator.setFactory(fakeChange);
  const sent=await f.request('POST',`/api/v2/projects/${project.id}/messages`,body,key),repeated=await f.request('POST',`/api/v2/projects/${project.id}/messages`,body,key);assert.equal(sent.status,202);assert.equal(repeated.data.turn.id,sent.data.turn.id);assert.equal((await f.request('POST',`/api/v2/projects/${foreignProject.id}/messages`,body,key)).status,404);await f.service.tickCoordination();const turn=await f.turn(sent.data.turn.id);assert.equal(turn.result?.kind,'change_proposal');if(turn.result?.kind!=='change_proposal')throw Error('Missing review proposal');assert.equal(turn.result.runId,null);assert.equal(turn.mode,'ask');assert.equal(turn.runMode,'plan');assert.equal(f.coordinator.calls,1);const request=f.coordinator.entries.get(turn.id)!.request;assert.equal(request.content,content);assert.equal(request.mode,'ask');assert.equal(request.runMode,'plan');const proposal=(await f.request('GET',`/api/v2/proposals/${turn.result.proposalId}`)).data;assert.equal(proposal.goal,content);
  // A late original execution completion cannot publish or restart cancelled work.
  f.runtime.complete(run.executionId);await f.service.tick();assert.equal((await f.request('GET',`/api/v1/runs/${run.id}`)).data.status,'cancelled');assert.equal((await f.request('GET',`/api/v1/projects/${project.id}/versions`)).data.items.length,0);assert.equal(f.runtime.startCalls,1);assert.equal(f.service.store.state.runs.filter(r=>r.dto.projectId===project.id).length,1);const quota=(await f.request('GET','/api/v1/session')).data.quota;assert.equal(quota.runsUsed,1);assert.equal(quota.runsReserved,0);const workspace=await f.workspace(project.id);assert.equal(workspace.messages.filter(m=>m.id===sent.data.userMessage.id).length,1);assert.equal(workspace.messages.find(m=>m.id===sent.data.userMessage.id)!.content,content);
 }finally{await f.close();}
});


test('private per-code conversation limits preserve lifetime usage and history across restart, isolate identities and never override an explicit host cap',async()=>{
 const f=await fixture({defaultLimit:true});try{await f.login();const p=await f.project(),code=f.service.store.state.codes.find(c=>c.hash===hash('coordination-demo-2026'))!;assert.equal((await f.request('GET','/api/v2/session')).data.coordinationQuota.limit,50);f.service.store.transaction(()=>{code.coordinationMessageLimit=2;});for(let i=0;i<2;i++){await f.submit(p.id,'合成只读咨询 '+i,'ask');await f.service.tickCoordination();}assert.equal((await f.request('GET','/api/v2/session')).data.coordinationQuota.used,2);assert.equal((await f.request('POST',`/api/v2/projects/${p.id}/messages`,{input:{kind:'text',content:'不应受理'},mode:'ask'})).status,403);const before=structuredClone(f.service.store.state);f.service.store.transaction(()=>{f.service.store.state.codes.find(c=>c.id===code.id)!.coordinationMessageLimit=52;});await f.restart();const expected=structuredClone(before);expected.codes.find(c=>c.id===code.id)!.coordinationMessageLimit=52;assert.deepEqual(f.service.store.state,expected);const reset=(await f.request('GET','/api/v2/session')).data.coordinationQuota;assert.deepEqual(reset,{limit:52,used:2,reserved:0});assert.equal(reset.limit-reset.used-reset.reserved,50);await f.submit(p.id,'新的咨询仍只增加真实已用量','ask');await f.service.tickCoordination();assert.equal((await f.request('GET','/api/v2/session')).data.coordinationQuota.used,3);
 f.service.seedCode('quota-second-owner');await f.login('quota-second-owner');assert.deepEqual((await f.request('GET','/api/v2/session')).data.coordinationQuota,{limit:50,used:0,reserved:0});for(const invalid of[0,-1,1.5,Number.MAX_SAFE_INTEGER+1]){f.service.store.transaction(()=>{f.service.store.state.codes.find(c=>c.hash===hash('quota-second-owner'))!.coordinationMessageLimit=invalid;});assert.equal((await f.request('GET','/api/v2/session')).status,409);}assert.equal(f.service.store.state.runs.length,0);assert.equal((await f.request('GET','/api/v1/session')).data.quota.runsUsed,0);
 }finally{await f.close();}
 const explicit=await fixture({limit:15});try{await explicit.login();explicit.service.store.transaction(()=>{explicit.service.store.state.codes[0].coordinationMessageLimit=500;});assert.equal((await explicit.request('GET','/api/v2/session')).data.coordinationQuota.limit,15);await explicit.restart();assert.equal((await explicit.request('GET','/api/v2/session')).data.coordinationQuota.limit,15);explicit.service.store.transaction(()=>{explicit.service.store.state.codes[0].coordinationMessageLimit=-1;});assert.equal((await explicit.request('GET','/api/v2/session')).data.coordinationQuota.limit,15);}finally{await explicit.close();}
});
