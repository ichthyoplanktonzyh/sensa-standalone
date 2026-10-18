import {test,expect} from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {libraryRestoreValidationVersion} from '../../../apps/web/src/data/library/replication/libraryReplicaValidation';
import {SqliteSyncDependencies} from '../../../apps/web/src/data/library/sqliteSyncDependencies';
const sqlite=await sqlite3InitModule(),encoded=(value:unknown)=>JSON.stringify(encodeBackupValue(value));
async function fixture(filename=':memory:',count=128,pad=false){
 const raw=new sqlite.oo1.DB(filename,'c'),db=new SqliteRecordDatabase(sqlite,raw,'memory');db.initialize();const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString(),schemaVersion:2 as const},owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()},incarnation='isolated-baseline';
 db.commit({clears:[],deletes:[],puts:[{table:'meta',key:'identity',encodedValue:encoded(identity)},{table:'meta',key:'service-owner',encodedValue:encoded(owner)},{table:'meta',key:'local-incarnation',encodedValue:encoded(incarnation)},{table:'meta',key:'local-content-revision',encodedValue:encoded(7)}]});
 for(let i=0;i<count;i++)raw.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('drafts',?,?)",bind:['draft-'+String(i).padStart(3,'0'),encoded({id:'draft-'+i,text:'captured '+i+(pad?Array.from({length:72},()=>crypto.randomUUID()).join(''):'')})]});
 raw.exec({sql:"INSERT INTO sensa_sync_base VALUES('drafts','old-checkpoint',?,?)",bind:[encoded({id:'old-checkpoint',text:'previous confirmed bytes'}),'["old-ref","old-ref"]']});
 const begun=await db.replicaCandidate({kind:'beginPublication',fence:{identity,owner,incarnation,localRevision:7}});if(begun.kind!=='begun')throw Error('fixture_begin');const refs:any[]=[];let after:any=null;for(;;){const page=await db.replicaCandidate({kind:'publicationPage',id:begun.id,after});if(page.kind!=='publicationPage')throw Error('fixture_page');refs.push(...page.rows);after=page.next;if(page.done)break;}
 await db.replicaCandidate({kind:'admitOwnPublication',id:begun.id,confirmed:true});
 const dependencies=new SqliteSyncDependencies(raw),rows=(sql:string)=>raw.exec({sql,rowMode:'object',returnValue:'resultRows'}) as any[];
 const state={owner,incarnation,revision:1,checkpointVersion:7,restoreValidationVersion:libraryRestoreValidationVersion,syncedLocalRevision:7,status:'synced' as 'synced'|'pending',publicationOperationId:begun.id};
 const mutation=()=>({initialPublication:begun.id,clears:[],deletes:[],puts:[{table:'meta' as const,key:'cloud-sync',encodedValue:encoded(state)}]});
 const facts=()=>rows('SELECT table_name,record_key,value_json,content_revision FROM sensa_records WHERE table_name!=\'meta\' ORDER BY table_name,record_key');
 const base=()=>rows('SELECT table_name,record_key,value_json,block_refs_json FROM sensa_sync_base ORDER BY table_name,record_key');
 const prepare=(progress?:(value:any)=>void)=>db.replicaCandidate({kind:'preparePublication',id:begun.id},progress);
 return {raw,db,id:begun.id,identity,owner,incarnation,refs,dependencies,rows,state,mutation,facts,base,prepare,close:()=>{dependencies.close();db.close(false);}};
}

test('bounded preparation leaves nonempty facts and the old baseline visible; one activation selects exact frozen rows and refs',async()=>{
 const f=await fixture();try{const facts=f.facts(),old=f.base(),generation=f.dependencies.clock().generation;let reads=0;
 await f.prepare(progress=>{expect(progress.phase).toBe('publication-preparation');expect(f.facts()).toEqual(facts);expect(f.base()).toEqual(old);reads++;});expect(reads).toBeGreaterThan(1);expect(f.dependencies.certificate()).toBeUndefined();
 const before=f.dependencies.clock();f.db.commit(f.mutation());expect(f.facts()).toEqual(facts);expect(f.base()).toHaveLength(f.refs.length);expect(f.base().map(row=>({table:row.table_name,key:row.record_key,blocks:JSON.parse(row.block_refs_json)}))).toEqual(f.refs);
 expect(f.dependencies.clock().generation).toBe(generation+1);expect(f.dependencies.clock().epoch).toBe(before.epoch);expect(f.dependencies.certificate()?.records).toBe(f.refs.length);
 // Previously prepared statements target the same active name after DDL.
 expect(f.db.syncBaseEntries([{table:'drafts',key:'draft-001'}])[0]?.valueJson).toBe(encoded({id:'draft-1',text:'captured 1'}));
 const snapshot=f.base();while(true){const step=await f.db.replicaCandidate({kind:'retirePublication',id:f.id});if(step.kind!=='publicationRetired')throw Error('fixture_retire');if(step.done)break;}expect(f.base()).toEqual(snapshot);expect(f.rows('SELECT count(*) AS n FROM sensa_initial_publication_rows')[0].n).toBe(0);expect(f.dependencies.certificate()?.records).toBe(f.refs.length);expect(f.rows("SELECT 1 FROM sqlite_schema WHERE name='sensa_initial_publication_retired_base'")).toHaveLength(0);
 f.raw.exec("UPDATE sensa_sync_base SET block_refs_json='[]' WHERE table_name='drafts' AND record_key='draft-001'");expect(f.dependencies.certificate()).toBeUndefined();expect(f.dependencies.clock().generation).toBe(generation+2);
 }finally{f.close();}
});

test('concurrent source edits survive confirmation and remain pending against the captured baseline',async()=>{
 const f=await fixture();try{let edited=false;await f.prepare(()=>{if(edited)return;edited=true;f.db.commit({clears:[],deletes:[],contentRevision:8,puts:[{table:'drafts',key:'draft-001',encodedValue:encoded({id:'draft-1',text:'new live edit'})},{table:'meta',key:'local-content-revision',encodedValue:encoded(8)}]});});f.state.status='pending';f.db.commit(f.mutation());
 expect(decodeBackupValue(JSON.parse(f.db.get('drafts','draft-001')!)).text).toBe('new live edit');expect(decodeBackupValue(JSON.parse(f.db.syncBaseEntries([{table:'drafts',key:'draft-001'}])[0].valueJson)).text).toBe('captured 1');expect(decodeBackupValue(JSON.parse(f.db.get('meta','cloud-sync')!)).syncedLocalRevision).toBe(7);
 }finally{f.close();}
});

test('explicit preparation cancellation retains facts, nonempty prior baseline and captured source; retry rebuilds safely',async()=>{
 const f=await fixture();try{const before=f.base(),facts=f.facts();let cancelled=false;await expect(f.prepare(()=>{if(!cancelled){cancelled=true;void f.db.replicaCandidate({kind:'cancelPublicationPreparation',id:f.id});}})).rejects.toThrow('library_sync_cancelled');expect(f.base()).toEqual(before);expect(f.facts()).toEqual(facts);expect(f.rows('SELECT (SELECT count(*) FROM sensa_initial_publication_rows)+(SELECT count(*) FROM sensa_initial_publication_baseline) AS n')[0].n).toBe(f.refs.length);
 await f.prepare();f.db.commit(f.mutation());expect(f.base()).toHaveLength(f.refs.length);
 }finally{f.close();}
});

for(const mutation of ['base','source','shadow','dependency','artifact','owner'] as const)test(`preparation rejects intervening ${mutation} mutation without selecting partial rows`,async()=>{
 const f=await fixture();try{const before=f.base();let changed=false;await expect(f.prepare(()=>{if(changed)return;changed=true;
 if(mutation==='base')f.raw.exec({sql:"INSERT INTO sensa_sync_base VALUES('drafts','new-base',?,?)",bind:[encoded({id:'new-base'}),'[]']});
 if(mutation==='source')f.raw.exec("UPDATE sensa_initial_publication_rows SET value_json='[\"object\",[]]' WHERE table_name='drafts' AND record_key='draft-100'");
 if(mutation==='shadow')f.raw.exec("UPDATE sensa_initial_publication_baseline SET block_refs_json='[]'");
 if(mutation==='dependency')f.raw.exec("UPDATE sensa_sync_dependency_state_v1 SET epoch=epoch+1 WHERE id=1");
 if(mutation==='artifact')f.db.commit({clears:[],deletes:[],puts:[{table:'meta',key:'local-artifact-revision',encodedValue:encoded(1)}]});
 if(mutation==='owner')f.db.commit({clears:[],deletes:[],puts:[{table:'meta',key:'service-owner',encodedValue:encoded({subject:crypto.randomUUID(),accountId:crypto.randomUUID()})}]});
 })).rejects.toThrow();expect(f.base().filter(row=>row.record_key==='old-checkpoint')).toEqual(before);expect(f.db.get('meta','cloud-sync')).toBeNull();
 }finally{f.close();}
});

for(const point of ['DROP TRIGGER sensa_sync_base_generation_insert_v1','ALTER TABLE sensa_sync_base RENAME TO','ALTER TABLE sensa_initial_publication_baseline RENAME TO','CREATE TRIGGER IF NOT EXISTS sensa_sync_base_generation_insert_v1',"INSERT INTO sensa_records"] as const)test(`activation rollback preserves the old table and permits retry after ${point}`,async()=>{
 const f=await fixture();try{await f.prepare();const old=f.base(),facts=f.facts(),clock=f.dependencies.clock(),exec=f.raw.exec.bind(f.raw),prepare=f.raw.prepare.bind(f.raw);let injected=false;
 const fail=(sql:string)=>{if(!injected&&sql.startsWith(point)){injected=true;throw Error('isolated activation interruption');}};
 f.raw.exec=((input:any)=>{const result=exec(input);fail(typeof input==='string'?input:input.sql);return result;}) as typeof f.raw.exec;
 // Dependency statements use prepared calls, including DDL.
 f.raw.prepare=((sql:any)=>{const stmt=prepare(sql),step=stmt.step.bind(stmt);stmt.step=(()=>{const result=step();fail(String(sql));return result;}) as typeof stmt.step;return stmt;}) as typeof f.raw.prepare;
 expect(()=>f.db.commit(f.mutation())).toThrow('isolated activation interruption');f.raw.exec=exec as typeof f.raw.exec;f.raw.prepare=prepare as typeof f.raw.prepare;
 expect(injected).toBe(true);expect(f.base()).toEqual(old);expect(f.facts()).toEqual(facts);expect(f.dependencies.clock().generation).toBe(clock.generation);expect(f.rows("SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger' AND name LIKE 'sensa_sync_base_generation_%'")[0].n).toBe(3);
 f.db.commit(f.mutation());expect(f.base()).toHaveLength(f.refs.length);expect(f.dependencies.certificate()?.records).toBe(f.refs.length);
 }finally{f.close();}
});


test('partial transfer persists exact nonempty bytes and ordered refs across a native close and reopen',async()=>{
 const filename='/baseline-reopen-'+crypto.randomUUID()+'.sqlite',f=await fixture(filename);let reopened:SqliteRecordDatabase|undefined;
 try{const old=f.base(),facts=f.facts(),hashes=f.refs[0].blocks;const block=await f.db.replicaCandidate({kind:'publicationBlocks',id:f.id,hashes});
 let cancelled=false;await expect(f.prepare(()=>{if(!cancelled){cancelled=true;void f.db.replicaCandidate({kind:'cancelPublicationPreparation',id:f.id});}})).rejects.toThrow('library_sync_cancelled');
 expect(f.rows('SELECT count(*) n FROM sensa_initial_publication_baseline')[0].n).toBeGreaterThan(0);expect(f.rows('SELECT count(*) n FROM sensa_initial_publication_rows')[0].n).toBeLessThan(f.refs.length);f.close();
 const raw=new sqlite.oo1.DB(filename,'w');reopened=new SqliteRecordDatabase(sqlite,raw,'memory');reopened.initialize();
 expect(raw.exec({sql:'SELECT table_name,record_key,value_json,block_refs_json FROM sensa_sync_base ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'})).toEqual(old);
 const refs:any[]=[];let after:any=null;for(;;){const page=await reopened.replicaCandidate({kind:'publicationIndexPage',id:f.id,after});if(page.kind!=='publicationIndexPage')throw Error('fixture_index');refs.push(...page.rows);after=page.next;if(page.done)break;}expect(refs).toEqual(f.refs);
 expect(await reopened.replicaCandidate({kind:'publicationBlocks',id:f.id,hashes})).toEqual(block);
 await reopened.replicaCandidate({kind:'admitOwnPublication',id:f.id,confirmed:true});await reopened.replicaCandidate({kind:'preparePublication',id:f.id});reopened.commit(f.mutation());
 expect(raw.exec({sql:"SELECT table_name,record_key,value_json,content_revision FROM sensa_records WHERE table_name!='meta' ORDER BY table_name,record_key",rowMode:'object',returnValue:'resultRows'})).toEqual(facts);
 expect(reopened.syncBaseEntries([{table:'drafts',key:'draft-001'}])[0].valueJson).toBe(encoded({id:'draft-1',text:'captured 1'}));
 }finally{reopened?.close(false);f.close();}
});

for(const point of ['during','after'] as const)test(`schema edits ${point} preparation cannot evade row clocks`,async()=>{
 const f=await fixture();try{let changed=false;
 if(point==='during')await expect(f.prepare(()=>{if(changed)return;changed=true;f.raw.exec('DROP TRIGGER sensa_initial_publication_rows_update_epoch');})).rejects.toThrow();
 else{await f.prepare();f.raw.exec('DROP TRIGGER sensa_initial_publication_rows_update_epoch');expect(()=>f.db.commit(f.mutation())).toThrow();}
 expect(f.base().map(r=>r.record_key)).toEqual(['old-checkpoint']);expect(f.db.get('meta','cloud-sync')).toBeNull();
 }finally{f.close();}
});

for(const reference of ['view','trigger'] as const)test(`mixed-case external ${reference} reference blocks baseline rename and rolls back`,async()=>{
 const f=await fixture();try{
 if(reference==='view')f.raw.exec('CREATE VIEW external_baseline AS SELECT * FROM SENSA_SYNC_BASE');
 else f.raw.exec('CREATE TRIGGER external_baseline AFTER INSERT ON sensa_sync_base BEGIN SELECT count(*) FROM SENSA_SYNC_BASE; END');
 await f.prepare();expect(()=>f.db.commit(f.mutation())).toThrow('library_sync_candidate_invalid');expect(f.base()).toHaveLength(1);expect(f.db.get('meta','cloud-sync')).toBeNull();
 }finally{f.close();}
});

test('artifact mutation after complete preparation is fenced at final commit',async()=>{
 const f=await fixture();try{await f.prepare();f.db.commit({clears:[],deletes:[],puts:[{table:'meta',key:'local-artifact-revision',encodedValue:encoded(1)}]});expect(()=>f.db.commit(f.mutation())).toThrow('library_sync_candidate_invalid');expect(f.base()).toHaveLength(1);expect(f.db.get('meta','cloud-sync')).toBeNull();}finally{f.close();}
});

test('transferred source remains a single physical body and refs copy',async()=>{
 const f=await fixture();try{const before=f.rows('SELECT coalesce(sum(length(CAST(value_json AS BLOB))+length(CAST(refs_json AS BLOB))),0) bytes FROM sensa_initial_publication_rows')[0].bytes;await f.prepare();
 const original=f.rows('SELECT coalesce(sum(length(CAST(value_json AS BLOB))+length(CAST(refs_json AS BLOB))),0) bytes FROM sensa_initial_publication_rows')[0].bytes;
 const shadow=f.rows('SELECT sum(length(CAST(value_json AS BLOB))+length(CAST(block_refs_json AS BLOB))) bytes FROM sensa_initial_publication_baseline')[0].bytes;
 expect(original).toBe(0);expect(shadow).toBe(before);expect(f.rows('SELECT source_epoch,authorized_epoch,baseline_records FROM sensa_initial_publication')[0]).toEqual({source_epoch:f.refs.length*2,authorized_epoch:f.refs.length*2,baseline_records:f.refs.length});
 }finally{f.close();}
});

test('unexpected source DML inside our transfer transaction is rolled back rather than adopted into its epoch',async()=>{
 const f=await fixture();try{const frozen=f.rows('SELECT table_name,record_key,value_json,refs_json FROM sensa_initial_publication_rows ORDER BY table_name,record_key');f.raw.exec("CREATE TRIGGER transfer_extra_write AFTER INSERT ON sensa_initial_publication_baseline BEGIN UPDATE sensa_initial_publication_rows SET value_json=value_json WHERE table_name='drafts' AND record_key='draft-001';END");
 await expect(f.prepare()).rejects.toThrow('library_sync_candidate_invalid');expect(f.rows('SELECT table_name,record_key,value_json,refs_json FROM sensa_initial_publication_rows ORDER BY table_name,record_key')).toEqual(frozen);expect(f.rows('SELECT count(*) n FROM sensa_initial_publication_baseline')[0].n).toBe(0);expect(f.base()).toHaveLength(1);expect(f.db.get('meta','cloud-sync')).toBeNull();
 }finally{f.close();}
});

test('cold preparation creates a new validated scope when artifact revision changes between native opens',async()=>{
 const filename='/baseline-artifact-reopen-'+crypto.randomUUID()+'.sqlite',f=await fixture(filename);let reopened:SqliteRecordDatabase|undefined;
 try{let cancelled=false;await expect(f.prepare(()=>{if(cancelled)return;cancelled=true;void f.db.replicaCandidate({kind:'cancelPublicationPreparation',id:f.id});})).rejects.toThrow('library_sync_cancelled');f.close();const raw=new sqlite.oo1.DB(filename,'w');reopened=new SqliteRecordDatabase(sqlite,raw,'memory');reopened.initialize();reopened.commit({clears:[],deletes:[],puts:[{table:'meta',key:'local-artifact-revision',encodedValue:encoded(1)}]});
 // A new handler re-reads every frozen row and rebuilds the entire optional
 // index. No cached prepared/certification result survives the close.
 let observed=0;await reopened.replicaCandidate({kind:'admitOwnPublication',id:f.id,confirmed:true},p=>{observed=p.completed;});expect(observed).toBe(f.refs.length);await reopened.replicaCandidate({kind:'preparePublication',id:f.id});reopened.commit(f.mutation());const dependencies=new SqliteSyncDependencies(raw);try{expect(dependencies.certificate()?.artifactRevision).toBe(1);expect(dependencies.certificate()?.records).toBe(f.refs.length);}finally{dependencies.close();}
 }finally{reopened?.close(false);f.close();}
});

test('cold metadata admission authorizes only the exact newly observed row delta',async()=>{
 const f=await fixture();try{
 // A retained legacy source may have complete frozen bytes without an
 // observer spool. Build that private fixture before its sealed-state fence.
 f.raw.exec("UPDATE sensa_initial_publication SET state='filling';DELETE FROM sensa_sync_admission_rows_v1;UPDATE sensa_sync_admission_v1 SET records=0,logical_bytes=0,stored_bytes=0,metadata_bytes=0;UPDATE sensa_initial_publication SET state='sealed'");
 Reflect.get(f.db,'initialPublication').close();Reflect.set(f.db,'initialPublication',undefined);await f.db.replicaCandidate({kind:'admitOwnPublication',id:f.id,confirmed:true});expect(f.rows('SELECT source_epoch,authorized_epoch FROM sensa_initial_publication')[0]).toEqual({source_epoch:f.refs.length,authorized_epoch:f.refs.length});await f.prepare();f.db.commit(f.mutation());expect(f.base()).toHaveLength(f.refs.length);
 }finally{f.close();}
});

test('mixed remaining/prepared source queries bound both range seeks before merging their key pages',async()=>{
 const f=await fixture();try{let cancelled=false;await expect(f.prepare(()=>{if(cancelled)return;cancelled=true;void f.db.replicaCandidate({kind:'cancelPublicationPreparation',id:f.id});})).rejects.toThrow('library_sync_cancelled');
 const prepare=f.raw.prepare.bind(f.raw),queries:string[]=[];f.raw.prepare=((sql:any)=>{if(String(sql).startsWith('SELECT')&&String(sql).includes('UNION ALL'))queries.push(String(sql));return prepare(sql);}) as typeof f.raw.prepare;
 // New handler avoids reusing a previously prepared statement in the test.
 Reflect.get(f.db,'initialPublication').close();Reflect.set(f.db,'initialPublication',undefined);
 const page=await f.db.replicaCandidate({kind:'publicationIndexPage',id:f.id,after:{table:'drafts',key:'draft-010'}});expect(page.kind).toBe('publicationIndexPage');expect(queries.length).toBeGreaterThan(0);
 const sql=queries.find(q=>q.includes('LIMIT 64'))!,plan=f.raw.exec({sql:'EXPLAIN QUERY PLAN '+sql,bind:[f.id,'drafts','draft-010',f.id,'drafts','draft-010'],rowMode:'object',returnValue:'resultRows'}) as any[];
 expect(plan.filter(row=>/SCAN sensa_initial_publication_rows|SCAN prepared/u.test(row.detail))).toEqual([]);expect(sql.match(/LIMIT 64/gu)).toHaveLength(3);expect(plan.some(row=>/SEARCH sensa_initial_publication_rows/u.test(row.detail))).toBe(true);expect(plan.some(row=>/SEARCH prepared/u.test(row.detail))).toBe(true);
 }finally{f.close();}
});

test('moving populated source rows releases allocated pages within a fixed scratch headroom',async()=>{
 const {cloudScratchAllocatedBytes}=await import('../../../apps/web/src/data/library/cloudScratchStorage'),f=await fixture(':memory:',2048,true);
 try{const allocated=()=>Number(f.raw.selectValue('PRAGMA page_size'))*(Number(f.raw.selectValue('PRAGMA page_count'))-Number(f.raw.selectValue('PRAGMA freelist_count'))),before=allocated(),headroom=2*1024*1024;
 f.raw.exec({sql:'UPDATE sensa_initial_publication SET allocated_baseline=? WHERE id=?',bind:[before-cloudScratchAllocatedBytes+headroom,f.id]});await f.prepare();expect(allocated()).toBeLessThanOrEqual(before+headroom);expect(f.rows('SELECT count(*) n FROM sensa_initial_publication_rows')[0].n).toBe(0);f.db.commit(f.mutation());expect(f.base()).toHaveLength(f.refs.length);
 }finally{f.close();}
});

test('retirement RPC deletes at most 128 rows or one MiB and leaves facts, refs and certificate unchanged',async()=>{
 const f=await fixture();try{await f.prepare();f.db.commit(f.mutation());const facts=f.facts(),base=f.base(),certificate=f.dependencies.certificate();
 for(let i=0;i<4;i++)f.raw.exec({sql:'INSERT INTO sensa_initial_publication_content(id,digest,value_json) VALUES(?,?,?)',bind:[f.id,'retire-body-'+i,'x'.repeat(450000)]});
 for(let i=0;i<3;i++){const before=f.rows('SELECT count(*) n FROM sensa_initial_publication_content')[0].n;const step=await f.db.replicaCandidate({kind:'retirePublication',id:f.id});expect(step).toEqual({kind:'publicationRetired',done:false});const after=f.rows('SELECT count(*) n FROM sensa_initial_publication_content')[0].n;if(before)expect(before-after).toBeLessThanOrEqual(2);expect(f.facts()).toEqual(facts);expect(f.base()).toEqual(base);}
 let calls=0;while(true){const before=f.rows('SELECT count(*) n FROM sensa_sync_admission_rows_v1')[0].n,step=await f.db.replicaCandidate({kind:'retirePublication',id:f.id}),after=f.rows('SELECT count(*) n FROM sensa_sync_admission_rows_v1')[0].n;expect(before-after).toBeLessThanOrEqual(128);if(step.kind!=='publicationRetired')throw Error('fixture_retire');if(step.done)break;if(++calls>32)throw Error('retirement_did_not_converge');}
 expect(f.base()).toEqual(base);expect(f.facts()).toEqual(facts);expect(f.dependencies.certificate()).toEqual(certificate);expect(await f.db.replicaCandidate({kind:'retirePublication',id:f.id})).toEqual({kind:'publicationRetired',done:true});
 }finally{f.close();}
});

for(const change of ['owner','identity','incarnation','publication','pending'] as const)test(`retirement stops before deleting under a changed ${change} fence`,async()=>{
 const f=await fixture();try{await f.prepare();f.db.commit(f.mutation());const before=f.rows('SELECT * FROM sensa_sync_admission_rows_v1');
 const key=change==='owner'?'service-owner':change==='identity'?'identity':change==='incarnation'?'local-incarnation':'cloud-sync';
 const value=change==='owner'?{...f.owner,accountId:crypto.randomUUID()}:change==='identity'?{...f.identity,id:crypto.randomUUID()}:change==='incarnation'?crypto.randomUUID():change==='publication'?{...f.state,publicationOperationId:crypto.randomUUID()}:{...f.state,pending:{operationId:crypto.randomUUID()}};
 f.raw.exec({sql:"UPDATE sensa_records SET value_json=? WHERE table_name='meta' AND record_key=?",bind:[encoded(value),key]});await expect(f.db.replicaCandidate({kind:'retirePublication',id:f.id})).rejects.toThrow();expect(f.rows('SELECT * FROM sensa_sync_admission_rows_v1')).toEqual(before);
 }finally{f.close();}
});

test('confirmed cleanup rolls back a failed batch and resumes after close without reactivating its receipt',async()=>{
 const filename='/baseline-retirement-reopen-'+crypto.randomUUID()+'.sqlite',f=await fixture(filename,256);let reopened:SqliteRecordDatabase|undefined;
 try{await f.prepare();f.db.commit(f.mutation());const base=f.base(),state=f.db.get('meta','cloud-sync'),facts=f.facts();
 // Normal content edits do not change ownership of the retired private source.
 f.db.commit({clears:[],deletes:[],contentRevision:8,puts:[{table:'meta',key:'local-content-revision',encodedValue:encoded(8)}]});
 while(f.rows('SELECT count(*) n FROM sensa_initial_publication_blocks')[0].n)await f.db.replicaCandidate({kind:'retirePublication',id:f.id});const before=f.rows('SELECT * FROM sensa_sync_admission_rows_v1');
 f.raw.exec("CREATE TEMP TRIGGER stop_retirement BEFORE DELETE ON sensa_sync_admission_rows_v1 BEGIN SELECT RAISE(ABORT,'bounded cleanup failure');END");
 await expect(f.db.replicaCandidate({kind:'retirePublication',id:f.id})).rejects.toThrow('bounded cleanup failure');expect(f.rows('SELECT * FROM sensa_sync_admission_rows_v1')).toEqual(before);expect(f.base()).toEqual(base);expect(f.db.get('meta','cloud-sync')).toBe(state);f.close();
 const raw=new sqlite.oo1.DB(filename,'w');reopened=new SqliteRecordDatabase(sqlite,raw,'memory');reopened.initialize();let steps=0;for(;;){const result=await reopened.replicaCandidate({kind:'retirePublication',id:f.id});if(result.kind!=='publicationRetired')throw Error('fixture_retire');if(result.done)break;if(++steps>32)throw Error('retirement_did_not_converge');}
 expect(raw.exec({sql:'SELECT table_name,record_key,value_json,block_refs_json FROM sensa_sync_base ORDER BY table_name,record_key',rowMode:'object',returnValue:'resultRows'})).toEqual(base);expect(reopened.get('meta','cloud-sync')).toBe(state);expect(raw.exec({sql:"SELECT table_name,record_key,value_json,content_revision FROM sensa_records WHERE table_name!='meta' ORDER BY table_name,record_key",rowMode:'object',returnValue:'resultRows'})).toEqual(facts);
 }finally{reopened?.close(false);f.close();}
});

test('retirement stops stepping the length query at one oversized existing row',async()=>{
 const f=await fixture();try{await f.prepare();f.db.commit(f.mutation());for(let i=0;i<3;i++)f.raw.exec({sql:'INSERT INTO sensa_initial_publication_content(id,digest,value_json) VALUES(?,?,?)',bind:[f.id,'retire-large-'+i,'x'.repeat(2*1024*1024)]});
 const prepare=f.raw.prepare.bind(f.raw);let steps=0;f.raw.prepare=((sql:string)=>{const statement=prepare(sql);if(sql.includes('AS bytes FROM main.sensa_initial_publication_content')){const step=statement.step.bind(statement);statement.step=()=>{steps++;return step();};}return statement;}) as typeof f.raw.prepare;
 const step=await f.db.replicaCandidate({kind:'retirePublication',id:f.id});expect(step).toEqual({kind:'publicationRetired',done:false});expect(steps).toBe(1);expect(f.rows('SELECT count(*) n FROM sensa_initial_publication_content')[0].n).toBe(2);f.raw.prepare=prepare as typeof f.raw.prepare;
 }finally{f.close();}
});
