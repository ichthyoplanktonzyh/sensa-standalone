import assert from 'node:assert/strict';
import {test} from 'vitest';

import type {usePackageLearning} from '../../../apps/web/src/experience/library/usePackageLearning';
import {
 buildPackageCenterItems,
 indexPackageTargets,
 projectPackageContentWindow,
} from '../../../apps/web/src/experience/library/packageCenterProjection';

type Controller=ReturnType<typeof usePackageLearning>;
type Package=Controller['packages'][number];
type Descriptor=Controller['catalog'][number];
type Publication=Package['portableOrigin']['publications'][number];

const uuid=(suffix:string)=>`00000000-0000-4000-8000-${suffix.padStart(12,'0')}`;
const digest=(char:string)=>char.repeat(64);

const publication=(input:{
 namespace:string;
 bookId:string;
 bookKey:string;
 version:number;
 title:string;
 archive:string;
 memberCount:number;
 targetLanguage:string;
 supportLanguage:string;
}):Publication=>({
 publisher:{namespace:input.namespace,name:input.namespace},
 book:{
  bookId:input.bookId,
  bookKey:input.bookKey,
  bookVersionId:uuid(String(input.version)),
  versionNumber:input.version,
  title:input.title,
  description:`${input.title} description`,
 },
 route:{targetLanguage:input.targetLanguage,supportLanguage:input.supportLanguage},
 memberCount:input.memberCount,
 bookArchiveSha256:input.archive,
 member:{packageId:uuid(String(input.version)),version:input.version},
} as unknown as Publication);

const descriptor=(input:{
 namespace:string;
 bookId:string;
 bookKey:string;
 version:number;
 title:string;
 sha256:string;
 memberCount:number;
 targetLanguage:string;
 supportLanguage:string;
}):Descriptor=>({
 publisher:{namespace:input.namespace,name:input.namespace},
 book:{
  bookId:input.bookId,
  bookKey:input.bookKey,
  bookVersionId:uuid(String(input.version)),
  versionNumber:input.version,
  title:input.title,
  description:`${input.title} description`,
 },
 route:{targetLanguage:input.targetLanguage,supportLanguage:input.supportLanguage},
 sha256:input.sha256,
 memberCount:input.memberCount,
} as unknown as Descriptor);

const packageSummary=(input:{
 key:string;
 packageId:string;
 title:string;
 targetLanguage:string;
 supportLanguage:string;
 version:number;
 publications?:Publication[];
 entries?:readonly {senseVersionId:string;bindingVersionId:string;expression:string;meaning:string}[];
}):Package=>({
 key:input.key,
 digest:digest('f'),
 installedAt:'2026-01-01T00:00:00.000Z',
 hasAssurance:true,
 content:{
  targetLanguage:input.targetLanguage,
  supportLanguage:input.supportLanguage,
  entries:(input.entries??[]).map((entry,index)=>({
   senseId:uuid(String(index+1)),
   bindingId:uuid(String(index+10_001)),
   semantic:{},
   ...entry,
  })),
 },
 portableOrigin:{
  manifest:{metadata:{packageId:input.packageId,version:input.version,title:input.title,description:''}},
  publications:input.publications??[],
 },
} as unknown as Package);

test('package center groups complete publications by book, route and version while retaining independent state',()=>{
 const bookA=uuid('101');
 const bookB=uuid('102');
 const retiredBook=uuid('103');
 const incompleteBook=uuid('104');
 const archiveV1=digest('1');
 const archiveV2=digest('2');
 const archiveRouteB=digest('3');
 const archiveRetired=digest('4');
 const archiveIncomplete=digest('5');
 const packageIdLocal=uuid('201');
 const catalog=[
  descriptor({namespace:'publisher-a',bookId:bookA,bookKey:'book-a',version:2,title:'Book A',sha256:archiveV2,memberCount:2,targetLanguage:'en',supportLanguage:'zh-CN'}),
  descriptor({namespace:'publisher-b',bookId:bookB,bookKey:'book-b-ja',version:1,title:'Book B',sha256:archiveRouteB,memberCount:1,targetLanguage:'ja',supportLanguage:'zh-CN'}),
 ];
 const packages=[
  packageSummary({key:'a-v1-1',packageId:uuid('301'),title:'A v1 member 1',version:1,targetLanguage:'en',supportLanguage:'zh-CN',publications:[publication({namespace:'publisher-a',bookId:bookA,bookKey:'book-a',version:1,title:'Book A',archive:archiveV1,memberCount:2,targetLanguage:'en',supportLanguage:'zh-CN'})]}),
  packageSummary({key:'a-v1-2',packageId:uuid('302'),title:'A v1 member 2',version:1,targetLanguage:'en',supportLanguage:'zh-CN',publications:[publication({namespace:'publisher-a',bookId:bookA,bookKey:'book-a',version:1,title:'Book A',archive:archiveV1,memberCount:2,targetLanguage:'en',supportLanguage:'zh-CN'})]}),
  packageSummary({key:'a-v2-1',packageId:uuid('303'),title:'A v2 member 1',version:2,targetLanguage:'en',supportLanguage:'zh-CN',publications:[publication({namespace:'publisher-a',bookId:bookA,bookKey:'book-a',version:2,title:'Book A',archive:archiveV2,memberCount:2,targetLanguage:'en',supportLanguage:'zh-CN'})]}),
  packageSummary({key:'a-v2-2',packageId:uuid('304'),title:'A v2 member 2',version:2,targetLanguage:'en',supportLanguage:'zh-CN',publications:[publication({namespace:'publisher-a',bookId:bookA,bookKey:'book-a',version:2,title:'Book A',archive:archiveV2,memberCount:2,targetLanguage:'en',supportLanguage:'zh-CN'})]}),
  packageSummary({key:'b-ja-1',packageId:uuid('305'),title:'Book B member',version:1,targetLanguage:'ja',supportLanguage:'zh-CN',publications:[publication({namespace:'publisher-b',bookId:bookB,bookKey:'book-b-ja',version:1,title:'Book B',archive:archiveRouteB,memberCount:1,targetLanguage:'ja',supportLanguage:'zh-CN'})]}),
  packageSummary({key:'retired-1',packageId:uuid('306'),title:'Retired member 1',version:1,targetLanguage:'en',supportLanguage:'zh-CN',publications:[publication({namespace:'publisher-old',bookId:retiredBook,bookKey:'retired-book',version:1,title:'Retired Book',archive:archiveRetired,memberCount:2,targetLanguage:'en',supportLanguage:'zh-CN'})]}),
  packageSummary({key:'retired-2',packageId:uuid('307'),title:'Retired member 2',version:1,targetLanguage:'en',supportLanguage:'zh-CN',publications:[publication({namespace:'publisher-old',bookId:retiredBook,bookKey:'retired-book',version:1,title:'Retired Book',archive:archiveRetired,memberCount:2,targetLanguage:'en',supportLanguage:'zh-CN'})]}),
  packageSummary({key:'incomplete-1',packageId:uuid('308'),title:'Incomplete member',version:1,targetLanguage:'en',supportLanguage:'zh-CN',publications:[publication({namespace:'publisher-old',bookId:incompleteBook,bookKey:'incomplete-book',version:1,title:'Incomplete Book',archive:archiveIncomplete,memberCount:2,targetLanguage:'en',supportLanguage:'zh-CN'})]}),
  packageSummary({key:'local-1',packageId:packageIdLocal,title:'Local Book',version:1,targetLanguage:'en',supportLanguage:'zh-CN'}),
 ];
 const enrollments=[
  {source:{kind:'published_book',publisherNamespace:'publisher-a',bookId:bookA,bookVersionNumber:1}},
  {source:{kind:'portable_package',packageId:packageIdLocal,packageVersion:1}},
 ] as unknown as Controller['enrollments'];
 const languageContext={targetLanguageTag:'en',supportLanguageTag:'zh-CN'} as Controller['languageContext'];

 const result=buildPackageCenterItems({catalog,packages,enrollments,languageContext});
 const bookAItem=result.catalog.find(item=>item.key==='book-a');
 assert.ok(bookAItem);
 assert.deepEqual(bookAItem.installed.map(pack=>pack.key),['a-v2-1','a-v2-2']);
 assert.equal(bookAItem.updateAvailable,true);
 assert.equal(bookAItem.updateDownloaded,true);
 assert.equal(bookAItem.enrolled,false);
 assert.equal(bookAItem.routeMatchesActive,true);
 const bookBItem=result.catalog.find(item=>item.key==='book-b-ja');
 assert.ok(bookBItem);
 assert.deepEqual(bookBItem.installed.map(pack=>pack.key),['b-ja-1']);
 assert.equal(bookBItem.routeMatchesActive,false);
 assert.deepEqual(result.library.map(item=>item.kind),['published','published','retired','local']);
 assert.equal(result.library.some(item=>item.key==='incomplete-book'),false);
 assert.equal(result.library.find(item=>item.kind==='local')?.enrolled,true);
});

test('independent Portable versions share one card and require an explicit update without offering old-version downgrade',()=>{
 const packageId=uuid('500');
 const first=packageSummary({key:'portable-v1',packageId,title:'Portable v1',version:1,targetLanguage:'en',supportLanguage:'zh-CN'});
 const next=packageSummary({key:'portable-v2',packageId,title:'Portable v2',version:2,targetLanguage:'en',supportLanguage:'zh-CN'});
 const controller={catalog:[],packages:[next,first],enrollments:[{source:{kind:'portable_package',packageId,packageVersion:1}}],languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'}} as unknown as Pick<Controller,'catalog'|'packages'|'enrollments'|'languageContext'>;
 const library=buildPackageCenterItems(controller).library;
 assert.equal(library.length,1);
 assert.equal(library[0]?.installed[0]?.key,next.key);
 assert.equal(library[0]?.updateDownloaded,true);
 assert.equal(library[0]?.enrolled,false);
 const applied=buildPackageCenterItems({...controller,enrollments:[{source:{kind:'portable_package',packageId,packageVersion:2}}] as Controller['enrollments']}).library;
 assert.equal(applied[0]?.listKey,library[0]?.listKey,'detail selection must survive a version change');
 assert.equal(applied[0]?.updateDownloaded,false);
 assert.equal(applied[0]?.enrolled,true);
});

test('Book content windows retain the full count while projecting only visible rows',()=>{
 const entries=Array.from({length:10_000},(_,index)=>({
  senseVersionId:`sense-${index}`,
  bindingVersionId:`binding-${index}`,
  expression:`entry-${index}`,
  meaning:`meaning-${index}`,
 }));
 const pack=packageSummary({
  key:'large-book',packageId:uuid('401'),title:'Large Book',version:1,
  targetLanguage:'en',supportLanguage:'zh-CN',entries,
 });
 const targets=[{
  packageKey:'large-book',
  identity:{senseVersionId:'sense-0',bindingVersionId:'binding-0'},
  targetId:'target-0',
 }] as unknown as Controller['targets'];
 const projection=projectPackageContentWindow([pack],indexPackageTargets(targets),50);
 assert.equal(projection.total,10_000);
 assert.equal(projection.entries.length,50);
 assert.equal(projection.entries[0]?.entry.expression,'entry-0');
 assert.equal(projection.entries[0]?.target?.targetId,'target-0');
 assert.equal(projection.entries[49]?.entry.expression,'entry-49');
});
