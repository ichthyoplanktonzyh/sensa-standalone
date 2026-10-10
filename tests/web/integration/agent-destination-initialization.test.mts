import assert from 'node:assert/strict';
import {beforeEach,afterEach,test,vi} from 'vitest';

const fixture=vi.hoisted(()=>({
  owner:{subject:'fixture-subject',accountId:'fixture-account'},subject:'fixture-subject',
  sync:{revision:0,status:'synced',owner:{subject:'fixture-subject',accountId:'fixture-account'}},
  calls:[] as string[],options:[] as unknown[],switchDuringSync:false,
}));
vi.mock('../../../apps/web/src/data/account/auth.ts',()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-token',user:{id:fixture.subject}}}})}}));
vi.mock('../../../apps/web/src/data/library/store.ts',()=>({
  openLibrary:async()=>({id:'d78a1851-7822-4829-9264-bd7f9a467f80'}),
  readLibrary:async(work:(tx:{get:(table:string,key:string)=>Promise<unknown>})=>unknown)=>work({get:async(_table,key)=>key==='service-owner'?fixture.owner:undefined}),
}));
vi.mock('../../../apps/web/src/data/library/cloudSync.ts',()=>({readCloudSync:async()=>fixture.sync}));
vi.mock('../../../apps/web/src/data/library/cloudSyncService.ts',()=>({syncAccountLibrary:async(options:unknown)=>{
  fixture.calls.push('identity-checkpoint');fixture.options.push(options);
  fixture.sync={revision:1,status:'synced',owner:{...fixture.owner}};
  if(fixture.switchDuringSync)fixture.subject='other-subject';
}}));
import {createAgentConnectionSetup} from '../../../apps/web/src/data/library/agentConnection.ts';

beforeEach(()=>{
  fixture.subject='fixture-subject';fixture.owner={subject:fixture.subject,accountId:'fixture-account'};
  fixture.sync={revision:0,status:'synced',owner:{...fixture.owner}};
  fixture.calls=[];fixture.options=[];fixture.switchDuringSync=false;
  vi.stubEnv('VITE_SENSA_API_URL','https://fixture.invalid');
  vi.stubGlobal('fetch',async(input:unknown,init:RequestInit)=>{
    const path=new URL(String(input)).pathname;fixture.calls.push(path);
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer fixture-token');
    const body=JSON.parse(String(init.body));
    if(path==='/sensa/intake/channel')return Response.json({registered:true,libraryId:body.libraryId});
    assert.equal(path,'/sensa/agent/connection-setups');
    return Response.json({...body,setupCode:`sensa_setup_${'a'.repeat(48)}`,createdAt:'2026-10-03T00:00:00.000Z',expiresAt:'2026-10-03T00:10:00.000Z'});
  });
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

test('an explicit first Agent connection establishes identity then channel before offering a setup',async()=>{
  const result=await createAgentConnectionSetup({clientKind:'codex',label:'Fixture'});
  assert.equal(result.clientKind,'codex');
  assert.deepEqual(fixture.options,[{publishEmptyIdentity:true}]);
  assert.deepEqual(fixture.calls,['identity-checkpoint','/sensa/intake/channel','/sensa/agent/connection-setups']);
});
test('an established destination does not start another full-library transfer',async()=>{
  fixture.sync.revision=7;fixture.sync.status='pending';
  await createAgentConnectionSetup({clientKind:'codex',label:'Fixture'});
  assert.deepEqual(fixture.options,[]);
  assert.deepEqual(fixture.calls,['/sensa/intake/channel','/sensa/agent/connection-setups']);
});
test('a different authenticated owner cannot configure the local library as their destination',async()=>{
  fixture.subject='other-subject';
  await assert.rejects(createAgentConnectionSetup({clientKind:'codex',label:'Fixture'}),/account_changed/u);
  assert.deepEqual(fixture.calls,[]);
});
test('switching accounts during initialization cannot register or grant the prior library',async()=>{
  fixture.switchDuringSync=true;
  await assert.rejects(createAgentConnectionSetup({clientKind:'codex',label:'Fixture'}),/account_changed/u);
  assert.deepEqual(fixture.calls,['identity-checkpoint']);
});
test('a stale cloud state belonging to another account cannot bypass initialization checks',async()=>{
  fixture.sync={revision:7,status:'synced',owner:{subject:fixture.subject,accountId:'another-account'}};
  await assert.rejects(createAgentConnectionSetup({clientKind:'codex',label:'Fixture'}),/account_changed/u);
  assert.deepEqual(fixture.calls,[]);
});
