import {test,expect,vi} from 'vitest';
import {beginPrivateRestoreAttempt} from '../../../apps/web/src/data/library/sqlitePrivateRestoreAttempt';
const prefix='sensa:private-restore-attempt:v1:';
function fixture(){
 const data=new Map<string,string>(),held=new Set<string>(),removed:string[]=[],busy=new Set<string>();
 const locks={async request(name:string,options:any,callback:any){if(options.ifAvailable&&held.has(name))return callback(null);if(held.has(name))throw Error('unexpected lock contention');held.add(name);try{return await callback({name});}finally{held.delete(name);}}};
 const root={async getDirectoryHandle(name:string){if(busy.has(name))throw Error('busy');throw new DOMException('absent','NotFoundError');},async removeEntry(name:string){removed.push(name);}};
 vi.stubGlobal('localStorage',{get length(){return data.size;},key(i:number){return [...data.keys()][i]??null;},getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)});
 vi.stubGlobal('navigator',{locks,storage:{getDirectory:async()=>root}});return {data,held,removed,busy,close:()=>vi.unstubAllGlobals()};
}

test('live attempts retain exact recovery witnesses until complete or a later abandoned cleanup',async()=>{
 const f=fixture();try{const first=crypto.randomUUID(),second=crypto.randomUUID(),a=await beginPrivateRestoreAttempt(first);expect(f.data.has(prefix+first)).toBe(true);const b=await beginPrivateRestoreAttempt(second);expect(f.removed).toEqual([]);b.complete();await b.release();expect(f.data.has(prefix+second)).toBe(false);await a.release();expect(f.data.has(prefix+first)).toBe(true);await Promise.resolve();const next=await beginPrivateRestoreAttempt(crypto.randomUUID());expect(f.removed).toContain('sensa-local-library-v12-'+first);expect(f.data.has(prefix+first)).toBe(false);next.complete();await next.release();}finally{f.close();}
});

for(const guard of ['selected','retained','busy','malformed'] as const)test(`abandoned cleanup preserves ${guard} pools`,async()=>{
 const f=fixture();try{const old=crypto.randomUUID(),current=crypto.randomUUID();f.data.set(prefix+old,guard==='malformed'?'unrecognized':crypto.randomUUID());if(guard==='selected'||guard==='retained')f.data.set('sensa:local-library-selection:v1',JSON.stringify({namespace:guard==='selected'?old:current,preservedNamespaces:guard==='retained'?[old]:[]}));if(guard==='busy')f.busy.add('sensa-local-library-v12-'+old);const attempt=await beginPrivateRestoreAttempt(crypto.randomUUID());expect(f.removed).toEqual([]);expect(f.data.has(prefix+old)).toBe(guard!=='selected'&&guard!=='retained');attempt.complete();await attempt.release();}finally{f.close();}
});
