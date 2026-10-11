/** Service phase budgets, not transport/OPFS or provider authentication proof. */
import {afterEach,expect,test,vi} from 'vitest';

const fixture=vi.hoisted(()=>({sync:vi.fn(),rehydrate:vi.fn(),owner:{subject:'fixture-subject',accountId:'fixture-account'}}));
vi.mock('../../../apps/web/src/data/account/auth',()=>({auth:undefined}));
vi.mock('../../../apps/web/src/data/library/store',()=>({
 readLibrary:async(work:(tx:unknown)=>unknown)=>work({get:async(_table:string,key:string)=>key==='service-owner'?fixture.owner:undefined}),
 assertCurrentLibrary:async()=> 'fixture-incarnation',
 readLocalLibraryRevision:async()=>0,
 readLocalArtifactRevision:async()=>0,
 writeLibraryState:async(work:(tx:unknown)=>unknown)=>work({get:async()=>undefined,put:()=>{}}),
 observeLibrary:()=>()=>{},
}));
vi.mock('../../../apps/web/src/data/library/cloudSync',()=>({synchronizeLibrary:fixture.sync,readCloudReconnectRequired:async()=>false}));
vi.mock('../../../apps/web/src/contentSupply/system/contentSupplySystem',()=>({contentSupplySystem:{execute:fixture.rehydrate}}));
import {syncAccountLibrary} from '../../../apps/web/src/data/library/cloudSyncService';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();fixture.sync.mockReset();fixture.rehydrate.mockReset();});
const setup=()=>{vi.stubGlobal('window',new EventTarget());vi.stubGlobal('navigator',{});const controllers:AbortController[]=[];
 vi.spyOn(AbortSignal,'timeout').mockImplementation(()=>{const controller=new AbortController();controllers.push(controller);return controller.signal;});return controllers;};

test('artifact recovery receives a fresh deadline after a long successful Library restore',async()=>{
 const controllers=setup();
 fixture.sync.mockImplementation(async()=>{controllers[0]!.abort(new DOMException('Transfer deadline expired during local validation','TimeoutError'));});
 fixture.rehydrate.mockImplementation(async(input:{kind:string;signal:AbortSignal})=>{expect(input.kind).toBe('rehydrate');expect(input.signal.aborted).toBe(false);});
 await syncAccountLibrary();
 expect(controllers).toHaveLength(2);expect(fixture.rehydrate).toHaveBeenCalledOnce();
 expect(fixture.rehydrate.mock.calls[0]![0].signal).toBe(controllers[1]!.signal);
});

test('failed Library synchronization never starts artifact recovery',async()=>{
 setup();fixture.sync.mockRejectedValue(Error('library_sync_hash'));
 await expect(syncAccountLibrary()).rejects.toThrow('library_sync_hash');expect(fixture.rehydrate).not.toHaveBeenCalled();
});

test('artifact unavailability does not erase a successful Library sync outcome',async()=>{
 setup();fixture.sync.mockResolvedValue(undefined);fixture.rehydrate.mockRejectedValue(Error('artifact_unavailable'));
 await expect(syncAccountLibrary()).resolves.toBeUndefined();expect(fixture.rehydrate).toHaveBeenCalledOnce();
});
