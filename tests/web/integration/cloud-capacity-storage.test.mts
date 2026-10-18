import {test,expect,vi} from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {librarySyncSnapshot,librarySyncCommit,librarySyncBinaryArtifact,librarySyncRecordLimit,librarySyncLogicalByteLimit,librarySyncStageMetadataByteLimit,librarySyncStoredByteLimit} from '@sensa/contracts/sensa';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {SqliteSyncDependencies,dependencyRowId} from '../../../apps/web/src/data/library/sqliteSyncDependencies';
import {SqliteRecordValidation,RecordValidationStorageError} from '../../../apps/web/src/data/library/sqliteRecordValidation';
import {cloudScratchPayloadBytes,cloudScratchDiskBytes,requireCloudScratchSpace} from '../../../apps/web/src/data/library/cloudScratchStorage';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
const sqlite=await sqlite3InitModule();

test('local scratch has a finite disk allowance and refuses unknown or insufficient space before writes',async()=>{
 expect(cloudScratchPayloadBytes).toBe(1536*1024*1024);expect(cloudScratchDiskBytes).toBe(2048*1024*1024);
 await expect(requireCloudScratchSpace(true,async()=>({usageBytes:123,quotaBytes:123+cloudScratchDiskBytes}))).resolves.toBeUndefined();
 await expect(requireCloudScratchSpace(true,async()=>({usageBytes:123,quotaBytes:122+cloudScratchDiskBytes}))).rejects.toThrow('library_sync_capacity');
 await expect(requireCloudScratchSpace(false,async()=>({usageBytes:123,quotaBytes:123+512*1024*1024}))).resolves.toBeUndefined();
 await expect(requireCloudScratchSpace(false,async()=>null)).rejects.toThrow('library_sync_storage_unavailable');
 await expect(requireCloudScratchSpace(false,async()=>({usageBytes:NaN,quotaBytes:2**40}))).rejects.toThrow('library_sync_storage_unavailable');
});

function fixture(){const raw=new sqlite.oo1.DB(':memory:','c'),library=new SqliteRecordDatabase(sqlite,raw,'memory');library.initialize();const dependencies=new SqliteSyncDependencies(raw);dependencies.ensure();return {raw,library,dependencies,close:()=>{dependencies.close();library.close();}};}

test('the OPFS request gate refuses space before replacing a retained pending source and before writing another page',async()=>{
 const f=fixture();try{
  const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString(),schemaVersion:2 as const},owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()},fence={identity,owner,incarnation:'initial',localRevision:0};
  for(const [key,value] of [['identity',identity],['service-owner',owner]] as const)f.raw.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('meta',?,?)",bind:[key,JSON.stringify(encodeBackupValue(value))]});
  for(let i=0;i<128;i++)f.raw.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('settings',?,?)",bind:['sentinel-'+i,'["number",1]']});
  const begun=await f.library.replicaCandidate({kind:'beginPublication',fence});if(begun.kind!=='begun')throw Error('Expected begin');const first=await f.library.replicaCandidate({kind:'publicationPage',id:begun.id,after:null});if(first.kind!=='publicationPage')throw Error('Expected page');
  const before=f.raw.exec({sql:'SELECT * FROM sensa_initial_publication',rowMode:'object',returnValue:'resultRows'}),rows=f.raw.selectValue('SELECT count(*) FROM sensa_initial_publication_rows');
  // Exercise the shipped OPFS admission gate with a deterministic quota read;
  // this in-memory SQL fixture is not an actual physical-disk capacity claim.
  Reflect.set(f.library,'persistence','opfs');vi.stubGlobal('navigator',{storage:{estimate:async()=>({usage:1024,quota:1025})}});
  await expect(f.library.replicaCandidate({kind:'beginPublication',fence})).rejects.toThrow('library_sync_capacity');
  expect(await f.library.replicaCandidate({kind:'publicationPage',id:begun.id,after:null})).toEqual(first);
  await expect(f.library.replicaCandidate({kind:'publicationPage',id:begun.id,after:first.next})).rejects.toThrow('library_sync_capacity');
  expect(f.raw.exec({sql:'SELECT * FROM sensa_initial_publication',rowMode:'object',returnValue:'resultRows'})).toEqual(before);expect(f.raw.selectValue('SELECT count(*) FROM sensa_initial_publication_rows')).toBe(rows);
  vi.stubGlobal('navigator',{storage:{estimate:async()=>{throw Error('quota unavailable');}}});await expect(f.library.replicaCandidate({kind:'beginPublication',fence})).rejects.toThrow('library_sync_storage_unavailable');expect(f.raw.selectValue('SELECT id FROM sensa_initial_publication')).toBe(begun.id);
 }finally{vi.unstubAllGlobals();f.close();}
});

test('staged cursors accept exactly the finite cloud tier while artifact and page limits stay independent',()=>{
 const snapshot={libraryId:crypto.randomUUID(),learnerId:crypto.randomUUID(),snapshotRevision:1,floor:0,records:librarySyncRecordLimit};
 expect(librarySyncSnapshot.parse(snapshot).records).toBe(600000);expect(librarySyncSnapshot.safeParse({...snapshot,records:600001}).success).toBe(false);
 const input={operationId:crypto.randomUUID(),baseRevision:0,staging:{pages:1,records:600000,digest:'a'.repeat(64)}};
 expect(librarySyncCommit.safeParse(input).success).toBe(true);expect(librarySyncCommit.safeParse({...input,staging:{...input.staging,records:600001}}).success).toBe(false);
 expect(librarySyncBinaryArtifact.shape.byteLength.safeParse(90*1024*1024+1).success).toBe(false);
 expect(librarySyncLogicalByteLimit).toBe(1024*1024*1024);expect(librarySyncStageMetadataByteLimit).toBe(128*1024*1024);
 expect(librarySyncStoredByteLimit).toBe(1024*1024*1024);
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

test('a validation-witness disk rejection rolls back its entire batch before COMMIT',()=>{
 const f=fixture();let index:SqliteRecordValidation|undefined;try{index=new SqliteRecordValidation(f.raw,()=>{},()=>{expect(f.raw.selectValue('SELECT count(*) FROM sensa_record_validation_keys')).toBe(64);throw Error('library_sync_capacity');});for(let i=0;i<63;i++)expect(index.unique('sense-key','key-'+i)).toBe(true);expect(()=>index!.unique('sense-key','key-63')).toThrow(RecordValidationStorageError);expect(f.raw.selectValue('SELECT count(*) FROM sensa_record_validation_keys')).toBe(0);expect(f.raw.selectValue('SELECT count(*) FROM sensa_records')).toBe(0);}finally{index?.close();f.close();}
});


test('an existing supported Library reopens without disposable validation tables or source rewrites',()=>{
 const file='/existing-cloud-capacity-'+crypto.randomUUID(),raw=new sqlite.oo1.DB(file,'c'),library=new SqliteRecordDatabase(sqlite,raw,'memory');library.initialize();library.commit({clears:[],deletes:[],puts:[{table:'settings',key:'retained',encodedValue:'["string","owner data"]'}]});
 const index=new SqliteRecordValidation(raw,()=>{});index.close();raw.exec('DROP TABLE sensa_record_validation_keys;DROP TABLE sensa_record_validation_scenes');library.close();
 const reopened=new SqliteRecordDatabase(sqlite,new sqlite.oo1.DB(file,'c'),'memory');try{reopened.initialize();expect(reopened.get('settings','retained')).toBe('["string","owner data"]');expect(reopened.count('settings')).toBe(1);}finally{reopened.close();}
});
