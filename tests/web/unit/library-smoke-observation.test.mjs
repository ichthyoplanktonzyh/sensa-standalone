import {test,expect} from 'vitest';
import {runInNewContext} from 'node:vm';
import {observeLibrarySmoke} from '../support/librarySmokeObservation';
const state={owner:{accountId:'fixture-account'},incarnation:'current'};
const makeBridge=(extra={})=>({syncStatus:async()=> 'synced',cloudSyncStateForTest:async()=>state,cloudCheckpointForTest:async()=>({state,refs:['current']}),durableBackupFactsForTest:async()=>({facts:['current']}),seedSemanticWorld:async()=>{},...extra});

test('no library method is read before asynchronous bridge initialization; later observations reacquire the current bridge',async()=>{
 const inPage=runInNewContext('('+String(observeLibrarySmoke)+')',{window:{},Error,JSON});
 expect(await inPage({operation:'facts'})).toEqual({state:'initializing'});
 let bridge,reads=0;
 for(const operation of ['ready','status','checkpoint','facts'])expect(await observeLibrarySmoke({operation},()=>bridge)).toEqual({state:'initializing'});
 bridge=makeBridge({durableBackupFactsForTest:async()=>{reads++;return {facts:['first']};}});
 expect(await observeLibrarySmoke({operation:'facts'},()=>bridge)).toMatchObject({state:'ready',value:{facts:['first']}});expect(reads).toBe(1);
 bridge=makeBridge();expect(await observeLibrarySmoke({operation:'facts'},()=>bridge)).toMatchObject({state:'ready',value:{facts:['current']}});expect(reads).toBe(1);
});

test('only an exact retired status read at the declared native replacement boundary may wait',async()=>{
 const retired=()=>{throw Error('localFlow.libraryReplaced');};
 const bridge=makeBridge({syncStatus:retired,durableBackupFactsForTest:retired,cloudCheckpointForTest:retired});
 expect(await observeLibrarySmoke({operation:'status',allowNativeReplacement:true},()=>bridge)).toEqual({state:'library-replacing'});
 await expect(observeLibrarySmoke({operation:'status'},()=>bridge)).rejects.toThrow('localFlow.libraryReplaced');
 for(const operation of ['facts','checkpoint'])await expect(observeLibrarySmoke({operation,allowNativeReplacement:true},()=>bridge)).rejects.toThrow('localFlow.libraryReplaced');
 for(const message of ['localFlow.storageOpen','localFlow.wrongAccount','other localFlow.libraryReplaced error'])await expect(observeLibrarySmoke({operation:'status',allowNativeReplacement:true},()=>makeBridge({syncStatus:async()=>{throw Error(message);}}))).rejects.toThrow(message);
});

test('facts and checkpoint cannot cross bridge, physical selection, owner or library-incarnation changes',async()=>{
 for(const operation of ['facts','checkpoint']){
  for(const changed of [{...state,incarnation:'new'},{...state,owner:{accountId:'other'}}]){
   let reads=0;const bridge=makeBridge({cloudSyncStateForTest:async()=>reads++===0?state:changed});
   await expect(observeLibrarySmoke({operation},()=>bridge)).rejects.toThrow('libraryChangedDuringRead');
  }
  const method=operation==='facts'?'durableBackupFactsForTest':'cloudCheckpointForTest';
  let current=makeBridge();const old=makeBridge({[method]:async()=>{current=makeBridge();return {facts:['retired']};}});current=old;
  await expect(observeLibrarySmoke({operation},()=>current)).rejects.toThrow('bridgeReplaced');
  let selection='old';const withoutCloudState=makeBridge({cloudSyncStateForTest:async()=>undefined,[method]:async()=>{selection='new';return {facts:['replaced']};}});
  await expect(observeLibrarySmoke({operation},()=>withoutCloudState,()=>selection)).rejects.toThrow('libraryChangedDuringRead');
  const stableWithoutCloudState=makeBridge({cloudSyncStateForTest:async()=>undefined});
  expect(await observeLibrarySmoke({operation},()=>stableWithoutCloudState,()=>selection)).toMatchObject({state:'ready'});
 }
});

test('ready status and full final facts are returned unchanged; failed status cannot become synced',async()=>{
 for(const status of ['none','syncing','failed','synced']){const bridge=makeBridge({syncStatus:async()=>status});expect(await observeLibrarySmoke({operation:'status',allowNativeReplacement:true},()=>bridge)).toMatchObject({state:'ready',value:status});}
 const facts={meanings:[{id:'preserved'}],learning:[{id:'real-evidence'}]};
 const bridge=makeBridge({durableBackupFactsForTest:async()=>facts});
 expect((await observeLibrarySmoke({operation:'facts'},()=>bridge)).value).toBe(facts);
});
