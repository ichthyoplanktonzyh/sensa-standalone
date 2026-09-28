import assert from 'node:assert/strict';
import {test,vi} from 'vitest';
import {canonicalConsumerJson,defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';

const resourceModule=vi.hoisted(()=>({failImport:false}));
vi.mock('../../../apps/web/src/contentSupply/system/contentSupplySystem.ts',()=>{
 if(resourceModule.failImport)throw new Error('fixture resource module import failure');
 return {contentSupplySystem:{execute:vi.fn()}};
});

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:{origin:'http://127.0.0.1:4319'}});

const {exportLibraryBackup,restoreLibraryBackup}=await import('../../../apps/web/src/data/library/backup.ts');
const {confirmLearningQuantity}=await import('../../../apps/web/src/data/library/learning.ts');
const {readStudyPlans}=await import('../../../apps/web/src/data/library/studyPlans.ts');
const {libraryTables,openLibrary,readLibrary,restoreLibraryTransaction}=await import('../../../apps/web/src/data/library/store.ts');

test('a committed backup restore remains successful when resource refresh is deferred',async()=>{
 const source=await openLibrary();
 await confirmLearningQuantity(crypto.randomUUID(),sensaPinnedLanguageContext(defaultSensaLanguageRoute),20);
 const exported=await exportLibraryBackup('restore-test-password');

 await restoreLibraryTransaction(async tx=>{
  for(const table of libraryTables)tx.clear(table);
  const createdAt=new Date().toISOString();
  const destination={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt,schemaVersion:2 as const};
  tx.put('meta','identity',destination);
  tx.put('operations','00000000-0000-4000-8000-000000000001',{
   input:canonicalConsumerJson({kind:'library.create',input:{}}),result:destination,committedAt:createdAt,
  });
 });

 resourceModule.failImport=true;
 const restored=await restoreLibraryBackup(exported.file,'restore-test-password');

 assert.equal(restored.summary.libraryId,source.id);
 assert.equal(restored.resourceRefresh,'deferred');
 assert.equal((await readLibrary(tx=>tx.get<{id:string}>('meta','identity')))?.id,source.id);
 const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
 assert.equal((await readLibrary(readStudyPlans))[context.languageRouteId]?.dailyNewSenseLimit,20);
 assert(await readLibrary(tx=>tx.get('meta','backup-restored')),'the committed restore marker must survive the follow-up failure');
});
