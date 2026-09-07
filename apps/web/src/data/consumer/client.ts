import {calibrateRun} from '../replica/initialRuntime';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { accountContextSchema, consumerVersion, consumerWireVersion, consumerCanonicalizerVersion, planViewSchema, quantityResultSchema, revisionSchema, targetViewSchema, catalogTargetSchema, consumerRunSchema, consumerActivitySchema, consumerSummarySchema, canonicalConsumerJson, sensaLightweightInitialMaterializationContentSchema } from '@sensa/contracts/sensa';
import type { AccountContext, PlanView } from '@sensa/contracts/sensa';
import { applyQuantityResults,changeAccountReplica,loadAccountReplica,mergeTargets,mergeRuns } from '../replica/accountStore';

const projectUrl=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const publicKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined;
export const auth=projectUrl&&publicKey?createClient(projectUrl,publicKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}).auth:null;
const base=(import.meta.env.VITE_SENSA_API_URL as string|undefined)?.replace(/\/$/u,'')??'';
export class ConsumerClientError extends Error {constructor(public code:string,public status:number){super(code);}}
async function request(path:string,body?:unknown) {
  if(!auth)throw new ConsumerClientError('auth_not_configured',503);
  const {data,error}=await auth.getSession();if(error||!data.session)throw new ConsumerClientError('authentication_required',401);
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${data.session.access_token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw new ConsumerClientError(value.code??'temporarily_unavailable',response.status);
  return value as unknown;
}
export async function initializeAccount(subject:string) {
  const key=`sensa:installation:v3:${subject}`;let installationId=localStorage.getItem(key);
  if(!installationId){installationId=crypto.randomUUID();localStorage.setItem(key,installationId);}
  const envelope=z.object({contractVersion:z.literal(consumerVersion),scopeEpoch:revisionSchema,data:accountContextSchema}).passthrough().parse(await request('/sensa/account/session',{installationId,platform:'web',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}));
  // Cache only account metadata. No access/refresh token is stored in this replica.
  localStorage.setItem(`sensa:account:v3:${subject}`,JSON.stringify(envelope.data));
  return envelope.data;
}
export function cachedAccount(subject:string):AccountContext|null {
  try {const raw=localStorage.getItem(`sensa:account:v3:${subject}`);return raw?accountContextSchema.parse(JSON.parse(raw)):null;}catch{return null;}
}
const bootstrapSchema=z.object({scopeEpoch:revisionSchema,replicaId:z.string().uuid(),syncCursor:z.string(),plan:planViewSchema.nullable(),targets:z.array(targetViewSchema),runs:z.array(consumerRunSchema),activity:consumerActivitySchema.nullable()}).passthrough();
const resultSchema=z.object({results:z.array(quantityResultSchema),serverTime:z.string().datetime()}).passthrough();
const pullSchema=z.object({scopeEpoch:revisionSchema,changes:z.array(z.discriminatedUnion('entityType',[z.object({entityType:z.literal('plan'),snapshot:planViewSchema}).passthrough(),z.object({entityType:z.literal('target'),snapshot:targetViewSchema}).passthrough(),z.object({entityType:z.literal('run'),snapshot:consumerRunSchema}).passthrough(),z.object({entityType:z.literal('activity'),snapshot:consumerActivitySchema}).passthrough()])),nextCursor:z.string(),hasMore:z.boolean()}).passthrough();
const flights=new Map<string,Promise<Awaited<ReturnType<typeof loadAccountReplica>>>>();
export function syncAccount(account:AccountContext) {
  // Each caller has just saved its own work. A pass already reading its final home
  // snapshot cannot promise to include that work, so serialize a fresh pass.
  const previous=flights.get(account.accountId);
  const work=(previous?previous.catch(()=>undefined):Promise.resolve()).then(()=>drain(account)).finally(()=>{if(flights.get(account.accountId)===work)flights.delete(account.accountId);});
  flights.set(account.accountId,work);return work;
}
function newestPlan(current:PlanView|null,next:PlanView|null) {
  return !current||(next&&BigInt(next.revision)>=BigInt(current.revision))?next:current;
}
async function drain(account:AccountContext) {
  let state=await loadAccountReplica(account);
  async function bootstrap() {
    const value=bootstrapSchema.parse(await request('/sensa/sync/bootstrap',{wireVersion:consumerWireVersion,installationId:state.installationId,replicaId:state.replicaId}));
    state=await changeAccountReplica(account,current=>({...current,scopeEpoch:value.scopeEpoch,replicaId:value.replicaId,cursor:value.syncCursor,runs:mergeRuns(current.scopeEpoch===value.scopeEpoch?current.runs:{},value.runs),activity:value.activity,targets:mergeTargets(current.scopeEpoch===value.scopeEpoch?current.targets:{},value.targets),plan:current.scopeEpoch===value.scopeEpoch?newestPlan(current.plan,value.plan):value.plan}));
  }
  if(!state.replicaId||!state.cursor)await bootstrap();
  // Drain newly saved dependent steps too; retryable results end this pass without spinning.
  for(let batch=0;batch<10;batch++){
    state=await loadAccountReplica(account);
    const pending=state.outbox.filter(x=>x.state==='pending').slice(0,50);if(!pending.length)break;
    try {
      const pushed=resultSchema.parse(await request('/sensa/sync/push',{wireVersion:consumerWireVersion,canonicalizerVersion:consumerCanonicalizerVersion,scopeEpoch:state.scopeEpoch,replicaId:state.replicaId,operations:pending.map(x=>x.operation)}));
      if(pushed.results.length!==pending.length||new Set(pushed.results.map(r=>r.operationId)).size!==pending.length||pending.some(x=>!pushed.results.some(r=>r.operationId===x.operation.operationId)))throw new Error('结果不完整，已保留本机请求');
      state=await applyQuantityResults(account,pushed.results);
      for(const run of Object.values(state.runs))calibrateRun(run,pushed.serverTime);
      if(pushed.results.some(r=>r.status==='retryable'))break;
    } catch(e) {if(e instanceof ConsumerClientError&&e.code==='bootstrap_required'){await bootstrap();break;}else throw e;}
  }
  let more=true;
  while(more){
    try {
      const pulled=pullSchema.parse(await request('/sensa/sync/pull',{wireVersion:consumerWireVersion,scopeEpoch:state.scopeEpoch,replicaId:state.replicaId,cursor:state.cursor,limit:100}));
      state=await changeAccountReplica(account,current=>({...current,plan:newestPlan(current.plan,pulled.changes.filter(x=>x.entityType==='plan').at(-1)?.snapshot??null),targets:mergeTargets(current.targets,pulled.changes.filter(x=>x.entityType==='target').map(x=>x.snapshot)),runs:mergeRuns(current.runs,pulled.changes.filter(x=>x.entityType==='run').map(x=>x.snapshot)),activity:pulled.changes.filter(x=>x.entityType==='activity').at(-1)?.snapshot??current.activity,cursor:pulled.nextCursor,scopeEpoch:pulled.scopeEpoch}));more=pulled.hasMore;
    } catch(e){if(e instanceof ConsumerClientError&&e.code==='bootstrap_required'){await bootstrap();more=false;}else throw e;}
  }
  const home=z.object({contractVersion:z.literal(consumerVersion),data:z.object({plan:planViewSchema.nullable(),targets:z.array(targetViewSchema),runs:z.array(consumerRunSchema),activity:consumerActivitySchema.nullable(),summary:consumerSummarySchema.nullable(),counts:z.object({newAvailable:z.number(),initialContinuations:z.number(),dueReviews:z.number(),relearningReady:z.number(),relearningWaiting:z.number(),distinctExecutableTargets:z.number()}),emptyReason:z.enum(['no_targets','onboarding_required','preparing','blocked','daily_limit','none_due','waiting_relearning']).nullable()}).passthrough()}).passthrough().parse(await request('/sensa/home'));
  state=await changeAccountReplica(account,current=>({...current,plan:newestPlan(current.plan,home.data.plan),targets:mergeTargets(current.targets,home.data.targets),runs:mergeRuns(current.runs,home.data.runs),activity:home.data.activity,summary:home.data.summary??current.summary,homeCounts:home.data.counts}));
  return state;
}
export async function revokeSession(){
  try {await request('/sensa/account/session/revoke',{operationId:crypto.randomUUID()});}
  catch(e){if(!(e instanceof ConsumerClientError && (e.status===401||e.status===403)))throw e;}
  const result=await auth?.signOut({scope:'local'});if(result?.error)throw result.error;
}

export async function readCatalog(account:AccountContext,q='',cursor?:string){
  const params=new URLSearchParams({q,limit:'30'});if(cursor)params.set('cursor',cursor);
  const value=z.object({data:z.object({items:z.array(catalogTargetSchema),nextCursor:z.string().nullable()})}).passthrough().parse(await request('/sensa/catalog/targets?'+params));
  await changeAccountReplica(account,state=>({...state,catalog:value.data.items}));return value.data;
}
export async function readTarget(account:AccountContext,id:string,byCandidate=false){
  const value=z.object({data:targetViewSchema}).passthrough().parse(await request((byCandidate?'/sensa/catalog/targets/':'/sensa/learning-targets/')+id));
  await changeAccountReplica(account,state=>({...state,targets:mergeTargets(state.targets,[value.data])}));return value.data;
}
export async function checkMaterial(id:string){
  return z.object({data:z.object({id:z.string().uuid(),digest:z.string(),content:sensaLightweightInitialMaterializationContentSchema})}).passthrough().parse(await request('/sensa/materializations/'+id)).data;
}

export async function readMaterialAudio(materialId:string,digest:string){
 if(!auth)throw new ConsumerClientError('auth_not_configured',503);
 const {data}=await auth.getSession();if(!data.session)throw new ConsumerClientError('authentication_required',401);
 const response=await fetch(base+'/sensa/materializations/'+encodeURIComponent(materialId)+'/media/'+digest,{headers:{authorization:'Bearer '+data.session.access_token}});
 if(!response.ok)throw new ConsumerClientError('media_unavailable',response.status);
 const bytes=await response.arrayBuffer();const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==digest)throw new Error('Audio digest mismatch');return new Blob([bytes],{type:'audio/mpeg'});
}

export async function cacheRunMaterial(account:AccountContext,run:import('@sensa/contracts/sensa').ConsumerRun){
 const material=await checkMaterial(run.materializationId);
 const bytes=new TextEncoder().encode(canonicalConsumerJson(material.content));
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(material.digest!==run.materialDigest||digest!==run.materialDigest)throw new Error('学习材料校验失败');
 const audio:Record<string,Blob>={};
 for(const r of material.content.resources){const ref=r.contentPayload.audioUrl;if(typeof ref==='string'&&ref.startsWith('sensa-media:'))audio[ref.slice(12)]=await readMaterialAudio(material.id,ref.slice(12));}
 return changeAccountReplica(account,state=>({...state,materials:{...state.materials,[material.id]:material},audio:{...state.audio,...audio}}));
}
