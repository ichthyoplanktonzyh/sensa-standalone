import {deliveryConfigSchema,deliveryEnvelopeSchema,encryptCapture} from '@sensa/intake-transport';
import {z} from 'zod';
import {canonicalConsumerJson,localIntakeRequestSchema,localIntakeReceiptSchema,type LocalIntakeRequest} from '@sensa/contracts/sensa';
const entrySchema=z.object({accountId:z.string().uuid(),request:localIntakeRequestSchema,digest:z.string(),envelope:deliveryEnvelopeSchema.optional(),cloudStored:z.boolean().optional(),deliveryError:z.string().optional(),receipt:localIntakeReceiptSchema.optional()}).strict();
type Entry=z.infer<typeof entrySchema>;
let serial:Promise<unknown>=Promise.resolve();
function locked<T>(work:()=>Promise<T>){const next=serial.catch(()=>undefined).then(work);serial=next;return next;}
async function load(){return z.array(entrySchema).parse((await chrome.storage.local.get('sensaWebIntake')).sensaWebIntake??[]);}
async function persist(entries:Entry[]){await chrome.storage.local.set({sensaWebIntake:entries});}
export async function queueWeb(accountId:string,raw:LocalIntakeRequest){return locked(async()=>{
 const request=localIntakeRequestSchema.parse(raw);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(request)))),b=>b.toString(16).padStart(2,'0')).join('');
 const entries=await load(),old=entries.find(e=>e.accountId===accountId&&e.request.operationId===request.operationId);
 if(old&&old.digest!==digest)throw new Error('operation_conflict');
 if(!old){if(entries.filter(e=>!e.receipt).length>=100)throw new Error('web_queue_full');const config=deliveryConfigSchema.nullable().parse((await chrome.storage.local.get('sensaDelivery:'+accountId+':'+request.libraryId))['sensaDelivery:'+accountId+':'+request.libraryId]??null);
 const envelope=config?await encryptCapture(config,request):undefined;entries.push({accountId,request,digest,...(envelope?{envelope}:{})});await persist(entries);}
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
export async function webStatus(accountId:string){const entries=(await load()).filter(e=>e.accountId===accountId);return {errors:[...new Set(entries.filter(e=>!e.receipt&&e.deliveryError).map(e=>e.deliveryError!))],pending:entries.filter(e=>!e.receipt).length,cloudPending:entries.filter(e=>!e.receipt&&e.cloudStored).length,recent:entries.filter(e=>e.receipt).slice(-20).reverse().map(e=>({id:e.receipt!.entityId,status:e.receipt!.status,snapshot:e.request.snapshot}))};}

let flushing=false;
/** Retry the same ciphertext; re-encrypting a retry would break operation identity. */
export async function flushWebDelivery(accountId:string,send:(envelope:unknown)=>Promise<any>){
 if(flushing)return;flushing=true;
 try{for(const entry of (await load()).filter(e=>e.accountId===accountId&&e.envelope&&!e.receipt).slice(0,10)){
  try{const result=await send(entry.envelope);if(result.stored!==true)throw new Error('delivery_invalid_receipt');
   if(result.receipt)await acknowledgeWeb(accountId,result.receipt);
   else await locked(async()=>{const entries=await load(),current=entries.find(e=>e.accountId===accountId&&e.request.operationId===entry.request.operationId);if(current){current.cloudStored=true;delete current.deliveryError;await persist(entries);}});
  }catch(error){await locked(async()=>{const entries=await load(),current=entries.find(e=>e.accountId===accountId&&e.request.operationId===entry.request.operationId);if(current){current.deliveryError=error instanceof Error?error.message:'delivery_unavailable';await persist(entries);}});break;}
 }}finally{flushing=false;}
}

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
