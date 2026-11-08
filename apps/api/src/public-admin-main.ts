/** Explicit stopped/drained administration. The host wrapper also checks the Compose service state. */
import {offlinePublicCode,initializePublicNamespace} from './public-admin.js';
import {readPublicDeployment} from './public-profile.js';
const [action,codeFile,ttl]=process.argv.slice(2);
if(process.env.M3_ADMIN_OFFLINE!=='1'||!process.env.API_DATA_DIR||!process.env.M3_DEPLOYMENT_FILE)throw new Error('Host must prove the API is stopped/drained before offline administration');
const deployment=readPublicDeployment(process.env.M3_DEPLOYMENT_FILE);
if(action==='init'){initializePublicNamespace(process.env.API_DATA_DIR,deployment);console.log('Fresh public namespace initialized; no identity or quota reset.');}
else if((action==='issue'||action==='revoke')&&codeFile){const result=offlinePublicCode(process.env.API_DATA_DIR,deployment,action,codeFile,Number(ttl??86400));console.log(JSON.stringify(result));}
else throw new Error('Expected init or issue/revoke with a private code-file path');
