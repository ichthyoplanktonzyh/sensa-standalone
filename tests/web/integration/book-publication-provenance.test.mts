import {afterAll,test,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {unzipSync,zipSync} from 'fflate';
import {sensaPortableBookManifestSchema,defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary,writeLibraryCache,libraryTables} from '../../../apps/web/src/data/library/store';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {rehydratePublishedPortableInstallations} from '../../../apps/web/src/contentSupply/portable/portableCatalog';
import {orderedBookPackageKeys,packageInstallationSchema,mergePackageInstallationRecovery,type PackageInstallation,type InstalledPackage} from '../../../apps/web/src/data/library/packageRecords';
import {contentSupplyCommand} from '../../../apps/web/src/data/library/contentSupplyAdmission';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('https://book-provenance.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());await openLibrary();
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

test('validated Book installation retains exact Manifest positions for shared members after cache removal',async()=>{
 const first=portableBookDeliveryFixture({packageId:randomUUID(),memberExpressions:['third','first','second']});
 const files=unzipSync(first.bookBytes);
 const secondManifest=sensaPortableBookManifestSchema.parse({...first.manifest,book:{...first.manifest.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:'shared-member-order',title:'Shared members in a different order'},members:[...first.manifest.members].reverse()});
 files['book.json']=new TextEncoder().encode(JSON.stringify(secondManifest));
 const bytes=zipSync(files),second={...first.descriptor,book:secondManifest.book,sha256:digest(bytes),byteLength:bytes.byteLength,url:'https://content.fixture.invalid/shared-order.sensa-book'};
 const fetchBefore=globalThis.fetch;
 globalThis.fetch=async input=>new Response(new Uint8Array(String(input)===first.descriptor.url?first.bookBytes:bytes).buffer);
 try{
  await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:first.descriptor,signal:new AbortController().signal});
  await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:second,signal:new AbortController().signal});
 }finally{globalThis.fetch=fetchBefore;}
 const installations=await readLibrary(tx=>tx.all<PackageInstallation>('packageInstallations'));
 expect(installations).toHaveLength(3);
 for(const [index,member] of first.manifest.members.entries()){
  const installation=installations.find(row=>row.artifact.packageId===member.packageId)!;
  expect(installation.artifact.bookMemberships).toEqual([
   {archiveSha256:first.descriptor.sha256,bookId:first.manifest.book.bookId,bookVersionId:first.manifest.book.bookVersionId,memberIndex:index,memberCount:3},
   {archiveSha256:second.sha256,bookId:second.book.bookId,bookVersionId:second.book.bookVersionId,memberIndex:2-index,memberCount:3},
  ].sort((a,b)=>a.archiveSha256.localeCompare(b.archiveSha256)));
 }
 const originalOrder=first.manifest.members.map(member=>JSON.stringify([member.packageId,String(member.version)]));
 expect(orderedBookPackageKeys(installations,first.descriptor.sha256)).toEqual(originalOrder);
 expect(orderedBookPackageKeys(installations,second.sha256)).toEqual([...originalOrder].reverse());
 expect(()=>orderedBookPackageKeys(installations.slice(1),first.descriptor.sha256)).toThrow('localFlow.catalogMismatch');
 const damaged=structuredClone(installations);
 const changed=damaged[0]!,reference=changed.artifact.bookMemberships!.find(member=>member.archiveSha256===first.descriptor.sha256)!;
 reference.memberIndex=(reference.memberIndex+1)%reference.memberCount;
 expect(mergePackageInstallationRecovery(installations[0],changed)).toBeNull();
 expect(()=>orderedBookPackageKeys(damaged,first.descriptor.sha256)).toThrow('localFlow.catalogMismatch');
 const outside=structuredClone(installations[0]!);outside.artifact.bookMemberships![0]!.memberIndex=3;
 expect(()=>packageInstallationSchema.parse(outside)).toThrow();
 await expect(contentSupplyCommand({id:randomUUID(),kind:'package.install',input:{count:1}},async tx=>{tx.put('packageInstallations',changed.key,changed);})).rejects.toThrow('immutable');
 expect(await readLibrary(tx=>tx.all<PackageInstallation>('packageInstallations'))).toEqual(installations);
 const rows=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as BackupRows;
 rows.packageCache=[];rows.operations=[];
 const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
 validateBackupRows(rows);
 expect(rows.learningTargets).toEqual([]);expect(rows.learningRuns).toEqual([]);
 await writeLibraryCache(async tx=>tx.clear('packageCache'));
 const fetchForRestore=globalThis.fetch,requested:string[]=[];
 globalThis.fetch=async input=>{
  const url=String(input);requested.push(url);
  const delivered=url===first.descriptor.url?first.bookBytes:url===second.url?bytes:undefined;
  if(!delivered)throw new Error('Unexpected fixture download');
  return new Response(new Uint8Array(delivered).buffer);
 };
 try{
  // A readable Package alone is not proof that all its Book sources recovered.
  expect(await rehydratePublishedPortableInstallations([first.descriptor])).toEqual({ready:[],blocked:[...originalOrder].sort(),failed:[]});
  const partial=(await contentSupplySystem.read({kind:'workspace'})).packages;
  expect(partial).toHaveLength(3);
  for(const pack of partial)expect(pack.portableOrigin.publications.map(publication=>publication.bookArchiveSha256)).toEqual([first.descriptor.sha256]);
  requested.length=0;
  const restored=await rehydratePublishedPortableInstallations([first.descriptor,second]);
  expect(restored).toEqual({ready:[...originalOrder].sort(),blocked:[],failed:[]});
  expect(requested).toEqual([second.url]);
  const packages=(await contentSupplySystem.read({kind:'workspace'})).packages;
  expect(packages).toHaveLength(3);
  for(const pack of packages){
   expect(pack.portableOrigin.publications.map(publication=>publication.bookArchiveSha256).sort()).toEqual([first.descriptor.sha256,second.sha256].sort());
   for(const publication of pack.portableOrigin.publications){
    const manifest=publication.bookArchiveSha256===first.descriptor.sha256?first.manifest:secondManifest;
    expect(publication.memberIndex).toBe(manifest.members.findIndex(member=>member.packageId===publication.member.packageId&&member.version===publication.member.version));
   }
  }
  requested.length=0;
  expect(await rehydratePublishedPortableInstallations([])).toEqual(restored);
  expect(requested).toEqual([]);
  // A receiving device can have an older local publication while synchronized
  // installation facts already know its exact position. SHA alone is not enough.
  await writeLibraryCache(async tx=>{
   for(const pack of await tx.all<InstalledPackage>('packageCache'))tx.put('packageCache',pack.key,{...pack,portableOrigin:{...pack.portableOrigin,publications:pack.portableOrigin.publications.map(publication=>{
    if(publication.bookArchiveSha256!==second.sha256)return publication;
    const {memberIndex:discarded,...withoutPosition}=publication;void discarded;return withoutPosition;
   })}});
  });
  expect(await rehydratePublishedPortableInstallations([first.descriptor,second])).toEqual(restored);
  expect(requested).toEqual([second.url]);
  const exact=await readLibrary(tx=>tx.packageCacheProjection({kind:'publication_identities'}));
  for(const value of exact)expect(value.bookMemberships).toEqual(installations.find(installation=>installation.key===value.key)!.artifact.bookMemberships);
  expect(await readLibrary(tx=>tx.all<PackageInstallation>('packageInstallations'))).toEqual(installations);
 }finally{globalThis.fetch=fetchForRestore;}

 // A newly admitted source can appear during network recovery. Remove only its
 // disposable local publication to model another device's cacheless sync facts.
 const thirdManifest=sensaPortableBookManifestSchema.parse({...secondManifest,book:{...secondManifest.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:'concurrent-book'}});
 files['book.json']=new TextEncoder().encode(JSON.stringify(thirdManifest));
 const thirdBytes=zipSync(files),third={...second,book:thirdManifest.book,sha256:digest(thirdBytes),byteLength:thirdBytes.byteLength,url:'https://content.fixture.invalid/concurrent.sensa-book'};
 await writeLibraryCache(async tx=>tx.clear('packageCache'));
 const fetchForConcurrent=globalThis.fetch,concurrentRequests:string[]=[];let admitted=false;
 globalThis.fetch=async input=>{
  const url=String(input);concurrentRequests.push(url);
  if(url===second.url&&!admitted){
   admitted=true;
   await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:third,signal:new AbortController().signal});
   await writeLibraryCache(async tx=>{
    for(const pack of await tx.all<InstalledPackage>('packageCache'))tx.put('packageCache',pack.key,{...pack,portableOrigin:{...pack.portableOrigin,publications:pack.portableOrigin.publications.filter(publication=>publication.bookArchiveSha256!==third.sha256)}});
   });
  }
  const selected=url===first.descriptor.url?first.bookBytes:url===second.url?bytes:url===third.url?thirdBytes:undefined;
  if(!selected)throw new Error('Unexpected concurrent fixture download');
  return new Response(new Uint8Array(selected).buffer);
 };
 try{
  expect(await rehydratePublishedPortableInstallations([first.descriptor,second])).toEqual({ready:[],blocked:[...originalOrder].sort(),failed:[]});
  expect(admitted).toBe(true);
  concurrentRequests.length=0;
  expect(await rehydratePublishedPortableInstallations([first.descriptor,second,third])).toEqual({ready:[...originalOrder].sort(),blocked:[],failed:[]});
  expect(concurrentRequests).toEqual([third.url]);
 }finally{globalThis.fetch=fetchForConcurrent;}
 const concurrentInstallations=await readLibrary(tx=>tx.all<PackageInstallation>('packageInstallations'));
 expect(concurrentInstallations).toHaveLength(3);
 for(const installation of concurrentInstallations)expect(installation.artifact.bookMemberships).toHaveLength(3);

 // Choosing the non-primary Book must pass domain backup validation even when no
 // device cache is transported. Installation alone was never enrollment.
 const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
 await learningSystem.execute({kind:'confirm_quantity',operationId:randomUUID(),languageContext:context,dailyLimit:20});
 await learningSystem.execute({kind:'enroll_book',operationId:randomUUID(),languageContext:context,publicationArchiveSha256:second.sha256});
 const enrolled=await learningSystem.read({kind:'workspace',languageContext:context});
 expect(enrolled.targets).toHaveLength(3);expect(enrolled.enrollments).toHaveLength(1);
 expect(enrolled.enrollments[0]!.source.kind).toBe('published_book');
 expect(enrolled.enrollments[0]!.source).toMatchObject({publicationArchiveSha256:second.sha256});
 const enrolledRows=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as BackupRows;
 validateBackupRows(enrolledRows);
 enrolledRows.packageCache=[];enrolledRows.operations=[];
 validateBackupRows(enrolledRows);
 const forgedBook=structuredClone(enrolledRows);
 forgedBook.packageInstallations[0]!.value.artifact.bookMemberships.find((reference:{archiveSha256:string})=>reference.archiveSha256===second.sha256)!.bookId=randomUUID();
 expect(()=>validateBackupRows(forgedBook)).toThrow();
 const duplicatePosition=structuredClone(enrolledRows);
 const firstPosition=duplicatePosition.packageInstallations[0]!.value.artifact.bookMemberships.find((reference:{archiveSha256:string})=>reference.archiveSha256===second.sha256)!.memberIndex;
 duplicatePosition.packageInstallations[1]!.value.artifact.bookMemberships.find((reference:{archiveSha256:string})=>reference.archiveSha256===second.sha256)!.memberIndex=firstPosition;
 expect(()=>validateBackupRows(duplicatePosition)).toThrow();
 expect(enrolledRows.learningRuns).toEqual([]);expect(enrolledRows.learningEvents).toEqual([]);

 // Fail the final SQLite write after authority checks, not merely preparation.
 // All three shared installations and both cache projections must roll back.
 const rollbackManifest=sensaPortableBookManifestSchema.parse({...thirdManifest,book:{...thirdManifest.book,bookId:randomUUID(),bookVersionId:randomUUID(),bookKey:'rollback-book'}});
 files['book.json']=new TextEncoder().encode(JSON.stringify(rollbackManifest));
 const rollbackBytes=zipSync(files),rollback={...third,book:rollbackManifest.book,sha256:digest(rollbackBytes),byteLength:rollbackBytes.byteLength,url:'https://content.fixture.invalid/rollback.sensa-book'};
 const beforeRollback=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))));
 const adapter=await sqliteRecordAdapter(),commitBefore=adapter.commit,fetchForRollback=globalThis.fetch;
 adapter.commit=async request=>database.commit({...request,puts:[...request.puts,{table:'drafts',key:'',encodedValue:'{}'}]});
 globalThis.fetch=async()=>new Response(new Uint8Array(rollbackBytes).buffer);
 try{
  await expect(contentSupplySystem.execute({kind:'install_catalog_item',descriptor:rollback,signal:new AbortController().signal})).rejects.toThrow();
 }finally{adapter.commit=commitBefore;globalThis.fetch=fetchForRollback;}
 expect(await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))))).toEqual(beforeRollback);
 expect(await readLibrary(tx=>tx.packageCacheProjection({kind:'publication_identities'}))).toEqual(concurrentInstallations.map(installation=>({key:installation.key,digest:installation.artifact.digest,bookArchiveSha256s:[first.descriptor.sha256,second.sha256,third.sha256].sort(),bookMemberships:installation.artifact.bookMemberships!})).sort((a,b)=>a.key.localeCompare(b.key)));
});
