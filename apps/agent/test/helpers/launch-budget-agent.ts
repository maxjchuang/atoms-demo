/** Synthetic orchestration asset only. Never imports node:test, loads .env, reads keys or reuses user data. */
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAgentServer } from '../../src/runtime.js';
import { FakeDshAdapter, type AdapterContext, type PlanValue } from '../../src/adapters.js';
import { seal } from '../../src/delivery-files.js';
import { profileProposal } from '../../src/trusted-template.js';
const argv=process.argv.slice(2);
function option(name:string){const i=argv.indexOf(name);return i<0?undefined:argv[i+1];}
if(argv.some((v,i)=>i%2===0&&!['--port','--api-internal-url'].includes(v))||argv.length%2)throw new Error('Only --port and --api-internal-url are accepted; data/key paths are forbidden');
if(process.env.DEEPSEEK_API_KEY||process.env.DEEPSEEK_API_KEY_FILE)throw new Error('Synthetic fixture refuses configured provider credentials; unset provider env before launch');
const port=Number(option('--port')||0);if(!Number.isSafeInteger(port)||port<0||port>65535)throw new Error('Invalid local port');
const apiInternalUrl=option('--api-internal-url')||'http://127.0.0.1:3001';const api=new URL(apiInternalUrl);if(api.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(api.hostname)||api.username||api.password||api.search||api.hash||api.pathname!=='/')throw new Error('Fixture API must be a loopback HTTP origin');
const fixtureDir=await mkdtemp(path.join(os.tmpdir(),'atoms-budget-http-fixture-'));
const dataDir=path.join(fixtureDir,'agent-data');const tokenFile=path.join(fixtureDir,'service-token');
const token=randomBytes(32).toString('hex');await writeFile(tokenFile,token+'\n',{flag:'wx',mode:0o600});await chmod(tokenFile,0o600);
let originExecutionId:string|null=null;let generationCalls=0;let stopping=false;
const statusFile=path.join(fixtureDir,'fixture-status.json');
const status=async()=>writeFile(statusFile,JSON.stringify({synthetic:true,mode:'fake',providerRequests:0,originExecutionId,generationCalls,stopping},null,2));
class ControlledBudgetFake extends FakeDshAdapter{
 async generate(context:AdapterContext,plan:PlanValue,errors?:string){
  originExecutionId??=context.request.executionId;generationCalls++;await status();
  if(context.request.executionId===originExecutionId&&errors){
   // The first real verification failed. This request simulates an observed input overrun,
   // with uncertain final accounting. No model was called and no new source is written.
   context.beginModelRequest?.();context.markUsageUnknown?.();
   context.meter({modelSteps:1,inputTokens:context.request.budget.maxInputTokens+425,outputTokens:Math.min(13347,context.request.budget.maxOutputTokens)});
   throw new Error('Synthetic fixture input-budget interruption');
  }
  const result=await super.generate(context,plan,errors);if(typeof result!=='string')return result;
  // Static generic collection role/name, aligned with the fixed synthetic plan below.
  const {readFile}=await import('node:fs/promises');const card=path.join(context.workspace,'src/components/NoteCard.tsx');await writeFile(card,(await readFile(card,'utf8')).replace('<article className=','<article aria-label=\"Fixture note\" className='));
  if(context.request.executionId===originExecutionId){
   // Full deterministic source is present first; only then introduce an actual TSC defect.
   const {readFile}=await import('node:fs/promises');const appFile=path.join(context.workspace,'src/App.tsx');
   await writeFile(appFile,(await readFile(appFile,'utf8'))+'\nconst controlledBudgetFixtureTypeError:number = "synthetic-only";\n');
  }
  return result;
 }
}
const adapter=new ControlledBudgetFake();
const app=createAgentServer({dataDir,serviceToken:token,apiInternalUrl,mode:'fake',coordinationMode:'fake',adapter,
 planningAdapter:{ready:()=>true,async close(){},async plan(context){context.report('Synthetic fixed notes plan; no model or semantic generation quality claim.');context.meter({modelSteps:1,inputTokens:2052,outputTokens:2037});const proposed=await profileProposal(context.request,'profile_notes_v1');proposed.plan=seal({...proposed.plan,cases:proposed.plan.cases.map(test=>({...test,steps:test.steps.map(step=>step.op==='save_count'||step.op==='expect_count'?{...step,target:{by:'role' as const,role:'article' as const,name:'Fixture note',exact:true}}:step)}))});return proposed;}},
 // This fixture has no SDK process. The production audit is never disabled by wire/env.
 recoveryAudit:async()=>({confirmed:originExecutionId!==null&&!app.runtime.isExecutionActive(originExecutionId),reason:null}),
});
const origin=await app.listen(port,'127.0.0.1');await status();
await writeFile(path.join(fixtureDir,'launch.json'),JSON.stringify({synthetic:true,origin,fixtureDir,dataDir,tokenFile,statusFile,apiInternalUrl,mode:'fake',coordinationMode:'fake',providerRequests:0},null,2),{mode:0o600});
console.log(JSON.stringify({ready:true,synthetic:true,origin,fixtureDir,dataDir,tokenFile,statusFile,apiInternalUrl,providerRequests:0}));
async function stop(){if(stopping)return;stopping=true;await status();await app.close();console.log(JSON.stringify({stopped:true,fixtureDir,providerRequests:0}));process.exit(0);}
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
