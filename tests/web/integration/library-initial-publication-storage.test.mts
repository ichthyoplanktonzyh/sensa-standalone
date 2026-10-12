import {test,expect} from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {SqliteInitialPublication,initialPublicationKeyPageSql} from '../../../apps/web/src/data/library/sqliteInitialPublication';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {decodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
const sqlite=await sqlite3InitModule();

function fixture(){
 const db=new sqlite.oo1.DB(':memory:','c'),records=new SqliteRecordDatabase(sqlite,db,'memory');records.initialize();
 const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString(),schemaVersion:2 as const},fence={identity,owner:{subject:crypto.randomUUID(),accountId:crypto.randomUUID()},incarnation:crypto.randomUUID(),localRevision:7};
 const get=(table:string,key:string)=>(db.exec({sql:'SELECT value_json FROM sensa_records WHERE table_name=? AND record_key=?',bind:[table,key],rowMode:0,returnValue:'resultRows'}) as string[])[0]??null;
 const publication=new SqliteInitialPublication(db,()=>{},get,()=>{});
 for(let i=0;i<128;i++){const key='draft-'+i.toString().padStart(3,'0'),value=JSON.stringify(encodeBackupValue({id:key,content:{text:'shared immutable source '.repeat(200)},text:'row-'+i}));db.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('drafts',?,?)",bind:[key,value]});}
 const rows=(sql:string)=>db.exec({sql,rowMode:'object',returnValue:'resultRows'}) as any[];
 const close=()=>{publication.close();records.close();};return {db,publication,fence,rows,close};
}

test('fixed-table paging uses both index bounds and counters count only new unique blocks after replay/rollback',()=>{
 const f=fixture();try{
  const plan=f.db.exec({sql:'EXPLAIN QUERY PLAN '+initialPublicationKeyPageSql,bind:['drafts','draft-063'],rowMode:'object',returnValue:'resultRows'}) as any[];
  expect(plan.some(row=>row.detail.includes('table_name=? AND record_key>?'))).toBe(true);expect(plan.some(row=>/SCAN sensa_records|TEMP B-TREE/.test(row.detail))).toBe(false);
  const id=f.publication.begin(f.fence),first=f.publication.page(id,null);expect(first.rows).toHaveLength(64);
  const initial=f.publication.stats(id);expect(f.publication.page(id,null)).toEqual(first);expect(f.publication.stats(id)).toEqual(initial);
  f.db.exec("CREATE TEMP TRIGGER publication_fault BEFORE INSERT ON sensa_initial_publication_rows BEGIN SELECT RAISE(ABORT,'isolated publication fault'); END");
  expect(()=>f.publication.page(id,first.next)).toThrow('isolated publication fault');expect(f.publication.stats(id)).toEqual(initial);
  expect(f.rows('SELECT count(*) AS n FROM sensa_initial_publication_rows')[0].n).toBe(64);f.db.exec('DROP TRIGGER publication_fault');
  const second=f.publication.page(id,first.next);expect(second.rows).toHaveLength(64);expect(second.stats.records).toBe(128);
  const totals=f.rows('SELECT count(*) AS n,sum(plain_bytes) AS plain,sum(stored_bytes) AS stored FROM sensa_initial_publication_blocks')[0];
  expect(second.stats.blocks).toBe(totals.n);expect(second.stats.uniqueBlockPlainBytes).toBe(totals.plain);expect(second.stats.uniqueBlockStoredBytes).toBe(totals.stored);
  const actual=f.rows('SELECT hash,data FROM sensa_initial_publication_blocks');expect(actual.reduce((n,row)=>n+new TextEncoder().encode(decodeLibrarySyncBlock(row.data)).length,0)).toBe(totals.plain);
  const retained=f.rows(`SELECT
   (SELECT sum(length(CAST(id||fence||after_key||state||coalesce(last_page_json,'') AS BLOB))) FROM sensa_initial_publication)+
   (SELECT sum(length(CAST(id||table_name||record_key||value_json||refs_json AS BLOB))) FROM sensa_initial_publication_rows)+
   (SELECT sum(length(CAST(id||hash||data AS BLOB))) FROM sensa_initial_publication_blocks)+
   coalesce((SELECT sum(length(CAST(id||digest||value_json||coalesce(refs_json,'') AS BLOB))) FROM sensa_initial_publication_content),0)+
   coalesce((SELECT sum(length(CAST(id||table_name||record_key||digest AS BLOB))) FROM sensa_initial_publication_owners),0) AS bytes`)[0].bytes;
  expect(second.stats.storedPayloadBytes).toBe(retained);
  expect(second.stats.blocks).toBeLessThan(first.stats.blocks*2);expect(f.publication.page(id,first.next)).toEqual(second);expect(f.publication.stats(id)).toEqual(second.stats);
 }finally{f.close();}
});

test('a stored block payload mismatch rejects the page and leaves the previous page counters unchanged',()=>{
 const f=fixture();try{
  const id=f.publication.begin(f.fence),first=f.publication.page(id,null),prior=f.publication.stats(id);
  // Corrupt one reusable private body; a later page may not silently accept the same address.
  const block=f.rows('SELECT hash FROM sensa_initial_publication_blocks ORDER BY stored_bytes DESC LIMIT 1')[0];f.db.exec({sql:"UPDATE sensa_initial_publication_blocks SET data='different payload' WHERE hash=?",bind:[block.hash]});
  expect(()=>f.publication.page(id,first.next)).toThrow('library_sync_hash');expect(f.publication.stats(id)).toEqual(prior);
 }finally{f.close();}
});

for(const tail of ['exact-64','skip-only','empty'] as const)test(`terminal ${tail} page replays even when its cursor does not advance`,()=>{
 const f=fixture();try{
  f.db.exec("DELETE FROM sensa_records WHERE table_name='drafts'");
  if(tail!=='empty')for(let i=0;i<64;i++)f.db.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('drafts',?,?)",bind:['d-'+i.toString().padStart(3,'0'),JSON.stringify(encodeBackupValue({id:'d-'+i,text:'value'}))]});
  if(tail==='skip-only')f.db.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('meta','zz-private',?)",bind:[JSON.stringify(encodeBackupValue(true))]});
  const id=f.publication.begin(f.fence);let after:any=null,terminal:any;
  for(let i=0;i<10;i++){const page=f.publication.page(id,after);if(page.done){terminal=page;break;}after=page.next;}
  expect(terminal?.done).toBe(true);expect(f.publication.page(id,after)).toEqual(terminal);expect(f.publication.stats(id)).toEqual(terminal.stats);
 }finally{f.close();}
});
