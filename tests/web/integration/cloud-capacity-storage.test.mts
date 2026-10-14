import {test,expect} from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {librarySyncSnapshot,librarySyncCommit,librarySyncBinaryArtifact,librarySyncRecordLimit,librarySyncLogicalByteLimit,librarySyncStageMetadataByteLimit} from '@sensa/contracts/sensa';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {SqliteSyncDependencies,dependencyRowId} from '../../../apps/web/src/data/library/sqliteSyncDependencies';
import {SqliteRecordValidation,RecordValidationStorageError} from '../../../apps/web/src/data/library/sqliteRecordValidation';
const sqlite=await sqlite3InitModule();

function fixture(){const raw=new sqlite.oo1.DB(':memory:','c'),library=new SqliteRecordDatabase(sqlite,raw,'memory');library.initialize();const dependencies=new SqliteSyncDependencies(raw);dependencies.ensure();return {raw,dependencies,close:()=>{dependencies.close();library.close();}};}

test('staged cursors accept exactly the finite cloud tier while artifact and page limits stay independent',()=>{
 const snapshot={libraryId:crypto.randomUUID(),learnerId:crypto.randomUUID(),snapshotRevision:1,floor:0,records:librarySyncRecordLimit};
 expect(librarySyncSnapshot.parse(snapshot).records).toBe(600000);expect(librarySyncSnapshot.safeParse({...snapshot,records:600001}).success).toBe(false);
 const input={operationId:crypto.randomUUID(),baseRevision:0,staging:{pages:1,records:600000,digest:'a'.repeat(64)}};
 expect(librarySyncCommit.safeParse(input).success).toBe(true);expect(librarySyncCommit.safeParse({...input,staging:{...input.staging,records:600001}}).success).toBe(false);
 expect(librarySyncBinaryArtifact.shape.byteLength.safeParse(90*1024*1024+1).success).toBe(false);
 expect(librarySyncLogicalByteLimit).toBe(1024*1024*1024);expect(librarySyncStageMetadataByteLimit).toBe(128*1024*1024);
});

test('private SQL observations reject altered same-ID retries, roll back charging failures, and release only their scope',()=>{
 const f=fixture();try{
  let charged=0,reject=false;const admission=f.dependencies.spoolAdmission('candidate:one',false,bytes=>{if(reject)throw Error('budget rejected');charged+=bytes;});
  for(let i=0;i<1000;i++)f.dependencies.observe(admission,'settings','key-'+i,'["number",1]',1);
  admission.flush!();expect(admission.rows.size).toBe(1000);expect([...admission.rows.values()]).toHaveLength(1000);expect(charged).toBe(admission.retainedMetadataBytes!());
  const key=dependencyRowId('settings','key-0'),original=admission.rows.get(key)!;admission.rows.set(key,original);expect(()=>admission.rows.set(key,{...original,digest:'b'.repeat(64)})).toThrow('library_sync_dependency_corrupt');
  const prior=admission.retainedMetadataBytes!();reject=true;admission.rows.set(dependencyRowId('settings','late'),{...original,key:'late'});expect(()=>admission.flush!()).toThrow('budget rejected');
  expect(f.raw.selectValue("SELECT records FROM sensa_sync_admission_v1 WHERE scope='candidate:one'")).toBe(1000);expect(admission.retainedMetadataBytes!()).toBe(prior);
  const other=f.dependencies.spoolAdmission('candidate:two');other.rows.set(key,original);other.flush!();f.dependencies.discardAdmission('candidate:one');
  expect(other.rows.size).toBe(1);expect(f.raw.selectValue('SELECT count(*) FROM sensa_records')).toBe(0);expect(f.raw.selectValue('SELECT count(*) FROM sensa_sync_base')).toBe(0);
 }finally{f.close();}
});

test('SQL uniqueness retains Registry and scene ownership checks across batches and preserves storage failures',()=>{
 const f=fixture();try{
  let failed=false;const index=new SqliteRecordValidation(f.raw,()=>{if(failed)throw Error('library_sync_local_changed');});
  for(let i=0;i<1000;i++)expect(index.unique('sense-key','sense-'+i)).toBe(true);
  expect(index.unique('sense-key','sense-0')).toBe(false);expect(index.unique('registry-slot','sense-0')).toBe(true);
  expect(index.sceneOwner('scene','meaning-a')).toBe(true);expect(index.sceneOwner('scene','meaning-a')).toBe(true);expect(index.sceneOwner('scene','meaning-b')).toBe(false);
  failed=true;expect(()=>index.unique('sense-key','late')).toThrow(RecordValidationStorageError);index.close();
  expect(f.raw.selectValue('SELECT count(*) FROM sensa_record_validation_keys')).toBe(0);expect(f.raw.selectValue('SELECT count(*) FROM sensa_record_validation_scenes')).toBe(0);
 }finally{f.close();}
});


test('an existing supported Library reopens without disposable validation tables or source rewrites',()=>{
 const file='/existing-cloud-capacity-'+crypto.randomUUID(),raw=new sqlite.oo1.DB(file,'c'),library=new SqliteRecordDatabase(sqlite,raw,'memory');library.initialize();library.commit({clears:[],deletes:[],puts:[{table:'settings',key:'retained',encodedValue:'["string","owner data"]'}]});
 const index=new SqliteRecordValidation(raw,()=>{});index.close();raw.exec('DROP TABLE sensa_record_validation_keys;DROP TABLE sensa_record_validation_scenes');library.close();
 const reopened=new SqliteRecordDatabase(sqlite,new sqlite.oo1.DB(file,'c'),'memory');try{reopened.initialize();expect(reopened.get('settings','retained')).toBe('["string","owner data"]');expect(reopened.count('settings')).toBe(1);}finally{reopened.close();}
});
