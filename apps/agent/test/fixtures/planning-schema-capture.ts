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
  const good={cases,coverage}; const bad=structuredClone(good); bad.cases[5].name='RAW_MODEL_LABEL_DO_NOT_LOG';
  bad.cases[5].steps[3].variable='beforeBox';bad.cases[5].steps[4].tolerancePx=8;
  bad.cases[5].steps[5]={op:'expect_box_moved',variable:'beforeBox',tolerancePx:8};
  bad.cases[6].steps[3].tolerancePx=8;bad.cases[6].steps[4].variable='savedBox';bad.cases[6].steps[7]={op:'expect_box_same',variable:'savedBox',tolerancePx:8};
  return{good,bad};
}
