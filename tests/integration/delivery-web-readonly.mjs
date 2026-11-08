import path from 'node:path';

export function deliveryWebReadonlyEnabled(args){
 const enabled=args.includes('--verify-web-readonly');
 if(enabled&&args.includes('--no-web'))throw new Error('--verify-web-readonly requires Web; it cannot be combined with --no-web. No credentials or model services have been loaded.');
 return enabled;
}

/** Public browser-test environment only. Never inherit model or internal-service credentials. */
export function webReadonlyInvocation({root,webUrl,projectId,demoCode,real,parentEnv=process.env}){
 const environment={};
 for(const key of ['PATH','HOME','USER','LOGNAME','TMPDIR','TMP','TEMP','LANG','LC_ALL','TERM','SystemRoot','COMSPEC','PATHEXT','DISPLAY','XDG_CACHE_HOME','PLAYWRIGHT_BROWSERS_PATH','PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH','CI'])if(parentEnv[key]!==undefined)environment[key]=parentEnv[key];
 Object.assign(environment,{NODE_ENV:'test',ATOMS_WEB_URL:webUrl,ATOMS_DELIVERY_PROJECT:projectId,ATOMS_DEMO_CODE:demoCode,
  [real?'ATOMS_READONLY_REAL_SERVICES':'ATOMS_FAKE_SERVICES']:'1'});
 return {command:process.execPath,args:['--import','tsx','scripts/check-delivery-services.mjs'],cwd:path.join(root,'apps','web'),env:environment};
}
