/** Separately authorized stopped/drained issuance; new identity, never resets existing usage. */
import{readFile,writeFile,lstat,open,rename,unlink,link,mkdir}from'node:fs/promises';
import{resolve,join,dirname,isAbsolute}from'node:path';import{fileURLToPath}from'node:url';import{randomUUID}from'node:crypto';
import{controller,parseM3Options,run,privateDirectory}from'./m3-lib.mjs';
export const PROVISION_PLAN={operation:'new public identity with independent quota; existing codes gain ten-project limit only',projectLimitPerCode:10,newCodeRunLimit:3,newCodeUsed:0,maxLifetimeIdentities:10,maxNamespaceProjects:100,resetOldUsed:false,resetOldHistory:false,extendOldTtl:false,handoffGrant:false,providerCalls:0,defaultExecutes:false};
export function provisionOptions(args,root){const get=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};const operationId=get('--operation-id'),output=get('--new-code-file'),ttlSeconds=Number(get('--ttl-seconds')??86400);if(!operationId||!/^[A-Za-z0-9_-]{8,64}$/.test(operationId)||!output||!isAbsolute(output)||resolve(output)===root||resolve(output).startsWith(root+'/'))throw Error('Explicit operation-id and private output file outside repository required');if(!Number.isInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>86400)throw Error('TTL must be1..86400seconds');return{operationId,output:resolve(output),request:{kind:'provision-public-identity',operationId,projectLimit:10,runLimit:3,ttlSeconds}};}
async function protectedFile(file){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o777)!==0o600||process.getuid&&s.uid!==process.getuid())throw Error('Private file must be current-owner regular0600');return readFile(file);}
export async function verifyCompletedProvision(state,output,verify){
 if(state.status!=='complete')throw Error('Completed journal required for read-only replay');
 const raw=(await protectedFile(output)).toString().trim();if(!/^[A-Za-z0-9_-]{43}$/.test(raw))throw Error('Completed private code output invalid');
 return verify({request:state.request,code:raw});
}
async function main(args){
 if(!args.includes('--provision')){console.log(JSON.stringify(PROVISION_PLAN));return;}
 if(process.env.ATOMS_ALLOW_M3_PROVISION_CODE!=='1')throw Error('Separate ATOMS_ALLOW_M3_PROVISION_CODE=1 and --provision required');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),o=provisionOptions(args,root),options=parseM3Options(args,root);if(options.project!=='atoms-m3-public'||options.real||options.fake)throw Error('Only stopped public provisioning is allowed; no runtime/key/namespace reset');
 const ctl=await controller(root,options);await ctl.stopped();const summary=await ctl.summary();if(summary.nonterminalRuns||summary.nonterminalTurns)throw Error('Provisioning requires drained Run/Turn work');
 await privateDirectory(options.directory);await mkdir(dirname(o.output),{recursive:true,mode:0o700});await privateDirectory(dirname(o.output));
 const journal=join(options.directory,'provision-'+o.operationId+'.json'),lockFile=join(options.directory,'public-provision.lock');let lock;try{lock=await open(lockFile,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Provisioning lock exists; inspect private journal before stale-lock recovery');throw e;}
 const save=async value=>{const temp=journal+'.'+randomUUID();await writeFile(temp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});await rename(temp,journal);};let state;
 try{
  try{state=JSON.parse((await protectedFile(journal)).toString());if(state.output!==o.output||JSON.stringify(state.request)!==JSON.stringify(o.request))throw Error('Operation ID already belongs to another request/output');}catch(e){if(e.code!=='ENOENT')throw e;try{await lstat(o.output);throw Error('Refusing to overwrite an existing output file without the matching operation journal');}catch(e){if(e.code!=='ENOENT')throw e;}state={request:o.request,output:o.output,status:'pending',createdAt:new Date().toISOString()};await save(state);}
  if(state.status==='failed_needs_review')throw Error('Previous provisioning failed; inspect DB receipt/private output for an orphan before explicit operator recovery');
  if(state.status==='complete'){
   const verified=await verifyCompletedProvision(state,o.output,async input=>{const result=await ctl.compose(['run','--rm','--env','M3_PROVISION_AUTHORIZED=1','--no-deps','admin','pnpm','--filter','@atoms/api','exec','tsx','src/public-admin-main.ts','provision-verify'],{input:JSON.stringify(input)});return JSON.parse(result.stdout.trim().split('\n').at(-1));});console.log(JSON.stringify({provisioned:true,replayed:true,operationId:o.operationId,codeId:verified.receipt.codeId,issuedBaseline:{projectLimit:10,runLimit:3,runsUsed:0},currentUsage:verified.usage,oldUsageUnchanged:true,apiStillStopped:true,codeFile:o.output,providerCalls:0}));return;
  }
  await ctl.recover('admin');const containerFile='/run/admin-code/provision-'+o.operationId+'/experience-code',name=options.project+'-provision-'+randomUUID().slice(0,8),temporary=o.output+'.pending-'+randomUUID();
  try{
   const result=await ctl.compose(['run','--name',name,'--env','M3_PROVISION_AUTHORIZED=1','--no-deps','admin','pnpm','--filter','@atoms/api','exec','tsx','src/public-admin-main.ts','provision-new',containerFile],{input:JSON.stringify(o.request)});
   const issued=JSON.parse(result.stdout.trim().split('\n').at(-1)),receipt=issued.receipt;state={...state,status:'db_committed',receipt};await save(state);
   // Docker cp targets an exclusive private temporary file, never an existing final code.
   const fd=await open(temporary,'wx',0o600);await fd.close();await run('docker',['cp',name+':'+containerFile,temporary],{cwd:root});const bytes=await protectedFile(temporary);if(!/^[A-Za-z0-9_-]{43}\n?$/.test(bytes.toString()))throw Error('Issued private output format invalid');
   try{await link(temporary,o.output);}catch(e){if(e.code!=='EEXIST')throw e;const existing=await protectedFile(o.output);if(!existing.equals(bytes))throw Error('Existing private output differs; refusing overwrite');}
   state={...state,status:'complete',completedAt:new Date().toISOString()};await save(state);console.log(JSON.stringify({provisioned:true,operationId:o.operationId,codeId:receipt.codeId,issuedBaseline:{projectLimit:10,runLimit:3,runsUsed:0},currentUsage:issued.usage,oldUsageUnchanged:true,oldHistoryUnchanged:true,apiStillStopped:true,codeFile:o.output,privateJournal:journal,providerCalls:0}));
  }catch(error){state={...state,status:'failed_needs_review',failure:'Provisioning/copy did not complete; inspect private DB receipt and code output, never automatically issue again'};await save(state);throw error;}
  finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});await run('docker',['rm','-f',name],{cwd:root,allowed:[0,1]});}
 }finally{await lock.close();await unlink(lockFile);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main(process.argv.slice(2));
