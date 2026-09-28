import {z} from 'zod';
import {canonicalConsumerJson,sensaBrowserIntakeDeliverySchema,sensaBrowserIntakeReceiptSchema,type SensaBrowserIntakeDelivery} from '@sensa/contracts/sensa';

const storageKey='sensaWebIntake';
const pendingLimit=100,recentDisplayLimit=20,receiptLedgerLimitPerAccount=256,receiptLedgerLimitTotal=1024;
const legacyEntrySchema=z.object({accountId:z.string().uuid(),request:sensaBrowserIntakeDeliverySchema,digest:z.string(),receipt:sensaBrowserIntakeReceiptSchema.optional()}).strict();
const pendingEntrySchema=legacyEntrySchema.omit({receipt:true});
const receiptRecordSchema=z.object({accountId:z.string().uuid(),digest:z.string(),receipt:sensaBrowserIntakeReceiptSchema,expression:z.string().nullable()}).strict();
const quarantinedRecordSchema=z.object({detectedAt:z.string().datetime(),value:z.unknown()}).strict();
type LegacyEntry=z.infer<typeof legacyEntrySchema>;
type PendingEntry=z.infer<typeof pendingEntrySchema>;
type ReceiptRecord=z.infer<typeof receiptRecordSchema>;
type QuarantinedRecord=z.infer<typeof quarantinedRecordSchema>;
type QueueSnapshot={version:2;pending:PendingEntry[];receipts:ReceiptRecord[];quarantined:QuarantinedRecord[]};
let serial:Promise<unknown>=Promise.resolve();
function locked<T>(work:()=>Promise<T>){const next=serial.catch(()=>undefined).then(work);serial=next;return next;}

/**
 * The compact idempotency ledger is deliberately much longer-lived than the 20
 * items shown in Popup. It remains bounded so delivered history can never crowd
 * undelivered owner data out of extension storage.
 */
function boundedReceipts(receipts:ReceiptRecord[]){
 const accountCounts=new Map<string,number>(),kept=new Set<number>();let total=0;
 for(let index=receipts.length-1;index>=0;index--){
  const receipt=receipts[index]!,accountCount=accountCounts.get(receipt.accountId)??0;
  if(accountCount>=receiptLedgerLimitPerAccount||total>=receiptLedgerLimitTotal)continue;
  kept.add(index);accountCounts.set(receipt.accountId,accountCount+1);total++;
 }
 return receipts.filter((_receipt,index)=>kept.has(index));
}

function delivered(entry:LegacyEntry):ReceiptRecord{
 return receiptRecordSchema.parse({accountId:entry.accountId,digest:entry.digest,receipt:entry.receipt,expression:entry.request.intake.expression?.surfaceForm??null});
}

function normalize(raw:unknown):{snapshot:QueueSnapshot;changed:boolean}{
 const detectedAt=new Date().toISOString(),pending:PendingEntry[]=[],receipts:ReceiptRecord[]=[],quarantined:QuarantinedRecord[]=[];
 let changed=false;
 const quarantine=(value:unknown)=>{quarantined.push({detectedAt,value});changed=true;};
 const legacy=(values:unknown[])=>{for(const value of values){const parsed=legacyEntrySchema.safeParse(value);if(parsed.success){if(parsed.data.receipt)receipts.push(delivered(parsed.data));else pending.push(parsed.data);}else quarantine(value);}};
 if(Array.isArray(raw)){legacy(raw);changed=true;}
 else if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
  const record=raw as Record<string,unknown>,keys=Object.keys(record);
  const current=keys.length===4&&record.version===2&&Array.isArray(record.pending)&&Array.isArray(record.receipts)&&Array.isArray(record.quarantined);
  const interim=keys.length===3&&record.version===2&&Array.isArray(record.entries)&&Array.isArray(record.quarantined);
  if(!current&&!interim){quarantine(raw);return {snapshot:{version:2,pending,receipts,quarantined},changed};}
  if(interim){legacy(record.entries as unknown[]);changed=true;}
  else{
   for(const value of record.pending as unknown[]){const parsed=pendingEntrySchema.safeParse(value);if(parsed.success)pending.push(parsed.data);else quarantine(value);}
   for(const value of record.receipts as unknown[]){const parsed=receiptRecordSchema.safeParse(value);if(parsed.success)receipts.push(parsed.data);else quarantine(value);}
  }
  for(const value of record.quarantined as unknown[]){const parsed=quarantinedRecordSchema.safeParse(value);if(parsed.success)quarantined.push(parsed.data);else quarantine(value);}
 }else{quarantine(raw);return {snapshot:{version:2,pending,receipts,quarantined},changed};}
 const bounded=boundedReceipts(receipts);if(bounded.length!==receipts.length)changed=true;
 return {snapshot:{version:2,pending,receipts:bounded,quarantined},changed};
}

async function persist(snapshot:QueueSnapshot){await chrome.storage.local.set({[storageKey]:{...snapshot,receipts:boundedReceipts(snapshot.receipts)}});}

/** Legacy arrays migrate once; unreadable values are retained byte-for-byte. */
async function load():Promise<QueueSnapshot>{
 const raw=(await chrome.storage.local.get(storageKey))[storageKey];
 if(raw===undefined)return {version:2,pending:[],receipts:[],quarantined:[]};
 const normalized=normalize(raw);if(normalized.changed)await persist(normalized.snapshot);return normalized.snapshot;
}

export async function queueWeb(accountId:string,raw:SensaBrowserIntakeDelivery){return locked(async()=>{
 const request=sensaBrowserIntakeDeliverySchema.parse(raw);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(request)))),b=>b.toString(16).padStart(2,'0')).join('');
 const snapshot=await load(),operationId=request.intake.operationId;
 const queued=snapshot.pending.find(entry=>entry.accountId===accountId&&entry.request.intake.operationId===operationId);
 const committed=snapshot.receipts.find(entry=>entry.accountId===accountId&&entry.receipt.operationId===operationId);
 const oldDigest=queued?.digest??committed?.digest;if(oldDigest&&oldDigest!==digest)throw new Error('operation_conflict');
 if(!queued&&!committed){
  if(snapshot.quarantined.length)throw new Error('web_queue_recovery_required');
  if(snapshot.pending.length>=pendingLimit)throw new Error('web_queue_full');
  snapshot.pending.push({accountId,request,digest});await persist(snapshot);
 }
 return {savedLocally:true,destination:'web',committed:!!committed};
});}

export async function pendingWeb(accountId:string,libraryId:string){return (await load()).pending.filter(entry=>entry.accountId===accountId&&entry.request.libraryId===libraryId).slice(0,10).map(entry=>entry.request);}

export async function acknowledgeWeb(accountId:string,raw:unknown){return locked(async()=>{
 const receipt=sensaBrowserIntakeReceiptSchema.parse(raw),snapshot=await load();
 const existing=snapshot.receipts.find(entry=>entry.accountId===accountId&&entry.receipt.operationId===receipt.operationId);
 if(existing){if(existing.digest!==receipt.requestDigest||canonicalConsumerJson(existing.receipt)!==canonicalConsumerJson(receipt))throw new Error('web_invalid_receipt');return {acknowledged:true};}
 const index=snapshot.pending.findIndex(entry=>entry.accountId===accountId&&entry.request.intake.operationId===receipt.operationId),entry=snapshot.pending[index];
 if(!entry||entry.digest!==receipt.requestDigest||entry.request.libraryId!==receipt.libraryId||entry.request.clientId!==receipt.clientId)throw new Error('web_invalid_receipt');
 snapshot.pending.splice(index,1);snapshot.receipts.push(receiptRecordSchema.parse({accountId,digest:entry.digest,receipt,expression:entry.request.intake.expression?.surfaceForm??null}));
 // No successful response before the compact idempotency ledger commits.
 await persist(snapshot);return {acknowledged:true};
});}

export async function webStatus(accountId:string|null){
 const snapshot=await load(),pending=accountId?snapshot.pending.filter(entry=>entry.accountId===accountId):[],receipts=accountId?snapshot.receipts.filter(entry=>entry.accountId===accountId):[];
 return {
  errors:snapshot.quarantined.length?['web_queue_recovery_required']:[],pending:pending.length,
  recent:receipts.slice(-recentDisplayLimit).reverse().map(entry=>{const result=entry.receipt.result;return {id:result.route==='fast_track'?result.personalMeaningId:result.intakeId,status:result.route==='fast_track'?'confirmed':'pending',expression:entry.expression};}),
  recoveryCount:snapshot.quarantined.length,
 };
}

/** A page can observe only the operation it saved, after ownership checks. */
export async function webOperationStatus(accountId:string,operationId:string){
 const snapshot=await load(),receipt=snapshot.receipts.find(entry=>entry.accountId===accountId&&entry.receipt.operationId===operationId);
 if(receipt)return {committed:true,status:receipt.receipt.result.route==='fast_track'?'confirmed':'pending'};
 if(!snapshot.pending.some(entry=>entry.accountId===accountId&&entry.request.intake.operationId===operationId))throw new Error('not_found');
 return {committed:false,status:'pending'};
}

/** Explicit user deletion removes only undelivered captures for one account. */
export async function discardPendingWeb(accountId:string){return locked(async()=>{
 const snapshot=await load(),kept=snapshot.pending.filter(entry=>entry.accountId!==accountId),removed=snapshot.pending.length-kept.length;
 snapshot.pending=kept;await persist(snapshot);return removed;
});}

/** Export is read-only and includes the exact opaque values retained at migration. */
export async function exportWebQueueRecovery(){const snapshot=await load();return {contractVersion:'sensa-extension-queue-recovery-v1' as const,exportedAt:new Date().toISOString(),records:structuredClone(snapshot.quarantined)};}

/** Quarantine is removed only through this explicit learner action. */
export async function discardWebQueueRecovery(){return locked(async()=>{const snapshot=await load(),removed=snapshot.quarantined.length;snapshot.quarantined=[];await persist(snapshot);return {discarded:removed};});}
