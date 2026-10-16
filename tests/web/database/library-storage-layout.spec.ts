import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createLibraryCloudBrowserFixture} from '../support/libraryCloudBrowserFixture.mts';
import {encodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';

test('one snapshot primary key preserves Unicode identity and C keyset paging across 1025 facts',async({browser},info)=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),call=async(path:string,body?:unknown)=>{const response=await fetch(f.origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});expect(response.status).toBe(200);return response.json();};
  const data=encodeLibrarySyncBlock('["string","snapshot layout"]'),hash=createHash('sha256').update(data).digest('hex');await call('/blocks/store',{blocks:[{hash,data}]});
  const begin={operationId:crypto.randomUUID(),baseRevision:0,libraryId:crypto.randomUUID(),learnerId:crypto.randomUUID(),incarnation:crypto.randomUUID(),localRevision:1};await call('/staging/begin',begin);
  const rows=[{table:'meta',key:'identity',blocks:[hash]},...Array.from({length:1024},(_,i)=>({table:'drafts',key:i<2?['é','é'][i]!:['Z','a','é','é','界','🙂','𐀀','Å'][i%8]+'-'+String(i).padStart(4,'0'),blocks:[hash]}))];let digest='',pages=0;
  for(let at=0;at<rows.length;at+=512){digest=(await call('/staging/page',{operationId:begin.operationId,page:pages++,rows:rows.slice(at,at+512)})).digest;}
  await call('/commit',{operationId:begin.operationId,baseRevision:0,staging:{pages,records:rows.length,digest}});
  const head=await call('/head'),downloaded:typeof rows=[];let after:any=null;
  for(;;){const page=await call('/snapshot',{snapshotRevision:1,readLease:head.readLease,after});downloaded.push(...page.rows);if(page.done)break;after=page.next;}
  expect(downloaded).toEqual([...rows].sort((a,b)=>Buffer.compare(Buffer.from(a.table+'\0'+a.key),Buffer.from(b.table+'\0'+b.key))));
  await expect(f.pool.query('INSERT INTO sensa_consumer.library_cloud_snapshots SELECT * FROM sensa_consumer.library_cloud_snapshots WHERE account_id=$1 LIMIT 1',[account.accountId])).rejects.toMatchObject({code:'23505'});
  // The same key still has distinct generation/revision identities.
  await f.pool.query("INSERT INTO sensa_consumer.library_cloud_snapshots(account_id,generation,revision,table_name,record_key,refs) VALUES($1,$2,1,'drafts',$4,'[]'),($1,$3,2,'drafts',$4,'[]')",[account.accountId,crypto.randomUUID(),begin.operationId,rows[1]!.key]);
  const columns=(await f.pool.query("SELECT a.attname,c.collname FROM pg_attribute a JOIN pg_collation c ON c.oid=a.attcollation WHERE a.attrelid='sensa_consumer.library_cloud_snapshots'::regclass AND a.attname IN('table_name','record_key') ORDER BY a.attname")).rows;
  expect(columns).toEqual([{attname:'record_key',collname:'C'},{attname:'table_name',collname:'C'}]);
  const indexes=(await f.pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='sensa_consumer' AND tablename='library_cloud_snapshots' ORDER BY indexname")).rows;
  expect(indexes.map(i=>i.indexname)).toEqual(['library_cloud_snapshot_retirement','library_cloud_snapshots_pkey']);
  const db=await f.pool.connect();let plan:any;
  try{await db.query('BEGIN');await db.query('SET LOCAL enable_seqscan=off');plan=(await db.query(`EXPLAIN(FORMAT JSON) SELECT table_name,record_key,refs FROM sensa_consumer.library_cloud_snapshots
   WHERE account_id=$1 AND generation=$2 AND revision=1 AND(table_name COLLATE "C",record_key COLLATE "C")>($3::text COLLATE "C",$4::text COLLATE "C")
   ORDER BY table_name COLLATE "C",record_key COLLATE "C" LIMIT 16`,[account.accountId,begin.operationId,'drafts','é-0002'])).rows[0]['QUERY PLAN'];await db.query('ROLLBACK');}finally{db.release();}
  expect(JSON.stringify(plan)).toContain('library_cloud_snapshots_pkey');expect(JSON.stringify(plan)).not.toContain('"Node Type":"Sort"');
  await info.attach('snapshot-layout.json',{body:JSON.stringify({facts:rows.length,pages,columns,indexes,plan,scope:'Actual API publication and snapshot paging; forced-index EXPLAIN proves index eligibility, not production latency.'}),contentType:'application/json'});
 }finally{await f.close();}
});
