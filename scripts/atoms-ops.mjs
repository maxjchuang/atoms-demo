#!/usr/bin/env node
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {DEFAULT_PRIVATE_DIR,readSettings,operationId,mutationPlan,withOpsLock,openJournal,runOperation,publicOutput,fixedDockerEnvironment} from './atoms-ops-lib.mjs';
export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const HELP=`Usage: ./atoms <command> [options]
  start                  Start/repair owned services and missing tunnels
  stop [--all]           Stop five app services; --all also stops tunnels
  restart [--all]        Restart apps; --all explicitly refreshes CF domains
  status | details       Read sanitized deployment and readiness status
  code new [--builds N] [--ttl-seconds N] [--code-file PATH]
  code reset --code-file PATH [--builds N]
  code extend --code-file PATH --until ISO_WITH_TIMEZONE
  code info --code-file PATH
  monitor check | run | start | status | stop
    run/start: --interval 30 --failure-threshold 3 --recovery-threshold 2 --timeout-ms 8000 [--notify]
    check: --timeout-ms 8000
  backup | config | help
Options: --config FILE --dry-run --operation-id ID
Code new/reset default to 10 remaining builds (1..100). Reset preserves used/history.
TTL defaults to 86400 seconds, maximum 86400. Code files are private; code text is never printed.
Extend requires an explicit future ISO timestamp with timezone; it changes expiry only.
Keep the printed operation ID to resume the same operation without another quota reset.
No operation creates a CodeRun or invokes a model. Readiness uses existing proof, not a new OS certification.`;
export function parseArgs(argv){
  const words=[],flags={};const boolean=new Set(['--dry-run','--all','--notify']);const valued=new Set(['--config','--operation-id','--code-file','--builds','--ttl-seconds','--until','--interval','--failure-threshold','--recovery-threshold','--timeout-ms']);
  for(let n=0;n<argv.length;n++){const a=argv[n];if(a==='--help'||a==='-h')return{command:'help',options:{}};if(a.startsWith('-')){if(Object.hasOwn(flags,a))throw Error('Duplicate option '+a);if(boolean.has(a))flags[a]=true;else if(valued.has(a)){if(!argv[n+1]||argv[n+1].startsWith('--'))throw Error('Missing value for '+a);flags[a]=argv[++n];}else throw Error('Unknown option '+a);}else words.push(a);}
  if(!words.length)words.push('help');if(words[0]==='code'&&words[1]==='create')words[1]='new';const command=words.join(' ');
  if(!['help','config','start','stop','restart','status','details','code new','code reset','code extend','code info','backup','monitor check','monitor run','monitor start','monitor status','monitor stop'].includes(command))throw Error('Unknown command; use ./atoms help');
  const monitor=command.startsWith('monitor ');
  const allowed=new Set(['--config']);if(['start','stop','restart','code new','code reset','code extend','backup'].includes(command)){allowed.add('--dry-run');allowed.add('--operation-id');}if(['stop','restart'].includes(command))allowed.add('--all');if(command.startsWith('code '))allowed.add('--code-file');if(['code new','code reset'].includes(command))allowed.add('--builds');if(command==='code new')allowed.add('--ttl-seconds');if(command==='code extend')allowed.add('--until');if(['monitor run','monitor start'].includes(command))for(const k of ['--interval','--failure-threshold','--recovery-threshold','--timeout-ms','--notify'])allowed.add(k);if(command==='monitor check')allowed.add('--timeout-ms');for(const key of Object.keys(flags))if(!allowed.has(key))throw Error(key+' is not valid for '+command);
  const integer=(name,fallback,max)=>{const raw=flags[name];if(raw===undefined)return fallback;if(!/^[1-9][0-9]*$/.test(raw)||Number(raw)>max)throw Error(name+' must be an integer from 1 to '+max);return Number(raw);};
  const options={all:!!flags['--all'],dryRun:!!flags['--dry-run'],configFile:flags['--config'],operationId:flags['--operation-id'],codeFile:flags['--code-file']?resolve(flags['--code-file']):undefined};
  if(monitor){options.monitorOptions={intervalSeconds:integer('--interval',30,3600),failureThreshold:integer('--failure-threshold',3,100),recoveryThreshold:integer('--recovery-threshold',2,100),timeoutMs:integer('--timeout-ms',8000,30000),notify:!!flags['--notify']};if(options.monitorOptions.intervalSeconds<5||options.monitorOptions.timeoutMs<100)throw Error('Monitor interval must be >=5 seconds and timeout >=100ms');}
  if(['code new','code reset'].includes(command))options.builds=integer('--builds',10,100);
  if(command==='code new')options.ttlSeconds=integer('--ttl-seconds',86400,86400);
  if(['code reset','code extend','code info'].includes(command)&&!options.codeFile)throw Error('--code-file is required');
  if(command==='code extend')options.until=normalizeUntil(flags['--until']);
  if(options.operationId!==undefined)operationId(options.operationId);
  return{command,options};
}
export function normalizeUntil(value){
  const match=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if(!match)throw Error('--until requires an ISO timestamp with explicit timezone, e.g. 2026-11-15T23:59:59.999+08:00');
  const [,year,month,day,hour,minute,second,zoneHour,zoneMinute]=match;
  const y=Number(year),m=Number(month),d=Number(day),leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  const time=Date.parse(value);
  if(m<1||m>12||d<1||d>days[m-1]||Number(hour)>23||Number(minute)>59||Number(second)>59||Number(zoneHour??0)>23||Number(zoneMinute??0)>59||!Number.isFinite(time)||time<=Date.now())throw Error('--until must be a valid future timestamp');
  return new Date(time).toISOString();
}
export async function main(argv=process.argv.slice(2),{runtimeFactory,monitorFactory,output=console.log,errorOutput=console.error}={}){
  let parsed;try{parsed=parseArgs(argv);}catch(error){errorOutput(error.message);return 1;}
  const{command,options}=parsed;if(command==='help'){output(HELP);return 0;}
  let settings;try{settings=await readSettings(options.configFile?resolve(options.configFile):join(DEFAULT_PRIVATE_DIR,'ops-config.json'),ROOT,{optional:!options.configFile});}catch{errorOutput('Invalid private JSON configuration; expected owned 0600 file with dockerContext/privateDir/project/ngrokBinary/ngrokTokenFile fields.');return 1;}
  if(command==='config'){output(JSON.stringify(settings,null,2));return 0;}
  if(command.startsWith('monitor ')){
    try{const factory=monitorFactory??(await import('./atoms-monitor-service.mjs')).createMonitorService;const monitor=await factory(settings),action=command.slice('monitor '.length);const result=await monitor[action](options.monitorOptions);if(result!==undefined)output(JSON.stringify(publicOutput(result),null,2));return 0;}
    catch{errorOutput(JSON.stringify({errorCode:'MONITOR_OPERATION_FAILED',action:command,dockerContext:settings.dockerContext,project:settings.project,hints:['Check ./atoms config and ./atoms monitor status.',`Inspect private monitor files in ${join(settings.privateDir,'monitor')}.`,'Unknown launchd identities or stale instance locks require manual review; no process was killed.']}));return 1;}
  }
  const mutation=!['status','details','code info'].includes(command);
  if(mutation){options.operationId=operationId(options.operationId);if(command==='code new'&&!options.codeFile)options.codeFile=join(settings.privateDir,'codes',options.operationId+'.txt');}
  if(options.dryRun){output(JSON.stringify(mutationPlan(command,options),null,2));return 0;}
  if(mutation)output(JSON.stringify({operationId:options.operationId,resume:'Repeat the same command with this --operation-id and identical options.'}));
  let stage=mutation?'operation_lock':'runtime_init',activeJournal;
  const execute=async()=>{
    stage='runtime_init';
    // Drop inherited Docker endpoint/TLS overrides before importing any adapter.
    const env=fixedDockerEnvironment(settings);for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','DOCKER_CONFIG','DOCKER_API_VERSION','DOCKER_TLS','BUILDX_BUILDER'])delete process.env[k];process.env.DOCKER_CONTEXT=env.DOCKER_CONTEXT;
    const factory=runtimeFactory??(await import('./atoms-ops-runtime.mjs')).createRuntime;
    const runtime=await factory(settings);
    const parameters={command,all:options.all,codeFile:options.codeFile??null,builds:options.builds??null,ttlSeconds:options.ttlSeconds??null,settings,...(command==='code extend'?{until:options.until}:{})};
    stage=mutation?'journal_open':'read_status';
    activeJournal=mutation?await openJournal(settings,options.operationId,parameters):undefined;
    stage=mutation?'operation':command==='code info'?'read_code_info':'read_status';
    const result=await runOperation(runtime,settings,command,options,activeJournal);output(JSON.stringify(publicOutput(result),null,2));
  };
  try{if(mutation)await withOpsLock(settings,execute);else await execute();return 0;}catch(error){
    const categories={ENOENT:'REQUIRED_PATH_OR_EXECUTABLE_MISSING',EACCES:'ACCESS_DENIED',EPERM:'ACCESS_DENIED',ECONNREFUSED:'CONNECTION_REFUSED',ETIMEDOUT:'CONNECTION_TIMEOUT',ERR_MODULE_NOT_FOUND:'RUNTIME_MODULE_UNAVAILABLE'};
    const errorCode=Object.hasOwn(categories,error?.code??'')?categories[error.code]:error instanceof SyntaxError?'MANAGEMENT_DATA_INVALID':'OPERATION_FAILED';
    const phase=activeJournal?.record.phase;
    const journalPhase=['created','backup','provision','reset','extend','completed'].includes(phase)?phase:undefined;
    errorOutput(JSON.stringify({error:'Operation failed; no automatic retry or force was performed.',errorCode,stage,journalPhase,dockerContext:settings.dockerContext,project:settings.project,operationId:options.operationId??null,recoveryRequired:!!error?.recoveryRequired,hints:['Check ./atoms config.',`Check Docker availability with: docker --context ${settings.dockerContext} info.`,...(mutation?[`Inspect private operation records in ${join(settings.privateDir,'ops-journal')}; resume only the same operation ID with identical parameters.`]:['Check configured privateDir and its owned 0700 permissions.'])]}));return 1;
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await main();
