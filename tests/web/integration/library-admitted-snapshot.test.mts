import {test,expect} from 'vitest';
import init from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {SqliteSyncDependencies,syncAdmission} from '../../../apps/web/src/data/library/sqliteSyncDependencies';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {proveAdmittedSnapshotSource,sanitizeAdmittedSnapshot} from '../../../apps/web/src/data/library/sqliteAdmittedSnapshot';
import {portableSnapshotSchema,portableSnapshotVersions} from '../../../apps/web/src/data/library/sqlitePortableSnapshot';
import {libraryRestoreValidationVersion} from '../../../apps/web/src/data/library/replication/libraryReplicaValidation';
import type {LibraryIdentity} from '../../../apps/web/src/data/library/store';
import type {CloudSyncState} from '../../../apps/web/src/data/library/cloudSync';
import type {SnapshotSourceProof} from '../../../apps/web/src/data/library/sqliteSnapshotSource';

const sqlite=await init(),encode=(value:unknown)=>JSON.stringify(encodeBackupValue(value));
/** Real memory-VFS SQL and the shipped record/body writer; synthetic identity
 * and preferences only. This fixture is not a browser or domain-review claim. */
function fixture(){
 const raw=new sqlite.oo1.DB(':memory:','c'),library=new SqliteRecordDatabase(sqlite,raw,'memory');library.initialize();
 const identity:LibraryIdentity={schemaVersion:2,createdAt:'2026-10-15T00:00:00.000Z',id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID()},owner={accountId:crypto.randomUUID(),subject:crypto.randomUUID()},incarnation=crypto.randomUUID();
 const fence={identity,owner,incarnation,localRevision:3,signoutEpoch:undefined},preferences={content:{label:'shared synthetic preference '.repeat(100)}};
 const state:CloudSyncState={owner,incarnation,revision:17,checkpointVersion:7,restoreValidationVersion:libraryRestoreValidationVersion,syncedLocalRevision:3,status:'synced'};
 library.commit({clears:[],deletes:[],puts:[...Object.entries({identity,'service-owner':{...owner,email:'synthetic-source@example.invalid'},'local-incarnation':incarnation,'local-content-revision':3,'cloud-sync':state,'private-canary':'PRIVATE-SNAPSHOT-CANARY'}).map(([key,value])=>({table:'meta' as const,key,encodedValue:encode(value)})),{table:'settings',key:'appearance',encodedValue:encode(preferences)}],syncBaseReplacement:[{table:'meta',key:'identity',valueJson:encode({...identity,deviceId:identity.id}),blockRefs:['a'.repeat(64)]},{table:'settings',key:'appearance',valueJson:encode(preferences),blockRefs:['b'.repeat(64),'b'.repeat(64)]}]});
 const dependencies=new SqliteSyncDependencies(raw),admission=syncAdmission();dependencies.observe(admission,'meta','identity',encode({...identity,deviceId:identity.id}),{...identity,deviceId:identity.id});dependencies.observe(admission,'settings','appearance',encode(preferences),preferences);dependencies.certify(admission,state,identity,0);
 const proof:SnapshotSourceProof={id:crypto.randomUUID(),byteLength:Number(raw.selectValue('PRAGMA page_count'))*Number(raw.selectValue('PRAGMA page_size')),fence,certificate:dependencies.certificate()!};dependencies.close();
 return {raw,library,proof,identity,owner,preferences};
}
test('source proof requires both exact key sets and normalized identity, with native budget counts',()=>{
 const f=fixture();try{const admitted=proveAdmittedSnapshotSource(f.raw,f.proof);expect(admitted.metadata).toMatchObject({accountId:f.owner.accountId,libraryId:f.identity.id,revision:17,records:2});expect(admitted.work.baselineRows).toBe(2);expect(admitted.work.dependencyRows).toBe(2);expect(f.library.get('meta','identity')).toBe(encode(f.identity));}finally{f.library.close(false);}
});
for(const change of ['different','missing','extra'] as const)test(`source proof rejects a ${change} current fact even if the old certificate still matches`,()=>{
 const f=fixture();try{
  if(change==='different')f.raw.exec({sql:"UPDATE sensa_records SET value_json=? WHERE table_name='settings' AND record_key='appearance'",bind:[encode({value:'different'})]});
  if(change==='missing')f.raw.exec("DELETE FROM sensa_records WHERE table_name='settings' AND record_key='appearance'");
  if(change==='extra')f.raw.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('settings','extra',?)",bind:[encode({value:'extra'})]});
  expect(()=>proveAdmittedSnapshotSource(f.raw,f.proof)).toThrow('sqlite_snapshot_source_baseline');
 }finally{f.library.close(false);}
});
for(const change of ['owner','incarnation','epoch','artifact','baseline','body'] as const)test(`source proof rejects ${change} invalidation`,()=>{
 const f=fixture();try{
  if(change==='owner'||change==='incarnation'||change==='artifact')f.raw.exec({sql:"INSERT OR REPLACE INTO sensa_records(table_name,record_key,value_json) VALUES('meta',?,?)",bind:[change==='owner'?'service-owner':change==='incarnation'?'local-incarnation':'local-artifact-revision',encode(change==='owner'?{...f.owner,accountId:crypto.randomUUID()}:change==='incarnation'?crypto.randomUUID():1)]});
  if(change==='baseline')f.raw.exec("UPDATE sensa_sync_base SET block_refs_json='[]' WHERE table_name='settings'");
  if(change==='body'){f.raw.exec({sql:'INSERT INTO sensa_shared_record_content VALUES(?,?)',bind:['c'.repeat(64),encode({original:true})]});f.raw.exec({sql:'UPDATE sensa_shared_record_content SET value_json=?',bind:[encode({changed:true})]});}
  if(change==='epoch')f.raw.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('meta','service-signout-epoch',?)",bind:[encode('different-signout-session')]});
  expect(()=>proveAdmittedSnapshotSource(f.raw,f.proof)).toThrow(/sqlite_snapshot_source_(changed|not_admitted)/);
 }finally{f.library.close(false);}
});
test('private sanitization retains full baseline, duplicate ordered refs and native projection schemas',()=>{
 const f=fixture(),expectedRaw=new sqlite.oo1.DB(':memory:','c'),expectedLibrary=new SqliteRecordDatabase(sqlite,expectedRaw,'memory');expectedLibrary.initialize();
 const expected={schema:portableSnapshotSchema(expectedRaw),versions:portableSnapshotVersions(expectedRaw)};expectedLibrary.close(false);
 try{
  const beforeSchema=portableSnapshotSchema(f.raw);
  f.raw.exec('CREATE TABLE sensa_initial_publication(id TEXT PRIMARY KEY);CREATE TRIGGER sensa_initial_publication_admission_insert_epoch AFTER INSERT ON sensa_sync_admission_rows_v1 BEGIN DELETE FROM sensa_initial_publication;END');
  const result=sanitizeAdmittedSnapshot(sqlite,f.raw,f.proof,expected);
  expect(result.metadata.packageCacheComplete).toBe(false);
  expect(result.work.bodyRows).toBe(0);expect(f.raw.selectValue('SELECT count(*) FROM sensa_records')).toBe(2);expect(f.raw.selectValue('SELECT count(*) FROM sensa_sync_base')).toBe(2);
  expect(f.raw.selectValue("SELECT block_refs_json FROM sensa_sync_base WHERE table_name='settings'")).toBe(JSON.stringify(['b'.repeat(64),'b'.repeat(64)]));
  expect(f.raw.selectValue('SELECT count(*) FROM sensa_records r JOIN sensa_sync_base b USING(table_name,record_key) WHERE r.value_json!=b.value_json')).toBe(0);
  expect(f.raw.selectValue('SELECT certificate_json FROM sensa_sync_dependency_state_v1')).toBeNull();expect(f.raw.selectValue('SELECT generation+epoch FROM sensa_sync_dependency_state_v1')).toBe(0);
  expect(portableSnapshotSchema(f.raw).filter(row=>row.type==='table'&&(row.name.startsWith('sensa_snapshot_admission')||row.name.startsWith('sensa_private_restore_pending'))).map(row=>row.name).sort()).toEqual(['sensa_private_restore_pending_v1','sensa_snapshot_admission_v2']);
  expect(beforeSchema).toEqual(expected.schema);
  const vacuum='/admitted-focused-'+crypto.randomUUID()+'.sqlite3';f.raw.exec({sql:'VACUUM INTO ?',bind:[vacuum]});const output=new sqlite.oo1.DB(vacuum,'r');try{const bytes=sqlite.capi.sqlite3_js_db_export(output.pointer!);expect(new TextDecoder().decode(bytes)).not.toContain('PRIVATE-SNAPSHOT-CANARY');}finally{output.close();}
 }finally{f.library.close(false);}
});
