import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {isIP} from 'node:net';
import {pathToFileURL} from 'node:url';
const hop=new Set(['connection','proxy-connection','keep-alive','transfer-encoding','upgrade','te','trailer','proxy-authorization','authorization','x-forwarded-for','x-forwarded-host','x-forwarded-proto','cf-connecting-ip']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
export function createGateway({role,manifestFile,upstream,webDir,pausedFile}){
 if(!['workbench','preview'].includes(role))throw new Error('Known gateway role required');const target=new URL(upstream);if(target.protocol!=='http:'||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw new Error('Fixed internal HTTP upstream required');
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','private, no-store');
  const deny=(status,message)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(message);};
  try{
   const raw=req.url??'/';if(!raw.startsWith('/')||raw.startsWith('//')||raw.includes('://'))return deny(400,'Invalid request target');let path;try{path=decodeURIComponent(raw.split('?')[0]);}catch{return deny(400,'Invalid path');}
   if(/[\\\u0000-\u001f\u007f]/.test(path)||path.includes('//')||path.split('/').some(p=>p==='.'||p==='..')||/%2f|%5c/i.test(raw.split('?')[0]))return deny(400,'Invalid path');
   if(path==='/health'&&['GET','HEAD'].includes(req.method)){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ready":true}');}
   const deployment=JSON.parse(await readFile(manifestFile,'utf8')),origin=role==='workbench'?deployment.workbenchOrigin:deployment.previewOrigin;
   if(!origin)return deny(503,'Deployment bootstrap pending');const expected=new URL(origin);if(expected.protocol!=='https:'||expected.origin!==origin||req.headers.host!==expected.host)return deny(403,'Unexpected gateway host');
   const api=role==='workbench'&&/^\/api\/(?:v1|v2|delivery\/v1|sharing\/v1|budget-recovery\/v1|requirements\/v1)(?:\/|$)/.test(path);
   if(path==='/internal'||path.startsWith('/internal/')||path.startsWith('/metrics')||path.startsWith('/broker')||path.startsWith('/docker')||path.startsWith('/.'))return deny(404,'Not found');
   if(role==='preview'&&(!['GET','HEAD'].includes(req.method)||!/^\/p\/[^/]+\/.+/.test(path)))return deny(404,'Not found');
   if(api||role==='preview'){
    if(!deployment.ready)return deny(503,'Deployment is not ready');
    if(pausedFile&&existsSync(pausedFile)&&!['GET','HEAD','DELETE'].includes(req.method)&&path!=='/api/v1/sessions'&&!/^\/api\/v1\/runs\/[^/]+\/(?:cancel|answers)$/.test(path)&&!/^\/api\/sharing\/v1\/projects\/[^/]+\/resolve$/.test(path))return deny(503,'Admission paused for drain');
    if(Number(req.headers['content-length']??0)>65536)return deny(413,'Request too large');
    const headers={};for(const [key,value]of Object.entries(req.headers))if(value!==undefined&&!hop.has(key)&&!(role==='preview'&&key==='cookie'))headers[key]=value;
    headers.host=expected.host;headers['x-forwarded-host']=expected.host;headers['x-forwarded-proto']='https';const cf=req.headers['cf-connecting-ip'];headers['x-forwarded-for']=typeof cf==='string'&&isIP(cf)?cf:(req.socket.remoteAddress??'127.0.0.1');
    let size=0;const forwarded=http.request({hostname:target.hostname,port:target.port,method:req.method,path:raw,headers,timeout:15000},response=>{
     const output={};for(const [key,value]of Object.entries(response.headers))if(value!==undefined&&!hop.has(key)&&!(role==='preview'&&key==='set-cookie'))output[key]=value;output['cache-control']='private, no-store';output['x-content-type-options']='nosniff';output['referrer-policy']='no-referrer';res.writeHead(response.statusCode??502,output);response.pipe(res);
    });forwarded.on('timeout',()=>forwarded.destroy());forwarded.on('error',()=>{if(!res.headersSent)deny(502,'Upstream unavailable');else res.destroy();});req.on('data',chunk=>{size+=chunk.length;if(size>65536){forwarded.destroy();if(!res.headersSent)deny(413,'Request too large');}});req.pipe(forwarded);return;
   }
   if(path.startsWith('/api/'))return deny(404,'Not found');if(!['GET','HEAD'].includes(req.method))return deny(405,'Method not allowed');
   const relative=path==='/'?'index.html':path.slice(1);const root=resolve(webDir),file=resolve(root,relative);if(file!==root&&!file.startsWith(root+'/'))return deny(404,'Not found');
   let selected=file;try{if(!(await stat(selected)).isFile())return deny(404,'Not found');}catch{if(extname(path))return deny(404,'Not found');selected=join(root,'index.html');}
   const bytes=await readFile(selected);const frame=deployment.previewOrigin??"'none'";res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src ${frame}; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`);res.writeHead(200,{'Content-Type':types[extname(selected)]??'application/octet-stream','Content-Length':bytes.length});return res.end(req.method==='HEAD'?undefined:bytes);
  }catch{if(!res.headersSent)deny(503,'Gateway configuration unavailable');else res.destroy();}
 });return server;
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 for(const name of ['DEEPSEEK_API_KEY','DEEPSEEK_API_KEY_FILE','ATOMS_SERVICE_TOKEN','ATOMS_SERVICE_TOKEN_FILE','INTERNAL_SERVICE_TOKEN','PREVIEW_SECRET','PREVIEW_SECRET_FILE','AGENT_BROKER_TOKEN','AGENT_BROKER_TOKEN_FILE'])if(process.env[name])throw new Error('Gateway must not receive provider or backend secrets');
 const server=createGateway({role:process.env.M3_GATEWAY_ROLE,manifestFile:process.env.M3_DEPLOYMENT_FILE,pausedFile:process.env.M3_PAUSED_FILE,upstream:process.env.M3_UPSTREAM,webDir:process.env.M3_WEB_DIR??'/srv/web'});server.listen(Number(process.env.PORT??8080),'0.0.0.0',()=>console.log('Gateway ready; role='+process.env.M3_GATEWAY_ROLE));const stop=()=>server.close(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
