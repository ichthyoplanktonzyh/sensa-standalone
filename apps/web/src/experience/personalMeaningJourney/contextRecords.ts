/** Canonical Context facts and exact Meaning associations.
 *
 * Gateways use hydrated Meaning projections. Durable Meanings contain only
 * associations and immutable revision IDs, including their conflict branches.
 * Context bodies have one authority and are never copied into those branches.
 */
import {sensaPersonalSemanticAnchorSnapshotSchema,sensaPersonalSemanticAnchorRevisionSnapshotSchema} from '@sensa/contracts/sensa';
import {z} from 'zod';
import {backupEqual} from '../../data/library/backupCodec';
import type {LibraryTransaction} from '../../data/library/store';
import type {MeaningJourneyRecord,JourneyState,CommandReceipt} from './store';
import {assertContextConflictHistory,type ContextConflictHistory} from './contextConflictHistory';

type Anchor=MeaningJourneyRecord['personalSemanticAnchors'][number];
type Revision=MeaningJourneyRecord['personalSemanticAnchorRevisions'][number];
const {personalMeaningId:legacyOwner,...anchorShape}=sensaPersonalSemanticAnchorSnapshotSchema.shape;
export const contextHeadSchema=z.object({...anchorShape,
 learnerUserId:z.string().min(1),currentRevisionId:z.string().uuid(),conflictHistory:z.custom<ContextConflictHistory>().optional(),
}).strict().superRefine((head,ctx)=>{
 const {learnerUserId:_,currentRevisionId:__,conflictHistory:___,...facts}=head;
 const result=sensaPersonalSemanticAnchorSnapshotSchema.safeParse({...facts,personalMeaningId:head.personalSemanticAnchorId});
 if(!result.success)for(const issue of result.error.issues)ctx.addIssue({...issue,path:issue.path});
});
export type ContextHead=z.infer<typeof contextHeadSchema>;
export type ContextRecord={kind:'anchors';value:ContextHead}|{kind:'anchorRevisions';parentRevisionId:string|null;value:Revision};
export interface ContextState{anchors:ContextHead[];anchorRevisions:Revision[];anchorRevisionParents:Record<string,string|null>}
export const emptyContextState=():ContextState=>({anchors:[],anchorRevisions:[],anchorRevisionParents:{}});
export const contextKey=(kind:ContextRecord['kind'],id:string)=>`${kind}:${id}`;
export const contextRecordId=(row:ContextRecord)=>row.kind==='anchors'?row.value.personalSemanticAnchorId:row.value.personalSemanticAnchorRevisionId;
export function assertContextLifecycle(head:ContextHead,read:(id:string)=>{value:Revision;parentRevisionId:string|null}|undefined):void{
 const events:Revision[]=[],seen=new Set<string>();let next:string|null=head.currentRevisionId;
 while(next){if(seen.has(next))invalid();seen.add(next);const row:{value:Revision;parentRevisionId:string|null}=read(next)??invalid();if(row.value.lifecycle)events.unshift(row.value);next=row.parentRevisionId;}
 if(events.some((row,index)=>row.lifecycle!.revision!==index+2||row.lifecycle!.kind!==(index%2?'restore':'delete')))invalid();
 const latest=events.at(-1),deleted=latest?.lifecycle?.kind==='delete';
 if(head.lifecycleRevision!==events.length+1||head.status!==(deleted?'deleted':'active')||head.deletedAt!==(deleted?latest!.createdAt:null)||head.deletedByOperationId!==(deleted?latest!.provenance.createdByOperationId:null))invalid();
}
export function assertContextLifecycleReceipt(revision:Revision,read:(id:string)=>CommandReceipt|undefined):void{
 if(!revision.lifecycle)return;
 const receipt=read(revision.provenance.createdByOperationId),expected={contextId:revision.personalSemanticAnchorId,revisionId:revision.personalSemanticAnchorRevisionId,status:revision.lifecycle.kind==='delete'?'deleted':'active'};
 if(receipt?.command!=='ChangeContextLifecycle'||!backupEqual(receipt.result,expected))invalid();
}

/** The association has its own selected version and detach status. It does not
 * own the Context's current head or its lifecycle. */
export type MeaningContextAssociation=Omit<Anchor,'personalMeaningId'|'currentRevision'>&{selectedRevisionId:string};
type RevisionReference=Pick<Revision,'personalSemanticAnchorRevisionId'|'personalSemanticAnchorId'>;
export type StoredMeaningRecord=Omit<MeaningJourneyRecord,'personalSemanticAnchors'|'personalSemanticAnchorRevisions'|'conflictHistory'>&{
 contextStorageVersion:1;
 personalSemanticAnchors:MeaningContextAssociation[];
 personalSemanticAnchorRevisions:RevisionReference[];
 conflictHistory?:Omit<NonNullable<MeaningJourneyRecord['conflictHistory']>,'branches'>&{branches:Array<{digest:string;head:string|null;record:Omit<StoredMeaningRecord,'conflictHistory'>}>};
};
const invalid=():never=>{throw Error('semantic_context_invalid');};
const isStored=(value:any):value is StoredMeaningRecord=>value?.contextStorageVersion===1;
const meaningFields=new Set(['contextStorageVersion','conflictHistory','personalMeaning','personalMeaningRevisions','personalSemanticAnchors','personalSemanticAnchorRevisions','personalExpressionAnchors','personalExpressionAnchorRevisions','focuses','focusRevisions','focusAcceptances','constructions','constructionTurns','proposals','proposalVersions','senseConfirmations','semanticAcceptances','alignments','alignmentEvents','bindingConfirmations','mockState']);

export function storeMeaningContexts(record:MeaningJourneyRecord|StoredMeaningRecord):StoredMeaningRecord{
 if(isStored(record)){if(Object.keys(record).some(key=>!meaningFields.has(key)))invalid();return record;}
 const {personalSemanticAnchors,personalSemanticAnchorRevisions,conflictHistory,...facts}=record;
 const stored:StoredMeaningRecord={...facts,contextStorageVersion:1,
  personalSemanticAnchors:personalSemanticAnchors.map(anchor=>{
   const selected=personalSemanticAnchorRevisions.find(row=>row.personalSemanticAnchorId===anchor.personalSemanticAnchorId&&row.revision===anchor.currentRevision)??invalid();
   const {personalMeaningId:_,currentRevision:__,...association}=anchor;
   return {...association,selectedRevisionId:selected.personalSemanticAnchorRevisionId};
  }),
  personalSemanticAnchorRevisions:personalSemanticAnchorRevisions.map(({personalSemanticAnchorId,personalSemanticAnchorRevisionId})=>({personalSemanticAnchorId,personalSemanticAnchorRevisionId})),
 };
 if(conflictHistory)stored.conflictHistory={...conflictHistory,branches:conflictHistory.branches.map(branch=>({...branch,record:storeMeaningContexts(branch.record)}))};
 return stored;
}

export function meaningContextKeys(record:StoredMeaningRecord|MeaningJourneyRecord):string[]{
 const stored=storeMeaningContexts(record),keys=new Set<string>();
 for(const branch of [stored,...(stored.conflictHistory?.branches.map(row=>row.record)??[])]){
  for(const anchor of branch.personalSemanticAnchors)keys.add(contextKey('anchors',anchor.personalSemanticAnchorId));
  for(const revision of branch.personalSemanticAnchorRevisions)keys.add(contextKey('anchorRevisions',revision.personalSemanticAnchorRevisionId));
 }
 return [...keys];
}

/** Exact point reads; the global Context head may advance while a Meaning
 * continues to reference the version it actually accepted. */
export function hydrateMeaningContexts(raw:unknown,read:(key:string)=>unknown):MeaningJourneyRecord{
 if(!isStored(raw))return invalid();
 if(Object.keys(raw).some(key=>!meaningFields.has(key)))invalid();
 const {contextStorageVersion:_,personalSemanticAnchors,personalSemanticAnchorRevisions,conflictHistory,...facts}=raw;
 if(!Array.isArray(personalSemanticAnchors)||!Array.isArray(personalSemanticAnchorRevisions))invalid();
 const learner=raw.personalMeaning.learnerUserId;
 const revisions=personalSemanticAnchorRevisions.map(ref=>{
  const row=read(contextKey('anchorRevisions',ref.personalSemanticAnchorRevisionId)) as ContextRecord|undefined;
  if(row?.kind!=='anchorRevisions'||row.value.personalSemanticAnchorRevisionId!==ref.personalSemanticAnchorRevisionId||row.value.personalSemanticAnchorId!==ref.personalSemanticAnchorId||Object.keys(ref).some(key=>!['personalSemanticAnchorRevisionId','personalSemanticAnchorId'].includes(key)))return invalid();
  return row.value;
 });
 const anchors=personalSemanticAnchors.map(ref=>{
  const row=read(contextKey('anchors',ref.personalSemanticAnchorId)) as ContextRecord|undefined;
  if(row?.kind!=='anchors'||row.value.personalSemanticAnchorId!==ref.personalSemanticAnchorId||row.value.learnerUserId!==learner||row.value.createdAt!==ref.createdAt)return invalid();
  const selected=revisions.find(version=>version.personalSemanticAnchorRevisionId===ref.selectedRevisionId&&version.personalSemanticAnchorId===ref.personalSemanticAnchorId)??invalid();
  const {selectedRevisionId:__,...association}=ref;
  return {...association,personalMeaningId:raw.personalMeaning.personalMeaningId,currentRevision:selected.revision};
 });
 const result:MeaningJourneyRecord={...facts,personalSemanticAnchors:anchors,personalSemanticAnchorRevisions:revisions};
 if(conflictHistory)result.conflictHistory={...conflictHistory,branches:conflictHistory.branches.map(branch=>({...branch,record:hydrateMeaningContexts({...branch.record,contextStorageVersion:1},read)}))};
 return result;
}

export async function readMeaningContexts(tx:Pick<LibraryTransaction,'get'>,id:string):Promise<MeaningJourneyRecord|undefined>{
 const raw=await tx.get<StoredMeaningRecord>('semanticMeanings',id);if(raw===undefined)return undefined;
 const rows=await readMeaningContextRecords(tx,raw);
 return hydrateMeaningContexts(raw,key=>rows.get(key));
}

export async function readMeaningContextRecords(tx:Pick<LibraryTransaction,'get'>,raw:StoredMeaningRecord):Promise<Map<string,unknown>>{
 const rows=new Map(await Promise.all(meaningContextKeys(raw).map(async key=>[key,await tx.get('semanticContexts',key)] as const)));
 for(const row of [...rows.values()] as Array<ContextRecord|undefined>)if(row?.kind==='anchors'){
  for(const id of [row.value.currentRevisionId,...(row.value.conflictHistory?.branches.map(branch=>branch.revisionId)??[])]){const key=contextKey('anchorRevisions',id);if(!rows.has(key))rows.set(key,await tx.get('semanticContexts',key));}
 }
 const queue=[...rows.values()] as Array<ContextRecord|undefined>;
 for(let at=0;at<queue.length;at++){
  const row=queue[at];if(row?.kind!=='anchorRevisions'||!row.parentRevisionId)continue;
  const key=contextKey('anchorRevisions',row.parentRevisionId);
  if(!rows.has(key)){const parent=await tx.get<ContextRecord>('semanticContexts',key);rows.set(key,parent);queue.push(parent);}
 }
 return rows;
}

/** Extract changed canonical facts without rewriting untouched Contexts. A
 * Meaning detach changes only its association; it never deletes shared data. */
export function collectMeaningContexts(state:JourneyState,previous?:JourneyState):void{
 const heads=new Map(state.contexts.anchors.map(row=>[row.personalSemanticAnchorId,row]));
 const versions=new Map(state.contexts.anchorRevisions.map(row=>[row.personalSemanticAnchorRevisionId,row]));
 const parents={...state.contexts.anchorRevisionParents};
 const unchanged=new Set(previous?.meanings??[]);
 for(const meaning of state.meanings)if(!unchanged.has(meaning))for(const branch of [meaning,...(meaning.conflictHistory?.branches.map(row=>row.record)??[])]){
  for(const version of branch.personalSemanticAnchorRevisions){
   const prior=versions.get(version.personalSemanticAnchorRevisionId);
   if(prior&&!backupEqual(prior,version))invalid();
   if(!prior)versions.set(version.personalSemanticAnchorRevisionId,version);
   const parent=version.revision===1?null:branch.personalSemanticAnchorRevisions.find(row=>row.personalSemanticAnchorId===version.personalSemanticAnchorId&&row.revision===version.revision-1)?.personalSemanticAnchorRevisionId??invalid();
   if(Object.hasOwn(parents,version.personalSemanticAnchorRevisionId)&&parents[version.personalSemanticAnchorRevisionId]!==parent)invalid();
   parents[version.personalSemanticAnchorRevisionId]=parent;
  }
  for(const anchor of branch.personalSemanticAnchors){
   const current=branch.personalSemanticAnchorRevisions.find(row=>row.personalSemanticAnchorId===anchor.personalSemanticAnchorId&&row.revision===anchor.currentRevision)??invalid();
   const prior=heads.get(anchor.personalSemanticAnchorId);
   if(prior){
    if(prior.learnerUserId!==meaning.personalMeaning.learnerUserId||prior.createdAt!==anchor.createdAt)invalid();
    // Existing commands append revisions to their own branch. A detached
    // association has no authority to tombstone the independently saved Context.
    if(current.revision>prior.currentRevision)heads.set(anchor.personalSemanticAnchorId,{...prior,currentRevision:current.revision,currentRevisionId:current.personalSemanticAnchorRevisionId,updatedAt:anchor.updatedAt});
   }else{
    const {personalMeaningId:_,...head}=anchor;
    heads.set(anchor.personalSemanticAnchorId,{...head,learnerUserId:meaning.personalMeaning.learnerUserId,currentRevisionId:current.personalSemanticAnchorRevisionId,status:'active',lifecycleRevision:1,deletedAt:null,deletedByOperationId:null});
   }
  }
 }
 state.contexts={anchors:[...heads.values()],anchorRevisions:[...versions.values()],anchorRevisionParents:parents};
}

export function assertContextRecords(contexts:ContextState):void{
 const ids=new Set<string>(),versions=new Map<string,Revision>();
 for(const version of contexts.anchorRevisions){
  sensaPersonalSemanticAnchorRevisionSnapshotSchema.parse(version);
  if(versions.has(version.personalSemanticAnchorRevisionId))invalid();versions.set(version.personalSemanticAnchorRevisionId,version);
 }
 for(const head of contexts.anchors){
  contextHeadSchema.parse(head);
  if(ids.has(head.personalSemanticAnchorId))invalid();ids.add(head.personalSemanticAnchorId);
  const current=versions.get(head.currentRevisionId);
  if(current?.personalSemanticAnchorId!==head.personalSemanticAnchorId||current.revision!==head.currentRevision)invalid();
 }
 for(const version of versions.values()){
  if(!ids.has(version.personalSemanticAnchorId))invalid();
  if(!Object.hasOwn(contexts.anchorRevisionParents,version.personalSemanticAnchorRevisionId))invalid();
  const parentId=contexts.anchorRevisionParents[version.personalSemanticAnchorRevisionId];
  if(version.revision===1){if(parentId!==null)invalid();}
  else {const parent=typeof parentId==='string'?versions.get(parentId):undefined;if(parent?.personalSemanticAnchorId!==version.personalSemanticAnchorId||parent.revision!==version.revision-1)invalid();}
 }
 const ancestry=new Map(contexts.anchorRevisions.map(row=>[row.personalSemanticAnchorRevisionId,{personalSemanticAnchorId:row.personalSemanticAnchorId,parentRevisionId:contexts.anchorRevisionParents[row.personalSemanticAnchorRevisionId]!}]));
 for(const head of contexts.anchors)assertContextConflictHistory(head,ancestry);
 for(const head of contexts.anchors)assertContextLifecycle(head,id=>{const value=versions.get(id);return value?{value,parentRevisionId:contexts.anchorRevisionParents[id]!}:undefined;});
}

/** A hydrated projection must contain the exact canonical immutable bytes. */
export function contextBodyLookup(contexts:ContextState){return {
 revisions:new Map(contexts.anchorRevisions.map(row=>[row.personalSemanticAnchorRevisionId,row])),
 heads:new Map(contexts.anchors.map(row=>[row.personalSemanticAnchorId,row])),
};}
export function assertMeaningContextBodies(record:MeaningJourneyRecord,{revisions,heads}:ReturnType<typeof contextBodyLookup>):void{
 for(const branch of [record,...(record.conflictHistory?.branches.map(row=>row.record)??[])]){
  for(const revision of branch.personalSemanticAnchorRevisions)if(!backupEqual(revisions.get(revision.personalSemanticAnchorRevisionId),revision))invalid();
  for(const anchor of branch.personalSemanticAnchors){const head=heads.get(anchor.personalSemanticAnchorId);if(!head||head.learnerUserId!==record.personalMeaning.learnerUserId||head.createdAt!==anchor.createdAt)invalid();}
 }
}

/** Restore validates one canonical row at a time. Exact parent/head lookups
 * do not retain every Context body in memory. */
export function assertContextRecord(key:string,raw:unknown,read:(key:string)=>unknown):void{
 const row=raw as ContextRecord;
 if(!row||!['anchors','anchorRevisions'].includes(row.kind)||key!==contextKey(row.kind,contextRecordId(row)))invalid();
 if(Object.keys(row).some(key=>!(row.kind==='anchors'?['kind','value']:['kind','value','parentRevisionId']).includes(key)))invalid();
 if(row.kind==='anchors'){
  contextHeadSchema.parse(row.value);
  assertContextLifecycle(row.value,id=>{const version=read(contextKey('anchorRevisions',id)) as ContextRecord|undefined;return version?.kind==='anchorRevisions'?version:undefined;});
  const current=read(contextKey('anchorRevisions',row.value.currentRevisionId)) as ContextRecord|undefined;
  if(current?.kind!=='anchorRevisions'||current.value.personalSemanticAnchorId!==row.value.personalSemanticAnchorId||current.value.revision!==row.value.currentRevision)invalid();
  if(row.value.conflictHistory){
   const versions=new Map<string,{personalSemanticAnchorId:string;parentRevisionId:string|null}>(),queue=[row.value.currentRevisionId,...row.value.conflictHistory.branches.map(branch=>branch.revisionId)];
   for(let at=0;at<queue.length;at++){const id=queue[at]!;if(versions.has(id))continue;const raw=read(contextKey('anchorRevisions',id)) as ContextRecord|undefined;const version=raw?.kind==='anchorRevisions'?raw:invalid();versions.set(id,{personalSemanticAnchorId:version.value.personalSemanticAnchorId,parentRevisionId:version.parentRevisionId});if(version.parentRevisionId)queue.push(version.parentRevisionId);}
   assertContextConflictHistory(row.value,versions);
  }
 }else{
  sensaPersonalSemanticAnchorRevisionSnapshotSchema.parse(row.value);
  const head=read(contextKey('anchors',row.value.personalSemanticAnchorId)) as ContextRecord|undefined;
  if(head?.kind!=='anchors'||head.value.personalSemanticAnchorId!==row.value.personalSemanticAnchorId)invalid();
  if(row.value.revision===1){if(row.parentRevisionId!==null)invalid();}
  else {
   if(typeof row.parentRevisionId!=='string')invalid();
   const parent=read(contextKey('anchorRevisions',row.parentRevisionId!)) as ContextRecord|undefined;
   if(parent?.kind!=='anchorRevisions'||parent.value.personalSemanticAnchorId!==row.value.personalSemanticAnchorId||parent.value.revision!==row.value.revision-1)invalid();
  }
 }
}

export function contextRevisionDescends(contexts:ContextState,revisionId:string,ancestorId:string):boolean{
 const seen=new Set<string>();let next:string|null|undefined=revisionId;
 while(next&&!seen.has(next)){if(next===ancestorId)return true;seen.add(next);next=contexts.anchorRevisionParents[next];}
 return false;
}

export function contextMediaReferences(row:unknown):string[]{
 const fact=row as ContextRecord|undefined;
 if(fact?.kind!=='anchorRevisions')return [];
 const references=fact.value.structuredPayload.mediaReferenceIds;
 return [...new Set([...(fact.value.personalMediaObjectId?[fact.value.personalMediaObjectId]:[]),...(Array.isArray(references)?references.filter((id):id is string=>typeof id==='string'):[])])];
}
