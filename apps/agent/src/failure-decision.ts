import type{BrowserTestPlanDto}from'@atoms/contracts/delivery';
export type WorkerFailureDecision={kind:'replan_tests';summary:string;revisions:{caseId:string;stepId:string;fact:string;suggestion:string}[]}|{kind:'environment';summary:string};
const bounded=(v:unknown,max:number)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/https?:\/\/|file:\/\/|(?:^|\s)\/(?:Users|home|private|var|run)\//.test(v))throw new Error('Invalid bounded failure decision');return v;};
/** Advice only. No returned fact changes the frozen contract or authorizes another Run. */
export function parseWorkerFailureDecision(raw:unknown,plan:BrowserTestPlanDto|undefined,hasFailure:boolean):WorkerFailureDecision|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;const o=raw as Record<string,unknown>;
 if(o.decision===undefined||o.decision==='fix_code'||o.decision==='clarify')return null;
 if(!hasFailure||!['replan_tests','environment'].includes(String(o.decision))||'files'in o||'question'in o)throw new Error('Failure diagnosis cannot edit files or invent authority');
 const allowed=o.decision==='replan_tests'?['decision','summary','revisions']:['decision','summary'];if(Object.keys(o).some(k=>!allowed.includes(k)))throw new Error('Unsupported failure decision fields');const summary=bounded(o.summary,1000);
 if(o.decision==='environment')return{kind:'environment',summary};
 if(!plan||!Array.isArray(o.revisions)||!o.revisions.length||o.revisions.length>10)throw new Error('Replan advice needs bound failed checks');
 const revisions=o.revisions.map((v:unknown)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid revision fact');const r=v as Record<string,unknown>;if(Object.keys(r).some(k=>!['caseId','stepId','fact','suggestion'].includes(k)))throw new Error('Unsupported revision fields');const c=plan.cases.find(c=>c.id===r.caseId);if(!c||!c.steps.some(s=>s.id===r.stepId))throw new Error('Revision must reference the frozen case/step');return{caseId:c.id,stepId:String(r.stepId),fact:bounded(r.fact,1000),suggestion:bounded(r.suggestion,1000)};});return{kind:'replan_tests',summary,revisions};
}
