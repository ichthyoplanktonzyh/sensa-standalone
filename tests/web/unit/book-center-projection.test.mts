import assert from 'node:assert/strict';
import {test} from 'vitest';

import type {usePackageLearning} from '../../../apps/web/src/experience/library/usePackageLearning';
import {
 buildPackageCenterItems,
 indexPackageTargets,
 projectPackageContentWindow,
 projectPackageSource,
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

test('learning source lookup resolves the exact admitted publication instead of a shared Book or latest edition',()=>{
 const source=publication({namespace:'publisher',bookId:uuid('601'),bookKey:'original',version:1,title:'Original edition',archive:digest('1'),memberCount:2,targetLanguage:'en',supportLanguage:'zh-CN'});
 const other=publication({...source.book,namespace:'other',bookId:uuid('602'),bookKey:'other',version:1,title:'Other Book',archive:digest('2'),memberCount:1,targetLanguage:'en',supportLanguage:'zh-CN'});
 const newer=publication({namespace:'publisher',bookId:uuid('601'),bookKey:'original',version:2,title:'Latest edition',archive:digest('3'),memberCount:1,targetLanguage:'en',supportLanguage:'zh-CN'});
 const first=packageSummary({key:'old-first',packageId:uuid('701'),title:'First expression',version:1,targetLanguage:'en',supportLanguage:'zh-CN',publications:[other,{...source,memberIndex:0},newer]});
 const second=packageSummary({key:'old-second',packageId:uuid('702'),title:'Second expression',version:1,targetLanguage:'en',supportLanguage:'zh-CN',publications:[{...source,memberIndex:1}]});
 const controller={packages:[second,first],enrollments:[],languageContext:{targetLanguageTag:'de',supportLanguageTag:'fr'}} as unknown as Pick<Controller,'packages'|'enrollments'|'languageContext'>;
 const result=projectPackageSource(controller,first.key,source.bookArchiveSha256);
 assert.equal(result?.title,'Original edition');assert.equal(result?.sourceVersion,1);assert.equal(result?.publicationArchiveSha256,digest('1'));
 assert.deepEqual(result?.installed.map(pack=>pack.key),['old-first','old-second'],'original Manifest positions are preserved');
 assert.equal(result?.routeMatchesActive,false,'a different active Route does not erase the original source');
 assert.equal(result?.descriptor,undefined);assert.equal(result?.updateAvailable,false);assert.equal(result?.updateDownloaded,false);
 assert.equal(projectPackageSource(controller,first.key,digest('9')),undefined,'an absent recorded release never falls back to another publication');
 assert.equal(projectPackageSource(controller,'absent',source.bookArchiveSha256),undefined,'missing source content is not fabricated');
 const portable=projectPackageSource(controller,first.key);
 assert.equal(portable?.title,'First expression','without a Book identity show the exact Portable source rather than choosing a Book');
 assert.equal(portable?.sourceVersion,1);
});

test('complete catalog browsing filters before paging, clamps stale URLs and breaks title/date ties by stable identity',async()=>{
 const {browseCatalog,parseCatalogBrowsing,catalogBrowsingParams,catalogPageNumbers}=await import('../../../apps/web/src/experience/library/packageCatalogBrowsing');
 const items=Array.from({length:137},(_,index)=>({
  key:`book-${index}`,listKey:`published:${String(index).padStart(3,'0')}`,kind:'published' as const,
  title:index===136?'Deep needle':'Same title',description:'Verified public description',count:3,
  targetLanguage:index%2?'ja':'en',supportLanguage:'zh-Hans',installed:[],updateAvailable:false,updateDownloaded:false,enrolled:false,routeMatchesActive:true,
  descriptor:{publisher:{name:'Real publisher'},publishedAt:'2026-10-10T00:00:00Z'},
 })) as unknown as import('../../../apps/web/src/experience/library/packageCenterProjection').PackageCenterItem[];
 const names=new Map([['en','英语'],['ja','日语'],['zh-Hans','简体中文']]);
 const state=parseCatalogBrowsing({page:'6',pageSize:'24',view:'list'});
 const page=browseCatalog(items,state,names,'zh-CN');
 assert.deepEqual([page.page,page.pages,page.total,page.start,page.end],[6,6,137,121,137]);
 assert.equal(page.items.length,17);
 assert.deepEqual(browseCatalog([...items].reverse(),state,names,'zh-CN').items.map(item=>item.key),page.items.map(item=>item.key));
 assert.equal(browseCatalog(items,{...state,query:'Deep needle'},names,'zh-CN').items[0]?.key,'book-136');
 assert.equal(browseCatalog(items,{...state,query:'英语'},names,'zh-CN').total,69);
 assert.equal(browseCatalog(items,{...state,target:'ja',support:'zh-Hans'},names,'zh-CN').total,68);
 const empty=browseCatalog(items,{...state,query:'absent'},names,'zh-CN');
 assert.deepEqual([empty.start,empty.end,empty.total,empty.page],[0,0,0,1]);
 assert.equal(browseCatalog(items,{...state,pageSize:96,page:999},names,'zh-CN').page,2);
 assert.deepEqual(parseCatalogBrowsing({page:'-2',pageSize:'12',sort:'unknown',view:'unknown'}),{query:'',target:'',support:'',sort:'title',page:1,pageSize:24,view:'cards'});
 assert.deepEqual(parseCatalogBrowsing(catalogBrowsingParams({...state,query:'日语',target:'ja',support:'zh-Hans',sort:'newest'})),{...state,query:'日语',target:'ja',support:'zh-Hans',sort:'newest'});
 assert.deepEqual(catalogPageNumbers(6,12),[1,'gap',5,6,7,'gap',12]);
 assert.deepEqual(catalogPageNumbers(1,1),[1]);
 const offsetItems=[
  {...items[0]!,descriptor:{...items[0]!.descriptor!,publishedAt:'2026-10-10T00:30:00+09:00'}},
  {...items[1]!,descriptor:{...items[1]!.descriptor!,publishedAt:'2026-10-09T18:00:00Z'}},
 ];
 assert.deepEqual(browseCatalog(offsetItems,{...state,page:1,sort:'newest'},names,'zh-CN').items.map(item=>item.key),['book-1','book-0']);

});

test('detail metadata separates a newer public edition from the installed examples and never infers absent author/license',async()=>{
 const {projectPackageMetadata}=await import('../../../apps/web/src/experience/library/packageCenterProjection');
 const source=publication({namespace:'publisher',bookId:uuid('601'),bookKey:'meaningful-book',version:1,title:'Earlier title',archive:digest('1'),memberCount:1,targetLanguage:'en',supportLanguage:'zh-CN'});
 const raw=packageSummary({key:'member',packageId:uuid('602'),version:1,title:'Verified member',targetLanguage:'en',supportLanguage:'zh-CN',publications:[source]});
 const installed={...raw,portableOrigin:{...raw.portableOrigin,manifest:{...raw.portableOrigin.manifest,metadata:{...raw.portableOrigin.manifest.metadata,author:{name:'Actual author',url:'https://author.example'},license:{name:'CC0',url:'https://creativecommons.org/publicdomain/zero/1.0/'}}}}};
 const publicItem=descriptor({namespace:'publisher',bookId:uuid('601'),bookKey:'meaningful-book',version:2,title:'Latest title',sha256:digest('2'),memberCount:1,targetLanguage:'en',supportLanguage:'zh-CN'});
 const [item]=buildPackageCenterItems({catalog:[publicItem],packages:[installed],enrollments:[],languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'} as Controller['languageContext']}).catalog;
 const metadata=projectPackageMetadata(item!);
 assert.equal(metadata.version,2);assert.equal(metadata.installedVersion,1);
 assert.deepEqual(metadata.authors,[installed.portableOrigin.manifest.metadata.author]);
 assert.deepEqual(metadata.licenses,[installed.portableOrigin.manifest.metadata.license]);
 assert.equal(metadata.publisher?.name,'publisher');
 const partialNewPublication={...source,book:{...source.book,versionNumber:2},bookArchiveSha256:digest('2'),memberCount:2};
 const shared={...installed,portableOrigin:{...installed.portableOrigin,publications:[source,partialNewPublication]}};
 const [partial]=buildPackageCenterItems({catalog:[{...publicItem,memberCount:2}],packages:[shared],enrollments:[],languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'} as Controller['languageContext']}).catalog;
 assert.equal(partial!.installedArchiveSha256,digest('1'));
 assert.equal(projectPackageMetadata(partial!).installedVersion,1,'partial newer cache membership cannot relabel the complete installed edition');

 const undownloaded=projectPackageMetadata({...item!,installed:[]});
 assert.deepEqual(undownloaded.authors,[]);assert.deepEqual(undownloaded.licenses,[]);assert.equal(undownloaded.installedVersion,undefined);
});
