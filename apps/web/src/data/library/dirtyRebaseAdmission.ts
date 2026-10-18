import {backupEqual,decodeBackupValue} from './backupCodec';
import {admitLearningDelta,DeltaReceiveFallback} from './learningDeltaAdmission';
import {replicaEntryId,replicaEntryEqual,type LibraryReplicaEntry} from './replication/libraryReplica';
import {assertPersonalSemanticWorldRecordSteps} from '../../experience/personalMeaningJourney/authority';
import {hydrateMeaningContexts,storeMeaningContexts,type ContextRecord} from '../../experience/personalMeaningJourney/contextRecords';
import {appendMeaningRevision} from '../../experience/personalMeaningJourney/meaningRecords';
import {assertContextDeltaShape} from './contextDeltaAdmission';
import {runCooperatively} from '../../experience/personalMeaningJourney/cooperative';
import {replicaWork} from './replicaWork';
import type {LibraryRecordReader} from './libraryRecordReader';
import type {SqliteSyncDependencies,SyncDependencyCertificate} from './sqliteSyncDependencies';
import type {RecordValidationIndex} from './sqliteRecordValidation';

const learningTables=new Set(['learningTargets','learningRuns','learningEvents','learningReconciliations','studyScopes','learningSessions']);
const learningKey=(row:{table:string;key:string})=>learningTables.has(row.table)||row.table==='meta'&&['learning-active','learning-session-active'].includes(row.key)||row.table==='settings'&&row.key==='language-route-study-plans';
function fallback():never{throw new DeltaReceiveFallback('dirty_structural_or_source_change');}
/** Reuse the existing single-operation eligibility for every new stamp. The
 * virtual rows are shape witnesses only: no command, clock or outcome runs. */
function* contextBatch(input:{base:readonly LibraryReplicaEntry[];entries:readonly LibraryReplicaEntry[];before:LibraryRecordReader;after:LibraryRecordReader;alive:()=>void},changes:readonly {table:LibraryReplicaEntry['table'];key:string;deleted?:boolean}[]){
 const changed=changes.filter(row=>['semanticMeanings','semanticContexts','semanticReceipts'].includes(row.table));if(!changed.length)return;
 const working=new Map<string,any>(),get=(table:any,key:string)=>working.has(replicaEntryId({table,key}))?working.get(replicaEntryId({table,key})):input.before.get(table,key);
 const remaining=new Set(changed.map(replicaEntryId)),operations:any[]=[];
 for(const key of changed.filter(row=>row.table==='semanticMeanings')){
  const before=input.before.get(key.table,key.key),after=input.after.get(key.table,key.key);if(new TextEncoder().encode(JSON.stringify([before,after])).length>4*1024*1024)fallback();if(!before||!after||before.conflictHistory||after.conflictHistory)fallback();
  if(!backupEqual(after.personalMeaningRevisions.slice(0,before.personalMeaningRevisions.length),before.personalMeaningRevisions))fallback();
  for(const stamp of after.personalMeaningRevisions.slice(before.personalMeaningRevisions.length))operations.push({meaningKey:key.key,stamp});
 }
 const versions=new Map<string,Array<{key:string;value:ContextRecord}>>();
 for(const key of changed.filter(row=>row.table==='semanticContexts')){const value=input.after.get(key.table,key.key) as ContextRecord|undefined;if(value?.kind==='anchorRevisions'&&!input.before.has(key.table,key.key)){const op=value.value.provenance.createdByOperationId,group=versions.get(op)??[];group.push({key:key.key,value});versions.set(op,group);}}
 while(operations.length){let progressed=false;
  for(let at=0;at<operations.length;){input.alive();yield;const {meaningKey,stamp}=operations[at],operationId=stamp.provenance.createdByOperationId,rows=versions.get(operationId);if(rows?.length!==1)fallback();const version=rows[0]!.value as Extract<ContextRecord,{kind:'anchorRevisions'}>,headKey='anchors:'+version.value.personalSemanticAnchorId,priorHead=get('semanticContexts',headKey) as Extract<ContextRecord,{kind:'anchors'}>|undefined,prior=get('semanticMeanings',meaningKey);
   if(!priorHead||!prior)fallback();if(priorHead.value.currentRevisionId!==version.parentRevisionId||prior.personalMeaning.currentRevision+1!==stamp.revision){at++;continue;}
   const nextHead={...priorHead,value:{...priorHead.value,currentRevisionId:version.value.personalSemanticAnchorRevisionId,currentRevision:version.value.revision,updatedAt:version.value.createdAt}};
   const nextRaw=structuredClone(prior),anchor=nextRaw.personalSemanticAnchors.find((row:any)=>row.personalSemanticAnchorId===version.value.personalSemanticAnchorId);if(!anchor)fallback();anchor.selectedRevisionId=version.value.personalSemanticAnchorRevisionId;anchor.updatedAt=version.value.createdAt;nextRaw.personalSemanticAnchorRevisions.push({personalSemanticAnchorId:version.value.personalSemanticAnchorId,personalSemanticAnchorRevisionId:version.value.personalSemanticAnchorRevisionId});
   const hydrated=hydrateMeaningContexts(nextRaw,key=>key===rows[0]!.key?version:key===headKey?nextHead:get('semanticContexts',key));
   appendMeaningRevision({newId:()=>stamp.personalMeaningRevisionId,nowIso:()=>stamp.createdAt},hydrated,operationId,[version.value.personalSemanticAnchorId]);
   const successor=storeMeaningContexts(hydrated),receipt=input.after.get('semanticReceipts',operationId),step=[{table:'semanticContexts' as const,key:headKey,value:nextHead},{table:'semanticContexts' as const,key:rows[0]!.key,value:version},{table:'semanticMeanings' as const,key:meaningKey,value:successor},{table:'semanticReceipts' as const,key:operationId,value:receipt}],overlay=new Map(step.map(row=>[replicaEntryId(row),row.value]));
   const reader=(next:boolean):LibraryRecordReader=>({get:(table,key)=>next&&overlay.has(replicaEntryId({table:table as LibraryReplicaEntry['table'],key}))?overlay.get(replicaEntryId({table:table as LibraryReplicaEntry['table'],key})):get(table,key),has(table,key){return this.get(table,key)!==undefined;},*entries(){throw Error('library_sync_unproved_complement_enumeration');}});
   assertContextDeltaShape({changes:step,base:reader(false),remote:reader(true),alive:input.alive,receipts:()=>[]});
   if(!backupEqual(successor.personalMeaningRevisions.at(-1),stamp))fallback();
   for(const row of step){working.set(replicaEntryId(row),row.value);remaining.delete(replicaEntryId(row));}operations.splice(at,1);progressed=true;
  }
  if(!progressed)fallback();
 }
 if(remaining.size)fallback();for(const [id,value]of working){const [table,key]=JSON.parse(id);if(!backupEqual(value,input.after.get(table,key)))fallback();}
}

/** Prove a successor of admitted B using complete changed cohorts and an exact
 * unchanged complement. This is deliberately not a full-library reader. */
export async function admitDirtyRebaseOverlay(input:{
 base:readonly LibraryReplicaEntry[];entries:readonly LibraryReplicaEntry[];
 before:LibraryRecordReader;after:LibraryRecordReader;certificate:SyncDependencyCertificate;dependencies:SqliteSyncDependencies;
 validationIndex:RecordValidationIndex;alive:()=>void;
}){
 const {alive}=input,base=new Map(input.base.map(row=>[replicaEntryId(row),row])),next=new Map(input.entries.map(row=>[replicaEntryId(row),row]));
 const changes=[...new Set([...base.keys(),...next.keys()])].flatMap(id=>{const prior=base.get(id),after=next.get(id);return replicaEntryEqual(prior,after)?[]:[{table:(after??prior)!.table,key:(after??prior)!.key,...(!after?{deleted:true}:{})}];});
 for(const row of input.entries){alive();decodeBackupValue(row.value);if(typeof row.key!=='string'||!row.key.length||row.key.length>2000)throw Error('library_sync_format');}
 for(const row of changes){alive();
  if(learningKey(row)||['semanticMeanings','semanticContexts','semanticReceipts'].includes(row.table)||row.table==='settings'&&!['language-learning-routes','providers'].includes(row.key))continue;
  fallback();
 }
 await runCooperatively(contextBatch(input,changes));alive();
 // These are exactly the selected World owners. Point reads resolve their
 // immutable Registry/media/receipt dependencies in the fixed successor.
 await runCooperatively(assertPersonalSemanticWorldRecordSteps({storageKeysUnique:true,validationIndex:input.validationIndex,get:(table,key)=>{alive();return input.after.get(table,key);},*entries(table){for(const row of input.entries)if(row.table===table){alive();yield {key:row.key,value:decodeBackupValue(row.value)};}}}));alive();
 await admitLearningDelta({changes:changes.filter(learningKey),revalidateKeys:input.entries.filter(learningKey),base:input.before,remote:input.after,certificate:input.certificate,dependencies:input.dependencies,alive});
 replicaWork('rebase.differentialAdmissions');replicaWork('rebase.differentialChangedRecords',changes.length);
}
