/** Test orchestration only: one-shot completion is not a failed long-lived service. */
export function unexpectedServiceExit(children){
 return children.find(child=>child.lifecycle==='service'&&!child.stopping&&(child.exitCode!=null||child.signalCode!=null));
}
export async function awaitOneShot(child,{timeoutMs=180000,killGraceMs=1000}={}){
 child.lifecycle='oneshot';let timedOut=false,forceTimer;
 const kill=signal=>{try{process.kill(-child.pid,signal);}catch{try{child.kill(signal);}catch{}}};
 const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');forceTimer=setTimeout(()=>kill('SIGKILL'),killGraceMs);},timeoutMs);
 try{return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,timedOut}));});}
 finally{clearTimeout(timer);if(forceTimer)clearTimeout(forceTimer);}
}
export function assertOneShotSucceeded(result){
 if(result.code!==0||result.signal!==null||result.timedOut)throw new Error(`Read-only Web CLI failed (code=${result.code}, signal=${result.signal}, timedOut=${result.timedOut}); full output is preserved in web-readonly-cli.log.`);
}
