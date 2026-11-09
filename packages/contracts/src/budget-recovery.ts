/** Independent, explicit one-credit successor authorization. Legacy DTOs remain strict and unchanged. */
import {z} from 'zod';
import {Id,Sha256,Seq,Revision,Timestamp,Run,Session,Budget} from './index.js';
import {BudgetUsage,DigestRef,DeliveryExecutionRequest,FrozenDeliveryBundle,AcceptanceCriterion,canonicalDeliveryJson} from './delivery.js';
export const BudgetRecoveryProtocolVersion='0.1.0' as const;
export const BudgetRecoveryVersionHeader='X-Atoms-Budget-Recovery-Version' as const;
export const BudgetRecoveryPublicPrefix='/api/budget-recovery/v1' as const;
export const BudgetRecoveryInternalPrefix='/internal/budget-recovery/v1' as const;
export const RECOVERY_SEGMENT_BUDGET=Object.freeze({maxModelSteps:8,maxInputTokens:65536,maxOutputTokens:24576,maxWallTimeMs:900000,maxRepairRounds:2,maxWaitingInputMs:86400000,maxArtifactBytes:20971520});
const Version=z.literal(BudgetRecoveryProtocolVersion),Text=z.string().min(1).max(20000);
const same=(a:unknown,b:unknown)=>canonicalDeliveryJson(a)===canonicalDeliveryJson(b);
export const BudgetDiagnostic=z.object({protocolVersion:Version,id:Id,revision:Revision,projectId:Id,runId:Id,executionId:Id,
 classification:z.enum(['token_budget','model_step_budget','active_time_budget','repair_budget','tool_timeout','unknown']),
 dimension:z.enum(['input_tokens','output_tokens','model_steps','active_ms','repair_rounds','tool_time_ms','unknown']),
 trigger:z.enum(['segment_limit_reached','request_reservation_rejected','tool_deadline','unknown']),
 observedLowerBound:Seq.nullable(),settledTotal:Seq.nullable(),limit:z.number().int().positive().nullable(),nextRequestReservation:Seq.nullable(),
 accountingSource:z.enum(['host_meter','settled_provider_requests','tool_clock','unavailable']),asOf:Timestamp,
 historicalUsage:BudgetUsage,summary:Text,
}).strict().superRefine((v,c)=>{const issue=(message:string)=>c.addIssue({code:'custom',message});
 if(v.settledTotal!==null&&(v.observedLowerBound===null||v.observedLowerBound>v.settledTotal))issue('Settled total must include the observed lower bound');
 if(v.classification==='token_budget'){
  if(!['input_tokens','output_tokens'].includes(v.dimension)||v.limit===null||v.observedLowerBound===null||!['host_meter','settled_provider_requests'].includes(v.accountingSource))issue('Token diagnosis requires an actual token dimension, bound and trusted observation');
  else if(v.trigger==='segment_limit_reached'?v.observedLowerBound<v.limit:v.trigger==='request_reservation_rejected'?v.nextRequestReservation===null||v.observedLowerBound+v.nextRequestReservation<=v.limit:true)issue('Token exhaustion must be evidenced, not inferred from a generic error');
 }
 if(['model_step_budget','active_time_budget','repair_budget','tool_timeout'].includes(v.classification)&&(v.limit===null||v.observedLowerBound===null||v.observedLowerBound<v.limit||v.nextRequestReservation!==null||v.trigger!==(v.classification==='tool_timeout'?'tool_deadline':'segment_limit_reached')||(v.classification==='tool_timeout'?v.accountingSource!=='tool_clock':!['host_meter','settled_provider_requests'].includes(v.accountingSource))))issue('Non-token failure must use matching measured resource and limit, never token inference');
 const dimensions={model_step_budget:'model_steps',active_time_budget:'active_ms',repair_budget:'repair_rounds',tool_timeout:'tool_time_ms',unknown:'unknown'} as const;if(v.classification!=='token_budget'&&v.dimension!==dimensions[v.classification])issue('Budget dimension must agree with its diagnosed class');
 if(v.classification==='unknown'&&(v.dimension!=='unknown'||v.trigger!=='unknown'||v.limit!==null||v.observedLowerBound!==null||v.settledTotal!==null||v.nextRequestReservation!==null||v.accountingSource!=='unavailable'))issue('Unknown cause cannot claim a diagnosed dimension');
});
/** Internal metadata only. Actual files stay Agent-private and are rehashed before and after copying. */
export const RecoveryCheckpoint=z.object({protocolVersion:Version,id:Id,hash:Sha256,projectId:Id,runId:Id,executionId:Id,backend:z.literal('host_local'),
 sourceSnapshotHash:Sha256,manifestHash:Sha256,fileCount:z.number().int().positive().max(100),bytes:z.number().int().positive().max(20971520),
 packageJsonHash:Sha256,lockfileHash:Sha256,scriptsHash:Sha256,toolchainId:Id,
 originSeed:DigestRef,originSpec:DigestRef,originPlan:DigestRef,originBinding:DigestRef,latestAttemptId:Id.nullable(),savedAt:Timestamp,
 verification:z.literal('actual_bytes_verified'),storage:z.literal('agent_private_immutable'),
}).strict();
export const RecoveryStopRequest=z.object({commandId:Id,expectedRequestHash:Sha256,expectedReportHash:Sha256,expectedCheckpoint:DigestRef}).strict();
export const RecoveryStopReceipt=z.object({protocolVersion:Version,id:Id,hash:Sha256,commandId:Id,projectId:Id,runId:Id,executionId:Id,
 requestHash:Sha256,reportHash:Sha256,checkpoint:DigestRef,backend:z.literal('host_local'),status:z.literal('confirmed'),
 method:z.enum(['runtime_disposal','independent_process_audit']),privateControlEpoch:Id,checkedAt:Timestamp,
}).strict();
export const RecoveryPlanReview=z.object({status:z.enum(['reusable','review_required','unverified']),semanticHash:Sha256,
 reviewedAt:Timestamp.nullable(),reasons:z.array(z.string().min(1).max(240)).max(20)}).strict().superRefine((v,c)=>{
 if(v.status==='reusable'&&(!v.reviewedAt||v.reasons.length))c.addIssue({code:'custom',message:'Reuse needs a completed plan review without known defects'});
 if(v.status==='review_required'&&!v.reasons.length)c.addIssue({code:'custom',message:'Known plan defects must be explained'});
});
export const RecoveryRuntimeView=z.object({protocolVersion:Version,projectId:Id,runId:Id,executionId:Id,requestHash:Sha256,
 backend:z.enum(['host_local','docker_linux']),diagnosis:BudgetDiagnostic.nullable(),checkpoint:RecoveryCheckpoint.nullable(),
 stopReceipt:RecoveryStopReceipt.nullable(),origin:DeliveryExecutionRequest.nullable(),report:DigestRef.nullable(),planReview:RecoveryPlanReview.nullable(),
}).strict().superRefine((v,c)=>{const issue=(message:string)=>c.addIssue({code:'custom',message});
 for(const item of[v.diagnosis,v.checkpoint,v.stopReceipt])if(item&&(item.projectId!==v.projectId||item.runId!==v.runId||item.executionId!==v.executionId))issue('Recovery metadata subject mismatch');
 if(v.origin&&(v.origin.execution.runId!==v.runId||v.origin.execution.executionId!==v.executionId||v.origin.execution.projectId!==v.projectId))issue('Origin wrapper subject mismatch');
 if(v.checkpoint&&!v.origin)issue('Recoverable source needs its immutable origin wrapper');
 if(v.checkpoint&&v.origin){const cp=v.checkpoint,b=v.origin.bundle.binding;if(!same(cp.originSeed,b.seed)||!same(cp.originSpec,b.spec)||!same(cp.originPlan,b.plan)||!same(cp.originBinding,{id:b.id,hash:b.hash})||cp.toolchainId!==b.toolchain.id||cp.packageJsonHash!==b.toolchain.packageJsonHash||cp.lockfileHash!==b.toolchain.lockfileHash||cp.scriptsHash!==b.toolchain.scriptsHash)issue('Checkpoint provenance must match its exact origin frozen bundle/toolchain');}
 if(v.checkpoint&&v.backend!=='host_local')issue('Docker recovery is unsupported in this baseline');
 if(v.stopReceipt&&(!v.checkpoint||v.stopReceipt.projectId!==v.projectId||v.stopReceipt.requestHash!==v.requestHash||v.stopReceipt.reportHash!==v.report?.hash||!same(v.stopReceipt.checkpoint,{id:v.checkpoint.id,hash:v.checkpoint.hash})))issue('Stop proof must bind exact origin report/request/checkpoint');
});
export const RecoveryIneligibility=z.enum(['DIAGNOSIS_UNAVAILABLE','NOT_TOKEN_BUDGET','CHECKPOINT_MISSING','CHECKPOINT_INVALID','STOP_UNCONFIRMED','REPORT_NOT_FINAL','PUBLICATION_NOT_FENCED','BACKEND_UNSUPPORTED','RUNTIME_UNAVAILABLE','QUOTA_EXHAUSTED','PROJECT_BUSY','TARGET_NOT_LATEST','SCOPE_CHANGED','HEAD_CHANGED','ALREADY_CONTINUED','PLAN_REVIEW_REQUIRED']);
export const RecoveryLineage=z.object({rootRunId:Id,parentRunId:Id.nullable(),segment:Seq,successorRun:Run.nullable()}).strict().refine(v=>(v.segment===0)===(v.parentRunId===null),'Only a root segment has no predecessor');
export const RecoveryOffer=z.object({id:Id,revision:Revision,runId:Id,projectId:Id,checkpoint:DigestRef,sourceSnapshotHash:Sha256,
 semanticHash:Sha256,expectedProjectRevision:Revision,expectedHeadVersionId:Id.nullable(),expectedLatestRunId:Id,
 cost:z.literal(1),budget:Budget,issuedAt:Timestamp,expiresAt:Timestamp,
 frozenScope:z.object({goal:Text,seed:DigestRef,spec:DigestRef,plan:DigestRef,criteria:z.array(AcceptanceCriterion).min(1).max(50)}).strict(),
}).strict().superRefine((v,c)=>{if(!same(v.budget,RECOVERY_SEGMENT_BUDGET)||v.expectedLatestRunId!==v.runId||Date.parse(v.expiresAt)<=Date.parse(v.issuedAt)||Date.parse(v.expiresAt)-Date.parse(v.issuedAt)>60000)c.addIssue({code:'custom',message:'Fixed one-credit segment, exact latest predecessor and at most 60-second quote required'});});
export const BudgetRecoveryReadView=z.object({protocolVersion:Version,projectId:Id,runId:Id,revision:Revision,
 diagnosis:BudgetDiagnostic.nullable(),eligible:z.boolean(),reason:RecoveryIneligibility.nullable(),offer:RecoveryOffer.nullable(),
 lineage:RecoveryLineage,quota:Session.shape.quota,
}).strict().superRefine((v,c)=>{if(v.eligible?(!v.offer||v.reason!==null||v.diagnosis?.classification!=='token_budget'||v.lineage.successorRun!==null):v.reason===null||v.offer!==null)c.addIssue({code:'custom',message:'Only an eligible diagnosed token failure may expose a quote; otherwise state the actual reason'});if(v.diagnosis&&(v.diagnosis.projectId!==v.projectId||v.diagnosis.runId!==v.runId))c.addIssue({code:'custom',message:'Diagnostic subject mismatch'});if(v.lineage.successorRun&&v.lineage.successorRun.projectId!==v.projectId)c.addIssue({code:'custom',message:'Successor belongs to another project'});if(v.eligible&&v.quota.runLimit-v.quota.runsUsed-v.quota.runsReserved<1)c.addIssue({code:'custom',message:'Eligible continuation requires one available credit'});if(v.lineage.segment===0&&v.lineage.rootRunId!==v.runId)c.addIssue({code:'custom',message:'Root lineage subject mismatch'});if(v.lineage.parentRunId===v.runId||v.lineage.successorRun?.id===v.runId)c.addIssue({code:'custom',message:'Lineage cannot self-link'});if(v.offer&&(v.offer.runId!==v.runId||v.offer.projectId!==v.projectId))c.addIssue({code:'custom',message:'Offer subject mismatch'});});
export const ContinueBudgetRequest=z.object({offerId:Id,expectedOfferRevision:Revision,checkpoint:DigestRef,expectedSourceHash:Sha256,
 expectedSemanticHash:Sha256,expectedProjectRevision:Revision,expectedHeadVersionId:Id.nullable()}).strict();
export const ContinueBudgetResponse=z.object({protocolVersion:Version,operationId:Id,disposition:z.enum(['created','already_created']),
 projectId:Id,predecessorRunId:Id,rootRunId:Id,segment:z.number().int().positive(),run:Run,quota:Session.shape.quota}).strict()
 .refine(v=>v.run.id!==v.predecessorRunId&&v.run.projectId===v.projectId,'Continuation must be a new successor, never a resurrected failed Run');
export const BudgetRecoveryError=z.object({error:z.object({code:z.enum(['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','CONFLICT','STALE_OFFER','QUOTA_EXHAUSTED','RUNTIME_UNAVAILABLE','NOT_ELIGIBLE','PLAN_REVIEW_REQUIRED']),message:Text,requestId:Id,retryable:z.boolean()}).strict()}).strict();
/** Projection deliberately excludes only identity/resealing fields; all actual acceptance semantics survive. */
export function recoverySemanticBody(bundle:z.infer<typeof FrozenDeliveryBundle>){return{seed:{projectId:bundle.seed.projectId,goal:bundle.seed.goal,items:bundle.seed.items,source:bundle.seed.source},
 spec:{projectId:bundle.spec.projectId,originalGoal:bundle.spec.originalGoal,origin:bundle.spec.origin,criteria:bundle.spec.criteria},
 plan:{protocolVersion:bundle.plan.protocolVersion,dslVersion:bundle.plan.dslVersion,cases:bundle.plan.cases,coverage:bundle.plan.coverage,browserBudgetMs:bundle.plan.browserBudgetMs},
 binding:{projectId:bundle.binding.projectId,preparationId:bundle.binding.preparationId,baseVersionId:bundle.binding.baseVersionId,input:bundle.binding.input,planningMode:bundle.binding.planningMode,toolchain:bundle.binding.toolchain,policyRevision:bundle.binding.policyRevision,exportPolicyRevision:bundle.binding.exportPolicyRevision}};}
export const RecoveryExecutionRequest=z.object({protocolVersion:Version,id:Id,hash:Sha256,operationId:Id,rootRunId:Id,
 predecessorRunId:Id,segment:z.number().int().positive(),originRequestHash:Sha256,originReport:DigestRef,
 checkpoint:RecoveryCheckpoint,stopReceipt:RecoveryStopReceipt,origin:DeliveryExecutionRequest,request:DeliveryExecutionRequest,
 semanticHash:Sha256,planReview:RecoveryPlanReview,historicalUsage:BudgetUsage,
 authorization:z.object({id:Id,offerId:Id,offerRevision:Revision,projectRevision:Revision,headVersionId:Id.nullable(),authorizedAt:Timestamp,startBefore:Timestamp,cost:z.literal(1)}).strict(),
 inputSource:z.literal('verified_checkpoint'),reusedPreparationId:Id,
}).strict().superRefine((v,c)=>{const issue=(message:string)=>c.addIssue({code:'custom',message});const old=v.origin.execution,next=v.request.execution,cp=v.checkpoint,stop=v.stopReceipt;
 if(v.predecessorRunId!==old.runId||next.runId===old.runId||next.executionId===old.executionId||next.projectId!==old.projectId||cp.runId!==old.runId||cp.executionId!==old.executionId||cp.projectId!==old.projectId)issue('Recovery must link one new execution to its actual predecessor/source');
 if(stop.runId!==old.runId||stop.executionId!==old.executionId||stop.projectId!==old.projectId||stop.requestHash!==v.originRequestHash||stop.reportHash!==v.originReport.hash||!same(stop.checkpoint,{id:cp.id,hash:cp.hash}))issue('Origin source/request/report/confirmed stop mismatch');
 const preserved=(x:typeof old)=>{const{executionId:_e,runId:_r,budget:_b,...rest}=x;return rest;};if(!same(preserved(old),preserved(next)))issue('Only execution/run IDs and the new budget may change; prompt/mode/mandate/input/attempt are preserved');
 const b=v.origin.bundle.binding;if(!same(cp.originSeed,b.seed)||!same(cp.originSpec,b.spec)||!same(cp.originPlan,b.plan)||!same(cp.originBinding,{id:b.id,hash:b.hash})||cp.toolchainId!==b.toolchain.id||cp.packageJsonHash!==b.toolchain.packageJsonHash||cp.lockfileHash!==b.toolchain.lockfileHash||cp.scriptsHash!==b.toolchain.scriptsHash)issue('Checkpoint does not belong to the original frozen source policy');
 if(!same(recoverySemanticBody(v.origin.bundle),recoverySemanticBody(v.request.bundle)))issue('Continuation cannot replan, change source baseline, goal, requirements, tests or toolchain');
 if(!same(next.budget,RECOVERY_SEGMENT_BUDGET)||!same(v.request.bundle.binding.totalBudget,RECOVERY_SEGMENT_BUDGET)||!same(v.request.bundle.binding.planningUsage,{activeMs:0,modelSteps:0,inputTokens:0,outputTokens:0}))issue('Fresh fixed segment with zero new planning required');
 if(v.reusedPreparationId!==v.origin.bundle.binding.preparationId||v.request.bundle.binding.preparationId!==v.reusedPreparationId)issue('Preparation provenance must explicitly reuse the true old plan, never invent planning');
 if(v.planReview.status!=='reusable'||v.planReview.semanticHash!==v.semanticHash)issue('Known or unreviewed semantic plan defects cannot consume a continuation credit');
 if(Date.parse(v.authorization.startBefore)<=Date.parse(v.authorization.authorizedAt)||Date.parse(v.authorization.startBefore)-Date.parse(v.authorization.authorizedAt)>300000)issue('New Worker start authorization is bounded to five minutes');
 if(v.authorization.headVersionId!==old.baseVersionId)issue('Recovery cannot silently rebase');
});
/** Caller supplies SHA256; works in Node or browser without embedding a crypto/runtime implementation. */
export function rebindRecoveryRequest(origin:z.infer<typeof DeliveryExecutionRequest>,ids:{runId:string;executionId:string;seedId:string;specId:string;planId:string;bindingId:string},at:string,sha256:(bytes:string)=>string):z.infer<typeof DeliveryExecutionRequest>{
 const seal=<T extends Record<string,unknown>>(v:T)=>({...v,hash:sha256(canonicalDeliveryJson(v))});
 const{hash:_s,...oldSeed}=origin.bundle.seed,seed=seal({...oldSeed,id:ids.seedId,runId:ids.runId,executionId:ids.executionId,revision:1,createdAt:at});
 const{hash:_p,...oldSpec}=origin.bundle.spec,spec=seal({...oldSpec,id:ids.specId,runId:ids.runId,revision:1,seed:{id:seed.id,hash:seed.hash},createdAt:at});
 const{hash:_t,...oldPlan}=origin.bundle.plan,plan=seal({...oldPlan,id:ids.planId,revision:1,spec:{id:spec.id,hash:spec.hash},createdAt:at});
 const{hash:_b,...oldBinding}=origin.bundle.binding,binding=seal({...oldBinding,id:ids.bindingId,runId:ids.runId,executionId:ids.executionId,seed:{id:seed.id,hash:seed.hash},spec:{id:spec.id,hash:spec.hash},plan:{id:plan.id,hash:plan.hash},totalBudget:{...RECOVERY_SEGMENT_BUDGET},planningUsage:{activeMs:0,modelSteps:0,inputTokens:0,outputTokens:0},frozenAt:at});
 return DeliveryExecutionRequest.parse({protocolVersion:origin.protocolVersion,execution:{...origin.execution,runId:ids.runId,executionId:ids.executionId,budget:{...RECOVERY_SEGMENT_BUDGET}},bundle:{seed,spec,plan,binding}});
}
export type BudgetRecoveryReadViewDto=z.infer<typeof BudgetRecoveryReadView>;
export type RecoveryExecutionRequestDto=z.infer<typeof RecoveryExecutionRequest>;
