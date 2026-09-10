/** Existing v2 IndexedDB records must survive the production v3 opening. */
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {IDBFactory} from 'fake-indexeddb';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
const root=await mkdtemp(join(tmpdir(),'sensa-library-upgrade-'));
const factory=new IDBFactory();Object.assign(globalThis,{indexedDB:factory,window:new EventTarget(),BroadcastChannel:undefined});
const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:'2026-09-09T00:00:00Z',schemaVersion:1};
const draft={id:crypto.randomUUID(),text:'preserved source',revision:1};
try{
 const old=await new Promise<IDBDatabase>((resolve,reject)=>{const r=factory.open('sensa:local-library:v1',2);r.onupgradeneeded=()=>{for(const name of ['meta','drafts','providers','settings','operations','sessions','meanings','identities'])r.result.createObjectStore(name);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise<void>((resolve,reject)=>{const tx=old.transaction(['meta','drafts','operations'],'readwrite');tx.objectStore('meta').put(identity,'identity');tx.objectStore('drafts').put(draft,draft.id);tx.objectStore('operations').put({input:canonicalConsumerJson({kind:'library.create',input:{}}),result:identity,committedAt:identity.createdAt},'00000000-0000-4000-8000-000000000001');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});old.close();
 const file=join(root,'store.mjs');await build({entryPoints:['apps/web/src/data/library/store.ts'],outfile:file,bundle:true,platform:'browser',format:'esm',logLevel:'silent'});const store=await import(pathToFileURL(file).href);
 assert.deepEqual(await store.openLibrary(),identity);assert.deepEqual(await store.readLibrary((tx:any)=>tx.all('drafts')),[draft]);
 assert.deepEqual(await store.readLibrary((tx:any)=>tx.all('learningEvents')),[]);
 assert.equal((await store.readLibrary((tx:any)=>tx.all('operations'))).length,1);
 console.log('PASS: real production v2-to-v3 opening preserves source records, identity and operation ledger while creating new learning stores. Fake IndexedDB; browser SW upgrade is checked separately.');
}finally{await rm(root,{recursive:true,force:true});}
