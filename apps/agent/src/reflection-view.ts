import type {AdapterContext,PlanValue} from './adapters.js';
import {compactRepairFeedback} from './worker-context.js';
import {sha256} from './files.js';
/** Read-only evidence projection, never a replacement for the frozen contract or complete source. */
function clip(text:string,bytes:number){if(Buffer.byteLength(text)<=bytes)return text;let end=Math.min(text.length,bytes);while(Buffer.byteLength(text.slice(0,end))>bytes)end=Math.floor(end*.9);return text.slice(0,end)+' [OMITTED: bounded excerpt]';}
export function reflectionView(context:AdapterContext,plan:PlanValue,errors:string,source:Record<string,string>){
 const feedback=compactRepairFeedback(errors,context.passedCaseIds);let parsed:any;try{parsed=JSON.parse(feedback);}catch{parsed={};}
 const failures=Array.isArray(parsed.failures)?parsed.failures:[];const caseIds=new Set(failures.map((f:any)=>f.caseId));const steps=new Set(failures.map((f:any)=>f.stepId));
 const cases=context.frozenTestPlan?.cases??[];const selected=cases.filter(c=>caseIds.has(c.id));const criteriaIds=new Set(selected.flatMap(c=>c.criterionIds));
 const criteria=context.frozenSpecification?.criteria.filter(c=>criteriaIds.has(c.id))??[];
 const relevant=selected.map(c=>({id:c.id,name:c.name,criterionIds:c.criterionIds,steps:c.steps.filter((s,i)=>steps.has(s.id)||steps.has(c.steps[i+1]?.id)||steps.has(c.steps[i+2]?.id))}));
 const targetTerms=new Set<string>();for(const c of relevant)for(const s of c.steps){const target='target'in s?s.target:null;if(target)for(const v of Object.values(target))if(typeof v==='string'&&v.length>=3)targetTerms.add(v);}
 const changed=new Set((context.sourceDeltaSummary?.files??[]).map(f=>f.path.replace(/^source\//,'')));
 const ranked=Object.entries(source).map(([file,text])=>({file,text,score:(changed.has(file)?3:0)+[...targetTerms].reduce((n,t)=>n+(text.includes(t)?2:0),0)})).sort((a,b)=>b.score-a.score||a.file.localeCompare(b.file));
 const snippets=ranked.slice(0,3).map(f=>{const lines=f.text.split('\n');const hits=lines.map((line,i)=>({line,i})).filter(x=>[...targetTerms].some(t=>x.line.includes(t)));const indexes=hits.length?[...new Set(hits.slice(0,3).flatMap(x=>[Math.max(0,x.i-1),x.i,Math.min(lines.length-1,x.i+1)]))]:lines.map((_,i)=>i).slice(0,30);return{file:f.file,sha256:sha256(f.text),totalBytes:Buffer.byteLength(f.text),excerpt:clip(indexes.map(i=>`${i+1}: ${lines[i]}`).join('\n'),1000),complete:false};});
 const view = [
 'BOUNDED READ-ONLY EVIDENCE VIEW v1. This is NOT the full source/specification/plan. All omitted files, criteria, steps and text remain authoritative in host storage; omitted does not mean absent or unimplemented. Do not assert defects from omission. If supplied evidence cannot resolve the cause, return unclear and ask only a missing product expectation.',
 'Frozen plan reference: '+JSON.stringify(context.frozenTestPlan?{id:context.frozenTestPlan.id,hash:context.frozenTestPlan.hash}:null),
 'Failed case/step excerpts (other steps omitted): '+clip(JSON.stringify(relevant),2500),
 'Related required criteria (bounded, other criteria omitted): '+clip(JSON.stringify(criteria),1200),
 'Observed failures (bounded): '+clip(feedback,1800),
 'Passed case IDs: '+clip(JSON.stringify(context.passedCaseIds??[]),400),
 'Last two source delta metadata: '+clip(JSON.stringify(context.recentRepairDeltas??[context.sourceDeltaSummary??null]),700),
 'Ranked source excerpts (remaining files/content OMITTED): '+JSON.stringify(snippets),
 'Original goal summary excerpt: '+clip(context.frozenSpecification?.originalGoal??plan.summary,400),
 ].join('\n');
 return clip(view,10000);
}
