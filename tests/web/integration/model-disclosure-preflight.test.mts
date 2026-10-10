import {test,expect,vi,afterEach} from 'vitest';
import {complete} from '../../../apps/web/src/data/library/transport';

const state=vi.hoisted(()=>({subject:'account-a',assignment:'teacher-a',gate:Promise.resolve(),queued:false,preflight:false}));
vi.mock('../../../apps/web/src/data/account/auth',()=>({auth:{getSession:async()=>({error:null,data:{session:{access_token:'synthetic-test-token',user:{id:state.subject}}}})}}));
vi.mock('../../../apps/web/src/data/library/store',()=>({readLibrary:async(work:(tx:{get:(table:string,key:string)=>Promise<unknown>})=>unknown)=>work({get:async(_table,key)=>key==='service-owner'?{subject:'account-a',accountId:'fixture-account'}:undefined})}));
vi.mock('../../../apps/web/src/data/library/providers',()=>({clearCredential:()=>{},providerSnapshot:async()=>({providers:[]})}));
vi.mock('../../../apps/web/src/data/library/modelExecution',()=>({localModelQueue:{run:async(_input:unknown,signal:AbortSignal,work:(signal:AbortSignal,record:Record<string,unknown>)=>Promise<unknown>)=>{state.queued=true;await state.gate;return work(signal,{});}}}));
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

test('teacher reassignment while queued rejects at actual dispatch before any network disclosure',async()=>{
 vi.stubEnv('VITE_SENSA_API_URL','https://managed.invalid');
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 let release!:()=>void;state.gate=new Promise<void>(resolve=>{release=resolve;});state.assignment='teacher-a';state.subject='account-a';state.queued=false;state.preflight=false;
 const pending=complete({id:'teacher-a',revision:1,name:'Synthetic managed provider',kind:'sensa',endpoint:'https://managed.invalid',model:'synthetic'},'teacher',crypto.randomUUID(),[{role:'user',content:'private scene text'}],[],new AbortController().signal,{
  expectedSubject:'account-a',beforeSend:async()=>{state.preflight=true;if(state.assignment!=='teacher-a')throw new Error('localFlow.requestConfigChanged');},
 });
 const rejected=expect(pending).rejects.toThrow('localFlow.requestConfigChanged');expect(state.queued).toBe(true);expect(state.preflight).toBe(false);
 state.assignment='teacher-b';release();await rejected;expect(state.preflight).toBe(true);expect(fetch).not.toHaveBeenCalled();
});

test('an account change while queued cannot transmit a disclosure approved for the previous account',async()=>{
 vi.stubEnv('VITE_SENSA_API_URL','https://managed.invalid');const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 let release!:()=>void;state.gate=new Promise<void>(resolve=>{release=resolve;});state.subject='account-a';
 const pending=complete({id:'teacher-a',revision:1,name:'Synthetic managed provider',kind:'sensa',endpoint:'https://managed.invalid',model:'synthetic'},'teacher',crypto.randomUUID(),[{role:'user',content:'private scene text'}],[],new AbortController().signal,{expectedSubject:'account-a'});
 const rejected=expect(pending).rejects.toThrow('localFlow.staleAccountResult');state.subject='account-b';release();await rejected;expect(fetch).not.toHaveBeenCalled();
});
