import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Run} from '../../packages/contracts/src/index.ts';
import {CoordinationWorkspace,CoordinationTurn,ProjectMemoryView,ConversationEventPage,ResolveActionResponse} from '../../packages/contracts/src/conversation.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const real=process.argv.includes('--real');
// Real NLP acceptance is intentionally API + Agent only; UI acceptance remains separate.
const withWeb=!real&&!process.argv.includes('--no-web');
if(real&&process.env.ATOMS_ALLOW_REAL_COORDINATION_INTEGRATION!=='1')throw new Error('Real coordination integration requires explicit ATOMS_ALLOW_REAL_COORDINATION_INTEGRATION=1 authorization.');
if(real&&existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
if(real&&!process.env.DEEPSEEK_API_KEY)throw new Error('Real mode needs a locally configured DEEPSEEK_API_KEY; no fake fallback.');
const directory=await mkdtemp(path.join(os.tmpdir(),'atoms-m1-integration-'));
const children=[];const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
const [apiPort,previewPort,agentPort,webPort]=await Promise.all([freePort(),freePort(),freePort(),freePort()]);
const apiOrigin=`http://localhost:${apiPort}`,agentOrigin=`http://127.0.0.1:${agentPort}`,webOrigin=`http://localhost:${webPort}`;
const token=`integration-${randomUUID()}`;
const env={...process.env,NODE_ENV:'test',DEEPSEEK_API_KEY:real?process.env.DEEPSEEK_API_KEY:'',
  API_PORT:String(apiPort),PREVIEW_PORT:String(previewPort),AGENT_PORT:String(agentPort),WEB_PORT:String(webPort),
  API_DATA_DIR:path.join(directory,'api'),AGENT_DATA_DIR:path.join(directory,'agent'),
  ATOMS_SERVICE_TOKEN:token,INTERNAL_SERVICE_TOKEN:token,AGENT_URL:agentOrigin,API_INTERNAL_URL:`http://127.0.0.1:${apiPort}`,
  PREVIEW_SECRET:randomUUID(),PREVIEW_ORIGIN:`http://127.0.0.1:${previewPort}`,PREVIEW_PUBLIC_URL:`http://127.0.0.1:${previewPort}`,
  ATOMS_ALLOWED_ORIGINS:`${apiOrigin},${webOrigin}`,ALLOWED_ORIGINS:`${apiOrigin},${webOrigin}`,
  ATOMS_ENABLE_DEMO:'true',API_ENABLE_DEMO_SEED:'1',ATOMS_DEMO_CODE:'m1-integration-2026',API_DEMO_CODE:'m1-integration-2026',
  AGENT_MODE:'fake',ATOMS_AGENT_MODE:'fake',COORDINATOR_MODE:real?'dsh':'fake',
  VITE_RUNTIME_MODE:'fake',VITE_COORDINATOR_MODE:real?'dsh':'fake',VITE_API_PROXY_TARGET:`http://127.0.0.1:${apiPort}`};
const redact=value=>env.DEEPSEEK_API_KEY?String(value).split(env.DEEPSEEK_API_KEY).join('[REDACTED]'):String(value);
function start(name){const childEnv={...env};if(name!=='@atoms/agent')delete childEnv.DEEPSEEK_API_KEY;
  if(name==='@atoms/web'){delete childEnv.ATOMS_SERVICE_TOKEN;delete childEnv.INTERNAL_SERVICE_TOKEN;delete childEnv.PREVIEW_SECRET;}
  const args=['--filter',name,name==='@atoms/web'?'dev':'start'];if(name==='@atoms/web')args.push('--port',String(webPort));
  const child=spawn('pnpm',args,{cwd:root,env:childEnv,detached:true,stdio:['ignore','pipe','pipe']});child.output='';child.name=name;
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{child.output=redact(child.output+data).slice(-12000);});children.push(child);return child;}
async function stop(child){child.intentionalStop=true;if(child.exitCode!==null)return;const ended=once(child,'exit').catch(()=>{});
  try{process.kill(-child.pid,'SIGTERM');}catch{}await Promise.race([ended,delay(2500)]);try{process.kill(-child.pid,'SIGKILL');}catch{}}
async function ready(url,headers={}){const deadline=Date.now()+45000;while(Date.now()<deadline){try{const response=await fetch(url,{headers,signal:AbortSignal.timeout(2000)});if(response.status===200||(url.endsWith('/session')&&response.status===401))return;}catch{}
  const dead=children.find(child=>child.exitCode!==null&&!child.intentionalStop);if(dead)throw new Error(`Service stopped: ${dead.name}: ${dead.output}`);await delay(150);}throw new Error(`Not ready: ${url}`);}
let cookie='';let failed=false;
async function request(method,route,body,key=randomUUID()){
  const response=await fetch(apiOrigin+route,{method,headers:{Origin:apiOrigin,'X-Atoms-Coordination-Version':'0.2.0',...(cookie?{Cookie:cookie}:{}),
    ...(method==='GET'?{}:{'Idempotency-Key':key}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const data=response.status===204?null:await response.json();assert.ok(response.ok,`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);return {data,response};}
async function workspace(projectId){return CoordinationWorkspace.parse((await request('GET',`/api/v2/projects/${projectId}/workspace`)).data);}
async function waitTurn(turnId){const deadline=Date.now()+(real?180000:30000);while(Date.now()<deadline){const turn=CoordinationTurn.parse((await request('GET',`/api/v2/coordination-turns/${turnId}`)).data);
  if(turn.status==='completed')return turn;assert.ok(!['failed','interrupted','cancelled'].includes(turn.status),`Turn ${turnId} ${turn.status}: ${JSON.stringify(turn.error)}`);await delay(150);}throw new Error(`Coordination timeout ${turnId}`);}
async function waitRun(runId,status='succeeded'){const deadline=Date.now()+(real?660000:180000);while(Date.now()<deadline){const run=Run.parse((await request('GET',`/api/v1/runs/${runId}`)).data);
  if(run.status===status)return run;assert.ok(!['failed','interrupted','cancelled'].includes(run.status),`Run ${runId} ${run.status}: ${JSON.stringify(run.error)}`);await delay(200);}throw new Error(`Execution timeout ${runId}`);}
async function message(projectId,content,mode='auto',key=randomUUID()){
  const accepted=(await request('POST',`/api/v2/projects/${projectId}/messages`,{input:{kind:'text',content},mode},key)).data;return {accepted,turn:await waitTurn(accepted.turn.id)};}
try{
  let agent=start('@atoms/agent');let api=start('@atoms/api');if(withWeb)start('@atoms/web');
  await ready(agentOrigin+'/internal/v1/health',{Authorization:`Bearer ${token}`,'X-Atoms-Protocol-Version':'0.1.0'});
  await ready(apiOrigin+'/api/v1/session');if(withWeb)await ready(webOrigin);
  console.log(`M1 isolated services ready: ${withWeb?'Web/API/Runtime':'API/Runtime (Web skipped)'}, ${real?'REAL Router (DSH + DeepSeek) + explicit Fake Worker':'explicit FakeRouter/FakeDSH; real compiler/browser checks'}.`);
  const login=await request('POST','/api/v1/sessions',{code:'m1-integration-2026'});cookie=login.response.headers.get('set-cookie')?.split(';')[0]??'';
  const project=(await request('POST','/api/v1/projects',{title:'M1 协调验收'})).data;
  if(real){
    // Six bounded natural-language Router turns; Worker stays explicitly Fake throughout.
    const before=(await request('GET','/api/v1/session')).data.quota;
    const sharing=await message(project.id,'如何分享这个应用给别人？');
    assert.equal(sharing.turn.result.kind,'consult');assert.equal((await workspace(project.id)).execution.latestRun,null);
    assert.deepEqual((await request('GET','/api/v1/session')).data.quota,before);
    console.log('REAL PASS 1/6: natural sharing consultation creates zero Runs and spends zero generation quota.');
    const remembered=await message(project.id,'请记住我的项目偏好：界面使用暖色。这里只保存偏好，不修改应用。','ask');
    let canonicalMemory=ProjectMemoryView.parse((await request('GET',`/api/v2/projects/${project.id}/memory`)).data);
    const warm=canonicalMemory.decisions.find(decision=>decision.status==='active'&&decision.sourceMessageIds.includes(remembered.accepted.userMessage.id));
    assert.ok(warm,'Host canonical memory must record the explicit preference with its actual user-message source');
    assert.match(warm.text,/暖色|warm/i);const warmRevision=canonicalMemory.revision;
    const corrected=await message(project.id,'把刚才记住的界面偏好改成深色，旧的暖色偏好作废。只更新项目记忆，不修改应用代码。','ask');
    canonicalMemory=ProjectMemoryView.parse((await request('GET',`/api/v2/projects/${project.id}/memory`)).data);
    const dark=canonicalMemory.decisions.find(decision=>decision.status==='active'&&decision.sourceMessageIds.includes(corrected.accepted.userMessage.id));
    assert.ok(dark,'Correction must be a source-linked canonical decision');assert.match(dark.text,/深色|暗色|dark/i);
    assert.equal(dark.supersedesDecisionId,warm.id);assert.equal(canonicalMemory.decisions.find(decision=>decision.id===warm.id).status,'superseded');
    assert.ok(canonicalMemory.revision>warmRevision);assert.equal((await workspace(project.id)).execution.latestRun,null);
    console.log('REAL PASS 2-3/6: host memory remembers and supersedes the preference with correct source messages, without a Run.');
    const buildKey=randomUUID();const buildInput={input:{kind:'text',content:'请在这个项目创建一个便签墙，支持新增、编辑便签，并在刷新后保留内容。'},mode:'auto'};
    const accepted=(await request('POST',`/api/v2/projects/${project.id}/messages`,buildInput,buildKey)).data;
    const same=(await request('POST',`/api/v2/projects/${project.id}/messages`,buildInput,buildKey)).data;assert.equal(same.turn.id,accepted.turn.id);
    const change=await waitTurn(accepted.turn.id);assert.equal(change.result.kind,'change_proposal');assert.equal(change.result.admission,'run_queued');
    const built=await waitRun(change.result.runId);let snapshot=await workspace(project.id);
    assert.equal(snapshot.messages.filter(item=>item.id===accepted.userMessage.id).length,1);assert.equal(snapshot.execution.currentVersion.id,built.resultVersionId);
    assert.equal((await fetch(snapshot.execution.currentVersion.previewUrl)).status,200);
    const afterBuild=(await request('GET','/api/v1/session')).data.quota;assert.equal(afterBuild.runsUsed,1);assert.equal(afterBuild.runsReserved,0);
    console.log('REAL PASS 4/6: clear natural change admits exactly one Run; Fake Worker performs actual React compiler/browser checks and publication.');
    const memoryBeforeDiscussion=ProjectMemoryView.parse((await request('GET',`/api/v2/projects/${project.id}/memory`)).data);
    const discussion=await message(project.id,'只讨论：如果以后增加搜索框，大概需要改哪些部分？不要创建任务或修改应用。','ask');
    assert.ok(['consult','change_proposal','clarify'].includes(discussion.turn.result.kind));
    if(discussion.turn.result.kind==='change_proposal')assert.equal(discussion.turn.result.runId,null);
    snapshot=await workspace(project.id);assert.equal(snapshot.execution.latestRun.id,built.id);assert.deepEqual((await request('GET','/api/v1/session')).data.quota,afterBuild);
    assert.deepEqual(ProjectMemoryView.parse((await request('GET',`/api/v2/projects/${project.id}/memory`)).data),memoryBeforeDiscussion);
    console.log('REAL PASS 5/6: ask-mode discussion creates no Run, consumes no generation quota and confirms no inferred decision.');
    const persistedBefore=ProjectMemoryView.parse((await request('GET',`/api/v2/projects/${project.id}/memory`)).data);
    await stop(api);await stop(agent);agent=start('@atoms/agent');api=start('@atoms/api');
    await ready(agentOrigin+'/internal/v1/health',{Authorization:`Bearer ${token}`,'X-Atoms-Protocol-Version':'0.1.0'});await ready(apiOrigin+'/api/v1/session');
    assert.deepEqual(ProjectMemoryView.parse((await request('GET',`/api/v2/projects/${project.id}/memory`)).data),persistedBefore);
    const recall=await message(project.id,'我目前确认的界面配色偏好是什么？请按已保存项目记忆回答，不要修改应用。','ask');assert.equal(recall.turn.result.kind,'consult');
    snapshot=await workspace(project.id);const reply=snapshot.messages.find(item=>item.id===recall.turn.assistantMessageId);assert.match(reply?.content??'',/深色|暗色|dark/i);
    assert.deepEqual(ProjectMemoryView.parse((await request('GET',`/api/v2/projects/${project.id}/memory`)).data),persistedBefore);
    assert.equal(snapshot.execution.latestRun.id,built.id);
    console.log('REAL PASS 6/6: API + Agent restart preserves corrected canonical decisions; Router recalls the active preference without writing.');
    console.log('M1 REAL Router sample passed with Fake Worker. Six natural-language coordination turns, at most 3 observable model steps/turn (18-step configured total); no arbitrary NLP accuracy, absolute cost cap, real-code G4 or M2/M3 claim.');
  }else{
  const consult=await message(project.id,'如何分享这个应用给别人？');assert.equal(consult.turn.result.kind,'consult');
  assert.equal((await workspace(project.id)).execution.latestRun,null);assert.equal((await request('GET','/api/v1/session')).data.quota.runsUsed,0);
  console.log('PASS: natural-language sharing consultation creates no Run and spends no generation quota.');
  await message(project.id,'记住我的偏好：界面使用暖色','ask');
  let memory=ProjectMemoryView.parse((await request('GET',`/api/v2/projects/${project.id}/memory`)).data);
  assert.ok(memory.decisions.some(decision=>decision.status==='active'&&decision.text.includes('暖色')));
  const key=randomUUID();const input={input:{kind:'text',content:'创建一个支持新增、编辑和本地保存的便签墙'},mode:'auto'};
  const first=(await request('POST',`/api/v2/projects/${project.id}/messages`,input,key)).data;
  assert.equal((await request('POST',`/api/v2/projects/${project.id}/messages`,input,key)).data.turn.id,first.turn.id);
  const change=await waitTurn(first.turn.id);assert.equal(change.result.kind,'change_proposal');assert.equal(change.result.admission,'run_queued');
  const built=await waitRun(change.result.runId);let snapshot=await workspace(project.id);
  assert.equal(snapshot.messages.filter(item=>item.id===first.userMessage.id).length,1);assert.equal(snapshot.execution.currentVersion.id,built.resultVersionId);
  assert.equal((await fetch(snapshot.execution.currentVersion.previewUrl)).status,200);
  console.log('PASS: auto clear change admits one Run, original message is reused, actual React artifact is published.');
  const ask=await message(project.id,'增加搜索框','ask');assert.equal(ask.turn.result.kind,'change_proposal');assert.equal(ask.turn.result.runId,null);
  const status=(await request('POST',`/api/v2/projects/${project.id}/messages`,{input:{kind:'status',targetRunId:built.id}})).data;
  const observed=await waitTurn(status.turn.id);assert.equal(observed.result.kind,'status');assert.equal(observed.result.observations[0].status,'succeeded');
  const shareAfterBuild=await message(project.id,'如何分享这个应用给别人？');assert.equal(shareAfterBuild.turn.result.kind,'consult');
  const actionRef=shareAfterBuild.turn.result.references.find(ref=>ref.kind==='available_action');
  if(actionRef){await request('GET',`/api/v2/coordination-turns/${shareAfterBuild.turn.id}/actions/${actionRef.actionId}`);
    ResolveActionResponse.parse((await request('POST',`/api/v2/coordination-turns/${shareAfterBuild.turn.id}/actions/${actionRef.actionId}/resolve`,{})).data);}
  console.log('PASS: ask proposal stays read-only, host formats current status, action references resolve without writing.');
  const unclear=await message(project.id,real?'我还没决定要说明如何分享还是给应用增加入口，请先问我选哪一个，不要构建。':'帮我处理分享');
  assert.equal(unclear.turn.result.kind,'clarify');const question=(await request('GET',`/api/v2/clarifications/${unclear.turn.result.clarificationId}`)).data;
  const option=question.options.find(option=>option.label.includes('说明'))??question.options[0];assert.ok(option,'Expected a selectable clarification');
  const answer=(await request('POST',`/api/v2/projects/${project.id}/messages`,{input:{kind:'selection',optionId:option.id},mode:'ask',replyTo:{clarificationId:question.id,expectedRevision:question.revision,replyToMessageId:question.questionMessageId}})).data;
  const continued=await waitTurn(answer.turn.id);assert.ok(['consult','status','change_proposal'].includes(continued.result.kind));
  assert.equal((await request('GET',`/api/v2/clarifications/${question.id}`)).data.status,'answered');
  assert.equal((await request('GET','/api/v1/session')).data.quota.runsUsed,1);
  console.log('PASS: message clarification completes independently and typed bound answer resumes without unintended generation.');
  if(!real){
    const ordinary=(await request('POST',`/api/v1/projects/${project.id}/runs`,{prompt:'创建便签墙 [question]',mode:'build'})).data.run;
    const waiting=await waitRun(ordinary.id,'waiting_input');assert.equal(waiting.pendingAttention.kind,'question');
    const question=waiting.pendingAttention;
    await request('POST',`/api/v1/runs/${ordinary.id}/answers`,{attentionId:question.id,expectedRevision:question.revision,
      answer:question.options.length?{kind:'select',optionId:question.options[0].id}:{kind:'text',text:'保留暖色'}});
    await waitRun(ordinary.id);
    const fresh=(await request('POST',`/api/v2/proposals/${ask.turn.result.proposalId}/refresh`,{expectedRevision:(await request('GET',`/api/v2/proposals/${ask.turn.result.proposalId}`)).data.revision})).data;
    const refreshed=await waitTurn(fresh.turn.id);assert.equal(refreshed.result.kind,'change_proposal');assert.equal(refreshed.result.runId,null);
    const exact=(await request('GET',`/api/v2/proposals/${refreshed.result.proposalId}`)).data;assert.equal(exact.basePolicy.kind,'exact_version');
    snapshot=await workspace(project.id);
    const restored=(await request('POST',`/api/v1/projects/${project.id}/restore`,{versionId:snapshot.execution.currentVersion.id,expectedProjectRevision:snapshot.execution.project.revision})).data;
    assert.notEqual(restored.version.id,exact.basePolicy.expectedBaseVersionId);
    const conflict=await fetch(apiOrigin+`/api/v2/proposals/${exact.id}/accept`,{method:'POST',headers:{Cookie:cookie,Origin:apiOrigin,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({expectedRevision:exact.revision,runMode:'build'})});assert.equal(conflict.status,409);
    console.log('PASS: ordinary Run question uses original answers; exact refreshed proposal rejects stale base without a Worker.');
  }
  await stop(api);await stop(agent);agent=start('@atoms/agent');api=start('@atoms/api');
  await ready(agentOrigin+'/internal/v1/health',{Authorization:`Bearer ${token}`,'X-Atoms-Protocol-Version':'0.1.0'});await ready(apiOrigin+'/api/v1/session');
  const recalled=await message(project.id,'我的偏好是什么？','ask');assert.equal(recalled.turn.result.kind,'consult');
  snapshot=await workspace(project.id);const recallReply=snapshot.messages.find(item=>item.id===recalled.turn.assistantMessageId);
  assert.ok(recallReply?.content.includes('暖色'));memory=ProjectMemoryView.parse((await request('GET',`/api/v2/projects/${project.id}/memory`)).data);assert.ok(memory.revision>=1);
  let after=0;while(true){const page=ConversationEventPage.parse((await request('GET',`/api/v2/projects/${project.id}/conversation-events?after=${after}&limit=7`)).data);
    for(const event of page.items)assert.equal(event.seq,++after);assert.equal(page.nextCursor,after);if(!page.hasMore)break;}
  assert.equal(after,snapshot.conversationEventCursor);
  console.log('PASS: API + Router restart preserves decisions, original dialogue and independent ordered coordination replay.');
  console.log(real?'M1 REAL coordination sample passed; no claim of arbitrary intent accuracy or M2/M3 completion.':
    `M1 Fake integration passed with actual ${withWeb?'Web/API/Runtime':'API/Runtime (Web skipped)'} HTTP and real React compiler/browser smoke; no model inference.`);
  }
}catch(error){failed=true;for(const child of children)console.error(`${child.name} output:\n${redact(child.output)}`);throw error;}
finally{await Promise.all(children.map(stop));if(failed||process.env.ATOMS_KEEP_TEST_DATA==='1')console.log(`M1 diagnostic data retained: ${directory}`);else await rm(directory,{recursive:true,force:true});}
