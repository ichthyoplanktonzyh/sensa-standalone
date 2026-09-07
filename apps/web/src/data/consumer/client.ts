import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { accountContextSchema, consumerVersion, consumerWireVersion, consumerCanonicalizerVersion, planViewSchema, quantityResultSchema, revisionSchema } from '@sensa/contracts/sensa';
import type { AccountContext, PlanView } from '@sensa/contracts/sensa';
import { applyQuantityResults,changeAccountReplica,loadAccountReplica } from '../replica/accountStore';

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
const bootstrapSchema=z.object({scopeEpoch:revisionSchema,replicaId:z.string().uuid(),syncCursor:z.string(),plan:planViewSchema.nullable()}).passthrough();
const resultSchema=z.object({results:z.array(quantityResultSchema)}).passthrough();
const pullSchema=z.object({scopeEpoch:revisionSchema,changes:z.array(z.object({entityType:z.literal('plan'),snapshot:planViewSchema}).passthrough()),nextCursor:z.string(),hasMore:z.boolean()}).passthrough();
const flights=new Map<string,Promise<Awaited<ReturnType<typeof loadAccountReplica>>>>();
export function syncAccount(account:AccountContext) {
  const running=flights.get(account.accountId);if(running)return running;
  const work=drain(account).finally(()=>flights.delete(account.accountId));flights.set(account.accountId,work);return work;
}
function newestPlan(current:PlanView|null,next:PlanView|null) {
  return !current||(next&&BigInt(next.revision)>=BigInt(current.revision))?next:current;
}
async function drain(account:AccountContext) {
  let state=await loadAccountReplica(account);
  async function bootstrap() {
    const value=bootstrapSchema.parse(await request('/sensa/sync/bootstrap',{wireVersion:consumerWireVersion,installationId:state.installationId,replicaId:state.replicaId}));
    state=await changeAccountReplica(account,current=>({...current,scopeEpoch:value.scopeEpoch,replicaId:value.replicaId,cursor:value.syncCursor,plan:current.scopeEpoch===value.scopeEpoch?newestPlan(current.plan,value.plan):value.plan}));
  }
  if(!state.replicaId||!state.cursor)await bootstrap();
  const pending=state.outbox.filter(x=>x.state==='pending').slice(0,50);
  if(pending.length){
    try {
      const pushed=resultSchema.parse(await request('/sensa/sync/push',{wireVersion:consumerWireVersion,canonicalizerVersion:consumerCanonicalizerVersion,scopeEpoch:state.scopeEpoch,replicaId:state.replicaId,operations:pending.map(x=>x.operation)}));
      if(pushed.results.length!==pending.length||new Set(pushed.results.map(r=>r.operationId)).size!==pending.length||pending.some(x=>!pushed.results.some(r=>r.operationId===x.operation.operationId)))throw new Error('结果不完整，已保留本机请求');
      state=await applyQuantityResults(account,pushed.results);
    } catch(e) {if(e instanceof ConsumerClientError&&e.code==='bootstrap_required')await bootstrap();else throw e;}
  }
  let more=true;
  while(more){
    try {
      const pulled=pullSchema.parse(await request('/sensa/sync/pull',{wireVersion:consumerWireVersion,scopeEpoch:state.scopeEpoch,replicaId:state.replicaId,cursor:state.cursor,limit:100}));
      state=await changeAccountReplica(account,current=>({...current,plan:newestPlan(current.plan,pulled.changes.at(-1)?.snapshot??null),cursor:pulled.nextCursor,scopeEpoch:pulled.scopeEpoch}));more=pulled.hasMore;
    } catch(e){if(e instanceof ConsumerClientError&&e.code==='bootstrap_required'){await bootstrap();more=false;}else throw e;}
  }
  const home=z.object({contractVersion:z.literal(consumerVersion),data:z.object({plan:planViewSchema.nullable(),emptyReason:z.enum(['no_targets','onboarding_required'])}).passthrough()}).passthrough().parse(await request('/sensa/home'));
  state=await changeAccountReplica(account,current=>({...current,plan:newestPlan(current.plan,home.data.plan)}));
  return state;
}
export async function revokeSession(){
  try {await request('/sensa/account/session/revoke',{operationId:crypto.randomUUID()});}
  catch(e){if(!(e instanceof ConsumerClientError && (e.status===401||e.status===403)))throw e;}
  const result=await auth?.signOut({scope:'local'});if(result?.error)throw result.error;
}
