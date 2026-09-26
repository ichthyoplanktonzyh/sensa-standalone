import {z} from 'zod';
import {
 defaultReadingAssignments,readingAssignmentsSchema,readingProviderSchema,readingSettingsInputSchema,
 readingRequestSchema,readingSystemPrompt,semanticProposalSchema,semanticLookupViewSchema,
 semanticResolutionPrompt,canonicalConsumerJson,
 type ReadingRequest,type ReadingSettingsInput,type ReadingSettingsView,type CaptureSnapshot,
 type SemanticLookupView,type SensaFormalPinnedLanguageContext,
} from '@sensa/contracts/sensa';

const storageKey='sensaLocalModels';
const connectionSchema=readingProviderSchema.extend({apiKey:z.string().trim().min(1).max(4096)});
const stateSchema=z.object({revision:z.number().int().nonnegative(),providers:z.array(connectionSchema).max(12),assignments:readingAssignmentsSchema}).strict();
type State=z.infer<typeof stateSchema>;
type Connection=State['providers'][number];
const empty=():State=>({revision:0,providers:[],assignments:{...defaultReadingAssignments}});
const originFor=(baseUrl:string)=>new URL(baseUrl).origin+'/*';
let serial:Promise<unknown>=Promise.resolve();
const locked=<T>(work:()=>Promise<T>):Promise<T>=>{const next=serial.catch(()=>undefined).then(work);serial=next;return next;};

async function load():Promise<State>{
 const raw=(await chrome.storage.local.get(storageKey))[storageKey];
 return raw===undefined?empty():stateSchema.parse(raw);
}

async function permitted(connection:Connection){
 if(!await chrome.permissions.contains({origins:[originFor(connection.baseUrl)]}))throw new Error('provider_permission_required');
}

export async function localSettings():Promise<ReadingSettingsView>{
 const state=await load();
 return {revision:state.revision,providers:state.providers.map(({apiKey,...provider})=>({...provider,keyConfigured:!!apiKey})),assignments:state.assignments,configured:true,allowedOrigins:[...new Set(state.providers.map(provider=>new URL(provider.baseUrl).origin))]};
}

export async function saveLocalSettings(raw:unknown):Promise<ReadingSettingsView>{return locked(async()=>{
 const input:ReadingSettingsInput=readingSettingsInputSchema.parse(raw);
 const state=await load();
 if(input.expectedRevision!==state.revision)throw new Error('settings_conflict');
 const providers=input.providers.map(provider=>{
  const old=state.providers.find(row=>row.id===provider.id&&row.baseUrl===provider.baseUrl);
  const apiKey=provider.apiKey??old?.apiKey;
  if(!apiKey)throw new Error('provider_key_required');
  return connectionSchema.parse({...provider,apiKey});
 });
 for(const provider of providers.filter(provider=>provider.enabled))await permitted(provider);
 const next=stateSchema.parse({revision:state.revision+1,providers,assignments:input.assignments});
 await chrome.storage.local.set({[storageKey]:next});
 return localSettings();
});}

async function byId(providerId:string){
 const found=(await load()).providers.find(provider=>provider.id===providerId&&provider.enabled);
 if(!found)throw new Error('provider_not_found');
 await permitted(found);
 return found;
}

export async function localConnectionFor(feature:keyof State['assignments']):Promise<Connection|null>{
 const state=await load(),id=state.assignments[feature];
 if(!id)return null;
 const found=state.providers.find(provider=>provider.id===id&&provider.enabled);
 if(!found)throw new Error('provider_unavailable');
 await permitted(found);
 return found;
}

async function boundedJson(response:Response,maxBytes:number){
 if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw new Error(response.status===401||response.status===403?'model_auth_failed':response.status===429?'model_rate_limited':'provider_unavailable');}
 if(!response.body)throw new Error('provider_invalid_response');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>maxBytes)throw new Error('provider_invalid_response');chunks.push(next.value);}}
 finally{await reader.cancel().catch(()=>undefined);}
 const joined=new Uint8Array(length);let at=0;for(const chunk of chunks){joined.set(chunk,at);at+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));}catch{throw new Error('provider_invalid_response');}
}

async function completion(connection:Connection,messages:{role:'system'|'user';content:string}[],json=false,signal?:AbortSignal){
 await permitted(connection);
 const base=connection.baseUrl.replace(/\/+$/u,'');
 const response=await fetch(base+'/chat/completions',{
  method:'POST',redirect:'error',headers:{authorization:'Bearer '+connection.apiKey,'content-type':'application/json'},
  body:JSON.stringify({model:connection.model,max_tokens:3000,stream:false,messages,...(json?{response_format:{type:'json_object'}}:{}),...(connection.temperature===undefined?{}:{temperature:connection.temperature})}),
  signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(45000)]),
 });
 const value=await boundedJson(response,1000000);
 const text=value?.choices?.[0]?.message?.content;
 if(typeof text!=='string'||!text.trim()||text.length>24000)throw new Error('provider_invalid_response');
 return text;
}

export async function localModels(providerId:string){
 const connection=await byId(providerId),base=connection.baseUrl.replace(/\/+$/u,'');
 const response=await fetch(base+'/models',{redirect:'error',headers:{authorization:'Bearer '+connection.apiKey},signal:AbortSignal.timeout(15000)});
 const value=await boundedJson(response,200000);
 return {models:z.array(z.object({id:z.string().min(1).max(160)})).max(1000).parse(value.data).map(item=>item.id)};
}

export async function testLocalModel(providerId:string,signal?:AbortSignal){
 const connection=await byId(providerId);
 try{return {status:'ready' as const,text:await completion(connection,[{role:'system',content:'Reply with OK.'},{role:'user',content:'Connection test'}],false,signal),error:null};}
 catch(error){return {status:'failed' as const,text:null,error:error instanceof Error?error.message:'provider_unavailable'};}
}

export async function runLocalReading(connection:Connection,raw:unknown,signal?:AbortSignal){
 const input:ReadingRequest=readingRequestSchema.parse(raw);
 const user=input.feature==='action'?{text:input.text,context:input.context,learnerInstruction:input.instruction}:{text:input.text,context:input.context};
 try{return {status:'ready' as const,text:await completion(connection,[{role:'system',content:readingSystemPrompt(input)},{role:'user',content:JSON.stringify(user)}],false,signal),error:null};}
 catch(error){return {status:'failed' as const,text:null,error:error instanceof Error?error.message:'provider_unavailable'};}
}

async function digest(value:unknown){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(value))));
 return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function runLocalLookup(connection:Connection,id:string,snapshot:CaptureSnapshot,languages:SensaFormalPinnedLanguageContext,signal?:AbortSignal):Promise<SemanticLookupView>{
 const raw=await completion(connection,[
  {role:'system',content:semanticResolutionPrompt(snapshot,languages)},
  {role:'user',content:JSON.stringify({sentence:snapshot.sentence,expression:snapshot.expression,language:snapshot.language,languages,learnerFocus:null})},
 ],true,signal);
 let decoded:unknown;try{decoded=JSON.parse(raw);}catch{throw new Error('model_invalid_response');}
 let proposal;
 try{proposal=(decoded as {proposal?:unknown})?.proposal===null?null:semanticProposalSchema.parse((decoded as {proposal?:unknown})?.proposal);}
 catch{throw new Error('model_invalid_response');}
 if(proposal&&(!snapshot.expression||proposal.expression.surface!==snapshot.expression.text||proposal.expression.language!==snapshot.language))throw new Error('model_invalid_response');
 const provenance=proposal?{provider:new URL(connection.baseUrl).origin,model:connection.model,policyVersion:'sensa-semantic-v4' as const,inputDigest:await digest({snapshot,languages}),outputDigest:await digest(proposal)}:null;
 return semanticLookupViewSchema.parse({id,revision:'1',status:proposal?'ready':'unresolved',snapshot,focus:null,proposal,reason:proposal?null:'meaning_unresolved',expiresAt:new Date(Date.now()+86400000).toISOString(),provenance});
}
