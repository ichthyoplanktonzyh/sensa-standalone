/** Synthetic driver faults, not real database/provider behavior. */
import {test,expect,vi,beforeEach,afterEach} from 'vitest';
const fixture=vi.hoisted(()=>({
 connectFailure:null as Error|null,rollbackFailure:null as Error|null,
 handlers:new Map<string,(error:Error)=>void>(),released:[] as boolean[],
}));
vi.mock('pg',()=>({default:{Pool:class{
 waitingCount=0;totalCount=1;idleCount=1;
 on(event:string,handler:(error:Error)=>void){fixture.handlers.set(event,handler);}
 async connect(){
  if(fixture.connectFailure)throw fixture.connectFailure;
  return {query:async(sql:string)=>{if(sql==='ROLLBACK'&&fixture.rollbackFailure)throw fixture.rollbackFailure;return {rows:[],rowCount:0};},release:(destroy:boolean)=>fixture.released.push(destroy)};
 }
 async end(){}
}}}));
import {unsafeTransaction,closeDatabasePool} from '../../../apps/api/src/database/core';

const privateText='synthetic-private-body-email-password-sql';
const databaseUrl='postgresql://fixture:synthetic-private-password@127.0.0.1/diagnostic_fixture';
let records:Record<string,unknown>[]=[];
beforeEach(()=>{
 fixture.connectFailure=null;fixture.rollbackFailure=null;fixture.handlers.clear();fixture.released.length=0;records=[];
 vi.stubEnv('DATABASE_URL',databaseUrl);
 vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.spyOn(console,'error').mockImplementation(value=>records.push(JSON.parse(value)));
});
afterEach(async()=>{await closeDatabasePool();vi.restoreAllMocks();vi.unstubAllEnvs();});

test('pool acquisition retains the original error but never logs its message or credentials',async()=>{
 fixture.connectFailure=Object.assign(new Error(privateText+' '+databaseUrl),{code:'ECONNRESET',detail:privateText});
 await expect(unsafeTransaction(async()=>null)).rejects.toBe(fixture.connectFailure);
 expect(records).toHaveLength(1);expect(records[0]).toMatchObject({event:'sensa.database_pool_acquire_failed',failureKind:'transport',failureCode:'ECONNRESET'});
 expect(JSON.stringify(records)).not.toContain(privateText);expect(records[0]).not.toHaveProperty('message');
 expect(JSON.stringify(records)).not.toContain(databaseUrl);expect(JSON.stringify(records)).not.toContain('synthetic-private-password');
});

test('idle pool errors use the same closed diagnostic fields',async()=>{
 await unsafeTransaction(async()=>null);
 fixture.handlers.get('error')!(Object.assign(new Error(privateText),{code:'28P01'}));
 expect(records[0]).toMatchObject({action:'database_pool_error',failureKind:'database',failureCode:'28P01'});
 expect(JSON.stringify(records)).not.toContain(privateText);expect(records[0]).not.toHaveProperty('message');
});

test('failing acquire and idle log sinks cannot replace the driver error or escape its event handler',async()=>{
 vi.mocked(console.error).mockImplementation(()=>{throw Error('synthetic sink failure');});
 fixture.connectFailure=Object.assign(new Error(privateText),{code:'28P01'});
 await expect(unsafeTransaction(async()=>null)).rejects.toBe(fixture.connectFailure);
 expect(()=>fixture.handlers.get('error')!(fixture.connectFailure!)).not.toThrow();
});

test('a failing rollback log sink still preserves the original failure and destroys the client',async()=>{
 vi.mocked(console.error).mockImplementation(()=>{throw Error('synthetic sink failure');});
 const original=new Error(privateText);fixture.rollbackFailure=new Error(privateText);
 await expect(unsafeTransaction(async()=>{throw original;})).rejects.toBe(original);expect(fixture.released).toEqual([true]);
});

test('a failing acquisition info sink does not leak or reject a successfully borrowed client',async()=>{
 vi.mocked(console.info).mockImplementation(()=>{throw Error('synthetic sink failure');});
 await expect(unsafeTransaction(async()=>7)).resolves.toBe(7);expect(fixture.released).toEqual([false]);expect(records).toEqual([]);
});

test('rollback failure is redacted and destroys the connection without replacing the original failure',async()=>{
 const original=new Error(privateText);fixture.rollbackFailure=Object.assign(new Error(privateText),{code:'57P01'});
 await expect(unsafeTransaction(async()=>{throw original;})).rejects.toBe(original);
 expect(records[0]).toMatchObject({action:'database_rollback_failed',failureKind:'database',failureCode:'57P01'});
 expect(JSON.stringify(records)).not.toContain(privateText);expect(fixture.released).toEqual([true]);
});
