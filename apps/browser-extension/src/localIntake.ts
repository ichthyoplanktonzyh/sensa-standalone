import {z} from 'zod';
import {
 canonicalConsumerJson,captureSnapshotSchema,semanticProposalSchema,sensaSemanticResolutionProvenanceSchema,
 sensaBrowserIntakeDeliverySchema,sensaBrowserIntakeReceiptSchema,
 type CaptureSnapshot,type SemanticProposal,type SensaSemanticResolutionProvenance,type SensaBrowserIntakeDelivery,
} from '@sensa/contracts/sensa';
import {browserCaptureToIntake} from './semanticIntakeAdapter';

const storageKey='sensaLocalIntake',bindingKey='sensaLocalWebLibrary';
const uuid=z.string().uuid();
const entrySchema=z.object({operationId:uuid,snapshot:captureSnapshotSchema,proposal:semanticProposalSchema.nullable(),provenance:sensaSemanticResolutionProvenanceSchema.nullable(),digest:z.string().regex(/^[a-f0-9]{64}$/u),request:sensaBrowserIntakeDeliverySchema.optional(),receipt:sensaBrowserIntakeReceiptSchema.optional()}).strict();
type Entry=z.infer<typeof entrySchema>;
let serial:Promise<unknown>=Promise.resolve();
const locked=<T>(work:()=>Promise<T>):Promise<T>=>{const next=serial.catch(()=>undefined).then(work);serial=next;return next;};

async function hash(value:unknown){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(value))));
 return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function load():Promise<Entry[]>{
 const raw=(await chrome.storage.local.get(storageKey))[storageKey];
 return raw===undefined?[]:z.array(entrySchema).max(120).parse(raw);
}
async function persist(entries:Entry[]){await chrome.storage.local.set({[storageKey]:entries});}
async function binding():Promise<string|null>{
 const raw=(await chrome.storage.local.get(bindingKey))[bindingKey];
 return raw===undefined?null:uuid.parse(raw);
}

export async function bindLocalLibrary(libraryId:string){return locked(async()=>{
 uuid.parse(libraryId);
 const current=await binding();
 if(current&&current!==libraryId)throw new Error('library_mismatch');
 if(!current)await chrome.storage.local.set({[bindingKey]:libraryId});
 return {connected:true as const};
});}

/** A new Web library can claim pending captures only after an explicit reconnect. */
export async function resetLocalLibrary(libraryId:string,discardPending:boolean){return locked(async()=>{
 uuid.parse(libraryId);
 const entries=await load();
 const next=discardPending?entries.filter(entry=>!!entry.receipt):entries.map(entry=>entry.receipt?entry:{...entry,request:undefined});
 await persist(next);
 await chrome.storage.local.set({[bindingKey]:libraryId});
 return {reset:true as const};
});}

export async function queueLocalCapture(operationId:string,snapshot:CaptureSnapshot,proposal:SemanticProposal|null,provenance:SensaSemanticResolutionProvenance|null){return locked(async()=>{
 const input={operationId:uuid.parse(operationId),snapshot:captureSnapshotSchema.parse(snapshot),proposal:proposal?semanticProposalSchema.parse(proposal):null,provenance:provenance?sensaSemanticResolutionProvenanceSchema.parse(provenance):null};
 if(!!input.proposal!==!!input.provenance)throw new Error('invalid_proposal');
 const digest=await hash(input),stored=await load(),old=stored.find(entry=>entry.operationId===operationId);
 if(old&&old.digest!==digest)throw new Error('operation_conflict');
 if(!old){
  const pending=stored.filter(entry=>!entry.receipt);
  if(pending.length>=100)throw new Error('web_queue_full');
  const entries=[...stored.filter(entry=>entry.receipt).slice(-20),...pending,entrySchema.parse({...input,digest})];
  await persist(entries);
 }
 return {savedLocally:true,destination:'web' as const,committed:!!old?.receipt};
});}

export async function pendingLocal(libraryId:string,clientId:string){return locked(async()=>{
 if(await binding()!==uuid.parse(libraryId))throw new Error('library_mismatch');
 uuid.parse(clientId);
 const entries=await load(),pending=entries.filter(entry=>!entry.receipt).slice(0,10);
 for(const entry of pending)if(!entry.request){
  entry.request=sensaBrowserIntakeDeliverySchema.parse({contractVersion:'sensa-browser-intake-delivery-v1',libraryId,clientId,intake:browserCaptureToIntake(entry.operationId,entry.snapshot,entry.proposal,entry.provenance)});
 }
 if(pending.some(entry=>entry.request))await persist(entries);
 return pending.map(entry=>entry.request!);
});}

export async function acknowledgeLocal(raw:unknown){return locked(async()=>{
 const receipt=sensaBrowserIntakeReceiptSchema.parse(raw);
 if(await binding()!==receipt.libraryId)throw new Error('library_mismatch');
 const entries=await load(),entry=entries.find(item=>item.operationId===receipt.operationId);
 if(!entry?.request||entry.request.libraryId!==receipt.libraryId||entry.request.clientId!==receipt.clientId||await hash(entry.request)!==receipt.requestDigest)throw new Error('web_invalid_receipt');
 if(entry.receipt&&canonicalConsumerJson(entry.receipt)!==canonicalConsumerJson(receipt))throw new Error('web_invalid_receipt');
 entry.receipt=receipt;await persist(entries);return {acknowledged:true as const};
});}

export async function localOperationStatus(operationId:string){
 const entry=(await load()).find(item=>item.operationId===uuid.parse(operationId));
 if(!entry)throw new Error('not_found');
 return {committed:!!entry.receipt,status:entry.receipt?.result.route==='fast_track'?'confirmed' as const:'pending' as const};
}

export async function localIntakeStatus(){
 const entries=await load();
 return {pending:entries.filter(entry=>!entry.receipt).length,errors:[],recent:entries.filter(entry=>entry.receipt).slice(-20).reverse().map(entry=>({id:entry.receipt!.result.route==='fast_track'?entry.receipt!.result.personalMeaningId:entry.receipt!.result.intakeId,status:entry.receipt!.result.route==='fast_track'?'confirmed':'pending',expression:entry.request?.intake.expression?.surfaceForm??null}))};
}
