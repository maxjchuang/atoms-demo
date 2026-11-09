import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
export async function docker(args:string[],options:{input?:string;timeoutMs?:number;maxBytes?:number;logFile?:string}={}){
  return new Promise<{code:number;stdout:string;stderr:string}>((resolve,reject)=>{
    const child=spawn('docker',args,{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME,DOCKER_HOST:process.env.DOCKER_HOST,DOCKER_CONTEXT:process.env.DOCKER_CONTEXT}});
    let stdout='',stderr='',bytes=0;const max=options.maxBytes??1048576;const collect=(which:'stdout'|'stderr')=>(data:Buffer)=>{if(options.logFile)appendFileSync(options.logFile,data);bytes+=data.length;if(bytes>max){child.kill('SIGKILL');reject(new Error('Docker output exceeded bound'));return;}if(which==='stdout')stdout+=data;else stderr+=data;};child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));child.on('error',reject);
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Docker control command timeout; job stopping is not confirmed'));},options.timeoutMs??30000);
    child.on('close',code=>{clearTimeout(timer);resolve({code:code??1,stdout,stderr});});if(options.input)child.stdin.end(options.input);else child.stdin.end();
  });
}
export function checked(result:{code:number;stdout:string;stderr:string}){if(result.code!==0)throw new Error(result.stderr.slice(-1500)||'Docker command failed');return result.stdout;}
