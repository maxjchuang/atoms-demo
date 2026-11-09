import { resolve } from 'node:path';
import {readFileSync,statSync} from 'node:fs';
import {readPublicDeployment} from './public-profile.js';
import { randomBytes } from 'node:crypto';
import type { ApiOptions } from './server.js';

export function configFromEnvironment(): ApiOptions & { port: number; previewPort: number; host: string } {
  const production = process.env.NODE_ENV === 'production';
  const projectLimitText=process.env.ATOMS_DEMO_PROJECT_LIMIT??'10',demoProjectLimit=Number(projectLimitText);
  if(!/^[1-9]\d*$/.test(projectLimitText)||!Number.isSafeInteger(demoProjectLimit))throw new Error('ATOMS_DEMO_PROJECT_LIMIT must be a positive safe integer');
  const publicMode=process.env.ATOMS_PUBLIC_DEMO==='1';
  const readSecret=(name:string)=>{const file=process.env[name+'_FILE'];if(file){if(statSync(file).mode&0o077)throw new Error('Secret files must not be group/world readable');return readFileSync(file,'utf8').trim();}if(publicMode)throw new Error('Public profile requires file-backed internal secrets');return process.env[name];};
  const deploymentFile=process.env.M3_DEPLOYMENT_FILE;if(publicMode&&(!deploymentFile||!process.env.API_DATA_DIR))throw new Error('Public profile requires explicit deployment file and fresh API_DATA_DIR');const initial=publicMode?readPublicDeployment(deploymentFile!):undefined;const publicProfile=initial?{deployment(){const next=readPublicDeployment(deploymentFile!);if(next.dataNamespaceId!==initial.dataNamespaceId)throw new Error('Public namespace cannot change in place');return next;},sessionTtlSeconds:3600,previewTtlSeconds:900}:undefined;
  const demo = process.env.ATOMS_ENABLE_DEMO === 'true' || process.env.API_ENABLE_DEMO_SEED === '1';
  if ((production||publicMode) && demo) throw new Error('Development demo seeding is not allowed in production');
  const serviceToken=readSecret('ATOMS_SERVICE_TOKEN')??process.env.INTERNAL_SERVICE_TOKEN;
  const previewSecret=readSecret('PREVIEW_SECRET');
  if (!serviceToken || serviceToken.length < 16) throw new Error('Set ATOMS_SERVICE_TOKEN (at least 16 characters)');
  if (production && (!previewSecret || previewSecret.length < 32)) throw new Error('Set PREVIEW_SECRET (at least 32 characters)');
  return {
    publicProfile,trustedProxy:publicMode?(process.env.M3_TRUST_PROXY??'').split(',').filter(Boolean):undefined,
    dataDir: resolve(process.env.API_DATA_DIR ?? process.env.ATOMS_DATA_DIR ?? '../../data/api'),
    deliveryBudget:{maxWallTimeMs:Number(process.env.M2_MAX_ACTIVE_MS??900000),maxModelSteps:Number(process.env.M2_MAX_MODEL_STEPS??8),maxInputTokens:Number(process.env.M2_MAX_INPUT_TOKENS??65536),maxOutputTokens:Number(process.env.M2_MAX_OUTPUT_TOKENS??24576)},
    deliveryToolchainId: process.env.M2_TOOLCHAIN_ID??'toolchain_react_v1',
    agentUrl: process.env.AGENT_URL ?? 'http://127.0.0.1:4100', serviceToken,
    previewSecret: previewSecret ?? randomBytes(32).toString('hex'),
    previewOrigin: initial?.previewOrigin??process.env.PREVIEW_PUBLIC_URL ?? process.env.PREVIEW_ORIGIN ?? 'http://127.0.0.1:3002',
    allowedOrigins: (process.env.ATOMS_ALLOWED_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').filter(Boolean),
    secureCookies: production||publicMode,
    demoProjectLimit,
    demoCode: demo ? process.env.ATOMS_DEMO_CODE ?? process.env.API_DEMO_CODE ?? 'atoms-demo-2026' : undefined,
    port: Number(process.env.API_PORT ?? 3001), previewPort: Number(process.env.PREVIEW_PORT ?? 3002),
    host: process.env.API_HOST ?? '127.0.0.1',
  };
}
