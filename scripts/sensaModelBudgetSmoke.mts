import assert from 'node:assert/strict';
import {createNativeAgentRoutes} from '../apps/api/src/sensa/agent/native.ts';
import {semanticDigest} from '../apps/api/src/sensa/personal/nativeSemantic.ts';
import {selectReadingConnection} from '../apps/api/src/sensa/reading/service.ts';
let reserved=0,called=0;
const connection={id:crypto.randomUUID(),name:'fixture',enabled:true,baseUrl:'https://fixture.invalid',model:'fixture',apiKey:'synthetic'};
const app=createNativeAgentRoutes({authorize:async()=>connection,reserve:async()=>{reserved++;},complete:async()=>{called++;return {};}});
const payload={id:crypto.randomUUID(),purpose:'teacher',body:{model:'fixture',messages:[{role:'system',content:'fixture'},{role:'user',content:'中'.repeat(100000)}],max_tokens:100,stream:false}};
const r=await app.request('/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,inputDigest:await semanticDigest(payload)})});
assert.equal(r.status,413);assert.equal((await r.json() as any).code,'model_input_too_large');assert.equal(reserved,0);assert.equal(called,0);
const old=process.env.SENSA_MANAGED_MODELS_PAUSED;process.env.SENSA_MANAGED_MODELS_PAUSED='1';
try{assert.throws(()=>selectReadingConnection({providers:[],assignments:{meaning:null} as any},'meaning'),/managed_models_paused/);}finally{if(old===undefined)delete process.env.SENSA_MANAGED_MODELS_PAUSED;else process.env.SENSA_MANAGED_MODELS_PAUSED=old;}
console.log('PASS: oversized UTF-8 model context rejected before quota/provider calls; managed-service pause blocks default model selection.');
