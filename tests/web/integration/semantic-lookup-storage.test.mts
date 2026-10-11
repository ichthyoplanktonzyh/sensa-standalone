import {collectMeaningContexts} from '../../../apps/web/src/experience/personalMeaningJourney/contextRecords';
import {semanticRecords} from '../support/semanticWorldRecordFixture.mts';
/** Actual SQLite/Wasm kernel: committed derivation, privacy, invalidation and rebuild. */
import {test,expect} from 'vitest';
import {registrySelectionSql,type RegistrySelectionQuery} from '../../../apps/web/src/data/library/semanticRegistrySelection';
import init from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase.ts';
import {isFatalSqliteConnectionFailure,sqliteRollbackFailure} from '../../../apps/web/src/data/library/sqliteConnectionFailure';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec.ts';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository.ts';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway.ts';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports.ts';
import type {JourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store.ts';
import type {SqliteMutation} from '../../../apps/web/src/data/library/sqliteProtocol.ts';
import {semanticLookupPayload,advanceSemanticHeads,deleteFirstMeaning} from '../support/semanticLookupFixtures.ts';
import {journeyReservedIdentities} from '../../../apps/web/src/experience/personalMeaningJourney/reservedIdentities';
import {assertPersonalSemanticWorldState} from '../../../apps/web/src/experience/personalMeaningJourney/authority.ts';

const sqlite=await init(),encode=(value:unknown)=>JSON.stringify(encodeBackupValue(value));
function rows(state:JourneyState):SqliteMutation['puts']{return [...semanticRecords(state)].map(row=>({table:row.table,key:row.key,encodedValue:encode(row.value)}));}
async function fixture(append=''){
  const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  const payload=semanticLookupPayload();if(append)payload.context!.textSegment+=' '+append;
  await modules.semanticIntake.submit(payload);return repository.load();
}
test('identity reservation lookup is bounded, excludes opaque prose, retains shared references and rebuilds only its cache',async()=>{
 const raw=new sqlite.oo1.DB(':memory:');let database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const opaque=crypto.randomUUID(),state=await fixture(opaque);
  database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  const meaning=state.meanings[0]!,id=meaning.personalMeaning.personalMeaningId,senseVersion=state.registry.senseVersions[0]!.senseVersionId;
  const reserved=journeyReservedIdentities('semanticMeanings',meaning);
  const get=database.get.bind(database);let reads=0;database.get=(table,key)=>{reads++;return get(table,key);};
  expect(database.existingJourneyIdentities([...reserved,opaque])).toEqual([...reserved].sort());expect(reads).toBe(0);database.get=get;
  expect(()=>database.existingJourneyIdentities(reserved.map(id=>id.toUpperCase()))).toThrow('journey_identity_query_invalid');
  const plan=raw.exec({sql:'EXPLAIN QUERY PLAN SELECT identity_id FROM sensa_journey_identities WHERE identity_id=?',bind:[senseVersion],rowMode:'object',returnValue:'resultRows'}) as {detail:string}[];
  expect(plan.some(row=>row.detail.includes('sensa_journey_identity_lookup'))).toBe(true);
  const source=database.entries('semanticMeanings');raw.exec('DROP TABLE sensa_journey_identity_meta;');
  database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();expect(database.entries('semanticMeanings')).toEqual(source);expect(database.existingJourneyIdentities(reserved)).toEqual([...reserved].sort());
  raw.exec('DROP INDEX sensa_journey_identity_record_key;DROP INDEX sensa_journey_identity_lookup;');
  database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
  expect(raw.selectValue("SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name IN ('sensa_journey_identity_record_key','sensa_journey_identity_lookup')")).toBe(2);
  expect(database.existingJourneyIdentities(reserved)).toEqual([...reserved].sort());
  const versionBytes=Uint8Array.from(Buffer.from(senseVersion.replaceAll('-',''),'hex'));
  raw.exec({sql:'DELETE FROM sensa_journey_identities WHERE identity_id=?',bind:[versionBytes]});
  expect(database.existingJourneyIdentities([senseVersion])).toEqual([]);
  expect(database.diagnostics({verifyIntegrity:true}).journeyIdentityCheck?.status).toBe('rebuilt');
  expect(database.existingJourneyIdentities([senseVersion])).toEqual([senseVersion]);expect(database.entries('semanticMeanings')).toEqual(source);
  expect(database.diagnostics({verifyIntegrity:true}).journeyIdentityCheck?.status).toBe('ok');
  raw.exec({sql:'DELETE FROM sensa_journey_identities WHERE identity_id=?',bind:[versionBytes]});
  raw.exec("CREATE TEMP TRIGGER refuse_identity_repair BEFORE DELETE ON sensa_journey_identities BEGIN SELECT RAISE(ABORT,'fixture-identity-repair-failure'); END;");
  expect(()=>database.diagnostics({verifyIntegrity:true})).toThrow('fixture-identity-repair-failure');
  expect(raw.selectValue('SELECT version FROM sensa_journey_identity_meta WHERE id=1')).toBe(0);
  expect(()=>database.existingJourneyIdentities([senseVersion])).toThrow('journey_identity_cache_invalid');expect(database.entries('semanticMeanings')).toEqual(source);
  raw.exec('DROP TRIGGER refuse_identity_repair;');
  database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
  expect(raw.selectValue('SELECT version FROM sensa_journey_identity_meta WHERE id=1')).toBe(5);expect(database.existingJourneyIdentities([senseVersion])).toEqual([senseVersion]);expect(database.entries('semanticMeanings')).toEqual(source);
  raw.exec({sql:'DELETE FROM sensa_journey_identities WHERE identity_id=?',bind:[versionBytes]});
  raw.exec("CREATE TEMP TRIGGER refuse_identity_marker BEFORE INSERT ON sensa_journey_identity_meta BEGIN SELECT RAISE(ABORT,'fixture-identity-marker-failure'); END;");
  expect(()=>database.diagnostics({verifyIntegrity:true})).toThrow('fixture-identity-marker-failure');
  expect(()=>database.existingJourneyIdentities([senseVersion])).toThrow('journey_identity_cache_invalid');expect(raw.selectValue('SELECT version FROM sensa_journey_identity_meta WHERE id=1')).toBe(5);expect(database.entries('semanticMeanings')).toEqual(source);
  raw.exec('DROP TRIGGER refuse_identity_marker;');
  expect(database.diagnostics({verifyIntegrity:true}).journeyIdentityCheck?.status).toBe('rebuilt');expect(database.existingJourneyIdentities([senseVersion])).toEqual([senseVersion]);
  database.commit({clears:[],deletes:[{table:'semanticMeanings',key:id}],puts:[],contentRevision:2});
  expect(database.existingJourneyIdentities([id,senseVersion])).toEqual([id,senseVersion].sort()); // Retained command receipts still reserve the deleted Meaning's identity.
  database.commit({clears:['semanticRegistry'],deletes:[],puts:[],contentRevision:3});expect(database.existingJourneyIdentities([senseVersion])).toEqual([]);
 }finally{database.close();}
});

test('identity projection failure rolls back source facts, receipts and all other derived indexes',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const state=await fixture();database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  const facts=database.entries('semanticMeanings'),lookup=database.lookupMeanings('borrow'),page=database.worldBrowse({query:'',filter:'all',offset:0,limit:64});
  raw.exec("CREATE TEMP TRIGGER reject_id_reservation BEFORE DELETE ON sensa_journey_identities BEGIN SELECT RAISE(ABORT,'fixture-identity-index-failure'); END;");
  expect(()=>database.commit({clears:[],deletes:[],puts:rows(deleteFirstMeaning(state)).filter(row=>row.table==='semanticMeanings'),contentRevision:2})).toThrow('fixture-identity-index-failure');
  expect(database.entries('semanticMeanings')).toEqual(facts);expect(database.lookupMeanings('borrow')).toEqual(lookup);expect(database.worldBrowse({query:'',filter:'all',offset:0,limit:64})).toEqual(page);
 }finally{database.close();}
});

test('registry selectors use source expression indexes, historical forms and fixed pins without scanning Meaning aggregates',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  expect(database.registrySelection({kind:'ordinal',registryKind:'senses'})).toEqual({keys:[],nextOrdinal:0});
  const state=await fixture();database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  const sense=state.registry.senses[0]!,expression=state.registry.expressions[0]!,version=state.registry.expressionVersions[0]!,binding=state.registry.bindings[0]!,bindingVersion=state.registry.bindingVersions[0]!;
  const cases:Array<{query:RegistrySelectionQuery;keys:string[];index:string}>=[
   {query:{kind:'senseKey',senseKey:sense.senseKey},keys:[`senses:${sense.senseId}`],index:'sensa_registry_sense_key'},
   {query:{kind:'expression',normalizedForm:'borrow',languageTag:'en',expressionType:'word'},keys:[`expressions:${expression.expressionId}`,`expressionVersions:${version.expressionVersionId}`],index:'sensa_registry_expression_form'},
   {query:{kind:'binding',senseId:sense.senseId,expressionId:expression.expressionId,relation:binding.relation},keys:[`bindings:${binding.senseExpressionBindingId}`],index:'sensa_registry_binding_pair'},
   {query:{kind:'bindingVersion',bindingId:binding.senseExpressionBindingId,senseVersionId:bindingVersion.senseVersionId,expressionVersionId:version.expressionVersionId,coverage:bindingVersion.semanticCoverage},keys:[`bindingVersions:${bindingVersion.bindingVersionId}`],index:'sensa_registry_binding_versions'},
   {query:{kind:'ordinal',registryKind:'senses'},keys:[],index:'sensa_registry_kind_ordinal'},
  ];
  for(const {query,keys,index} of cases){
   expect(database.registrySelection(query).keys).toEqual(keys);
   const sql=registrySelectionSql(query),plan=raw.exec({sql:'EXPLAIN QUERY PLAN '+sql.sql,bind:sql.bind as any[],rowMode:'object',returnValue:'resultRows'}) as {detail:string}[];
   expect(plan.some(row=>row.detail.includes(index)),JSON.stringify(plan)).toBe(true);
  }
  expect(database.registrySelection({kind:'ordinal',registryKind:'senses'}).nextOrdinal).toBe(1);
  const advanced=advanceSemanticHeads(state);advanced.registry.expressionVersions.at(-1)!.normalizedForm='borrow-v2';
  database.commit({clears:[],deletes:[],puts:rows(advanced),contentRevision:2});
  expect(database.registrySelection(cases[1]!.query).keys).toEqual(cases[1]!.keys);
  expect(database.registrySelection(cases[3]!.query).keys).toEqual(cases[3]!.keys);
  expect(database.registrySelection({kind:'expression',normalizedForm:'borrow',languageTag:'de',expressionType:'word'}).keys).toEqual([]);
  const source=database.entries('semanticRegistry');raw.exec('DROP INDEX sensa_registry_expression_form;');
  const replacement=new SqliteRecordDatabase(sqlite,raw,'memory');replacement.initialize();
  expect(replacement.registrySelection(cases[1]!.query).keys).toEqual(cases[1]!.keys);expect(replacement.entries('semanticRegistry')).toEqual(source);
  const duplicate={...sense,senseId:crypto.randomUUID()};
  expect(()=>database.commit({clears:[],deletes:[],puts:[{table:'semanticRegistry',key:`senses:${duplicate.senseId}`,encodedValue:encode({kind:'senses',ordinal:2,value:duplicate})}]})).toThrow('UNIQUE');
  expect(database.entries('semanticRegistry')).toEqual(source);
 }finally{database.close();}
});

test('fatal SQLite primary and extended results are distinct from recoverable command failures',()=>{
 for(const resultCode of [10,11,26,10|256,11|512,26|256])expect(isFatalSqliteConnectionFailure(Object.assign(new Error('SQLite failure'),{resultCode}))).toBe(true);
 for(const resultCode of [1,5,6,19,19|256])expect(isFatalSqliteConnectionFailure(Object.assign(new Error('Rejected operation'),{resultCode}))).toBe(false);
 expect(isFatalSqliteConnectionFailure(new Error('sqlite_integrity_failed'))).toBe(true);
 expect(isFatalSqliteConnectionFailure(new Error('fixture-wal-maintenance-failed'))).toBe(false);
 expect(isFatalSqliteConnectionFailure({resultCode:10})).toBe(false);
 const primary=new Error('original command failure'),fatal=Object.assign(new Error('rollback I/O failure'),{resultCode:10});
 const rollback=sqliteRollbackFailure(primary,fatal);
 expect(rollback.message).toBe(primary.message);expect(rollback.errors).toEqual([primary,fatal]);
 expect(isFatalSqliteConnectionFailure(new Error('wrapped',{cause:rollback}))).toBe(true);
 const cycle=new Error('ordinary');Reflect.set(cycle,'cause',cycle);expect(isFatalSqliteConnectionFailure(cycle)).toBe(false);
});

test('post-commit WAL maintenance bounds reopen work and cannot turn a durable commit into a reported failure',()=>{
 // Named Wasm VFS file exercises actual WAL/FULL SQL semantics, not browser
 // OPFS. The real Chromium close/relaunch test covers that physical adapter.
 const path=`/sensa-wal-maintenance-${crypto.randomUUID()}.sqlite3`,raw=new sqlite.oo1.DB(path),database=new SqliteRecordDatabase(sqlite,raw,'opfs');database.initialize();
 const mutation:SqliteMutation={clears:[],deletes:[],puts:Array.from({length:300},(_,index)=>({table:'drafts',key:`wal-test-${index}`,encodedValue:encode({text:'x'.repeat(1024)})})),contentRevision:1};
 try{
  // Initialization also rebuilds device-private caches in a transaction.
  expect(database.diagnostics().walMaintenance?.status).toBe('ok');
  database.commit(mutation);expect(database.diagnostics().walMaintenance?.status).toBe('ok');expect(database.entries('drafts')).toHaveLength(300);
  const exec=raw.exec.bind(raw);raw.exec=((input:any)=>{const sql=typeof input==='string'?input:input.sql;if(sql==='PRAGMA wal_checkpoint(TRUNCATE)')throw new Error('fixture-wal-maintenance-failed');return exec(input);}) as typeof raw.exec;
  expect(()=>database.commit({...mutation,contentRevision:2,puts:mutation.puts.map(row=>({...row,key:'second-'+row.key}))})).not.toThrow();
  expect(database.diagnostics().walMaintenance).toMatchObject({status:'failed',reason:'fixture-wal-maintenance-failed'});expect(database.connectionFailed).toBe(false);expect(database.entries('drafts')).toHaveLength(600);raw.exec=exec;
 }finally{database.close();}
 const reopenRaw=new sqlite.oo1.DB(path),reopened=new SqliteRecordDatabase(sqlite,reopenRaw,'opfs');
 let checkpoints=0;const reopenExec=reopenRaw.exec.bind(reopenRaw);
 reopenRaw.exec=((input:any)=>{const sql=typeof input==='string'?input:input.sql;if(sql==='PRAGMA wal_checkpoint(TRUNCATE)')checkpoints++;return reopenExec(input);}) as typeof reopenRaw.exec;
 reopened.initialize();
 try{
  expect(reopened.entries('drafts')).toHaveLength(600);expect(reopened.diagnostics().synchronous).toBe(2);
  expect(reopened.diagnostics().walMaintenance,'ordinary unchanged open does not checkpoint').toBeUndefined();expect(checkpoints).toBe(0);
  reopened.commit({clears:[],deletes:[],puts:[],syncBaseReplacement:Array.from({length:300},(_,index)=>({table:'drafts',key:`baseline-${index}`,valueJson:encode({text:'baseline'}),blockRefs:[]}))});
  expect(reopened.diagnostics().walMaintenance?.status).toBe('ok');expect(reopened.syncBaseEntries()).toHaveLength(300);expect(checkpoints).toBe(1);
  const bytes=new Uint8Array(2*1024*1024),digest='a'.repeat(64);
  reopened.commit({clears:[],deletes:[],puts:[],portablePackages:[{packageKey:'fixture-large-media',media:[{mediaId:'fixture-audio',sha256:digest,mimeType:'audio/mpeg',kind:'audio',sizeBytes:bytes.byteLength,bytes}]}]});
  expect(reopened.diagnostics().walMaintenance?.status).toBe('ok');expect(reopened.portableMedia(digest)?.sizeBytes).toBe(bytes.byteLength);expect(checkpoints).toBe(2);
 }finally{reopened.close();}
});
test('durable lookup is private, literal/normalized, pinned and current after source/version changes',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const state=await fixture(),puts=rows(state);database.commit({clears:[],deletes:[],puts,contentRevision:1});
  const match=database.lookupMeanings('ＢＯＲＲＯＷ').meanings[0]!;expect(match.senseVersionId).toBe(state.registry.senseVersions[0]!.senseVersionId);
  expect(JSON.stringify(match)).not.toContain('Private source');expect(database.lookupMeanings('May').meanings).toEqual([]);expect(database.lookupMeanings('umbrella').meanings).toEqual([]);
  expect(database.lookupMeanings('临').meanings).toHaveLength(1);expect(database.lookupMeanings('临时').meanings).toHaveLength(1);
  for(const query of ['%','_','" OR borrow'])expect(database.lookupMeanings(query).meanings).toEqual([]);
  const advanced=advanceSemanticHeads(state);database.commit({clears:[],deletes:[],puts:rows(advanced).filter(row=>row.table==='semanticRegistry'),contentRevision:2});
  expect(database.lookupMeanings('borrow').meanings[0]!.senseVersionId).toBe(match.senseVersionId);
  const versionKey=`senseVersions:${match.senseVersionId}`,old=database.get('semanticRegistry',versionKey)!;
  database.commit({clears:[],deletes:[{table:'semanticRegistry',key:versionKey}],puts:[],contentRevision:3});expect(database.lookupMeanings('borrow').meanings).toEqual([]);
  database.commit({clears:[],deletes:[],puts:[{table:'semanticRegistry',key:versionKey,encodedValue:old}],contentRevision:4});expect(database.lookupMeanings('borrow').meanings).toHaveLength(1);
  const encoded=database.get('semanticMeanings',state.meanings[0]!.personalMeaning.personalMeaningId)!;
  const before=database.lookupMeanings('borrow');
  expect(()=>database.commit({clears:[],deletes:[],puts:[...rows(deleteFirstMeaning(advanced)).filter(row=>row.table==='semanticMeanings'),{table:'not-a-table' as never,key:'rejected',encodedValue:'{}'}],contentRevision:5})).toThrow();
  expect(database.lookupMeanings('borrow')).toEqual(before);expect(database.get('semanticMeanings',state.meanings[0]!.personalMeaning.personalMeaningId)).toBe(encoded);
  database.commit({clears:[],deletes:[],puts:rows(deleteFirstMeaning(advanced)).filter(row=>row.table==='semanticMeanings'),contentRevision:6});expect(database.lookupMeanings('borrow').meanings).toEqual([]);
 }finally{database.close();}
});

test('missing derived metadata rebuilds search from unchanged facts; registry key aliases cannot invent a connection',async()=>{
 const raw=new sqlite.oo1.DB(':memory:');let database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const state=await fixture();database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  const facts=database.entries('semanticMeanings');
  raw.exec('DELETE FROM sensa_meaning_lookup_search;DELETE FROM sensa_meaning_lookup_connections;DELETE FROM sensa_meaning_lookup_versions;DELETE FROM sensa_meaning_lookup_meta;');
  database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
  expect(database.lookupMeanings('borrow').meanings).toHaveLength(1);expect(database.lookupMeanings('临').meanings).toHaveLength(1);expect(database.entries('semanticMeanings')).toEqual(facts);
  const key=`senses:${state.registry.senses[0]!.senseId}`;
  database.commit({clears:[],deletes:[],puts:[{table:'semanticRegistry',key,encodedValue:encode({kind:'senses',ordinal:0,value:{...state.registry.senses[0]!,senseId:crypto.randomUUID()}})}],contentRevision:2});
  expect(database.lookupMeanings('borrow').meanings).toEqual([]);
 }finally{database.close();}
});

test('shared version writes retain only changed references instead of rebuilding every sibling document',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const state=await fixture();database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  raw.exec(`CREATE TEMP TABLE document_replacements(kind TEXT);
   CREATE TEMP TRIGGER document_added AFTER INSERT ON sensa_meaning_lookup_documents BEGIN INSERT INTO document_replacements VALUES('insert'); END;
   CREATE TEMP TRIGGER document_removed AFTER DELETE ON sensa_meaning_lookup_documents BEGIN INSERT INTO document_replacements VALUES('delete'); END;`);
  const added:string[]=[];
  const meanings=[state.meanings[0]!];
  const sharedIds=new Set([state.meanings[0]!.personalMeaning.learnerUserId,...(Object.values(state.registry) as Array<Array<object>>).flatMap(items=>items.flatMap(item=>Object.values(item).filter((value):value is string=>typeof value==='string'&&/^[0-9a-f-]{36}$/u.test(value))))]);
  for(let index=0;index<1000;index++){
   // Domain-valid reuse has distinct learner aggregates but exactly the same pinned shared versions.
   const changedIds=new Map<string,string>();
   const cloned=JSON.parse(JSON.stringify(state.meanings[0]!,(_key,value)=>{
    if(typeof value!=='string'||sharedIds.has(value)||!/^[0-9a-f-]{36}$/u.test(value))return value;
    if(!changedIds.has(value))changedIds.set(value,crypto.randomUUID());return changedIds.get(value);
   })) as JourneyState['meanings'][number];
   const id=cloned.personalMeaning.personalMeaningId;added.push(id);meanings.push(cloned);
   database.commit({clears:[],deletes:[],puts:rows({...state,meanings:[cloned],registry:{senses:[],senseVersions:[],expressions:[],expressionVersions:[],bindings:[],bindingVersions:[]},contexts:{anchors:[],anchorRevisions:[],anchorRevisionParents:{}},commandReceipts:[]}),contentRevision:index+2});
  }
  const complete={...state,meanings};collectMeaningContexts(complete);assertPersonalSemanticWorldState(complete);
  expect(raw.selectValue('SELECT COUNT(*) FROM document_replacements')).toBe(0);
  expect(raw.selectValue('SELECT COUNT(*) FROM sensa_meaning_lookup_documents')).toBe(2);
  expect(raw.selectValue('SELECT MIN(reference_count) FROM sensa_meaning_lookup_documents')).toBe(1001);
  expect(raw.selectValue('SELECT MIN(reference_count) FROM sensa_meaning_lookup_expressions')).toBe(1001);
  expect(database.lookupMeanings('borrow').meanings).toHaveLength(1);
  expect(database.lookupMeanings('borrow').meanings[0]!.expressions).toHaveLength(1);
  database.commit({clears:[],deletes:added.map(key=>({table:'semanticMeanings' as const,key})),puts:[],contentRevision:1002});
  expect(raw.selectValue('SELECT COUNT(*) FROM document_replacements')).toBe(0);
  expect(raw.selectValue('SELECT MIN(reference_count) FROM sensa_meaning_lookup_documents')).toBe(1);
  expect(raw.selectValue('SELECT MIN(reference_count) FROM sensa_meaning_lookup_expressions')).toBe(1);
  database.commit({clears:['semanticMeanings','semanticRegistry'],deletes:[],puts:rows(state),contentRevision:1003});
  expect(database.lookupMeanings('borrow').meanings).toHaveLength(1);expect(database.lookupMeanings('临时').meanings).toHaveLength(1);
 }finally{database.close();}
});

test('missing derived table with a current metadata version rebuilds without rewriting source facts',async()=>{
 const raw=new sqlite.oo1.DB(':memory:');let database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const state=await fixture();database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  const facts=database.entries('semanticMeanings'),registry=database.entries('semanticRegistry');
  for(const table of ['search','documents']){
   raw.exec(`DROP TABLE sensa_meaning_lookup_${table}`);
   database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
   expect(database.lookupMeanings('borrow').meanings).toHaveLength(1);expect(database.lookupMeanings('临').meanings).toHaveLength(1);
  }
  expect(database.entries('semanticMeanings')).toEqual(facts);expect(database.entries('semanticRegistry')).toEqual(registry);
 }finally{database.close();}
});

test('retiring short-character posting caches is atomic and preserves facts and literal search',async()=>{
 const raw=new sqlite.oo1.DB(':memory:');let database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const state=await fixture();database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  const facts=database.entries('semanticMeanings'),registry=database.entries('semanticRegistry');
  const terms=['borrow','临','临时','%','_','龘','😀'];
  const before=terms.map(query=>({lookup:database.lookupMeanings(query),world:database.worldBrowse({query,filter:'all',offset:0,limit:20})}));
  // Disposable prior-version cache marker/table, not a fabricated source fact.
  raw.exec(`CREATE TABLE sensa_meaning_lookup_grams(gram TEXT NOT NULL,document_id INTEGER NOT NULL,PRIMARY KEY(gram,document_id)) WITHOUT ROWID;
   CREATE TABLE sensa_world_browse_grams(gram TEXT NOT NULL,document_id INTEGER NOT NULL,PRIMARY KEY(gram,document_id)) WITHOUT ROWID;
   INSERT INTO sensa_meaning_lookup_grams VALUES('临',1);INSERT INTO sensa_world_browse_grams VALUES('临',1);
   UPDATE sensa_meaning_lookup_meta SET version=5;UPDATE sensa_world_browse_meta SET version=14;
   CREATE TEMP TRIGGER fail_cache_rebuild BEFORE INSERT ON sensa_records BEGIN SELECT RAISE(ABORT,'unexpected_source_rewrite'); END;`);
  const exec=raw.exec;
  raw.exec=function(this:typeof raw,...args:Parameters<typeof exec>){
   const input=args[0],sql=typeof input==='string'?input:input.sql;
   if(typeof sql==='string'&&sql.includes('CREATE TABLE IF NOT EXISTS sensa_world_browse('))throw Error('injected_second_projection_failure');
   return Reflect.apply(exec,this,args);
  } as typeof raw.exec;
  try{expect(()=>new SqliteRecordDatabase(sqlite,raw,'memory').initialize()).toThrow('injected_second_projection_failure');}finally{raw.exec=exec;}
  expect(raw.selectValue('SELECT version FROM sensa_meaning_lookup_meta')).toBe(5);expect(raw.selectValue('SELECT version FROM sensa_world_browse_meta')).toBe(14);
  expect(raw.selectValue('SELECT gram FROM sensa_meaning_lookup_grams')).toBe('临');expect(raw.selectValue('SELECT gram FROM sensa_world_browse_grams')).toBe('临');
  expect(database.entries('semanticMeanings')).toEqual(facts);expect(database.entries('semanticRegistry')).toEqual(registry);
  database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
  expect(raw.selectValue("SELECT count(*) FROM sqlite_schema WHERE name IN ('sensa_meaning_lookup_grams','sensa_world_browse_grams')")).toBe(0);
  expect(database.entries('semanticMeanings')).toEqual(facts);expect(database.entries('semanticRegistry')).toEqual(registry);
  expect(terms.map(query=>({lookup:database.lookupMeanings(query),world:database.worldBrowse({query,filter:'all',offset:0,limit:20})}))).toEqual(before);
  raw.exec('DROP TRIGGER fail_cache_rebuild');
 }finally{database.close();}
});

test('short literal SQL queries retain non-BMP, normalized and punctuation matches without reading source bodies',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const state=await fixture();state.registry.senseVersions[0]!.semanticSpec.coreMeaningFocus='😀 ％ ＿ Ａ é " 临时';
  database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  const get=database.get;database.get=()=>{throw Error('query hydrated source body');};
  try{
   for(const term of ['😀','％','%','＿','_','Ａ','a','é','e\u0301','"','临','临时']){
    const result=database.lookupMeanings(term);expect(result.meanings.map(row=>row.senseVersionId),term).toEqual([state.registry.senseVersions[0]!.senseVersionId]);expect(result.truncated).toBe(false);
    expect(database.worldBrowse({query:term,filter:'all',offset:0,limit:20}).total,term).toBe(1);
   }
   for(const term of ['龘','😁']){expect(database.lookupMeanings(term).meanings).toEqual([]);expect(database.worldBrowse({query:term,filter:'all',offset:0,limit:20}).total).toBe(0);}
  }finally{database.get=get;}
 }finally{database.close();}
});

test('a failure inside derived-index maintenance rolls back authoritative writes and prior search together',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const state=await fixture();database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  const id=state.meanings[0]!.personalMeaning.personalMeaningId,before=database.get('semanticMeanings',id),query=database.lookupMeanings('borrow'),short=database.lookupMeanings('临');
  raw.exec("CREATE TEMP TRIGGER reject_derived_deletion BEFORE DELETE ON sensa_meaning_lookup_documents BEGIN SELECT RAISE(ABORT,'injected projection failure'); END;");
  expect(()=>database.commit({clears:[],deletes:[{table:'semanticMeanings',key:id}],puts:[],contentRevision:2})).toThrow('injected projection failure');
  expect(database.get('semanticMeanings',id)).toBe(before);expect(database.lookupMeanings('borrow')).toEqual(query);expect(database.lookupMeanings('临')).toEqual(short);
  raw.exec('DROP TRIGGER reject_derived_deletion');
  database.commit({clears:[],deletes:[{table:'semanticMeanings',key:id}],puts:[],contentRevision:2});
  expect(database.lookupMeanings('borrow').meanings).toEqual([]);expect(database.lookupMeanings('临').meanings).toEqual([]);
 }finally{database.close();}
});

test('missing acceptance witnesses, cross-owned revisions and storage-key aliases never become candidates',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const source=await fixture();
  const corruptions:Array<(state:JourneyState)=>void>=[
   state=>{state.meanings[0]!.semanticAcceptances[0]!.personalSemanticAnchorRevisionId=crypto.randomUUID();},
   state=>{state.meanings[0]!.semanticAcceptances[0]!.personalExpressionAnchorRevisionId=crypto.randomUUID();},
   state=>{state.meanings[0]!.bindingConfirmations[0]!.personalExpressionAnchorRevisionId=crypto.randomUUID();},
   state=>{state.meanings[0]!.alignments[0]!.personalMeaningId=crypto.randomUUID();},
   state=>{state.meanings[0]!.personalMeaningRevisions[0]!.personalMeaningId=crypto.randomUUID();},
  ];
  for(const corrupt of corruptions){const state=structuredClone(source);corrupt(state);database.commit({clears:['semanticMeanings','semanticRegistry'],deletes:[],puts:rows(state)});expect(database.lookupMeanings('borrow').meanings).toEqual([]);}
  const puts=rows(source).map(row=>row.table==='semanticMeanings'?{...row,key:crypto.randomUUID()}:row);
  database.commit({clears:['semanticMeanings','semanticRegistry'],deletes:[],puts});expect(database.lookupMeanings('borrow').meanings).toEqual([]);
 }finally{database.close();}
});

test('construction acceptance requires its proposal and owned construction witnesses, not a detached proposal version',async()=>{
 const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
 const draft=await modules.personalMeaningJourney.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'借同伴的雨伞，用后归还。'}]});
 await modules.personalMeaningJourney.completeClarificationDraft({operationId:crypto.randomUUID(),intakeId:draft.intakeId,source:await modules.personalMeaningJourney.captureClarificationSource('intake',draft.intakeId),context:semanticLookupPayload().context!,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:null,
  sense:{proposedSenseKey:'construction-borrow',...semanticLookupPayload().sense!.semanticSpec,unresolvedQuestions:[]},
  expression:{surfaceForm:'borrow',languageTag:'en',expressionType:'word',relation:'realizes',semanticCoverage:'exact'},confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'});
 const source=await repository.load(),raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  database.commit({clears:[],deletes:[],puts:rows(source)});expect(database.lookupMeanings('borrow').meanings).toHaveLength(1);
  for(const field of ['proposals','constructions','proposalVersions'] as const){
   const state=structuredClone(source);state.meanings[0]![field]=[];
   database.commit({clears:['semanticMeanings','semanticRegistry'],deletes:[],puts:rows(state)});
   expect(database.lookupMeanings('borrow').meanings).toEqual([]);
  }
 }finally{database.close();}
});

test('all derived rows exclude learner labels, notes, raw Context and resolution provenance',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const state=await fixture(),revision=state.meanings[0]!.personalMeaningRevisions[0]!;
  revision.displayLabel='secret-owner-label';revision.learnerIntentNote='secret-owner-intent';
  database.commit({clears:[],deletes:[],puts:rows(state)});
  const stored=['versions','connections','dependencies','expressions','documents','search','meta'].map(table=>raw.exec({sql:`SELECT * FROM sensa_meaning_lookup_${table}`,rowMode:'object',returnValue:'resultRows'}));
  const encoded=JSON.stringify(stored);
  for(const privateText of ['secret-owner-label','secret-owner-intent','Private source','umbrella','private-provenance'])expect(encoded).not.toContain(privateText);
 }finally{database.close();}
});
