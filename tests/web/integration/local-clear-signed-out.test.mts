import {test,expect} from 'vitest';
Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:{origin:'http://127.0.0.1:4319'}});
const library=await import('../../../apps/web/src/data/library/store');
const drafts=await import('../../../apps/web/src/data/library/drafts');
const control=await import('../../../apps/web/src/data/library/dataControl');

test('signed-out pending changes need an explicit discard but not another login or a fictitious sync failure',async()=>{
 const original=await library.openLibrary(),owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()},epoch=crypto.randomUUID();
 await library.command({id:crypto.randomUUID(),kind:'service.signout',input:{}},async tx=>{tx.put('meta','service-owner',owner);tx.put('meta','signed-out',true);tx.put('meta','service-signout-epoch',epoch);});
 const draft={id:crypto.randomUUID(),expectedRevision:0,text:'This change has never reached the account.'};await drafts.saveDraft(crypto.randomUUID(),draft);
 const preview=await control.inspectLocalClear();expect(preview.pendingSync).toBeGreaterThan(0);expect(preview.canSync).toBe(false);expect(preview.syncAttempt).toBe('unavailable');
 let calls=0;expect(await control.attemptLocalClearSync(preview,async()=>{calls++;})).toEqual(preview);expect(calls).toBe(0);
 await expect(control.clearLocalLibrary(preview)).rejects.toThrow('localFlow.clearSyncRequired');expect((await drafts.listDrafts()).map(row=>row.id)).toContain(draft.id);
 // Isolate the live permission check without changing preview revision/ops.
 // A now-connected account cannot reuse the prior unavailable-discard permit.
 await library.writeLibraryState(async tx=>{tx.put('meta','signed-out',false);});
 await expect(control.clearLocalLibrary(preview,{discardPendingSync:true})).rejects.toThrow('localFlow.clearSyncRequired');
 expect((await drafts.listDrafts()).map(row=>row.id)).toContain(draft.id);
 await library.writeLibraryState(async tx=>{tx.put('meta','signed-out',true);});
 await control.clearLocalLibrary(preview,{discardPendingSync:true});
 expect(await drafts.listDrafts()).toEqual([]);expect((await library.readLibrary(tx=>tx.get<typeof original>('meta','identity')))?.id).not.toBe(original.id);
 expect(await library.readLibrary(tx=>tx.get('meta','service-owner'))).toEqual(owner);
 expect(await library.readLibrary(tx=>tx.get('meta','signed-out'))).toBe(true);expect(await library.readLibrary(tx=>tx.get('meta','service-signout-epoch'))).toBe(epoch);
 expect(await library.readLibrary(tx=>tx.get('meta','local-reset'))).toBe('local-clear');
});
