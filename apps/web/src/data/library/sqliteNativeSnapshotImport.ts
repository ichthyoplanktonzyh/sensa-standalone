import type {Database,SAHPoolUtil,Sqlite3Static} from '@sqlite.org/sqlite-wasm';
import {sha256} from '@noble/hashes/sha2.js';
import {canonicalConsumerJson,librarySyncNativeMetadata,librarySyncNativeSnapshot,librarySyncNativeDescriptorText,type LibrarySyncNativeSnapshot} from '@sensa/contracts/sensa';
import {sha256 as textHash} from '@sensa/learning-kernel';
import {SqliteRecordDatabase} from './sqliteDatabase';
import {SqliteSyncDependencies} from './sqliteSyncDependencies';
import {portableSnapshotSchema,portableSnapshotVersions,restrictPortableSnapshot} from './sqlitePortableSnapshot';
import {snapshotAdmissionSchema,snapshotPendingSchema,checkSnapshotNativeRelations,nativeSnapshotSchema} from './sqliteAdmittedSnapshot';
import {sqliteLibrarySchemaVersion} from './sqliteProtocol';
import {backupEqual,decodeBackupValue,encodeBackupValue} from './backupCodec';
import {isReplicatedLibraryEntry} from './replication/libraryReplica';
import {snapshotDigest} from './sqliteSnapshotFiles';
import type {ReplicaCandidateFence} from './replicaCandidateProtocol';
import type {CloudSyncState} from './cloudSync';

/** This entry is only for an authenticated own-account descriptor at H.
 * External imports continue through importLocalPortableSnapshot's full gate. */
export async function importNativeCloudSnapshot(sqlite:Sqlite3Static,pool:SAHPoolUtil,file:string,input:File,descriptor:LibrarySyncNativeSnapshot,owner:ReplicaCandidateFence['owner'],onImportedBytes?:(bytes:number)=>void){
 const started=performance.now(),binding=librarySyncNativeSnapshot.parse(descriptor);
 const invalid=(reason:string):never=>{throw Error('sqlite_snapshot_'+reason);};
 if(binding.accountId!==owner.accountId||binding.schemaVersion!==sqliteLibrarySchemaVersion||binding.byteLength!==input.size||textHash(librarySyncNativeDescriptorText(binding))!==binding.manifestHash||pool.getFileNames().length)invalid('checkpoint_binding');
 const expectedRaw=new sqlite.oo1.DB(':memory:','c'),expectedLibrary=new SqliteRecordDatabase(sqlite,expectedRaw,'memory');
 let schema:ReturnType<typeof portableSnapshotSchema>,versions:ReturnType<typeof portableSnapshotVersions>;
 try{expectedLibrary.initialize();expectedRaw.exec(snapshotPendingSchema);expectedRaw.exec(snapshotAdmissionSchema);schema=portableSnapshotSchema(expectedRaw);versions=portableSnapshotVersions(expectedRaw);}finally{expectedLibrary.close(false);}
 let raw:Database|undefined,library:SqliteRecordDatabase|undefined;const digest=sha256.create();let bytes=0,lastProgress=0;
 try{
  const reader=input.stream().getReader();
  try{await pool.importDb(file,async()=>{const next=await reader.read();if(next.done){onImportedBytes?.(bytes);return undefined;}bytes+=next.value.byteLength;if(bytes>binding.byteLength)invalid('envelope');digest.update(next.value);if(bytes-lastProgress>=4*1024*1024){lastProgress=bytes;onImportedBytes?.(bytes);}return next.value;});}finally{reader.releaseLock();}
  if(bytes!==binding.byteLength||snapshotDigest(digest.digest())!==binding.sha256)invalid('envelope');
  const imported=performance.now();raw=new pool.OpfsSAHPoolDb(file);restrictPortableSnapshot(sqlite,raw);
  if(raw.selectValue('PRAGMA user_version')!==sqliteLibrarySchemaVersion||JSON.stringify(nativeSnapshotSchema(raw))!==JSON.stringify(schema!)||JSON.stringify(portableSnapshotVersions(raw))!==JSON.stringify(versions!))invalid('schema_allowlist');
  library=new SqliteRecordDatabase(sqlite,raw,'opfs');
  const metadata=(()=>{try{return librarySyncNativeMetadata.parse(JSON.parse(String(raw!.selectValue('SELECT metadata_json FROM sensa_snapshot_admission_v2 WHERE id=1'))));}catch{return invalid('checkpoint_binding');}})();
  const {sha256:_hash,byteLength:_bytes,blocks:_blocks,manifestHash:_manifest,...declaredMetadata}=binding;
  if(!backupEqual(metadata,declaredMetadata)||raw.selectValue('SELECT count(*) FROM sensa_snapshot_admission_v2')!==1||raw.selectValue("SELECT count(*) FROM sensa_private_restore_pending_v1 WHERE id='own-cloud-native-v2'")!==1||raw.selectValue('SELECT count(*) FROM sensa_private_restore_pending_v1')!==1)invalid('checkpoint_binding');
  // parse() is strict: compare only the explicit metadata fields above.
  raw.createFunction({name:'sensa_snapshot_portable',arity:2,deterministic:true,innocuous:true,xFunc:(_context,table,key)=>typeof table==='string'&&typeof key==='string'&&isReplicatedLibraryEntry(table,key)?1:0});
  if(raw.selectValue('SELECT EXISTS(SELECT 1 FROM sensa_records WHERE NOT sensa_snapshot_portable(table_name,record_key) OR content_revision!=0)')||raw.selectValue('SELECT count(*) FROM sensa_record_tombstones')||raw.selectValue('SELECT count(*) FROM sensa_portable_media')||raw.selectValue('SELECT count(*) FROM sensa_portable_package_media')||raw.selectValue('SELECT count(*) FROM sensa_package_cache_projection')||raw.selectValue('SELECT count(*) FROM sensa_sync_admission_v1')||raw.selectValue('SELECT count(*) FROM sensa_sync_admission_rows_v1')||raw.selectValue('SELECT count(*) FROM sensa_sync_dependency_state_v1 WHERE generation!=0 OR epoch!=0 OR certificate_json IS NOT NULL')||raw.selectValue('SELECT count(*) FROM sensa_sync_dependency_state_v1')!==1)invalid('device_storage');
  checkSnapshotNativeRelations(raw,binding.records);
  if(raw.selectValue('SELECT EXISTS(SELECT 1 FROM sensa_sync_base b WHERE NOT EXISTS(SELECT 1 FROM sensa_sync_dependency_rows_v1 d WHERE d.table_name=b.table_name AND d.record_key=b.record_key))')||raw.selectValue("SELECT count(*) FROM sensa_records WHERE table_name='learningTargets'")!==raw.selectValue('SELECT count(*) FROM sensa_learning_semantic_memory'))invalid('native_relations');
  if(raw.selectValue('PRAGMA integrity_check')!=='ok'||raw.exec({sql:'PRAGMA foreign_key_check',returnValue:'resultRows'}).length)invalid('integrity');
  const identity=decodeBackupValue(JSON.parse(library.get('meta','identity')!)) as ReplicaCandidateFence['identity'];
  if(identity.id!==binding.libraryId||identity.learnerId!==binding.learnerId||identity.deviceId!==binding.libraryId)invalid('identity');
  const checked=performance.now();raw.exec('DROP TABLE sensa_snapshot_admission_v2;DROP TABLE sensa_private_restore_pending_v1');
  if(sqlite.capi.sqlite3_db_config(raw.pointer!,sqlite.capi.SQLITE_DBCONFIG_ENABLE_TRIGGER,1)!==0)invalid('connection_restriction');
  library.initialize();
  const incarnation=crypto.randomUUID(),deviceIdentity={...identity,deviceId:crypto.randomUUID()},at=new Date().toISOString();
  const state:CloudSyncState={owner,incarnation,status:'synced',checkpointVersion:7,restoreValidationVersion:9,revision:binding.revision,syncedLocalRevision:1,lastSyncedAt:at,lastCheckedAt:at};
  library.commit({clears:[],deletes:[],puts:[...Object.entries({identity:deviceIdentity,'local-incarnation':incarnation,'local-content-revision':1,'service-owner':owner,'cloud-sync':state}).map(([key,value])=>({table:'meta' as const,key,encodedValue:JSON.stringify(encodeBackupValue(value))})),{table:'operations',key:'00000000-0000-4000-8000-000000000001',encodedValue:JSON.stringify(encodeBackupValue({input:canonicalConsumerJson({kind:'library.create',input:{}}),result:deviceIdentity,committedAt:deviceIdentity.createdAt}))}]});
  const dependencies=new SqliteSyncDependencies(raw);try{raw.exec('BEGIN IMMEDIATE');dependencies.certifyAdmittedSnapshot(metadata,state,deviceIdentity);raw.exec('COMMIT');}catch(error){raw.exec('ROLLBACK');throw error;}finally{dependencies.close();}
  return {library,identity:deviceIdentity,incarnation,metadata,stats:{admissionReused:true,decodedRecords:0,records:metadata.records},timingsMs:{import:imported-started,nativeAdmission:checked-imported,deviceBootstrap:performance.now()-checked,total:performance.now()-started}};
 }catch(error){try{if(library)library.close(false);else raw?.close();}finally{pool.unlink(file);}throw error;}
 finally{digest.destroy();}
}
