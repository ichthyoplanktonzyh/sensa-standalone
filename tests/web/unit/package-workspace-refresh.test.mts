import assert from 'node:assert/strict';
import {test} from 'vitest';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system/index.ts';
import {writeLibraryCache,readLibrary} from '../../../apps/web/src/data/library/store.ts';

class FixtureChannel{
 static peers=new Set<FixtureChannel>();
 onmessage:((event:MessageEvent)=>void)|null=null;
 constructor(_name:string){FixtureChannel.peers.add(this);}
 postMessage(data:unknown){for(const peer of FixtureChannel.peers)if(peer!==this)peer.onmessage?.(new MessageEvent('message',{data}));}
 close(){FixtureChannel.peers.delete(this);}
}

test('learning metadata does not invalidate content inventory; catalog writes, cache writes and clear still do',async()=>{
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 const previousChannel=Object.getOwnPropertyDescriptor(globalThis,'BroadcastChannel');
 Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
 Object.defineProperty(globalThis,'BroadcastChannel',{configurable:true,value:FixtureChannel});
 let reads=0;
 const stop=contentSupplySystem.subscribe({kind:'workspace'},()=>{reads++;});
 try{
  await writeLibraryCache(tx=>{
   tx.put('meta','learning-active','synthetic-run');
   tx.put('meta','local-content-revision',1);
   tx.put('learningEvents','synthetic-event',{kind:'test-only'});
  });
  assert.equal(reads,0,'a learning action must not schedule a full content inventory reread');
  await writeLibraryCache(tx=>tx.put('meta','package-catalog',{revision:'synthetic-catalog'}));
  assert.equal(reads,1);
  await writeLibraryCache(tx=>tx.put('settings','transaction-read-copy',{
   nested:{value:'original'},at:new Date('2026-09-30T00:00:00.000Z'),bytes:[1,2,3],
  }));
  await readLibrary(async tx=>{
   type Record={nested:{value:string};at:Date;bytes:number[]};
   const first=(await tx.get<Record>('settings','transaction-read-copy'))!;
   first.nested.value='changed';first.at.setUTCFullYear(2000);first.bytes[0]=99;
   const second=(await tx.get<Record>('settings','transaction-read-copy'))!;
   assert.equal(second.nested.value,'original');
   assert.equal(second.at.getUTCFullYear(),2026);
   assert.deepEqual(second.bytes,[1,2,3]);
  });
  await writeLibraryCache(tx=>tx.delete('packageCache','synthetic-cache'));
  assert.equal(reads,2);
  const other=new FixtureChannel('sensa-local-library');
  other.postMessage({sender:'another-document',tables:['meta'],clears:[],records:[{table:'meta',key:'learning-active'}]});
  assert.equal(reads,2);
  other.postMessage({sender:'another-document',tables:['meta'],clears:[],records:[{table:'meta',key:'package-catalog'}]});
  assert.equal(reads,3,'a changed catalog in another document must still invalidate the workspace');
  other.close();
  await writeLibraryCache(tx=>tx.clear('meta'));
  assert.equal(reads,4,'clear/restore must invalidate even a key-filtered subscription');
  window.dispatchEvent(new Event('sensa-library-changed'));
  assert.equal(reads,5,'an incomplete notification must request a coherent reread');
  stop();
  window.dispatchEvent(new Event('sensa-library-changed'));
  assert.equal(reads,5);
 }finally{
  stop();
  if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else Reflect.deleteProperty(globalThis,'window');
  if(previousChannel)Object.defineProperty(globalThis,'BroadcastChannel',previousChannel);else Reflect.deleteProperty(globalThis,'BroadcastChannel');
 }
});
