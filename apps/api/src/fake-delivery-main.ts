import {createFakeDeliveryRuntime} from './fake-delivery-runtime.js';
if(process.env.NODE_ENV==='production')throw new Error('Synthetic delivery Runtime is development/test only');
const token=process.env.ATOMS_SERVICE_TOKEN??process.env.INTERNAL_SERVICE_TOKEN;
if(!token)throw new Error('ATOMS_SERVICE_TOKEN required');
const fake=createFakeDeliveryRuntime(token);
const port=Number(process.env.AGENT_PORT??4100);
await fake.app.listen({host:'127.0.0.1',port});
console.log(`Synthetic delivery HTTP Runtime listening on ${port}; real fixture bytes/ZIP hashes, no model/compiler/browser executed.`);
const stop=async()=>{await fake.app.close();process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);
