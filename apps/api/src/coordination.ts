import * as Q from '@atoms/contracts/requirements';
import type {registerRequirements} from './requirements.js';
import * as D from '@atoms/contracts/delivery';
import type {registerDelivery} from './delivery.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CoordinationProtocolVersion as VERSION, COORDINATION_DEFAULTS as DEFAULTS, SubmitMessageRequest,
  ExpectedCoordinationRevision, AcceptProposalRequest, RefreshProposalRequest, CoordinationBudget,
  CoordinationWorkspace, CoordinationTurn, ConversationMessage, StartCoordinationRequest,
  CoordinationSourceEventPage, CoordinationExecutionSnapshot, RouterResult,
  ResolveActionRequest,ResolveActionResponse,TurnActionDescriptor,
  type CoordinationTurnDto, type ConversationMessageDto, type ConversationEventDto, type RouterResultDto,
  type StartCoordinationRequestDto, type ChangeProposalDto, type ClarificationDto,
  type ProjectMemoryViewDto, type ProjectDecisionDto,
} from '@atoms/contracts/conversation';
import type { RunDto, WorkspaceSnapshotDto } from '@atoms/contracts';
import type { Store, SessionRecord, ProjectRecord, RunRecord, VersionRecord, MessageRecord, CoordinationRecord } from './store.js';

type Result = {status:number;body?:unknown;cookie?:string};
type NewRunOptions = {sourceMessageId:string;originTurnId:string;proposalId:string;exactBaseVersionId?:string|null};
export interface CoordinationHost {
  requirements?:ReturnType<typeof registerRequirements>;app:FastifyInstance; store:Store; agentUrl:string; serviceToken:string;
  codeActive?:(id:string)=>boolean;canDispatch?:()=>Promise<boolean>;deploymentFacts?:()=>StartCoordinationRequestDto['context']['facts']['deployment'];messageLimit?:number; messagesPerMinute?:number;delivery?:ReturnType<typeof registerDelivery>;
  id:(prefix:string)=>string; now:()=>string; hash:(input:string|Uint8Array)=>string; canonical:(value:unknown)=>string;
  fail:(status:number,code:string,message:string)=>never;
  authorize:(request:FastifyRequest)=>SessionRecord;
  ownProject:(id:string,session:SessionRecord)=>ProjectRecord;
  ownRun:(id:string,session:SessionRecord)=>RunRecord;
  mutation:(request:FastifyRequest,reply:FastifyReply,actor:string,fn:()=>Result)=>unknown;
  sessionDto:(session:SessionRecord)=>unknown;
  workspace:(projectId:string)=>WorkspaceSnapshotDto;
  versionInfo:(record:VersionRecord)=>VersionRecord['dto'];
  emitMessage:(message:MessageRecord)=>void;
  createRun:(projectId:string,prompt:string,mode:'build'|'plan',codeId:string,options:NewRunOptions)=>RunRecord;
  cancelRun:(record:RunRecord)=>void;
}
const terminal = (status:string)=>['completed','failed','cancelled','interrupted'].includes(status);
const runTerminal = (status:string)=>['succeeded','failed','cancelled','interrupted'].includes(status);

export function registerCoordination(host:CoordinationHost) {
  const {app,store,id,now,fail}=host;
  const state=()=>store.state.coordination;
  const deploymentFacts=()=>host.deploymentFacts?.()??{scope:'local_only' as const,publicDeployment:false};
  const deploymentHelp=()=>deploymentFacts().publicDeployment?'宿主已配置临时公网分享入口。应用版本链接需点击分享按钮即时获取；创作入口仍需体验码。临时地址不保证长期可用，外部验收状态以分享卡回执为准。':deploymentFacts().scope==='unavailable'?'公开入口暂未就绪，当前没有可用公网分享链接。稍后由宿主恢复，不会因此创建任务。':'当前服务仅在本机运行，公网部署和分享验收尚未完成。可下载源码后自行部署；本机预览不是他人可访问的公网链接。';
  let busy=false; let closing=false;
  const coordEvent=(projectId:string,turnId:string|null,event:ConversationEventDto['event'],occurredAt=now())=>{
    const seq=state().events.filter(e=>e.projectId===projectId).at(-1)?.seq??0;
    state().events.push({protocolVersion:VERSION,projectId,turnId,seq:seq+1,occurredAt,event:structuredClone(event)});
  };
  const mirror=(message:MessageRecord,at=now(),metadata?:Partial<Pick<ConversationMessageDto,'actor'|'coordinationTurnId'|'replyToMessageId'>>)=>{
    const previous=state().messages.find(m=>m.id===message.id);
    const base={...message,actor:metadata?.actor??previous?.actor??(message.role==='user'?'user':'legacy_assistant'),
      coordinationTurnId:metadata?.coordinationTurnId??previous?.coordinationTurnId??null,
      replyToMessageId:metadata?.replyToMessageId??previous?.replyToMessageId??null};
    if(previous&&['runId','content','status','actor','coordinationTurnId','replyToMessageId'].every(key=>
      (previous as unknown as Record<string,unknown>)[key]===(base as unknown as Record<string,unknown>)[key])) return previous;
    const dto=ConversationMessage.parse({...base,historySeq:previous?.historySeq??((state().messages.filter(m=>m.projectId===message.projectId).at(-1)?.historySeq??0)+1),
      revision:(previous?.revision??0)+1,updatedAt:at});
    if(previous) state().messages[state().messages.indexOf(previous)]=dto; else {
      state().messages.push(dto);
      if(dto.role==='user') state().revisions[dto.projectId]=(state().revisions[dto.projectId]??0)+1;
    }
    coordEvent(dto.projectId,dto.coordinationTurnId,{type:'message.upserted',payload:dto},at);return dto;
  };
  // Legacy import is a deterministic, additive projection, never inference or execution.
  store.transaction(()=>{for(const message of store.state.messages) mirror(message,message.createdAt);});
  const putMessage=(projectId:string,turnId:string|null,content:string,role:'user'|'assistant',messageId=id('message'),replyTo:string|null=null,occurredAt=now())=>{
    const previous=store.state.messages.find(m=>m.id===messageId);
    const message:MessageRecord={id:messageId,projectId,runId:previous?.runId??null,role,status:'complete',content,createdAt:previous?.createdAt??occurredAt};
    if(previous) store.state.messages[store.state.messages.indexOf(previous)]=message; else store.state.messages.push(message);
    const dto=mirror(message,occurredAt,{actor:role==='user'?'user':'coordinator',coordinationTurnId:turnId,replyToMessageId:replyTo});
    host.emitMessage(message);return dto;
  };
  const updateTurn=(record:CoordinationRecord,changes:Partial<CoordinationTurnDto>)=>{
    record.dto=CoordinationTurn.parse({...record.dto,...changes,revision:record.dto.revision+1,updatedAt:now()});
    coordEvent(record.dto.projectId,record.dto.id,{type:'turn.updated',payload:record.dto});
  };
  const memory=(projectId:string):ProjectMemoryViewDto=>state().memories.find(m=>m.projectId===projectId)??{
    projectId,revision:0,decisions:[],summary:'',summaryThroughConversationRevision:0,updatedAt:store.state.projects.find(p=>p.dto.id===projectId)?.dto.createdAt??now(),
  };
  const quota=(codeId:string)=>{
    const turns=state().turns.filter(t=>t.codeId===codeId);
    return {limit:host.messageLimit??DEFAULTS.messageLimit,reserved:turns.filter(t=>!t.started&&!terminal(t.dto.status)).length,used:turns.filter(t=>t.started).length};
  };
  const ownedTurn=(request:FastifyRequest)=>{
    const session=host.authorize(request);const turn=state().turns.find(t=>t.dto.id===String((request.params as {turnId:string}).turnId)&&t.codeId===session.codeId);
    if(!turn)fail(404,'NOT_FOUND','消息处理不存在或不可访问');return {session,record:turn!};
  };
  const ownProposal=(proposalId:string,session:SessionRecord)=>{
    const value=state().proposals.find(p=>p.id===proposalId);if(!value)fail(404,'NOT_FOUND','提案不存在或不可访问');
    host.ownProject(value!.projectId,session);return value!;
  };
  const ownQuestion=(questionId:string,session:SessionRecord)=>{
    const value=state().clarifications.find(p=>p.id===questionId);if(!value)fail(404,'NOT_FOUND','问题不存在或不可访问');
    host.ownProject(value!.projectId,session);return value!;
  };
  const turnSource=(turn:CoordinationRecord)=>store.state.messages.find(m=>m.id===turn.dto.userMessageId&&m.projectId===turn.dto.projectId)!;
  const createTurn=(project:ProjectRecord,codeId:string,content:string,mode:'auto'|'ask'|'build',runMode:'build'|'plan',
    operation:StartCoordinationRequestDto['operation'],options:{replyTo?:StartCoordinationRequestDto['replyTo'];continuationOfTurnId?:string;retryOfTurnId?:string;reuseMessageId?:string;contextVersionId?:string|null;requirementsReview?:ReturnType<typeof Q.RequirementSnapshotRef.parse>}={})=>{
    const q=quota(codeId);if(q.reserved+q.used>=q.limit)fail(403,'COORDINATION_QUOTA_EXCEEDED','项目对话额度已用完；生成额度独立计算');
    const pending=state().turns.filter(t=>t.dto.projectId===project.dto.id&&!terminal(t.dto.status));
    if(pending.length>=DEFAULTS.maxPendingTurnsPerProject)fail(429,'RATE_LIMITED','本项目待处理消息过多，请稍后再试');
    const recent=state().turns.filter(t=>t.codeId===codeId&&Date.parse(t.dto.createdAt)>Date.now()-60000).length;
    if(recent>=(host.messagesPerMinute??DEFAULTS.messagesPerMinute))fail(429,'RATE_LIMITED','消息提交过于频繁');
    const turnId=id('turn');
    const message=options.reuseMessageId?state().messages.find(m=>m.id===options.reuseMessageId)!:
      putMessage(project.dto.id,turnId,content,'user',id('message'),options.replyTo?.replyToMessageId??null);
    const record:CoordinationRecord={dto:CoordinationTurn.parse({id:turnId,projectId:project.dto.id,revision:1,userMessageId:message.id,
      assistantMessageId:null,mode,runMode,status:'queued',contextVersionId:options.contextVersionId===undefined?project.dto.currentVersionId:options.contextVersionId,
      contextRevisionUsed:project.dto.revision,memoryRevisionUsed:memory(project.dto.id).revision,conversationRevisionUsed:state().revisions[project.dto.id]??0,
      result:null,error:null,continuationOfTurnId:options.continuationOfTurnId??null,retryOfTurnId:options.retryOfTurnId??null,
      createdAt:now(),startedAt:null,completedAt:null,updatedAt:now()}),codeId,operation,inputContent:content,replyTo:options.replyTo,sourceSeq:0,started:false,
      requestedContextVersionId:options.contextVersionId,...(options.requirementsReview?{requirementsReview:options.requirementsReview}:{})};
    state().turns.push(record);coordEvent(project.dto.id,turnId,{type:'turn.updated',payload:record.dto});return {userMessage:message,turn:record.dto};
  };
  const response=(request:FastifyRequest,reply:FastifyReply,session:SessionRecord,fn:()=>Result)=>host.mutation(request,reply,session.id,fn);
  const base='/api/v2';
  app.addHook('onRequest',async(request,reply)=>{
    if(request.url.startsWith(base+'/')){
      reply.header('X-Atoms-Coordination-Version',VERSION);
      const version=request.headers['x-atoms-coordination-version'];
      if(version!==undefined&&version!==VERSION)fail(400,'INVALID_REQUEST','Unsupported coordination protocol version');
    }
  });
  app.get(base+'/session',request=>{const session=host.authorize(request);return {session:host.sessionDto(session),coordinationQuota:quota(session.codeId)};});
  app.post(base+'/projects/:projectId/messages',(request,reply)=>{
    const session=host.authorize(request);const project=host.ownProject(String((request.params as {projectId:string}).projectId),session);
    const body=SubmitMessageRequest.parse(request.body);
    return response(request,reply,session,()=>{
      const requestedVersion=body.contextVersionId===undefined&&body.input.kind==='sharing_help'?body.input.contextVersionId:body.contextVersionId;
      if(requestedVersion){const version=store.state.versions.find(v=>v.dto.id===requestedVersion&&v.dto.projectId===project.dto.id);if(!version)fail(404,'NOT_FOUND','上下文版本不可访问');}
      let operation:StartCoordinationRequestDto['operation']={kind:'message',input:body.input};
      let content=body.input.kind==='text'?body.input.content:body.input.kind==='status'?'查看项目任务状态':body.input.kind==='sharing_help'?'如何分享这个应用？':'';
      let question:ClarificationDto|undefined;
      if(body.replyTo){
        question=ownQuestion(body.replyTo.clarificationId,session);
        if(Date.parse(question.expiresAt)<=Date.now())fail(409,'CLARIFICATION_EXPIRED','问题已过期，请重新说明需求');
        if(question.projectId!==project.dto.id||question.status!=='open'||question.revision!==body.replyTo.expectedRevision||question.questionMessageId!==body.replyTo.replyToMessageId)fail(409,'STALE_REVISION','问题已回答、已更新或不属于当前上下文');
        const input=body.input;let answer:Extract<StartCoordinationRequestDto['operation'],{kind:'clarification_answer'}>['answer'];
        if(input.kind==='selection'){
          const option=question.options.find(o=>o.id===input.optionId);if(!option)fail(400,'INVALID_REQUEST','选项与当前问题不匹配');
          content=option!.label;answer={kind:'selection',optionId:option!.id,label:option!.label};
        }else if(input.kind==='text'&&question.allowText){content=input.content;answer={kind:'text',content};}
        else return fail(400,'INVALID_REQUEST','当前问题不接受此类回答');
        operation={kind:'clarification_answer',questionSnapshot:structuredClone(question),relatedProposal:question.relatedProposalId?state().proposals.find(p=>p.id===question!.relatedProposalId)??null:null,
          answerMessageId:'message_placeholder',answer};
      }
      if(body.input.kind==='status'&&body.input.targetRunId){const target=host.ownRun(body.input.targetRunId,session);if(target.dto.projectId!==project.dto.id)fail(404,'NOT_FOUND','任务不属于当前项目');}
      const created=createTurn(project,session.codeId,content,body.mode,body.runMode,operation,{replyTo:body.replyTo,continuationOfTurnId:question?.originatingTurnId,contextVersionId:requestedVersion});
      if(question){
        const record=state().turns.find(t=>t.dto.id===created.turn.id)!;
        if(record.operation.kind==='clarification_answer')record.operation.answerMessageId=created.userMessage.id;
        question.status='answered';question.answerMessageId=created.userMessage.id;question.continuationTurnId=created.turn.id;question.revision++;question.updatedAt=now();
        coordEvent(project.dto.id,created.turn.id,{type:'clarification.updated',payload:question});
      }
      return {status:202,body:created};
    });
  });
  app.get(base+'/coordination-turns/:turnId',request=>ownedTurn(request).record.dto);
  const boundAction=(request:FastifyRequest)=>{
    const {session,record}=ownedTurn(request);const actionId=String((request.params as {actionId:string}).actionId);
    const action=record.request?.context.facts.availableActions.find(a=>a.id===actionId);
    if(!action)fail(404,'NOT_FOUND','该消息没有此宿主操作引用');return {session,record,action:action!};
  };
  app.get(base+'/coordination-turns/:turnId/actions/:actionId',request=>{
    const {record,action}=boundAction(request);
    const labels={source_download:'下载源码',preview:'打开预览',view_run:'查看任务',cancel_run:'停止指定任务',deployment_help:'查看分享与部署说明'};
    return TurnActionDescriptor.parse({...action,turnId:record.dto.id,label:labels[action.kind]});
  });
  app.post(base+'/coordination-turns/:turnId/actions/:actionId/resolve',(request,reply)=>{
    const {session,record,action}=boundAction(request);ResolveActionRequest.parse(request.body);
    return response(request,reply,session,()=>{
      if(!action.available)fail(409,'CONFLICT','该操作目前不可用');
      let resolution:unknown;
      if(action.kind==='preview'||action.kind==='source_download'){
        const version=store.state.versions.find(v=>v.dto.id===action.versionId&&v.dto.projectId===record.dto.projectId);
        if(!version)fail(409,'CONFLICT','引用的版本已不可用');
        if(action.kind==='preview'){const dto=host.versionInfo(version!);resolution={kind:'preview',versionId:dto.id,url:dto.previewUrl,expiresAt:dto.previewExpiresAt};}
        else resolution={kind:'source_download',versionId:version!.dto.id,path:`/api/v1/versions/${version!.dto.id}/source.zip`};
      }else if(action.kind==='view_run'||action.kind==='cancel_run'){
        const target=host.ownRun(action.runId??'',session);if(target.dto.projectId!==record.dto.projectId)fail(404,'NOT_FOUND','任务不可访问');
        if(action.kind==='cancel_run'){
          if(runTerminal(target.dto.status))fail(409,'CONFLICT','任务已结束，不需要停止');
          resolution={kind:'cancel_run',runId:target.dto.id,expectedRevision:target.dto.revision,requiresExplicitAction:true};
        }else resolution={kind:'view_run',runId:target.dto.id};
      }else resolution={kind:'deployment_help',message:deploymentHelp()};
      return {status:200,body:ResolveActionResponse.parse({turnId:record.dto.id,actionId:action.id,resolution})};
    });
  });
  app.post(base+'/coordination-turns/:turnId/cancel',(request,reply)=>{
    const {session,record}=ownedTurn(request);const body=ExpectedCoordinationRevision.parse(request.body);
    return response(request,reply,session,()=>{
      const outcome=record.dto.result;
      if(outcome?.kind==='change_proposal'&&outcome.runId){return {status:200,body:{turn:record.dto,disposition:'already_dispatched',run:host.ownRun(outcome.runId,session).dto}};}
      if(record.dto.status==='completed')return {status:200,body:{turn:record.dto,disposition:'already_completed',run:null}};
      if(record.dto.status==='cancelled')return {status:200,body:{turn:record.dto,disposition:'cancelled',run:null}};
      if(record.dto.revision!==body.expectedRevision)fail(409,'STALE_REVISION','消息处理状态已变化');
      if(terminal(record.dto.status))return {status:200,body:{turn:record.dto,disposition:'already_completed',run:null}};
      if(!record.request){updateTurn(record,{status:'cancelled',completedAt:now()});return {status:200,body:{turn:record.dto,disposition:'cancelled',run:null}};}
      record.cancelCommand??={commandId:id('command')};updateTurn(record,{status:'cancelling'});
      return {status:202,body:{turn:record.dto,disposition:'cancellation_requested',run:null}};
    });
  });
  app.post(base+'/coordination-turns/:turnId/retry',(request,reply)=>{
    const {session,record}=ownedTurn(request);const body=ExpectedCoordinationRevision.parse(request.body);
    return response(request,reply,session,()=>{
      if(record.dto.revision!==body.expectedRevision||!['failed','interrupted','cancelled'].includes(record.dto.status))fail(409,'CONFLICT','只有失败、中断或取消的协调可显式重试');
      const project=host.ownProject(record.dto.projectId,session);
      return {status:202,body:createTurn(project,session.codeId,record.inputContent,record.dto.mode,record.dto.runMode,structuredClone(record.operation),
        {reuseMessageId:record.dto.userMessageId,replyTo:record.replyTo,continuationOfTurnId:record.dto.continuationOfTurnId??undefined,retryOfTurnId:record.dto.id,contextVersionId:record.requestedContextVersionId})};
    });
  });
  const readEntity=(kind:'proposals'|'clarifications',key:string)=>(request:FastifyRequest)=>{
    const session=host.authorize(request);const entityId=String((request.params as Record<string,string>)[key]);
    return kind==='proposals'?ownProposal(entityId,session):ownQuestion(entityId,session);
  };
  app.get(base+'/proposals/:proposalId',readEntity('proposals','proposalId'));
  app.get(base+'/clarifications/:clarificationId',readEntity('clarifications','clarificationId'));
  for(const kind of ['proposals','clarifications'] as const)app.post(base+`/${kind}/:entityId/dismiss`,(request,reply)=>{
    const session=host.authorize(request);const body=ExpectedCoordinationRevision.parse(request.body);
    const entity=kind==='proposals'?ownProposal(String((request.params as {entityId:string}).entityId),session):ownQuestion(String((request.params as {entityId:string}).entityId),session);
    return response(request,reply,session,()=>{
      if(entity.revision!==body.expectedRevision||entity.status!=='open')fail(409,'STALE_REVISION','卡片已变化');
      entity.status='dismissed';entity.revision++;entity.updatedAt=now();
      if(kind==='proposals')coordEvent(entity.projectId,null,{type:'proposal.updated',payload:entity as ChangeProposalDto});
      else coordEvent(entity.projectId,null,{type:'clarification.updated',payload:entity as ClarificationDto});
      return {status:200,body:kind==='proposals'?{proposal:entity}:{clarification:entity}};
    });
  });
  app.post(base+'/proposals/:proposalId/refresh',(request,reply)=>{
    const session=host.authorize(request);const body=RefreshProposalRequest.parse(request.body);const proposal=ownProposal(String((request.params as {proposalId:string}).proposalId),session);
    return response(request,reply,session,()=>{
      if(proposal.revision!==body.expectedRevision)fail(409,'STALE_REVISION','提案已变化');
      if(proposal.status==='accepted'||proposal.status==='dismissed')fail(409,'CONFLICT','该提案不能重新评估');
      const project=host.ownProject(proposal.projectId,session);
      return {status:202,body:createTurn(project,session.codeId,'基于最新版本重新整理这项提案。','ask',host.requirements?'plan':'build',
        {kind:'proposal_refresh',proposalId:proposal.id,expectedRevision:proposal.revision,forceProposalOnly:true},host.requirements?{requirementsReview:(()=>{const s=host.requirements!.snapshot(project.dto.id);return{id:s.id,hash:s.hash,revision:s.revision};})()}:undefined)};
    });
  });
  const acceptedGoal=(proposal:ChangeProposalDto,record:CoordinationRecord,runId:string,actorSessionId:string|null)=>{
    if(state().proposalConfirmations.some(receipt=>receipt.proposalId===proposal.id))return;
    const confirmedAt=now();
    state().proposalConfirmations.push({proposalId:proposal.id,runId,actorSessionId,kind:actorSessionId?'explicit_accept':'auto_clear',confirmedAt,proposalRevision:proposal.revision});
    let view=state().memories.find(m=>m.projectId===proposal.projectId);if(!view){view=structuredClone(memory(proposal.projectId));state().memories.push(view);}
    // Host-confirmed scope, not the model's unaccepted memory prose; no invented user message.
    view.decisions.push({id:id('decision'),projectId:proposal.projectId,revision:1,kind:'goal',text:proposal.goal,status:'active',
      sourceTurnId:record.dto.id,sourceMessageIds:proposal.sourceMessageIds,sourceProposalId:proposal.id,sourceClarificationId:record.replyTo?.clarificationId??null,
      supersedesDecisionId:null,confirmedAt,createdAt:confirmedAt,updatedAt:confirmedAt});
    view.revision++;view.summary=view.decisions.filter(d=>d.status==='active').map(d=>`${d.kind}: ${d.text}`).join('\n');
    view.summaryThroughConversationRevision=state().revisions[proposal.projectId]??0;view.updatedAt=confirmedAt;
  };
  const accept=(proposal:ChangeProposalDto,record:CoordinationRecord,runMode:'build'|'plan',actorSessionId:string|null=null,reviewedComplete=false)=>{
    if(proposal.acceptedRunId)return store.state.runs.find(r=>r.dto.id===proposal.acceptedRunId)!;
    const project=store.state.projects.find(p=>p.dto.id===proposal.projectId)!;if(!reviewedComplete&&host.requirements&&(host.requirements.needsReview(proposal.id)||!host.requirements.summaryFor(proposal.id)&&host.requirements.legacyBlocked(proposal.projectId)))fail(409,'CONFLICT','请通过完整需求审阅入口确认，不可只接受最后一项补充');
    const code=store.state.codes.find(c=>c.id===record.codeId);
    if(!code||code.revoked||Date.parse(code.expiresAt)<=Date.now())fail(403,'FORBIDDEN','体验权限已失效');
    if(Date.parse(proposal.expiresAt)<=Date.now())fail(409,'PROPOSAL_EXPIRED','提案已过期，请刷新后确认');
    if(proposal.status!=='open')fail(409,'CONFLICT','提案不可执行，请刷新');
    if(proposal.basePolicy.kind==='exact_version'&&project.dto.currentVersionId!==proposal.basePolicy.expectedBaseVersionId)fail(409,'CONFLICT','提案版本已变化，请刷新后重新确认');
    let run:RunRecord;
    try{run=host.createRun(project.dto.id,proposal.goal+'\n验收：'+proposal.acceptance.map(a=>a.description).join('；'),runMode,record.codeId,
      {sourceMessageId:record.dto.userMessageId,originTurnId:record.dto.id,proposalId:proposal.id,
        ...(proposal.basePolicy.kind==='exact_version'?{exactBaseVersionId:proposal.basePolicy.expectedBaseVersionId}:{})});}
    catch(error){if((error as {code?:string}).code==='QUOTA_EXCEEDED')fail(403,'GENERATION_QUOTA_EXCEEDED','生成额度已用完；项目对话额度独立计算');throw error;}
    acceptedGoal(proposal,record,run.dto.id,actorSessionId);
    proposal.status='accepted';proposal.acceptedRunId=run.dto.id;proposal.revision++;proposal.updatedAt=now();proposal.lastAdmissionError=null;
    host.requirements?.confirm(proposal,run);coordEvent(proposal.projectId,record.dto.id,{type:'proposal.updated',payload:proposal});return run;
  };
  app.post(base+'/proposals/:proposalId/accept',(request,reply)=>{
    const session=host.authorize(request);const body=AcceptProposalRequest.parse(request.body);const proposal=ownProposal(String((request.params as {proposalId:string}).proposalId),session);
    return response(request,reply,session,()=>{
      if(proposal.acceptedRunId)return {status:200,body:{proposal,run:host.ownRun(proposal.acceptedRunId,session).dto}};
      if(proposal.revision!==body.expectedRevision)fail(409,'STALE_REVISION','提案已变化');
      const record=state().turns.find(t=>t.dto.id===proposal.originatingTurnId)!;
      const run=accept(proposal,record,body.runMode,session.id);return {status:202,body:{proposal,run:run.dto}};
    });
  });

  app.get(base+'/projects/:projectId/memory',request=>{const project=host.ownProject(String((request.params as {projectId:string}).projectId),host.authorize(request));return memory(project.dto.id);});
  app.get(base+'/projects/:projectId/messages',request=>{
    const project=host.ownProject(String((request.params as {projectId:string}).projectId),host.authorize(request));
    const q=request.query as {before?:string;limit?:string};const limit=Number(q.limit??50);const before=q.before?Number(Buffer.from(q.before,'base64url').toString()):Number.MAX_SAFE_INTEGER;
    if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(before)||before<1)fail(400,'INVALID_REQUEST','Invalid history cursor');
    const rows=state().messages.filter(m=>m.projectId===project.dto.id&&m.historySeq<before);const items=rows.slice(-limit);
    return {items,nextCursor:rows.length>items.length?Buffer.from(String(items[0].historySeq)).toString('base64url'):null};
  });
  app.get(base+'/projects/:projectId/conversation-events',request=>{
    const project=host.ownProject(String((request.params as {projectId:string}).projectId),host.authorize(request));const q=request.query as {after?:string;limit?:string};
    const after=Number(q.after??0),limit=Number(q.limit??100);if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100)fail(400,'INVALID_REQUEST','Invalid event cursor');
    const rows=state().events.filter(e=>e.projectId===project.dto.id&&e.seq>after),items=rows.slice(0,limit);
    return {items,nextCursor:items.at(-1)?.seq??after,hasMore:rows.length>items.length};
  });
  app.get(base+'/projects/:projectId/workspace',request=>{
    const project=host.ownProject(String((request.params as {projectId:string}).projectId),host.authorize(request));
    // No await: all cards, histories and both cursors are from the same state read.
    const execution=host.workspace(project.dto.id);const turns=state().turns.filter(t=>t.dto.projectId===project.dto.id);
    const messages=state().messages.filter(m=>m.projectId===project.dto.id),recent=messages.slice(-50);
    return CoordinationWorkspace.parse({protocolVersion:VERSION,execution,
      context:{contextVersionId:project.dto.currentVersionId,contextRevision:project.dto.revision,memoryRevision:memory(project.dto.id).revision},
      conversationRevision:state().revisions[project.dto.id]??0,messages:recent,olderMessagesCursor:messages.length>50?Buffer.from(String(recent[0].historySeq)).toString('base64url'):null,
      pendingCoordinationTurns:turns.filter(t=>!terminal(t.dto.status)).map(t=>t.dto),latestCoordinationTurn:turns.at(-1)?.dto??null,
      clarifications:state().clarifications.filter(c=>c.projectId===project.dto.id&&c.status==='open'),
      proposals:state().proposals.filter(p=>p.projectId===project.dto.id&&['open','stale'].includes(p.status)),
      executionEventCursor:execution.eventCursor,conversationEventCursor:state().events.filter(e=>e.projectId===project.dto.id).at(-1)?.seq??0});
  });

  const contextFor=(record:CoordinationRecord):StartCoordinationRequestDto['context']=>{
    const project=store.state.projects.find(p=>p.dto.id===record.dto.projectId)!;const mem=memory(project.dto.id);
    const all=state().messages.filter(m=>m.projectId===project.dto.id);const recent:ConversationMessageDto[]=[];let recentBytes=0;
    for(const message of all.slice().reverse()){
      const bytes=Buffer.byteLength(host.canonical(message));if(recent.length>=DEFAULTS.maxRecentMessages||recentBytes+bytes>DEFAULTS.maxRecentMessageBytes)break;
      recent.unshift(message);recentBytes+=bytes;
    }
    const versions=store.state.versions.filter(v=>v.dto.projectId===project.dto.id).slice(-5);
    const requestedVersion=record.requestedContextVersionId===undefined?project.dto.currentVersionId:record.requestedContextVersionId;
    const basis=store.state.versions.find(v=>v.dto.id===requestedVersion);
    if(basis&&!versions.some(v=>v.dto.id===basis.dto.id))versions.unshift(basis);
    const runs=store.state.runs.filter(r=>r.dto.projectId===project.dto.id).slice(-10).map(({dto:r})=>({id:r.id,revision:r.revision,status:r.status,phase:r.phase,baseVersionId:r.baseVersionId,resultVersionId:r.resultVersionId}));
    const actions:StartCoordinationRequestDto['context']['facts']['availableActions']=basis?[
      {id:`action_source_${basis.dto.id}`,kind:'source_download',versionId:basis.dto.id,available:true},
      {id:`action_preview_${basis.dto.id}`,kind:'preview',versionId:basis.dto.id,available:true,reason:'当前预览仅在本机服务有效'},
    ]:[];
    actions.push({id:`action_deploy_${project.dto.id}`,kind:'deployment_help',available:true});
    for(const r of runs){actions.push({id:`action_view_${r.id}`,kind:'view_run',runId:r.id,available:true});
      if(!runTerminal(r.status))actions.push({id:`action_cancel_${r.id}`,kind:'cancel_run',runId:r.id,available:true});}
    const allowedPaths:string[]=[];let sourceBytes=0;
    if(basis)for(const file of basis.manifest.files.filter(f=>f.path.startsWith('source/src/')&&/\.(tsx?|css|json)$/.test(f.path))){
      if(allowedPaths.length>=DEFAULTS.maxSourceFiles)break;if(sourceBytes+file.bytes>DEFAULTS.maxSourceBytes)continue;allowedPaths.push(file.path);sourceBytes+=file.bytes;
    }
    let memoryView=structuredClone(mem);
    if(Buffer.byteLength(host.canonical(memoryView))>DEFAULTS.maxMemoryBytes)fail(409,'CONFLICT','项目决定超过本次上下文预算，请先限定问题范围');
    const context:StartCoordinationRequestDto['context']={id:id('context'),projectId:project.dto.id,contextRevision:project.dto.revision,
      conversationRevision:state().revisions[project.dto.id]??0,contextVersionId:basis?.dto.id??null,asOf:now(),hash:'0'.repeat(64),
      facts:{project:{id:project.dto.id,title:project.dto.title},currentVersionId:project.dto.currentVersionId,
        versions:versions.map(({dto:v})=>({id:v.id,summary:v.summary,createdAt:v.createdAt,checks:v.checks.map(c=>({kind:c.kind,status:c.status}))})),
        runs,availableActions:actions,deployment:deploymentFacts()},projectMemory:memoryView,recentMessages:recent,
      pendingClarifications:state().clarifications.filter(c=>c.projectId===project.dto.id&&c.status==='open'),
      relevantProposals:state().proposals.filter(p=>p.projectId===project.dto.id&&(p.status==='open'||(record.operation.kind==='proposal_refresh'&&p.id===record.operation.proposalId))),
      ...(basis&&allowedPaths.length?{sourceArtifact:{versionId:basis.dto.id,artifactId:basis.artifactId,manifestSha256:host.hash(basis.manifestRaw),allowedPaths}}:{})};
    const {hash:_,...unsigned}=context;context.hash=host.hash(host.canonical(unsigned));return context;
  };
  const boundRequest=(record:CoordinationRecord)=>{
    if(record.request)return record.request;
    const code=store.state.codes.find(c=>c.id===record.codeId);
    if(!code||code.revoked||Date.parse(code.expiresAt)<=Date.now())fail(403,'FORBIDDEN','消息处理权限已过期');
    const context=contextFor(record);const assistantMessageId=id('message');
    const request=StartCoordinationRequest.parse({protocolVersion:VERSION,turnId:record.dto.id,projectId:record.dto.projectId,inputMessageId:record.dto.userMessageId,
      assistantMessageId,content:record.inputContent,operation:record.operation,mode:record.dto.mode,runMode:record.dto.runMode,
      ...(record.replyTo?{replyTo:record.replyTo}:{}),...(record.dto.continuationOfTurnId?{continuationOfTurnId:record.dto.continuationOfTurnId}:{}),
      context,budget:CoordinationBudget.parse({})});
    record.request=request;if(host.delivery)record.deliveryRequest=D.DeliveryCoordinationRequest.parse(host.delivery.signed({protocolVersion:D.DeliveryProtocolVersion,coordination:request,deliveryFacts:host.delivery.facts(request)}));if(host.requirements&&record.deliveryRequest)record.requirementsRequest=host.requirements.wrap(record,record.deliveryRequest);record.requestHash=host.hash(host.canonical(record.requirementsRequest??record.deliveryRequest??request));
    record.putPending=false;
    updateTurn(record,{assistantMessageId,contextVersionId:context.contextVersionId,contextRevisionUsed:context.contextRevision,
      memoryRevisionUsed:context.projectMemory.revision,conversationRevisionUsed:context.conversationRevision});return request;
  };
  const usedContext=(request:StartCoordinationRequestDto)=>({contextId:request.context.id,contextRevision:request.context.contextRevision,
    memoryRevision:request.context.projectMemory.revision,conversationRevision:request.context.conversationRevision,
    contextVersionId:request.context.contextVersionId,asOf:request.context.asOf,hash:request.context.hash});
  const validateResult=(record:CoordinationRecord,result:RouterResultDto)=>{
    const request=record.request!;
    if(host.canonical(result.contextUsed)!==host.canonical(usedContext(request)))fail(409,'CONFLICT','协调结果引用了不同上下文');
    for(const reference of result.references){
      const valid=reference.kind==='version'?request.context.facts.versions.some(v=>v.id===reference.versionId):
        reference.kind==='run'?request.context.facts.runs.some(r=>r.id===reference.runId):
        reference.kind==='available_action'?request.context.facts.availableActions.some(a=>a.id===reference.actionId):
        reference.kind==='decision'?request.context.projectMemory.decisions.some(d=>d.id===reference.decisionId):
        request.context.sourceArtifact?.versionId===reference.versionId&&request.context.sourceArtifact.allowedPaths.includes(reference.path);
      if(!valid)fail(403,'FORBIDDEN','协调结果引用了未授权事实');
    }
    const evidence=result.kind==='change_proposal'||result.kind==='control'?result.evidence:[];
    for(const item of evidence){const source=store.state.messages.find(m=>m.id===item.messageId&&m.projectId===record.dto.projectId&&m.role==='user');
      if(!source||!source.content.includes(item.quote))fail(403,'FORBIDDEN','变更或控制缺少可信用户证据');}
    if(evidence.length&&!evidence.some(e=>e.messageId===record.dto.userMessageId))fail(403,'FORBIDDEN','不能用旧消息替代本轮授权');
    if(result.kind==='change_proposal'&&result.origin==='confirmed_clarification'&&record.operation.kind!=='clarification_answer')fail(403,'FORBIDDEN','缺少已确认问题绑定');
    if(result.kind==='status')for(const observed of result.observations){const fact=request.context.facts.runs.find(r=>r.id===observed.id);
      if(!fact||host.canonical(fact)!==host.canonical(observed))fail(409,'CONFLICT','状态答案不匹配可信事实');}
  };
  const applyMemory=(record:CoordinationRecord,result:RouterResultDto)=>{
    if(!result.memoryUpdates.length)return;
    let view=state().memories.find(m=>m.projectId===record.dto.projectId);
    if(!view){view=structuredClone(memory(record.dto.projectId));state().memories.push(view);}
    let changed=false;
    for(const update of result.memoryUpdates){
      for(const messageId of update.sourceMessageIds)if(!store.state.messages.some(m=>m.id===messageId&&m.projectId===record.dto.projectId&&m.role==='user'))fail(403,'FORBIDDEN','项目记忆来源不可验证');
      if(update.supersedesDecisionId){const previous=view.decisions.find(d=>d.id===update.supersedesDecisionId&&d.status==='active');if(!previous)fail(409,'CONFLICT','被纠正决定不存在或已变化');previous!.status='superseded';previous!.revision++;previous!.updatedAt=now();}
      const decision:ProjectDecisionDto={id:id('decision'),projectId:record.dto.projectId,revision:1,kind:update.kind,text:update.text,status:'active',sourceTurnId:record.dto.id,
        sourceMessageIds:update.sourceMessageIds,sourceProposalId:null,sourceClarificationId:record.replyTo?.clarificationId??null,supersedesDecisionId:update.supersedesDecisionId,confirmedAt:now(),createdAt:now(),updatedAt:now()};
      view.decisions.push(decision);changed=true;
    }
    if(!changed)return;
    view.revision++;view.summary=view.decisions.filter(d=>d.status==='active').map(d=>`${d.kind}: ${d.text}`).join('\n');
    view.summaryThroughConversationRevision=record.request!.context.conversationRevision;view.updatedAt=now();
  };
  const settle=(record:CoordinationRecord,result:RouterResultDto)=>{
    if(record.dto.status==='cancelling'){updateTurn(record,{status:'cancelled',completedAt:now()});return;}
    validateResult(record,result);
    const replyId=record.dto.assistantMessageId!;const projectId=record.dto.projectId;
    let outcome:NonNullable<CoordinationTurnDto['result']>;let text='';
    if(result.kind==='consult'||result.kind==='status'){
      if(result.kind==='status'){
        const input=record.operation.kind==='message'?record.operation.input:null;
        const targetIds=input?.kind==='status'&&input.targetRunId?[input.targetRunId]:
          result.observations.length?result.observations.map(r=>r.id):record.request!.context.facts.runs.map(r=>r.id);
        const observations=store.state.runs.filter(r=>r.dto.projectId===projectId&&targetIds.includes(r.dto.id)).map(({dto:r})=>
          ({id:r.id,revision:r.revision,status:r.status,phase:r.phase,baseVersionId:r.baseVersionId,resultVersionId:r.resultVersionId}));
        const labels:Record<RunDto['status'],string>={queued:'排队中',running:'执行中',waiting_input:'等待回答',cancelling:'等待停止确认',succeeded:'已交付成功版本',failed:'失败',cancelled:'已停止',interrupted:'中断'};
        text=`宿主状态读取时间：${now()}。\n`+(observations.length?observations.map(r=>`${r.id}：${labels[r.status]}${r.phase?`（${r.phase}）`:''}。`).join('\n'):'当前没有相关构建任务。');
        outcome={kind:'status',replyMessageId:replyId,contextUsed:result.contextUsed,observations,references:result.references};
      }else{
        text=result.answer;
        // Output fact validation, not intent routing: a model cannot invent deployed capability/URLs.
        if(!record.request!.context.facts.deployment.publicDeployment&&/(?:已(?:经)?(?:公开|公网)?(?:部署|上线|发布)|可(?:以)?(?:直接)?(?:公网|外网|公开)访问|https?:\/\/)/i.test(text)){
          text='宿主部署事实：当前应用仅在本机服务预览，尚未完成公网部署。可以下载源码；给他人公网访问需要后续部署，不能把本机地址当作公网链接。';
        }
        if(deploymentFacts().publicDeployment&&/(?:https?:\/\/|永久|永不失效)/i.test(text))text=deploymentHelp();
        outcome={kind:'consult',replyMessageId:replyId,contextUsed:result.contextUsed,references:result.references};
      }
    }else if(result.kind==='clarify'){
      if(state().clarifications.filter(c=>c.projectId===projectId&&c.status==='open').length>=DEFAULTS.maxOpenClarificationsPerProject)fail(429,'RATE_LIMITED','待答问题过多');
      if(result.relatedProposalId&&!state().proposals.some(p=>p.id===result.relatedProposalId&&p.projectId===projectId))fail(403,'FORBIDDEN','关联提案不可访问');
      const question:ClarificationDto={id:id('clarification'),projectId,revision:1,originatingTurnId:record.dto.id,questionMessageId:replyId,question:result.question,
        options:result.options,allowText:result.allowText,contextVersionId:result.contextUsed.contextVersionId,contextRevision:result.contextUsed.contextRevision,
        relatedProposalId:result.relatedProposalId,status:'open',answerMessageId:null,continuationTurnId:null,expiresAt:new Date(Date.now()+DEFAULTS.clarificationTtlMs).toISOString(),createdAt:now(),updatedAt:now()};
      state().clarifications.push(question);coordEvent(projectId,record.dto.id,{type:'clarification.updated',payload:question});text=result.question;
      outcome={kind:'clarify',clarificationId:question.id,replyMessageId:replyId};
    }else if(result.kind==='change_proposal'){
      if(state().proposals.filter(p=>p.projectId===projectId&&p.status==='open').length>=DEFAULTS.maxOpenProposalsPerProject)fail(429,'RATE_LIMITED','待处理提案过多');
      const refreshed=record.operation.kind==='proposal_refresh';
      const proposal:ChangeProposalDto={id:id('proposal'),projectId,revision:1,originatingTurnId:record.dto.id,
        sourceMessageIds:result.evidence.map(e=>e.messageId),summary:result.summary,goal:result.goal,acceptance:result.acceptance,origin:result.origin,
        basePolicy:refreshed||record.requirementsReview?{kind:'exact_version',expectedBaseVersionId:record.requirementsRequest?(record.requirementsRequest.requirements.base.kind==='empty_project'?null:record.requirementsRequest.requirements.base.versionId):store.state.projects.find(p=>p.dto.id===projectId)!.dto.currentVersionId}:result.basePolicy,
        contextUsed:result.contextUsed,status:'open',acceptedRunId:null,supersedesProposalId:refreshed?record.operation.kind==='proposal_refresh'?record.operation.proposalId:null:null,
        lastAdmissionError:null,expiresAt:new Date(Date.now()+DEFAULTS.proposalTtlMs).toISOString(),createdAt:now(),updatedAt:now()};
      state().proposals.push(proposal);if(host.requirements&&record.requirementsRequest){if(!record.requirementsResponse||host.canonical(record.requirementsResponse.delivery.coordination.result)!==host.canonical(result))fail(409,'CONFLICT','完整范围快照与协调结果不一致');host.requirements.materialize(record,result,proposal);}let admission:'proposed'|'run_queued'|'blocked'='proposed';let runId:string|null=null;
      for(const update of result.memoryUpdates)for(const messageId of update.sourceMessageIds){
        if(!store.state.messages.some(m=>m.id===messageId&&m.projectId===projectId&&m.role==='user'))fail(403,'FORBIDDEN','提案记忆建议来源不可验证');
      }
      state().proposalMemorySuggestions[proposal.id]=structuredClone(result.memoryUpdates);
      if(!host.requirements?.needsReview(proposal.id)&&record.dto.mode!=='ask'&&!refreshed&&result.origin!=='inferred_suggestion'&&proposal.basePolicy.kind==='latest_on_dispatch'){
        try {const run=accept(proposal,record,record.dto.runMode);runId=run.dto.id;admission='run_queued';}
        catch(error){const code=(error as {code?:string}).code;proposal.lastAdmissionError={code:code==='QUOTA_EXCEEDED'||code==='GENERATION_QUOTA_EXCEEDED'?'GENERATION_QUOTA_EXCEEDED':'CONFLICT',message:'理解了修改目标，但未通过执行准入；尚未创建任务。',retryable:false};admission='blocked';}
      }
      coordEvent(projectId,record.dto.id,{type:'proposal.updated',payload:proposal});
      outcome={kind:'change_proposal',proposalId:proposal.id,admission,runId,admissionError:proposal.lastAdmissionError};
      text=admission==='run_queued'?`已加入构建队列：${proposal.summary}。任务将在启动时以最新成功版本为基线。`:
        admission==='blocked'?proposal.lastAdmissionError!.message:`建议变更：${proposal.summary}。确认提案后才会创建任务。`;
    }else{
      const target=store.state.runs.find(r=>r.dto.id===result.targetRunId&&r.dto.projectId===projectId&&r.codeId===record.codeId);
      if(!target)fail(404,'NOT_FOUND','取消目标不可访问');
      let receipt:'cancellation_requested'|'already_terminal'|'not_applied'='not_applied';let reason:null|{code:'FORBIDDEN'|'STALE_REVISION';message:string;retryable:boolean}=null;
      if(record.dto.mode==='ask'){reason={code:'FORBIDDEN',message:'ask 模式不会自动控制任务',retryable:false};}
      else if(runTerminal(target!.dto.status))receipt='already_terminal';
      else if(target!.dto.revision!==result.expectedRevision)reason={code:'STALE_REVISION',message:'任务状态已变化，请查看后明确取消',retryable:false};
      else{host.cancelRun(target!);receipt='cancellation_requested';}
      text=receipt==='cancellation_requested'?'已请求停止该任务，等待执行服务确认停止。':receipt==='already_terminal'?'该任务已经结束，没有需要停止的执行。':reason!.message;
      outcome={kind:'control',action:'cancel_run',targetRunId:result.targetRunId,replyMessageId:replyId,receipt,run:target!.dto,reason};
      coordEvent(projectId,record.dto.id,{type:'control.receipt',payload:{turnId:record.dto.id,targetRunId:result.targetRunId,receipt,run:target!.dto}});
    }
    if(record.deliveryRequest&&(outcome.kind==='consult'||outcome.kind==='status')){
      const versionId=record.request!.context.contextVersionId;const v=versionId?store.state.versions.find(v=>v.dto.id===versionId):undefined;
      if(v){const r=store.state.runs.find(r=>r.dto.id===(v.deliveryOriginRunId??v.dto.runId));const quality=r?.delivery?.verified?r.delivery.report?.quality:r?.delivery?.invalid?'blocked':'legacy_unverified';const gaps=r?.delivery?.report?.gaps??[];
        const body=text.length>8000?text.slice(0,8000)+'…（答复已截断）':text;const gapsText=gaps.map(g=>g.description+'：'+g.reason).join('；').slice(0,3000);
        text=`宿主交付事实（${now()}，版本 ${v.dto.id}）：${quality==='complete'?'本次冻结约定全部通过':quality==='partial'?'部分交付，仍有验收缺口':quality==='blocked'?'交付受阻':'旧版本未有可信交付验证'}。${gapsText}\n${body}`;}
    }
    // A proposal suggestion is not an accepted decision. Explicit accept records host-confirmed goal scope.
    if(outcome.kind!=='change_proposal'&&!(outcome.kind==='control'&&outcome.receipt==='not_applied'))applyMemory(record,result);
    putMessage(projectId,record.dto.id,text,'assistant',replyId,record.dto.userMessageId);
    updateTurn(record,{status:'completed',result:outcome,error:null,completedAt:now()});
  };
  const fetchRuntime=async(path:string,method='GET',body?:unknown)=>{
    const isRequirements=path.startsWith(Q.RequirementsInternalPrefix),isDelivery=path.startsWith('/internal/delivery/');
    const response=await fetch(host.agentUrl.replace(/\/$/,'')+path,{method,headers:{authorization:`Bearer ${host.serviceToken}`,...(isRequirements?{[Q.RequirementsVersionHeader]:Q.RequirementsProtocolVersion}:isDelivery?{'X-Atoms-Delivery-Version':D.DeliveryProtocolVersion}:{'X-Atoms-Coordination-Version':VERSION}),'content-type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Object.assign(new Error('Coordination runtime response unavailable'),{status:response.status});return response;
  };
  const failure=(record:CoordinationRecord,code:NonNullable<CoordinationTurnDto['error']>['code'],message:string)=>{
    putMessage(record.dto.projectId,record.dto.id,message,'assistant',record.dto.assistantMessageId??id('message'),record.dto.userMessageId);
    updateTurn(record,{status:code==='INFERENCE_INTERRUPTED'?'interrupted':'failed',error:{code,message,retryable:false},completedAt:now()});
  };
  const connection=(turnId:string,connected:boolean)=>{
    const record=state().turns.find(t=>t.dto.id===turnId);if(!record||(connected?!record.disconnected:record.disconnected))return;
    store.transaction(()=>{record.disconnected=!connected;putMessage(record.dto.projectId,turnId,connected?'项目协调服务连接已恢复，正在同步消息处理结果。':'项目协调服务暂时无法连接，消息已保存；没有因此确认停止或创建新构建。','assistant');});
  };
  const tick=async()=>{
    if(busy||closing)return;busy=true;
    try{
      const expiredQuestions=state().clarifications.filter(c=>c.status==='open'&&Date.parse(c.expiresAt)<=Date.now());
      const expiredProposals=state().proposals.filter(p=>p.status==='open'&&Date.parse(p.expiresAt)<=Date.now());
      if(expiredQuestions.length||expiredProposals.length)store.transaction(()=>{
        for(const question of expiredQuestions){question.status='expired';question.revision++;question.updatedAt=now();coordEvent(question.projectId,question.originatingTurnId,{type:'clarification.updated',payload:question});}
        for(const proposal of expiredProposals){proposal.status='expired';proposal.revision++;proposal.updatedAt=now();coordEvent(proposal.projectId,proposal.originatingTurnId,{type:'proposal.updated',payload:proposal});}
      });
      // Each project has one in-flight coordinator; Worker polling uses a separate lane.
      const ids=[...new Set(state().turns.filter(t=>!terminal(t.dto.status)).map(t=>t.dto.projectId))].map(projectId=>
        state().turns.find(t=>t.dto.projectId===projectId&&!terminal(t.dto.status))!.dto.id);
      for(const turnId of ids){
        let record=state().turns.find(t=>t.dto.id===turnId)!;
        if(host.codeActive&&!host.codeActive(record.codeId)&&!terminal(record.dto.status)){store.transaction(()=>{if(!record.request)updateTurn(record,{status:'cancelled',completedAt:now()});else{record.cancelCommand??={commandId:id('command')};updateTurn(record,{status:'cancelling'});}});if(terminal(record.dto.status))continue;}
        if(host.canDispatch&&!record.request&&record.dto.status!=='cancelling'&&!(record.operation.kind==='message'&&['status','sharing_help'].includes(record.operation.input.kind))&&!await host.canDispatch())continue;
        try{
          if(!record.request){
            try{store.transaction(()=>{boundRequest(record);});}
            catch{store.transaction(()=>{record=state().turns.find(t=>t.dto.id===turnId)!;failure(record,'INVALID_REQUEST','消息上下文无法准备或权限已失效；尚未调用模型。');});continue;}
          }
          record=state().turns.find(t=>t.dto.id===turnId)!;
          if(record.operation.kind==='message'&&['status','sharing_help'].includes(record.operation.input.kind)&&!record.cancelCommand){
            store.transaction(()=>{record.started=true;updateTurn(record,{status:'processing',startedAt:now()});
              const context=record.request!.context;const input=record.operation.kind==='message'?record.operation.input:null;
              if(input?.kind==='status')settle(record,{kind:'status',answer:context.facts.runs.length?'已读取项目任务状态。':'当前没有构建任务。',observations:context.facts.runs.filter(r=>input.targetRunId?r.id===input.targetRunId:true),contextUsed:usedContext(record.request!),references:[],memoryUpdates:[]});
              else settle(record,{kind:'consult',answer:deploymentHelp(),contextUsed:usedContext(record.request!),references:context.facts.availableActions.filter(a=>a.kind==='source_download').map(a=>({kind:'available_action' as const,actionId:a.id})),memoryUpdates:[]});
            });continue;
          }
          const path=record.requirementsRequest?Q.RequirementsInternalPrefix+`/coordination-turns/${turnId}`:record.deliveryRequest?`/internal/delivery/v1/coordination-turns/${turnId}`:`/internal/v2/coordination-turns/${turnId}`;
          if(record.dto.status==='cancelling'){
            let exists=true;
            try{await fetchRuntime(path);}catch(error){if((error as {status?:number}).status===404)exists=false;else throw error;}
            if(!exists){
              if(record.putPending===false&&!record.started){
                store.transaction(()=>{record=state().turns.find(t=>t.dto.id===turnId)!;updateTurn(record,{status:'cancelled',completedAt:now()});});
              }else if(!record.cancelUncertainNotified){
                store.transaction(()=>{record=state().turns.find(t=>t.dto.id===turnId)!;record.cancelUncertainNotified=true;
                  putMessage(record.dto.projectId,turnId,'正在核对已发出的协调请求是否开始；尚未确认停止，不会为了取消再启动新的推理。','assistant');});
              }
              continue;
            }
          }else{
            // Persist uncertainty before sending. A timed-out PUT may still arrive remotely.
            store.transaction(()=>{state().turns.find(t=>t.dto.id===turnId)!.putPending=true;});
            await fetchRuntime(path,'PUT',record.requirementsRequest??record.deliveryRequest??record.request);
            store.transaction(()=>{state().turns.find(t=>t.dto.id===turnId)!.putPending=false;});
          }
          record=state().turns.find(t=>t.dto.id===turnId)!;
          if(record.cancelCommand)await fetchRuntime(path+'/cancel','POST',record.cancelCommand);
          if(record.requirementsRequest){const raw=await(await fetchRuntime(path)).json();let typed;try{typed=Q.RequirementsCoordinationSnapshot.parse(raw);Q.validateRequirementInterpretation(record.requirementsRequest,typed);}catch{store.transaction(()=>{record=state().turns.find(t=>t.dto.id===turnId)!;const metered=CoordinationExecutionSnapshot.safeParse((raw as{delivery?:{coordination?:unknown}}).delivery?.coordination);if(metered.success&&metered.data.id===record.dto.id&&metered.data.projectId===record.dto.projectId&&host.canonical(metered.data.contextUsed)===host.canonical(usedContext(record.request!))&&metered.data.usage.modelSteps>0)record.started=true;const basis=record.requirementsRequest!.requirements.base;failure(record,'INTERNAL_ERROR',basis.kind==='published_version'&&!basis.sourceAvailable?'当前版本源码不可用；没有改用模板，也没有创建构建任务。':'完整要求结果未通过来源与一致性校验；没有创建构建任务。');});continue;}store.transaction(()=>{state().turns.find(t=>t.dto.id===turnId)!.requirementsResponse=typed;});}
          let rawPage=await(await fetchRuntime(path+`/events?after=${record.sourceSeq}&limit=100`)).json();
          if(record.requirementsRequest){const typed=Q.RequirementsCoordinationEvents.parse(rawPage);const req=record.requirementsRequest;if(host.canonical(typed.requirementsUsed)!==host.canonical({id:req.requirements.id,hash:req.requirements.hash,revision:req.requirements.revision})||host.canonical(typed.purposeUsed)!==host.canonical(req.purpose))throw Error('Requirements source page scope mismatch');rawPage=typed.delivery;}
          if(record.deliveryRequest){const outer=D.DeliveryCoordinationEventPage.parse(rawPage);const f=record.deliveryRequest.deliveryFacts;if(outer.deliveryFactsUsed.hash!==f.hash||outer.deliveryFactsUsed.projectId!==f.projectId||outer.deliveryFactsUsed.revision!==f.revision||outer.deliveryFactsUsed.asOf!==f.asOf)throw new Error('Delivery facts response mismatch');}
          const page=CoordinationSourceEventPage.parse(record.deliveryRequest?rawPage.page:rawPage);
          for(const source of page.items){if(record.requirementsRequest&&source.event.type==='coordination.completed'&&record.requirementsResponse?.delivery.coordination.status!=='completed')break;
            record=state().turns.find(t=>t.dto.id===turnId)!;
            if(source.turnId!==turnId||source.projectId!==record.dto.projectId)throw new Error('Coordination source ownership mismatch');
            if(source.sourceSeq<=record.sourceSeq)continue;if(source.sourceSeq!==record.sourceSeq+1)throw new Error('Coordination event gap');
            try{store.transaction(()=>{
              if(terminal(record.dto.status)){record.sourceSeq=source.sourceSeq;return;}
              const event=source.event;
              if(event.type==='coordination.started'){record.started=true;if(record.dto.status!=='cancelling')updateTurn(record,{status:'processing',startedAt:record.dto.startedAt??source.occurredAt});}
              if(event.type==='coordination.progress'&&record.dto.status!=='cancelling')putMessage(record.dto.projectId,turnId,event.payload.content,'assistant',event.payload.messageId,null,source.occurredAt);
              if(event.type==='coordination.completed')settle(record,RouterResult.parse(event.payload));
              if(event.type==='coordination.cancelled')updateTurn(record,{status:'cancelled',completedAt:now()});
              if(event.type==='coordination.failed'||event.type==='coordination.interrupted'){
                if(record.dto.status==='cancelling')updateTurn(record,{status:'cancelled',completedAt:now()});
                else failure(record,event.type==='coordination.interrupted'?'INFERENCE_INTERRUPTED':'INTERNAL_ERROR',event.payload.message);
              }
              record.sourceSeq=source.sourceSeq;
            });}catch{store.transaction(()=>{record=state().turns.find(t=>t.dto.id===turnId)!;failure(record,'INTERNAL_ERROR','协调结果未通过授权或一致性校验；没有执行应用修改。');record.sourceSeq=source.sourceSeq;});}
          }
          connection(turnId,true);
        }catch{connection(turnId,false);}
      }
    }finally{busy=false;}
  };
  return {review(session:SessionRecord,project:ProjectRecord,content:string,ref:ReturnType<typeof Q.RequirementSnapshotRef.parse>){return createTurn(project,session.codeId,content,'ask','plan',{kind:'message',input:{kind:'text',content}},{requirementsReview:ref});},acceptComplete(proposal:ChangeProposalDto,session:SessionRecord){const record=state().turns.find(t=>t.dto.id===proposal.originatingTurnId)!;return accept(proposal,record,'build',session.id,true);},mirror,tick,async close(){closing=true;while(busy)await new Promise(resolve=>setTimeout(resolve,10));},
    markExactConflict(record:RunRecord){const proposal=state().proposals.find(p=>p.id===record.proposalId);if(proposal){proposal.status='stale';proposal.acceptedRunId=null;proposal.revision++;proposal.updatedAt=now();coordEvent(proposal.projectId,record.originTurnId??null,{type:'proposal.updated',payload:proposal});}},
    projectMemory(projectId:string){return memory(projectId).summary;}};
}
