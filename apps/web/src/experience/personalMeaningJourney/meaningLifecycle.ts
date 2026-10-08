/** Lifecycle facts reuse immutable Meaning revisions, not a second history. */
import type {SensaPersonalMeaningSnapshot,SensaPersonalMeaningRevisionSnapshot} from '@sensa/contracts/sensa';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import type {CommandReceipt} from './store';

export type MeaningLifecycleRecord={personalMeaning:SensaPersonalMeaningSnapshot;personalMeaningRevisions:readonly SensaPersonalMeaningRevisionSnapshot[]};
const invalid=():never=>{throw new Error('personal_meaning_lifecycle_invalid');};

/** Admission proof for mutations/full replicas. Exact World reads can validate
 * the aggregate alone; they cannot authorize restoration or ingest new facts. */
export function assertMeaningLifecycleReceipt(meaningId:string,stamp:SensaPersonalMeaningRevisionSnapshot,receipts:Pick<ReadonlyMap<string,CommandReceipt>,'get'>):void{
 const life=stamp.lifecycle;if(!life)return;
 const receipt=receipts.get(stamp.provenance.createdByOperationId),result=receipt?.result;
 if(receipt?.command!=='ChangeMeaningLifecycle'||!receipt.requestDigest
  ||result?.personalMeaningId!==meaningId||result.personalMeaningRevisionId!==stamp.personalMeaningRevisionId
  ||result.revision!==stamp.revision||result.lifecycleRevision!==life.revision
  ||result.status!==(life.kind==='delete'?'deleted':'active'))invalid();
}
export function assertMeaningLifecycleReceipts(records:readonly MeaningLifecycleRecord[],receipts:readonly CommandReceipt[]):void{
 const byId=new Map(receipts.map(receipt=>[receipt.operationId,receipt]));
 const witnessed=new Set<string>();
 for(const record of records)for(const stamp of record.personalMeaningRevisions){
  assertMeaningLifecycleReceipt(record.personalMeaning.personalMeaningId,stamp,byId);
  if(stamp.lifecycle)witnessed.add(stamp.provenance.createdByOperationId);
 }
 for(const receipt of receipts)if(receipt.command==='ChangeMeaningLifecycle'&&!witnessed.has(receipt.operationId))invalid();
}
export function assertMeaningLifecycleOperationReceipt(record:MeaningLifecycleRecord|undefined,receipt:CommandReceipt):void{
 if(receipt.command!=='ChangeMeaningLifecycle')return;
 const stamp=record?.personalMeaningRevisions.find(stamp=>stamp.lifecycle&&stamp.provenance.createdByOperationId===receipt.operationId);
 if(!record||!stamp)return invalid();
 assertMeaningLifecycleReceipt(record.personalMeaning.personalMeaningId,stamp,new Map([[receipt.operationId,receipt]]));
}
const sameSnapshot=(left:SensaPersonalMeaningSnapshot,right:SensaPersonalMeaningSnapshot)=>
 left.contractVersion===right.contractVersion&&left.personalMeaningId===right.personalMeaningId
 &&left.learnerUserId===right.learnerUserId&&left.createdAt===right.createdAt;

/** Validate the current projection against the retained delete/restore facts.
 * Ordinary content revisions cannot edit a deleted Meaning or imply restore. */
export function assertMeaningLifecycle(record:MeaningLifecycleRecord):void{
 const head=record.personalMeaning,revisions=[...record.personalMeaningRevisions].sort((a,b)=>a.revision-b.revision);
 let status:'active'|'deleted'='active',revision=1,last:SensaPersonalMeaningRevisionSnapshot|undefined;
 for(let index=0;index<revisions.length;index++){
  const current=revisions[index]!;
  if(current.personalMeaningId!==head.personalMeaningId||current.revision!==index+1)invalid();
  if(!current.lifecycle){if(status==='deleted')invalid();continue;}
  const prior=revisions[index-1];
  if(!prior||current.lifecycle.revision!==revision+1||current.provenance.kind!=='learner_authored'
   ||current.lifecycle.kind!==(status==='active'?'delete':'restore')
   ||current.displayLabel!==prior.displayLabel||current.learnerIntentNote!==prior.learnerIntentNote
   ||!Number.isFinite(Date.parse(current.createdAt))||Date.parse(current.createdAt)<Date.parse(prior.createdAt))invalid();
  status=current.lifecycle.kind==='delete'?'deleted':'active';revision++;last=current;
 }
 if(revisions.length!==head.currentRevision||head.lifecycleRevision!==revision||head.status!==status)invalid();
 if(last&&Date.parse(head.updatedAt)<Date.parse(last.createdAt))invalid();
 if(status==='deleted'){
  if(!last||head.deletedAt!==last.createdAt||head.deletedByOperationId!==last.provenance.createdByOperationId)invalid();
 }else if(head.deletedAt!==null||head.deletedByOperationId!==null)invalid();
}

/** Sync may carry several explicit operations since its base. A bare active
 * snapshot cannot advance a tombstone's lifecycle or erase retained history. */
export function validMeaningLifecycleDescendant(before:MeaningLifecycleRecord,after:MeaningLifecycleRecord):boolean{
 try{assertMeaningLifecycle(before);assertMeaningLifecycle(after);}catch{return false;}
 const prior=before.personalMeaning,next=after.personalMeaning;
 if(!sameSnapshot(prior,next)||next.currentRevision<prior.currentRevision||next.lifecycleRevision<prior.lifecycleRevision)return false;
 if(next.lifecycleRevision===prior.lifecycleRevision){
  if(next.status!==prior.status)return false;
  if(prior.status==='deleted')return canonicalConsumerJson(before)===canonicalConsumerJson(after);
 }
 return next.currentRevision-prior.currentRevision>=next.lifecycleRevision-prior.lifecycleRevision;
}
