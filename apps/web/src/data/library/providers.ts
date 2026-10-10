import {backgroundPreparation} from './backgroundPreparation';
import {localModelQueue} from './modelExecution';
import {z} from 'zod';
import {command,readLibrary} from './store';
import {providerInputSchema,purposes,type Purpose,type Provider,type ProviderSettings} from './providerContracts';
export {providerInputSchema,purposes} from './providerContracts';
export type {Purpose,Provider,ProviderSettings} from './providerContracts';
export const purposeLabels:Record<Purpose,string>={teacher:'localFlow.purposeTeacher',content:'localFlow.purposeContent',review:'localFlow.purposeReview',reference:'localFlow.purposeReference'};
/** Where a request for this connection actually runs. A locally stored `compatible`
 * connection is answered in this page; the Sensa service answers everything else. */
export const executionOf=(provider:Provider):'device'|'service'=>provider.kind==='sensa'?'service':'device';
// Never persisted or synchronized. A config revision change invalidates its credential.
const credentials=new Map<string,{revision:number;key:string}>();
export async function saveProvider(operationId:string,raw:z.input<typeof providerInputSchema>,key=''){
 const input=providerInputSchema.parse(raw);
 const provider=await command({id:operationId,kind:'provider.save',input},async tx=>{
  const current=await tx.get<Provider>('providers',input.id);
  if((current?.revision??0)!==input.expectedRevision)throw new Error('localFlow.connectionChanged');
  const {expectedRevision,...fields}=input;const next:Provider={...fields,revision:expectedRevision+1};tx.put('providers',input.id,next);return next;
 });
 const previous=credentials.get(provider.id);
 if(key.trim())credentials.set(provider.id,{revision:provider.revision,key:key.trim()});
 else if(previous?.revision!==provider.revision)credentials.delete(provider.id);
 return provider;
}
export async function setCredential(provider:Provider,key:string){
 if(!key.trim())throw new Error('localFlow.enterKey');
 const current=await readLibrary(tx=>tx.get<Provider>('providers',provider.id));
 if(current?.revision!==provider.revision)throw new Error('localFlow.keyConfigChanged');
 credentials.set(provider.id,{revision:provider.revision,key:key.trim()});
}
export function hasCredential(provider:Provider){return credentials.get(provider.id)?.revision===provider.revision;}
export function clearAllCredentials(){backgroundPreparation.cancelAll();credentials.clear();localModelQueue.clear();}
export function clearCredential(id:string){credentials.delete(id);}
export async function deleteProvider(operationId:string,provider:Provider){
 await command({id:operationId,kind:'provider.delete',input:{id:provider.id,revision:provider.revision}},async tx=>{
  const current=await tx.get<Provider>('providers',provider.id);if(!current)return;
  if(current.revision!==provider.revision)throw new Error('localFlow.connectionReload');
  tx.delete('providers',provider.id);
  const settings=await tx.get<ProviderSettings>('settings','providers')??{revision:0,assignments:{}};
  for(const purpose of purposes)if(settings.assignments[purpose]===provider.id)delete settings.assignments[purpose];
  tx.put('settings','providers',{...settings,revision:settings.revision+1});return null;
 });clearCredential(provider.id);
}
export async function assignProvider(operationId:string,purpose:Purpose,id:string|null,expectedRevision:number){
 if(!purposes.includes(purpose))throw new Error('localFlow.purposeUnsupported');
 return command({id:operationId,kind:'provider.assign',input:{purpose,id,expectedRevision}},async tx=>{
  const current=await tx.get<ProviderSettings>('settings','providers')??{revision:0,assignments:{}};
  if(current.revision!==expectedRevision)throw new Error('localFlow.assignmentChanged');
  if(id&&!await tx.get('providers',id))throw new Error('localFlow.connectionMissing');
  const next:ProviderSettings={...current,revision:current.revision+1,assignments:{...current.assignments}};
  if(id)next.assignments[purpose]=id;else delete next.assignments[purpose];tx.put('settings','providers',next);return next;
 });
}
// This metadata is pinned in saved requests; translate the name only when presenting it.
export const defaultSensaProvider:Provider={id:'00000000-0000-4000-8000-000000000002',revision:1,name:'Sensa 服务',kind:'sensa',endpoint:(import.meta.env.VITE_SENSA_API_URL??location.origin).replace(/\/+$/u,''),model:'sensa-managed'};
export const providerSnapshot=()=>readLibrary(async tx=>({providers:[defaultSensaProvider,...await tx.all<Provider>('providers')],settings:await tx.get<ProviderSettings>('settings','providers')??{revision:0,assignments:{}}}));
export async function selectedProvider(purpose:Purpose){
 const snapshot=await providerSnapshot();const found=snapshot.providers.find(p=>p.id===(snapshot.settings.assignments[purpose]??defaultSensaProvider.id));
 if(!found)throw new Error('localFlow.selectProvider');return found;
}
export async function providerCredential(provider:Provider){
 const current=await readLibrary(tx=>tx.get<Provider>('providers',provider.id));
 if(current?.revision!==provider.revision)throw new Error('localFlow.requestConfigChanged');
 const entry=credentials.get(provider.id);if(!entry||entry.revision!==provider.revision)throw new Error('localFlow.keyRequired');
 return entry.key;
}

export async function setModelReviewEnabled(operationId:string,enabled:boolean,expectedRevision:number){
 return command({id:operationId,kind:'provider.review-policy',input:{enabled,expectedRevision}},async tx=>{
  const current=await tx.get<ProviderSettings>('settings','providers')??{revision:0,assignments:{}};
  if(current.revision!==expectedRevision)throw new Error('localFlow.assignmentChanged');
  const next={...current,revision:current.revision+1,modelReviewEnabled:enabled};
  tx.put('settings','providers',next);return next;
 });
}

export async function selectedReviewProvider():Promise<Provider|null>{
 const {settings}=await providerSnapshot();
 return settings.modelReviewEnabled===true?selectedProvider('review'):null;
}

/** Lists models without generating content. Credentials stay on this device. */
export async function listProviderModels(provider:Provider):Promise<string[]>{
 if(provider.kind!=='compatible')throw Error('localFlow.purposeUnsupported');
 const key=await providerCredential(provider);
 return localModelQueue.run({id:crypto.randomUUID(),provider:new URL(provider.endpoint).origin,model:provider.model,purpose:'probe',execution:'device'},AbortSignal.timeout(15000),async signal=>{
  const response=await fetch(provider.endpoint+'/models',{headers:{authorization:'Bearer '+key},redirect:'error',credentials:'omit',signal});
  if(!response.ok)throw Error('localFlow.modelCatalogUnavailable');
  if(!response.body)throw Error('localFlow.modelCatalogUnavailable');
  const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>512000)throw Error('localFlow.responseLimit');chunks.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const data=z.object({data:z.array(z.object({id:z.string().min(1).max(100)})).max(5000)}).parse(JSON.parse(new TextDecoder().decode(bytes)));
  if((await providerSnapshot()).providers.find(p=>p.id===provider.id)?.revision!==provider.revision)throw Error('localFlow.staleConfigResult');
  return [...new Set(data.data.map(m=>m.id))].sort();
 });
}
