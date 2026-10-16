import {backupEqual,encodeBackupValue} from './backupCodec';
import {DeltaReceiveFallback,type DeltaReceiveEvidence} from './learningDeltaAdmission';
import type {LibraryRecordReader} from './libraryRecordReader';
import {libraryReplicaDependencies,mergeLibraryReplicas,replicaEntryEqual,replicaEntryId,type LibraryReplicaEntry} from './replication/libraryReplica';
import {assertPersonalSemanticWorldState,assertPersonalSemanticWorldTransition} from '../../experience/personalMeaningJourney/authority';
import {assertContextRecord,contextKey,hydrateMeaningContexts,type ContextRecord} from '../../experience/personalMeaningJourney/contextRecords';
import {appendMeaningRevision} from '../../experience/personalMeaningJourney/meaningRecords';
import {contextBlocks} from '../../experience/personalMeaningJourney/contextFacts';
import {contextMaterialBlocks} from '../../experience/personalMeaningJourney/contextRead';
import {emptyJourneyState,JOURNEY_STORE_VERSION,type JourneyState,type CommandReceipt} from '../../experience/personalMeaningJourney/store';
import {assertMeaningLifecycleReceipts} from '../../experience/personalMeaningJourney/meaningLifecycle';
import {runCooperatively,runSynchronously} from '../../experience/personalMeaningJourney/cooperative';
import {replicaWork} from './replicaWork';
import type {SqliteLibraryTable} from './sqliteProtocol';

type Key={table:SqliteLibraryTable;key:string;deleted?:boolean};
type Input={changes:readonly Key[];base:LibraryRecordReader;remote:LibraryRecordReader;alive:()=>void;receipts:(meaningId:string)=>readonly {table:SqliteLibraryTable;key:string}[]};
function fallback():never{throw new DeltaReceiveFallback('context_shape');}
const omit=(value:any,fields:readonly string[])=>Object.fromEntries(Object.entries(value??{}).filter(([key])=>!fields.includes(key)));
const same=(a:unknown,b:unknown)=>backupEqual(a,b);
const keyId=(row:{table:string;key:string})=>JSON.stringify([row.table,row.key]);

/** Eligibility only. Other World commands retain complete admission. */
export function assertContextDeltaShape(input:Input){
 const {changes,base,remote}=input;if(changes.length!==4||changes.some(row=>row.deleted)||new Set(changes.map(keyId)).size!==4)fallback();
 const one=(table:Key['table'],prefix='')=>{const rows=changes.filter(row=>row.table===table&&row.key.startsWith(prefix));if(rows.length!==1)fallback();return rows[0];};
 const headKey=one('semanticContexts','anchors:'),revisionKey=one('semanticContexts','anchorRevisions:'),meaningKey=one('semanticMeanings'),receiptKey=one('semanticReceipts');
 const before=base.get('semanticContexts',headKey.key) as ContextRecord|undefined,after=remote.get('semanticContexts',headKey.key) as ContextRecord|undefined;
 const revision=remote.get('semanticContexts',revisionKey.key) as ContextRecord|undefined,oldMeaning=base.get('semanticMeanings',meaningKey.key),meaning=remote.get('semanticMeanings',meaningKey.key),receipt=remote.get('semanticReceipts',receiptKey.key) as CommandReceipt|undefined;
 if(before?.kind!=='anchors'||after?.kind!=='anchors'||revision?.kind!=='anchorRevisions'||!oldMeaning||!meaning||base.has('semanticContexts',revisionKey.key)||base.has('semanticReceipts',receiptKey.key))fallback();
 const old=before.value,next=after.value,version=revision.value;
 if(old.status!=='active'||old.conflictHistory||next.conflictHistory||oldMeaning.conflictHistory||meaning.conflictHistory||receipt?.command!=='ReviseContext'||receipt.operationId!==receiptKey.key||typeof receipt.requestDigest!=='string'||!/^[a-f0-9]{64}$/u.test(receipt.requestDigest))fallback();
 if(headKey.key!==contextKey('anchors',old.personalSemanticAnchorId)||revisionKey.key!==contextKey('anchorRevisions',version.personalSemanticAnchorRevisionId)||version.personalSemanticAnchorId!==old.personalSemanticAnchorId||next.currentRevisionId!==version.personalSemanticAnchorRevisionId||next.currentRevision!==old.currentRevision+1||version.revision!==next.currentRevision||revision.parentRevisionId!==old.currentRevisionId||next.updatedAt!==version.createdAt||!same(omit(old,['currentRevision','currentRevisionId','updatedAt']),omit(next,['currentRevision','currentRevisionId','updatedAt'])))fallback();
 const parent=base.get('semanticContexts',contextKey('anchorRevisions',old.currentRevisionId)) as ContextRecord|undefined;if(parent?.kind!=='anchorRevisions')fallback();
 const prior=parent.value,blocks=version.structuredPayload?.blocks as any;
 // Text-only revision: no new media, Scene owner, lifecycle or Registry facts.
 if(prior.lifecycle||version.lifecycle||prior.structuredPayload.learningScene||version.structuredPayload.learningScene||prior.personalMediaObjectId||version.personalMediaObjectId||!Array.isArray(blocks)||!blocks.length||blocks.some(block=>block.kind!=='text'||Object.keys(block).some(key=>!['kind','bodyText'].includes(key))))fallback();
 if((prior.structuredPayload.mediaReferenceIds as unknown[]|undefined)?.length||prior.structuredPayload.media||!same(blocks,contextBlocks(blocks))||same(blocks,contextMaterialBlocks(prior)))fallback();
 if(!same(version.structuredPayload,{blocks,...(prior.structuredPayload.intake?{intake:prior.structuredPayload.intake}:{}),mediaReferenceIds:[]})||!same(omit(prior,['personalSemanticAnchorRevisionId','revision','anchorKind','bodyText','structuredPayload','provenance','createdAt']),omit(version,['personalSemanticAnchorRevisionId','revision','anchorKind','bodyText','structuredPayload','provenance','createdAt']))||version.anchorKind!=='scene'||!same(version.provenance,{kind:'learner_authored',sourceReferenceIds:[prior.personalSemanticAnchorRevisionId],createdByOperationId:receipt.operationId}))fallback();
 const fields=['personalMeaning','personalMeaningRevisions','personalSemanticAnchors','personalSemanticAnchorRevisions'];
 if(!same(omit(oldMeaning,fields),omit(meaning,fields))||!same(omit(oldMeaning.personalMeaning,['currentRevision','updatedAt']),omit(meaning.personalMeaning,['currentRevision','updatedAt']))||meaningKey.key!==meaning.personalMeaning.personalMeaningId||meaning.personalMeaning.currentRevision!==oldMeaning.personalMeaning.currentRevision+1)fallback();
 if(!Array.isArray(meaning.personalMeaningRevisions)||meaning.personalMeaningRevisions.length!==oldMeaning.personalMeaningRevisions.length+1||!same(meaning.personalMeaningRevisions.slice(0,-1),oldMeaning.personalMeaningRevisions)||!same(meaning.personalSemanticAnchorRevisions,[...oldMeaning.personalSemanticAnchorRevisions,{personalSemanticAnchorId:old.personalSemanticAnchorId,personalSemanticAnchorRevisionId:version.personalSemanticAnchorRevisionId}]))fallback();
 const selected=oldMeaning.personalSemanticAnchors.filter((row:any)=>row.status==='active');if(selected.length!==1||selected[0].personalSemanticAnchorId!==old.personalSemanticAnchorId||selected[0].selectedRevisionId!==old.currentRevisionId)fallback();
 if(!same(meaning.personalSemanticAnchors,oldMeaning.personalSemanticAnchors.map((row:any)=>row===selected[0]?{...row,selectedRevisionId:version.personalSemanticAnchorRevisionId,updatedAt:version.createdAt}:row)))fallback();
 const stamp=meaning.personalMeaningRevisions.at(-1);if(stamp?.provenance.createdByOperationId!==receipt.operationId||!same(receipt.result,{personalMeaningRevisionId:stamp.personalMeaningRevisionId,revision:meaning.personalMeaning.currentRevision}))fallback();
 return {headKey,revisionKey,meaningKey,receiptKey,operationId:receipt.operationId};
}

function state(rows:LibraryReplicaEntry[]):JourneyState{
 const result=emptyJourneyState(),contexts=new Map<string,ContextRecord>();
 for(const row of rows)if(row.table==='semanticContexts')contexts.set(row.key,row.value as ContextRecord);
 for(const row of contexts.values())if(row.kind==='anchors')result.contexts.anchors.push(row.value);else{result.contexts.anchorRevisions.push(row.value);result.contexts.anchorRevisionParents[row.value.personalSemanticAnchorRevisionId]=row.parentRevisionId;}
 for(const row of rows){
  if(row.table==='semanticMeanings')result.meanings.push(hydrateMeaningContexts(row.value,key=>contexts.get(key)));
  else if(row.table==='semanticRegistry'){const fact=row.value as any;if(!(fact.kind in result.registry))fallback();(result.registry as any)[fact.kind].push(fact.value);}
  else if(row.table==='semanticReceipts')result.commandReceipts.push(row.value as CommandReceipt);
 }
 return result;
}

/** Same owned component and authorities as a scoped Meaning command. The
 * certified complement is unchanged: old immutable pins/owners survive, no
 * global Registry/media/Scene facts or foreign Meaning may enter this shape. */
function* contextSteps(input:Input):Generator<unknown,{identity:any;keys:Key[]}>{
 input.alive();const selected=assertContextDeltaShape(input),queue:Key[]=input.changes.map(row=>({...row})),seen=new Set(queue.map(keyId));
 const sides={base:new Map<string,LibraryReplicaEntry>(),remote:new Map<string,LibraryReplicaEntry>()};let bytes=0;
 const add=(key:{table:SqliteLibraryTable;key:string})=>{if(!['semanticContexts','semanticMeanings','semanticReceipts','semanticRegistry'].includes(key.table))fallback();if(key.table==='semanticMeanings'&&key.key!==selected.meaningKey.key)fallback();const id=keyId(key);if(seen.has(id))return;if(seen.size>=64)throw new DeltaReceiveFallback('context_component_capacity');seen.add(id);queue.push(key as Key);};
 for(let at=0;at<queue.length;at++){
  input.alive();yield;const key=queue[at],id=keyId(key);
  for(const side of ['base','remote'] as const){
   const value=input[side].get(key.table,key.key);if(value===undefined)continue;
   const row:LibraryReplicaEntry={table:key.table as LibraryReplicaEntry['table'],key:key.key,value};sides[side].set(id,row);bytes+=new TextEncoder().encode(JSON.stringify(encodeBackupValue(value))).length;if(bytes>4*1024*1024)throw new DeltaReceiveFallback('context_component_capacity');
   if(key.table==='semanticContexts'){
    const context=value as ContextRecord;if(context.kind==='anchorRevisions'&&(context.value.lifecycle||context.value.structuredPayload.learningScene))fallback();
   }
   for(const dependency of libraryReplicaDependencies(row,value))add(dependency);
   if(key.table==='semanticMeanings')for(const receipt of input.receipts(key.key))add(receipt);
   replicaWork('context.componentRead');
  }
 }
 // Capture every receipt selected by the existing reverse index, including
 // retained lifecycle/correction witnesses. New changed receipts are roots.
 input.alive();if(!same(input.base.get('semanticState','root'),{version:JOURNEY_STORE_VERSION}))fallback();
 for(const side of ['base','remote'] as const)for(const row of sides[side].values())if(row.table==='semanticContexts'){input.alive();assertContextRecord(row.key,row.value,key=>sides[side].get(keyId({table:'semanticContexts',key}))?.value);yield;}
 const before=[...sides.base.values()],after=[...sides.remote.values()];
 const prior=state(before),successor=state(after);
 for(const component of [prior,successor]){input.alive();assertPersonalSemanticWorldState(component);assertMeaningLifecycleReceipts(component.meanings,component.commandReceipts);yield;}
 // Reuse the command's own constructor to prove the new stamp is exactly a
 // Context revision, including its carried fields and derived display label.
 const expected=structuredClone(successor.meanings[0]),stamp=expected.personalMeaningRevisions.at(-1)!;
 expected.personalMeaning={...prior.meanings[0].personalMeaning};expected.personalMeaningRevisions=structuredClone(prior.meanings[0].personalMeaningRevisions);
 appendMeaningRevision({newId:()=>stamp.personalMeaningRevisionId,nowIso:()=>stamp.createdAt},expected,selected.operationId,[prior.contexts.anchors.find(row=>contextKey('anchors',row.personalSemanticAnchorId)===selected.headKey.key)!.personalSemanticAnchorId]);
 if(!same(expected.personalMeaning,successor.meanings[0].personalMeaning)||!same(expected.personalMeaningRevisions.at(-1),stamp))fallback();
 input.alive();assertPersonalSemanticWorldTransition(prior,successor);yield;
 const wire=(rows:LibraryReplicaEntry[])=>rows.map(row=>({...row,value:encodeBackupValue(row.value)}));
 const base=wire(before),remote=wire(after),merged=mergeLibraryReplicas({base,local:base,remote});
 const desired=new Map(remote.map(row=>[replicaEntryId(row),row]));if(merged.conflicts.length||merged.entries.length!==remote.length||merged.entries.some(row=>!replicaEntryEqual(row,desired.get(replicaEntryId(row)))))throw new DeltaReceiveFallback('context_merge_required');
 input.alive();replicaWork('context.componentKeys',seen.size);
 return {identity:input.base.get('meta','identity'),keys:input.changes.map(row=>({...row}))};
}
export function validateContextDelta(input:Input){return runSynchronously(contextSteps(input));}
export async function admitContextDelta(input:Input&{consume?:(records:Array<Key&{table:LibraryReplicaEntry['table']}>,changes:Array<Key&{table:LibraryReplicaEntry['table']}>)=>Promise<void>;window?:()=>()=>void}){
 const release=input.window?.();try{
  const result=await runCooperatively(contextSteps(input));input.alive();const keys=result.keys as Array<Key&{table:LibraryReplicaEntry['table']}>;await input.consume?.(keys,keys);input.alive();
  const evidence:DeltaReceiveEvidence={mode:'incremental',changedRecords:input.changes.length,modifiedRecords:result.keys.length,baselineBuildRecords:0,baselineRecordsRead:0,candidateRecordsRead:0,targets:0,runs:0,events:0,decisions:0,scopes:0,sessions:0,scopeRuns:0};
  return {identity:result.identity,evidence,prepare:async()=>{input.alive();return result.keys.map(({table,key})=>({table:table as LibraryReplicaEntry['table'],key}));}};
 }finally{release?.();}
}
