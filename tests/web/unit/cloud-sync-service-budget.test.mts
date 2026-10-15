/** Service phase budgets, not transport/OPFS or provider authentication proof. */
import {afterEach,expect,test,vi} from 'vitest';
import type {CloudSyncState} from '../../../apps/web/src/data/library/cloudSync';
import {blocksAutomaticCloudSync} from '../../../apps/web/src/data/library/cloudSyncPolicy';

const fixture=vi.hoisted(()=>({sync:vi.fn(),rehydrate:vi.fn(),owner:{subject:'fixture-subject',accountId:'fixture-account'},state:undefined as CloudSyncState|undefined,localRevision:0}));
vi.mock('../../../apps/web/src/data/account/auth',()=>({auth:undefined}));
vi.mock('../../../apps/web/src/data/library/store',()=>({
 readLibrary:async(work:(tx:unknown)=>unknown)=>work({get:async(_table:string,key:string)=>key==='service-owner'?fixture.owner:key==='cloud-sync'?fixture.state:undefined}),
 assertCurrentLibrary:async()=> 'fixture-incarnation',
 readLocalLibraryRevision:async()=>fixture.localRevision,
 readLocalArtifactRevision:async()=>0,
 writeLibraryState:async(work:(tx:unknown)=>unknown)=>work({get:async()=>undefined,put:()=>{}}),
 observeLibrary:()=>()=>{},
}));
vi.mock('../../../apps/web/src/data/library/cloudSync',()=>({synchronizeLibrary:fixture.sync,readCloudReconnectRequired:async()=>false}));
vi.mock('../../../apps/web/src/contentSupply/system/contentSupplySystem',()=>({contentSupplySystem:{execute:fixture.rehydrate}}));
import {syncAccountLibrary} from '../../../apps/web/src/data/library/cloudSyncService';
import {readAccountLibrarySyncActivity,cancelAccountLibrarySync} from '../../../apps/web/src/data/library/cloudSyncActivity';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();fixture.sync.mockReset();fixture.rehydrate.mockReset();fixture.state=undefined;fixture.localRevision=0;});
const setup=()=>{fixture.rehydrate.mockResolvedValue(undefined);vi.stubGlobal('window',new EventTarget());vi.stubGlobal('navigator',{});const controllers:AbortController[]=[];
 vi.spyOn(AbortSignal,'timeout').mockImplementation(()=>{const controller=new AbortController();controllers.push(controller);return controller.signal;});return controllers;};

test('artifact recovery receives a fresh deadline after a long successful Library restore',async()=>{
 const controllers=setup();
 fixture.sync.mockImplementation(async()=>{AbortSignal.timeout(90_000);controllers[0]!.abort(new DOMException('Transfer deadline expired during local validation','TimeoutError'));});
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

const checkpoint=():CloudSyncState=>({owner:fixture.owner,incarnation:'fixture-incarnation',revision:1,status:'synced',checkpointVersion:7,restoreValidationVersion:9,syncedLocalRevision:fixture.localRevision});
const published=()=>({activated:undefined,snapshotAlreadyPublished:{revision:1}});

test('a preparation intent flushes facts and cannot be absorbed by an automatic pass',async()=>{
 setup();fixture.state=checkpoint();let release!:()=>void;
 fixture.sync.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;})).mockResolvedValueOnce(undefined).mockResolvedValueOnce(published());
 const automatic=syncAccountLibrary({automatic:true});await vi.waitFor(()=>expect(fixture.sync).toHaveBeenCalledOnce());
 const prepare=syncAccountLibrary({prepareForAnotherDevice:true});release();await Promise.all([automatic,prepare]);
 expect(fixture.sync.mock.calls.map(call=>call[1].publishSnapshot)).toEqual([undefined,undefined,true]);
 expect(readAccountLibrarySyncActivity()).toMatchObject({preparing:true,status:'ready',revision:1});
});

test('only an initial publication adds one large-library preparation step, never daily edits',async()=>{
 setup();let initial=true;fixture.sync.mockImplementation(async(_request,options)=>{if(!options.publishSnapshot){fixture.state=checkpoint();if(initial){initial=false;return {activated:undefined,initialPublicationConfirmed:true};}}});
 await syncAccountLibrary({automatic:true});
 expect(fixture.sync.mock.calls.map(call=>call[1].publishSnapshot)).toEqual([undefined,'if-large']);
 fixture.sync.mockClear();fixture.localRevision++;fixture.state={...fixture.state!,status:'pending'};
 await syncAccountLibrary({automatic:true});
 expect(fixture.sync.mock.calls.map(call=>call[1].publishSnapshot)).toEqual([undefined]);
});

test('a concurrent local edit after facts synchronization prevents explicit preparation',async()=>{
 setup();fixture.state=checkpoint();fixture.sync.mockImplementation(async()=>{fixture.localRevision++;fixture.state={...fixture.state!,status:'pending'};});
 await expect(syncAccountLibrary({prepareForAnotherDevice:true})).rejects.toThrow('library_sync_local_changed');
 expect(fixture.sync).toHaveBeenCalledOnce();expect(fixture.state.status).toBe('pending');
});

test('automatic source-artifact failure preserves the completed facts checkpoint and is not ready',async()=>{
 setup();fixture.sync.mockImplementation(async(_request,options)=>{if(options.publishSnapshot)throw Error('sqlite_snapshot_source_baseline');fixture.state=checkpoint();return {activated:undefined,initialPublicationConfirmed:true};});
 await expect(syncAccountLibrary({automatic:true})).resolves.toBeUndefined();
 expect(fixture.state).toEqual(checkpoint());expect(readAccountLibrarySyncActivity()).toMatchObject({preparing:true,status:'failed'});
});

test('cancellation targets the displayed preparation and leaves synced facts intact',async()=>{
 setup();fixture.state=checkpoint();fixture.sync.mockImplementation(async(_request,options)=>{
  if(options.publishSnapshot)await new Promise<never>((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 });
 const task=syncAccountLibrary({prepareForAnotherDevice:true});
 await vi.waitFor(()=>expect(readAccountLibrarySyncActivity()).toMatchObject({preparing:true,status:'running'}));
 const id=readAccountLibrarySyncActivity()!.id;cancelAccountLibrarySync(id-1);expect(fixture.sync.mock.calls[1]![1].signal.aborted).toBe(false);
 cancelAccountLibrarySync(id);await expect(task).rejects.toThrow('library_sync_cancelled');
 expect(fixture.state).toEqual(checkpoint());expect(readAccountLibrarySyncActivity()).toMatchObject({preparing:true,status:'cancelled'});
 expect(blocksAutomaticCloudSync({status:'pending',error:'library_sync_cancelled'})).toBe(true);
});

test('a revision-zero merge with an existing cloud head never implies initial source publication',async()=>{
 setup();fixture.state={...checkpoint(),revision:0,status:'pending'};fixture.localRevision=3;
 fixture.sync.mockImplementation(async()=>{fixture.state=checkpoint();});
 await syncAccountLibrary({automatic:true});
 expect(fixture.sync.mock.calls.map(call=>call[1].publishSnapshot)).toEqual([undefined]);
});
