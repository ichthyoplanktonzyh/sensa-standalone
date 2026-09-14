import {z} from 'zod';
import {canonicalConsumerJson,localIntakeRequestSchema,localIntakeReceiptSchema,type LocalIntakeRequest} from '@sensa/contracts/sensa';
// The non-strict schema deliberately strips fields written by the retired cloud-delivery
// implementation while preserving each account's local queue and receipt ledger.
const entrySchema=z.object({accountId:z.string().uuid(),request:localIntakeRequestSchema,digest:z.string(),receipt:localIntakeReceiptSchema.optional()});
type Entry=z.infer<typeof entrySchema>;
let serial:Promise<unknown>=Promise.resolve();
function locked<T>(work:()=>Promise<T>){const next=serial.catch(()=>undefined).then(work);serial=next;return next;}
/**
 * The owner confirmed there is no legacy Intake compatibility boundary. Remove
 * records that predate the current contract while retaining every current item;
 * they are an extension delivery queue, not the authoritative Web library.
 */
async function load():Promise<Entry[]>{
 const stored=(await chrome.storage.local.get('sensaWebIntake')).sensaWebIntake;
 if(stored===undefined)return [];
 if(!Array.isArray(stored)){await persist([]);return [];}
 const entries=stored.flatMap(value=>{const parsed=entrySchema.safeParse(value);return parsed.success?[parsed.data]:[];});
 if(entries.length!==stored.length)await persist(entries);
 return entries;
}
async function persist(entries:Entry[]){await chrome.storage.local.set({sensaWebIntake:entries});}
export async function queueWeb(accountId:string,raw:LocalIntakeRequest){return locked(async()=>{
 const request=localIntakeRequestSchema.parse(raw);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(request)))),b=>b.toString(16).padStart(2,'0')).join('');
 const entries=await load(),old=entries.find(e=>e.accountId===accountId&&e.request.operationId===request.operationId);
 if(old&&old.digest!==digest)throw new Error('operation_conflict');
 if(!old){if(entries.filter(e=>!e.receipt).length>=100)throw new Error('web_queue_full');entries.push({accountId,request,digest});await persist(entries);}
 return {savedLocally:true,destination:'web',committed:!!old?.receipt};
});}
export async function pendingWeb(accountId:string,libraryId:string){return (await load()).filter(e=>e.accountId===accountId&&e.request.libraryId===libraryId&&!e.receipt).slice(0,10).map(e=>e.request);}
export async function acknowledgeWeb(accountId:string,raw:unknown){return locked(async()=>{
 const receipt=localIntakeReceiptSchema.parse(raw),entries=await load();
 const entry=entries.find(e=>e.accountId===accountId&&e.request.operationId===receipt.operationId);
 if(!entry||entry.digest!==receipt.requestDigest||entry.request.libraryId!==receipt.libraryId||entry.request.clientId!==receipt.clientId)throw new Error('web_invalid_receipt');
 if(entry.receipt&&canonicalConsumerJson(entry.receipt)!==canonicalConsumerJson(receipt))throw new Error('web_invalid_receipt');
 entry.receipt=receipt;
 // Keep the bounded receipt ledger for idempotency; no successful response before storage commits.
 await persist(entries);return {acknowledged:true};
});}
export async function webStatus(accountId:string){const entries=(await load()).filter(e=>e.accountId===accountId);return {errors:[],pending:entries.filter(e=>!e.receipt).length,recent:entries.filter(e=>e.receipt).slice(-20).reverse().map(e=>({id:e.receipt!.entityId,status:e.receipt!.status,snapshot:e.request.snapshot}))};}

/** A page can observe only the operation it saved, after background ownership checks. */
export async function webOperationStatus(accountId:string,operationId:string){
 const entry=(await load()).find(e=>e.accountId===accountId&&e.request.operationId===operationId);
 if(!entry)throw new Error('not_found');
 return {committed:!!entry.receipt,status:entry.receipt?.status??'pending'};
}

/** Explicit user deletion removes only undelivered captures for the selected account. */
export async function discardPendingWeb(accountId:string){return locked(async()=>{
 const entries=await load(),kept=entries.filter(e=>e.accountId!==accountId||e.receipt);
 await persist(kept);return entries.length-kept.length;
});}
