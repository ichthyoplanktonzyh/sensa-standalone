import type {Database,PreparedStatement} from '@sqlite.org/sqlite-wasm';
import {z} from 'zod';
import {librarySyncHead,librarySyncBlockChars,canonicalConsumerJson} from '@sensa/contracts/sensa';
import {sha256} from '@sensa/learning-kernel';
import {backupEqual,decodeBackupValue,encodeBackupValue} from './backupCodec';
import {packStoredRecord,unpackStoredRecord,sharedRecordTables} from './sharedRecordContent';
import {isReplicatedLibraryEntry,restoreLibraryReplicaValue,normalizeLibraryReplicaEntry,canCopyLibraryReplicaValue,mergeLibraryReplicasCooperatively,replicaEntryEqual,replicaEntryId,planLibraryReplicaApply,type LibraryReplicaEntry} from './replication/libraryReplica';
import {validatedCheckpoint} from './cloudSyncCheckpoint';
import type {CloudSyncState} from './cloudSync';
import type {SqliteMutation,SqliteLibraryTable} from './sqliteProtocol';
import type {LibraryRecordReader} from './libraryRecordReader';
import {isFatalSqliteConnectionFailure,sqliteRollbackFailure} from './sqliteConnectionFailure';
import {replicaCandidateSchema,replicaCandidateAppendRecordLimit,replicaCandidateAppendReferenceLimit,type ReplicaCandidateFence,type ReplicaCandidateExpected,type ReplicaCandidateRecord,type ReplicaCandidateValidation,type ReplicaCandidateBlock,type ReplicaCandidateUpdate} from './replicaCandidateProtocol';
import {replicaCandidateProofBatchBytes,verifyReplicaCandidateBlock,verifyReplicaCandidateManifest} from './replicaCandidateProof';

const uuid=z.string().uuid(),integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identitySchema=z.object({id:uuid,learnerId:uuid,deviceId:uuid,createdAt:z.string().datetime({offset:true}),schemaVersion:z.literal(2)}).strict();
const fenceSchema=z.object({owner:z.object({subject:uuid,accountId:uuid}).strict(),incarnation:z.string().min(1).max(128),localRevision:integer,identity:identitySchema}).strict();
const expectedSchema=z.object({libraryId:uuid,learnerId:uuid,records:z.number().int().min(1).max(200000),head:librarySyncHead.refine(head=>head.manifest!==null)}).strict();
const maximumRecordBytes=90*1024*1024,maximumLogicalBytes=512*1024*1024,maximumStoredBytes=256*1024*1024,appendBytes=4*1024*1024,pageBytes=1024*1024;
const utf8=(text:string)=>new TextEncoder().encode(text).length;
type Header={id:string;fence_json:string;expected_json:string;state:string;records:number;logical_bytes:number;stored_bytes:number;identity_json:string|null};
type StoredRow={record_key:string;value_json:string};
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
 private updatePlan:UpdatePlan|undefined;
 constructor(private readonly database:Database,private readonly assertFence:(fence:ReplicaCandidateFence)=>void,private readonly assertHealthy:()=>void){}
 private ensure(){
  this.assertHealthy();
  if(!this.ready){
   // A generation is a disposable download scratch area, not a recoverable
   // source fact. No caller from a previous connection can still own its ID.
   this.database.exec('BEGIN IMMEDIATE');
   try{
    this.database.exec('DROP TABLE IF EXISTS sensa_replica_candidate_records_v1');
    this.database.exec(replicaCandidateSchema);
    this.database.exec('DELETE FROM sensa_replica_candidates_v1');
    this.database.exec('COMMIT');
   }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
   this.ready=true;
  }
 }
 private rows<T>(sql:string,bind:readonly (string|number|null)[]=[]):T[]{
  this.assertHealthy();
  let statement=this.statements.get(sql);if(!statement){statement=this.database.prepare(sql);this.statements.set(sql,statement);}
  statement.reset(true);if(bind.length)statement.bind([...bind]);
  const rows:T[]=[];try{while(statement.step())rows.push(statement.get({}) as T);return rows;}finally{statement.reset(true);}
 }
 close():void{for(const statement of this.statements.values())statement.finalize();this.statements.clear();}
 private header(id:string):Header{uuid.parse(id);this.ensure();return this.rows<Header>('SELECT * FROM sensa_replica_candidates_v1 WHERE id=?',[id])[0]??this.fail();}
 private fail():never{throw Error('library_sync_candidate_invalid');}
 private check(header:Header){this.assertFence(fenceSchema.parse(JSON.parse(header.fence_json)));}

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
  if(this.validations.size||this.updates.size)throw Error('library_sync_candidate_busy');
  this.updatePlan=undefined;
  const id=crypto.randomUUID();
  this.database.exec('BEGIN IMMEDIATE');
  try{
   this.assertFence(fence);
   this.database.exec('DELETE FROM sensa_replica_candidates_v1');
   this.database.exec({sql:"INSERT INTO sensa_replica_candidates_v1(id,fence_json,expected_json,state,stored_bytes) VALUES(?,?,?,'filling',?)",bind:[id,fenceJson,expectedJson,utf8(manifestJson)]});
   this.database.exec({sql:`INSERT INTO sensa_replica_candidate_manifest_v1
    SELECT ?,json_extract(value,'$.table'),json_extract(value,'$.key'),json_extract(value,'$.blocks') FROM json_each(?)`,bind:[id,manifestJson]});
   this.database.exec({sql:`INSERT INTO sensa_replica_candidate_proofs_v1(candidate_id,digest)
    SELECT DISTINCT ?,block.value FROM json_each(?) AS row,json_each(row.value,'$.blocks') AS block`,bind:[id,manifestJson]});
   this.database.exec('COMMIT');
  }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
  return id;
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
    const prior=this.rows<{value_json:string;refs_json:string}>('SELECT value_json,refs_json FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,row.table,row.key])[0];
    if(prior){if(unpackStoredRecord(prior.value_json)!==row.valueJson||prior.refs_json!==row.refsJson)this.fail();continue;}
    let offset=0;
    for(const digest of row.blockRefs){
     const proof=this.rows<{plain_digest:string|null;plain_chars:number|null}>('SELECT plain_digest,plain_chars FROM sensa_replica_candidate_proofs_v1 WHERE candidate_id=? AND digest=?',[id,digest])[0];
     if(!proof||proof.plain_digest===null||proof.plain_chars===null)throw Error('library_sync_missing_block');
     const end=offset+proof.plain_chars;if(end>row.valueJson.length||sha256(row.valueJson.slice(offset,end))!==proof.plain_digest)throw Error('library_sync_hash');offset=end;
    }
    if(offset!==row.valueJson.length)throw Error('library_sync_hash');
    added++;logical+=row.size;
    if(header.logical_bytes+logical>maximumLogicalBytes)throw Error('library_sync_capacity');
    JSON.parse(row.valueJson);const text=packStoredRecord(row.valueJson);stored+=utf8(text)+utf8(row.refsJson);
    if(header.stored_bytes+stored>maximumStoredBytes)throw Error('library_sync_capacity');
    this.database.exec({sql:'INSERT INTO sensa_replica_candidate_records_v1 VALUES(?,?,?,?,?)',bind:[id,row.table,row.key,text,row.refsJson]});
   }
   if(header.records+added>expectedSchema.parse(JSON.parse(header.expected_json)).records)this.fail();
   this.database.exec({sql:'UPDATE sensa_replica_candidates_v1 SET records=records+?,logical_bytes=logical_bytes+?,stored_bytes=stored_bytes+? WHERE id=?',bind:[added,logical,stored,id]});
   this.database.exec('COMMIT');
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
   this.database.exec({sql:'UPDATE sensa_replica_candidates_v1 SET stored_bytes=stored_bytes+? WHERE id=?',bind:[storedBytes,id]});this.database.exec('COMMIT');
  }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
 }
 private reader(id:string,signal:AbortSignal):LibraryRecordReader{
  const alive=()=>{this.assertHealthy();if(signal.aborted)throw signal.reason;};
  return {
   get:(table,key)=>{alive();const row=this.rows<StoredRow>('SELECT value_json FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,table,key])[0];return row?decodeBackupValue(JSON.parse(unpackStoredRecord(row.value_json))):undefined;},
   has:(table,key)=>{alive();return this.rows('SELECT 1 FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,table,key]).length>0;},
   entries:table=>{
    const self=this;
    return {[Symbol.iterator]:function*(){
     let after:string|null=null;
     for(;;){
      alive();self.check(self.header(id));
      // Select the bounded key prefix from a covering index before touching
      // wide bodies. The stored UTF-8 size is generated from the exact packed
      // value, so append/reuse cannot diverge from the paging budget.
      const keys=self.rows<{record_key:string;stored_value_bytes:number}>(`SELECT record_key,stored_value_bytes
       FROM sensa_replica_candidate_records_v1 INDEXED BY sensa_replica_candidate_page_v1
       WHERE candidate_id=? AND table_name=? ${after===null?'':'AND record_key>?'} ORDER BY record_key LIMIT 64`,after===null?[id,table]:[id,table,after]);
      const selected:string[]=[];let bytes=0;
      for(const row of keys){
       bytes+=row.stored_value_bytes;
       if(selected.length&&bytes>pageBytes)break;
       selected.push(row.record_key);
      }
      if(!selected.length)return;
      const page:StoredRow[]=self.rows<StoredRow>(`SELECT record_key,value_json FROM sensa_replica_candidate_records_v1
       WHERE candidate_id=? AND table_name=? AND record_key IN(SELECT value FROM json_each(?)) ORDER BY record_key`,[id,table,JSON.stringify(selected)]);
      if(!page.length)return;
      for(const row of page){alive();yield {key:row.record_key,value:decodeBackupValue(JSON.parse(unpackStoredRecord(row.value_json)))};}
      after=page.at(-1)!.record_key;
     }
    }};
   },
  };
 }
 validate(id:string):Promise<ReplicaCandidateValidation>{
  const running=this.validations.get(id);if(running)return running.result;
  const header=this.header(id);this.check(header);
  if(header.state==='validated')return Promise.resolve(this.receipt(header));
  if(header.state!=='filling'||header.records!==expectedSchema.parse(JSON.parse(header.expected_json)).records)this.fail();
  this.database.exec({sql:"UPDATE sensa_replica_candidates_v1 SET state='sealed' WHERE id=?",bind:[id]});
  const controller=new AbortController();
  const result=(async()=>{
   try{
    const {validateLibraryRecordsCooperatively}=await import('./backupValidation');
    const identity=await validateLibraryRecordsCooperatively(this.reader(id,controller.signal)),expected=expectedSchema.parse(JSON.parse(header.expected_json));
    if(identity.id!==expected.libraryId||identity.learnerId!==expected.learnerId)throw Error('library_sync_identity');
    this.assertHealthy();if(controller.signal.aborted)throw controller.signal.reason;
    this.check(this.header(id));
    this.database.exec({sql:"UPDATE sensa_replica_candidates_v1 SET state='validated',identity_json=? WHERE id=? AND state='sealed'",bind:[JSON.stringify(identity),id]});
    return this.receipt(this.header(id));
   }catch(cause){
    if(!controller.signal.aborted&&!isFatalSqliteConnectionFailure(cause)){
     try{
      this.assertHealthy();
      this.database.exec({sql:"DELETE FROM sensa_replica_candidates_v1 WHERE id=? AND state='sealed'",bind:[id]});
     }catch(cleanupCause){
      // A failed cleanup must not masquerade as an erased scratch area. FULL
      // is retryable after freeing storage; physical faults still quarantine.
      throw new AggregateError([cause,cleanupCause],'library_sync_candidate_cleanup_failed');
     }
    }
    throw cause;
   }finally{this.validations.delete(id);}
  })();
  this.validations.set(id,{controller,result});return result;
 }
 private receipt(header:Header):ReplicaCandidateValidation{
  if(header.state!=='validated'||header.identity_json===null)this.fail();
  const tables=this.rows<{table_name:SqliteLibraryTable}>('SELECT DISTINCT table_name FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? ORDER BY table_name',[header.id]).map(row=>row.table_name);
  return {id:header.id,identity:identitySchema.parse(JSON.parse(header.identity_json!)),head:expectedSchema.parse(JSON.parse(header.expected_json)).head,tables,records:header.records,logicalBytes:header.logical_bytes,storedBytes:header.stored_bytes};
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
     this.database.exec({sql:'INSERT INTO sensa_replica_candidate_records_v1 VALUES(?,?,?,?,?)',bind:[id,key.table,key.key,body,admitted.refs_json]});
    }
    reused.push({table:key.table as RecordKey['table'],key:key.key});
   }
   this.database.exec({sql:'UPDATE sensa_replica_candidates_v1 SET records=records+?,logical_bytes=logical_bytes+?,stored_bytes=stored_bytes+? WHERE id=?',bind:[records,logical,stored,id]});
   this.database.exec('COMMIT');
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
  const alive=()=>{this.assertHealthy();if(controller.signal.aborted)throw controller.signal.reason;this.assertUpdateBase(header,baseRevision);};
  const result=(async()=>{
   try{
    await Promise.resolve();alive();
    const normalized=normalizeLibraryReplicaEntry({table:'meta',key:'identity',value:fence.identity},fence.identity).value;
    if(!backupEqual(candidate.identity,normalized))return null;
    const refs=this.rows<{table_name:LibraryReplicaEntry['table'];record_key:string;block_refs_json:string}>('SELECT table_name,record_key,block_refs_json FROM sensa_sync_base ORDER BY table_name,record_key');
    if(!refs.some(row=>row.table_name==='meta'&&row.record_key==='identity'))return null;
    const base:LibraryReplicaEntry[]=refs.map(row=>({table:row.table_name,key:row.record_key,blocks:JSON.parse(row.block_refs_json),get value(){alive();return JSON.parse(readBase(row.table_name,row.record_key));}}));
    const rows=this.rows<{table_name:LibraryReplicaEntry['table'];record_key:string;refs_json:string}>('SELECT table_name,record_key,refs_json FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? ORDER BY table_name,record_key',[id]);
    const read=(table:string,key:string)=>this.candidateBody(id,table,key);
    const remote:LibraryReplicaEntry[]=rows.map(row=>({table:row.table_name,key:row.record_key,blocks:JSON.parse(row.refs_json),get value(){alive();return JSON.parse(read(row.table_name,row.record_key));}}));
    const merged=await mergeLibraryReplicasCooperatively({base,local:base,remote});
    alive();
    // Conflicts or a domain-generated publication still use the full existing
    // reconciliation path; do not silently select the remote branch.
    if(merged.conflicts.length||merged.entries.length!==remote.length)return null;
    const desired=new Map(remote.map(row=>[replicaEntryId(row),row]));
    for(const row of merged.entries)if(!replicaEntryEqual(row,desired.get(replicaEntryId(row))))return null;
    const changes=planLibraryReplicaApply(base,remote),key=({table,key}:RecordKey)=>({table,key});
    const prior=new Map(base.map(row=>[replicaEntryId(row),row]));
    const basePuts=remote.filter(row=>!backupEqual(row.blocks,prior.get(replicaEntryId(row))?.blocks)).map(row=>({...key(row),blockRefs:row.blocks!}));
    const records=[...changes.puts,...changes.deletes].map(key),contentChanged=records.length>0;
    const receipt:ReplicaCandidateUpdate={id,baseRevision,localRevision:fence.localRevision,contentChanged,tables:[...new Set(records.map(row=>row.table))],records};
    alive();this.updatePlan={receipt,puts:changes.puts.map(key),deletes:changes.deletes.map(key),basePuts};
    return receipt;
   }finally{this.updates.delete(id);}
  })();
  this.updates.set(id,{controller,result});return result;
 }

 private candidateBody(id:string,table:string,key:string):string{
  const row=this.rows<{value_json:string}>('SELECT value_json FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,table,key])[0];
  if(!row)this.fail();return unpackStoredRecord(row.value_json);
 }

 /** Expand only the prepared metadata into lazy writes, inside the existing
  * source transaction. Baseline, source facts and derived indexes commit once. */
 prepareCheckpointUpdate(id:string,mutation:SqliteMutation):Pick<SqliteMutation,'puts'|'deletes'|'syncBasePatch'>{
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
  const read=(row:RecordKey)=>this.candidateBody(id,row.table,row.key);
  return {
   deletes:plan.deletes,
   puts:plan.puts.map(row=>({...row,get encodedValue(){const value=decodeBackupValue(JSON.parse(read(row)));return JSON.stringify(encodeBackupValue(restoreLibraryReplicaValue({...row,value:undefined},value,fence.identity)));}})),
   syncBasePatch:{deletes:plan.deletes,puts:plan.basePuts.map(row=>({...row,get valueJson(){return read(row);}}))},
  };
 }

 /** Called only inside the source transaction. Bodies remain in the private
  * SQLite generation; existing commit/projection code reads one on demand.
  * This is not a shortcut for merging an existing or previously synced world. */
 prepareFreshRestore(id:string,mutation:SqliteMutation):Pick<SqliteMutation,'puts'|'syncBaseReplacement'>&{copiedTables:ReadonlySet<SqliteLibraryTable>;copyOrdinary:()=>void;logicalBytes:number}{
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
  const rows=this.rows<{table_name:LibraryReplicaEntry['table'];record_key:string;refs_json:string}>('SELECT table_name,record_key,refs_json FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? ORDER BY table_name,record_key',[id]);
  const excluded=new Set(rows.filter(row=>sharedRecordTables.has(row.table_name)||!canCopyLibraryReplicaValue({table:row.table_name,key:row.record_key})).map(row=>row.table_name));
  // Whole-table admission is conservative when ownership differs by key: one
  // transformed row keeps that entire table on its existing owner value path.
  const copiedTables=new Set(rows.map(row=>row.table_name).filter(table=>!excluded.has(table)));
  const read=(table:string,key:string)=>{
   const row=this.rows<{value_json:string}>('SELECT value_json FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,table,key])[0];if(!row)this.fail();return unpackStoredRecord(row.value_json);
  };
  const puts:SqliteMutation['puts']=rows.map(row=>({table:row.table_name,key:row.record_key,get encodedValue(){
   if(copiedTables.has(row.table_name))return read(row.table_name,row.record_key);
   const value=decodeBackupValue(JSON.parse(read(row.table_name,row.record_key)));
   return JSON.stringify(encodeBackupValue(restoreLibraryReplicaValue({table:row.table_name,key:row.record_key,value:undefined},value,fence.identity)));
  }}));
  const restoredIdentity=restoreLibraryReplicaValue({table:'meta',key:'identity',value:undefined},receipt.identity,fence.identity);
  puts.push({table:'operations',key:'00000000-0000-4000-8000-000000000001',encodedValue:JSON.stringify(encodeBackupValue({input:canonicalConsumerJson({kind:'library.create',input:{}}),result:restoredIdentity,committedAt:receipt.identity.createdAt}))});
  const syncBaseReplacement:NonNullable<SqliteMutation['syncBaseReplacement']>=rows.map(row=>({table:row.table_name,key:row.record_key,blockRefs:JSON.parse(row.refs_json),get valueJson(){return read(row.table_name,row.record_key);}}));
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
  return {puts,syncBaseReplacement,copiedTables,copyOrdinary,logicalBytes:receipt.logicalBytes};
 }
 discard(id:string):void{uuid.parse(id);this.ensure();this.validations.get(id)?.controller.abort(Error('library_sync_candidate_discarded'));this.updates.get(id)?.controller.abort(Error('library_sync_candidate_discarded'));if(this.updatePlan?.receipt.id===id)this.updatePlan=undefined;this.database.exec({sql:'DELETE FROM sensa_replica_candidates_v1 WHERE id=?',bind:[id]});}
 abortAll(reason:Error):void{for(const work of [...this.validations.values(),...this.updates.values()])work.controller.abort(reason);}
 async settle():Promise<void>{this.abortAll(Error('library_sync_candidate_discarded'));await Promise.allSettled([...this.validations.values(),...this.updates.values()].map(work=>work.result));}
}
