import {test,expect} from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {SqliteInitialPublication,initialPublicationKeyPageSql,initialPublicationIndexAfterSql} from '../../../apps/web/src/data/library/sqliteInitialPublication';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {cloudScratchPayloadBytes,cloudScratchAllocatedBytes} from '../../../apps/web/src/data/library/cloudScratchStorage';
import {decodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
const sqlite=await sqlite3InitModule();

function fixture(check:()=>void=()=>{},owner:()=>void=check){
 const db=new sqlite.oo1.DB(':memory:','c'),records=new SqliteRecordDatabase(sqlite,db,'memory');records.initialize();
 const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString(),schemaVersion:2 as const},fence={identity,owner:{subject:crypto.randomUUID(),accountId:crypto.randomUUID()},incarnation:crypto.randomUUID(),localRevision:7};
 const get=(table:string,key:string)=>(db.exec({sql:'SELECT value_json FROM sensa_records WHERE table_name=? AND record_key=?',bind:[table,key],rowMode:0,returnValue:'resultRows'}) as string[])[0]??null;
 const publication=new SqliteInitialPublication(db,check,get,owner);
 for(let i=0;i<128;i++){const key='draft-'+i.toString().padStart(3,'0'),value=JSON.stringify(encodeBackupValue({id:key,content:{text:'shared immutable source '.repeat(200)},text:'row-'+i}));db.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('drafts',?,?)",bind:[key,value]});}
 const rows=(sql:string)=>db.exec({sql,rowMode:'object',returnValue:'resultRows'}) as any[];
 const close=()=>{publication.close();records.close();};return {db,publication,fence,rows,close};
}

test('fixed-table paging uses both index bounds and counters count only new unique blocks after replay/rollback',async()=>{
 const f=fixture();try{
  const plan=f.db.exec({sql:'EXPLAIN QUERY PLAN '+initialPublicationKeyPageSql,bind:['drafts','draft-063'],rowMode:'object',returnValue:'resultRows'}) as any[];
  expect(plan.some(row=>row.detail.includes('table_name=? AND record_key>?'))).toBe(true);expect(plan.some(row=>/SCAN sensa_records|TEMP B-TREE/.test(row.detail))).toBe(false);
  const id=f.publication.begin(f.fence),first=await f.publication.page(id,null);expect(first.rows).toHaveLength(64);
  const initial=f.publication.stats(id);expect(await f.publication.page(id,null)).toEqual(first);expect(f.publication.stats(id)).toEqual(initial);
  f.db.exec("CREATE TEMP TRIGGER publication_fault BEFORE INSERT ON sensa_initial_publication_rows BEGIN SELECT RAISE(ABORT,'isolated publication fault'); END");
  await expect(f.publication.page(id,first.next)).rejects.toThrow('isolated publication fault');expect(f.publication.stats(id)).toEqual(initial);
  expect(f.rows('SELECT count(*) AS n FROM sensa_initial_publication_rows')[0].n).toBe(64);f.db.exec('DROP TRIGGER publication_fault');
  const second=await f.publication.page(id,first.next);expect(second.rows).toHaveLength(64);expect(second.stats.records).toBe(128);
  const totals=f.rows('SELECT count(*) AS n,sum(plain_bytes) AS plain,sum(stored_bytes) AS stored FROM sensa_initial_publication_blocks')[0];
  expect(second.stats.blocks).toBe(totals.n);expect(second.stats.uniqueBlockPlainBytes).toBe(totals.plain);expect(second.stats.uniqueBlockStoredBytes).toBe(totals.stored);
  const pointers=f.rows('SELECT hash,data,source_json FROM sensa_initial_publication_blocks');expect(pointers.every(row=>row.data===''&&row.source_json)).toBe(true);
  const actual=readBlocks(f.publication,id,pointers.map(row=>row.hash));expect([...actual.values()].reduce((n,data)=>n+new TextEncoder().encode(decodeLibrarySyncBlock(data)).length,0)).toBe(totals.plain);
  const retained=f.rows(`SELECT
   (SELECT sum(length(CAST(id||fence||after_key||state||coalesce(last_page_json,'') AS BLOB))) FROM sensa_initial_publication)+
   (SELECT sum(length(CAST(id||table_name||record_key||value_json||refs_json AS BLOB))) FROM sensa_initial_publication_rows)+
   (SELECT sum(length(CAST(id||hash||data||coalesce(source_json,'') AS BLOB))) FROM sensa_initial_publication_blocks)+
   coalesce((SELECT sum(length(CAST(id||digest||value_json||coalesce(refs_json,'') AS BLOB))) FROM sensa_initial_publication_content),0)+
   coalesce((SELECT sum(length(CAST(id||table_name||record_key||digest AS BLOB))) FROM sensa_initial_publication_owners),0)+
   coalesce((SELECT sum(metadata_bytes) FROM sensa_sync_admission_rows_v1),0) AS bytes`)[0].bytes;
  expect(second.stats.storedPayloadBytes).toBe(retained);
  expect(second.stats.blocks).toBeLessThan(first.stats.blocks*2);expect(await f.publication.page(id,first.next)).toEqual(second);expect(f.publication.stats(id)).toEqual(second.stats);
 }finally{f.close();}
});

test('a stored block payload mismatch rejects the page and leaves the previous page counters unchanged',async()=>{
 const f=fixture();try{
  const id=f.publication.begin(f.fence),first=await f.publication.page(id,null),prior=f.publication.stats(id);
  // Corrupt one reusable private body; a later page may not silently accept the same address.
  const block=f.rows('SELECT hash FROM sensa_initial_publication_blocks ORDER BY stored_bytes DESC LIMIT 1')[0];f.db.exec({sql:"UPDATE sensa_initial_publication_blocks SET source_json=json_set(source_json,'$.start',999999999) WHERE hash=?",bind:[block.hash]});
  await expect(f.publication.page(id,first.next)).rejects.toThrow('library_sync_hash');expect(f.publication.stats(id)).toEqual(prior);
 }finally{f.close();}
});

for(const tail of ['exact-64','skip-only','empty'] as const)test(`terminal ${tail} page replays even when its cursor does not advance`,async()=>{
 const f=fixture();try{
  f.db.exec("DELETE FROM sensa_records WHERE table_name='drafts'");
  if(tail!=='empty')for(let i=0;i<64;i++)f.db.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('drafts',?,?)",bind:['d-'+i.toString().padStart(3,'0'),JSON.stringify(encodeBackupValue({id:'d-'+i,text:'value'}))]});
  if(tail==='skip-only')f.db.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('meta','zz-private',?)",bind:[JSON.stringify(encodeBackupValue(true))]});
  const id=f.publication.begin(f.fence);let after:any=null,terminal:any;
  for(let i=0;i<10;i++){const page=await f.publication.page(id,after);if(page.done){terminal=page;break;}after=page.next;}
  expect(terminal?.done).toBe(true);expect(await f.publication.page(id,after)).toEqual(terminal);expect(f.publication.stats(id)).toEqual(terminal.stats);
 }finally{f.close();}
});

for(const budget of ['records','logical_bytes','stored_bytes'] as const)test(`publication rejects cumulative ${budget} overage atomically and exact replay remains free`,async()=>{
 const measured=fixture();let firstCost:number;
 try{const id=measured.publication.begin(measured.fence),before=Number(measured.rows('SELECT * FROM sensa_initial_publication')[0][budget]);await measured.publication.page(id,null);firstCost=Number(measured.rows('SELECT * FROM sensa_initial_publication')[0][budget])-before;}finally{measured.close();}
 const f=fixture();try{
  const id=f.publication.begin(f.fence),limit=budget==='records'?600000:budget==='logical_bytes'?1024*1024*1024:cloudScratchPayloadBytes;
  f.db.exec({sql:`UPDATE sensa_initial_publication SET ${budget}=? WHERE id=?`,bind:[limit-firstCost,id]});
  const first=await f.publication.page(id,null),prior=f.publication.stats(id),scoped=f.rows('SELECT * FROM sensa_sync_admission_v1');
  expect(await f.publication.page(id,null)).toEqual(first);
  await expect(f.publication.page(id,first.next)).rejects.toThrow('library_sync_capacity');expect(f.publication.stats(id)).toEqual(prior);expect(f.rows('SELECT * FROM sensa_sync_admission_v1')).toEqual(scoped);
  f.publication.discard(id);expect(f.rows('SELECT count(*) AS n FROM sensa_sync_admission_v1')[0].n).toBe(0);expect(f.rows('SELECT count(*) AS n FROM sensa_sync_admission_rows_v1')[0].n).toBe(0);
 }finally{f.close();}
});

const readBlocks=(publication:SqliteInitialPublication,id:string,hashes:string[])=>{
 const found=new Map<string,string>();for(let at=0;at<hashes.length;at+=512){let remaining=hashes.slice(at,at+512);while(remaining.length){const reply=publication.blocks(id,remaining);for(const row of reply.blocks)found.set(row.hash,row.data);remaining=reply.deferred;}}return found;
};

test('sealed metadata pages seek past the indexed tuple and retain every ordered ref',async()=>{
 const f=fixture();try{
  const id=f.publication.begin(f.fence),expected:any[]=[];let after:any=null;
  for(;;){const page=await f.publication.page(id,after);expected.push(...page.rows);after=page.next;if(page.done)break;}
  const plan=f.db.exec({sql:'EXPLAIN QUERY PLAN '+initialPublicationIndexAfterSql,bind:[id,'drafts','draft-063'],rowMode:'object',returnValue:'resultRows'}) as any[];
  expect(plan.some(row=>row.detail.includes('id=? AND (table_name,record_key)>(?,?)'))).toBe(true);expect(plan.some(row=>/SCAN sensa_initial_publication_rows|TEMP B-TREE/.test(row.detail))).toBe(false);
  const actual:any[]=[];after=null;for(;;){const page=f.publication.indexPage(id,after);actual.push(...page.rows);after=page.next;if(page.done)break;}
  expect(actual).toEqual(expected);expect(actual).toHaveLength(128);
 }finally{f.close();}
});

test('frozen fragment pointers rebuild exact bytes after source edits and a new connection owner, retaining duplicate refs',async()=>{
 const f=fixture();let reopened:SqliteInitialPublication|undefined;
 try{
  f.db.exec("DELETE FROM sensa_records WHERE table_name='drafts'");
  const body={text:'界🙂'.repeat(100000)},wire=JSON.stringify(encodeBackupValue({id:'unicode',content:body,definition:body,media:'data:image/png;base64,'+'Ab09'.repeat(100000),tail:'unchanged'}));
  f.db.exec({sql:"INSERT INTO sensa_records(table_name,record_key,value_json) VALUES('drafts','unicode',?)",bind:[wire]});
  const id=f.publication.begin(f.fence);let after:any=null,refs:string[]=[];for(;;){const page=await f.publication.page(id,after);refs.push(...page.rows.flatMap(row=>row.blocks));after=page.next;if(page.done)break;}
  expect(new Set(refs).size).toBeLessThan(refs.length);const hashes=[...new Set(refs)],first=readBlocks(f.publication,id,hashes);
  expect(refs.map(hash=>decodeLibrarySyncBlock(first.get(hash)!)).join('')).toBe(wire);
  expect(f.rows('SELECT sum(length(data)) AS bytes FROM sensa_initial_publication_blocks')[0].bytes).toBe(0);
  f.db.exec("DELETE FROM sensa_records WHERE table_name='drafts'");f.publication.close();
  reopened=new SqliteInitialPublication(f.db,()=>{},()=>{throw Error('Mutable source read');},()=>{});
  expect(readBlocks(reopened,id,hashes)).toEqual(first);expect(readBlocks(reopened,id,hashes)).toEqual(first);
 }finally{reopened?.close();f.close();}
});

for(const column of ['stored_bytes','plain_bytes'] as const)test(`reconstruction rejects corrupted ${column} rather than changing a captured address`,async()=>{
 const f=fixture();try{const id=f.publication.begin(f.fence),page=await f.publication.page(id,null),hash=page.rows[0].blocks[0];f.db.exec({sql:`UPDATE sensa_initial_publication_blocks SET ${column}=${column}+1 WHERE hash=?`,bind:[hash]});expect(()=>f.publication.blocks(id,[hash])).toThrow('library_sync_hash');expect(f.publication.stats(id)).toEqual(page.stats);}finally{f.close();}
});

test('capture failure rolls back the page and sealed reads still recheck account ownership',async()=>{
 let calls=0,deny=false;const f=fixture(()=>{if(++calls===5)throw Error('library_sync_cancelled');},()=>{if(deny)throw Error('account_changed');});
 try{const id=f.publication.begin(f.fence),before=f.publication.stats(id);await expect(f.publication.page(id,null)).rejects.toThrow('library_sync_cancelled');expect(f.publication.stats(id)).toEqual(before);expect(f.rows('SELECT count(*) AS n FROM sensa_initial_publication_blocks')[0].n).toBe(0);let after:any=null,last:any;for(;;){last=await f.publication.page(id,after);after=last.next;if(last.done)break;}deny=true;expect(()=>f.publication.blocks(id,[last.rows[0]?.blocks[0]??f.rows('SELECT hash FROM sensa_initial_publication_blocks LIMIT 1')[0].hash])).toThrow('account_changed');}finally{f.close();}
});

test('the local disk payload tier accepts above the independent 256 MiB cloud quota',async()=>{
 const f=fixture();try{const id=f.publication.begin(f.fence);f.db.exec('UPDATE sensa_initial_publication SET stored_bytes=268435456');const page=await f.publication.page(id,null);expect(page.stats.storedPayloadBytes).toBeGreaterThan(256*1024*1024);expect(page.stats.storedPayloadBytes).toBeLessThan(cloudScratchPayloadBytes);}finally{f.close();}
});

test('allocated-page overage rolls back the entire publication page before its acknowledgement',async()=>{
 const f=fixture();try{const id=f.publication.begin(f.fence),before=f.publication.stats(id),allocated=(Number(f.db.selectValue('PRAGMA page_count'))-Number(f.db.selectValue('PRAGMA freelist_count')))*Number(f.db.selectValue('PRAGMA page_size'));f.db.exec({sql:'UPDATE sensa_initial_publication SET allocated_baseline=? WHERE id=?',bind:[allocated-cloudScratchAllocatedBytes,id]});await expect(f.publication.page(id,null)).rejects.toThrow('library_sync_capacity');expect(f.publication.stats(id)).toEqual(before);expect(f.rows('SELECT count(*) AS n FROM sensa_initial_publication_rows')[0].n).toBe(0);expect(f.rows('SELECT count(*) AS n FROM sensa_initial_publication_blocks')[0].n).toBe(0);}finally{f.close();}
});

test('an awaiting quota check re-reads the committed page before returning an ACK-loss replay',async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const entering=new Promise<void>(resolve=>entered=resolve),wait=new Promise<void>(resolve=>release=resolve),reader=new SqliteInitialPublication(f.db,()=>{},()=>{throw Error('mutable source read');},()=>{},async()=>{entered();await wait;});
 try{const id=f.publication.begin(f.fence),pending=reader.page(id,null);await entering;const first=await f.publication.page(id,null);release();expect(await pending).toEqual(first);expect(f.publication.stats(id)).toEqual(first.stats);}finally{release();reader.close();f.close();}
});

test('allocation caused by the final page header update is included before COMMIT and rolls back',async()=>{
 const allocated=(f:ReturnType<typeof fixture>)=>(Number(f.db.selectValue('PRAGMA page_count'))-Number(f.db.selectValue('PRAGMA freelist_count')))*Number(f.db.selectValue('PRAGMA page_size'));
 const measured=fixture();let ordinaryGrowth:number;try{measured.db.exec('CREATE TABLE publication_capacity_fault(payload BLOB)');const id=measured.publication.begin(measured.fence),before=allocated(measured);await measured.publication.page(id,null);ordinaryGrowth=allocated(measured)-before;}finally{measured.close();}
 const f=fixture();try{f.db.exec('CREATE TABLE publication_capacity_fault(payload BLOB)');const id=f.publication.begin(f.fence),before=f.publication.stats(id);f.db.exec({sql:'UPDATE sensa_initial_publication SET allocated_baseline=? WHERE id=?',bind:[allocated(f)-cloudScratchAllocatedBytes+ordinaryGrowth,id]});
  f.db.exec('CREATE TRIGGER publication_header_growth AFTER UPDATE OF records ON sensa_initial_publication WHEN NEW.records>OLD.records BEGIN INSERT INTO publication_capacity_fault VALUES(zeroblob(1048576)); END');
  await expect(f.publication.page(id,null)).rejects.toThrow('library_sync_capacity');expect(f.publication.stats(id)).toEqual(before);expect(f.rows('SELECT count(*) AS n FROM publication_capacity_fault')[0].n).toBe(0);expect(f.rows('SELECT count(*) AS n FROM sensa_initial_publication_rows')[0].n).toBe(0);
 }finally{f.close();}
});

test('retained legacy encoded data remains readable and verifies its original plain length',async()=>{
 const f=fixture();try{const id=f.publication.begin(f.fence),page=await f.publication.page(id,null),hash=page.rows[0].blocks[0],data=f.publication.blocks(id,[hash]).blocks[0].data;f.db.exec({sql:'UPDATE sensa_initial_publication_blocks SET source_json=NULL,data=? WHERE hash=?',bind:[data,hash]});expect(f.publication.blocks(id,[hash]).blocks).toEqual([{hash,data}]);f.db.exec({sql:'UPDATE sensa_initial_publication_blocks SET plain_bytes=plain_bytes+1 WHERE hash=?',bind:[hash]});expect(()=>f.publication.blocks(id,[hash])).toThrow('library_sync_hash');}finally{f.close();}
});

test('cold legacy admission checks space before adding observations and preserves its retained source on refusal',async()=>{
 const f=fixture();let cold:SqliteInitialPublication|undefined;try{const id=f.publication.begin(f.fence);let after:any=null;for(;;){const page=await f.publication.page(id,after);after=page.next;if(page.done)break;}f.db.exec('UPDATE sensa_initial_publication SET allocated_baseline=NULL');const before=f.publication.stats(id),rows=f.rows('SELECT * FROM sensa_initial_publication_rows');cold=new SqliteInitialPublication(f.db,()=>{},()=>{throw Error('mutable source read');},()=>{},async()=>{throw Error('library_sync_capacity');});await expect(cold.validate(id,true,true)).rejects.toThrow('library_sync_capacity');expect(f.publication.stats(id)).toEqual(before);expect(f.rows('SELECT * FROM sensa_initial_publication_rows')).toEqual(rows);}finally{cold?.close();f.close();}
});


test('cold own publication reports completed batches, reads each frozen fact once and rechecks the fence after yielding',async()=>{
 const f=fixture();let cold:SqliteInitialPublication|undefined;try{
  const id=f.publication.begin(f.fence);let after:any=null;for(;;){const page=await f.publication.page(id,after);after=page.next;if(page.done)break;}
  const retained=f.rows('SELECT * FROM sensa_initial_publication_rows'),observations=f.rows('SELECT * FROM sensa_sync_admission_rows_v1'),counts:number[]=[];let fenceChecks=0;
  cold=new SqliteInitialPublication(f.db,()=>{},()=>{throw Error('mutable source read');},()=>{fenceChecks++;});
  const {observeReplicaWork}=await import('../../../apps/web/src/data/library/replicaWork');const work:Record<string,number>={};observeReplicaWork((kind,count)=>work[kind]=(work[kind]??0)+count);
  try{await cold.validate(id,true,true,p=>{expect(p.phase).toBe('publication-validation');counts.push(p.completed);});}finally{observeReplicaWork(undefined);}
  expect(counts).toEqual([64,128]);expect(work['reader.bodyLoad']).toBe(128);expect(work['reader.wireDecode']).toBe(128);expect(fenceChecks).toBeLessThan(12);
  expect(f.rows('SELECT * FROM sensa_initial_publication_rows')).toEqual(retained);expect(f.rows('SELECT * FROM sensa_sync_admission_rows_v1')).toEqual(observations);
  counts.length=0;await cold.validate(id,true,true,p=>counts.push(p.completed));expect(counts).toEqual([]);
  cold.close();let denied=false;const failed:number[]=[];cold=new SqliteInitialPublication(f.db,()=>{},()=>{throw Error('mutable source read');},()=>{if(denied)throw Error('account_changed');});
  await expect(cold.validate(id,true,true,p=>{failed.push(p.completed);setTimeout(()=>denied=true,0);})).rejects.toThrow('account_changed');expect(failed).toEqual([64]);expect(f.rows('SELECT * FROM sensa_initial_publication_rows')).toEqual(retained);
 }finally{cold?.close();f.close();}
});
