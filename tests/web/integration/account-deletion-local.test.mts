import {test,expect} from 'vitest';
Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:{origin:'http://127.0.0.1:4319'}});
const library=await import('../../../apps/web/src/data/library/store');
const drafts=await import('../../../apps/web/src/data/library/drafts');
const {eraseDeletedAccount,accountDeletionLocalScope}=await import('../../../apps/web/src/data/library/dataControl');

test('account deletion rejects ownerless or foreign libraries and only erases the matching owner',async()=>{
 const original=await library.openLibrary(),subject=crypto.randomUUID();
 await expect(eraseDeletedAccount(subject)).rejects.toThrow('localFlow.wrongAccount');
 expect(await library.readLibrary(tx=>tx.get('meta','identity'))).toEqual(original);
 const draft={id:crypto.randomUUID(),expectedRevision:0,text:'Guest data is not part of the deleted account.'};await drafts.saveDraft(crypto.randomUUID(),draft);
 await expect(eraseDeletedAccount(subject)).rejects.toThrow('localFlow.wrongAccount');expect((await drafts.listDrafts()).map(row=>row.id)).toContain(draft.id);
 await library.command({id:crypto.randomUUID(),kind:'service.signout',input:{}},async tx=>{tx.put('meta','signed-out',true);});
 await expect(eraseDeletedAccount(subject)).rejects.toThrow('localFlow.wrongAccount');expect((await drafts.listDrafts()).map(row=>row.id)).toContain(draft.id);
 await library.command({id:crypto.randomUUID(),kind:'service.connect',input:{}},async tx=>{tx.put('meta','service-owner',{subject:crypto.randomUUID()});});
 await expect(eraseDeletedAccount(subject)).rejects.toThrow('localFlow.wrongAccount');expect((await drafts.listDrafts()).map(row=>row.id)).toContain(draft.id);
 await library.command({id:crypto.randomUUID(),kind:'service.connect',input:{}},async tx=>{tx.put('meta','service-owner',{subject});});
 const scope=await accountDeletionLocalScope(subject);
 await expect(eraseDeletedAccount(subject,{...scope,incarnation:crypto.randomUUID()})).rejects.toThrow('localFlow.libraryReplaced');expect((await drafts.listDrafts()).map(row=>row.id)).toContain(draft.id);
 await eraseDeletedAccount(subject);expect(await drafts.listDrafts()).toEqual([]);expect(await library.readLibrary(tx=>tx.get('meta','identity'))).toBeUndefined();
 expect(await library.readLibrary(tx=>tx.get('meta','local-reset'))).toBe('account-deletion');
 // The same confirmed operation may observe its already empty destination.
 await eraseDeletedAccount(subject);expect(await drafts.listDrafts()).toEqual([]);
});
