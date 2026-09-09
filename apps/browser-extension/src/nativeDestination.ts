import {z} from 'zod';
import {canonicalConsumerJson,localIntakeRequestSchema,localIntakeReceiptSchema} from '@sensa/contracts/sensa';
import type {LocalIntakeRequest,LocalIntakeReceipt} from '@sensa/contracts/sensa';
const connectionSchema=z.object({version:z.literal('sensa-intake-v1'),libraryId:z.string().uuid(),clientId:z.string().uuid(),label:z.string().min(1).max(100)}).strict();
export type NativeConnection=z.infer<typeof connectionSchema>;
type Entry={request:LocalIntakeRequest;digest:string;receipt?:LocalIntakeReceipt;error?:string};
type Store={version:1;selected:string|null;connections:Record<string,{connection:NativeConnection;entries:Entry[]}>};
let serial:Promise<unknown>=Promise.resolve();
function locked<T>(work:()=>Promise<T>):Promise<T>{const next=serial.catch(()=>undefined).then(work);serial=next;return next;}
async function load():Promise<Store>{const raw=(await chrome.storage.local.get('sensaNative')).sensaNative;if(!raw)return {version:1,selected:null,connections:{}};
 const parsed=z.object({version:z.literal(1),selected:z.string().uuid().nullable(),connections:z.record(z.string(),z.object({connection:connectionSchema,entries:z.array(z.object({request:localIntakeRequestSchema,digest:z.string(),receipt:localIntakeReceiptSchema.optional(),error:z.string().optional()}).strict()).max(2000)}).strict())}).strict().parse(raw);
 for(const [id,v] of Object.entries(parsed.connections)){if(id!==v.connection.clientId||v.entries.some(e=>e.request.clientId!==id||e.request.libraryId!==v.connection.libraryId))throw new Error('native_store_invalid');}
 if(parsed.selected&&!parsed.connections[parsed.selected])throw new Error('native_store_invalid');return parsed;
}
async function persist(s:Store){await chrome.storage.local.set({sensaNative:s});}
export async function nativeEnabled(){return (await chrome.storage.local.get('sensaDestination')).sensaDestination==='native';}
export async function nativeScope(){const s=await load();return s.selected?s.connections[s.selected].connection.clientId:null;}
export async function nativeMessage(message:unknown):Promise<unknown>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {const result=await Promise.race([chrome.runtime.sendNativeMessage('app.sensa.intake',message as object),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('native_unavailable')),15000);})]);if(result?.error)throw new Error(result.error);if(!result||!('value'in result))throw new Error('native_invalid_receipt');return result.value;}
 catch(e){if(e instanceof Error&&['unsupported_library_version','connection_mismatch','library_mismatch','operation_conflict','capture_resolution_conflict','intake_removed','explicit_acceptance_required','native_invalid_receipt'].includes(e.message))throw e;throw new Error('native_unavailable');}finally{clearTimeout(timer);}
}
export async function discoverNative(){return connectionSchema.parse(await nativeMessage({kind:'hello'}));}
export async function selectNative(expected:unknown){return locked(async()=>{const candidate=connectionSchema.parse(expected),actual=await discoverNative();if(canonicalConsumerJson(actual)!==canonicalConsumerJson(candidate))throw new Error('connection_mismatch');const s=await load();s.connections[actual.clientId]??={connection:actual,entries:[]};s.selected=actual.clientId;await persist(s);await chrome.storage.local.set({sensaDestination:'native'});});}
export async function selectWeb(){await chrome.storage.local.set({sensaDestination:'web'});}
async function hash(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(value as object))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
async function flushLocked(s:Store){if(!s.selected)return;const group=s.connections[s.selected];for(const e of group.entries){if(e.receipt||e.error&&!['connection_mismatch','library_mismatch','unsupported_library_version'].includes(e.error))continue;
 try{const receipt=localIntakeReceiptSchema.parse(await nativeMessage({kind:'submit',request:e.request}));if(receipt.libraryId!==e.request.libraryId||receipt.clientId!==e.request.clientId||receipt.operationId!==e.request.operationId||receipt.requestDigest!==e.digest)throw new Error('native_invalid_receipt');e.receipt=receipt;delete e.error;await persist(s);}
 catch(error){const code=error instanceof Error?error.message:'native_unavailable';if(code!=='native_unavailable')e.error=code;await persist(s);break;}}
 const recent=group.entries.filter(e=>e.receipt).slice(-20);
 group.entries=group.entries.filter(e=>!e.receipt||recent.includes(e));await persist(s);
}
export async function flushNative(){return locked(async()=>{if(await nativeEnabled())await flushLocked(await load());});}
export async function queueNative(input:Omit<LocalIntakeRequest,'version'|'libraryId'|'clientId'>,scope:string){return locked(async()=>{if(!await nativeEnabled())throw new Error('account_mismatch');const s=await load();if(!s.selected||s.selected!==scope)throw new Error('account_mismatch');const g=s.connections[s.selected];const request=localIntakeRequestSchema.parse({...input,version:'sensa-intake-v1',libraryId:g.connection.libraryId,clientId:g.connection.clientId});const digest=await hash(request);let entry=g.entries.find(e=>e.request.operationId===request.operationId);
 if(entry&&entry.digest!==digest)throw new Error('operation_conflict');if(!entry){if(g.entries.length>=2000||g.entries.filter(e=>!e.receipt).length>=100)throw new Error('native_queue_full');entry={request,digest};g.entries.push(entry);await persist(s);}await flushLocked(s);if(entry.error)throw new Error(entry.error);return {savedLocally:true,destination:'native',committed:!!entry.receipt,receipt:entry.receipt??null};});}
export async function nativeStatus(){const s=await load(),g=s.selected?s.connections[s.selected]:null;return {accountId:g?.connection.clientId??null,destination:'native',label:g?.connection.label??null,libraryId:g?.connection.libraryId??null,pending:g?.entries.filter(e=>!e.receipt).length??0,errors:g?.entries.filter(e=>e.error).map(e=>e.error)??[],recent:g?.entries.filter(e=>e.receipt).slice(-20).reverse().map(e=>({id:e.receipt!.entityId,status:e.receipt!.status,snapshot:e.request.snapshot}))??[]};}
