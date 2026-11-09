/** Pure planning for adding one primary connector without replacing existing transports. */
import assert from'node:assert/strict';
import{fixedNgrokOrigin}from'./m3-ngrok.mjs';
export function cloudflarePrimaryPlan(previous,deployment){
 assert.equal(previous?.tunnels?.length,2,'Primary promotion requires exactly the existing ngrok workbench and Cloudflare preview');
 const workbench=previous.tunnels.find(t=>t.role==='workbench'),preview=previous.tunnels.find(t=>t.role==='preview');
 assert.ok(workbench?.provider==='ngrok'&&workbench.port===18080,'Existing workbench must be the owned fixed ngrok connector');fixedNgrokOrigin(workbench.origin);
 assert.ok(preview?.provider!=='ngrok'&&preview?.port===18081&&/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(preview.origin),'Existing preview must be the independent Cloudflare connector');
 assert.ok(deployment.ready&&deployment.expectedIsolation,'Existing deployment must be ready with a reviewed isolation binding');
 assert.equal(deployment.workbenchOrigin,workbench.origin,'Current canonical must match the existing ngrok journal');assert.equal(deployment.previewOrigin,preview.origin,'Current preview must match the existing Cloudflare journal');
 assert.equal((deployment.workbenchAliases??[]).length,0,'Review existing aliases before primary promotion');
 return{workbench,preview,aliases:[workbench.origin],targets:[['workbench',18080]],preserveExisting:true};
}
export function assertRegularTunnelLifecycle(action,state){
 if(action!=='status'&&state.recoveryNeeded)throw new Error('Tunnel promotion needs explicit metadata/journal recovery; automatic retry or cleanup refused');
 const promoted=state.tunnels?.some(t=>t.role==='workbench'&&t.provider==='ngrok')&&state.tunnels?.some(t=>t.role==='workbench'&&t.provider!=='ngrok');
 if(promoted&&['start','renew'].includes(action))throw new Error('Promoted three-connector topology cannot use generic start/renew; it would discard the ngrok backup. Review the primary-only replacement workflow, including after stop.');
}
export async function promotionFailureOutcome({plan,candidateOrigin,expectedIsolation,readMetadata}){
 let actual;try{actual=await readMetadata();}catch{return{retainNew:true,recoveryNeeded:true,outcome:'metadata_unavailable'};}
 const sameProof=actual.expectedIsolation&&expectedIsolation&&Object.keys(actual.expectedIsolation).length===Object.keys(expectedIsolation).length&&Object.entries(expectedIsolation).every(([key,value])=>actual.expectedIsolation[key]===value);
 if(actual.workbenchOrigin===candidateOrigin&&actual.previewOrigin===plan.preview.origin&&(actual.workbenchAliases??[]).includes(plan.workbench.origin)&&sameProof)return{retainNew:true,recoveryNeeded:true,outcome:'origins_committed_response_uncertain'};
 if(actual.workbenchOrigin===plan.workbench.origin&&actual.previewOrigin===plan.preview.origin&&(actual.workbenchAliases??[]).length===0&&sameProof)return{retainNew:false,recoveryNeeded:false,outcome:'origins_not_committed'};
 return{retainNew:true,recoveryNeeded:true,outcome:'metadata_conflict'};
}
