/** Actual sync route and controlled SQL; no real account, database or cloud.
 * Only application work lacks ambient Buffer; Node's HTTP implementation keeps
 * its own globals, unlike the separate npm/application scopes on Deno. */
import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import type {QueryResultRow} from 'pg';
import {Hono} from 'hono';
import type {DatabaseExecutor,SqlValue} from '../../../apps/api/src/database/core';
import {registerLibrarySync} from '../../../apps/api/src/sensa/library/sync';
import {libraryCloudCapacityBytes} from '../../../apps/api/src/sensa/library/retention';
import {ConsumerError} from '../../../apps/api/src/sensa/access/auth';

const text='学习🙂e\u0301';
const digest=(data:string)=>createHash('sha256').update(data).digest('hex');
function fixture(usedBytes=0,existing?:string){
 const blocks=new Map<string,string>(existing===undefined?[]:[[digest(existing),existing]]);
 const inserted:string[]=[],leases:string[][]=[];
 const db:DatabaseExecutor={async query<Row extends QueryResultRow>(sql:string,params:ReadonlyArray<SqlValue>=[]){
  let rows:Record<string,unknown>[]=[];
  if(sql.startsWith('INSERT INTO sensa_consumer.library_cloud(')){}
  else if(sql.startsWith('SELECT revision,manifest'))rows=[{revision:0,manifest:null}];
  else if(sql.startsWith('DELETE FROM sensa_consumer.library_cloud_block_refs')||sql.startsWith('DELETE FROM sensa_consumer.library_cloud_snapshot_leases')||sql.includes('WITH expired AS')){}
  else if(sql.startsWith('SELECT hash,data'))rows=[...blocks].filter(([hash])=>(params[1] as readonly string[]).includes(hash)).map(([hash,data])=>({hash,data}));
  else if(sql.startsWith('UPDATE sensa_consumer.library_cloud_blocks SET upload_lease_expires_at'))leases.push(params[1] as string[]);
  else if(sql.startsWith('SELECT COALESCE(sum(octet_length(data))'))rows=[{n:String(usedBytes)}];
  else if(sql.startsWith('INSERT INTO sensa_consumer.library_cloud_blocks(')){
   const hash=params[1] as string,data=params[2] as string;inserted.push(hash);blocks.set(hash,data);
  }else throw Error('Unhandled controlled SQL');
  return {rows:rows as Row[],rowCount:rows.length,command:'',oid:0,fields:[]};
 }};
 const app=new Hono();
 app.onError((error,c)=>error instanceof ConsumerError?c.json({code:error.code},error.status):c.json({code:'unexpected_test_failure'},500));
 registerLibrarySync(app,async(_request,work)=>withoutAmbientBuffer(()=>work(db,{accountId:'00000000-0000-4000-8000-000000000001',now:new Date('2026-10-09T00:00:00Z')})));
 const request=new Request('http://fixture.invalid/sensa/library-sync/blocks/store',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({blocks:[{hash:digest(text),data:text}]})});
 return {app,request,blocks,inserted,leases};
}
async function withoutAmbientBuffer<T>(work:()=>Promise<T>):Promise<T>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Buffer');
 if(!Reflect.deleteProperty(globalThis,'Buffer'))throw Error('Cannot remove ambient Buffer in this controlled worker');
 try{
  if(typeof globalThis.Buffer!=='undefined')throw Error('Ambient Buffer remains');
  return await work();
 }finally{
  if(descriptor)Object.defineProperty(globalThis,'Buffer',descriptor);
 }
}
test('the actual upload route stores UTF-8 text when ambient Buffer is absent',async()=>{
 const f=fixture();const response=await f.app.fetch(f.request);
 expect(response.status).toBe(200);expect(await response.json()).toEqual({stored:true});
 expect(f.inserted).toEqual([digest(text)]);expect(f.blocks.get(digest(text))).toBe(text);
});
test('the UTF-8 capacity guard rejects multibyte bytes rather than counting string characters',async()=>{
 expect(new TextEncoder().encode(text).length).toBeGreaterThan(text.length);
 const f=fixture(libraryCloudCapacityBytes-text.length);const response=await f.app.fetch(f.request);
 expect(response.status).toBe(413);expect(await response.json()).toEqual({code:'library_sync_capacity'});expect(f.inserted).toEqual([]);
});
test('an identical retry renews its lease without charging its bytes again at capacity',async()=>{
 const f=fixture(libraryCloudCapacityBytes,text);const response=await f.app.fetch(f.request);
 expect(response.status).toBe(200);expect(await response.json()).toEqual({stored:true});expect(f.inserted).toEqual([]);expect(f.leases).toEqual([[digest(text)]]);
});
