import path from 'node:path';import os from'node:os';import{existsSync}from'node:fs';import{mkdtemp}from'node:fs/promises';import{fileURLToPath}from'node:url';
import{assertControlledRealGuard,loadControlledBaseline,makeFakeControlledBaseline,runControlledRepair}from'./controlled-smoke.js';
const args=process.argv.slice(2);const real=assertControlledRealGuard(args,process.env);const value=(flag:string)=>{const i=args.indexOf(flag);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing ${flag}`);return args[i+1];};
const baseline=real?await loadControlledBaseline(path.resolve(value('--base-artifact')),value('--base-version')):await makeFakeControlledBaseline(await mkdtemp(path.join(os.tmpdir(),'atoms-controlled-fixture-')));
let apiKey:string|undefined;
if(real){const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');if(existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));if(!process.env.DEEPSEEK_API_KEY)throw new Error('Real key missing; no fallback.');apiKey=process.env.DEEPSEEK_API_KEY;}
console.log(JSON.stringify(await runControlledRepair({mode:real?'dsh':'fake',baseline,apiKey})));
