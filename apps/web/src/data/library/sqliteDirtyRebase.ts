import {librarySyncTables} from '@sensa/contracts/sensa';
import {sha256} from '@sensa/learning-kernel';
import {DeltaReceiveFallback} from './learningDeltaAdmission';
import {backupEqual,decodeBackupValue,encodeBackupValue} from './backupCodec';
import {replicaWork} from './replicaWork';
import {runCooperatively} from '../../experience/personalMeaningJourney/cooperative';
import {libraryReplicaMergeTokens,dirtyRebaseCohortTokens} from './replication/libraryReplicaCohorts';
import {admitDirtyRebaseOverlay} from './dirtyRebaseAdmission';
import type {SqliteSyncDependencies,SyncDependencyCertificate} from './sqliteSyncDependencies';
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
 remote:LibraryRecordReader;remoteText:(table:SqliteLibraryTable,key:string,maximumBytes?:number)=>string;
 readBase:(table:SqliteLibraryTable,key:string)=>string;readLocal:(table:SqliteLibraryTable,key:string)=>string|null;
 alive:()=>void;validateIndex:(excluded?:Key[])=>{index:import('./sqliteRecordValidation').RecordValidationIndex;close:()=>void};progress:(completed:number)=>void;
 proof?:{certificate:SyncDependencyCertificate;dependencies:SqliteSyncDependencies};
}):Promise<DirtyRebasePlan>{
 const {id,fence,base,rows,alive}=input,selected=new Map<string,Key>(),changed=new Set<string>();
 // The complete-R fallback has no certificate binding B refs to its bodies.
 // Verify every retained row witness and compare equal-ref bodies with the
 // independently fetched R before using refs/journal as complement evidence.
 if(!input.proof){let table='',key='';for(;;){alive();const page=rows<{table:Key['table'];key:string;same:number;bytes:number}>('SELECT b.table_name AS "table",b.record_key AS "key",coalesce(b.block_refs_json=r.refs_json,0) AS same,d.logical_bytes AS bytes FROM sensa_sync_base b LEFT JOIN sensa_replica_candidate_records_v1 r ON r.candidate_id=? AND r.table_name=b.table_name AND r.record_key=b.record_key LEFT JOIN sensa_sync_dependency_rows_v1 d ON d.table_name=b.table_name AND d.record_key=b.record_key WHERE(b.table_name,b.record_key)>(?,?) ORDER BY b.table_name,b.record_key LIMIT 64',[id,table,key]);if(!page.length)break;for(const row of page){alive();if(row.bytes===null)throw Error('library_sync_dependency_corrupt');if(row.bytes>64*1024*1024)throw Error('library_sync_capacity');const digest=sha256(input.readBase(row.table,row.key));if(row.same&&digest!==sha256(input.remoteText(row.table,row.key,64*1024*1024)))throw Error('library_sync_dependency_corrupt');}table=page.at(-1)!.table;key=page.at(-1)!.key;await new Promise<void>(resolve=>setTimeout(resolve,0));}}
 const enqueue=(key:Key)=>{const identity=replicaEntryId(key);if(selected.has(identity))return;if(selected.size>=16384)throw Error('library_sync_capacity');if(!isReplicatedLibraryEntry(key.table,key.key))throw Error('library_sync_format');selected.set(identity,key);};
 let table='',key='',scanned=0,phaseAt=performance.now();
 // The admission already decoded R one row at a time. Reuse its metadata;
 // do not scan B or L bodies to discover reverse relationships.
 for(;!input.proof;){alive();const page=rows<{table_name:Key['table'];record_key:string;edges_json:string}>(`SELECT table_name,record_key,edges_json FROM sensa_sync_admission_rows_v1 WHERE scope=? AND(table_name,record_key)>(?,?) ORDER BY table_name,record_key LIMIT 64`,['candidate:'+id,table,key]);if(!page.length)break;
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
 const roots=new Set(selected.keys());
 if(input.proof){for(const row of selected.values()){
  if(!['semanticMeanings','semanticContexts','semanticReceipts','learningTargets','learningRuns','learningEvents','learningSessions','learningReconciliations','studyScopes','meta','settings'].includes(row.table))throw new DeltaReceiveFallback('dirty_structural_or_source_change');
  if(row.table==='semanticMeanings'&&rows('SELECT 1 FROM sensa_replica_candidate_merge_edges_v1 WHERE candidate_id=? AND token=? LIMIT 1',[id,JSON.stringify(['unpinned-meaning-consumer',row.key])]).length)throw new DeltaReceiveFallback('unpinned_meaning_consumer');
 }}
 if(input.proof&&[...selected.values()].some(row=>['learningTargets','learningRuns','learningEvents','learningSessions','learningReconciliations','studyScopes'].includes(row.table)||row.table==='meta'&&row.key!=='identity'))for(const key of ['learning-active','learning-session-active'])enqueue({table:'meta',key});
 replicaWork('rebase.diffAndJournalMs',performance.now()-phaseAt);phaseAt=performance.now();
 const branches={base:[] as LibraryReplicaEntry[],local:[] as LibraryReplicaEntry[],remote:[] as LibraryReplicaEntry[]};let decodedBytes=0;
 const read=(side:keyof typeof branches,k:Key):LibraryReplicaEntry|undefined=>{
  const prior=side==='remote'?rows<{refs:string}>('SELECT refs_json AS refs FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,k.table,k.key])[0]:rows<{refs:string}>('SELECT block_refs_json AS refs FROM sensa_sync_base WHERE table_name=? AND record_key=?',[k.table,k.key])[0];
  let text:string|null|undefined;
  if(side!=='remote'&&prior&&input.proof&&decodedBytes+input.proof.dependencies.rowBudget(k.table,k.key).logical_bytes>64*1024*1024)throw Error('library_sync_capacity');
  if(side==='local'&&changed.has(replicaEntryId(k))){const stored=input.readLocal(k.table,k.key);if(stored===null)return;if(decodedBytes+bytes(stored)>64*1024*1024)throw Error('library_sync_capacity');text=JSON.stringify(encodeBackupValue(normalizeLibraryReplicaEntry({...k,value:decodeBackupValue(JSON.parse(stored))},fence.identity).value));}
  else if(prior)text=side==='remote'?input.remoteText(k.table,k.key,Math.max(0,64*1024*1024-decodedBytes-bytes(prior.refs))):input.readBase(k.table,k.key);
  if(text===undefined||text===null)return;
  decodedBytes+=bytes(text)+bytes(prior?.refs??'');if(decodedBytes>64*1024*1024)throw Error('library_sync_capacity');
  const value=JSON.parse(text);return {...k,value,...(side!=='local'||!changed.has(replicaEntryId(k))?{blocks:prior?JSON.parse(prior.refs):undefined}:{})};
 };
 // All changed old/local edges are installed before traversal. Thus a key
 // deleted from R can still connect an unchanged peer through its old owner.
 const loaded=new Set<string>();
 const load=(k:Key)=>{const identity=replicaEntryId(k);if(loaded.has(identity))return;loaded.add(identity);const tokens=new Set<string>();for(const side of ['base','local','remote'] as const){const entry=read(side,k);if(entry){branches[side].push(entry);const value=decodeBackupValue(entry.value);if(input.proof&&roots.has(identity)&&k.table==='semanticContexts'&&rows('SELECT 1 FROM sensa_replica_candidate_merge_edges_v1 WHERE candidate_id=? AND token=? LIMIT 1',[id,JSON.stringify(['context-history-special',value.value.personalSemanticAnchorId])]).length)throw new DeltaReceiveFallback('context_history_shape');for(const token of libraryReplicaMergeTokens(k,value))tokens.add(token);if(input.proof)for(const token of dirtyRebaseCohortTokens(k,value))tokens.add(token);}}input.edges([{...k,tokens:[...tokens]}]);};
 await runCooperatively((function*(){for(const k of selected.values()){alive();load(k);yield;}})());
 const walk=async()=>{const queue=[...selected.values()];await runCooperatively((function*(){for(let at=0;at<queue.length;at++){alive();const k=queue[at]!;load(k);
  const kind=input.proof?" AND json_extract(own.token,'$[0]')='cohort'":" AND json_extract(own.token,'$[0]') NOT IN('cohort','validation-key','validation-scene','context-history-special','unpinned-meaning-consumer')";
  // DISTINCT otherwise lets SQLite scan every peer to avoid its temporary
  // index. Fix the bounded owner lookup as the outer loop before token seeks.
  const peers=rows<Key>(`SELECT DISTINCT peer.table_name AS "table",peer.record_key AS "key" FROM sensa_replica_candidate_merge_edges_v1 own CROSS JOIN sensa_replica_candidate_merge_edges_v1 peer ON peer.candidate_id=own.candidate_id AND peer.token=own.token WHERE own.candidate_id=? AND own.table_name=? AND own.record_key=?${kind} LIMIT 16385`,[id,k.table,k.key]);
  for(const peer of peers){const size=selected.size;enqueue(peer);if(selected.size!==size)queue.push(peer);}yield;
 }} )());};await walk();
 replicaWork('rebase.closureMs',performance.now()-phaseAt);alive();phaseAt=performance.now();let merged=await mergeLibraryReplicasCooperatively(branches);alive();
 // Only the complete-R admission builds the original conflict graph. Its
 // fallback also adds every changed/deleted B/L owner's old edges before walk.
 if(input.proof&&merged.conflicts.length)throw new DeltaReceiveFallback('dirty_conflict_requires_complete_candidate');
 replicaWork('rebase.mergeMs',performance.now()-phaseAt);replicaWork('rebase.componentKeys',selected.size);replicaWork('rebase.componentDecodedBytes',decodedBytes);
 let local=merged.entries,upload=merged.entries,conflicts=merged.conflicts,affected:string[]=[],nextBase=(entries:LibraryReplicaEntry[])=>entries;
 if(conflicts.length){const partition=partitionLibraryReplicaConflicts({...branches,merged:merged.entries,conflicts});affected=partition.affectedRecordIds;
  if(input.state.resolution?.expectedRemoteRevision===input.candidate.head.revision&&input.state.resolution.expectedLocalRevision===fence.localRevision){local=upload=finalizeLibraryReplicaConflictChoice(input.state.resolution.choice==='local'?partition.local:partition.upload,merged.entries,{...branches,conflicts,decision:input.state.resolution.decision});conflicts=[];}
  else{local=partition.local;upload=partition.upload;nextBase=partition.base;}
 }
 for(const entries of [local,upload])for(const row of entries)if(!selected.has(replicaEntryId(row))){enqueue(row);decodedBytes+=bytes(JSON.stringify(row.value));if(decodedBytes>64*1024*1024)throw Error('library_sync_capacity');}
 const known=new Set([...branches.local,...branches.remote].filter(row=>row.table==='learningReconciliations').map(row=>row.key));

 const support=new Set<string>();
 const remotePoint=(table:SqliteLibraryTable,key:string)=>{if(input.proof&&input.remote.has(table,key)){const identity=JSON.stringify(['remote-support',table,key]);if(!support.has(identity)){support.add(identity);decodedBytes+=bytes(input.remoteText(table,key,Math.max(0,64*1024*1024-decodedBytes)));if(decodedBytes>64*1024*1024)throw Error('library_sync_capacity');}}return input.remote.get(table,key);};
 const overlay=(entries:LibraryReplicaEntry[]):LibraryRecordReader=>{
  const values=new Map(entries.map(row=>[replicaEntryId(row),row]));
  const lookup=(table:SqliteLibraryTable,key:string)=>replicaEntryId({table:table as Key['table'],key});
  return {storageKeysUnique:true,
   get(table,key){const identity=lookup(table,key),row=values.get(identity);return row?decodeBackupValue(row.value):selected.has(identity)?undefined:remotePoint(table,key);},
   has(table,key){const identity=lookup(table,key);return values.has(identity)||!selected.has(identity)&&input.remote.has(table,key);},
   *entries(table){if(input.proof)throw Error('library_sync_unproved_complement_enumeration');for(const row of input.remote.entries(table))if(!selected.has(lookup(table,row.key))&&!values.has(lookup(table,row.key)))yield row;for(const row of entries)if(row.table===table)yield {key:row.key,value:decodeBackupValue(row.value)};},
  };
 };
 const baseValues=new Map(branches.base.map(row=>[replicaEntryId(row),row]));
 const before:LibraryRecordReader={storageKeysUnique:true,get(table,key){alive();const known=baseValues.get(replicaEntryId({table:table as Key['table'],key}));if(known)return decodeBackupValue(known.value);if(!rows('SELECT 1 FROM sensa_sync_base WHERE table_name=? AND record_key=?',[table,key]).length)return;const identity=JSON.stringify(['base-support',table,key]);if(input.proof&&!support.has(identity)&&decodedBytes+input.proof.dependencies.rowBudget(table,key).logical_bytes>64*1024*1024)throw Error('library_sync_capacity');const text=input.readBase(table,key);if(!support.has(identity)){support.add(identity);decodedBytes+=bytes(text);if(decodedBytes>64*1024*1024)throw Error('library_sync_capacity');}return decodeBackupValue(JSON.parse(text));},has(table,key){alive();return rows('SELECT 1 FROM sensa_sync_base WHERE table_name=? AND record_key=?',[table,key]).length>0;},*entries(){throw Error('library_sync_unproved_complement_enumeration');}};
 const validate=async(entries:LibraryReplicaEntry[])=>{const index=input.validateIndex(input.proof?[...selected.values()]:undefined);try{if(input.proof)await admitDirtyRebaseOverlay({base:branches.base,entries,before,after:overlay(entries),certificate:input.proof.certificate,dependencies:input.proof.dependencies,validationIndex:index.index,alive});else await validateLibraryReplicaRecordsCooperatively({...overlay(entries),validationIndex:index.index});alive();}finally{index.close();}};
 if(input.proof){await validate(branches.remote);await validate(branches.local);}
 let validationFailed=false;phaseAt=performance.now();try{await validateLearningConflictReplicaCooperatively(local,new Set(local.filter(row=>row.table==='learningReconciliations'&&!known.has(row.key)).map(row=>decodeBackupValue(row.value).targetId)),input.proof?overlay(local):undefined);await validate(local);if(local!==upload)await validate(upload);}catch(cause){alive();if(!conflicts.length)throw cause;validationFailed=true;}finally{replicaWork('rebase.overlayValidationMs',performance.now()-phaseAt);}
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
