import{offlineAuthorizePublicQuota}from'./public-quota.js';
import{offlineProvisionPublicCode,inspectPublicProvision,verifyPublicProvisionOutput}from'./public-provisioning.js';
/** Explicit stopped/drained administration. The host wrapper also checks the Compose service state. */
import {offlinePublicCode,initializePublicNamespace,offlinePublicHandoff} from './public-admin.js';
import {readPublicDeployment} from './public-profile.js';
const [action,codeFile,ttl]=process.argv.slice(2);
if(process.env.M3_ADMIN_OFFLINE!=='1'||!process.env.API_DATA_DIR||!process.env.M3_DEPLOYMENT_FILE)throw new Error('Host must prove the API is stopped/drained before offline administration');
const deployment=readPublicDeployment(process.env.M3_DEPLOYMENT_FILE);
if(action==='init'){initializePublicNamespace(process.env.API_DATA_DIR,deployment);console.log('Fresh public namespace initialized; no identity or quota reset.');}
else if((action==='issue'||action==='revoke')&&codeFile){const result=offlinePublicCode(process.env.API_DATA_DIR,deployment,action,codeFile,Number(ttl??86400));console.log(JSON.stringify(result));}
else if(action==='provision-new'&&codeFile){let bytes='';for await(const chunk of process.stdin){bytes+=chunk;if(bytes.length>8192)throw Error('Provisioning request too large');}let input;try{input=JSON.parse(bytes);}catch{throw Error('Invalid provisioning JSON; raw input omitted');}console.log(JSON.stringify(offlineProvisionPublicCode(process.env.API_DATA_DIR,deployment,input,codeFile,process.env.M3_PROVISION_AUTHORIZED==='1')));}
else if(action==='provision-verify'){if(process.env.M3_PROVISION_AUTHORIZED!=='1')throw Error('Independent provisioning verification guard required');let bytes='';for await(const chunk of process.stdin){bytes+=chunk;if(bytes.length>8192)throw Error('Private verification input too large');}let input;try{input=JSON.parse(bytes);}catch{throw Error('Invalid private verification JSON; raw content omitted');}console.log(JSON.stringify(verifyPublicProvisionOutput(process.env.API_DATA_DIR,deployment,input.request,input.code)));}
else if(action==='provision-inspect'&&codeFile)console.log(JSON.stringify(inspectPublicProvision(process.env.API_DATA_DIR,deployment,codeFile)));
else if(action==='quota-total'){let bytes='';for await(const chunk of process.stdin){bytes+=chunk;if(bytes.length>8192)throw Error('Quota authorization input too large');}let input;try{input=JSON.parse(bytes);}catch{throw Error('Invalid private quota JSON; raw content omitted');}console.log(JSON.stringify(offlineAuthorizePublicQuota(process.env.API_DATA_DIR,deployment,input.request,input.code,process.env.M3_QUOTA_AUTHORIZED==='1')));}
else if(action==='handoff-inspect'){console.log(JSON.stringify(offlinePublicHandoff(process.env.API_DATA_DIR,deployment)));}
else if(action==='handoff-grant'){let bytes='';for await(const chunk of process.stdin){bytes+=chunk;if(bytes.length>1048576)throw Error('Handoff receipt too large');}let input;try{input=JSON.parse(bytes);}catch{throw Error('Invalid handoff JSON; raw input omitted');}console.log(JSON.stringify(offlinePublicHandoff(process.env.API_DATA_DIR,deployment,input,process.env.M3_HANDOFF_AUTHORIZED==='1')));}
else throw new Error('Expected init, issue/revoke, handoff-inspect or guarded handoff-grant');
