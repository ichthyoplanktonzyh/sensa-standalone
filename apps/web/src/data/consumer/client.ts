import {personalMeaningViewSchema,semanticLookupViewSchema} from '@sensa/contracts/sensa';
import type {CaptureSnapshot} from '@sensa/contracts/sensa';
import {intakeViewSchema} from '@sensa/contracts/sensa';
import {calibrateRun,calibrateClock,clockSessionId} from '../replica/clock';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { accountContextSchema, consumerVersion, consumerWireVersion, consumerCanonicalizerVersion, planViewSchema, quantityResultSchema, revisionSchema, targetViewSchema, catalogTargetSchema, consumerRunSchema, consumerActivitySchema, consumerSummarySchema, checkInViewSchema, canonicalConsumerJson, sensaLightweightInitialMaterializationContentSchema } from '@sensa/contracts/sensa';
import type { AccountContext, PlanView } from '@sensa/contracts/sensa';
import { applyQuantityResults,changeAccountReplica,loadAccountReplica,mergeTargets,mergeRuns } from '../replica/accountStore';

const projectUrl=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const publicKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined;
export const auth=projectUrl&&publicKey?createClient(projectUrl,publicKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}).auth:null;
const base=(import.meta.env.VITE_SENSA_API_URL as string|undefined)?.replace(/\/$/u,'')??'';
export class ConsumerClientError extends Error {constructor(public code:string,public status:number){super(code);}}
// Bind each recovered context to its authenticated subject, never to a mutable
// global current account. Tokens remain exclusively in Supabase's auth store.
const subjects=new WeakMap<AccountContext,string>();
async function sessionFor(scope:AccountContext|string) {
  if(!auth)throw new ConsumerClientError('auth_not_configured',503);
  const expected=typeof scope==='string'?scope:subjects.get(scope);
  const {data,error}=await auth.getSession();
  if(error||!data.session)throw new ConsumerClientError('authentication_required',401);
  if(!expected||data.session.user.id!==expected)throw new ConsumerClientError('account_changed',401);
  return data.session;
}
async function request(scope:AccountContext|string,path:string,body?:unknown) {
  const session=await sessionFor(scope);
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw new ConsumerClientError(value.code??'temporarily_unavailable',response.status);
  return value as unknown;
}
export async function initializeAccount(subject:string) {
  const key=`sensa:installation:v3:${subject}`;let installationId=localStorage.getItem(key);
  if(!installationId){installationId=crypto.randomUUID();localStorage.setItem(key,installationId);}
  const envelope=z.object({contractVersion:z.literal(consumerVersion),scopeEpoch:revisionSchema,serverTime:z.string().datetime(),data:accountContextSchema}).passthrough().parse(await request(subject,'/sensa/account/session',{installationId,clockSessionId,platform:'web',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}));
  await sessionFor(subject);
  subjects.set(envelope.data,subject);
  calibrateClock(envelope.data.clockGrant,envelope.serverTime);
  // Cache only account metadata. No access/refresh token is stored in this replica.
  localStorage.setItem(`sensa:account:v3:${subject}`,JSON.stringify(envelope.data));
  return envelope.data;
}
export function cachedAccount(subject:string):AccountContext|null {
  try {const raw=localStorage.getItem(`sensa:account:v3:${subject}`);if(!raw)return null;const account=accountContextSchema.parse(JSON.parse(raw));subjects.set(account,subject);return account;}catch{return null;}
}
const bootstrapSchema=z.object({scopeEpoch:revisionSchema,replicaId:z.string().uuid(),syncCursor:z.string(),plan:planViewSchema.nullable(),targets:z.array(targetViewSchema),runs:z.array(consumerRunSchema),activity:consumerActivitySchema.nullable(),checkins:z.array(checkInViewSchema),intakes:z.array(intakeViewSchema),meanings:z.array(personalMeaningViewSchema)}).passthrough();
const resultSchema=z.object({results:z.array(quantityResultSchema),serverTime:z.string().datetime()}).passthrough();
const pullSchema=z.object({scopeEpoch:revisionSchema,changes:z.array(z.discriminatedUnion('entityType',[z.object({entityType:z.literal('personal_meaning'),snapshot:personalMeaningViewSchema}).passthrough(),z.object({entityType:z.literal('intake'),snapshot:intakeViewSchema}).passthrough(),z.object({entityType:z.literal('plan'),snapshot:planViewSchema}).passthrough(),z.object({entityType:z.literal('target'),snapshot:targetViewSchema}).passthrough(),z.object({entityType:z.literal('run'),snapshot:consumerRunSchema}).passthrough(),z.object({entityType:z.literal('activity'),snapshot:consumerActivitySchema}).passthrough(),z.object({entityType:z.literal('check_in'),snapshot:checkInViewSchema}).passthrough()])),nextCursor:z.string(),hasMore:z.boolean()}).passthrough();
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
    const value=bootstrapSchema.parse(await request(account,'/sensa/sync/bootstrap',{wireVersion:consumerWireVersion,installationId:state.installationId,replicaId:state.replicaId}));
    state=await changeAccountReplica(account,current=>({...current,meanings:Object.fromEntries(value.meanings.map(x=>[x.id,x])),intakes:Object.fromEntries(value.intakes.map(x=>[x.id,x])),scopeEpoch:value.scopeEpoch,replicaId:value.replicaId,cursor:value.syncCursor,runs:mergeRuns(current.scopeEpoch===value.scopeEpoch?current.runs:{},value.runs),activity:value.activity,checkins:{...current.checkins,...Object.fromEntries(value.checkins.map(x=>[x.date,x]))},targets:mergeTargets(current.scopeEpoch===value.scopeEpoch?current.targets:{},value.targets),plan:current.scopeEpoch===value.scopeEpoch?newestPlan(current.plan,value.plan):value.plan}));
  }
  if(!state.replicaId||!state.cursor)await bootstrap();
  // Drain newly saved dependent steps too; retryable results end this pass without spinning.
  const deferred=new Set<string>();
  for(let batch=0;batch<10;batch++){
    state=await loadAccountReplica(account);
    const pending=state.outbox.filter(x=>x.state==='pending'&&!deferred.has(x.operation.operationId)).slice(0,50);if(!pending.length)break;
    try {
      const pushed=resultSchema.parse(await request(account,'/sensa/sync/push',{wireVersion:consumerWireVersion,canonicalizerVersion:consumerCanonicalizerVersion,scopeEpoch:state.scopeEpoch,replicaId:state.replicaId,operations:pending.map(x=>x.operation)}));
      if(pushed.results.length!==pending.length||new Set(pushed.results.map(r=>r.operationId)).size!==pending.length||pending.some(x=>!pushed.results.some(r=>r.operationId===x.operation.operationId)))throw new Error('结果不完整，已保留本机请求');
      state=await applyQuantityResults(account,pushed.results);
      for(const run of Object.values(state.runs))calibrateRun(run,pushed.serverTime);
      for(const result of pushed.results)if(result.status==='retryable')deferred.add(result.operationId);
    } catch(e) {if(e instanceof ConsumerClientError&&e.code==='bootstrap_required'){await bootstrap();break;}else throw e;}
  }
  let more=true;
  while(more){
    try {
      const pulled=pullSchema.parse(await request(account,'/sensa/sync/pull',{wireVersion:consumerWireVersion,scopeEpoch:state.scopeEpoch,replicaId:state.replicaId,cursor:state.cursor,limit:100}));
      state=await changeAccountReplica(account,current=>({...current,plan:newestPlan(current.plan,pulled.changes.filter(x=>x.entityType==='plan').at(-1)?.snapshot??null),targets:mergeTargets(current.targets,pulled.changes.filter(x=>x.entityType==='target').map(x=>x.snapshot)),runs:mergeRuns(current.runs,pulled.changes.filter(x=>x.entityType==='run').map(x=>x.snapshot)),activity:pulled.changes.filter(x=>x.entityType==='activity').at(-1)?.snapshot??current.activity,checkins:{...current.checkins,...Object.fromEntries(pulled.changes.filter(x=>x.entityType==='check_in').map(x=>[x.snapshot.date,x.snapshot]))},meanings:{...current.meanings,...Object.fromEntries(pulled.changes.filter(x=>x.entityType==='personal_meaning').map(x=>[x.snapshot.id,x.snapshot]))},intakes:{...current.intakes,...Object.fromEntries(pulled.changes.filter(x=>x.entityType==='intake').map(x=>[x.snapshot.id,x.snapshot]))},cursor:pulled.nextCursor,scopeEpoch:pulled.scopeEpoch}));more=pulled.hasMore;
    } catch(e){if(e instanceof ConsumerClientError&&e.code==='bootstrap_required'){await bootstrap();more=false;}else throw e;}
  }
  const home=z.object({contractVersion:z.literal(consumerVersion),data:z.object({plan:planViewSchema.nullable(),targets:z.array(targetViewSchema),runs:z.array(consumerRunSchema),activity:consumerActivitySchema.nullable(),summary:consumerSummarySchema.nullable(),checkins:z.array(checkInViewSchema),counts:z.object({newAvailable:z.number(),initialContinuations:z.number(),dueReviews:z.number(),relearningReady:z.number(),relearningWaiting:z.number(),distinctExecutableTargets:z.number()}),emptyReason:z.enum(['no_targets','onboarding_required','preparing','blocked','daily_limit','none_due','waiting_relearning']).nullable()}).passthrough()}).passthrough().parse(await request(account,'/sensa/home'));
  state=await changeAccountReplica(account,current=>({...current,plan:newestPlan(current.plan,home.data.plan),targets:mergeTargets(current.targets,home.data.targets),runs:mergeRuns(current.runs,home.data.runs),activity:home.data.activity,summary:home.data.summary??current.summary,homeCounts:home.data.counts,checkins:{...current.checkins,...Object.fromEntries(home.data.checkins.map(x=>[x.date,x]))}}));
  return state;
}
export async function revokeSession(account:AccountContext){
  try {await request(account,'/sensa/account/session/revoke',{operationId:crypto.randomUUID()});}
  catch(e){if(!(e instanceof ConsumerClientError && (e.status===401||e.status===403)))throw e;}
  await sessionFor(account);
  const result=await auth?.signOut({scope:'local'});if(result?.error)throw result.error;
}

export async function readCatalog(account:AccountContext,q='',cursor?:string){
  const params=new URLSearchParams({q,limit:'30'});if(cursor)params.set('cursor',cursor);
  const value=z.object({data:z.object({items:z.array(catalogTargetSchema),nextCursor:z.string().nullable()})}).passthrough().parse(await request(account,'/sensa/catalog/targets?'+params));
  await changeAccountReplica(account,state=>({...state,catalog:value.data.items}));return value.data;
}
export async function readTarget(account:AccountContext,id:string,byCandidate=false){
  const value=z.object({data:targetViewSchema}).passthrough().parse(await request(account,(byCandidate?'/sensa/catalog/targets/':'/sensa/learning-targets/')+id));
  await changeAccountReplica(account,state=>({...state,targets:mergeTargets(state.targets,[value.data])}));return value.data;
}
export async function checkMaterial(account:AccountContext,id:string){
  return z.object({data:z.object({id:z.string().uuid(),digest:z.string(),content:sensaLightweightInitialMaterializationContentSchema})}).passthrough().parse(await request(account,'/sensa/materializations/'+id)).data;
}

export async function readMaterialAudio(account:AccountContext,materialId:string,digest:string){
 const session=await sessionFor(account);
 const response=await fetch(base+'/sensa/materializations/'+encodeURIComponent(materialId)+'/media/'+digest,{headers:{authorization:'Bearer '+session.access_token}});
 if(!response.ok)throw new ConsumerClientError('media_unavailable',response.status);
 const bytes=await response.arrayBuffer();const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==digest)throw new Error('Audio digest mismatch');return new Blob([bytes],{type:'audio/mpeg'});
}

export async function cacheRunMaterial(account:AccountContext,run:import('@sensa/contracts/sensa').ConsumerRun){
 const material=await checkMaterial(account,run.materializationId);
 const bytes=new TextEncoder().encode(canonicalConsumerJson(material.content));
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(material.digest!==run.materialDigest||digest!==run.materialDigest)throw new Error('学习材料校验失败');
 const audio:Record<string,Blob>={};
 for(const r of material.content.resources){const ref=r.contentPayload.audioUrl;if(typeof ref==='string'&&ref.startsWith('sensa-media:')){try{audio[ref.slice(12)]=await readMaterialAudio(account,material.id,ref.slice(12));}catch{/* Optional audio failure must not discard validated text or block learning. */}}}
 return changeAccountReplica(account,state=>({...state,materials:{...state.materials,[material.id]:material},audio:{...state.audio,...audio}}));
}

export async function connectExtension(account:AccountContext,input:unknown){return z.object({redirectUri:z.string().url()}).strict().parse(await request(account,'/sensa/extension/authorize',input));}

export async function lookupSemantic(account:AccountContext,snapshot:CaptureSnapshot,id:string,clarification?:{previousLookupId:string;text:string}){return semanticLookupViewSchema.parse(await request(account,'/sensa/semantic/lookups',{id,snapshot,...(clarification?{clarification}:{})}));}
export async function checkSemanticLookup(account:AccountContext,id:string){return semanticLookupViewSchema.parse(await request(account,'/sensa/semantic/lookups/'+id));}

export async function preparePersonalTarget(account:AccountContext,targetId:string){const value=z.object({data:targetViewSchema}).passthrough().parse(await request(account,'/sensa/provisioning/'+targetId+'/advance',{}));return changeAccountReplica(account,state=>({...state,targets:mergeTargets(state.targets,[value.data])}));}

export async function intakeSemanticLookup(account:AccountContext,id:string){return semanticLookupViewSchema.nullable().parse(await request(account,'/sensa/intakes/'+id+'/lookup'));}
