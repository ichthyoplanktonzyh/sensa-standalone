import assert from 'node:assert/strict';
import {test} from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {sensaPortableLightweightPackageValidatorVersion} from '@sensa/content-validator/portable-lightweight';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {preparePublishedBook} from '../../../apps/web/src/contentSupply/portable/portablePreparation.ts';
import {createPackageCacheSummary,createPackagePublicationIdentity} from '../../../apps/web/src/data/library/packageCacheProjection.ts';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase.ts';
import {sqliteLibrarySchema} from '../../../apps/web/src/data/library/sqliteProtocol.ts';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec.ts';
import type {InstalledPackage} from '../../../apps/web/src/data/library/packageRecords.ts';

const sqlite3=await sqlite3InitModule();
const fixture=portableBookDeliveryFixture({memberExpressions:['borrow','water','drink']});
const records:InstalledPackage[]=preparePublishedBook(fixture.bookBytes,fixture.descriptor).map(item=>({
 key:item.installation.key,digest:item.canonical.archiveDigest,content:item.content,
 installedAt:'2026-09-30T00:00:00.000Z',
 portableOrigin:{format:'sensa-portable-installation-origin-v2',manifest:item.canonical.package,
  archiveDigest:item.canonical.archiveDigest,packageDigest:item.canonical.packageDigest,
  validatorVersion:sensaPortableLightweightPackageValidatorVersion,
  publications:item.publication?[item.publication]:[]},
}));
const encoded=(value:unknown)=>JSON.stringify(encodeBackupValue(value));
const writes=(values:readonly InstalledPackage[])=>values.map(value=>({table:'packageCache' as const,key:value.key,encodedValue:encoded(value)}));

test('SQLite summary projection excludes execution/media and follows atomic cache replacement, deletion and clear',()=>{
 const raw=new sqlite3.oo1.DB(':memory:','c');
 const db=new SqliteRecordDatabase(sqlite3,raw,'memory');
 try{
  db.initialize();
  db.commit({clears:[],deletes:[],puts:writes(records)});
  assert.deepEqual(db.existingRecordKeys('packageCache',[records[0]!.key,'missing',records[0]!.key]),[records[0]!.key]);
  const summaries=db.packageCacheProjection({kind:'summaries'});
  assert.deepEqual(summaries,records.map(createPackageCacheSummary).sort((a,b)=>a.key.localeCompare(b.key)));
  assert.deepEqual(db.packageCacheProjection({kind:'summaries',packageId:records[0]!.portableOrigin.manifest.metadata.packageId}),[createPackageCacheSummary(records[0]!)]);
  assert.deepEqual(db.packageCacheProjection({kind:'summaries',packageId:'missing-package'}),[]);
  const plan=raw.exec({sql:'EXPLAIN QUERY PLAN SELECT summary_json FROM sensa_package_cache_projection WHERE package_key>=? AND package_key<?',bind:['a','b'],rowMode:'object',returnValue:'resultRows'}) as {detail:string}[];
  assert(plan.some(row=>/SEARCH.*INDEX/u.test(row.detail)),'a single-package preview must use a bounded index range, not scan the inventory');
  assert(!JSON.stringify(summaries).includes('data:audio/'),'inventory must not transport Runtime media');
  assert(summaries.every(value=>!('resources' in value.content)&&!('assurance' in value.content)));
  assert.equal(summaries.flatMap(value=>value.content.entries).length,3);
  assert.deepEqual(db.packageCacheProjection({kind:'publication_identities'}),records.map(createPackagePublicationIdentity).sort((a,b)=>a.key.localeCompare(b.key)));
  assert.deepEqual(db.packageCacheProjection({kind:'route_counts'}),[{
   targetLanguage:records[0]!.content.targetLanguage,supportLanguage:records[0]!.content.supportLanguage,packageCount:3,
  }]);
  const changed={...records[0]!,digest:'a'.repeat(64)};
  db.commit({clears:[],deletes:[],puts:writes([changed])});
  assert.equal(db.packageCacheProjection({kind:'identities'}).find(value=>value.key===changed.key)?.digest,changed.digest);
  const before=db.packageCacheProjection({kind:'summaries'});
  assert.throws(()=>db.commit({clears:[],deletes:[],puts:[...writes([{...changed,digest:'b'.repeat(64)}]),
   {table:'drafts',key:'',encodedValue:encoded({invalid:'key'})}]}));
  assert.deepEqual(db.packageCacheProjection({kind:'summaries'}),before,'failed final write must roll back the derived projection too');
  db.commit({clears:[],deletes:[{table:'packageCache',key:records[0]!.key}],puts:[]});
  assert.equal(db.packageCacheProjection({kind:'identities'}).length,2);
  assert.equal(db.packageCacheProjection({kind:'route_counts'})[0]!.packageCount,2);
  db.commit({clears:['packageCache'],deletes:[],puts:writes([records[0]!])});
  assert.deepEqual(db.packageCacheProjection({kind:'identities'}),[{key:records[0]!.key,digest:records[0]!.digest}]);
 }finally{db.close();}
});

test('repeated initialization validates the same open SQLite connection only once',()=>{
 const raw=new sqlite3.oo1.DB(':memory:','c');
 const original=raw.exec.bind(raw);
 let checks=0;
 raw.exec=((...args:unknown[])=>{
  const input=args[0];
  const sql=typeof input==='string'?input:(input as {sql?:string})?.sql;
  if(sql?.includes('quick_check'))checks++;
  return (original as (...args:unknown[])=>unknown)(...args);
 }) as typeof raw.exec;
 const db=new SqliteRecordDatabase(sqlite3,raw,'memory');
 try{
  assert.deepEqual(db.initialize(),db.initialize());
  assert.equal(checks,1,'leader election and follower initialization must share the validated connection');
 }finally{db.close();}
 assert.throws(()=>db.initialize(),/sqlite_database_closed/u);
});

test('a current library with a missing source table fails without recreating an empty table or losing other records',()=>{
 const raw=new sqlite3.oo1.DB(':memory:','c');
 new SqliteRecordDatabase(sqlite3,raw,'memory').initialize();
 raw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)',bind:['meta','owner-proof',encoded({preserve:true})]});
 raw.exec('DROP TABLE sensa_record_tombstones');
 const db=new SqliteRecordDatabase(sqlite3,raw,'memory');
 try{
  assert.throws(()=>db.initialize(),/sqlite_source_schema_incomplete/u);
  assert.equal(raw.selectValue("SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='sensa_record_tombstones'"),0);
  assert.equal(db.get('meta','owner-proof'),encoded({preserve:true}));
 }finally{db.close(false);}
});

test('missing fixed query indexes are repaired without replacing source tables or records',()=>{
 const raw=new sqlite3.oo1.DB(':memory:','c');new SqliteRecordDatabase(sqlite3,raw,'memory').initialize();
 raw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)',bind:['meta','owner-proof',encoded({preserve:true})]});
 const missing=['sensa_records_content_revision','sensa_meaning_lookup_gram_document','sensa_world_browse_order','sensa_registry_binding_expression','sensa_package_learning_expression'];
 for(const index of missing)raw.exec(`DROP INDEX ${index}`);
 const db=new SqliteRecordDatabase(sqlite3,raw,'memory');
 try{
  assert.equal(db.initialize().integrityCheck?.status,'ok');
  for(const index of missing)assert.equal(raw.selectValue("SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name=?",[index]),1);
  assert.equal(db.get('meta','owner-proof'),encoded({preserve:true}));
 }finally{db.close();}
});

test('existing-schema open avoids a full scan; explicit diagnostics detect corruption and preserve the source',()=>{
 const raw=new sqlite3.oo1.DB(':memory:','c');
 // A current database includes every worker-owned derived schema. Creating a
 // newly introduced index is a structure change and correctly requires one
 // health scan; this case specifically exercises the unchanged reopen path.
 new SqliteRecordDatabase(sqlite3,raw,'memory').initialize();
 const original=raw.exec.bind(raw);
 let checks=0;
 raw.exec=((...args:unknown[])=>{
  const input=args[0],sql=typeof input==='string'?input:(input as {sql?:string})?.sql;
  if(sql?.includes('quick_check'))checks++;
  return (original as (...args:unknown[])=>unknown)(...args);
 }) as typeof raw.exec;
 const db=new SqliteRecordDatabase(sqlite3,raw,'memory');
 try{
  db.initialize();assert.equal(checks,0);
  assert.equal(db.diagnostics({verifyIntegrity:true}).integrityCheck?.status,'ok');
  assert.equal(checks,1);
  raw.exec("PRAGMA ignore_check_constraints=ON; INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('drafts','corrupt-fixture','invalid-json'); PRAGMA ignore_check_constraints=OFF");
  assert.throws(()=>db.diagnostics({verifyIntegrity:true}),/sqlite_integrity_failed/u);
  assert.equal(db.get('drafts','corrupt-fixture'),'invalid-json','a failed health check must not erase the original file');
  assert.throws(()=>db.commit({clears:[],deletes:[],puts:[{table:'meta',key:'after-failure',encodedValue:encoded(true)}]}),/sqlite_integrity_failed/u);
 }finally{db.close(false);}
});

test('the derived index is rebuilt from the current cache without changing source records or owner facts',()=>{
 const raw=new sqlite3.oo1.DB(':memory:','c');
 const db=new SqliteRecordDatabase(sqlite3,raw,'memory');
 raw.exec(sqliteLibrarySchema);
 raw.exec('DROP TABLE sensa_package_cache_projection; PRAGMA user_version=12');
 for(const value of records)raw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)',bind:['packageCache',value.key,encoded(value)]});
 raw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json) VALUES(?,?,?)',bind:['meta','owner-proof',encoded({value:'preserve-me'})]});
 try{
  assert.equal(db.initialize().schemaVersion,14);
  assert.equal(db.packageCacheProjection({kind:'identities'}).length,3);
  for(const value of records)assert.equal(db.get('packageCache',value.key),encoded(value));
  assert.equal(db.get('meta','owner-proof'),encoded({value:'preserve-me'}));
 }finally{db.close();}
});
