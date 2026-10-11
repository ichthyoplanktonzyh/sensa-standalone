import assert from 'node:assert/strict';
import {test,vi} from 'vitest';
import {canonicalConsumerJson,defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {gzipSync,gunzipSync,strFromU8,strToU8} from 'fflate';

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
 const fixture=portablePackageFixture({packageId:crypto.randomUUID()});
 const {installPortablePackage}=await import('../../../apps/web/src/contentSupply/portable/portablePackage');
 await installPortablePackage(fixture.bytes,fixture.archiveDigest);
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

test('a backup without public packages needs no resource module and reports its facts completely restored',async()=>{
 vi.resetModules();
 const library=await import('../../../apps/web/src/data/library/store'),backup=await import('../../../apps/web/src/data/library/backup');
 const source=await library.openLibrary(),exported=await backup.exportLibraryBackup('text-only-test-password');
 await library.restoreLibraryTransaction(async tx=>{for(const table of library.libraryTables)tx.clear(table);});
 resourceModule.failImport=true;
 const restored=await backup.restoreLibraryBackup(exported.file,'text-only-test-password');
 assert.equal(restored.summary.packages,0);assert.equal(restored.resourceRefresh,'complete');
 assert.equal((await library.readLibrary(tx=>tx.get<{id:string}>('meta','identity')))?.id,source.id);
});

// Authenticate each malformed archive so rejection exercises frame admission,
// rather than stopping at an unrelated password/digest failure.
const rejectArchiveFrame=async(mutate:(frames:any[])=>void)=>{
 vi.resetModules();
 const library=await import('../../../apps/web/src/data/library/store'),backup=await import('../../../apps/web/src/data/library/backup');
 const {encodeBackupValue}=await import('../../../apps/web/src/data/library/backupCodec');
 await library.openLibrary();
 const {saveDraft}=await import('../../../apps/web/src/data/library/drafts');
 await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'This destination fact must survive invalid archive admission.'});
 const snapshot=()=>library.readLibrary(async tx=>encodeBackupValue(Object.fromEntries(await Promise.all(library.libraryTables.map(async table=>[table,await tx.entries(table)])))));
 const before=await snapshot(),password='malformed-frame-fixture-password',exported=await backup.exportLibraryBackup(password);
 const envelope=JSON.parse(new TextDecoder().decode(exported.file));
 const aad=new TextEncoder().encode('sensa-web-library-backup-v2:PBKDF2-SHA256:600000:AES-256-GCM:gzip');
 const derive=async(salt:Uint8Array)=>{
  const base=await crypto.subtle.importKey('raw',strToU8(password),{name:'PBKDF2'},false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:salt as BufferSource,iterations:600000},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 };
 const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64'),additionalData:aad},await derive(Buffer.from(envelope.salt,'base64')),Buffer.from(envelope.data,'base64'));
 const frames=strFromU8(gunzipSync(new Uint8Array(decoded))).trimEnd().split('\n').map(line=>JSON.parse(line));
 mutate(frames);
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await derive(salt),gzipSync(strToU8(frames.map(frame=>JSON.stringify(frame)).join('\n')+'\n')) as BufferSource);
 const malformed=strToU8(JSON.stringify({...envelope,salt:Buffer.from(salt).toString('base64'),iv:Buffer.from(iv).toString('base64'),data:Buffer.from(encrypted).toString('base64')}));
 await assert.rejects(backup.restoreLibraryBackup(malformed,password),/libraryBackup.errors.invalidFile/);
 assert.deepEqual(await snapshot(),before,'rejected archive must preserve every destination table');
};

test('an authenticated backup with an unknown table is rejected without changing the library',async()=>rejectArchiveFrame(frames=>{
 frames.find(frame=>frame.kind==='row').table='unknownTable';
}));
test('an authenticated backup with an unknown frame is rejected without changing the library',async()=>rejectArchiveFrame(frames=>{
 frames.splice(frames.length-1,0,{kind:'unknownFrame'});
}));
test('an authenticated backup with an extra row field is rejected without changing the library',async()=>rejectArchiveFrame(frames=>{
 frames.find(frame=>frame.kind==='row').extra='unrecognized';
}));
