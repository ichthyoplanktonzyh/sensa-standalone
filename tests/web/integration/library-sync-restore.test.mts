/** Shipped sync over SQLite/Wasm, with SQL faults and controlled transport.
 * This proves restore atomicity, not OPFS durability or large-account capacity. */
import {createHash} from 'node:crypto';
import {afterEach,beforeEach,expect,test} from 'vitest';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary,writeLibraryState,readLocalLibraryRevision,type LibraryIdentity} from '../../../apps/web/src/data/library/store';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {saveDraft} from '../../../apps/web/src/data/library/drafts';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {librarySyncBlockFetch} from '@sensa/contracts/sensa';
import type {SyncRequest} from '../../../apps/web/src/data/library/cloudSync';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://restore-atomicity.fixture.invalid/')});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const {synchronizeLibrary,readCloudSync}=await import('../../../apps/web/src/data/library/cloudSync');
let database:Awaited<ReturnType<typeof useNodeLearningCapacityStorage>>,sql:{exec:(statement:string)=>unknown},localIdentity:LibraryIdentity,remoteIdentity:LibraryIdentity;
beforeEach(async()=>{
 database=await useNodeLearningCapacityStorage();sql=Reflect.get(database,'database');
 localIdentity=await openLibrary();remoteIdentity={...localIdentity,id:crypto.randomUUID(),learnerId:crypto.randomUUID()};remoteIdentity.deviceId=remoteIdentity.id;
 await writeLibraryState(async tx=>tx.put('meta','service-owner',{subject:crypto.randomUUID(),accountId:crypto.randomUUID()}));
 blocks.clear();revision=0;manifest=[];onFetch=undefined;
});
afterEach(()=>database.close());
const first={id:crypto.randomUUID(),revision:1,text:'A complete cloud draft.',createdAt:'2026-10-08T00:00:00.000Z',updatedAt:'2026-10-08T00:00:00.000Z'};
const second={...first,id:crypto.randomUUID(),text:'Another remote draft.'};
const blocks=new Map<string,string>();let revision=0,manifest:string[]=[];
function block(text:string){const id=createHash('sha256').update(text).digest('hex');blocks.set(id,text);return id;}
function publish(drafts:typeof first[]){
 const entries=[{table:'meta',key:'identity',value:remoteIdentity},...drafts.map(value=>({table:'drafts',key:value.id,value}))];
 const rows=entries.map(row=>({table:row.table,key:row.key,blocks:[block(JSON.stringify(encodeBackupValue(row.value)))]}));
 manifest=[block(JSON.stringify({version:6,libraryId:remoteIdentity.id,learnerId:remoteIdentity.learnerId,rows}))];revision++;
}
let onFetch:(()=>Promise<void>)|undefined;
const request:SyncRequest=async(path,body)=>{
 if(path==='/head')return {revision,manifest};
 if(path==='/blocks/fetch'){
  await onFetch?.();
  const input=librarySyncBlockFetch.parse(body);
  return {blocks:input.hashes.filter(id=>blocks.has(id)).map(hash=>({hash,data:blocks.get(hash)!})),missing:input.hashes.filter(id=>!blocks.has(id)),deferred:[]};
 }
 throw new Error(`unexpected_restore_request:${path}`);
};
const facts=()=>readLibrary(async tx=>({identity:await tx.get('meta','identity'),creation:await tx.get<{result:LibraryIdentity}>('operations','00000000-0000-4000-8000-000000000001'),drafts:await tx.entries('drafts'),base:await tx.syncBaseEntries(),localRevision:await readLocalLibraryRevision(tx)}));

test('a failed baseline write cannot partially restore cloud identity or learner facts',async()=>{
 publish([first]);const before=await facts();
 sql.exec(`CREATE TEMP TRIGGER deny_restore_baseline BEFORE INSERT ON sensa_sync_base WHEN NEW.record_key='${first.id}' BEGIN SELECT RAISE(ABORT,'controlled restore baseline failure'); END`);
 try{await expect(synchronizeLibrary(request)).rejects.toThrow();}finally{sql.exec('DROP TRIGGER deny_restore_baseline');}
 expect(await facts()).toEqual(before);
 expect((await readCloudSync())?.revision??0).toBe(0);expect((await readCloudSync())?.status).not.toBe('synced');
 await synchronizeLibrary(request);
 const restored=await facts();expect(restored.identity).toEqual({...remoteIdentity,deviceId:localIdentity.deviceId});
 expect(restored.creation?.result).toEqual(restored.identity);expect(restored.drafts.map(row=>row.value)).toEqual([first]);
 expect(restored.base).toHaveLength(2);expect((await readCloudSync())?.revision).toBe(1);expect((await readCloudSync())?.status).toBe('synced');
});

test('a failed learner-fact write rolls back the replacement baseline and remote revision too',async()=>{
 publish([first]);await synchronizeLibrary(request);
 publish([first,second]);const before=await facts();
 sql.exec(`CREATE TEMP TRIGGER deny_restore_fact BEFORE INSERT ON sensa_records WHEN NEW.table_name='drafts' AND NEW.record_key='${second.id}' BEGIN SELECT RAISE(ABORT,'controlled restore fact failure'); END`);
 try{await expect(synchronizeLibrary(request)).rejects.toThrow();}finally{sql.exec('DROP TRIGGER deny_restore_fact');}
 expect(await facts()).toEqual(before);expect((await readCloudSync())?.revision).toBe(1);
 await synchronizeLibrary(request);expect((await facts()).drafts).toHaveLength(2);expect((await readCloudSync())?.revision).toBe(2);expect((await readCloudSync())?.status).toBe('synced');
});

test('a local write during remote download preserves the old baseline and rejects the stale restore',async()=>{
 publish([first,second]);await synchronizeLibrary(request);
 const third={...first,id:crypto.randomUUID(),text:'Must not appear before a current restore.'};publish([first,second,third]);
 const before=await facts(),confirmedRevision=(await readCloudSync())?.revision;let wrote=false;
 onFetch=async()=>{if(wrote)return;wrote=true;await saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:1,text:'Kept while the remote download was in flight.'});};
 try{await expect(synchronizeLibrary(request)).rejects.toThrow('library_sync_local_changed');}finally{onFetch=undefined;}
 const after=await facts();expect(wrote).toBe(true);expect(after.identity).toEqual(before.identity);expect(after.base).toEqual(before.base);
 expect(after.drafts).toHaveLength(2);expect(after.drafts.find(row=>row.key===first.id)?.value.text).toBe('Kept while the remote download was in flight.');
 expect((await readCloudSync())?.revision).toBe(confirmedRevision);expect((await readCloudSync())?.status).toBe('pending');
});

test('an unchanged fallback checkpoint does not reread baseline bodies while applying or confirming it',async()=>{
 // Force the complete validation fallback. Integrity checks remain;
 // redundant captures and manufactured content changes do not.
 publish([first]);await synchronizeLibrary(request);
 const state=(await readCloudSync())!;await writeLibraryState(async tx=>tx.put('meta','cloud-sync',{...state,validationVersion:undefined}));
 const adapter=await sqliteRecordAdapter(),original=adapter.syncBaseEntries.bind(adapter);let fullReads=0;
 adapter.syncBaseEntries=async keys=>{if(keys===undefined)fullReads++;return original(keys);};
 const before=await readLibrary(readLocalLibraryRevision);
 try{await synchronizeLibrary(request);}finally{adapter.syncBaseEntries=original;}
 expect(fullReads).toBe(1);expect(await readLibrary(readLocalLibraryRevision)).toBe(before);expect((await readCloudSync())?.status).toBe('synced');
});

test('a learner write after the atomic restore stays local and pending when sync finishes',async()=>{
 publish([first]);let later:ReturnType<typeof saveDraft>|undefined;
 const write=(event:Event)=>{
  if(!(event as CustomEvent).detail?.tables?.includes('drafts'))return;
  window.removeEventListener('sensa-library-changed',write);
  later=saveDraft(crypto.randomUUID(),{id:first.id,expectedRevision:1,text:'New input after the restore committed.'});
 };
 window.addEventListener('sensa-library-changed',write);
 try{await synchronizeLibrary(request);await later;}finally{window.removeEventListener('sensa-library-changed',write);}
 expect(later).toBeTruthy();const after=await facts();expect(after.drafts[0]?.value.text).toBe('New input after the restore committed.');
 const original=after.base.find(row=>row.table==='drafts');expect(original?.value).toEqual(encodeBackupValue(first));
 expect((await readCloudSync())?.status).toBe('pending');expect((await readCloudSync())?.syncedLocalRevision).not.toBe(after.localRevision);
});
