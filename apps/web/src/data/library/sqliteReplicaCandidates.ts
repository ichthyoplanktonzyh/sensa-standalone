import type {Database} from '@sqlite.org/sqlite-wasm';
import {z} from 'zod';
import {librarySyncHead} from '@sensa/contracts/sensa';
import {decodeBackupValue} from './backupCodec';
import {packStoredRecord,unpackStoredRecord} from './sharedRecordContent';
import {isReplicatedLibraryEntry} from './replication/libraryReplica';
import type {LibraryRecordReader} from './libraryRecordReader';
import {isFatalSqliteConnectionFailure,sqliteRollbackFailure} from './sqliteConnectionFailure';
import {replicaCandidateSchema,type ReplicaCandidateFence,type ReplicaCandidateExpected,type ReplicaCandidateRecord,type ReplicaCandidateValidation} from './replicaCandidateProtocol';

const uuid=z.string().uuid(),integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identitySchema=z.object({id:uuid,learnerId:uuid,deviceId:uuid,createdAt:z.string().datetime({offset:true}),schemaVersion:z.literal(2)}).strict();
const fenceSchema=z.object({owner:z.object({subject:uuid,accountId:uuid}).strict(),incarnation:z.string().min(1).max(128),localRevision:integer,identity:identitySchema}).strict();
const expectedSchema=z.object({libraryId:uuid,learnerId:uuid,records:z.number().int().min(1).max(200000),head:librarySyncHead.refine(head=>head.manifest!==null)}).strict();
const maximumRecordBytes=90*1024*1024,maximumLogicalBytes=512*1024*1024,maximumStoredBytes=256*1024*1024,appendBytes=4*1024*1024,pageBytes=1024*1024;
const utf8=(text:string)=>new TextEncoder().encode(text).length;
type Header={id:string;fence_json:string;expected_json:string;state:string;records:number;logical_bytes:number;stored_bytes:number;identity_json:string|null};
type StoredRow={record_key:string;value_json:string};

/** Disk-backed, private candidate generations. Filling rows never enter the
 * live Library or sync baseline. A sealed generation has no write path; full
 * validation may yield while ordinary local reads and writes continue. */
export class SqliteReplicaCandidates{
 private ready=false;
 private readonly validations=new Map<string,{controller:AbortController;result:Promise<ReplicaCandidateValidation>}>();
 constructor(private readonly database:Database,private readonly assertFence:(fence:ReplicaCandidateFence)=>void,private readonly assertHealthy:()=>void){}
 private ensure(){
  this.assertHealthy();
  if(!this.ready){
   this.database.exec(replicaCandidateSchema);
   // A generation is a disposable download scratch area, not a recoverable
   // source fact. No caller from a previous connection can still own its ID.
   this.database.exec('DELETE FROM sensa_replica_candidates_v1');
   this.ready=true;
  }
 }
 private rows<T>(sql:string,bind:readonly (string|number|null)[]=[]):T[]{this.assertHealthy();return this.database.exec({sql,bind:[...bind],rowMode:'object',returnValue:'resultRows'}) as T[];}
 private header(id:string):Header{uuid.parse(id);this.ensure();return this.rows<Header>('SELECT * FROM sensa_replica_candidates_v1 WHERE id=?',[id])[0]??this.fail();}
 private fail():never{throw Error('library_sync_candidate_invalid');}
 private check(header:Header){this.assertFence(fenceSchema.parse(JSON.parse(header.fence_json)));}

 begin(fence:ReplicaCandidateFence,expected:ReplicaCandidateExpected):string{
  fence=fenceSchema.parse(fence);expected=expectedSchema.parse(expected);this.assertFence(fence);this.ensure();
  const fenceJson=JSON.stringify(fence),expectedJson=JSON.stringify(expected);
  const prior=this.rows<Header>('SELECT * FROM sensa_replica_candidates_v1')[0];
  // Lost begin ACKs recover the same generation, rather than accumulating
  // invisible learner copies. A failed generation is replaced on retry.
  if(prior&&(prior.state!=='sealed'||this.validations.has(prior.id))&&prior.fence_json===fenceJson&&prior.expected_json===expectedJson)return prior.id;
  if(this.validations.size)throw Error('library_sync_candidate_busy');
  const id=crypto.randomUUID();
  this.database.exec('BEGIN IMMEDIATE');
  try{
   this.database.exec('DELETE FROM sensa_replica_candidates_v1');
   this.database.exec({sql:"INSERT INTO sensa_replica_candidates_v1(id,fence_json,expected_json,state) VALUES(?,?,?,'filling')",bind:[id,fenceJson,expectedJson]});
   this.database.exec('COMMIT');
  }catch(cause){try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}throw cause;}
  return id;
 }
 append(id:string,records:readonly ReplicaCandidateRecord[]):void{
  const header=this.header(id);this.check(header);if(header.state!=='filling')this.fail();
  if(!records.length||records.length>128)this.fail();
  let logical=0,stored=0;
  // Preflight the entire raw batch before JSON parsing or compression. Even
  // a rejected batch must not materialize 128 individually large objects.
  const inputs=records.map(row=>{
   if(!isReplicatedLibraryEntry(row.table,row.key)||typeof row.key!=='string'||!row.key.length||row.key.length>2000||typeof row.valueJson!=='string')this.fail();
   if(row.valueJson.length>maximumRecordBytes)throw Error('library_sync_capacity');
   const refs=z.array(z.string().regex(/^[a-f0-9]{64}$/u)).min(1).max(2048).parse(row.blockRefs),size=utf8(row.valueJson);
   logical+=size;if(size>maximumRecordBytes||records.length>1&&logical>appendBytes)throw Error('library_sync_capacity');
   return {...row,size,refsJson:JSON.stringify(refs)};
  });
  this.database.exec('BEGIN IMMEDIATE');
  try{
   let added=0;logical=0;stored=0;
   for(const row of inputs){
    const prior=this.rows<{value_json:string;refs_json:string}>('SELECT value_json,refs_json FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name=? AND record_key=?',[id,row.table,row.key])[0];
    if(prior){if(unpackStoredRecord(prior.value_json)!==row.valueJson||prior.refs_json!==row.refsJson)this.fail();continue;}
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
      const page:StoredRow[]=self.rows<StoredRow>(`WITH page AS (
       SELECT record_key,value_json FROM sensa_replica_candidate_records_v1
       WHERE candidate_id=? AND table_name=? ${after===null?'':'AND record_key>?'} ORDER BY record_key LIMIT 64
      ),sized AS (
       SELECT record_key,value_json,ROW_NUMBER() OVER(ORDER BY record_key) AS ordinal,
        SUM(length(CAST(value_json AS BLOB))) OVER(ORDER BY record_key) AS bytes FROM page
      ) SELECT record_key,value_json FROM sized WHERE ordinal=1 OR bytes<=? ORDER BY record_key`,after===null?[id,table,pageBytes]:[id,table,after,pageBytes]);
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
  return {id:header.id,identity:identitySchema.parse(JSON.parse(header.identity_json!)),records:header.records,logicalBytes:header.logical_bytes,storedBytes:header.stored_bytes};
 }
 discard(id:string):void{uuid.parse(id);this.ensure();this.validations.get(id)?.controller.abort(Error('library_sync_candidate_discarded'));this.database.exec({sql:'DELETE FROM sensa_replica_candidates_v1 WHERE id=?',bind:[id]});}
 abortAll(reason:Error):void{for(const validation of this.validations.values())validation.controller.abort(reason);}
 async settle():Promise<void>{this.abortAll(Error('library_sync_candidate_discarded'));await Promise.allSettled([...this.validations.values()].map(validation=>validation.result));}
}
