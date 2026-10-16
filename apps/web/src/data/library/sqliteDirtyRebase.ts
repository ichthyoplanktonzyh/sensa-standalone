import {librarySyncTables} from '@sensa/contracts/sensa';
import {backupEqual,decodeBackupValue,encodeBackupValue} from './backupCodec';
import {replicaWork} from './replicaWork';
import {runCooperatively} from '../../experience/personalMeaningJourney/cooperative';
import {libraryReplicaMergeTokens} from './replication/libraryReplicaCohorts';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry,mergeLibraryReplicasCooperatively,partitionLibraryReplicaConflicts,finalizeLibraryReplicaConflictChoice,planLibraryReplicaApplyCooperatively,replicaEntryId,replicaEntryEqual,type LibraryReplicaEntry} from './replication/libraryReplica';
import {validateLibraryReplicaRecordsCooperatively,validateLearningConflictReplicaCooperatively} from './replication/libraryReplicaValidation';
import type {LibraryRecordReader} from './libraryRecordReader';
import type {SqliteLibraryTable} from './sqliteProtocol';
import type {ReplicaCandidateFence,ReplicaCandidateRebase,ReplicaCandidateRebaseFence,ReplicaCandidateValidation} from './replicaCandidateProtocol';
import type {CloudSyncState} from './cloudSync';

type Key=Pick<LibraryReplicaEntry,'table'|'key'>;
type Rows=<T>(sql:string,bind?:readonly (string|number|null)[])=>T[];
export type DirtyRebasePlan={receipt:ReplicaCandidateRebase;puts:LibraryReplicaEntry[];deletes:LibraryReplicaEntry[];basePuts:LibraryReplicaEntry[];baseDeletes:Key[]};
const bytes=(text:string)=>new TextEncoder().encode(text).length;

/** A fixed R plus an exact refs/journal difference is a complete B/L/R
 * decomposition. Outside the selected component all three sides agree.
 * Metadata is paged on disk; bodies are retained only for that component. */
export async function prepareDirtyRebase(input:{
 id:string;fence:ReplicaCandidateFence;base:ReplicaCandidateRebaseFence;candidate:ReplicaCandidateValidation;state:CloudSyncState;
 rows:Rows;edges:(rows:Array<Key&{tokens:string[]}>)=>void;
 remote:LibraryRecordReader;remoteText:(table:SqliteLibraryTable,key:string)=>string;
 readBase:(table:SqliteLibraryTable,key:string)=>string;readLocal:(table:SqliteLibraryTable,key:string)=>string|null;
 alive:()=>void;validateIndex:()=>{index:import('./sqliteRecordValidation').RecordValidationIndex;close:()=>void};progress:(completed:number)=>void;
}):Promise<DirtyRebasePlan>{
 const {id,fence,base,rows,alive}=input,selected=new Map<string,Key>(),changed=new Set<string>();
 const enqueue=(key:Key)=>{const identity=replicaEntryId(key);if(selected.has(identity))return;if(selected.size>=16384)throw Error('library_sync_capacity');if(!isReplicatedLibraryEntry(key.table,key.key))throw Error('library_sync_format');selected.set(identity,key);};
 let table='',key='',scanned=0,phaseAt=performance.now();
 // The admission already decoded R one row at a time. Reuse its metadata;
 // do not scan B or L bodies to discover reverse relationships.
 for(;;){alive();const page=rows<{table_name:Key['table'];record_key:string;edges_json:string}>(`SELECT table_name,record_key,edges_json FROM sensa_sync_admission_rows_v1 WHERE scope=? AND(table_name,record_key)>(?,?) ORDER BY table_name,record_key LIMIT 64`,['candidate:'+id,table,key]);if(!page.length)break;
  input.edges(page.map(row=>({table:row.table_name,key:row.record_key,tokens:(JSON.parse(row.edges_json) as string[][]).filter(pair=>pair[0]==='merge').map(pair=>pair[1])})));
  table=page.at(-1)!.table_name;key=page.at(-1)!.record_key;input.progress(scanned+=page.length);replicaWork('rebase.metadataRecords',page.length);await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 replicaWork('rebase.metadataMs',performance.now()-phaseAt);phaseAt=performance.now();
 // Symmetric refs difference proves B=R for every other key, including absence.
 const remoteChanges=rows<{table:Key['table'];key:string}>(`SELECT table_name AS "table",record_key AS "key" FROM(
  SELECT remote.table_name,remote.record_key FROM sensa_replica_candidate_records_v1 remote LEFT JOIN sensa_sync_base prior ON prior.table_name=remote.table_name AND prior.record_key=remote.record_key WHERE remote.candidate_id=? AND(prior.record_key IS NULL OR prior.block_refs_json!=remote.refs_json)
  UNION SELECT prior.table_name,prior.record_key FROM sensa_sync_base prior LEFT JOIN sensa_replica_candidate_records_v1 remote ON remote.candidate_id=? AND remote.table_name=prior.table_name AND remote.record_key=prior.record_key WHERE remote.record_key IS NULL) LIMIT 16385`,[id,id]);
 for(const row of remoteChanges)enqueue(row);
 // Journal pages contain identities only. Old bodies never cross this scan.
 let after={revision:base.baseLocalRevision,table:'',key:''};
 for(;;){alive();const page=rows<{table:Key['table'];key:string;revision:number}>(`SELECT table_name AS "table",record_key AS "key",content_revision AS revision FROM(
  SELECT table_name,record_key,content_revision FROM sensa_records WHERE content_revision>?
  UNION ALL SELECT table_name,record_key,content_revision FROM sensa_record_tombstones WHERE content_revision>?)
  WHERE table_name IN(SELECT value FROM json_each(?)) AND(content_revision,table_name,record_key)>(?,?,?) ORDER BY content_revision,table_name,record_key LIMIT 128`,[base.baseLocalRevision,base.baseLocalRevision,JSON.stringify(librarySyncTables),after.revision,after.table,after.key]);
  for(const row of page)if(isReplicatedLibraryEntry(row.table,row.key)){enqueue(row);changed.add(replicaEntryId(row));}if(page.length<128)break;const last=page.at(-1)!;after={revision:last.revision,table:last.table,key:last.key};await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 enqueue({table:'meta',key:'identity'});
 replicaWork('rebase.diffAndJournalMs',performance.now()-phaseAt);phaseAt=performance.now();
 const branches={base:[] as LibraryReplicaEntry[],local:[] as LibraryReplicaEntry[],remote:[] as LibraryReplicaEntry[]};let decodedBytes=0;
 const read=(side:keyof typeof branches,k:Key):LibraryReplicaEntry|undefined=>{
  const prior=side==='remote'?rows<{refs:string}>('SELECT refs_json AS refs FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,k.table,k.key])[0]:rows<{refs:string}>('SELECT block_refs_json AS refs FROM sensa_sync_base WHERE table_name=? AND record_key=?',[k.table,k.key])[0];
  let text:string|null|undefined;
  if(side==='local'&&changed.has(replicaEntryId(k))){const stored=input.readLocal(k.table,k.key);if(stored===null)return;text=JSON.stringify(encodeBackupValue(normalizeLibraryReplicaEntry({...k,value:decodeBackupValue(JSON.parse(stored))},fence.identity).value));}
  else if(prior)text=side==='remote'?input.remoteText(k.table,k.key):input.readBase(k.table,k.key);
  if(text===undefined||text===null)return;
  decodedBytes+=bytes(text)+bytes(prior?.refs??'');if(decodedBytes>64*1024*1024)throw Error('library_sync_capacity');
  const value=JSON.parse(text);return {...k,value,...(side!=='local'||!changed.has(replicaEntryId(k))?{blocks:prior?JSON.parse(prior.refs):undefined}:{})};
 };
 // All changed old/local edges are installed before traversal. Thus a key
 // deleted from R can still connect an unchanged peer through its old owner.
 const loaded=new Set<string>();
 const load=(k:Key)=>{const identity=replicaEntryId(k);if(loaded.has(identity))return;loaded.add(identity);const tokens=new Set<string>();for(const side of ['base','local','remote'] as const){const entry=read(side,k);if(entry){branches[side].push(entry);for(const token of libraryReplicaMergeTokens(k,decodeBackupValue(entry.value)))tokens.add(token);}}input.edges([{...k,tokens:[...tokens]}]);};
 await runCooperatively((function*(){for(const k of selected.values()){alive();load(k);yield;}})());
 const queue=[...selected.values()];
 await runCooperatively((function*(){for(let at=0;at<queue.length;at++){alive();const k=queue[at]!;load(k);
  const peers=rows<Key>(`SELECT DISTINCT peer.table_name AS "table",peer.record_key AS "key" FROM sensa_replica_candidate_merge_edges_v1 own JOIN sensa_replica_candidate_merge_edges_v1 peer ON peer.candidate_id=own.candidate_id AND peer.token=own.token WHERE own.candidate_id=? AND own.table_name=? AND own.record_key=? LIMIT 16385`,[id,k.table,k.key]);
  for(const peer of peers){const size=selected.size;enqueue(peer);if(selected.size!==size)queue.push(peer);}yield;
 }} )());
 replicaWork('rebase.closureMs',performance.now()-phaseAt);replicaWork('rebase.componentKeys',selected.size);replicaWork('rebase.componentDecodedBytes',decodedBytes);alive();phaseAt=performance.now();const merged=await mergeLibraryReplicasCooperatively(branches);alive();replicaWork('rebase.mergeMs',performance.now()-phaseAt);
 let local=merged.entries,upload=merged.entries,conflicts=merged.conflicts,affected:string[]=[],nextBase=(entries:LibraryReplicaEntry[])=>entries;
 if(conflicts.length){const partition=partitionLibraryReplicaConflicts({...branches,merged:merged.entries,conflicts});affected=partition.affectedRecordIds;
  if(input.state.resolution?.expectedRemoteRevision===input.candidate.head.revision&&input.state.resolution.expectedLocalRevision===fence.localRevision){local=upload=finalizeLibraryReplicaConflictChoice(input.state.resolution.choice==='local'?partition.local:partition.upload,merged.entries,{...branches,conflicts,decision:input.state.resolution.decision});conflicts=[];}
  else{local=partition.local;upload=partition.upload;nextBase=partition.base;}
 }
 for(const entries of [local,upload])for(const row of entries)if(!selected.has(replicaEntryId(row))){enqueue(row);decodedBytes+=bytes(JSON.stringify(row.value));if(decodedBytes>64*1024*1024)throw Error('library_sync_capacity');}
 const known=new Set([...branches.local,...branches.remote].filter(row=>row.table==='learningReconciliations').map(row=>row.key));

 const overlay=(entries:LibraryReplicaEntry[]):LibraryRecordReader=>{
  const values=new Map(entries.map(row=>[replicaEntryId(row),row]));
  const lookup=(table:SqliteLibraryTable,key:string)=>replicaEntryId({table:table as Key['table'],key});
  return {storageKeysUnique:true,
   get(table,key){const identity=lookup(table,key),row=values.get(identity);return row?decodeBackupValue(row.value):selected.has(identity)?undefined:input.remote.get(table,key);},
   has(table,key){const identity=lookup(table,key);return values.has(identity)||!selected.has(identity)&&input.remote.has(table,key);},
   *entries(table){for(const row of input.remote.entries(table))if(!selected.has(lookup(table,row.key))&&!values.has(lookup(table,row.key)))yield row;for(const row of entries)if(row.table===table)yield {key:row.key,value:decodeBackupValue(row.value)};},
  };
 };
 const validate=async(entries:LibraryReplicaEntry[])=>{const index=input.validateIndex();try{await validateLibraryReplicaRecordsCooperatively({...overlay(entries),validationIndex:index.index});alive();}finally{index.close();}};
 let validationFailed=false;phaseAt=performance.now();try{await validateLearningConflictReplicaCooperatively(local,new Set(local.filter(row=>row.table==='learningReconciliations'&&!known.has(row.key)).map(row=>decodeBackupValue(row.value).targetId)));await validate(local);if(local!==upload)await validate(upload);}catch(cause){alive();if(!conflicts.length)throw cause;validationFailed=true;}finally{replicaWork('rebase.overlayValidationMs',performance.now()-phaseAt);}
 const changes=validationFailed?{puts:[] as LibraryReplicaEntry[],deletes:[] as LibraryReplicaEntry[]}:await planLibraryReplicaApplyCooperatively(branches.local,local,alive),remoteById=new Map(branches.remote.map(row=>[replicaEntryId(row),row])),uploadById=new Map(upload.map(row=>[replicaEntryId(row),row]));
 const puts=validationFailed?[]:upload.filter(row=>!replicaEntryEqual(row,remoteById.get(replicaEntryId(row)))),deletes=validationFailed?[]:branches.remote.filter(row=>!uploadById.has(replicaEntryId(row))).map(({table,key})=>({table,key}));
 const desiredBase=nextBase(branches.remote),baseById=new Map(branches.base.map(row=>[replicaEntryId(row),row])),desiredIds=new Set(desiredBase.map(replicaEntryId));
 const basePuts=validationFailed?[]:desiredBase.filter(row=>!backupEqual(row.blocks,baseById.get(replicaEntryId(row))?.blocks)),baseDeletes=validationFailed?[]:branches.base.filter(row=>!desiredIds.has(replicaEntryId(row))).map(({table,key})=>({table,key}));
 const records=[...changes.puts,...changes.deletes].map(({table,key})=>({table,key})),contentChanged=records.length>0;
 let conflict:ReplicaCandidateRebase['conflict'];
 if(conflicts.length){const {buildCloudSyncComparison}=await import('./cloudSyncComparison'),maps={base:new Map(branches.base.map(row=>[replicaEntryId(row),row])),local:new Map(branches.local.map(row=>[replicaEntryId(row),row])),remote:remoteById};
  conflict={detectedAt:new Date().toISOString(),localRevision:fence.localRevision+(contentChanged?1:0),remoteRevision:input.candidate.head.revision,remoteManifest:input.candidate.head.manifest,records:conflicts.map(id=>({id,base:maps.base.get(id)??null,local:maps.local.get(id)??null,remote:maps.remote.get(id)??null})),affectedRecordIds:affected,comparison:buildCloudSyncComparison(conflicts,maps)};
 }
 const receipt:ReplicaCandidateRebase={kind:'dirty-rebase',id,baseRevision:base.baseRevision,baseLocalRevision:base.baseLocalRevision,remoteRevision:input.candidate.head.revision,localRevision:fence.localRevision,contentChanged,tables:[...new Set(records.map(row=>row.table))],records,conflicts,conflict,upload:{puts,deletes}};
 alive();return {receipt,puts:changes.puts,deletes:changes.deletes,basePuts,baseDeletes};
}
