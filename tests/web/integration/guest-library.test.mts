import assert from 'node:assert/strict';
import {test} from 'vitest';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:{origin:'http://127.0.0.1:4319'}});

const {exportLibraryBackup,inspectLibraryBackup}=await import('../../../apps/web/src/data/library/backup.ts');
const {inspectLocalClear,clearLocalLibrary}=await import('../../../apps/web/src/data/library/dataControl.ts');
const {confirmLearningQuantity}=await import('../../../apps/web/src/data/library/learning.ts');
const {learningOwner}=await import('../../../apps/web/src/data/library/libraryOwnership.ts');
const {openLibrary,readLibrary,restoreLibraryTransaction}=await import('../../../apps/web/src/data/library/store.ts');

test('a guest can keep learning settings and export an account-free library',async()=>{
 const created=await openLibrary();
 assert.equal(await readLibrary(tx=>tx.get('meta','service-owner')),undefined);
 assert.equal((await readLibrary(learningOwner)).id,created.id);
 await confirmLearningQuantity(crypto.randomUUID(),sensaPinnedLanguageContext(defaultSensaLanguageRoute),20);
 const exported=await exportLibraryBackup('guest-backup-password');
 assert.equal(exported.summary.account,null);
 assert.equal((await inspectLibraryBackup(exported.file,'guest-backup-password')).libraryId,created.id);
 const preview=await inspectLocalClear();
 await clearLocalLibrary(preview);
 assert.equal(await readLibrary(tx=>tx.get('meta','service-owner')),undefined);
 assert.notEqual((await readLibrary(tx=>tx.get<{id:string}>('meta','identity')))?.id,created.id);

 // An admitted account may still be offline before its service account id is
 // recorded. Local backup must remain available in that interim state.
 const provisional={subject:crypto.randomUUID(),email:'local@example.invalid'};
 await restoreLibraryTransaction(async tx=>{tx.put('meta','service-owner',provisional);});
 const pending=await exportLibraryBackup('pending-account-password');
 assert.equal(pending.summary.account,provisional.email);
 assert.equal((await inspectLibraryBackup(pending.file,'pending-account-password')).account,provisional.email);
});
