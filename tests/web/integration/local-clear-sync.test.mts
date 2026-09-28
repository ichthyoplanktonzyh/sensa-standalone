import assert from 'node:assert/strict';
import {test} from 'vitest';
import {librarySyncTables} from '@sensa/contracts/sensa';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec.ts';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry} from '../../../apps/web/src/data/library/replication/libraryReplica.ts';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:{origin:'http://127.0.0.1:4319'}});

const {inspectLocalClear,attemptLocalClearSync,clearLocalLibrary}=await import('../../../apps/web/src/data/library/dataControl.ts');
const {saveDraft,listDrafts}=await import('../../../apps/web/src/data/library/drafts.ts');
const {openLibrary,command,readLibrary,readLocalLibraryRevision,writeLibraryState,assertCurrentLibrary}=await import('../../../apps/web/src/data/library/store.ts');

test('local clearance checkpoints pending account records or requires a current explicit discard',async()=>{
 const identity=await openLibrary(),owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()};
 await command({id:crypto.randomUUID(),kind:'fixture.connect',input:{}},async tx=>{tx.put('meta','service-owner',owner);});
 const confirmCheckpoint=async()=>{
  const snapshot=await readLibrary(async tx=>{
   const currentIdentity=(await tx.get('meta','identity')) as typeof identity,entries:any[]=[];
   for(const table of librarySyncTables)for(const row of await tx.entries(table))if(isReplicatedLibraryEntry(table,row.key)){
    const normalized=normalizeLibraryReplicaEntry({table,key:row.key,value:row.value},currentIdentity);
    entries.push({...normalized,value:encodeBackupValue(normalized.value)});
   }
   return {incarnation:await assertCurrentLibrary(tx),revision:await readLocalLibraryRevision(tx),entries};
  });
  await writeLibraryState(async tx=>{tx.put('meta','cloud-sync',{owner,incarnation:snapshot.incarnation,revision:1,status:'synced',syncedLocalRevision:snapshot.revision});tx.replaceSyncBase(snapshot.entries);});
 };
 await confirmCheckpoint();
 const draftA={id:crypto.randomUUID(),expectedRevision:0,text:'confirmed by the checkpoint'};
 await saveDraft(crypto.randomUUID(),draftA);
 let preview=await inspectLocalClear();
 assert.equal(preview.pendingSync,1);assert.deepEqual(preview.pendingSyncRecords,[{table:'drafts',key:draftA.id}]);
 let syncCalls=0;
 preview=await attemptLocalClearSync(preview,async()=>{syncCalls++;await confirmCheckpoint();});
 assert.equal(preview.syncAttempt,'succeeded');assert.equal(preview.pendingSync,0);

 const draftB={id:crypto.randomUUID(),expectedRevision:0,text:'must survive the failed checkpoint'};
 await saveDraft(crypto.randomUUID(),draftB);preview=await inspectLocalClear();
 await assert.rejects(clearLocalLibrary(preview),/localFlow\.clearSyncRequired/);
 preview=await attemptLocalClearSync(preview,async()=>{syncCalls++;throw new Error('offline');});
 assert.equal(preview.syncAttempt,'failed');assert.equal(preview.pendingSync,1);
 await assert.rejects(clearLocalLibrary(preview),/localFlow\.clearSyncRequired/);
 assert.equal((await listDrafts()).some(draft=>draft.id===draftB.id),true,'a failed checkpoint must preserve local records');

 const draftC={id:crypto.randomUUID(),expectedRevision:0,text:'written after discard confirmation'};
 await saveDraft(crypto.randomUUID(),draftC);
 await assert.rejects(clearLocalLibrary(preview,{discardPendingSync:true}),/localFlow\.clearChanged/);
 preview=await attemptLocalClearSync(await inspectLocalClear(),async()=>{syncCalls++;throw new Error('offline');});
 const priorIdentity=(await readLibrary(tx=>tx.get<{id:string}>('meta','identity')))!.id;
 await clearLocalLibrary(preview,{discardPendingSync:true});
 assert.equal(syncCalls,3);assert.deepEqual(await listDrafts(),[]);
 assert.notEqual((await readLibrary(tx=>tx.get<{id:string}>('meta','identity')))!.id,priorIdentity);
 assert.deepEqual(await readLibrary(tx=>tx.get('meta','service-owner')),owner,'local clearance must retain the account connection without deleting its cloud copy');
});
