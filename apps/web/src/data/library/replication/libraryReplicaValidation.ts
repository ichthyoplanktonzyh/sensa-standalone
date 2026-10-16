import {runCooperatively} from '../../../experience/personalMeaningJourney/cooperative';
import {decodeBackupValue} from '../backupCodec';
import {validateLibrarySyncRecords,validateLibrarySyncRecordsCooperatively,validateLibraryRecordSteps,type BackupRows} from '../backupValidation';
import {sqliteLibraryTables} from '../sqliteProtocol';
import type {LibraryRecordReader} from '../libraryRecordReader';
import type {LibraryIdentity,Table} from '../store';
import {isReplicatedLibraryEntry,type LibraryReplicaEntry} from './libraryReplica';
/** Saved-state restoration integrity receipt only; never evidence of historical algorithm audit. Device-only. */
export const libraryRestoreValidationVersion=9 as const;

export type ValidatedLibraryReplica={identity:LibraryIdentity;records:LibraryRecordReader};

/** Validate a complete candidate replica before transport publication or apply. */
function replicaRecords(entries:LibraryReplicaEntry[],packageCache:BackupRows['packageCache']):LibraryRecordReader{
 const index=new Map<Table,Map<string,LibraryReplicaEntry>>(sqliteLibraryTables.map(table=>[table,new Map()]));
 for(const row of entries){
  if(!isReplicatedLibraryEntry(row.table,row.key))throw new Error('library_sync_format');
  const table=index.get(row.table)!;
  if(typeof row.key!=='string'||row.key.length===0||row.key.length>2000||table.has(row.key))throw Error('libraryBackup.errors.inconsistent');
  table.set(row.key,row);
 }
 const cache=new Map<string,BackupRows['packageCache'][number]>();
 for(const row of packageCache)if(index.get('packageInstallations')!.has(row.key)){
  if(cache.has(row.key))throw Error('libraryBackup.errors.inconsistent');cache.set(row.key,row);
 }
 const records:LibraryRecordReader={
  get(table,key){if(table==='packageCache')return cache.get(key)?.value;const row=index.get(table)!.get(key);return row?decodeBackupValue(row.value):undefined;},
  has:(table,key)=>table==='packageCache'?cache.has(key):index.get(table)!.has(key),
  *entries(table){if(table==='packageCache'){yield*cache.values();return;}for(const row of index.get(table)!.values())yield {key:row.key,value:decodeBackupValue(row.value)};},
 };
 return records;
}

export function validateLibraryReplica(entries:LibraryReplicaEntry[],packageCache:BackupRows['packageCache']=[]):ValidatedLibraryReplica{
 const records=replicaRecords(entries,packageCache);return {identity:validateLibrarySyncRecords(records),records};
}
export async function validateLibraryReplicaCooperatively(entries:LibraryReplicaEntry[],packageCache:BackupRows['packageCache']=[]):Promise<ValidatedLibraryReplica>{
 const records=replicaRecords(entries,packageCache);return {identity:await validateLibrarySyncRecordsCooperatively(records),records};
}

/** The same complete authority with a disk-backed or bounded overlay reader. */
export async function validateLibraryReplicaRecordsCooperatively(records:LibraryRecordReader):Promise<ValidatedLibraryReplica>{return {identity:await validateLibrarySyncRecordsCooperatively(records),records};}

/** Historical business proof for a resolved learning fork.
 * Retained decisions on ordinary syncs do not trigger this path. */
export async function validateLearningConflictReplicaCooperatively(entries:LibraryReplicaEntry[],targetIds:ReadonlySet<string>){
 if(!targetIds.size)return;
 const reader=replicaRecords(entries,[]),targets=new Set(targetIds),runs=new Set<string>();
 const runTargets=new Map<string,string[]>(),owners=new Map<string,{runId:string;targetId:string}>();for(const row of reader.entries('learningRuns')){runTargets.set(row.key,row.value.targetIds);for(const [targetId,p]of Object.entries(row.value.participants) as Array<[string,any]>){if(owners.has(p.protocolRunId))throw Error('libraryBackup.errors.inconsistent');owners.set(p.protocolRunId,{runId:row.key,targetId});}}
 let expanded=true;while(expanded){expanded=false;for(const [id,ids]of runTargets)if(ids.some(id=>targets.has(id))){runs.add(id);for(const target of ids)if(!targets.has(target)){targets.add(target);expanded=true;}}}
 const selected:LibraryRecordReader={...reader,*entries(table){
  if(table==='learningTargets'){for(const key of targets)yield {key,value:reader.get(table,key)};}
  else if(table==='learningRuns'){for(const key of runs)yield {key,value:reader.get(table,key)};}
  else if(table==='learningEvents'||table==='learningReconciliations'){for(const row of reader.entries(table))if(table==='learningEvents'?runs.has(row.value.runId):targets.has(row.value.targetId))yield row;}
 }};
 // Direct source facts resolve through the complete candidate. Only the actual
 // conflict's Target/Run lineage is enumerated by the historical authority.
 await runCooperatively(validateLibraryRecordSteps(selected,'restore',undefined,{
  assertProtocolOwner(protocolId,runId,targetId){const owner=owners.get(protocolId);if(owner?.runId!==runId||owner.targetId!==targetId)throw Error('libraryBackup.errors.inconsistent');},hasProtocolRunId(protocolId,targetId){return owners.get(protocolId)?.targetId===targetId;},sessionStarted(operationId,at,exceptId){for(const row of reader.entries('learningSessions'))if(row.key!==exceptId&&row.value.startedByOperationId===operationId&&row.value.startedAt===at)return true;return false;},
 }));
}
