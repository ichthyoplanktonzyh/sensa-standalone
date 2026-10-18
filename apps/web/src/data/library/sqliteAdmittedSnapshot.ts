import type {Database,Sqlite3Static} from '@sqlite.org/sqlite-wasm';
import {sha256} from '@sensa/learning-kernel';
import {backupEqual,decodeBackupValue,encodeBackupValue} from './backupCodec';
import {packStoredRecord,unpackStoredRecord} from './sharedRecordContent';
import {isReplicatedLibraryEntry,canCopyNormalizedLibraryReplicaValue} from './replication/libraryReplica';
import {SqliteSyncDependencies} from './sqliteSyncDependencies';
import {libraryRestoreValidationVersion} from './replication/libraryReplicaValidation';
import {portableSnapshotSchema,portableSnapshotVersions} from './sqlitePortableSnapshot';
import {sqliteLibrarySchemaVersion} from './sqliteProtocol';
import type {SnapshotSourceProof} from './sqliteSnapshotSource';
import type {CloudSyncState} from './cloudSync';

export const snapshotAdmissionTable='sensa_snapshot_admission_v2';
export const snapshotAdmissionSchema=`CREATE TABLE ${snapshotAdmissionTable}(id INTEGER PRIMARY KEY CHECK(id=1),metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)))`;
export const snapshotPendingSchema='CREATE TABLE sensa_private_restore_pending_v1(id TEXT PRIMARY KEY)';
export type AdmittedSnapshotMetadata={format:'sensa-own-cloud-db-v2';schemaVersion:number;admissionVersion:number;accountId:string;libraryId:string;learnerId:string;revision:number;sourceRevision:number;records:number;logicalBytes:number;storedBytes:number;packageCacheComplete:boolean};
export type SnapshotNativeWork={baselineRows:number;dependencyRows:number;bodyRows:number;bodyLogicalBytes:number;portableRows:number};
function invalid(reason:string):never{throw Error('sqlite_snapshot_'+reason);}
const scalar=(raw:Database,sql:string,bind?:(string|number)[])=>raw.selectValue(sql,bind);
const rows=<T>(raw:Database,sql:string,bind:(string|number)[]=[])=>raw.exec({sql,bind,rowMode:'object',returnValue:'resultRows'}) as T[];
/** SQLite quotes this one identifier after the shipped atomic baseline rename.
 * Accept exactly that equivalent spelling, without rebuilding the baseline. */
export const nativeSnapshotSchema=(raw:Database)=>portableSnapshotSchema(raw).map(row=>row.type==='table'&&row.name==='sensa_sync_base'&&row.tbl_name==='sensa_sync_base'&&row.sql?.startsWith('CREATE TABLE "sensa_sync_base"(')?{...row,sql:row.sql.replace(/^CREATE TABLE "sensa_sync_base"\(/u,'CREATE TABLE sensa_sync_base(')}:row);

/** These functions classify keys only. They never decode a fact or supply a
 * replacement for a normalization that its domain has not declared copyable. */
function keyFunctions(raw:Database){
 raw.createFunction({name:'sensa_snapshot_portable',arity:2,deterministic:true,innocuous:true,xFunc:(_context,table,key)=>typeof table==='string'&&typeof key==='string'&&isReplicatedLibraryEntry(table,key)?1:0});
 raw.createFunction({name:'sensa_snapshot_copyable',arity:2,deterministic:true,innocuous:true,xFunc:(_context,table,key)=>{
  if(typeof table!=='string'||typeof key!=='string'||!isReplicatedLibraryEntry(table,key))return 0;
  return canCopyNormalizedLibraryReplicaValue({table:table as Parameters<typeof canCopyNormalizedLibraryReplicaValue>[0]['table'],key})?1:0;
 }});
}

/** Prove that the controlled source still represents its fully admitted H.
 * This is deliberately a source-only entry: arbitrary files cannot grant
 * themselves a dependency certificate or an authenticated source fence. */
export function proveAdmittedSnapshotSource(raw:Database,proof:SnapshotSourceProof){
 const get=<T>(key:string):T|undefined=>{
  const stored=scalar(raw,"SELECT value_json FROM sensa_records WHERE table_name='meta' AND record_key=?",[key]);
  return typeof stored==='string'?decodeBackupValue(JSON.parse(unpackStoredRecord(stored))) as T:undefined;
 };
 const fence=proof.fence,state=get<CloudSyncState>('cloud-sync'),owner=get<{subject:string;accountId:string}>('service-owner');
 // Stored account display metadata is not replica authority. Match the same
 // strict subject/account pair used by captureHeader and the active Worker.
 if(owner?.subject!==fence.owner.subject||owner?.accountId!==fence.owner.accountId||!backupEqual(get('identity'),fence.identity)||!backupEqual(get('service-signout-epoch'),fence.signoutEpoch)||(get('local-incarnation')??'initial')!==fence.incarnation||(get('local-content-revision')??0)!==fence.localRevision||get('signed-out')||state?.status!=='synced')invalid('source_changed');
 const dependencies=new SqliteSyncDependencies(raw);
 try{
  const certificate=dependencies.match(state,fence,get<number>('local-artifact-revision')??0);
  if(!certificate||!backupEqual(certificate,proof.certificate)||certificate.validationVersion!==libraryRestoreValidationVersion)invalid('source_not_admitted');
  keyFunctions(raw);
  const canonicalIdentity=packStoredRecord(JSON.stringify(encodeBackupValue({...fence.identity,deviceId:fence.identity.id})));
  // Both directions matter: an extra fact is as unsafe as a missing fact.
  // Stored text equality is conservative; alternate encodings use refs restore.
  if(scalar(raw,`SELECT EXISTS(SELECT 1 FROM sensa_sync_base b LEFT JOIN sensa_records r ON r.table_name=b.table_name AND r.record_key=b.record_key WHERE r.record_key IS NULL OR NOT sensa_snapshot_portable(b.table_name,b.record_key) OR b.value_json!=CASE WHEN b.table_name='meta' AND b.record_key='identity' THEN ? ELSE r.value_json END)`,[canonicalIdentity])||
   scalar(raw,`SELECT EXISTS(SELECT 1 FROM sensa_records r WHERE sensa_snapshot_portable(r.table_name,r.record_key) AND(NOT EXISTS(SELECT 1 FROM sensa_sync_base b WHERE b.table_name=r.table_name AND b.record_key=r.record_key) OR NOT(r.table_name='meta' AND r.record_key='identity') AND NOT sensa_snapshot_copyable(r.table_name,r.record_key)))`))invalid('source_baseline');
  const baselineRows=Number(scalar(raw,'SELECT count(*) FROM sensa_sync_base'));
  const stats=rows<{records:number;logical:number;stored:number}>(raw,'SELECT count(*) AS records,coalesce(sum(logical_bytes),0) AS logical,coalesce(sum(stored_bytes),0) AS stored FROM sensa_sync_dependency_rows_v1')[0];
  if(baselineRows!==certificate.records||stats.records!==certificate.records||stats.logical!==certificate.logicalBytes||stats.stored!==certificate.storedBytes||
   scalar(raw,'SELECT EXISTS(SELECT 1 FROM sensa_sync_base b WHERE NOT EXISTS(SELECT 1 FROM sensa_sync_dependency_rows_v1 d WHERE d.table_name=b.table_name AND d.record_key=b.record_key))'))invalid('source_dependency');
  return {metadata:{format:'sensa-own-cloud-db-v2',schemaVersion:sqliteLibrarySchemaVersion,admissionVersion:libraryRestoreValidationVersion,accountId:fence.owner.accountId,libraryId:fence.identity.id,learnerId:fence.identity.learnerId,revision:certificate.revision,sourceRevision:fence.localRevision,records:certificate.records,logicalBytes:certificate.logicalBytes,storedBytes:certificate.storedBytes,packageCacheComplete:certificate.packageCacheComplete} satisfies AdmittedSnapshotMetadata,canonicalIdentity,work:{baselineRows,dependencyRows:stats.records,bodyRows:0,bodyLogicalBytes:0,portableRows:baselineRows} satisfies SnapshotNativeWork};
 }finally{dependencies.close();}
}

/** Native physical checks supplement the historical admission and controlled
 * writer invariant. Symmetry alone does not derive references from values. */
export function checkSnapshotNativeRelations(raw:Database,records:number){
 if(scalar(raw,'SELECT count(*) FROM sensa_records')!==records||scalar(raw,'SELECT count(*) FROM sensa_sync_base')!==records||
  scalar(raw,'SELECT EXISTS(SELECT 1 FROM sensa_records r LEFT JOIN sensa_sync_base b ON r.table_name=b.table_name AND r.record_key=b.record_key WHERE b.record_key IS NULL OR b.value_json!=r.value_json)')||
  scalar(raw,"SELECT EXISTS(SELECT 1 FROM sensa_shared_record_content_owners o WHERE NOT EXISTS(SELECT 1 FROM sensa_shared_record_content c WHERE c.digest=o.digest) OR o.owner_kind='record' AND NOT EXISTS(SELECT 1 FROM sensa_records r WHERE r.table_name=o.table_name AND r.record_key=o.record_key) OR o.owner_kind='sync' AND NOT EXISTS(SELECT 1 FROM sensa_sync_base b WHERE b.table_name=o.table_name AND b.record_key=o.record_key))")||
  scalar(raw,"SELECT EXISTS(SELECT table_name,record_key,digest FROM sensa_shared_record_content_owners WHERE owner_kind='record' EXCEPT SELECT table_name,record_key,digest FROM sensa_shared_record_content_owners WHERE owner_kind='sync')")||
  scalar(raw,"SELECT EXISTS(SELECT table_name,record_key,digest FROM sensa_shared_record_content_owners WHERE owner_kind='sync' EXCEPT SELECT table_name,record_key,digest FROM sensa_shared_record_content_owners WHERE owner_kind='record')")||
  scalar(raw,'SELECT EXISTS(SELECT 1 FROM sensa_shared_record_content c WHERE NOT EXISTS(SELECT 1 FROM sensa_shared_record_content_owners o WHERE o.digest=c.digest))'))invalid('native_relations');
}

/** Mutate only the newly owned, unselected copy. VACUUM is a separate final
 * step so removed private values never remain in the published free pages. */
export function sanitizeAdmittedSnapshot(sqlite:Sqlite3Static,raw:Database,proof:SnapshotSourceProof,expected:{schema:ReturnType<typeof portableSnapshotSchema>;versions:ReturnType<typeof portableSnapshotVersions>},onStage?:(stage:string,work:SnapshotNativeWork)=>void){
 if(raw.selectValue('PRAGMA user_version')!==sqliteLibrarySchemaVersion||JSON.stringify(portableSnapshotVersions(raw))!==JSON.stringify(expected.versions))invalid('source_version');
 const admitted=proveAdmittedSnapshotSource(raw,proof),{work}=admitted;
 onStage?.('source-proof',work);
 if(sqlite.capi.sqlite3_db_config(raw.pointer!,sqlite.capi.SQLITE_DBCONFIG_ENABLE_TRIGGER,0)!==0)invalid('connection_restriction');
 raw.exec('PRAGMA foreign_keys=OFF');raw.exec('BEGIN IMMEDIATE');
 try{
  raw.exec('DELETE FROM sensa_records WHERE NOT sensa_snapshot_portable(table_name,record_key)');
  raw.exec('UPDATE sensa_records SET content_revision=0 WHERE content_revision!=0;DELETE FROM sensa_record_tombstones;DELETE FROM sensa_portable_media;DELETE FROM sensa_portable_package_media');
  raw.exec({sql:"UPDATE sensa_records SET value_json=? WHERE table_name='meta' AND record_key='identity'",bind:[admitted.canonicalIdentity]});
  raw.exec("DELETE FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND NOT EXISTS(SELECT 1 FROM sensa_records r WHERE r.table_name=sensa_shared_record_content_owners.table_name AND r.record_key=sensa_shared_record_content_owners.record_key);DELETE FROM sensa_shared_record_content WHERE NOT EXISTS(SELECT 1 FROM sensa_shared_record_content_owners o WHERE o.digest=sensa_shared_record_content.digest)");
  raw.exec("DELETE FROM sensa_package_cache_projection;DELETE FROM sensa_practice_expressions WHERE source='books'");
  admitted.metadata.packageCacheComplete=false;
  const expectedNames=new Set(expected.schema.filter(row=>row.type==='table').map(row=>row.name));
  // Publication leaves three observers on the permanent admission table.
  // Remove these known scratch observers before dropping their scratch root.
  for(const action of ['insert','update','delete'])raw.exec('DROP TRIGGER IF EXISTS sensa_initial_publication_admission_'+action+'_epoch');
  for(const row of rows<{name:string}>(raw,"SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'"))if(!expectedNames.has(row.name)){
   if(row.name!=='sensa_initial_publication'&&!/^(sensa_replica_|sensa_record_validation_|sensa_initial_publication_)\w+$/u.test(row.name))invalid('source_schema_table:'+row.name);
   raw.exec('DROP TABLE '+row.name);
  }
  raw.exec('DELETE FROM sensa_sync_admission_rows_v1;DELETE FROM sensa_sync_admission_v1;UPDATE sensa_sync_dependency_state_v1 SET generation=0,epoch=0,certificate_json=NULL');
  raw.exec('COMMIT');
 }catch(error){raw.exec('ROLLBACK');throw error;}
 if(JSON.stringify(nativeSnapshotSchema(raw))!==JSON.stringify(expected.schema))invalid('source_schema');
 checkSnapshotNativeRelations(raw,admitted.metadata.records);
 const page=raw.prepare('SELECT digest,length(CAST(value_json AS BLOB)) AS bytes FROM sensa_shared_record_content WHERE digest>? ORDER BY digest LIMIT 64');
 const body=raw.prepare('SELECT value_json FROM sensa_shared_record_content WHERE digest=?');let after='';
 try{for(;;){page.reset(true).bind([after]);const bodies:Array<{digest:string;bytes:number}>=[];while(page.step())bodies.push(page.get({}) as {digest:string;bytes:number});page.reset(true);if(!bodies.length)break;
  for(const entry of bodies){
   if(entry.bytes>96*1024*1024)invalid('shared_body');body.reset(true).bind([entry.digest]);if(!body.step())invalid('shared_body');const stored=body.get(0);body.reset(true);
   if(typeof stored!=='string')invalid('shared_body');const text=unpackStoredRecord(stored as string);if(sha256(text)!==entry.digest)invalid('shared_body');decodeBackupValue(JSON.parse(text));work.bodyRows++;work.bodyLogicalBytes+=new TextEncoder().encode(text).length;
  }
  after=bodies.at(-1)!.digest;
 }}finally{try{page.finalize();}finally{body.finalize();}}
 if(scalar(raw,'PRAGMA integrity_check')!=='ok'||rows(raw,'PRAGMA foreign_key_check').length)invalid('integrity');
 if(sqlite.capi.sqlite3_db_config(raw.pointer!,sqlite.capi.SQLITE_DBCONFIG_ENABLE_TRIGGER,1)!==0)invalid('connection_restriction');
 raw.exec('PRAGMA foreign_keys=ON');
 raw.exec('BEGIN IMMEDIATE');try{
  raw.exec(snapshotPendingSchema);raw.exec("INSERT INTO sensa_private_restore_pending_v1 VALUES('own-cloud-native-v2')");raw.exec(snapshotAdmissionSchema);
  raw.exec({sql:`INSERT INTO ${snapshotAdmissionTable} VALUES(1,?)`,bind:[JSON.stringify(admitted.metadata)]});raw.exec('COMMIT');
 }catch(error){raw.exec('ROLLBACK');throw error;}
 onStage?.('sanitized',work);return {metadata:admitted.metadata,work};
}
