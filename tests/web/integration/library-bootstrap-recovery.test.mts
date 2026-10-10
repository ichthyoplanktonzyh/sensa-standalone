/** Public Library/backup interface. Controlled local storage/Auth; no browser or paid calls. */
import {test,expect,beforeEach,vi} from 'vitest';
import {canonicalConsumerJson,defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
const login=vi.hoisted(()=>({session:null as string|null,cached:null as string|null,signoutError:false,signouts:[] as unknown[]}));
vi.mock('../../../apps/web/src/data/account/auth',()=>({auth:{getSession:async()=>({data:{session:login.session?{user:{id:login.session}}:null}}),signOut:async(options:unknown)=>{login.signouts.push(options);return {error:login.signoutError?new Error('fixture signout failed'):null};}}}));
vi.mock('../../../apps/web/src/data/account/authSessionHint',()=>({cachedAuthSubject:()=>login.cached}));
vi.mock('../../../apps/web/src/contentSupply/system/contentSupplySystem',()=>({contentSupplySystem:{execute:async()=>({blocked:[],failed:[]})}}));
const hintKey='sensa:local-library-present:v1',values=new Map<string,string>();
beforeEach(()=>{
 vi.resetModules();values.clear();login.session=null;login.cached=null;login.signoutError=false;login.signouts=[];
 vi.stubGlobal('window',new EventTarget());vi.stubGlobal('BroadcastChannel',undefined);
 vi.stubGlobal('location',{origin:'http://127.0.0.1:4319'});
 vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)});
});
test('a failed local signout cannot switch the selected physical library',async()=>{
 const library=await store();await library.openLibrary();
 vi.stubGlobal('navigator',{storage:{getDirectory:async()=>({})},locks:{request:async(_name:string,_options:unknown,work:()=>void)=>work()}});
 const {startSeparateLocalLibrary}=await import('../../../apps/web/src/data/library/startSeparateLocalLibrary');
 login.signoutError=true;await expect(startSeparateLocalLibrary()).rejects.toThrow('localFlow.signoutIncomplete');
 expect(values.get('sensa:local-library-selection:v1')).toBeUndefined();expect(login.signouts).toEqual([{scope:'local'}]);
 expect((await library.readLibrary(tx=>tx.get('meta','identity')))).toBeDefined();
});
test('an unreadable selection never opens a guessed pool; explicit start retains its exact bytes',async()=>{
 values.set('sensa:local-library-selection:v1','{broken pointer');
 const location=await import('../../../apps/web/src/data/library/localLibraryLocation');
 expect(location.hasLocalLibrarySelection()).toBe(true);expect(()=>location.localLibraryNamespace()).toThrow('localFlow.storageOpen');
 const namespace=location.selectSeparateLocalLibrary(),binding=JSON.parse(values.get(location.localLibrarySelectionKey)!);
 expect(binding.namespace).toBe(namespace);expect(binding.preservedNamespaces).toEqual([]);
 expect(values.get(binding.unreadableSelectionKey)).toBe('{broken pointer');
});
const store=()=>import('../../../apps/web/src/data/library/store');
const clear=async()=>{const library=await store();await library.restoreLibraryTransaction(async tx=>{for(const table of library.libraryTables)tx.clear(table);});};

test('first use creates one actual identity; reopening verifies the current identity',async()=>{
 const library=await store(),identity=await library.openLibrary();
 expect(await library.openLibrary()).toEqual(identity);expect(values.get(hintKey)).toBe('1');
 expect(await library.readLibrary(tx=>tx.count('operations'))).toBe(1);
 expect(await library.readLibrary(tx=>tx.get('meta','identity'))).toEqual(identity);
});
test('healthy reopening does not commit; receipt repair uses the actual identity and corrupt receipts stay rejected',async()=>{
 const library=await store(),identity=await library.openLibrary();
 const adapter=await (await import('../../../apps/web/src/data/library/sqliteAdapter')).sqliteRecordAdapter();
 const commit=vi.spyOn(adapter,'commit');
 expect(await library.openLibrary()).toEqual(identity);expect(commit).not.toHaveBeenCalled();
 commit.mockRestore();
 const key='00000000-0000-4000-8000-000000000001';
 await library.restoreLibraryTransaction(async tx=>tx.delete('operations',key));
 expect(await library.openLibrary()).toEqual(identity);
 const receipt=await library.readLibrary(tx=>tx.get<{input:string;result:unknown}>('operations',key));
 expect(receipt?.result).toEqual(identity);
 await library.restoreLibraryTransaction(async tx=>tx.put('operations',key,{...receipt,result:{...identity,id:crypto.randomUUID()}}));
 await expect(library.openLibrary()).rejects.toThrow('localFlow.libraryMissing');
 await library.restoreLibraryTransaction(async tx=>tx.put('operations',key,{...receipt,input:'wrong creation input'}));
 await expect(library.openLibrary()).rejects.toThrow('localFlow.operationConflict');
 expect(await library.readLibrary(tx=>tx.get('meta','identity'))).toEqual(identity);
});
test('explicit selection retains the old pointer and hint, scopes draft state, and fences the old page',async()=>{
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};
 Object.assign(window,{localStorage:storage});
 const library=await store();await library.openLibrary();
 const location=await import('../../../apps/web/src/data/library/localLibraryLocation');
 expect(location.localLibraryNamespace()).toBeNull();
 const {previewStorage}=await import('../../../apps/web/src/experience/services/previewStorage');
 previewStorage.setItem('content-composer-draft','private old context');previewStorage.setItem('appearance','old appearance');
 const namespace=location.selectSeparateLocalLibrary();
 expect(location.localLibraryNamespace()).toBeNull();expect(values.get(hintKey)).toBe('1');
 expect(JSON.parse(values.get(location.localLibrarySelectionKey)!)).toEqual({namespace,preservedNamespaces:[null]});
 await expect(library.command({id:crypto.randomUUID(),kind:'fixture.stale',input:{}},async tx=>tx.put('settings','stale','must not write'))).rejects.toThrow('localFlow.libraryReplaced');
 expect(()=>previewStorage.setItem('content-composer-draft','stale edit')).toThrow('localFlow.libraryReplaced');
 vi.stubGlobal('navigator',{storage:{getDirectory:async()=>({})},locks:{request:async(_name:string,_options:unknown,work:()=>void)=>work()}});
 await expect((await import('../../../apps/web/src/data/library/startSeparateLocalLibrary')).startSeparateLocalLibrary()).rejects.toThrow('localFlow.libraryReplaced');
 expect(login.signouts).toEqual([]);
 vi.resetModules();
 const nextLocation=await import('../../../apps/web/src/data/library/localLibraryLocation'),hint=await import('../../../apps/web/src/data/library/localLibraryHint');
 expect(nextLocation.localLibraryNamespace()).toBe(namespace);expect(hint.hasLocalLibraryHint()).toBe(false);
 expect(nextLocation.localLibraryPoolDirectory(namespace)).not.toBe(nextLocation.localLibraryPoolDirectory(null));
 expect(()=>nextLocation.localLibraryPoolDirectory('../old')).toThrow('localFlow.storageOpen');
 const nextPreview=(await import('../../../apps/web/src/experience/services/previewStorage')).previewStorage;
 expect(nextPreview.getItem('content-composer-draft')).toBeNull();expect(nextPreview.getItem('appearance')).toBe('old appearance');
 nextPreview.setItem('content-composer-draft','new draft');
 expect(values.get('sensa:web-ui:v1:content-composer-draft')).toBe('private old context');
 const identity=await (await store()).openLibrary();expect(identity.id).toBeTruthy();
 expect(values.get(hintKey)).toBe('1');expect(values.get(nextLocation.localLibraryScopedName(hintKey))).toBe('1');
});
test('a prior-open hint rejects an empty replacement without creating identity or receipts',async()=>{
 values.set(hintKey,'1');const library=await store();
 for(let attempt=0;attempt<2;attempt++)await expect(library.openLibrary()).rejects.toThrow('localFlow.libraryMissing');
 expect(await library.readLibrary(tx=>tx.count('meta'))).toBe(0);expect(await library.readLibrary(tx=>tx.count('operations'))).toBe(0);
 const work=vi.fn(async tx=>{tx.put('settings','new-plan',{value:'must not write'});return null;});
 await expect(library.command({id:crypto.randomUUID(),kind:'fixture.pending-command',input:{}},work)).rejects.toThrow('localFlow.libraryMissing');
 expect(work).not.toHaveBeenCalled();expect(await library.readLibrary(tx=>tx.count('settings'))).toBe(0);
});
test('an orphaned creation receipt cannot pretend a missing identity survived',async()=>{
 const library=await store(),identity=await library.openLibrary();values.clear();
 await library.restoreLibraryTransaction(async tx=>{tx.delete('meta','identity');});
 await expect(library.openLibrary()).rejects.toThrow('localFlow.libraryMissing');
 expect(await library.readLibrary(tx=>tx.get('meta','identity'))).toBeUndefined();
 expect(await library.readLibrary(tx=>tx.get<{result:unknown}>('operations','00000000-0000-4000-8000-000000000001'))).toMatchObject({result:identity});
});
test('owned records without identity or hint are preserved, not assigned to a new learner',async()=>{
 const library=await store();await library.restoreLibraryTransaction(async tx=>tx.put('settings','fixture-owned',{value:'retain this'}));
 await expect(library.openLibrary()).rejects.toThrow('localFlow.libraryMissing');
 expect(await library.readLibrary(tx=>tx.get('settings','fixture-owned'))).toEqual({value:'retain this'});
 expect(await library.readLibrary(tx=>tx.get('meta','identity'))).toBeUndefined();
});
test('an explicit valid guest backup restores its original facts into a missing-identity destination',async()=>{
 const library=await store(),source=await library.openLibrary();
 const {confirmLearningQuantity}=await import('../../../apps/web/src/data/library/learning');
 await confirmLearningQuantity(crypto.randomUUID(),sensaPinnedLanguageContext(defaultSensaLanguageRoute),20);
 const backup=await import('../../../apps/web/src/data/library/backup'),file=await backup.exportLibraryBackup('recovery-test-password');
 await clear();await expect(library.openLibrary()).rejects.toThrow('localFlow.libraryMissing');
 await expect(backup.restoreLibraryBackup(file.file,'wrong-test-password')).rejects.toThrow('libraryBackup.errors.invalidFile');
 expect(await library.readLibrary(tx=>tx.get('meta','identity'))).toBeUndefined();
 const restored=await backup.restoreLibraryBackup(file.file,'recovery-test-password');
 expect(restored.summary.libraryId).toBe(source.id);
 const identity=await library.readLibrary(tx=>tx.get<typeof source>('meta','identity'));
 expect(identity).toMatchObject({id:source.id,learnerId:source.learnerId});expect(identity!.deviceId).not.toBe(source.deviceId);
 expect(await library.readLibrary(tx=>tx.get('settings','language-route-study-plans'))).toBeDefined();
});
test('an empty Home creates no preparation receipt and a confirmed empty preparation never blocks backup recovery',async()=>{
 const library=await store(),source=await library.openLibrary();
 const {confirmLearningQuantity,prepareLearningQueue}=await import('../../../apps/web/src/data/library/learning');
 const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
 await confirmLearningQuantity(crypto.randomUUID(),context,20);
 const backup=await import('../../../apps/web/src/data/library/backup'),exported=await backup.exportLibraryBackup('empty-home-test-password');
 await clear();values.delete(hintKey);await library.restoreLibraryTransaction(async tx=>{tx.put('meta','local-reset','account-deletion');tx.put('meta','signed-out',true);});
 const destination=await library.openLibrary(),before=await library.readLibrary(tx=>tx.entries('operations'));
 expect(await prepareLearningQueue(context)).toEqual([]);
 expect(await library.readLibrary(tx=>tx.entries('operations'))).toEqual(before);
 // The exact no-fact receipt observed in a previously opened empty Home.
 await library.command({id:crypto.randomUUID(),kind:'learning.materialize',input:{languageContext:context,day:new Date().toDateString(),trigger:'daily'}},async()=>[]);
 expect(await backup.isLibraryBackupDestinationEmpty()).toBe(true);
 await backup.restoreLibraryBackup(exported.file,'empty-home-test-password');
 expect(await library.readLibrary(tx=>tx.get('meta','identity'))).toMatchObject({id:source.id,deviceId:destination.deviceId});
});
test('a nonempty preparation result or an unrelated receipt remains protected from backup overwrite',async()=>{
 const library=await store();await library.openLibrary();
 const backup=await import('../../../apps/web/src/data/library/backup');
 const exported=await backup.exportLibraryBackup('receipt-protection-password');
 for(const entry of [{kind:'learning.materialize',result:['retained-target-id']},{kind:'fixture.explicit-history',result:[]}]){
  await clear();values.delete(hintKey);await library.restoreLibraryTransaction(async tx=>{tx.put('meta','local-reset','account-deletion');tx.put('meta','signed-out',true);});await library.openLibrary();
  await library.command({id:crypto.randomUUID(),kind:entry.kind,input:{}},async()=>entry.result);
  const before=await library.readLibrary(tx=>tx.entries('operations'));
  expect(await backup.isLibraryBackupDestinationEmpty()).toBe(false);
  await expect(backup.restoreLibraryBackup(exported.file,'receipt-protection-password')).rejects.toThrow('libraryBackup.errors.occupied');
  expect(await library.readLibrary(tx=>tx.entries('operations'))).toEqual(before);
 }
});
test('prior-use metadata or non-bootstrap receipts cannot become a new library without a hint',async()=>{
 const library=await store();
 await library.restoreLibraryTransaction(async tx=>tx.put('meta','service-installation',crypto.randomUUID()));
 await expect(library.openLibrary()).rejects.toThrow('localFlow.libraryMissing');
 await clear();values.clear();
 await library.restoreLibraryTransaction(async tx=>tx.put('operations',crypto.randomUUID(),{input:canonicalConsumerJson({kind:'personal.meaning.save',input:{}}),result:null}));
 await expect(library.openLibrary()).rejects.toThrow('localFlow.libraryMissing');
 expect(await library.readLibrary(tx=>tx.get('meta','identity'))).toBeUndefined();
 expect(await library.readLibrary(tx=>tx.count('operations'))).toBe(1);
});
test('only an explicit account-deletion witness allows the remaining reset metadata on first use',async()=>{
 const library=await store();
 await library.restoreLibraryTransaction(async tx=>{tx.put('meta','local-reset','account-deletion');tx.put('meta','signed-out',true);tx.put('meta','local-incarnation',crypto.randomUUID());});
 await library.restoreLibraryTransaction(async tx=>tx.put('settings','retained',{value:'must preserve'}));
 await expect(library.openLibrary()).rejects.toThrow('localFlow.libraryMissing');
 await library.restoreLibraryTransaction(async tx=>tx.delete('settings','retained'));
 const identity=await library.openLibrary();expect(identity.id).toBeTruthy();
 expect(await library.readLibrary(tx=>tx.get('meta','local-reset'))).toBeUndefined();
});
test('switching the current account during a recovery scan rejects the atomic commit',async()=>{
 const library=await store();await library.openLibrary();
 const subject=crypto.randomUUID(),owner={subject,email:'recovery@sensa.invalid',accountId:crypto.randomUUID()};
 await library.restoreLibraryTransaction(async tx=>tx.put('meta','service-owner',owner));
 const backup=await import('../../../apps/web/src/data/library/backup'),file=await backup.exportLibraryBackup('recovery-test-password');
 await clear();login.session=subject;login.cached=subject;
 const adapter=await (await import('../../../apps/web/src/data/library/sqliteAdapter')).sqliteRecordAdapter();
 const entries=adapter.entries.bind(adapter),spy=vi.spyOn(adapter,'entries').mockImplementation(async table=>{const result=await entries(table);if(table==='settings')login.cached=null;return result;});
 try{await expect(backup.restoreLibraryBackup(file.file,'recovery-test-password')).rejects.toThrow('libraryBackup.errors.accountMismatch');}finally{spy.mockRestore();}
 expect(await library.readLibrary(tx=>tx.get('meta','identity'))).toBeUndefined();
 expect(await library.readLibrary(tx=>tx.count('operations'))).toBe(0);
});
test('account recovery requires the original current login and cannot overwrite concurrently added data',async()=>{
 const library=await store();await library.openLibrary();
 const subject=crypto.randomUUID(),owner={subject,email:'recovery@sensa.invalid',accountId:crypto.randomUUID()};
 await library.restoreLibraryTransaction(async tx=>tx.put('meta','service-owner',owner));
 const backup=await import('../../../apps/web/src/data/library/backup'),file=await backup.exportLibraryBackup('recovery-test-password');
 await clear();
 for(const current of [null,crypto.randomUUID()]){login.session=current;login.cached=current;await expect(backup.restoreLibraryBackup(file.file,'recovery-test-password')).rejects.toThrow('libraryBackup.errors.accountMismatch');}
 // Surviving owner metadata is not a substitute for the original current login.
 await library.restoreLibraryTransaction(async tx=>tx.put('meta','service-owner',owner));
 await expect(backup.restoreLibraryBackup(file.file,'recovery-test-password')).rejects.toThrow('libraryBackup.errors.accountMismatch');
 await library.restoreLibraryTransaction(async tx=>tx.delete('meta','service-owner'));
 expect(await library.readLibrary(tx=>tx.get('meta','identity'))).toBeUndefined();
 login.session=subject;login.cached=crypto.randomUUID();
 await expect(backup.restoreLibraryBackup(file.file,'recovery-test-password')).rejects.toThrow('libraryBackup.errors.accountMismatch');
 login.cached=subject;
 await library.restoreLibraryTransaction(async tx=>tx.put('settings','new-user-data',{keep:true}));
 await expect(backup.restoreLibraryBackup(file.file,'recovery-test-password')).rejects.toThrow('libraryBackup.errors.occupied');
 expect(await library.readLibrary(tx=>tx.get('settings','new-user-data'))).toEqual({keep:true});
 await library.restoreLibraryTransaction(async tx=>tx.delete('settings','new-user-data'));
 await backup.restoreLibraryBackup(file.file,'recovery-test-password');
 expect(await library.readLibrary(tx=>tx.get('meta','service-owner'))).toEqual(owner);
});
