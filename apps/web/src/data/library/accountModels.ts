import {z} from 'zod';
import {auth} from '../account/auth';
import type {Purpose} from './providers';
import {readingAssignmentsSchema} from '@sensa/contracts/sensa';

/** Account-hosted model connections. A connection saved here keeps its credential in
 * the deployment vault, so its requests execute on the service, not in this page.
 * This is the same account registry the browser extension configures for reading. */
export type AccountConnection={id:string;name:string;baseUrl:string;model:string;enabled:boolean;temperature?:number;keyConfigured:boolean};
export type AccountModels={revision:number;connections:AccountConnection[];assignments:Partial<Record<Purpose,string|null>>;vaultConfigured:boolean;allowedOrigins:string[]};
export type AccountConnectionInput={id:string;name:string;baseUrl:string;model:string;enabled:boolean;temperature?:number;key?:string};

const connectionSchema=z.object({
 id:z.string().uuid(),name:z.string().trim().min(1).max(80),baseUrl:z.string().url().max(2048),
 model:z.string().trim().min(1).max(160),enabled:z.boolean(),temperature:z.number().min(0).max(2).optional(),
 keyConfigured:z.boolean(),
}).strict();
/** The service's own shape for this map, read from the contracts rather than
 * written out again: a fourth copy of it is how this page stopped parsing every
 * setting the day a reading feature was added. */
const assignmentsSchema=readingAssignmentsSchema;
const viewSchema=z.object({
 revision:z.number().int().nonnegative(),providers:z.array(connectionSchema).max(12),
 assignments:assignmentsSchema,configured:z.boolean(),allowedOrigins:z.array(z.string()).max(50),
}).strict();
const modelsSchema=z.object({models:z.array(z.string().trim().min(1).max(160)).max(1000)}).strict();

/** Server codes we can explain to a person. Anything else stays a generic failure. */
const errors:Record<string,string>={
 provider_origin_not_allowed:'localFlow.accountOrigin',
 provider_vault_unavailable:'localFlow.accountVault',
 provider_key_required:'localFlow.accountKeyRequired',
 settings_conflict:'localFlow.accountSettingsChanged',
 authentication_required:'localFlow.accountLogin',
 access_revoked:'localFlow.accessDenied',
 provider_unavailable:'localFlow.accountConnectionGone',
 provider_not_found:'localFlow.accountConnectionGone',
 invalid_request:'localFlow.accountInvalid',
};

async function endpoint(){
 const session=(await auth?.getSession())?.data.session;
 if(!session)throw new Error('localFlow.accountLogin');
 const base=import.meta.env.VITE_SENSA_API_URL;
 if(!base)throw new Error('localFlow.serviceUnconfigured');
 return {token:session.access_token,userId:session.user.id,base:base.replace(/\/+$/u,'')+'/sensa/reading'};
}

async function send(target:{token:string;userId:string},path:string,init:RequestInit|undefined,signal?:AbortSignal){
 const response=await fetch(path,{...init,redirect:'error',credentials:'omit',headers:{...(init?.headers??{}),authorization:'Bearer '+target.token},signal:AbortSignal.any([signal??AbortSignal.timeout(15000),AbortSignal.timeout(15000)])});
 if((await auth?.getSession())?.data.session?.user.id!==target.userId)throw new Error('localFlow.accountChanged');
 if(response.status===401||response.status===403)throw new Error('localFlow.accountLogin');
 if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(errors[body?.code as string]??'localFlow.accountUnavailable');}
 return response;
}

async function request(init:RequestInit|undefined,signal?:AbortSignal){
 const target=await endpoint();
 return viewSchema.parse(await (await send(target,target.base+'/settings',init,signal)).json());
}

function parse(view:z.infer<typeof viewSchema>):AccountModels{
 return {revision:view.revision,connections:view.providers,assignments:view.assignments,vaultConfigured:view.configured,allowedOrigins:view.allowedOrigins};
}

export async function readAccountModels(signal?:AbortSignal):Promise<AccountModels>{
 return parse(await request(undefined,signal));
}

/** Connections are replaced wholesale, so the current list is always echoed back.
 * Omitting a key keeps the stored one; a changed address requires a new key. */
function payload(current:AccountModels,connections:AccountConnectionInput[],assignments:Partial<Record<Purpose,string|null>>){
 return {expectedRevision:current.revision,
  providers:connections.map(c=>({id:c.id,name:c.name,baseUrl:c.baseUrl,model:c.model,enabled:c.enabled,...(c.temperature===undefined?{}:{temperature:c.temperature}),...(c.key?.trim()?{apiKey:c.key.trim()}:{})})),
  assignments};
}

export async function saveAccountModels(current:AccountModels,connections:AccountConnectionInput[],assignments:Partial<Record<Purpose,string|null>>,signal?:AbortSignal):Promise<AccountModels>{
 return parse(await request({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload(current,connections,assignments))},signal));
}

/** Echoes the stored connections untouched apart from the credential-free fields. */
const echo=(current:AccountModels):AccountConnectionInput[]=>current.connections.map(({keyConfigured,...connection})=>connection);

export async function addAccountConnection(current:AccountModels,input:AccountConnectionInput,signal?:AbortSignal){
 return saveAccountModels(current,[...echo(current),input],{},signal);
}
export async function updateAccountConnection(current:AccountModels,input:AccountConnectionInput,signal?:AbortSignal){
 return saveAccountModels(current,echo(current).map(connection=>connection.id===input.id?input:connection),{},signal);
}
export async function removeAccountConnection(current:AccountModels,id:string,signal?:AbortSignal){
 return saveAccountModels(current,echo(current).filter(connection=>connection.id!==id),{},signal);
}
/** Sending only this purpose keeps every other assignment — server-side merge. */
export async function assignAccountPurpose(current:AccountModels,purpose:Purpose,connectionId:string|null,signal?:AbortSignal){
 return saveAccountModels(current,echo(current),{[purpose]:connectionId},signal);
}

/** Lists what the connection offers. The stored credential stays on the service. */
export async function listAccountConnectionModels(connectionId:string,signal?:AbortSignal):Promise<string[]>{
 const target=await endpoint();
 const response=await send(target,target.base+'/models',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({providerId:connectionId})},signal);
 return modelsSchema.parse(await response.json()).models;
}
