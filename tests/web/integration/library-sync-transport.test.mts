import {test,expect,afterAll} from 'vitest';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary,writeLibraryState,readLocalLibraryRevision,assertCurrentLibrary} from '../../../apps/web/src/data/library/store';
import {sha256} from '@sensa/learning-kernel';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://sync-transport.fixture.invalid/')});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());
const {synchronizeLibrary,readCloudSync}=await import('../../../apps/web/src/data/library/cloudSync');

test('an unrequested missing hash is a malformed reply, not permission to retry another head',async()=>{
 await openLibrary();const owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()};
 await writeLibraryState(async tx=>tx.put('meta','service-owner',owner));
 const identity=await readLibrary(tx=>tx.get('meta','identity')),calls:string[]=[];
 await expect(synchronizeLibrary(async path=>{
  calls.push(path);
  if(path==='/head')return {revision:1,manifest:['a'.repeat(64)]};
  if(path==='/blocks/fetch')return {blocks:[],missing:['b'.repeat(64)],deferred:[]};
  throw Error('Unexpected request');
 })).rejects.toThrow('library_sync_format');
 expect(calls).toEqual(['/head','/blocks/fetch']);
 expect(await readLibrary(tx=>tx.get('meta','identity'))).toEqual(identity);
 expect(await readLibrary(tx=>tx.count('learningEvents'))).toBe(0);
 expect((await readCloudSync())?.error).toBe('library_sync_format');
});

test('an old confirmed baseline cannot bypass the current checkpoint format gate',async()=>{
 const identity=await readLibrary(tx=>tx.get<any>('meta','identity'));
 const text=JSON.stringify({version:5,libraryId:identity.id,learnerId:identity.learnerId,rows:[]}),hash=sha256(text);
 await writeLibraryState(async tx=>{
  const owner=await tx.get<any>('meta','service-owner');
  tx.put('meta','cloud-sync',{owner,incarnation:await assertCurrentLibrary(tx),revision:1,status:'synced',syncedLocalRevision:await readLocalLibraryRevision(tx)});
  tx.replaceSyncBase([{table:'meta',key:'identity',value:encodeBackupValue(identity),blocks:['c'.repeat(64)]}]);
 });
 const calls:string[]=[];
 await expect(synchronizeLibrary(async path=>{
  calls.push(path);
  if(path==='/head')return {revision:1,manifest:[hash]};
  if(path==='/blocks/fetch')return {blocks:[{hash,data:text}],missing:[],deferred:[]};
  throw Error('Unexpected request');
 })).rejects.toThrow('library_sync_incompatible_checkpoint');
 expect(calls).toEqual(['/head','/blocks/fetch']);
 expect(await readLibrary(tx=>tx.get('meta','identity'))).toEqual(identity);
 expect((await readCloudSync())?.failureKind).toBe('terminal');
});
