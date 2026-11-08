/** Socket metadata only: never duplicate a Compose service/static IP or load a broker server. */
import{randomUUID}from'node:crypto';
const STAT_GID="require('node:fs').statSync('/var/run/docker.sock').gid";
export function verifiedExistingBroker(actual,project,imageId){const labels=actual?.Config?.Labels??{};return actual?.State?.Running===true&&actual.Image===imageId&&labels['atoms.owner']==='atoms-v03'&&labels['atoms.role']==='trusted-broker'&&labels['com.docker.compose.project']===project&&labels['com.docker.compose.service']==='broker';}
export function brokerMetadataArgs(project,imageId){return['run','--rm','--name',project+'-broker-metadata-'+randomUUID().slice(0,8),'--label','atoms.owner=atoms-v03','--label','atoms.purpose=socket-gid-metadata','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','1000:1000','--memory','134217728','--cpus','0.25','--pids-limit','32','--mount','type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly','--entrypoint','node',imageId,'-p',STAT_GID];}
export async function deriveBrokerSocketGid({project,imageId,docker}){
 const found=await docker(['ps','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service=broker','--format','{{.ID}}']);const ids=found.stdout.trim().split('\n').filter(Boolean);if(ids.length>1)throw new Error('Multiple live Broker containers; refusing ambiguous metadata lookup');let response,path;
 if(ids.length){const actual=JSON.parse((await docker(['inspect','--format','{{json .}}',ids[0]])).stdout);if(!verifiedExistingBroker(actual,project,imageId))throw new Error('Live Broker metadata identity does not match reviewed image/project/role');response=await docker(['exec',actual.Id,'node','-p',STAT_GID]);path='verified_existing_broker_exec';}
 else{response=await docker(brokerMetadataArgs(project,imageId));path='network_none_broker_image_oneoff';}
 const value=response.stdout.trim().split('\n').at(-1);if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>4294967295)throw new Error('Broker socket GID metadata is invalid');return{gid:Number(value),path};
}
