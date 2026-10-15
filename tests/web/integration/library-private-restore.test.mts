/** Real SQLite/Wasm private restore boundary; HTTP and selection are covered
 * separately by the real-browser journey. No saved validation stamp is trusted. */
import {test,expect} from 'vitest';
import {observeReplicaWork} from '../../../apps/web/src/data/library/replicaWork';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {SqliteSyncDependencies} from '../../../apps/web/src/data/library/sqliteSyncDependencies';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {libraryRestoreValidationVersion} from '../../../apps/web/src/data/library/replication/libraryReplicaValidation';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {semanticLookupPayload,syntheticSemanticWorld} from '../support/semanticLookupFixtures';
import {semanticRecords} from '../support/semanticWorldRecordFixture.mts';
import {candidateExpected,candidateBlocksFor} from '../support/replicaCandidateFixture.mts';
import type {ReplicaCandidateRecord} from '../../../apps/web/src/data/library/replicaCandidateProtocol';
const sqlite=await sqlite3InitModule(),encoded=(value:unknown)=>JSON.stringify(encodeBackupValue(value));
const repository=new MemoryJourneyRepository();await createJourneyModules({repository,clock:createSeededClock('2026-10-03T00:00:00Z')}).semanticIntake.submit(semanticLookupPayload());const seed=await repository.load();
async function fixture(privateOnly=true,count=8){
 const filename='/restore-'+crypto.randomUUID()+'.db',raw=new sqlite.oo1.DB(filename,'c'),db=new SqliteRecordDatabase(sqlite,raw,'memory',undefined,privateOnly);db.initialize();
 const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString(),schemaVersion:2 as const},remote={...identity,deviceId:crypto.randomUUID()},owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()},incarnation=crypto.randomUUID();
 db.commit({clears:[],deletes:[],puts:Object.entries({'identity':identity,'service-owner':owner,'local-incarnation':incarnation,'local-content-revision':0}).map(([key,value])=>({table:'meta',key,encodedValue:encoded(value)}))});
 const records:ReplicaCandidateRecord[]=[{table:'meta',key:'identity',valueJson:encoded(remote),blockRefs:[]},...[...semanticRecords(syntheticSemanticWorld(seed,count))].map(row=>({...row,valueJson:encoded(row.value),blockRefs:[]}))];
 const expected=candidateExpected(records,remote),begin=await db.replicaCandidate({kind:'begin',fence:{identity,owner,incarnation,localRevision:0},expected});if(begin.kind!=='begun')throw Error('begin');
 for(let at=0;at<records.length;at+=64){const page=records.slice(at,at+64);await db.replicaCandidate({kind:'append',id:begin.id,records:page,blocks:candidateBlocksFor(page)});}
 const validation=await db.replicaCandidate({kind:'validate',id:begin.id});if(validation.kind!=='validated')throw Error('validate');
 const state={owner,incarnation,revision:expected.head.revision,checkpointVersion:7,restoreValidationVersion:libraryRestoreValidationVersion,syncedLocalRevision:1,status:'synced',restoreOperationId:begin.id};
 const mutation={clears:[],deletes:[],puts:[{table:'meta' as const,key:'cloud-sync',encodedValue:encoded(state)},{table:'meta' as const,key:'local-content-revision',encodedValue:encoded(1)}],contentRevision:1,replicaCandidateRestore:{id:begin.id,tables:validation.candidate.tables}};
 const rows=(sql:string)=>raw.exec({sql,rowMode:'object',returnValue:'resultRows'}) as any[];
 return {raw,db,filename,records,identity,owner,incarnation,mutation,rows,close:()=>db.close(false)};
}

test('private pages install exact nonempty facts/refs and projections, then persist a fully admitted checkpoint',async()=>{
 const f=await fixture();let reopened:SqliteRecordDatabase|undefined;try{
  let progress=0,sawPartial=false,inTransaction=false;const exec=f.raw.exec.bind(f.raw);
  f.raw.exec=((input:any)=>{const sql=typeof input==='string'?input:input.sql;if(sql==='BEGIN IMMEDIATE')inTransaction=true;const result=exec(input);if(sql==='COMMIT'||sql==='ROLLBACK')inTransaction=false;return result;}) as typeof f.raw.exec;
  // Progress is always outside native transactions; no active state exists
  // while any private source or derived projection is incomplete.
  await f.db.installPrivateRestore(f.mutation,p=>{expect(inTransaction).toBe(false);expect(p.completed).toBeGreaterThan(progress);progress=p.completed;
   if(f.db.count('semanticMeanings')>0&&f.db.get('meta','cloud-sync')===null)sawPartial=true;
  });f.raw.exec=exec;
  expect(sawPartial).toBe(true);expect(progress).toBeGreaterThan(f.records.length);
  expect(f.db.syncBaseEntries().map(({table,key,valueJson,blockRefs})=>({table,key,valueJson,blockRefs})).sort((a,b)=>JSON.stringify([a.table,a.key]).localeCompare(JSON.stringify([b.table,b.key])))).toEqual(f.records.map(({table,key,valueJson,blockRefs})=>({table,key,valueJson,blockRefs})).sort((a,b)=>JSON.stringify([a.table,a.key]).localeCompare(JSON.stringify([b.table,b.key]))));
  for(const row of f.records){const value=decodeBackupValue(JSON.parse(f.db.get(row.table,row.key)!));expect(value).toEqual(row.table==='meta'?{...decodeBackupValue(JSON.parse(row.valueJson)),deviceId:f.identity.deviceId}:decodeBackupValue(JSON.parse(row.valueJson)));}
  const projectionTables=['sensa_meaning_lookup_documents','sensa_world_browse','sensa_practice_expressions','sensa_journey_identities'];const counts=projectionTables.map(table=>Number(f.raw.selectValue(`SELECT count(*) FROM ${table}`)));expect(counts.every(count=>count>0)).toBe(true);
  for(const table of ['sensa_replica_candidates_v1','sensa_replica_candidate_records_v1','sensa_sync_admission_v1'])expect(Number(f.raw.selectValue(`SELECT count(*) FROM ${table}`))).toBe(0);
  expect(f.rows("SELECT name FROM sqlite_schema WHERE name='sensa_private_restore_pending_v1'")).toEqual([]);
  const dependencies=new SqliteSyncDependencies(f.raw);expect(dependencies.certificate()?.records).toBe(f.records.length);dependencies.close();
  const base=f.db.syncBaseEntries();f.close();const raw=new sqlite.oo1.DB(f.filename,'w');reopened=new SqliteRecordDatabase(sqlite,raw,'memory');reopened.initialize();expect(reopened.syncBaseEntries()).toEqual(base);expect(projectionTables.map(table=>Number(raw.selectValue(`SELECT count(*) FROM ${table}`)))).toEqual(counts);expect(new SqliteSyncDependencies(raw).certificate()?.records).toBe(f.records.length);
 }finally{reopened?.close(false);if(!reopened)f.close();}
});

test('active-library connections cannot invoke the private installer',async()=>{const f=await fixture(false,1);try{const before=f.db.syncBaseEntries();expect(()=>f.db.installPrivateRestore(f.mutation)).toThrow('sqlite_private_restore_boundary');expect(f.db.syncBaseEntries()).toEqual(before);}finally{f.close();}});

for(const mutation of ['candidate','fact','rolled-back-fact','baseline','owner','dependency','schema'] as const)test(`private installer expires on intervening ${mutation} work`,async()=>{
 const f=await fixture();try{let injected=false;
  await expect(f.db.installPrivateRestore(f.mutation,()=>{if(injected||f.db.count('semanticMeanings')===0)return;injected=true;
   if(mutation==='candidate')f.raw.exec("UPDATE sensa_replica_candidate_records_v1 SET refs_json='[]' WHERE table_name='meta'");
   if(mutation==='fact'||mutation==='rolled-back-fact'){if(mutation==='rolled-back-fact')f.raw.exec('BEGIN');f.raw.exec("UPDATE sensa_records SET value_json='[\"string\",\"changed\"]' WHERE table_name='meta' AND record_key='local-content-revision'");if(mutation==='rolled-back-fact')f.raw.exec('ROLLBACK');}
   if(mutation==='baseline')f.raw.exec("UPDATE sensa_sync_base SET block_refs_json='[]'");
   if(mutation==='owner')f.raw.exec({sql:"UPDATE sensa_records SET value_json=? WHERE table_name='meta' AND record_key='service-owner'",bind:[encoded({subject:crypto.randomUUID(),accountId:crypto.randomUUID()})]});
   if(mutation==='dependency')f.raw.exec('UPDATE sensa_sync_dependency_state_v1 SET epoch=epoch+1');
   if(mutation==='schema')f.raw.exec('CREATE TABLE unrelated_change(id)');
  })).rejects.toThrow();expect(injected).toBe(true);expect(f.db.get('meta','cloud-sync')).toBeNull();expect(f.rows("SELECT name FROM sqlite_schema WHERE name='sensa_private_restore_pending_v1'")).toHaveLength(1);
 }finally{f.close();}
});

test('cancelled private pages refuse cold opening; a new generation can retry complete admission',async()=>{
 const f=await fixture();try{await expect(f.db.installPrivateRestore(f.mutation,()=>{if(f.db.count('semanticMeanings'))f.db.cancelPrivateRestore();})).rejects.toThrow('library_sync_cancelled');expect(f.db.get('meta','cloud-sync')).toBeNull();f.close();const raw=new sqlite.oo1.DB(f.filename,'w'),cold=new SqliteRecordDatabase(sqlite,raw,'memory');try{expect(()=>cold.initialize()).toThrow('sqlite_private_restore_incomplete');}finally{cold.close(false);}}finally{f.close();}
 const retry=await fixture();try{await retry.db.installPrivateRestore(retry.mutation);expect(retry.db.count('semanticMeanings')).toBe(8);}finally{retry.close();}
});

test('a final state write failure rolls back the receipt and leaves the generation unopenable',async()=>{
 const f=await fixture();const prepare=f.raw.prepare.bind(f.raw);try{let failed=false;f.raw.prepare=((sql:any)=>{const statement=prepare(sql),step=statement.step.bind(statement);statement.step=(()=>{if(!failed&&String(sql).startsWith('INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,?) ON CONFLICT')){failed=true;throw Error('final interruption');}return step();}) as typeof statement.step;return statement;}) as typeof f.raw.prepare;
 await expect(f.db.installPrivateRestore(f.mutation)).rejects.toThrow('final interruption');expect(failed).toBe(true);expect(f.db.get('meta','cloud-sync')).toBeNull();expect(decodeBackupValue(JSON.parse(f.db.get('meta','local-content-revision')!))).toBe(0);expect(f.db.count('operations')).toBe(0);expect(f.db.count('semanticMeanings')).toBe(8);expect(f.rows("SELECT name FROM sqlite_schema WHERE name='sensa_private_restore_pending_v1'")).toHaveLength(1);
 }finally{f.raw.prepare=prepare;f.close();}
});

test('missing private admission metadata cannot certify a truncated candidate',async()=>{
 const f=await fixture();try{f.raw.exec("DELETE FROM sensa_sync_admission_rows_v1 WHERE table_name='meta' AND record_key='identity'");await expect(f.db.installPrivateRestore(f.mutation)).rejects.toThrow('library_sync_candidate_invalid');expect(decodeBackupValue(JSON.parse(f.db.get('meta','identity')!))).toEqual(f.identity);expect(decodeBackupValue(JSON.parse(f.db.get('meta','local-content-revision')!))).toBe(0);expect(f.db.get('meta','cloud-sync')).toBeNull();expect(f.rows("SELECT name FROM sqlite_schema WHERE name='sensa_private_restore_pending_v1'")).toHaveLength(1);}finally{f.close();}
});


test('one read-only component shares input work while each projector receives an independent object',async()=>{
 const f=await fixture(),row=f.records.find(row=>row.table==='semanticMeanings')!;let reader:any,checked=false;
 const projector=Reflect.get(f.db,'meaningLookup'),rebuild=projector.rebuildPages.bind(projector);
 projector.rebuildPages=function*(...args:any[]){for(const count of rebuild(...args)){if(count>0&&!checked){checked=true;reader=Reflect.get(f.db,'snapshotReader');const first=reader.get(row.table,row.key),second=reader.get(row.table,row.key);expect(first).not.toBe(second);expect(first).toEqual(second);first.privateMutation='must not escape';expect(reader.get(row.table,row.key)).toEqual(second);}yield count;}};
 try{await f.db.installPrivateRestore(f.mutation);expect(checked).toBe(true);expect(()=>reader.get(row.table,row.key)).toThrow('sqlite_snapshot_projection_source');expect(decodeBackupValue(JSON.parse(f.db.get(row.table,row.key)!))).toEqual(decodeBackupValue(JSON.parse(row.valueJson)));expect(Number(f.raw.selectValue('SELECT count(*) FROM sensa_world_browse WHERE valid=1'))).toBe(8);}finally{observeReplicaWork(undefined);f.close();}
});

test('a canonical mutation after a populated projection window expires the next component',async()=>{
 const f=await fixture();let ready=false,changed=false;observeReplicaWork(kind=>{if(kind==='restore.projection.0')ready=true;});
 try{await expect(f.db.installPrivateRestore(f.mutation,()=>{if(!ready||changed)return;changed=true;f.raw.exec("UPDATE sensa_records SET value_json='[\"string\",\"changed after cache\"]' WHERE table_name='semanticMeanings'");})).rejects.toThrow('library_sync_local_changed');expect(changed).toBe(true);expect(f.db.get('meta','cloud-sync')).toBeNull();expect(new SqliteSyncDependencies(f.raw).certificate()).toBeUndefined();}finally{observeReplicaWork(undefined);f.close();}
});

test('dependency preparation reports each actual installed index row once',async()=>{
 const f=await fixture(),prepare=SqliteSyncDependencies.prototype.preparePublication;let last=0,dependencyWork=0;
 SqliteSyncDependencies.prototype.preparePublication=async function(...args){const before=last,result=await prepare.apply(this,args);dependencyWork=last-before;return result;};
 try{await f.db.installPrivateRestore(f.mutation,p=>last=p.completed);expect(dependencyWork).toBe(f.records.length);}finally{SqliteSyncDependencies.prototype.preparePublication=prepare;f.close();}
});

test('private scratch retirement removes bounded key/byte batches without touching canonical facts',async()=>{
 const f=await fixture(true,128),candidate=Reflect.get(f.db,'replicaCandidateStore');try{const facts=f.rows('SELECT * FROM sensa_records ORDER BY table_name,record_key'),base=f.db.syncBaseEntries();let batches=0;
  for(;;){const before=Number(f.raw.selectValue('SELECT count(*) FROM sensa_replica_candidate_records_v1'));f.raw.exec('BEGIN IMMEDIATE');const done=candidate.retirePrivateRestore(f.mutation.replicaCandidateRestore.id);f.raw.exec('COMMIT');const after=Number(f.raw.selectValue('SELECT count(*) FROM sensa_replica_candidate_records_v1'));expect(before-after).toBeLessThanOrEqual(512);batches++;if(done)break;expect(batches).toBeLessThan(100);}
  expect(batches).toBeGreaterThan(2);expect(f.rows('SELECT * FROM sensa_records ORDER BY table_name,record_key')).toEqual(facts);expect(f.db.syncBaseEntries()).toEqual(base);
 }finally{f.close();}
});

test('assessment callbacks run after the projection reader releases and cannot hide canonical writes',async()=>{
 const f=await fixture();let changed=false,inTransaction=false;const exec=f.raw.exec.bind(f.raw);
 f.raw.exec=((input:any)=>{const sql=typeof input==='string'?input:input.sql;if(sql==='BEGIN IMMEDIATE')inTransaction=true;const result=exec(input);if(sql==='COMMIT'||sql==='ROLLBACK')inTransaction=false;return result;}) as typeof f.raw.exec;
 observeReplicaWork(kind=>{if(changed||kind!=='restore.projection.0')return;expect(inTransaction).toBe(false);expect(Reflect.get(f.db,'snapshotReader')).toBeUndefined();changed=true;f.raw.exec("UPDATE sensa_records SET value_json='[\"string\",\"observer change\"]' WHERE table_name='semanticMeanings'");});
 try{await expect(f.db.installPrivateRestore(f.mutation)).rejects.toThrow('library_sync_local_changed');expect(changed).toBe(true);expect(f.db.get('meta','cloud-sync')).toBeNull();expect(new SqliteSyncDependencies(f.raw).certificate()).toBeUndefined();}finally{observeReplicaWork(undefined);f.raw.exec=exec;f.close();}
});

test('dependency statement assessment cannot absorb canonical changes into its batch fence',async()=>{
 const f=await fixture();let changed=false;
 observeReplicaWork(kind=>{if(changed||kind!=='dependency.prepare')return;changed=true;f.raw.exec("UPDATE sensa_records SET value_json='[\"string\",\"dependency observer change\"]' WHERE table_name='semanticMeanings'");});
 try{await expect(f.db.installPrivateRestore(f.mutation)).rejects.toThrow('library_sync_local_changed');expect(changed).toBe(true);expect(f.db.get('meta','cloud-sync')).toBeNull();expect(new SqliteSyncDependencies(f.raw).certificate()).toBeUndefined();}finally{observeReplicaWork(undefined);f.close();}
});
