import type {Database,Sqlite3Static} from '@sqlite.org/sqlite-wasm';
import {openSnapshotDatabaseFile} from './sqliteSnapshotFile';
export {snapshotSourceChunkBytes,snapshotDatabaseByteLimit} from './sqliteSnapshotFile';
import {backupEqual,decodeBackupValue} from './backupCodec';
import {sqliteRollbackFailure} from './sqliteConnectionFailure';
import type {ReplicaCandidateFence} from './replicaCandidateProtocol';
import type {CloudSyncState} from './cloudSync';
import type {SqliteSyncDependencies,SyncDependencyCertificate} from './sqliteSyncDependencies';

export type SnapshotSourceFence=ReplicaCandidateFence&{signoutEpoch:unknown};
export type SnapshotSourceRequest=
 |{action:'begin';fence:SnapshotSourceFence}
 |{action:'read';id:string;offset:number}
 |{action:'copied'|'verify'|'discard';id:string};
export type SnapshotSourceProof={id:string;byteLength:number;fence:SnapshotSourceFence;certificate:SyncDependencyCertificate};
export type SnapshotSourceResult={kind:'begun';proof:SnapshotSourceProof}|{kind:'chunk';offset:number;bytes:Uint8Array;nativeReadMs:number}|{kind:'copied'|'verified'|'discarded'};

/** These calls only read SQL on this connection. Every other Worker call first
 * ends the copy, so a user write never waits for a complete database copy. */
const reads=new Set([
 'get','entries','entriesPage','recordKeysPage','existingRecordKeys','existingJourneyIdentities',
 'changesSince','hasChangesSince','syncBaseEntries','syncBaseReferences','count','estimateRecordBytes',
 'worldBrowse','learningHistoryPage',
]);

type Copy={proof:SnapshotSourceProof;changes:number;schema:number;metadata:Array<string|null>;offset:number;reading:boolean;reader:ReturnType<typeof openSnapshotDatabaseFile>};
const metadataKeys=['identity','service-owner','local-incarnation','signed-out','service-signout-epoch','local-content-revision','local-artifact-revision','cloud-sync'];

/** SQLite's shared-lock file-copy pattern, restricted to the one leased SAH
 * connection after a complete WAL checkpoint. No opaque OPFS paths are read.
 * The published WASM has no online-backup exports; FILE_POINTER/xRead are its
 * public native file interface. Only an unselected private copy consumes bytes. */
export class SqliteSnapshotSource{
 private copy:Copy|undefined;
 constructor(private readonly sqlite:Sqlite3Static,private readonly db:Database,private readonly dependencies:SqliteSyncDependencies,private readonly get:(key:string)=>string|null,private readonly assertFence:(fence:ReplicaCandidateFence)=>void,private readonly quarantine:(cause:Error)=>void){}
 beforeRequest(kind:string):void{if(kind!=='snapshotSource'&&!reads.has(kind))this.cancel();}
 private metadata(){return metadataKeys.map(key=>this.get(key));}
 private decoded<T>(key:string):T|undefined{const value=this.get(key);return value===null?undefined:decodeBackupValue(JSON.parse(value)) as T;}
 private check(copy:Copy,full=true){
  if(full){this.assertFence(copy.proof.fence);this.dependencies.assert(copy.proof.certificate);}
  if(this.db.changes(true)!==copy.changes||this.db.selectValue('PRAGMA schema_version')!==copy.schema||full&&this.metadata().some((value,index)=>value!==copy.metadata[index])||copy.reading&&this.sqlite.capi.sqlite3_get_autocommit(this.db.pointer!))throw Error('library_sync_local_changed');
 }
 private recoveryFailed(cause:unknown){const failure=sqliteRollbackFailure(Error('sqlite_snapshot_source_recovery'),cause);this.quarantine(failure);return failure;}
 private release(copy:Copy){
  if(!copy.reading)return;copy.reading=false;
  try{
   try{this.db.exec('ROLLBACK');}catch(cause){throw this.recoveryFailed(cause);}
   // A failed rollback keeps write protection enabled until connection close.
   try{this.db.exec('PRAGMA query_only=OFF');}catch(cause){throw this.recoveryFailed(cause);}
  }finally{copy.reader.close();}
 }
 cancel(){const copy=this.copy;this.copy=undefined;if(copy)this.release(copy);}
 request(input:SnapshotSourceRequest):SnapshotSourceResult{
  const started=performance.now();
  if(input.action==='begin')return this.begin(input.fence);
  const copy=this.copy;if(!copy||copy.proof.id!==input.id)throw Error('sqlite_snapshot_source_changed');
  if(input.action==='discard'){this.cancel();return {kind:'discarded'};}
  try{
   // Full identity/certificate checks bookend the copy. During its read-only
   // scope no metadata can change without the native mutation/schema clock.
   this.check(copy,input.action!=='read');
   if(input.action==='verify')return {kind:'verified'};
   if(input.action==='copied'){
    if(!copy.reading||copy.offset!==copy.proof.byteLength)throw Error('sqlite_snapshot_source_incomplete');this.release(copy);return {kind:'copied'};
   }
   if(input.action!=='read'||!copy.reading||!Number.isSafeInteger(input.offset)||input.offset!==copy.offset||input.offset>=copy.proof.byteLength)throw Error('sqlite_snapshot_source_offset');
   let bytes:Uint8Array;try{bytes=copy.reader.read(copy.offset);}catch(error){this.quarantine(error as Error);throw error;}
   const offset=copy.offset;copy.offset+=bytes.length;
   return {kind:'chunk',offset,bytes,nativeReadMs:performance.now()-started};
  }catch(error){this.cancel();throw error;}
 }
 private begin(fence:SnapshotSourceFence):SnapshotSourceResult{
  this.cancel();this.assertFence(fence);
  if(!backupEqual(this.decoded('service-signout-epoch'),fence.signoutEpoch))throw Error('account_changed');
  if(!this.sqlite.capi.sqlite3_get_autocommit(this.db.pointer!))throw Error('sqlite_snapshot_source_busy');
  if(this.db.selectValue('PRAGMA journal_mode')!=='wal'||this.db.selectValue('PRAGMA locking_mode')!=='exclusive'||this.db.selectValue('PRAGMA query_only')!==0)throw Error('sqlite_snapshot_source_runtime');
  const state=this.decoded<CloudSyncState>('cloud-sync'),certificate=this.dependencies.match(state,fence,this.decoded<number>('local-artifact-revision')??0);
  if(!certificate||state?.status!=='synced')throw Error('sqlite_snapshot_source_not_admitted');
  const checkpoint=this.db.exec({sql:'PRAGMA wal_checkpoint(TRUNCATE)',rowMode:'object',returnValue:'resultRows'}) as Array<{busy:number;log:number;checkpointed:number}>;
  if(checkpoint[0]?.busy!==0||checkpoint[0].log<0||checkpoint[0].checkpointed!==checkpoint[0].log)throw Error('sqlite_snapshot_source_checkpoint');
  const {capi:c}=this.sqlite;let reader:ReturnType<typeof openSnapshotDatabaseFile>|undefined,queryOnly=false;
  try{
   queryOnly=true;this.db.exec('PRAGMA query_only=ON');this.db.exec('BEGIN');this.db.exec('SELECT count(*) FROM main.sqlite_schema');
   reader=openSnapshotDatabaseFile(this.sqlite,this.db);const byteLength=reader.byteLength;
   const proof={id:crypto.randomUUID(),byteLength,fence:structuredClone(fence),certificate:structuredClone(certificate)};
   this.copy={proof,changes:this.db.changes(true),schema:Number(this.db.selectValue('PRAGMA schema_version')),metadata:this.metadata(),offset:0,reading:true,reader};
   this.check(this.copy);return {kind:'begun',proof:structuredClone(proof)};
  }catch(error){
   this.copy=undefined;
   try{
    if(!c.sqlite3_get_autocommit(this.db.pointer!))try{this.db.exec('ROLLBACK');}catch(rollback){throw this.recoveryFailed(rollback);}
    if(queryOnly)try{this.db.exec('PRAGMA query_only=OFF');}catch(reset){throw this.recoveryFailed(reset);}
   }finally{reader?.close();}
   throw error;
  }
 }
}
