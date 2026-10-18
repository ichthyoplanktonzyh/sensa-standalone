import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createLibraryCloudBrowserFixture} from '../support/libraryCloudBrowserFixture.mts';
import {encodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import {libraryCloudRowOwner} from '../../../apps/api/src/sensa/library/generation';
import {pinLibraryCloudBlocks,retireEmptyLibraryCloudOwners,type LibraryCloudOwnerKind} from '../../../apps/api/src/sensa/library/membership';
import {libraryCloudMembershipRows} from '../support/libraryCloudMembershipSql.mts';

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
  await f.pool.query('ANALYZE sensa_consumer.library_cloud_snapshots');
  try{await db.query('BEGIN');await db.query('SET LOCAL enable_seqscan=off');await db.query('SET LOCAL enable_sort=off');plan=(await db.query(`EXPLAIN(FORMAT JSON) SELECT table_name,record_key,refs FROM sensa_consumer.library_cloud_snapshots
   WHERE account_id=$1 AND generation=$2 AND revision=1 AND(table_name COLLATE "C",record_key COLLATE "C")>($3::text COLLATE "C",$4::text COLLATE "C")
   ORDER BY table_name COLLATE "C",record_key COLLATE "C" LIMIT 16`,[account.accountId,begin.operationId,'drafts','é-0002'])).rows[0]['QUERY PLAN'];await db.query('ROLLBACK');}finally{db.release();}
  expect(JSON.stringify(plan)).toContain('library_cloud_snapshots_pkey');expect(JSON.stringify(plan)).not.toContain('"Node Type":"Sort"');
  await info.attach('snapshot-layout.json',{body:JSON.stringify({facts:rows.length,pages,columns,indexes,plan,scope:'Actual API publication and snapshot paging; forced-index EXPLAIN proves index eligibility, not production latency.'}),contentType:'application/json'});
 }finally{await f.close();}
});

test('compact membership IDs preserve exact owners, missing/cross-account rejection and reverse FK protection',async({browser},info)=>{
 const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const account=await f.createAccount(),other=await f.createAccount();
  const blocks=Array.from({length:3},(_,i)=>{const data=encodeLibrarySyncBlock('["number",'+i+']');return {data,hash:createHash('sha256').update(data).digest('hex')};});
  const response=await fetch(f.origin+'/sensa/library-sync/blocks/store',{method:'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json'},body:JSON.stringify({blocks})});expect(response.status).toBe(200);
  const generation=crypto.randomUUID(),rows=Array.from({length:1024},(_,i)=>({owner:libraryCloudRowOwner(generation,i%4?'drafts':'semanticContexts','key-界-é-é-🙂-"-\\-'+Math.floor(i/2)),hash:blocks[i%2]!.hash}));
  const count=async()=>Number((await f.pool.query('SELECT count(*) n FROM sensa_consumer.library_cloud_membership WHERE account_id=$1',[account.accountId])).rows[0].n);
  const insert=()=>pinLibraryCloudBlocks(f.pool,account.accountId,rows.map(row=>({kind:'row',owner:row.owner,hashes:[row.hash]})));
  await insert();expect(await count()).toBe(1024);await insert();expect(await count()).toBe(1024);
  // Keep kind, Unicode bytes, JSON escapes and raw/canonical UUID aliases exact.
  const aliases:[LibraryCloudOwnerKind,string][]=[['log','1'],['snapshot','1'],['staging',generation],['staging',generation.toUpperCase()],['row','é'],['row','é']];
  for(const [kind,owner] of aliases)await pinLibraryCloudBlocks(f.pool,account.accountId,[{kind,owner,hashes:[blocks[0]!.hash]}]);
  expect(await count()).toBe(1030);
  const actual=(await f.pool.query(`SELECT owner_id AS owner,hash FROM ${libraryCloudMembershipRows} WHERE account_id=$1 AND owner_kind='row' AND owner_id LIKE '[%' ORDER BY owner_id COLLATE "C",hash`,[account.accountId])).rows;
  expect(actual).toEqual([...rows].sort((a,b)=>Buffer.compare(Buffer.from(a.owner+'\0'+a.hash),Buffer.from(b.owner+'\0'+b.hash))));
  for(const hashes of [[blocks[0]!.hash.toUpperCase()],['e'.repeat(64)]]){
   const db=await f.pool.connect();try{await db.query('BEGIN');await expect(pinLibraryCloudBlocks(db,account.accountId,[{kind:'row',owner:'must-roll-back',hashes}])).rejects.toMatchObject({code:'23502'});await db.query('ROLLBACK');}finally{db.release();}
  }
  expect((await f.pool.query("SELECT 1 FROM sensa_consumer.library_cloud_owners WHERE account_id=$1 AND owner='must-roll-back'",[account.accountId])).rowCount).toBe(0);
  const identity=(await f.pool.query(`SELECT m.owner_id,m.block_id FROM sensa_consumer.library_cloud_membership m JOIN sensa_consumer.library_cloud_owners o ON o.account_id=m.account_id AND o.id=m.owner_id WHERE m.account_id=$1 AND o.owner=$2 LIMIT 1`,[account.accountId,rows[0]!.owner])).rows[0];
  await expect(f.pool.query('INSERT INTO sensa_consumer.library_cloud_membership VALUES($1,$2,$3)',[other.accountId,identity.owner_id,identity.block_id])).rejects.toMatchObject({code:'23503'});
  await expect(f.pool.query('DELETE FROM sensa_consumer.library_cloud_owners WHERE account_id=$1 AND id=$2',[account.accountId,identity.owner_id])).rejects.toMatchObject({code:'23503'});
  await expect(f.pool.query('DELETE FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=$2',[account.accountId,blocks[0]!.hash])).rejects.toMatchObject({code:'23503'});
  await retireEmptyLibraryCloudOwners(f.pool,account.accountId,'row',[rows[0]!.owner]);expect(await count()).toBe(1030);
  const db=await f.pool.connect(),plans:any[]=[];
  await f.pool.query('ANALYZE sensa_consumer.library_cloud_membership');
  try{await db.query('BEGIN');await db.query('SET LOCAL enable_seqscan=off');await db.query('SET LOCAL enable_sort=off');
   for(const [column,value] of [['owner_id',identity.owner_id],['block_id',identity.block_id]])plans.push((await db.query(`EXPLAIN(FORMAT JSON) SELECT block_id FROM sensa_consumer.library_cloud_membership WHERE account_id=$1 AND ${column}=$2 ORDER BY block_id LIMIT 1`,[account.accountId,value])).rows[0]['QUERY PLAN']);
   await db.query('ROLLBACK');
  }finally{db.release();}
  expect(JSON.stringify(plans[0])).toContain('library_cloud_membership_pkey');expect(JSON.stringify(plans[1])).toContain('library_cloud_membership_block');
  const deleted=await f.pool.query(`DELETE FROM sensa_consumer.library_cloud_membership m USING sensa_consumer.library_cloud_owners o WHERE m.account_id=$1 AND o.account_id=$1 AND m.owner_id=o.id AND o.owner_kind='row' AND o.owner=$2`,[account.accountId,rows[2]!.owner]);expect(deleted.rowCount).toBe(2);
  await retireEmptyLibraryCloudOwners(f.pool,account.accountId,'row',[rows[2]!.owner]);
  expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_owners WHERE account_id=$1 AND owner=$2',[account.accountId,rows[2]!.owner])).rowCount).toBe(0);
  expect((await f.pool.query('SELECT 1 FROM sensa_consumer.library_cloud_membership WHERE account_id=$1 AND block_id=$2',[account.accountId,identity.block_id])).rowCount).toBeGreaterThan(0);
  await info.attach('membership-layout.json',{body:JSON.stringify({pins:1030,ownerIdBytes:8,blockIdBytes:8,wireHashBytes:64,plans,scope:'Exact logical projection of normalized edges; account-scoped FKs, no cascading owner deletion, no refcount. Forced plans prove eligibility only; total owners/blocks/index overhead belongs in the unified 10k measurement.'}),contentType:'application/json'});
 }finally{await f.close();}
});
