/** Sanitized shape of epad1z's twelve DSL issues; no original response/goal/reasoning. */
import { profileData } from '../../src/trusted-template.js';
export async function planningSchemaCapture() {
  const data=(await profileData('profile_notes_v1')).data;
  const profile=data.cases.map(entry=>({ref:'',name:'Sanitized syntax fixture',criterionRefs:['s0'],steps:entry.steps.map(value=>{const {id:_id,timeoutMs:_timeout,...step}=value as Record<string,unknown>;return step;})}));
  const board={by:'test_id',value:'note_board'},card={by:'test_id',value:'note_card',nth:0},handle={by:'label',name:'拖动便签',exact:true,nth:0};
  const cases:{ref:string;name:string;criterionRefs:string[];steps:Record<string,unknown>[]}[]=[{ref:'c0',name:'Initial view',criterionRefs:['s0'],steps:[{op:'open_current_app'},...Array.from({length:11},()=>({op:'expect_visible',target:board,visible:true}))]},...profile];
  cases.forEach((entry,index)=>{entry.ref=`c${index}`;if(index>0)entry.criterionRefs.push(`s${index}`);});
  cases[5].steps=[{op:'open_current_app'},{op:'expect_visible',target:board,visible:true},{op:'expect_visible',target:card,visible:true},{op:'save_box',target:card,relativeTo:board,variable:'before_box'},{op:'drag_by',target:handle,dx:80,dy:40},{op:'expect_box_moved',target:card,baseline:'before_box',dx:80,dy:40,tolerancePx:8}];
  cases[6].steps.splice(2,0,{op:'expect_visible',target:card,visible:true});
  const coverage=Array.from({length:7},(_,index)=>({criterionRef:`s${index}`,method:'automated',caseRefs:index===0?cases.map(entry=>entry.ref):[`c${index}`],reason:null}));
  cases.forEach(entry=>{entry.criterionRefs=entry.criterionRefs.map(ref=>ref.replace(/^s/,'r'));});
  coverage.forEach(entry=>{entry.criterionRef=entry.criterionRef.replace(/^s/,'r');});
  const criteria=Array.from({length:7},(_,index)=>({ref:`r${index}`,description:`Sanitized derived criterion ${index}`,sourceSeedRefs:[`s${index}`]}));
  const good={criteria,cases,coverage}; const bad=structuredClone(good); bad.cases[5].name='RAW_MODEL_LABEL_DO_NOT_LOG';
  bad.cases[5].steps[3].variable='beforeBox';bad.cases[5].steps[4].tolerancePx=8;
  bad.cases[5].steps[5]={op:'expect_box_moved',variable:'beforeBox',tolerancePx:8};
  bad.cases[6].steps[3].tolerancePx=8;bad.cases[6].steps[4].variable='savedBox';bad.cases[6].steps[7]={op:'expect_box_same',variable:'savedBox',tolerancePx:8};
  return{good,bad};
}

/** Six meaningful notes behaviors plus a separately required human leaf, all sourced to one Goal. */
export async function mixedGoalDerivedProposal() {
  const data=(await profileData('profile_notes_v1')).data;
  const criteria=data.cases.map((entry,index)=>({ref:`r${index}`,description:entry.description,sourceSeedRefs:['s0']}));
  criteria.push({ref:'r6',description:'人工核对完整目标与自动行为未能证明的交付细节',sourceSeedRefs:['s0']});
  const cases=data.cases.map((entry,index)=>({ref:`c${index}`,name:entry.name,criterionRefs:[`r${index}`],steps:entry.steps.map(value=>{const{id:_id,timeoutMs:_timeout,...step}=value as Record<string,unknown>;return step;})}));
  const coverage=criteria.map((entry,index)=>index<6?{criterionRef:entry.ref,method:'automated',caseRefs:[`c${index}`],reason:null as string|null}:{criterionRef:entry.ref,method:'manual',caseRefs:[] as string[],reason:'人工确认剩余完整目标约定；不把未执行的人审声明为自动通过。'});
  return{criteria,cases,coverage};
}

/** HaEXjt's two invalid coverage representations, deidentified into the new leaf-ref format. */
export async function capturedCoverageForms() {
  const split=await mixedGoalDerivedProposal();const criteria=[{ref:'r0',description:'Sanitized compound requirement',sourceSeedRefs:['s0']}];
  const firstCases=structuredClone(split.cases.slice(0,4));firstCases.forEach(entry=>{entry.criterionRefs=['r0'];});
  firstCases[0].steps.splice(1,0,...Array.from({length:19},()=>({op:'expect_visible',target:{by:'test_id',value:'note_board'},visible:true})));
  const secondCases=structuredClone(split.cases);secondCases.forEach(entry=>{entry.criterionRefs=['r0'];});
  secondCases[0].steps.splice(1,0,...Array.from({length:11},()=>({op:'expect_visible',target:{by:'test_id',value:'note_board'},visible:true})));
  return{first:{criteria,cases:firstCases,coverage:[{criterionRef:'r0',method:'manual',caseRefs:[],reason:'Sanitized whole-goal human review declaration.'}]},
    second:{criteria,cases:secondCases,coverage:[{criterionRef:'r0',method:'automated',caseRefs:secondCases.map(c=>c.ref),reason:null},{criterionRef:'r0',method:'manual',caseRefs:[],reason:'Sanitized human part of that same goal.'}]}};
}
