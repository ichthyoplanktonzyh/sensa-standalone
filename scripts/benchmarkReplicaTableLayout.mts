/** Provider-free physical-layout comparison using the actual record/table
 * definitions. In-memory page geometry is NOT OPFS latency or crash evidence. */
import assert from 'node:assert/strict';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {MemoryJourneyRepository} from '../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../apps/web/src/experience/personalMeaningJourney/ports';
import {semanticLookupPayload,syntheticSemanticWorld} from '../tests/web/support/semanticLookupFixtures';
import {semanticRecords} from '../tests/web/support/semanticWorldRecordFixture.mts';
import {candidateFixture} from '../tests/web/support/replicaCandidateFixture.mts';
import {encodeBackupValue} from '../apps/web/src/data/library/backupCodec';
import {packStoredRecord} from '../apps/web/src/data/library/sharedRecordContent';
import {sqliteLibrarySchema} from '../apps/web/src/data/library/sqliteProtocol';
import {replicaCandidateSchema,type ReplicaCandidateRecord} from '../apps/web/src/data/library/replicaCandidateProtocol';

const repository=new MemoryJourneyRepository();
await createJourneyModules({repository,clock:createSeededClock('2026-10-03T00:00:00Z')}).semanticIntake.submit(semanticLookupPayload());
const id=crypto.randomUUID(),identity={id,learnerId:crypto.randomUUID(),deviceId:id,createdAt:'2026-10-03T00:00:00.000Z',schemaVersion:2 as const};
const records:ReplicaCandidateRecord[]=[{table:'meta',key:'identity',valueJson:JSON.stringify(encodeBackupValue(identity)),blockRefs:[]},
 ...[...semanticRecords(syntheticSemanticWorld(await repository.load(),1000))].map(row=>({...row,valueJson:JSON.stringify(encodeBackupValue(row.value)),blockRefs:[]}))];
candidateFixture(records,identity);
const definition=(schema:string,table:string)=>{
 const start=schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table}(`),end=schema.indexOf(';',start);
 assert(start>=0&&end>start,`Expected current table definition: ${table}`);
 return schema.slice(start,end+1).replace(/\)\s*(?:WITHOUT\s+ROWID\s*)?;$/iu,') WITHOUT ROWID;');
};
const base=definition(sqliteLibrarySchema,'sensa_sync_base'),candidate=definition(replicaCandidateSchema,'sensa_replica_candidate_records_v1');
const sqlite=await sqlite3InitModule(),database=new sqlite.oo1.DB(':memory:','c');
try{
 database.exec('PRAGMA foreign_keys=ON');database.exec(replicaCandidateSchema);
 database.exec({sql:"INSERT INTO sensa_replica_candidates_v1(id,fence_json,expected_json,state) VALUES(?,'{}','{}','filling')",bind:[id]});
 for(const [table,original,name,rowid] of [['without_base',base,'sensa_sync_base',false],['rowid_base',base,'sensa_sync_base',true],['without_candidate',candidate,'sensa_replica_candidate_records_v1',false],['rowid_candidate',candidate,'sensa_replica_candidate_records_v1',true]] as const){
  const ddl=original.replaceAll(name,table);database.exec(rowid?ddl.replace(') WITHOUT ROWID;',');'):ddl);
 }
 let storedValueBytes=0,referenceBytes=0;database.exec('BEGIN');
 try{
  for(const row of records){
   const value=packStoredRecord(row.valueJson),refs=JSON.stringify(row.blockRefs);
   storedValueBytes+=Buffer.byteLength(value);referenceBytes+=Buffer.byteLength(refs);
   for(const table of ['without_base','rowid_base'])database.exec({sql:`INSERT INTO ${table} VALUES(?,?,?,?)`,bind:[row.table,row.key,value,refs]});
   for(const table of ['without_candidate','rowid_candidate'])database.exec({sql:`INSERT INTO ${table} VALUES(?,?,?,?,?)`,bind:[id,row.table,row.key,value,refs]});
  }
  database.exec('COMMIT');
 }catch(cause){database.exec('ROLLBACK');throw cause;}
 for(const suffix of ['base','candidate']){
  const fields=suffix==='base'?'table_name,record_key,value_json,block_refs_json':'candidate_id,table_name,record_key,value_json,refs_json';
  const rows=(table:string)=>database.exec({sql:`SELECT ${fields} FROM ${table} ORDER BY table_name,record_key`,rowMode:'array',returnValue:'resultRows'});
  assert.deepEqual(rows(`rowid_${suffix}`),rows(`without_${suffix}`));
 }
 const pages=database.exec({sql:"SELECT name,pagetype,count(*) AS pages,sum(pgsize) AS bytes,sum(payload) AS payload_bytes,sum(unused) AS unused_bytes FROM dbstat WHERE name LIKE '%base%' OR name LIKE '%candidate%' GROUP BY name,pagetype ORDER BY name,pagetype",rowMode:'object',returnValue:'resultRows'}) as {name:string;pagetype:string;pages:number;bytes:number;payload_bytes:number;unused_bytes:number}[];
 const layouts=['without_base','rowid_base','without_candidate','rowid_candidate'].map(name=>{
  const table=pages.filter(row=>row.name===name),index=pages.filter(row=>row.name===`sqlite_autoindex_${name}_1`),sum=(rows:typeof pages,field:'bytes'|'unused_bytes')=>rows.reduce((total,row)=>total+row[field],0);
  return {name,tableBytes:sum(table,'bytes'),primaryKeyIndexBytes:sum(index,'bytes'),totalBytes:sum([...table,...index],'bytes'),unusedBytes:sum([...table,...index],'unused_bytes'),overflowPages:table.filter(row=>row.pagetype==='overflow').reduce((total,row)=>total+row.pages,0)};
 });
 console.log(JSON.stringify({fixture:'1000 accepted synthetic Meanings; unique initial Registry; no media/history/corrections',records:records.length,storedValueBytes,referenceBytes,pageSize:database.exec({sql:'PRAGMA page_size',rowMode:0,returnValue:'resultRows'}),layouts,pages,scope:'identical packed values, ordered refs and unique keys; actual DDL with only rowid layout changed. SQLite/Wasm memory page sizes, not OPFS/HTTP/peak resource or account capacity proof',paidCalls:0},null,2));
}finally{database.close();}
