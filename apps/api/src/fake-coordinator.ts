import type { FastifyInstance } from 'fastify';
import {
  CoordinationProtocolVersion as VERSION, StartCoordinationRequest, CoordinationCancelRequest,
  type StartCoordinationRequestDto, type RouterResultDto, type CoordinationExecutionSnapshotDto, type CoordinationSourceEventDto,
} from '@atoms/contracts/conversation';

const now=()=>new Date().toISOString();
const clone=<T>(value:T):T=>structuredClone(value);
export const contextUsedFor=(request:StartCoordinationRequestDto)=>({contextId:request.context.id,contextRevision:request.context.contextRevision,
  memoryRevision:request.context.projectMemory.revision,conversationRevision:request.context.conversationRevision,
  contextVersionId:request.context.contextVersionId,asOf:request.context.asOf,hash:request.context.hash});
export const fakeConsult=(request:StartCoordinationRequestDto):RouterResultDto=>({kind:'consult',answer:'合成协调测试答复；没有调用模型。',contextUsed:contextUsedFor(request),references:[],memoryUpdates:[]});
export const fakeChange=(request:StartCoordinationRequestDto,goal=request.content):RouterResultDto=>({kind:'change_proposal',summary:goal,goal,
  acceptance:[{id:'acceptance_fixture',description:'合成协议样例验收项'}],origin:request.operation.kind==='clarification_answer'?'confirmed_clarification':'explicit_request',
  basePolicy:{kind:'latest_on_dispatch'},evidence:[{messageId:request.inputMessageId,quote:request.content}],contextUsed:contextUsedFor(request),references:[],memoryUpdates:[]});

/** Explicit HTTP test double. Test code supplies outcomes; this is not a keyword intent classifier. */
export function addFakeCoordinator(app:FastifyInstance){
  const entries=new Map<string,{request:StartCoordinationRequestDto;snapshot:CoordinationExecutionSnapshotDto;events:CoordinationSourceEventDto[];commands:Set<string>}>();
  let factory:(request:StartCoordinationRequestDto)=>RouterResultDto|null=fakeConsult;
  let calls=0;let cancels=0;let unavailable=false;let loseNext=false;
  const emit=(turnId:string,event:CoordinationSourceEventDto['event'])=>{
    const entry=entries.get(turnId)!;const seq=entry.events.length+1;
    entry.events.push({protocolVersion:VERSION,projectId:entry.request.projectId,turnId,sourceSeq:seq,occurredAt:now(),event:clone(event)});
    entry.snapshot.lastSourceSeq=seq;
  };
  const complete=(turnId:string,result:RouterResultDto)=>{
    const entry=entries.get(turnId)!;entry.snapshot={...entry.snapshot,status:'completed',result:clone(result),revision:entry.snapshot.revision+1,updatedAt:now()};
    emit(turnId,{type:'coordination.completed',payload:result});
  };
  app.addHook('onRequest',async(request,reply)=>{
    if(request.url.startsWith('/internal/v2/')&&unavailable)return reply.code(503).send({error:'Injected coordination outage'});
  });
  app.put('/internal/v2/coordination-turns/:turnId',(request,reply)=>{
    const body=StartCoordinationRequest.parse(request.body),turnId=(request.params as {turnId:string}).turnId;
    if(body.turnId!==turnId)return reply.code(400).send({error:'Turn ID mismatch'});
    const old=entries.get(turnId);
    if(old){if(JSON.stringify(old.request)!==JSON.stringify(body))return reply.code(409).send({error:'Immutable request changed'});return old.snapshot;}
    calls++;
    entries.set(turnId,{request:clone(body),events:[],commands:new Set(),snapshot:{protocolVersion:VERSION,id:turnId,projectId:body.projectId,revision:1,status:'running',lastSourceSeq:0,
      contextUsed:contextUsedFor(body),result:null,error:null,usage:{modelSteps:1,inputTokens:10,outputTokens:10},updatedAt:now()}});
    emit(turnId,{type:'coordination.accepted',payload:{}});emit(turnId,{type:'coordination.started',payload:{}});
    const result=factory(body);if(result)complete(turnId,result);
    if(loseNext){loseNext=false;return reply.code(503).send({error:'Injected response loss after acceptance'});}
    return reply.code(201).send(entries.get(turnId)!.snapshot);
  });
  app.get('/internal/v2/coordination-turns/:turnId',(request,reply)=>{
    const entry=entries.get((request.params as {turnId:string}).turnId);return entry?entry.snapshot:reply.code(404).send({error:'not found'});
  });
  app.get('/internal/v2/coordination-turns/:turnId/events',(request,reply)=>{
    const entry=entries.get((request.params as {turnId:string}).turnId);if(!entry)return reply.code(404).send({error:'not found'});
    const q=request.query as {after?:string;limit?:string};const after=Number(q.after??0),limit=Number(q.limit??100);
    const rows=entry.events.filter(e=>e.sourceSeq>after),items=rows.slice(0,limit);return {items,nextCursor:items.at(-1)?.sourceSeq??after,hasMore:rows.length>items.length};
  });
  app.post('/internal/v2/coordination-turns/:turnId/cancel',(request,reply)=>{
    const turnId=(request.params as {turnId:string}).turnId,entry=entries.get(turnId);if(!entry)return reply.code(404).send({error:'not found'});
    const body=CoordinationCancelRequest.parse(request.body);
    if(!entry.commands.has(body.commandId)){entry.commands.add(body.commandId);cancels++;
      if(!['completed','failed','cancelled','interrupted'].includes(entry.snapshot.status)){
        entry.snapshot={...entry.snapshot,status:'cancelled',revision:entry.snapshot.revision+1,updatedAt:now()};emit(turnId,{type:'coordination.cancelled',payload:{}});
      }
    }
    return reply.code(202).send(entry.snapshot);
  });
  return {entries,complete,get calls(){return calls;},get cancels(){return cancels;},setFactory(value:typeof factory){factory=value;},
    setUnavailable(value:boolean){unavailable=value;},loseNextResponse(){loseNext=true;},emit};
}
