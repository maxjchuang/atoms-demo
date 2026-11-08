/** Private host lifecycle metadata, not a public protocol or a model credential. */
import {readFile,writeFile,rename,lstat}from'node:fs/promises';import{join}from'node:path';
export function runtimeModeDecision({project,imageMode,saved=null,authorizeInitialKey=false,explicitFake=false}){
 if(!['fake','dsh'].includes(imageMode))throw new Error('Image manifest runtime mode must be explicit');
 if(saved&&(saved.project!==project||!['fake','dsh'].includes(saved.mode)||saved.providerConfigured!==(saved.mode==='dsh')))throw new Error('Invalid or foreign private runtime mode record');
 if(authorizeInitialKey&&explicitFake)throw new Error('Fake mode and initial real credential ingress are mutually exclusive');
 if(saved?.mode==='dsh'&&explicitFake)throw new Error('A real public profile cannot silently fall back to Fake; use a fresh separate test namespace');
 const mode=authorizeInitialKey?'dsh':saved?.mode??(explicitFake||project==='atoms-m3-check'?'fake':null);
 return {mode,environmentMode:mode??imageMode,configured:!!saved,providerConfigured:saved?.providerConfigured===true,keyIngressRequired:authorizeInitialKey&&saved?.mode!=='dsh',imageMode};
}
export function assertRuntimeImageMode(decision){if(decision.mode!==null&&decision.mode!==decision.imageMode)throw new Error('Runtime mode and gateway build manifest disagree; refusing to start or relabel services');}
export async function loadRuntimeMode(directory){try{const path=join(directory,'runtime-mode.json'),stat=await lstat(path);if(stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||process.getuid&&stat.uid!==process.getuid())throw new Error('Runtime mode file must be current-owner 0600');return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export async function saveRuntimeMode(directory,project,mode){const record={project,mode,providerConfigured:mode==='dsh',configuredAt:new Date().toISOString()},path=join(directory,'runtime-mode.json'),temporary=path+'.pending';await writeFile(temporary,JSON.stringify(record),{mode:0o600});await rename(temporary,path);return record;}
