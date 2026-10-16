import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createLibraryCloudBrowserFixture,type LibraryCloudAccount} from '../support/libraryCloudBrowserFixture.mts';
import {encodeLibrarySyncBlock} from '@sensa/contracts/sensa/library-sync-blocks';
import {finishLibraryCheckpoint} from '../support/finishLibraryCheckpoint.mts';
import {continueLibraryCloudRetention,purgeExpiredLibraryCloudBlocks} from '../../../apps/api/src/sensa/library/retention';

test('scheduled slices are fair, skip locked heads, roll back and preserve current/read/upload roots',async({browser},info)=>{
 test.setTimeout(120000);const f=await createLibraryCloudBrowserFixture(browser);
 try{
  const a=await f.createAccount(),b=await f.createAccount(),c=await f.createAccount(),legacy=await f.createAccount();
  const call=async(account:LibraryCloudAccount,path:string,body?:unknown)=>{const reply=await fetch(f.origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json','x-sensa-sync-protocol':'sensa-checkpoint-pages-v1'},body:body===undefined?undefined:JSON.stringify(body)});return {status:reply.status,value:await reply.json()};};
  const put=async(account:LibraryCloudAccount,value:unknown)=>{const data=encodeLibrarySyncBlock(JSON.stringify(value)),hash=createHash('sha256').update(data).digest('hex');expect((await call(account,'/blocks/store',{blocks:[{hash,data}]})).status).toBe(200);return hash;};
  const seed=async(account:LibraryCloudAccount,n:number,commit:boolean)=>{
   const begin={operationId:crypto.randomUUID(),baseRevision:0,libraryId:crypto.randomUUID(),learnerId:crypto.randomUUID(),incarnation:crypto.randomUUID(),localRevision:1};
   const shared=await put(account,['string','shared current body']),old=await put(account,['string','old reader body']),identity=await put(account,{libraryId:begin.libraryId,learnerId:begin.learnerId});
   expect((await call(account,'/staging/begin',begin)).status).toBe(200);
   const rows=[{table:'meta',key:'identity',blocks:[identity]},...Array.from({length:n},(_,i)=>({table:'drafts',key:'draft-'+i,blocks:[i===0?old:shared]}))];let pages=0,digest='';
   for(let at=0;at<rows.length;at+=256){const page=await call(account,'/staging/page',{operationId:begin.operationId,page:pages++,rows:rows.slice(at,at+256)});expect(page.status).toBe(200);digest=page.value.digest;}
   const request={operationId:begin.operationId,baseRevision:0,staging:{pages,records:rows.length,digest}};if(commit)expect((await call(account,'/commit',request)).status).toBe(200);
   return {begin,rows,request,old,shared,identity};
  };
  const initial=await seed(a,600,true),oldHead=(await call(a,'/head')).value;
  const next=await put(a,['string','new current body']),patch=await put(a,{version:1,libraryId:initial.begin.libraryId,learnerId:initial.begin.learnerId,changes:[{...initial.rows[1],blocks:[next]}]});
  expect((await call(a,'/commit',{operationId:crypto.randomUUID(),baseRevision:1,patch:[patch]})).status).toBe(200);
  expect((await finishLibraryCheckpoint((path,body)=>call(a,path,body),{baseRevision:2})).status).toBe(200);
  const expired=await seed(b,600,false),active=await seed(c,2,false),freshUpload=await put(c,['string','unreferenced active upload']);await call(legacy,'/head');
  await f.pool.query('UPDATE sensa_consumer.library_cloud SET revision=3 WHERE account_id=$1',[legacy.accountId]);
  await f.pool.query("UPDATE sensa_consumer.library_cloud_staging SET expires_at='2000-01-01' WHERE account_id=$1",[b.accountId]);
  // The disposable database can contain other fixture accounts; keep this pass
  // scoped without changing any source database or production role.
  await f.pool.query("UPDATE sensa_consumer.library_cloud SET maintenance_at='infinity' WHERE account_id<>ALL($1::text[])",[[a.accountId,b.accountId,c.accountId,legacy.accountId]]);
  for(const [account,at] of [[a,'2000-01-01'],[b,'2000-01-02'],[c,'2000-01-03'],[legacy,'1999-01-01']] as const)await f.pool.query('UPDATE sensa_consumer.library_cloud SET maintenance_at=$2 WHERE account_id=$1',[account.accountId,at]);
  const count=async(account:LibraryCloudAccount,table:string,where='true')=>(await f.pool.query(`SELECT count(*)::int AS n FROM sensa_consumer.${table} WHERE account_id=$1 AND ${where}`,[account.accountId])).rows[0].n as number;
  const service=async(before=new Date())=>{const db=await f.pool.connect();try{await db.query('BEGIN');await db.query('SET LOCAL ROLE backend_app');const result=await continueLibraryCloudRetention(db,new Date(),before);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}};
  const cutoff=new Date(),gate=await f.pool.connect();try{await gate.query('BEGIN');await gate.query('SELECT account_id FROM sensa_consumer.library_cloud WHERE account_id=$1 FOR UPDATE',[a.accountId]);expect(await service(cutoff)).toBe(b.accountId);}finally{await gate.query('ROLLBACK');gate.release();}
  expect(await count(b,'library_cloud_rows')).toBe(473);expect(await service(cutoff)).toBe(a.accountId);expect(await count(a,'library_cloud_snapshots')).toBe(1202); // H=1 is still leased.
  expect((await call(a,'/snapshot',{snapshotRevision:1,after:null,readLease:oldHead.readLease})).status).toBe(200);
  expect(await service(cutoff)).toBe(c.accountId);expect(await service(cutoff)).toBeUndefined();
  await f.pool.query("UPDATE sensa_consumer.library_cloud_reads SET expires_at='2000-01-01' WHERE account_id=$1 AND snapshot_revision=1",[a.accountId]);
  await f.pool.query("UPDATE sensa_consumer.library_cloud SET maintenance_at='2000-01-01' WHERE account_id=$1",[a.accountId]);
  const cursorBefore=(await f.pool.query('SELECT maintenance_at FROM sensa_consumer.library_cloud WHERE account_id=$1',[a.accountId])).rows[0].maintenance_at;
  await f.pool.query("CREATE FUNCTION sensa_consumer.scheduled_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated scheduled interruption'; END $$");
  await f.pool.query('CREATE TRIGGER scheduled_test_fault BEFORE DELETE ON sensa_consumer.library_cloud_snapshots FOR EACH ROW EXECUTE FUNCTION sensa_consumer.scheduled_test_fault()');
  try{await expect(service()).rejects.toThrow('isolated scheduled interruption');}finally{await f.pool.query('DROP TRIGGER scheduled_test_fault ON sensa_consumer.library_cloud_snapshots');await f.pool.query('DROP FUNCTION sensa_consumer.scheduled_test_fault()');}
  expect((await f.pool.query('SELECT maintenance_at FROM sensa_consumer.library_cloud WHERE account_id=$1',[a.accountId])).rows[0].maintenance_at).toEqual(cursorBefore);expect(await count(a,'library_cloud_snapshots')).toBe(1202);expect(await count(a,'library_cloud_log')).toBe(1);
  const visited:string[]=[];for(let at=0;at<24;at++){visited.push((await service())!);if(await count(a,'library_cloud_snapshots')===601&&await count(b,'library_cloud_staging')===0)break;}
  expect(visited).toEqual(expect.arrayContaining([a.accountId,b.accountId,c.accountId]));expect(await count(a,'library_cloud_snapshots')).toBe(601);expect(await count(a,'library_cloud_rows')).toBe(601);expect(await count(b,'library_cloud_rows')).toBe(0);expect(await count(b,'library_cloud_snapshots')).toBe(0);expect(await count(b,'library_cloud_staging')).toBe(0);
  const expected=initial.rows.map((row,i)=>({...row,blocks:i===1?[next]:row.blocks})).sort((l,r)=>Buffer.compare(Buffer.from(l.table+'\0'+l.key),Buffer.from(r.table+'\0'+r.key)));
  for(const table of ['library_cloud_rows','library_cloud_snapshots'])expect((await f.pool.query(`SELECT table_name AS "table",record_key AS key,refs AS blocks FROM sensa_consumer.${table} WHERE account_id=$1 ORDER BY table_name COLLATE "C",record_key COLLATE "C"`,[a.accountId])).rows).toEqual(expected);
  expect(await count(c,'library_cloud_rows')).toBe(3);expect(await count(c,'library_cloud_staging')).toBe(1);expect((await f.pool.query('SELECT maintenance_at::text AS at FROM sensa_consumer.library_cloud WHERE account_id=$1',[legacy.accountId])).rows[0].at).toContain('1999-01-01');
  await f.pool.query("UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at='2000-01-01' WHERE account_id=ANY($1::text[]) AND hash<>$2",[[a.accountId,b.accountId,c.accountId],freshUpload]);
  const db=await f.pool.connect();try{await db.query('BEGIN');for(const account of [a,b,c])await purgeExpiredLibraryCloudBlocks(db,new Date(),1000,account.accountId);await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  // G=H2 conservatively pins source H1 refs as it replays the tail. That current
  // checkpoint root must survive even when the old reader and H1 rows retire.
  expect((await f.pool.query("SELECT 1 FROM sensa_consumer.library_cloud_membership m JOIN sensa_consumer.library_cloud h ON h.account_id=m.account_id AND h.snapshot_generation::text=m.owner_id WHERE m.account_id=$1 AND m.owner_kind='staging' AND m.hash=$2",[a.accountId,initial.old])).rowCount).toBe(1);
  expect((await call(a,'/blocks/fetch',{hashes:[initial.old,initial.shared,initial.identity,next]})).value.missing).toEqual([]);expect((await call(b,'/blocks/fetch',{hashes:[expired.old]})).value.missing).toEqual([expired.old]);expect((await call(c,'/blocks/fetch',{hashes:[active.old,active.identity,freshUpload]})).value.missing).toEqual([]);
  expect((await call(a,'/receipt/'+initial.begin.operationId)).value.head.revision).toBe(1);expect((await call(a,'/head')).value.revision).toBe(2);
  await info.attach('scheduled-retention.json',{body:JSON.stringify({factsPerLargeFixture:601,slices:visited.length,skipLocked:true,rollback:true,fixedPassAtMostOnce:true,currentReaderAndUploadRootsPreserved:true,legacySkipped:true,scope:'Isolated backend_app execution of existing bounded helpers. Production operational role is unchanged and lacks the separately required metadata ACLs.'}),contentType:'application/json'});
 }finally{await f.close();}
});

test('a scheduled process handles SIGTERM after its current transaction and reports committed slices only',async({browser})=>{
 const f=await createLibraryCloudBrowserFixture(browser);let child:ReturnType<typeof spawn>|undefined;
 try{
  const account=await f.createAccount();expect((await fetch(f.origin+'/sensa/library-sync/head',{headers:{authorization:'Bearer '+account.token}})).status).toBe(200);
  await f.pool.query("UPDATE sensa_consumer.library_cloud SET maintenance_at=CASE WHEN account_id=$1 THEN '-infinity'::timestamptz ELSE 'infinity'::timestamptz END",[account.accountId]);
  await f.pool.query('CREATE FUNCTION sensa_consumer.scheduled_signal_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$');
  await f.pool.query('CREATE TRIGGER scheduled_signal_pause BEFORE UPDATE OF maintenance_at ON sensa_consumer.library_cloud FOR EACH ROW EXECUTE FUNCTION sensa_consumer.scheduled_signal_pause()');
  const childEnv={...process.env,SENSA_MAINTENANCE_DATABASE_URL:process.env.SENSA_ADMIN_TEST_DATABASE_URL??process.env.SENSA_TEST_DATABASE_URL,SENSA_LIBRARY_HISTORY_RETENTION_ENABLED:'true'};delete childEnv.FORCE_COLOR;
  let stdout='',stderr='';child=spawn(process.execPath,['--import','tsx','scripts/release/libraryCloudRetention.mts'],{env:childEnv,stdio:['ignore','pipe','pipe']});child.stdout!.on('data',v=>stdout+=v);child.stderr!.on('data',v=>stderr+=v);
  const exited=new Promise<number|null>((done,reject)=>{child!.on('error',reject);child!.on('close',done);});
  await expect.poll(async()=>(await f.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name='sensa-library-retention' AND wait_event='PgSleep'")).rows[0].n,{timeout:10000}).toBe(1);
  expect(child.kill('SIGTERM')).toBe(true);expect(await exited).toBe(0);expect(stderr).toBe('');
  const result=JSON.parse(stdout.trim());expect(result).toMatchObject({batches:1,accountsServiced:1,historyEnabled:true,interrupted:true,limitReached:false});
  expect((await f.pool.query('SELECT isfinite(maintenance_at) AS advanced FROM sensa_consumer.library_cloud WHERE account_id=$1',[account.accountId])).rows[0].advanced).toBe(true);
  await f.pool.query('DROP TRIGGER scheduled_signal_pause ON sensa_consumer.library_cloud');
  // A process clock one hour behind must not turn the repeated fair rounds
  // into one slice/hour. The database owns both cursor and pass timestamps.
  const skew='const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){if(args.length)super(...args);else super(NativeDate.now()-3600000)}static now(){return NativeDate.now()-3600000}};';
  stdout='';stderr='';child=spawn(process.execPath,['--import','tsx','--import','data:text/javascript,'+encodeURIComponent(skew),'scripts/release/libraryCloudRetention.mts'],{env:childEnv,stdio:['ignore','pipe','pipe']});child.stdout!.on('data',v=>stdout+=v);child.stderr!.on('data',v=>stderr+=v);
  expect(await new Promise<number|null>((done,reject)=>{child!.on('error',reject);child!.on('close',done);})).toBe(0);expect(stderr).toBe('');
  expect(JSON.parse(stdout.trim())).toMatchObject({batches:100,accountsServiced:100,historyEnabled:true,interrupted:false,limitReached:true});
 }finally{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await f.pool.query('DROP TRIGGER IF EXISTS scheduled_signal_pause ON sensa_consumer.library_cloud');await f.pool.query('DROP FUNCTION IF EXISTS sensa_consumer.scheduled_signal_pause()');await f.close();}
});
