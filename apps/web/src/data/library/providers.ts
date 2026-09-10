import {z} from 'zod';
import {command,readLibrary} from './store';
export const purposes=['teacher','content','review'] as const;
export type Purpose=typeof purposes[number];
export const purposeLabels:Record<Purpose,string>={teacher:'localFlow.purposeTeacher',content:'localFlow.purposeContent',review:'localFlow.purposeReview'};
const endpointSchema=z.string().trim().url().transform(value=>value.replace(/\/+$/u,'')).refine(value=>{
 const url=new URL(value);return !url.username&&!url.password&&!url.search&&!url.hash&&(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)));
},'localFlow.endpointInvalid');
export const providerInputSchema=z.object({id:z.string().uuid(),expectedRevision:z.number().int().min(0),name:z.string().trim().min(1).max(80),kind:z.enum(['compatible','sensa']),endpoint:endpointSchema,model:z.string().trim().min(1).max(100)}).strict();
export type Provider={id:string;revision:number;name:string;kind:'compatible'|'sensa';endpoint:string;model:string};
export type ProviderSettings={revision:number;assignments:Partial<Record<Purpose,string>>};
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
export function clearAllCredentials(){credentials.clear();}
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
  const next:ProviderSettings={revision:current.revision+1,assignments:{...current.assignments}};
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
