import {SqliteRecordValidation,type RecordValidationIndex} from './sqliteRecordValidation';
import type {Database,PreparedStatement} from '@sqlite.org/sqlite-wasm';
import {z} from 'zod';
import {librarySyncRecordLimit,librarySyncLogicalByteLimit,librarySyncHead,librarySyncPullResult,librarySyncSnapshotPageResult,librarySyncMetadataPageBytes,librarySyncMetadataPageRefs,librarySyncBlockChars,canonicalConsumerJson} from '@sensa/contracts/sensa';
import {cloudScratchPayloadBytes,cloudScratchAllocatedBytes} from './cloudScratchStorage';
import {sha256} from '@sensa/learning-kernel';
import {backupEqual,decodeBackupValue,encodeBackupValue} from './backupCodec';
import {packStoredRecord,unpackStoredRecord,externalizeSharedRecordContent,sharedRecordTables,StoredRecordMemo,type PreparedStoredRecord} from './sharedRecordContent';
import {runCooperatively} from '../../experience/personalMeaningJourney/cooperative';
import {isReplicatedLibraryEntry,libraryReplicaDependencies,restoreLibraryReplicaValue,normalizeLibraryReplicaEntry,canCopyLibraryReplicaValue,mergeLibraryReplicasCooperatively,replicaEntryEqual,replicaEntryId,planLibraryReplicaApplyCooperatively,type LibraryReplicaEntry} from './replication/libraryReplica';
import {validatedCheckpoint} from './cloudSyncCheckpoint';
import type {CloudSyncState} from './cloudSync';
import type {SqliteMutation,SqliteLibraryTable} from './sqliteProtocol';
import type {LibraryRecordReader} from './libraryRecordReader';
import type {LibraryIdentity} from './store';
import {sealedRecordReader,type SealedRecordKey} from './sealedRecordReader';
import {SqliteSyncDependencies,syncAdmission,dependencyRowId,type SyncAdmission,type SyncDependencyCertificate} from './sqliteSyncDependencies';
import {admitLearningDelta,DeltaReceiveFallback,type DeltaReceiveEvidence} from './learningDeltaAdmission';
import {isFatalSqliteConnectionFailure,sqliteRollbackFailure} from './sqliteConnectionFailure';
import {replicaCandidateSchema,replicaCandidateAppendRecordLimit,replicaCandidateAppendReferenceLimit,type ReplicaCandidateRequest,type ReplicaCandidateFence,type ReplicaCandidateExpected,type ReplicaCandidateRecord,type ReplicaCandidateValidation,type ReplicaCandidateBlock,type ReplicaCandidateUpdate} from './replicaCandidateProtocol';
import {replicaCandidateProofBatchBytes,verifyReplicaCandidateBlock,verifyReplicaCandidateManifest} from './replicaCandidateProof';
import {replicaWork} from './replicaWork';

const uuid=z.string().uuid(),integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identitySchema=z.object({id:uuid,learnerId:uuid,deviceId:uuid,createdAt:z.string().datetime({offset:true}),schemaVersion:z.literal(2)}).strict();
const fenceSchema=z.object({owner:z.object({subject:uuid,accountId:uuid}).strict(),incarnation:z.string().min(1).max(128),localRevision:integer,identity:identitySchema}).strict();
const expectedSchema=z.object({libraryId:uuid,learnerId:uuid,records:z.number().int().min(1).max(librarySyncRecordLimit),stream:z.object({phase:z.enum(['snapshot','tail','complete']),position:z.object({revision:integer,offset:integer}),after:z.object({table:z.string(),key:z.string()}).nullable()}).optional(),head:librarySyncHead.refine(head=>head.manifest!==null)}).strict();
const maximumRecordBytes=90*1024*1024,maximumLogicalBytes=librarySyncLogicalByteLimit,maximumStoredBytes=cloudScratchPayloadBytes,appendBytes=4*1024*1024;
const utf8=(text:string)=>new TextEncoder().encode(text).length;
const dependencyRowStoredBudget='stored_value_bytes+2*length(CAST(refs_json AS BLOB))+length(CAST(table_name AS BLOB))+length(CAST(record_key AS BLOB))+72*json_array_length(refs_json)';
type Header={id:string;fence_json:string;expected_json:string;state:string;records:number;logical_bytes:number;stored_bytes:number;identity_json:string|null;allocated_baseline:number};
type StoredRow={record_key:string;value_json:string;representation:'packed'|'opaque'};
type RecordKey={table:LibraryReplicaEntry['table'];key:string};
type UpdatePlan={receipt:ReplicaCandidateUpdate;puts:RecordKey[];deletes:RecordKey[];basePuts:Array<RecordKey&{blockRefs:string[]}>};

/** Disk-backed, private candidate generations. Filling rows never enter the
 * live Library or sync baseline. A sealed generation has no write path; full
 * validation may yield while ordinary local reads and writes continue. */
export class SqliteReplicaCandidates{
 private ready=false;
 private readonly statements=new Map<string,PreparedStatement>();
 private readonly validations=new Map<string,{controller:AbortController;result:Promise<ReplicaCandidateValidation>}>();
 private readonly updates=new Map<string,{controller:AbortController;result:Promise<ReplicaCandidateUpdate|null>}>();
 private readonly seeds=new Map<string,{baseRevision:number;after:RecordKey|null}>();
 private readonly baselines=new Map<string,{generation:number;epoch:number;artifactRevision:number}>();
 private readonly sealedEpochs=new Map<string,number>();
 private readSlice:{id:string;baseRevision:number;changes:number}|undefined;
 private updatePlan:UpdatePlan|undefined;
 private readonly dependencies:SqliteSyncDependencies;
 private readonly admissions=new Map<string,SyncAdmission>();
 private readonly receiveEvidence=new Map<string,DeltaReceiveEvidence>();
 private readonly sparse=new Map<string,{accessByPhase:NonNullable<DeltaReceiveEvidence['accessByPhase']>;certificate:SyncDependencyCertificate;baseRevision:number;readBase:(table:SqliteLibraryTable,key:string)=>string;deleted:Set<string>;baseReads:Set<string>;candidateReads:Set<string>;dense?:boolean;prepare?:()=>Promise<RecordKey[]>;basePuts?:UpdatePlan['basePuts'];encoded?:boolean;evidence?:DeltaReceiveEvidence}>();
 constructor(private readonly database:Database,private readonly assertFence:(fence:ReplicaCandidateFence)=>void,private readonly assertHealthy:()=>void){this.dependencies=new SqliteSyncDependencies(database);}
 private ensure(){
  this.assertHealthy();
  if(!this.ready){
   // A generation is a disposable download scratch area, not a recoverable
   // source fact. No caller from a previous connection can still own its ID.
   this.database.exec('BEGIN IMMEDIATE');
   try{
    this.database.exec('DROP TABLE IF EXISTS sensa_replica_candidate_records_v1');
    this.database.exec(replicaCandidateSchema);
    if(!this.rows<{name:string}>('PRAGMA table_info(sensa_replica_candidates_v1)').some(row=>row.name==='allocated_baseline'))this.database.exec('ALTER TABLE sensa_replica_candidates_v1 ADD COLUMN allocated_baseline INTEGER NOT NULL DEFAULT 0');
    this.database.exec('DELETE FROM sensa_replica_candidates_v1');
    this.database.exec('COMMIT');
   }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
   this.ready=true;
  }
 }
 private rows<T>(sql:string,bind:readonly (string|number|null)[]=[]):T[]{
  this.assertHealthy();
  let statement=this.statements.get(sql);if(!statement){replicaWork('candidate.prepare');statement=this.database.prepare(sql);this.statements.set(sql,statement);}
  statement.reset(true);if(bind.length)statement.bind([...bind]);
  const rows:T[]=[];try{while(statement.step())rows.push(statement.get({}) as T);return rows;}finally{statement.reset(true);}
 }
 close():void{for(const statement of this.statements.values())statement.finalize();this.statements.clear();this.dependencies.close();this.admissions.clear();this.sparse.clear();this.baselines.clear();this.receiveEvidence.clear();this.sealedEpochs.clear();}
 private header(id:string):Header{uuid.parse(id);this.ensure();return this.rows<Header>('SELECT * FROM sensa_replica_candidates_v1 WHERE id=?',[id])[0]??this.fail();}
 private allocatedBytes(){return (Number(this.database.selectValue('PRAGMA page_count'))-Number(this.database.selectValue('PRAGMA freelist_count')))*Number(this.database.selectValue('PRAGMA page_size'));}
 private assertAllocatedCapacity(id:string){if(this.allocatedBytes()-this.header(id).allocated_baseline>cloudScratchAllocatedBytes)throw Error('library_sync_capacity');}
 /** Identifies retries that add no rows or proofs; admission still runs normally. */
 needsScratchSpace(request:ReplicaCandidateRequest):boolean{
  if(!this.ready)return true;
  if(request.kind==='begin'){
   const prior=this.rows<Header>('SELECT * FROM sensa_replica_candidates_v1')[0];if(!prior)return true;const expected=expectedSchema.parse(JSON.parse(prior.expected_json));
   return !((prior.state!=='sealed'||this.validations.has(prior.id))&&prior.fence_json===JSON.stringify(request.fence)&&expected.head.revision===request.expected.head.revision&&JSON.stringify(expected.head.manifest)===JSON.stringify(request.expected.head.manifest));
  }
  if(request.kind==='append'||request.kind==='prove'){
   const header=this.header(request.id);this.check(header);
   for(const block of request.blocks)if(!this.rows<{plain_digest:string|null}>('SELECT plain_digest FROM sensa_replica_candidate_proofs_v1 WHERE candidate_id=? AND digest=?',[request.id,block.hash])[0]?.plain_digest)return true;
   return request.kind==='append'&&request.records.some(row=>!this.rows('SELECT 1 FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[request.id,row.table,row.key]).length);
  }
  if(request.kind==='reuse'){
   const header=this.header(request.id);this.assertUpdateBase(header,request.baseRevision);
   return request.keys.some(row=>!this.rows('SELECT 1 FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[request.id,row.table,row.key]).length);
  }
  if(request.kind==='validate')return this.header(request.id).state!=='validated'&&!this.validations.has(request.id);
  if(request.kind==='prepareUpdate')return !this.updates.has(request.id)&&!(this.updatePlan?.receipt.id===request.id&&this.updatePlan.receipt.baseRevision===request.baseRevision);
  return true;
 }
 private fail():never{throw Error('library_sync_candidate_invalid');}
 private artifactRevision():number{const row=this.rows<{value_json:string}>("SELECT value_json FROM sensa_records WHERE table_name='meta' AND record_key='local-artifact-revision'")[0];return row?integer.parse(decodeBackupValue(JSON.parse(unpackStoredRecord(row.value_json)))):0;}
 private candidateEpoch(id:string):number{return this.rows<{epoch:number}>('SELECT epoch FROM sensa_replica_candidate_epochs_v1 WHERE candidate_id=?',[id])[0]?.epoch??this.fail();}
 private check(header:Header){this.assertFence(fenceSchema.parse(JSON.parse(header.fence_json)));const sealed=this.sealedEpochs.get(header.id);if(sealed!==undefined&&sealed!==this.candidateEpoch(header.id))this.fail();const sparse=this.sparse.get(header.id);if(sparse)this.dependencies.assert(sparse.certificate);const baseline=this.baselines.get(header.id);if(baseline){const clock=this.dependencies.clock();if(clock.generation!==baseline.generation||clock.epoch!==baseline.epoch||this.artifactRevision()!==baseline.artifactRevision)throw Error('library_sync_local_changed');}}

 /** A single Worker connection cannot run another message during synchronous
  * work. Any await expires this proof; same-connection DML also invalidates it,
  * including rolled-back writes and direct test injections. Final activation
  * uses assertUpdateBase itself, never this optimization. */
 private protectedRead(id:string,baseRevision:number,signal:AbortSignal):void{
  this.assertHealthy();signal.throwIfAborted();replicaWork('fence.access');
  const changes=this.database.changes(true),prior=this.readSlice;
  if(prior?.id===id&&prior.baseRevision===baseRevision&&prior.changes===changes){replicaWork('fence.hit');return;}
  replicaWork('fence.check');this.assertUpdateBase(this.header(id),baseRevision);
  const slice=this.readSlice={id,baseRevision,changes:this.database.changes(true)};
  queueMicrotask(()=>{if(this.readSlice===slice)this.readSlice=undefined;});
 }
 private insertEncoding(id:string,sql:string,bind:(string|number|null)[]):void{
  const before=this.database.changes(true),slice=this.readSlice;
  this.rows(sql,bind);
  // Exactly one encoded row plus its epoch trigger. An extra write must not
  // be claimed as our own, even when injected inside this SQL call.
  if(this.database.changes(true)!==before+2)this.fail();
  this.sealedEpochs.set(id,this.sealedEpochs.get(id)!+1);
  if(slice?.id===id&&slice.changes===before)slice.changes=before+2;
  else this.readSlice=undefined;
 }

 private clearEncoding(id:string):void{
  for(const table of ['sensa_replica_candidate_encoded_v1','sensa_replica_candidate_encoded_bodies_v1']){
   const count=this.rows<{n:number}>(`SELECT count(*) AS n FROM ${table} WHERE candidate_id=?`,[id])[0].n,before=this.database.changes(true);
   this.database.exec({sql:`DELETE FROM ${table} WHERE candidate_id=?`,bind:[id]});
   if(this.database.changes(true)!==before+2*count)this.fail();
   this.sealedEpochs.set(id,this.sealedEpochs.get(id)!+count);this.readSlice=undefined;
  }
 }

 begin(fence:ReplicaCandidateFence,expected:ReplicaCandidateExpected):string{
  fence=fenceSchema.parse(fence);this.assertFence(fence);
  const {head,manifest}=verifyReplicaCandidateManifest(expected);
  if(manifest.rows.some(row=>!isReplicatedLibraryEntry(row.table,row.key)))this.fail();
  const storedExpected=expectedSchema.parse({libraryId:manifest.libraryId,learnerId:manifest.learnerId,records:manifest.rows.length,head});
  this.ensure();
  const fenceJson=JSON.stringify(fence),expectedJson=JSON.stringify(storedExpected),manifestJson=JSON.stringify(manifest.rows);
  const prior=this.rows<Header>('SELECT * FROM sensa_replica_candidates_v1')[0];
  // Lost begin ACKs recover the same generation, rather than accumulating
  // invisible learner copies. A failed generation is replaced on retry.
  const priorExpected=prior?expectedSchema.parse(JSON.parse(prior.expected_json)):undefined;
  // Storage telemetry may change under the same immutable revision/manifest.
  // It is a diagnostic, not the identity of a download or a lost begin ACK.
  if(prior&&(prior.state!=='sealed'||this.validations.has(prior.id))&&prior.fence_json===fenceJson&&priorExpected!.head.revision===head.revision&&JSON.stringify(priorExpected!.head.manifest)===JSON.stringify(head.manifest))return prior.id;
  if(this.seeds.size||this.validations.size||this.updates.size)throw Error('library_sync_candidate_busy');
  this.updatePlan=undefined;this.sealedEpochs.clear();
  const id=crypto.randomUUID();
  this.database.exec('BEGIN IMMEDIATE');
  try{
   this.assertFence(fence);
   this.database.exec('DELETE FROM sensa_replica_candidates_v1');
   const allocated=this.allocatedBytes();
   this.database.exec({sql:"INSERT INTO sensa_replica_candidates_v1(id,fence_json,expected_json,state,stored_bytes,allocated_baseline) VALUES(?,?,?,'filling',?,?)",bind:[id,fenceJson,expectedJson,utf8(manifestJson),allocated]});
   this.database.exec({sql:`INSERT INTO sensa_replica_candidate_manifest_v1
    SELECT ?,json_extract(value,'$.table'),json_extract(value,'$.key'),json_extract(value,'$.blocks') FROM json_each(?)`,bind:[id,manifestJson]});
   this.database.exec({sql:`INSERT INTO sensa_replica_candidate_proofs_v1(candidate_id,digest)
    SELECT DISTINCT ?,block.value FROM json_each(?) AS row,json_each(row.value,'$.blocks') AS block`,bind:[id,manifestJson]});
   this.assertAllocatedCapacity(id);this.database.exec('COMMIT');
  }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
  return id;
 }
 /** Index pages are an authenticated reference inventory. Body hashes and the
  * existing restore admission (complete or certified affected component) runs before this private generation
  * can replace facts, baseline and cursor in one local transaction. */
 beginIndex(fence:ReplicaCandidateFence,head:import('@sensa/contracts/sensa').LibrarySyncHead,baseRevision:number|undefined,readBase:(table:SqliteLibraryTable,key:string)=>string):string{
  fence=fenceSchema.parse(fence);head=librarySyncHead.parse(head);this.assertFence(fence);if(!head.manifest)this.fail();
  this.ensure();if(this.seeds.size||this.validations.size||this.updates.size)throw Error('library_sync_candidate_busy');this.updatePlan=undefined;this.sealedEpochs.clear();
  const id=crypto.randomUUID(),seed=baseRevision!==undefined;
  this.dependencies.ensure();
  const stateRow=this.rows<{value_json:string}>("SELECT value_json FROM sensa_records WHERE table_name='meta' AND record_key='cloud-sync'")[0];
  const state=stateRow?decodeBackupValue(JSON.parse(unpackStoredRecord(stateRow.value_json))) as CloudSyncState:undefined;
  const artifactRevision=this.artifactRevision();
  const certificate=seed?this.dependencies.match(state,fence,artifactRevision):undefined;
  this.baselines.clear();if(seed){const clock=this.dependencies.clock();this.baselines.set(id,{generation:clock.generation,epoch:clock.epoch,artifactRevision});}
  this.sparse.clear();this.admissions.clear();this.receiveEvidence.clear();if(certificate)this.sparse.set(id,{certificate,baseRevision:baseRevision!,readBase,accessByPhase:{},deleted:new Set(),baseReads:new Set(),candidateReads:new Set()});
  if(!certificate)this.receiveEvidence.set(id,{mode:'complete',fallbackReason:seed?'uncertified_baseline':'fresh_restore',changedRecords:0,baselineBuildRecords:0,baselineRecordsRead:0,candidateRecordsRead:0,targets:0,runs:0,events:0,decisions:0,scopes:0,sessions:0,scopeRuns:0});
  const expected=expectedSchema.parse({libraryId:head.manifest.libraryId,learnerId:head.manifest.learnerId,records:librarySyncRecordLimit,head,stream:{phase:seed?'tail':'snapshot',position:{revision:seed?baseRevision:head.manifest.snapshotRevision,offset:0},after:null}});
  this.database.exec('BEGIN IMMEDIATE');
  try{
   this.database.exec('DELETE FROM sensa_replica_candidates_v1');
   const allocated=this.allocatedBytes();
   this.database.exec({sql:"INSERT INTO sensa_replica_candidates_v1(id,fence_json,expected_json,state,allocated_baseline) VALUES(?,?,?,'filling',?)",bind:[id,JSON.stringify(fence),JSON.stringify(expected),allocated]});
   if(seed)this.assertUpdateBase(this.header(id),baseRevision!);
   this.assertAllocatedCapacity(id);this.database.exec('COMMIT');
  }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
  if(seed&&!certificate)this.seeds.set(id,{baseRevision:baseRevision!,after:null});
  return id;
 }
 needsSeed(id:string):boolean{return this.seeds.has(id);}
 /** A bounded RPC gives the caller its candidate ID before copying bodies,
  * so cancellation can discard immediately. No live write lock is held. */
 seed(id:string,readBase:(table:SqliteLibraryTable,key:string)=>string):boolean{
  const work=this.seeds.get(id);if(!work)this.fail();
  const batch=this.seedBatch(id,work.baseRevision,work.after,readBase);work.after=batch.after;
  if(batch.done)this.seeds.delete(id);return batch.done;
 }
 private seedBatch(id:string,baseRevision:number,after:RecordKey|null,readBase:(table:SqliteLibraryTable,key:string)=>string):{after:RecordKey|null;done:boolean}{
  this.assertUpdateBase(this.header(id),baseRevision);const started=performance.now(),sparse=this.sparse.get(id);
  const rows=this.rows<RecordKey&{block_refs_json:string}>(`SELECT table_name AS "table",record_key AS "key",block_refs_json FROM sensa_sync_base WHERE (table_name,record_key)>(?,?) ORDER BY table_name,record_key LIMIT 16`,[after?.table??'',after?.key??'']);
  for(const row of rows){
   this.assertUpdateBase(this.header(id),baseRevision);after={table:row.table,key:row.key};
   if(!sparse?.deleted.has(dependencyRowId(row.table,row.key))){
    const existing=this.rows<{refs_json:string}>('SELECT refs_json FROM sensa_replica_candidate_manifest_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,row.table,row.key])[0];
    if(!existing){
     const header=this.header(id),bytes=utf8(row.block_refs_json)+utf8(row.table)+utf8(row.key);if(header.stored_bytes+bytes>maximumStoredBytes)throw Error('library_sync_capacity');
     this.database.exec('BEGIN IMMEDIATE');try{
      this.database.exec({sql:'INSERT INTO sensa_replica_candidate_manifest_v1 VALUES(?,?,?,?)',bind:[id,row.table,row.key,row.block_refs_json]});
      this.database.exec({sql:'UPDATE sensa_replica_candidates_v1 SET stored_bytes=stored_bytes+? WHERE id=?',bind:[bytes,id]});this.assertAllocatedCapacity(id);this.database.exec('COMMIT');
     }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
    }
    if(!existing||existing.refs_json===row.block_refs_json)this.reuse(id,baseRevision,[row],readBase);
   }
   const evidence=this.receiveEvidence.get(id);if(evidence)evidence.baselineBuildRecords++;
   if(performance.now()-started>=8)return {after,done:false};
  }
  return {after,done:rows.length<16};
 }
 indexPage(id:string,input:import('@sensa/contracts/sensa').LibrarySyncPullResult|import('@sensa/contracts/sensa').LibrarySyncSnapshotPageResult):RecordKey[]{
  const header=this.header(id);this.check(header);if(header.state!=='filling'||this.seeds.has(id))this.fail();
  const expected=expectedSchema.parse(JSON.parse(header.expected_json)),stream=expected.stream;if(!stream||stream.phase==='complete')this.fail();
  const snapshot=stream.phase==='snapshot',page=snapshot?librarySyncSnapshotPageResult.parse(input):librarySyncPullResult.parse(input);
  let changes:import('@sensa/contracts/sensa').LibrarySyncChange[];
  if('rows' in page){
   if(page.snapshotRevision!==expected.head.manifest!.snapshotRevision||!backupEqual(page.after,stream.after)||!page.rows.length&&!page.done)this.fail();
   changes=page.rows;
   const last=page.rows.at(-1),next=last?{table:last.table,key:last.key}:stream.after;
   if(!backupEqual(page.next,next))this.fail();
   let previous=stream.after;
   const compare=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
   for(const row of page.rows){if(previous&&(compare(row.table,previous.table)<0||row.table===previous.table&&compare(row.key,previous.key)<=0))this.fail();previous={table:row.table,key:row.key};}
   stream.after=next;if(page.done)stream.phase=stream.position.revision===expected.head.revision?'complete':'tail';
  }else{
   if(page.toRevision!==expected.head.revision||!backupEqual(page.from,stream.position)||!page.changes.length)this.fail();
   const next=page.next,old=stream.position;
   if(!(next.revision===old.revision&&next.offset===old.offset+page.changes.length||next.revision===old.revision+1&&next.offset===0)||next.revision>expected.head.revision||page.done!==(next.revision===expected.head.revision))this.fail();
   changes=page.changes;stream.position=next;if(page.done)stream.phase='complete';
  }
  if(utf8(JSON.stringify(changes))>librarySyncMetadataPageBytes||changes.reduce((n,row)=>n+(row.blocks?.length??0),0)>librarySyncMetadataPageRefs)throw Error('library_sync_capacity');
  const evidence=this.receiveEvidence.get(id);if(evidence)evidence.changedRecords+=changes.length;
  const needed:RecordKey[]=[],sparse=this.sparse.get(id),deleted=sparse?new Set(sparse.deleted):undefined;
  this.database.exec('BEGIN IMMEDIATE');
  try{
   let removed=0,removedLogical=0,removedStored=0,metadataDelta=0;
   for(const row of changes){
    if(!isReplicatedLibraryEntry(row.table,row.key))this.fail();
    if(deleted){if(row.blocks)deleted.delete(dependencyRowId(row.table,row.key));else deleted.add(dependencyRowId(row.table,row.key));}
    const refs=row.blocks?JSON.stringify(row.blocks):null,prior=this.rows<StoredRow&{refs_json:string;stored_value_bytes:number}>('SELECT value_json,representation,refs_json,stored_value_bytes FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,row.table,row.key])[0];
    if(prior&&prior.refs_json===refs)continue;
    if(prior){removedLogical+=utf8(this.plainStored(prior));removedStored+=prior.stored_value_bytes+utf8(prior.refs_json);this.database.exec({sql:'DELETE FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',bind:[id,row.table,row.key]});removed++;}
    const priorManifest=this.rows<{refs_json:string}>('SELECT refs_json FROM sensa_replica_candidate_manifest_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,row.table,row.key])[0];
    if(priorManifest)metadataDelta-=utf8(priorManifest.refs_json)+utf8(row.table)+utf8(row.key);
    if(refs){
     metadataDelta+=utf8(refs)+utf8(row.table)+utf8(row.key);
     this.database.exec({sql:'INSERT INTO sensa_replica_candidate_manifest_v1 VALUES(?,?,?,?) ON CONFLICT(candidate_id,table_name,record_key) DO UPDATE SET refs_json=excluded.refs_json',bind:[id,row.table,row.key,refs]});
     this.database.exec({sql:'INSERT INTO sensa_replica_candidate_proofs_v1(candidate_id,digest) SELECT ?,value FROM json_each(?) WHERE true ON CONFLICT DO NOTHING',bind:[id,refs]});needed.push({table:row.table,key:row.key});
    }else this.database.exec({sql:'DELETE FROM sensa_replica_candidate_manifest_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',bind:[id,row.table,row.key]});
   }
   if(header.stored_bytes-removedStored+metadataDelta>maximumStoredBytes)throw Error('library_sync_capacity');
   if(stream.phase==='complete')expected.records=expected.head.manifest!.records;
   this.database.exec({sql:'UPDATE sensa_replica_candidates_v1 SET records=records-?,logical_bytes=logical_bytes-?,stored_bytes=stored_bytes-?+?,expected_json=? WHERE id=?',bind:[removed,removedLogical,removedStored,metadataDelta,JSON.stringify(expected),id]});this.assertAllocatedCapacity(id);this.database.exec('COMMIT');if(sparse&&deleted)sparse.deleted=deleted;
  }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
  return needed;
 }
 append(id:string,records:readonly ReplicaCandidateRecord[],blocks:readonly ReplicaCandidateBlock[]):void{
  const header=this.header(id);this.check(header);if(header.state!=='filling')this.fail();
  if(!records.length||records.length>replicaCandidateAppendRecordLimit)this.fail();
  let logical=0,stored=0,references=0;
  // Preflight the entire raw batch before JSON parsing or compression. Even
  // a rejected batch must not materialize individually large decoded objects.
  const inputs=records.map(row=>{
   if(!isReplicatedLibraryEntry(row.table,row.key)||typeof row.key!=='string'||!row.key.length||row.key.length>2000||typeof row.valueJson!=='string')this.fail();
   if(row.valueJson.length>maximumRecordBytes)throw Error('library_sync_capacity');
   if(!Array.isArray(row.blockRefs))this.fail();
   references+=row.blockRefs.length;if(references>replicaCandidateAppendReferenceLimit)throw Error('library_sync_capacity');
   const refs=z.array(z.string().regex(/^[a-f0-9]{64}$/u)).min(1).max(2048).parse(row.blockRefs),size=utf8(row.valueJson);
   logical+=size;if(size>maximumRecordBytes||records.length>1&&logical>appendBytes)throw Error('library_sync_capacity');
   return {...row,size,refsJson:JSON.stringify(refs)};
  });
  const bodyBudget=logical,usedProofs=new Set(inputs.flatMap(row=>row.blockRefs));
  if(!Array.isArray(blocks)||blocks.length>512)this.fail();
  let proofBytes=0;
  for(const block of blocks){if(typeof block?.data!=='string'||block.data.length>librarySyncBlockChars||!usedProofs.has(block.hash))this.fail();proofBytes+=utf8(block.data);if(proofBytes>replicaCandidateProofBatchBytes)throw Error('library_sync_capacity');}
  this.database.exec('BEGIN IMMEDIATE');
  try{
   this.check(header);
   let added=0,decodedProofBytes=0;logical=0;stored=0;
   for(const block of blocks){
    const allowed=this.rows<{plain_digest:string|null;plain_chars:number|null}>('SELECT plain_digest,plain_chars FROM sensa_replica_candidate_proofs_v1 WHERE candidate_id=? AND digest=?',[id,block.hash])[0];if(!allowed)this.fail();
    if(allowed.plain_digest!==null){if(sha256(block.data)!==block.hash)throw Error('library_sync_hash');continue;}
    const proof=verifyReplicaCandidateBlock(block);decodedProofBytes+=proof.plainBytes;
    if(decodedProofBytes>bodyBudget)throw Error('library_sync_capacity');
    this.database.exec({sql:'UPDATE sensa_replica_candidate_proofs_v1 SET plain_digest=?,plain_chars=? WHERE candidate_id=? AND digest=?',bind:[proof.plainDigest,proof.plainChars,id,proof.hash]});
    stored+=64+8;
   }
   for(const row of inputs){
    const admitted=this.rows<{refs_json:string}>('SELECT refs_json FROM sensa_replica_candidate_manifest_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,row.table,row.key])[0];
    if(!admitted||admitted.refs_json!==row.refsJson)this.fail();
    const prior=this.rows<StoredRow&{refs_json:string}>('SELECT record_key,value_json,representation,refs_json FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,row.table,row.key])[0];
    if(prior){if(this.plainStored(prior)!==row.valueJson||prior.refs_json!==row.refsJson)this.fail();continue;}
    let offset=0;
    for(const digest of row.blockRefs){
     const proof=this.rows<{plain_digest:string|null;plain_chars:number|null}>('SELECT plain_digest,plain_chars FROM sensa_replica_candidate_proofs_v1 WHERE candidate_id=? AND digest=?',[id,digest])[0];
     if(!proof||proof.plain_digest===null||proof.plain_chars===null)throw Error('library_sync_missing_block');
     const end=offset+proof.plain_chars;if(end>row.valueJson.length||sha256(row.valueJson.slice(offset,end))!==proof.plain_digest)throw Error('library_sync_hash');offset=end;
    }
    if(offset!==row.valueJson.length)throw Error('library_sync_hash');
    added++;logical+=row.size;
    if(header.logical_bytes+logical>maximumLogicalBytes)throw Error('library_sync_capacity');
    const parsed=JSON.parse(row.valueJson);let representation:StoredRow['representation']='packed';
    try{decodeBackupValue(parsed);}catch(cause){if(!(cause instanceof Error)||!['libraryBackup.errors.format','libraryBackup.errors.fields'].includes(cause.message))throw cause;representation='opaque';}
    // External transport must never impersonate a generated storage envelope.
    // Keep unknown wire intact for complete validation, without unpacking it.
    const text=representation==='opaque'?row.valueJson:packStoredRecord(row.valueJson);stored+=utf8(text)+utf8(row.refsJson);
    if(header.stored_bytes+stored>maximumStoredBytes)throw Error('library_sync_capacity');
    this.database.exec({sql:'INSERT INTO sensa_replica_candidate_records_v1(candidate_id,table_name,record_key,value_json,refs_json,representation) VALUES(?,?,?,?,?,?)',bind:[id,row.table,row.key,text,row.refsJson,representation]});
   }
   if(header.records+added>expectedSchema.parse(JSON.parse(header.expected_json)).records)this.fail();
   this.database.exec({sql:'UPDATE sensa_replica_candidates_v1 SET records=records+?,logical_bytes=logical_bytes+?,stored_bytes=stored_bytes+? WHERE id=?',bind:[added,logical,stored,id]});
   this.assertAllocatedCapacity(id);this.database.exec('COMMIT');
  }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
 }
 /** A large row's proofs can arrive before its body, in bounded transactions.
  * Only refs for that exact manifest row are admitted; no live row is written. */
 prove(id:string,record:Pick<ReplicaCandidateRecord,'table'|'key'>,blocks:readonly ReplicaCandidateBlock[]):void{
  const header=this.header(id);this.check(header);if(header.state!=='filling')this.fail();
  const admitted=this.rows<{refs_json:string}>('SELECT refs_json FROM sensa_replica_candidate_manifest_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,record.table,record.key])[0];if(!admitted)this.fail();
  const refs=new Set<string>(JSON.parse(admitted.refs_json));
  if(!Array.isArray(blocks)||!blocks.length||blocks.length>512)this.fail();
  let rawBytes=0;
  for(const block of blocks){if(typeof block?.data!=='string'||block.data.length>librarySyncBlockChars||!refs.has(block.hash))this.fail();rawBytes+=utf8(block.data);if(rawBytes>replicaCandidateProofBatchBytes)throw Error('library_sync_capacity');}
  this.database.exec('BEGIN IMMEDIATE');
  try{
   this.check(header);let decodedBytes=0,storedBytes=0;
   for(const block of blocks){
    const prior=this.rows<{plain_digest:string|null}>('SELECT plain_digest FROM sensa_replica_candidate_proofs_v1 WHERE candidate_id=? AND digest=?',[id,block.hash])[0];if(!prior)this.fail();
    if(prior.plain_digest!==null){if(sha256(block.data)!==block.hash)throw Error('library_sync_hash');continue;}
    const proof=verifyReplicaCandidateBlock(block);decodedBytes+=proof.plainBytes;if(decodedBytes>replicaCandidateProofBatchBytes)throw Error('library_sync_capacity');
    storedBytes+=72;if(header.stored_bytes+storedBytes>maximumStoredBytes)throw Error('library_sync_capacity');
    this.database.exec({sql:'UPDATE sensa_replica_candidate_proofs_v1 SET plain_digest=?,plain_chars=? WHERE candidate_id=? AND digest=?',bind:[proof.plainDigest,proof.plainChars,id,proof.hash]});
   }
   this.database.exec({sql:'UPDATE sensa_replica_candidates_v1 SET stored_bytes=stored_bytes+? WHERE id=?',bind:[storedBytes,id]});this.assertAllocatedCapacity(id);this.database.exec('COMMIT');
  }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
 }
 private resetAdmission(id:string,admission:SyncAdmission){
  const bytes=admission.retainedMetadataBytes?.()??0;this.database.exec('BEGIN IMMEDIATE');
  try{this.dependencies.discardAdmission('candidate:'+id);this.rows('UPDATE sensa_replica_candidates_v1 SET stored_bytes=stored_bytes-? WHERE id=?',[bytes,id]);this.assertAllocatedCapacity(id);this.database.exec('COMMIT');}catch(cause){this.database.exec('ROLLBACK');throw cause;}
 }
 private candidateAdmission(id:string){return this.dependencies.spoolAdmission('candidate:'+id,false,bytes=>{const header=this.header(id);if(header.stored_bytes+bytes>maximumStoredBytes)throw Error('library_sync_capacity');this.rows('UPDATE sensa_replica_candidates_v1 SET stored_bytes=stored_bytes+? WHERE id=?',[bytes,id]);this.assertAllocatedCapacity(id);});}
 private reader(id:string,signal:AbortSignal,admission?:SyncAdmission,cloneDecoded=false,validationIndex?:RecordValidationIndex){
  const alive=()=>{this.assertHealthy();if(signal.aborted)throw signal.reason;};
  const reader=sealedRecordReader({
   alive,cloneDecoded,beforePage:()=>this.check(this.header(id)),
   get:(table,key)=>this.rows<StoredRow>('SELECT record_key,value_json,representation FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,table,key])[0],
   has:(table,key)=>this.rows('SELECT 1 FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,table,key]).length>0,
   keys:(table,after)=>this.rows<SealedRecordKey>(`SELECT record_key,stored_value_bytes
    FROM sensa_replica_candidate_records_v1 INDEXED BY sensa_replica_candidate_page_v1
    WHERE candidate_id=? AND table_name=? ${after===null?'':'AND record_key>?'} ORDER BY record_key LIMIT 64`,after===null?[id,table]:[id,table,after]),
   rows:(table,selected)=>this.rows<StoredRow>(`SELECT record_key,value_json,representation FROM sensa_replica_candidate_records_v1
    WHERE candidate_id=? AND table_name=? AND record_key IN(SELECT value FROM json_each(?)) ORDER BY record_key`,[id,table,JSON.stringify(selected)]),
   plain:(_table,stored)=>this.plainStored(stored),missing:()=>this.fail(),observed:admission?(table,key,text,value)=>{
    if(admission.rows.has(dependencyRowId(table,key))||admission.disabled)return;
    // Account a current row's packed body, duplicated reference metadata and
    // every proof occurrence under the existing logical accounting budget.
    // It is replaced, never accumulated; it is not a physical SQLite file bound.
    const size=this.rows<{n:number}>(`SELECT ${dependencyRowStoredBudget} AS n FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?`,[id,table,key])[0].n;
    this.dependencies.observe(admission,table,key,text,value,packageKey=>this.rows('SELECT 1 FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,'packageCache',packageKey]).length>0,size);
   }:undefined,
  });
  return {...reader,storageKeysUnique:true as const,validationIndex};
 }
 private sparseReaders(id:string,signal:AbortSignal,admission:SyncAdmission){
  const sparse=this.sparse.get(id)!;
  const alive=()=>this.protectedRead(id,sparse.baseRevision,signal);
  let readBytes=0;
  const source=sealedRecordReader({alive,beforePage:alive,cloneDecoded:true,
   get:(table,key)=>this.rows<{record_key:string;value_json:string}>('SELECT record_key,value_json FROM sensa_sync_base WHERE table_name=? AND record_key=?',[table,key])[0],
   has:(table,key)=>this.rows('SELECT 1 FROM sensa_sync_base WHERE table_name=? AND record_key=?',[table,key]).length>0,
   keys:()=>{throw Error('library_sync_delta_enumeration');},rows:()=>{throw Error('library_sync_delta_enumeration');},
   plain:(table,row)=>{const text=sparse.readBase(table,row.record_key);this.dependencies.verify(table,row.record_key,text);const key=dependencyRowId(table,row.record_key);if(!sparse.baseReads.has(key)){readBytes+=utf8(text);sparse.baseReads.add(key);if(readBytes>32*1024*1024)throw new DeltaReceiveFallback('history_body_capacity');}return text;},missing:()=>this.fail(),
  });
  const base:LibraryRecordReader={...source,entries:()=>{throw Error('library_sync_delta_enumeration');}};
  const overlay=this.reader(id,signal,admission,true);
  // The sealed manifest is already the sparse change inventory. Existence
  // cannot change without invalidating the candidate epoch at the next read.
  const overlayKeys=new Set(this.rows<{table_name:string;record_key:string}>('SELECT table_name,record_key FROM sensa_replica_candidate_records_v1 WHERE candidate_id=?',[id]).map(row=>dependencyRowId(row.table_name,row.record_key)));
  const remote:LibraryRecordReader={
   get:(table,key)=>{alive();const identity=dependencyRowId(table,key);if(sparse.deleted.has(identity))return undefined;if(overlayKeys.has(identity)){sparse.candidateReads.add(identity);return overlay.get(table,key);}return base.get(table,key);},
   has:(table,key)=>{alive();const identity=dependencyRowId(table,key);return !sparse.deleted.has(identity)&&(overlayKeys.has(identity)||base.has(table,key));},
   entries:()=>{throw Error('library_sync_delta_enumeration');},
  };
  return {base,remote,alive,window:()=>{alive();const a=source.beginWindow();try{const b=overlay.beginWindow();return ()=>{b();a();};}catch(cause){a();throw cause;}},
   canonical:(side:'base'|'remote',table:SqliteLibraryTable,key:string)=>{alive();if(side==='base')return source.canonical(table,key);const identity=dependencyRowId(table,key);return sparse.deleted.has(identity)?undefined:overlayKeys.has(identity)?overlay.canonical(table,key):source.canonical(table,key);},
   text:(table:SqliteLibraryTable,key:string)=>{alive();return overlay.text(table,key);},
  };
 }
 private async materializeSparse(id:string,signal:AbortSignal):Promise<void>{
  const sparse=this.sparse.get(id)!;this.assertUpdateBase(this.header(id),sparse.baseRevision);
  this.database.exec({sql:"UPDATE sensa_replica_candidates_v1 SET state='filling' WHERE id=?",bind:[id]});
  let after:RecordKey|null=null;
  for(;;){signal.throwIfAborted();const batch=this.seedBatch(id,sparse.baseRevision,after,sparse.readBase);after=batch.after;if(batch.done)break;await new Promise<void>(resolve=>setTimeout(resolve,0));}
  signal.throwIfAborted();this.assertUpdateBase(this.header(id),sparse.baseRevision);
  sparse.dense=true;this.database.exec({sql:"UPDATE sensa_replica_candidates_v1 SET state='sealed' WHERE id=?",bind:[id]});
 }
 validate(id:string):Promise<ReplicaCandidateValidation>{
  const running=this.validations.get(id);if(running)return running.result;
  const header=this.header(id);this.check(header);
  if(header.state==='validated')return Promise.resolve(this.receipt(header));
  const expected=expectedSchema.parse(JSON.parse(header.expected_json)),sparse=this.sparse.get(id);
  const count=sparse?this.rows<{n:number}>('SELECT count(*) AS n FROM sensa_replica_candidate_manifest_v1 WHERE candidate_id=?',[id])[0].n:expected.records;
  if(header.state!=='filling'||header.records!==count||expected.stream&&expected.stream.phase!=='complete')this.fail();
  this.database.exec({sql:"UPDATE sensa_replica_candidates_v1 SET state='sealed' WHERE id=?",bind:[id]});
  this.sealedEpochs.set(id,this.candidateEpoch(id));
  const controller=new AbortController();
  const result=(async()=>{
   let validationIndex:SqliteRecordValidation|undefined,fatal=false;
   try{
    validationIndex=new SqliteRecordValidation(this.database,()=>{this.assertHealthy();controller.signal.throwIfAborted();this.check(this.header(id));},()=>this.assertAllocatedCapacity(id));
    const {validateLibrarySyncRecordsCooperatively}=await import('./backupValidation');
    let identity:LibraryIdentity|undefined,admission=this.candidateAdmission(id);
    if(sparse&&!sparse.dense){
     const changedCount=this.rows<{n:number}>('SELECT count(*) AS n FROM sensa_replica_candidate_manifest_v1 WHERE candidate_id=?',[id])[0].n+sparse.deleted.size;
     if(changedCount>16384){await this.materializeSparse(id,controller.signal);sparse.evidence={mode:'complete',fallbackReason:'changed_body_capacity',changedRecords:changedCount,baselineBuildRecords:sparse.certificate.records,baselineRecordsRead:0,candidateRecordsRead:0,targets:0,runs:0,events:0,decisions:0,scopes:0,sessions:0,scopeRuns:0};}
    }
    if(sparse&&!sparse.dense){
     const changes=[...this.rows<RecordKey>('SELECT table_name AS "table",record_key AS "key" FROM sensa_replica_candidate_manifest_v1 WHERE candidate_id=? ORDER BY table_name,record_key',[id]),...[...sparse.deleted].map(identity=>{const [table,key]=JSON.parse(identity);return {table,key,deleted:true};})] as Array<RecordKey&{deleted?:boolean}>;
     let records=sparse.certificate.records,logicalBytes=sparse.certificate.logicalBytes,storedBytes=sparse.certificate.storedBytes+this.rows<{n:number}>(`SELECT COALESCE(sum(${dependencyRowStoredBudget}),0) AS n FROM sensa_replica_candidate_records_v1 WHERE candidate_id=?`,[id])[0].n;
     await runCooperatively((function*(this:SqliteReplicaCandidates){for(const row of changes){this.protectedRead(id,sparse.baseRevision,controller.signal);yield;const exists=this.rows('SELECT 1 FROM sensa_sync_base WHERE table_name=? AND record_key=?',[row.table,row.key]).length>0;if(row.deleted){if(exists)records--;}else if(!exists)records++;const old=this.dependencies.rowBudget(row.table,row.key);logicalBytes-=old.logical_bytes;storedBytes-=old.stored_bytes;}}).call(this));
     logicalBytes+=header.logical_bytes;if(records!==expected.records)this.fail();if(logicalBytes>maximumLogicalBytes)throw Error('library_sync_capacity');
     try{
      if(storedBytes>maximumStoredBytes)throw new DeltaReceiveFallback('stored_capacity_uncertain');
      if(header.logical_bytes>32*1024*1024)throw new DeltaReceiveFallback('changed_body_capacity');
      const readers=this.sparseReaders(id,controller.signal,admission),fence=fenceSchema.parse(JSON.parse(header.fence_json));
      const basePuts=this.rows<{table:RecordKey['table'];key:string;refs_json:string}>(`SELECT candidate.table_name AS "table",candidate.record_key AS "key",candidate.refs_json
       FROM sensa_replica_candidate_manifest_v1 AS candidate LEFT JOIN sensa_sync_base AS prior ON prior.table_name=candidate.table_name AND prior.record_key=candidate.record_key
       WHERE candidate.candidate_id=? AND (prior.block_refs_json IS NULL OR prior.block_refs_json<>candidate.refs_json) ORDER BY candidate.table_name,candidate.record_key`,[id]).map(row=>({table:row.table,key:row.key,blockRefs:JSON.parse(row.refs_json)}));
      const refsByKey=new Map(basePuts.map(row=>[dependencyRowId(row.table,row.key),row])),budget:{bytes?:number}={};
      const admitted=await admitLearningDelta({changes,...readers,dependencies:this.dependencies,certificate:sparse.certificate,
       consume:async(records,componentChanges)=>{const refs=componentChanges.flatMap(row=>{const prior=refsByKey.get(dependencyRowId(row.table,row.key));return prior?[prior]:[];});await this.prepareEncoding({receipt:{id} as ReplicaCandidateUpdate,puts:records.filter(row=>!row.deleted),deletes:[],basePuts:refs},fence,readers.alive,readers.text,budget);},
       phase:name=>{sparse.accessByPhase[name]={baselineRecordsRead:sparse.baseReads.size,candidateRecordsRead:sparse.candidateReads.size};}});
      sparse.basePuts=basePuts;sparse.encoded=true;
      identity=admitted.identity;sparse.prepare=admitted.prepare;sparse.evidence={...admitted.evidence,accessByPhase:sparse.accessByPhase};
     }catch(cause){
      if(!(cause instanceof DeltaReceiveFallback))throw cause;
      this.clearEncoding(id);this.resetAdmission(id,admission);admission=this.candidateAdmission(id);sparse.prepare=undefined;sparse.basePuts=undefined;sparse.encoded=false;
      sparse.evidence={mode:'complete',fallbackReason:cause.reason,changedRecords:changes.length,baselineBuildRecords:sparse.certificate.records,baselineRecordsRead:sparse.baseReads.size,candidateRecordsRead:sparse.candidateReads.size,targets:0,runs:0,events:0,decisions:0,scopes:0,sessions:0,scopeRuns:0};await this.materializeSparse(id,controller.signal);
     }
    }
    this.admissions.set(id,admission);
    const reader=this.reader(id,controller.signal,admission,false,validationIndex);
    if(identity){if(!admission.disabled&&admission.rows.size!==header.records)this.fail();}
    else identity=await validateLibrarySyncRecordsCooperatively(reader);
    if(sparse&&!sparse.dense)admission.deletes=[...sparse.deleted].map(key=>{const [table,keyValue]=JSON.parse(key);return {table,key:keyValue};});
    const checked=expectedSchema.parse(JSON.parse(header.expected_json));
    if(identity.id!==checked.libraryId||identity.learnerId!==checked.learnerId)throw Error('library_sync_identity');
    admission.flush?.();this.assertHealthy();if(controller.signal.aborted)throw controller.signal.reason;
    this.check(this.header(id));
    this.database.exec({sql:"UPDATE sensa_replica_candidates_v1 SET state='validated',identity_json=? WHERE id=? AND state='sealed'",bind:[JSON.stringify(identity),id]});
    return this.receipt(this.header(id));
   }catch(cause){
    fatal=isFatalSqliteConnectionFailure(cause);
    if(!controller.signal.aborted&&!fatal){
     try{
      this.assertHealthy();
      this.database.exec({sql:"DELETE FROM sensa_replica_candidates_v1 WHERE id=? AND state='sealed'",bind:[id]});this.dependencies.discardAdmission('candidate:'+id);
     }catch(cleanupCause){
      // A failed cleanup must not masquerade as an erased scratch area. FULL
      // is retryable after freeing storage; physical faults still quarantine.
      throw new AggregateError([cause,cleanupCause],'library_sync_candidate_cleanup_failed');
     }
    }
    throw cause;
   }finally{validationIndex?.close(!fatal);this.validations.delete(id);}
  })();
  this.validations.set(id,{controller,result});return result;
 }
 private receipt(header:Header):ReplicaCandidateValidation{
  if(header.state!=='validated'||header.identity_json===null)this.fail();
  const tables=this.rows<{table_name:SqliteLibraryTable}>('SELECT DISTINCT table_name FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? ORDER BY table_name',[header.id]).map(row=>row.table_name);
  const sparse=this.sparse.get(header.id);if(sparse?.evidence){sparse.evidence.baselineRecordsRead=sparse.baseReads.size;sparse.evidence.candidateRecordsRead=sparse.candidateReads.size;}
  return {id:header.id,identity:identitySchema.parse(JSON.parse(header.identity_json!)),head:expectedSchema.parse(JSON.parse(header.expected_json)).head,tables,records:sparse?expectedSchema.parse(JSON.parse(header.expected_json)).records:header.records,logicalBytes:header.logical_bytes,storedBytes:header.stored_bytes,receive:sparse?.evidence??this.receiveEvidence.get(header.id)};
 }
 private tables(id:string):SqliteLibraryTable[]{return this.rows<{table_name:SqliteLibraryTable}>('SELECT DISTINCT table_name FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? ORDER BY table_name',[id]).map(row=>row.table_name);}
 /** The private validated generation, never a snapshot's self-reported stamp. */
 certifyCheckpoint(id:string,state:CloudSyncState,identity:LibraryIdentity,artifactRevision:number):void{
  const admission=this.admissions.get(id);if(!admission)return;
  const sparse=this.sparse.get(id);this.dependencies.certify(admission,state,identity,artifactRevision,sparse&&!sparse.dense?sparse.certificate:undefined);
 }

 private assertUpdateBase(header:Header,baseRevision:number){
  this.check(header);
  const row=this.rows<{value_json:string}>("SELECT value_json FROM sensa_records WHERE table_name='meta' AND record_key='cloud-sync'")[0];
  const state=row?decodeBackupValue(JSON.parse(unpackStoredRecord(row.value_json))) as CloudSyncState:undefined;
  const fence=fenceSchema.parse(JSON.parse(header.fence_json));
  if(!validatedCheckpoint(state)||state!.revision!==baseRevision||state!.syncedLocalRevision!==fence.localRevision
   ||state!.owner.subject!==fence.owner.subject||state!.owner.accountId!==fence.owner.accountId||state!.incarnation!==fence.incarnation)throw Error('library_sync_local_changed');
 }

 /** Reuse only exact references witnessed by the still-current validated
  * baseline. Copy one body at a time; unchanged data need not cross HTTP or the
  * Worker message channel. Shared storage references are expanded locally. */
 reuse(id:string,baseRevision:number,keys:readonly {table:SqliteLibraryTable;key:string}[],readBase:(table:SqliteLibraryTable,key:string)=>string):RecordKey[]{
  integer.parse(baseRevision);if(!keys.length||keys.length>replicaCandidateAppendRecordLimit)this.fail();
  const header=this.header(id);this.assertUpdateBase(header,baseRevision);if(header.state!=='filling')this.fail();
  const reused:RecordKey[]=[];let records=0,logical=0,stored=0;
  this.database.exec('BEGIN IMMEDIATE');
  try{
   for(const key of keys){
    const admitted=this.rows<{refs_json:string}>('SELECT refs_json FROM sensa_replica_candidate_manifest_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,key.table,key.key])[0];if(!admitted)this.fail();
    const base=this.rows<{value_json:string;block_refs_json:string}>('SELECT value_json,block_refs_json FROM sensa_sync_base WHERE table_name=? AND record_key=?',[key.table,key.key])[0];
    if(!base||base.block_refs_json!==admitted.refs_json)continue;
    const prior=this.rows('SELECT 1 FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,key.table,key.key]);
    if(!prior.length){
     const text=readBase(key.table,key.key),bytes=utf8(text),body=sharedRecordTables.has(key.table)?packStoredRecord(text):base.value_json;
     if(bytes>maximumRecordBytes)this.fail();
     logical+=bytes;stored+=utf8(body)+utf8(admitted.refs_json);records++;
     if(header.logical_bytes+logical>maximumLogicalBytes||header.stored_bytes+stored>maximumStoredBytes)throw Error('library_sync_capacity');
     this.database.exec({sql:'INSERT INTO sensa_replica_candidate_records_v1(candidate_id,table_name,record_key,value_json,refs_json) VALUES(?,?,?,?,?)',bind:[id,key.table,key.key,body,admitted.refs_json]});
    }
    reused.push({table:key.table as RecordKey['table'],key:key.key});
   }
   this.database.exec({sql:'UPDATE sensa_replica_candidates_v1 SET records=records+?,logical_bytes=logical_bytes+?,stored_bytes=stored_bytes+? WHERE id=?',bind:[records,logical,stored,id]});
   this.assertAllocatedCapacity(id);this.database.exec('COMMIT');
  }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
  return reused;
 }

 /** An unchanged local checkpoint still runs the ordinary domain merge: remote
  * validation alone cannot authorize rewriting immutable versions/history.
  * Both input inventories contain metadata plus repeatable SQLite body reads. */
 prepareUpdate(id:string,baseRevision:number,readBase:(table:SqliteLibraryTable,key:string)=>string):Promise<ReplicaCandidateUpdate|null>{
  integer.parse(baseRevision);const header=this.header(id);this.assertUpdateBase(header,baseRevision);
  const candidate=this.receipt(header),fence=fenceSchema.parse(JSON.parse(header.fence_json));
  const running=this.updates.get(id);if(running)return running.result;
  if(this.updatePlan?.receipt.id===id&&this.updatePlan.receipt.baseRevision===baseRevision)return Promise.resolve(this.updatePlan.receipt);
  const controller=new AbortController();
  const alive=()=>this.protectedRead(id,baseRevision,controller.signal);
  const result=(async()=>{
   try{
    await Promise.resolve();alive();
    const sparse=this.sparse.get(id);
    if(sparse&&!sparse.dense&&sparse.prepare){
     let records:RecordKey[]|undefined;
     try{records=await sparse.prepare();sparse.prepare=undefined;alive();}
     catch(cause){
      if(!(cause instanceof DeltaReceiveFallback))throw cause;
      this.clearEncoding(id);sparse.prepare=undefined;sparse.basePuts=undefined;sparse.encoded=false;
      sparse.evidence={...sparse.evidence!,mode:'complete',fallbackReason:cause.reason,baselineBuildRecords:sparse.certificate.records};await this.materializeSparse(id,controller.signal);
      const admission=this.admissions.get(id)??this.candidateAdmission(id),index=new SqliteRecordValidation(this.database,alive,()=>this.assertAllocatedCapacity(id)),{validateLibrarySyncRecordsCooperatively}=await import('./backupValidation');
      try{const identity=await validateLibrarySyncRecordsCooperatively(this.reader(id,controller.signal,admission,false,index));admission.flush?.();alive();if(identity.id!==candidate.identity.id||identity.learnerId!==candidate.identity.learnerId)throw Error('library_sync_identity');
       this.admissions.set(id,admission);this.database.exec({sql:"UPDATE sensa_replica_candidates_v1 SET state='validated',identity_json=? WHERE id=?",bind:[JSON.stringify(identity),id]});
      }finally{index.close();}
     }
     if(records){
     const basePuts=sparse.basePuts!;
     sparse.evidence!.modifiedRecords=records.length;sparse.evidence!.baselineRecordsRead=sparse.baseReads.size;sparse.evidence!.candidateRecordsRead=sparse.candidateReads.size;
     const receipt:ReplicaCandidateUpdate={id,baseRevision,localRevision:fence.localRevision,contentChanged:records.length>0,tables:[...new Set(records.map(row=>row.table))],records,receive:sparse.evidence};
     const plan={receipt,puts:records.filter(row=>!sparse.deleted.has(dependencyRowId(row.table,row.key))),deletes:records.filter(row=>sparse.deleted.has(dependencyRowId(row.table,row.key))),basePuts};if(!sparse.encoded)await this.prepareEncoding(plan,fence,alive);alive();this.updatePlan=plan;sparse.basePuts=undefined;return receipt;
     }
    }
    const normalized=normalizeLibraryReplicaEntry({table:'meta',key:'identity',value:fence.identity},fence.identity).value;
    if(!backupEqual(candidate.identity,normalized))return null;
    if(!this.rows("SELECT 1 FROM sensa_sync_base WHERE table_name='meta' AND record_key='identity'").length)return null;
    // SQL identifies exact changed refs. Only their existing owner dependency
    // closure reaches the merger; the complete candidate was already admitted.
    const changed=this.rows<{table:string;key:string}>(`SELECT table_name AS table_name,record_key AS record_key FROM(
     SELECT remote.table_name,remote.record_key FROM sensa_replica_candidate_records_v1 remote LEFT JOIN sensa_sync_base base ON base.table_name=remote.table_name AND base.record_key=remote.record_key WHERE remote.candidate_id=? AND(base.record_key IS NULL OR base.block_refs_json!=remote.refs_json)
     UNION ALL SELECT base.table_name,base.record_key FROM sensa_sync_base base LEFT JOIN sensa_replica_candidate_records_v1 remote ON remote.candidate_id=? AND remote.table_name=base.table_name AND remote.record_key=base.record_key WHERE remote.record_key IS NULL) LIMIT 16385`,[id,id]) as unknown as Array<{table_name:LibraryReplicaEntry['table'];record_key:string}>;
    if(changed.length>16384)throw Error('library_sync_capacity');
    const selected=new Set<string>(),queue=changed.map(row=>({table:row.table_name,key:row.record_key})),enqueued=new Set(queue.map(replicaEntryId)),base:LibraryReplicaEntry[]=[],remote:LibraryReplicaEntry[]=[];
    let decodedBytes=0;const enqueue=(keys:readonly {table:SqliteLibraryTable;key:string}[])=>{for(const key of keys){const id=dependencyRowId(key.table,key.key);if(enqueued.has(id))continue;if(enqueued.size>=16384)throw Error('library_sync_capacity');enqueued.add(id);if(!isReplicatedLibraryEntry(key.table,key.key))this.fail();queue.push({...key,table:key.table as LibraryReplicaEntry['table']});}};
    await runCooperatively((function*(this:SqliteReplicaCandidates){for(let at=0;at<queue.length;at++){
     alive();yield;const key=queue[at],identity=replicaEntryId(key);if(selected.has(identity))continue;selected.add(identity);if(selected.size>16384)throw Error('library_sync_capacity');
     for(const side of ['base','remote'] as const){
      const row=side==='base'?this.rows<{value_json:string;refs:string}>('SELECT value_json,block_refs_json AS refs FROM sensa_sync_base WHERE table_name=? AND record_key=?',[key.table,key.key])[0]:this.rows<{value_json:string;representation:StoredRow['representation'];refs:string}>('SELECT value_json,representation,refs_json AS refs FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,key.table,key.key])[0];
      if(!row)continue;
      const logical=side==='base'?this.dependencies.rowBudget(key.table,key.key).logical_bytes:this.admissions.get(id)?.rows.get(dependencyRowId(key.table,key.key))?.bytes;
      if(logical!==undefined&&decodedBytes+logical+utf8(row.refs)>64*1024*1024)throw Error('library_sync_capacity');
      const text=side==='base'?readBase(key.table,key.key):this.candidateBody(id,key.table,key.key);decodedBytes+=utf8(text)+utf8(row.refs);if(decodedBytes>64*1024*1024)throw Error('library_sync_capacity');
      const value=JSON.parse(text),entry={...key,blocks:JSON.parse(row.refs),get value(){alive();return value;}};(side==='base'?base:remote).push(entry);
      enqueue(libraryReplicaDependencies(entry,decodeBackupValue(value)));
      if(key.table==='semanticMeanings'){enqueue(this.dependencies.admissionMeaningReceipts('candidate:'+id,key.key));if(side==='base')enqueue(this.dependencies.keys('meaningReceipt',key.key));}
     }
    }}).call(this));
    const merged=await mergeLibraryReplicasCooperatively({base,local:base,remote});
    alive();
    // Conflicts or a domain-generated publication still use the full existing
    // reconciliation path; do not silently select the remote branch.
    if(merged.conflicts.length||merged.entries.length!==remote.length)return null;
    const desired=new Map(remote.map(row=>[replicaEntryId(row),row]));
    const exact=await runCooperatively((function*(){for(const row of merged.entries){alive();yield;if(!replicaEntryEqual(row,desired.get(replicaEntryId(row))))return false;}return true;})());if(!exact)return null;
    const changes=await planLibraryReplicaApplyCooperatively(base,remote,alive),key=({table,key}:RecordKey)=>({table,key});
    const prior=new Map(base.map(row=>[replicaEntryId(row),row]));
    const basePuts=remote.filter(row=>!backupEqual(row.blocks,prior.get(replicaEntryId(row))?.blocks)).map(row=>({...key(row),blockRefs:row.blocks!}));
    const records=[...changes.puts,...changes.deletes].map(key),contentChanged=records.length>0;
    const receipt:ReplicaCandidateUpdate={id,baseRevision,localRevision:fence.localRevision,contentChanged,tables:[...new Set(records.map(row=>row.table))],records,receive:sparse?.evidence??this.receiveEvidence.get(id)};
    if(receipt.receive){receipt.receive.modifiedRecords=records.length;receipt.receive.candidateRecordsRead=remote.length;receipt.receive.baselineRecordsRead=base.length;}
    const plan={receipt,puts:changes.puts.map(key),deletes:changes.deletes.map(key),basePuts};await this.prepareEncoding(plan,fence,alive);alive();this.updatePlan=plan;
    return receipt;
   }catch(cause){if(!isFatalSqliteConnectionFailure(cause)){this.discard(id);}throw cause;}finally{this.updates.delete(id);}
  })();
  this.updates.set(id,{controller,result});return result;
 }

 private plainStored(row:StoredRow,memo?:StoredRecordMemo):string{return row.representation==='opaque'?row.value_json:unpackStoredRecord(row.value_json,memo);}
 private candidateBody(id:string,table:string,key:string):string{
  const row=this.rows<StoredRow>('SELECT record_key,value_json,representation FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,table,key])[0];
  if(!row)this.fail();return this.plainStored(row);
 }

 /** Prepare outside transactions, then flush at most 16 scratch writes/1MiB
  * synchronously. No transaction spans a yield; source facts stay unchanged.
  * Activation still checks the source and all original fences. */
 private async prepareEncoding(plan:UpdatePlan,fence:ReplicaCandidateFence,alive:()=>void,readSource?:(table:SqliteLibraryTable,key:string)=>string|undefined,budget?:{bytes?:number}):Promise<void>{
  const id=plan.receipt.id,memo=new StoredRecordMemo();
  let storedBytes=budget?.bytes??this.header(id).stored_bytes+this.rows<{n:number}>(`SELECT
   COALESCE((SELECT sum(length(CAST(encoded_json AS BLOB))+length(CAST(value_json AS BLOB))+length(CAST(digests_json AS BLOB))) FROM sensa_replica_candidate_encoded_v1 WHERE candidate_id=?),0)+
   COALESCE((SELECT sum(length(CAST(stored_json AS BLOB))+COALESCE(length(CAST(existing_json AS BLOB)),0)) FROM sensa_replica_candidate_encoded_bodies_v1 WHERE candidate_id=?),0) AS n`,[id,id])[0].n;
  const charge=(...texts:string[])=>{storedBytes+=texts.reduce((sum,text)=>sum+utf8(text),0);if(storedBytes>maximumStoredBytes)throw Error('library_sync_capacity');if(budget)budget.bytes=storedBytes;};charge();
  const pending:Array<{sql:string;bind:(string|number|null)[]}>=[],bodies=new Map<string,string>();let pendingBytes=0;
  const release=()=>{replicaWork('encoding.batchHeldBytes',-pendingBytes);pending.length=0;bodies.clear();pendingBytes=0;};
  const flush=()=>{
   if(!pending.length)return;alive();replicaWork('encoding.batch');
   this.database.exec('BEGIN IMMEDIATE');
   try{for(const row of pending)this.insertEncoding(id,row.sql,row.bind);alive();this.assertAllocatedCapacity(id);this.database.exec('COMMIT');}
   catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
   finally{release();}
  };
  const stage=(sql:string,bind:(string|number|null)[],body?:{digest:string;plain:string})=>{
   const bytes=bind.reduce<number>((n,value)=>n+(typeof value==='string'?utf8(value):8),0)+(body?utf8(body.plain):0);
   if(pending.length&&(pending.length>=16||pendingBytes+bytes>1024*1024))flush();
   // A large singleton uses the original immediate strict write path.
   if(bytes>1024*1024){alive();this.database.exec('BEGIN IMMEDIATE');try{this.insertEncoding(id,sql,bind);this.assertAllocatedCapacity(id);this.database.exec('COMMIT');}catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}replicaWork('encoding.batchBypass');return;}
   pending.push({sql,bind});pendingBytes+=bytes;replicaWork('encoding.batchHeldBytes',bytes);if(body)bodies.set(body.digest,body.plain);
  };
  try{await runCooperatively((function*(this:SqliteReplicaCandidates){
   const rows=new Map<string,RecordKey&{record:boolean;sync:boolean}>();
   for(const row of plan.puts)rows.set(dependencyRowId(row.table,row.key),{...row,record:true,sync:false});
   for(const row of plan.basePuts){const key=dependencyRowId(row.table,row.key),prior=rows.get(key);if(prior)prior.sync=true;else rows.set(key,{...row,record:false,sync:true});}
   for(const row of rows.values()){
    alive();replicaWork('encoding.source');
    const source=readSource?readSource(row.table,row.key)??this.fail():this.candidateBody(id,row.table,row.key);
    const copy=canCopyLibraryReplicaValue(row);
    let common:{wire:string;stored:string;refs:string}|undefined;
    for(const kind of ['record','sync'] as const){
     if(!row[kind])continue;
     if(!common||!copy){
      replicaWork('encoding.transform');
      const encoded=kind==='sync'||copy?source:JSON.stringify(encodeBackupValue(restoreLibraryReplicaValue({...row,value:undefined},decodeBackupValue(JSON.parse(source)),fence.identity)));
      const shared=sharedRecordTables.has(row.table)?externalizeSharedRecordContent(JSON.parse(encoded),memo):undefined;
      const digests:string[]=[];
      for(const [digest,body]of shared?.bodies??[]){
       digests.push(digest);
       const staged=bodies.get(digest);if(staged!==undefined){if(staged!==body)throw Error('sqlite_shared_content_invalid');replicaWork('encoding.bodyHit');continue;}
       const cached=this.rows<{stored_json:string;existing_json:string|null}>('SELECT stored_json,existing_json FROM sensa_replica_candidate_encoded_bodies_v1 WHERE candidate_id=? AND digest=?',[id,digest])[0];
       if(cached){if(unpackStoredRecord(cached.stored_json,memo)!==body)throw Error('sqlite_shared_content_invalid');replicaWork('encoding.bodyHit');continue;}
       replicaWork('encoding.bodyWitness');
       const existing=this.rows<{value_json:string}>('SELECT value_json FROM sensa_shared_record_content WHERE digest=?',[digest])[0]?.value_json??null;
       if(existing!==null&&unpackStoredRecord(existing,memo)!==body)throw Error('sqlite_shared_content_invalid');
       const stored=existing??packStoredRecord(body);charge(stored,existing??'');
       stage('INSERT INTO sensa_replica_candidate_encoded_bodies_v1 VALUES(?,?,?,?)',[id,digest,stored,existing],{digest,plain:body});
      }
      const wire=packStoredRecord(encoded),compact=shared?JSON.stringify(shared.value):encoded;
      replicaWork('encoding.pack',compact===encoded?1:2);
      common={wire,stored:compact===encoded?wire:packStoredRecord(compact),refs:JSON.stringify(digests)};
     }else replicaWork('encoding.ownerReuse');
     // Both owner rows remain charged and written, even when their immutable
     // transformations are shared for this one admitted record.
     charge(common.wire,common.stored,common.refs);
     stage('INSERT INTO sensa_replica_candidate_encoded_v1 VALUES(?,?,?,?,?,?,?)',[id,kind,row.table,row.key,common.wire,common.stored,common.refs]);
    }
    // Check the cooperative budget after encoded work, including its last row.
    // Scratch transactions have ended before this step can yield.
    yield;
   }
  }).call(this));flush();alive();}finally{release();memo.clear();}
 }

 /** Activate prepared encoding inside the single synchronous source commit.
  * No preparation or yield occurs after BEGIN. */
 prepareCheckpointUpdate(id:string,mutation:SqliteMutation,memo?:StoredRecordMemo):Pick<SqliteMutation,'puts'|'deletes'|'syncBasePatch'>&{stored:(kind:'record'|'sync',table:SqliteLibraryTable,key:string)=>PreparedStoredRecord|undefined}{
  const plan=this.updatePlan,requested=mutation.replicaCandidateRestore?.update;
  if(!plan||plan.receipt.id!==id||!requested||!backupEqual(requested,plan.receipt))this.fail();
  const header=this.header(id);this.assertUpdateBase(header,plan.receipt.baseRevision);
  const candidate=this.receipt(header),fence=fenceSchema.parse(JSON.parse(header.fence_json));
  if(mutation.clears.length||mutation.deletes.length||mutation.portablePackages?.length||mutation.syncBaseReplacement!==undefined||mutation.syncBasePatch!==undefined)this.fail();
  const expectedRevision=fence.localRevision+(plan.receipt.contentChanged?1:0);
  if(mutation.contentRevision!==(plan.receipt.contentChanged?expectedRevision:undefined))this.fail();
  if(mutation.puts.length!==(plan.receipt.contentChanged?2:1)||mutation.puts.some(row=>row.table!=='meta'||!['cloud-sync','local-content-revision'].includes(row.key)))this.fail();
  const stateRow=mutation.puts.find(row=>row.key==='cloud-sync');if(!stateRow)this.fail();
  const state=decodeBackupValue(JSON.parse(stateRow.encodedValue)) as CloudSyncState&{restoreOperationId?:string};
  if(!validatedCheckpoint(state)||state.restoreOperationId!==id||state.status!=='synced'||state.revision!==candidate.head.revision||state.syncedLocalRevision!==expectedRevision
   ||state.owner.subject!==fence.owner.subject||state.owner.accountId!==fence.owner.accountId||state.incarnation!==fence.incarnation)this.fail();
  const revision=mutation.puts.find(row=>row.key==='local-content-revision');
  if(plan.receipt.contentChanged&&(!revision||decodeBackupValue(JSON.parse(revision.encodedValue))!==expectedRevision))this.fail();
  // Preserve the ordinary baseline-witness guard when switching from whole
  // replacement to a patch: an old cloud copy cannot undo a local deletion.
  for(const row of plan.puts)if(this.rows(`SELECT 1 FROM sensa_record_tombstones AS deleted
   LEFT JOIN sensa_sync_base AS prior ON prior.table_name=deleted.table_name AND prior.record_key=deleted.record_key
   WHERE deleted.table_name=? AND deleted.record_key=? AND prior.record_key IS NULL LIMIT 1`,[row.table,row.key]).length)throw Error('library_sync_history');
  // Activation is synchronous. Only the current row remains resident; its
  // encoded getter and stored-owner write share this one exact SQL read.
  let current:{kind:string;table:string;key:string;row:{encoded_json:string;value_json:string;digests_json:string};plain?:string}|undefined;
  const read=(kind:'record'|'sync',key:RecordKey)=>{
   if(current?.kind!==kind||current.table!==key.table||current.key!==key.key){
    replicaWork('activation.encodedRead');
    current={kind,...key,row:this.rows<{encoded_json:string;value_json:string;digests_json:string}>('SELECT encoded_json,value_json,digests_json FROM sensa_replica_candidate_encoded_v1 WHERE candidate_id=? AND owner_kind=? AND table_name=? AND record_key=?',[id,kind,key.table,key.key])[0]??this.fail()};
   }
   return current;
  };
  const plain=(kind:'record'|'sync',key:RecordKey)=>{const value=read(kind,key);if(value.plain===undefined){replicaWork('activation.wireUnpack');value.plain=unpackStoredRecord(value.row.encoded_json,memo);}return value.plain;};
  return {
   deletes:plan.deletes,
   puts:plan.puts.map(row=>({...row,get encodedValue(){return plain('record',row);}})),
   syncBasePatch:{deletes:plan.deletes,puts:plan.basePuts.map(row=>({...row,get valueJson(){return plain('sync',row);}}))},
   stored:(kind,table,key)=>{
    const keys=kind==='record'?plan.puts:plan.basePuts;if(!keys.some(row=>row.table===table&&row.key===key))return undefined;
    const row=read(kind,{table:table as RecordKey['table'],key}).row;
    const bodies=this.rows<{digest:string;stored_json:string;existing_json:string|null}>('SELECT digest,stored_json,existing_json FROM sensa_replica_candidate_encoded_bodies_v1 WHERE candidate_id=? AND digest IN (SELECT value FROM json_each(?))',[id,row.digests_json]);
    if(bodies.length!==JSON.parse(row.digests_json).length)this.fail();
    return {valueJson:row.value_json,bodies:bodies.map(body=>({digest:body.digest,stored:body.stored_json,existing:body.existing_json}))};
   },
  };
 }

 /** Called only inside the source transaction. Bodies remain in the private
  * SQLite generation; existing commit/projection code reads one on demand.
  * This is not a shortcut for merging an existing or previously synced world. */
 prepareFreshRestore(id:string,mutation:SqliteMutation,memo?:StoredRecordMemo):Pick<SqliteMutation,'puts'|'syncBaseReplacement'>&{copiedTables:ReadonlySet<SqliteLibraryTable>;sharedCopiedTables:ReadonlySet<SqliteLibraryTable>;sourceRows:Iterable<SqliteMutation['puts'][number]>;syncBaseRows:Iterable<NonNullable<SqliteMutation['syncBaseReplacement']>[number]>;copyOrdinary:()=>void;copySharedBaseline:(removed:Set<string>)=>void;logicalBytes:number}{
  if(mutation.clears.length||mutation.deletes.length>1||mutation.deletes.some(row=>row.table!=='meta'||row.key!=='local-reset')||mutation.portablePackages?.length||mutation.syncBaseReplacement!==undefined||mutation.syncBasePatch!==undefined||mutation.puts.some(row=>row.table!=='meta'||!['cloud-sync','local-content-revision'].includes(row.key)))this.fail();
  const header=this.header(id);this.check(header);const receipt=this.receipt(header),fence=fenceSchema.parse(JSON.parse(header.fence_json));
  const reset=this.rows<{value_json:string}>("SELECT value_json FROM sensa_records WHERE table_name='meta' AND record_key='local-reset'")[0];
  const reconnect=reset!==undefined&&decodeBackupValue(JSON.parse(unpackStoredRecord(reset.value_json)))==='local-clear';
  if(reconnect!==(mutation.deletes.length===1))this.fail();
  if(mutation.contentRevision!==fence.localRevision+1)this.fail();
  if(this.rows('SELECT 1 FROM sensa_sync_base LIMIT 1').length)throw Error('library_sync_local_changed');
  if(this.rows(`SELECT 1 FROM sensa_replica_candidate_records_v1 AS candidate
   JOIN sensa_record_tombstones AS deleted ON deleted.table_name=candidate.table_name AND deleted.record_key=candidate.record_key
   WHERE candidate.candidate_id=? LIMIT 1`,[id]).length)throw Error('library_sync_history');
  for(const row of this.rows<{table_name:string;record_key:string}>('SELECT table_name,record_key FROM sensa_records')){
   if(isReplicatedLibraryEntry(row.table_name,row.record_key)&&!(row.table_name==='meta'&&row.record_key==='identity'))throw Error('library_sync_local_changed');
  }
  const stateRow=mutation.puts.find(row=>row.table==='meta'&&row.key==='cloud-sync');if(!stateRow)this.fail();
  const revisionRow=mutation.puts.find(row=>row.table==='meta'&&row.key==='local-content-revision');
  if(mutation.puts.length!==2||!revisionRow||decodeBackupValue(JSON.parse(revisionRow.encodedValue))!==mutation.contentRevision)this.fail();
  const state=decodeBackupValue(JSON.parse(stateRow.encodedValue)) as {restoreOperationId?:string;owner?:{subject:string;accountId:string};incarnation?:string;revision?:number;syncedLocalRevision?:number;status?:string};
  if(state.restoreOperationId!==id||state.owner?.subject!==fence.owner.subject||state.owner.accountId!==fence.owner.accountId||state.incarnation!==fence.incarnation||state.revision!==receipt.head.revision||state.syncedLocalRevision!==mutation.contentRevision||state.status!=='synced')this.fail();
  const allTables=this.tables(id) as LibraryReplicaEntry['table'][],transformed=new Set<SqliteLibraryTable>();
  const metadata=function*(this:SqliteReplicaCandidates,tables:readonly SqliteLibraryTable[]=allTables){let table='',key='';for(;;){const page=this.rows<{table_name:LibraryReplicaEntry['table'];record_key:string;refs_json:string}>('SELECT table_name,record_key,refs_json FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name IN(SELECT value FROM json_each(?)) AND(table_name,record_key)>(?,?) ORDER BY table_name,record_key LIMIT 64',[id,JSON.stringify(tables),table,key]);if(!page.length)return;yield*page;table=page.at(-1)!.table_name;key=page.at(-1)!.record_key;}};
  for(const table of allTables)for(const row of metadata.call(this,[table]))if(!canCopyLibraryReplicaValue({table,key:row.record_key})){transformed.add(table);break;}
  const sharedCopiedTables=new Set(allTables.filter(table=>sharedRecordTables.has(table)&&!transformed.has(table)));
  const copiedTables=new Set(allTables.filter(table=>!sharedRecordTables.has(table)&&!transformed.has(table)));
  const read=(table:string,key:string)=>{
   const row=this.rows<StoredRow>('SELECT record_key,value_json,representation FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,table,key])[0];if(!row)this.fail();return this.plainStored(row,memo);
  };
  const sourceRows={*[Symbol.iterator](){for(const row of metadata.call(store)){yield {table:row.table_name,key:row.record_key,get encodedValue(){
   if(copiedTables.has(row.table_name)||sharedCopiedTables.has(row.table_name))return read(row.table_name,row.record_key);
   const value=decodeBackupValue(JSON.parse(read(row.table_name,row.record_key)));return JSON.stringify(encodeBackupValue(restoreLibraryReplicaValue({table:row.table_name,key:row.record_key,value:undefined},value,fence.identity)));
  }};}}},store=this;
  const restoredIdentity=restoreLibraryReplicaValue({table:'meta',key:'identity',value:undefined},receipt.identity,fence.identity);
  const puts:SqliteMutation['puts']=[{table:'operations',key:'00000000-0000-4000-8000-000000000001',encodedValue:JSON.stringify(encodeBackupValue({input:canonicalConsumerJson({kind:'library.create',input:{}}),result:restoredIdentity,committedAt:receipt.identity.createdAt}))}];
  const syncBaseRows={*[Symbol.iterator](){for(const row of metadata.call(store,allTables.filter(table=>!copiedTables.has(table))))yield {table:row.table_name,key:row.record_key,blockRefs:JSON.parse(row.refs_json),get valueJson(){return read(row.table_name,row.record_key);}};}};
  const syncBaseReplacement:NonNullable<SqliteMutation['syncBaseReplacement']>=[];
  const copyOrdinary=()=>{
   this.check(this.header(id));const tables=JSON.stringify([...copiedTables]);
   this.database.exec({sql:`INSERT INTO sensa_sync_base(table_name,record_key,value_json,block_refs_json)
    SELECT table_name,record_key,value_json,refs_json FROM sensa_replica_candidate_records_v1
    WHERE candidate_id=? AND table_name IN(SELECT value FROM json_each(?))`,bind:[id,tables]});
   this.database.exec({sql:`INSERT INTO sensa_records(table_name,record_key,value_json,content_revision)
    SELECT table_name,record_key,value_json,? FROM sensa_replica_candidate_records_v1
    WHERE candidate_id=? AND table_name IN(SELECT value FROM json_each(?))
    ON CONFLICT(table_name,record_key) DO UPDATE SET value_json=excluded.value_json,content_revision=excluded.content_revision`,bind:[mutation.contentRevision!,id,tables]});
   this.database.exec({sql:`DELETE FROM sensa_record_tombstones WHERE(table_name,record_key) IN(
    SELECT table_name,record_key FROM sensa_replica_candidate_records_v1
    WHERE candidate_id=? AND table_name IN(SELECT value FROM json_each(?)))`,bind:[id,tables]});
  };
  // The baseline writer has already generated and checked the exact private
  // shared representation. Reuse it for copyable source rows; do not expand,
  // hash and externalize the same materials a second time in this transaction.
  const copySharedBaseline=(removed:Set<string>)=>{
   this.check(this.header(id));const tables=JSON.stringify([...sharedCopiedTables]);
   const selected=`SELECT table_name,record_key FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name IN(SELECT value FROM json_each(?))`;
   for(const row of this.rows<{digest:string}>(`SELECT digest FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND(table_name,record_key) IN(${selected})`,[id,tables]))removed.add(row.digest);
   this.database.exec({sql:`DELETE FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND(table_name,record_key) IN(${selected})`,bind:[id,tables]});
   this.database.exec({sql:`INSERT INTO sensa_shared_record_content_owners(owner_kind,table_name,record_key,digest)
    SELECT 'record',table_name,record_key,digest FROM sensa_shared_record_content_owners
    WHERE owner_kind='sync' AND(table_name,record_key) IN(${selected})`,bind:[id,tables]});
   this.database.exec({sql:`INSERT INTO sensa_records(table_name,record_key,value_json,content_revision)
    SELECT base.table_name,base.record_key,base.value_json,? FROM sensa_sync_base AS base
    JOIN sensa_replica_candidate_records_v1 AS candidate ON candidate.table_name=base.table_name AND candidate.record_key=base.record_key
    WHERE candidate.candidate_id=? AND candidate.table_name IN(SELECT value FROM json_each(?))
    ON CONFLICT(table_name,record_key) DO UPDATE SET value_json=excluded.value_json,content_revision=excluded.content_revision`,bind:[mutation.contentRevision!,id,tables]});
   this.database.exec({sql:`DELETE FROM sensa_record_tombstones WHERE(table_name,record_key) IN(${selected})`,bind:[id,tables]});
  };
  return {puts,syncBaseReplacement,sourceRows,syncBaseRows,copiedTables,sharedCopiedTables,copyOrdinary,copySharedBaseline,logicalBytes:receipt.logicalBytes};
 }
 discard(id:string):void{uuid.parse(id);this.ensure();this.seeds.delete(id);this.validations.get(id)?.controller.abort(Error('library_sync_candidate_discarded'));this.updates.get(id)?.controller.abort(Error('library_sync_candidate_discarded'));if(this.updatePlan?.receipt.id===id)this.updatePlan=undefined;this.database.exec({sql:'DELETE FROM sensa_replica_candidates_v1 WHERE id=?',bind:[id]});this.dependencies.discardAdmission('candidate:'+id);this.admissions.delete(id);this.sparse.delete(id);this.baselines.delete(id);this.receiveEvidence.delete(id);this.sealedEpochs.delete(id);}
 abortAll(reason:Error):void{this.seeds.clear();for(const work of [...this.validations.values(),...this.updates.values()])work.controller.abort(reason);}
 async settle():Promise<void>{this.abortAll(Error('library_sync_candidate_discarded'));await Promise.allSettled([...this.validations.values(),...this.updates.values()].map(work=>work.result));}
}
