import type {usePackageLearning} from './usePackageLearning';

type Controller=ReturnType<typeof usePackageLearning>;
type InstalledPackage=Controller['packages'][number];
type Descriptor=Controller['catalog'][number];
type Publication=InstalledPackage['portableOrigin']['publications'][number];
type LearningTarget=Controller['targets'][number];

export type PackageCenterItem=Readonly<{
 key:string;
 listKey:string;
 kind:'published'|'retired'|'local';
 title:string;
 description:string;
 count:number;
 targetLanguage:string;
 supportLanguage:string;
 descriptor?:Descriptor;
 publicationArchiveSha256?:string;
 installedArchiveSha256?:string;
 installed:InstalledPackage[];
 updateAvailable:boolean;
 updateDownloaded:boolean;
 enrolled:boolean;
 routeMatchesActive:boolean;
 sourceVersion?:number;
}>;

type ReleaseGroup=Readonly<{
 version:number;
 memberCount:number;
 packages:InstalledPackage[];
 packageKeys:Set<string>;
 memberIndices:Map<string,number>;
}>;

type OrphanReleaseGroup=Readonly<{
 publication:Publication;
 packages:InstalledPackage[];
 packageKeys:Set<string>;
 memberIndices:Map<string,number>;
}>;

const identity=(...parts:string[])=>parts.join('\0');

const routeBookIdentity=(bookId:string,targetLanguage:string,supportLanguage:string)=>identity(
 bookId,targetLanguage,supportLanguage,
);

const publishedBookIdentity=(publisherNamespace:string,bookId:string)=>identity(publisherNamespace,bookId);

const routeMatches=(
 targetLanguage:string,
 supportLanguage:string,
 c:Pick<Controller,'languageContext'>,
)=>
 targetLanguage===c.languageContext.targetLanguageTag
 &&supportLanguage===c.languageContext.supportLanguageTag;

const addPackage=(group:{packages:InstalledPackage[];packageKeys:Set<string>},pack:InstalledPackage)=>{
 if(group.packageKeys.has(pack.key))return;
 group.packageKeys.add(pack.key);
 group.packages.push(pack);
};

const orderAdmittedMembers=(group:{packages:InstalledPackage[];memberIndices:Map<string,number>})=>{
 // Unknown positions keep their recorded display order; do not infer ordinals
 // from Package UUIDs or mix one known position into an unpositioned edition.
 if(group.memberIndices.size!==group.packages.length||new Set(group.memberIndices.values()).size!==group.packages.length)return;
 group.packages.sort((left,right)=>group.memberIndices.get(left.key)!-group.memberIndices.get(right.key)!);
};

/** Build catalog, library and retired Book views with one pass over installed publications. */
export function buildPackageCenterItems(c:Pick<Controller,'catalog'|'packages'|'enrollments'|'languageContext'>):Readonly<{
 catalog:PackageCenterItem[];
 library:PackageCenterItem[];
}>{
 const knownBooks=new Set(c.catalog.map(descriptor=>identity(
  descriptor.publisher.namespace,
  descriptor.book.bookId,
  descriptor.route.targetLanguage,
  descriptor.route.supportLanguage,
 )));
 const firstEnrollmentByBook=new Map<string,Controller['enrollments'][number]>();
 const highestEnrolledVersionByBook=new Map<string,number>();
 const highestEnrolledPackageVersion=new Map<string,number>();
 for(const enrollment of c.enrollments){
  if(enrollment.source.kind==='published_book'){
   const enrollmentKey=publishedBookIdentity(enrollment.source.publisherNamespace,enrollment.source.bookId);
   if(!firstEnrollmentByBook.has(enrollmentKey))firstEnrollmentByBook.set(enrollmentKey,enrollment);
   highestEnrolledVersionByBook.set(
    enrollmentKey,
    Math.max(highestEnrolledVersionByBook.get(enrollmentKey)??0,enrollment.source.bookVersionNumber),
   );
  }else if(enrollment.source.kind==='portable_package'){
   highestEnrolledPackageVersion.set(
    enrollment.source.packageId,
    Math.max(highestEnrolledPackageVersion.get(enrollment.source.packageId)??0,enrollment.source.packageVersion),
   );
  }
 }

 const bookReleases=new Map<string,Map<string,ReleaseGroup>>();
 const orphanGroups=new Map<string,Map<string,OrphanReleaseGroup>>();
 const local:PackageCenterItem[]=[];
 const latestLocal=new Map<string,InstalledPackage>();
 for(const pack of c.packages){
  if(pack.portableOrigin.publications.length)continue;
  const {packageId,version}=pack.portableOrigin.manifest.metadata;
  if(version>(latestLocal.get(packageId)?.portableOrigin.manifest.metadata.version??0))latestLocal.set(packageId,pack);
 }
 for(const pack of c.packages){
  const publications=pack.portableOrigin.publications;
  if(!publications.length){
   const {packageId,version}=pack.portableOrigin.manifest.metadata;
   if(latestLocal.get(packageId)!==pack)continue;
   const enrolledVersion=highestEnrolledPackageVersion.get(packageId)??0;
   local.push({
    key:packageId,
    listKey:`local:${packageId}`,
    kind:'local',
    title:pack.portableOrigin.manifest.metadata.title,
    description:pack.portableOrigin.manifest.metadata.description,
    count:pack.content.entries.length,
    targetLanguage:pack.content.targetLanguage,
    supportLanguage:pack.content.supportLanguage,
    installed:[pack],
    updateAvailable:enrolledVersion>0&&version>enrolledVersion,
    updateDownloaded:enrolledVersion>0&&version>enrolledVersion,
    enrolled:enrolledVersion>=version,
    routeMatchesActive:routeMatches(pack.content.targetLanguage,pack.content.supportLanguage,c),
   });
   continue;
  }

  for(const publication of publications){
   if(publication.route.targetLanguage===pack.content.targetLanguage
    &&publication.route.supportLanguage===pack.content.supportLanguage){
    const bookKey=routeBookIdentity(
     publication.book.bookId,
     publication.route.targetLanguage,
     publication.route.supportLanguage,
    );
    const releases=bookReleases.get(bookKey)??new Map<string,ReleaseGroup>();
    let group=releases.get(publication.bookArchiveSha256);
    if(!group){
     group={
      version:publication.book.versionNumber,
      memberCount:publication.memberCount,
      packages:[],
      packageKeys:new Set(),
      memberIndices:new Map(),
     };
    }
    addPackage(group,pack);
    if(typeof publication.memberIndex==='number')group.memberIndices.set(pack.key,publication.memberIndex);
    releases.set(publication.bookArchiveSha256,group);
    bookReleases.set(bookKey,releases);
   }

   const orphanIdentity=identity(
    publication.publisher.namespace,
    publication.book.bookId,
    publication.route.targetLanguage,
    publication.route.supportLanguage,
   );
   if(knownBooks.has(orphanIdentity))continue;
   const releases=orphanGroups.get(orphanIdentity)??new Map<string,OrphanReleaseGroup>();
   let group=releases.get(publication.bookArchiveSha256);
   if(!group)group={publication,packages:[],packageKeys:new Set(),memberIndices:new Map()};
   addPackage(group,pack);
   if(typeof publication.memberIndex==='number')group.memberIndices.set(pack.key,publication.memberIndex);
   releases.set(publication.bookArchiveSha256,group);
   orphanGroups.set(orphanIdentity,releases);
  }
 }

 for(const releases of bookReleases.values())for(const group of releases.values())orderAdmittedMembers(group);
 for(const releases of orphanGroups.values())for(const group of releases.values())orderAdmittedMembers(group);

 const catalog=c.catalog.map((descriptor):PackageCenterItem=>{
  const releases=bookReleases.get(routeBookIdentity(
   descriptor.book.bookId,
   descriptor.route.targetLanguage,
   descriptor.route.supportLanguage,
  ))??new Map<string,ReleaseGroup>();
  let latest:ReleaseGroup|undefined;
  let latestArchive:string|undefined;
  for(const [archive,group] of releases){
   if(group.packages.length===group.memberCount&&(!latest||group.version>latest.version)){latest=group;latestArchive=archive;}
  }
  const exact=releases.get(descriptor.sha256);
  const exactComplete=exact?.packages.length===descriptor.memberCount;
  const installed=exactComplete?exact!.packages:latest?.packages??[];
  const enrollmentKey=publishedBookIdentity(descriptor.publisher.namespace,descriptor.book.bookId);
  const active=firstEnrollmentByBook.get(enrollmentKey);
  const baselineVersion=active?.source.kind==='published_book'
   ?active.source.bookVersionNumber
   :latest?.version??null;
  const updateAvailable=baselineVersion!==null&&descriptor.book.versionNumber>baselineVersion;
  return {
   key:descriptor.book.bookKey,
   listKey:`published:${descriptor.publisher.namespace}:${descriptor.book.bookId}:${descriptor.route.targetLanguage}:${descriptor.route.supportLanguage}`,
   kind:'published',
   title:descriptor.book.title,
   description:descriptor.book.description,
   count:descriptor.memberCount,
   targetLanguage:descriptor.route.targetLanguage,
   supportLanguage:descriptor.route.supportLanguage,
   descriptor,
   publicationArchiveSha256:descriptor.sha256,
   installedArchiveSha256:exactComplete?descriptor.sha256:latestArchive,
   installed,
   updateAvailable,
   updateDownloaded:updateAvailable&&!!exactComplete,
   enrolled:!!active&&active.source.kind==='published_book'
    &&active.source.bookVersionNumber>=descriptor.book.versionNumber,
   routeMatchesActive:routeMatches(descriptor.route.targetLanguage,descriptor.route.supportLanguage,c),
  };
 });

 const retired:PackageCenterItem[]=[];
 for(const [orphanIdentity,releases] of orphanGroups){
  let latest:OrphanReleaseGroup|undefined;
  for(const group of releases.values()){
   if(group.packages.length===group.publication.memberCount
    &&(!latest||group.publication.book.versionNumber>latest.publication.book.versionNumber))latest=group;
  }
  if(!latest)continue;
  const publication=latest.publication;
  retired.push({
   key:publication.book.bookKey,
   listKey:`retired:${orphanIdentity}`,
   kind:'retired',
   title:publication.book.title,
   description:publication.book.description,
   count:publication.memberCount,
   targetLanguage:publication.route.targetLanguage,
   supportLanguage:publication.route.supportLanguage,
   publicationArchiveSha256:publication.bookArchiveSha256,
   installedArchiveSha256:publication.bookArchiveSha256,
   installed:latest.packages,
   updateAvailable:false,
   updateDownloaded:false,
   enrolled:(highestEnrolledVersionByBook.get(publishedBookIdentity(
    publication.publisher.namespace,
    publication.book.bookId,
   ))??0)>=publication.book.versionNumber,
   routeMatchesActive:routeMatches(publication.route.targetLanguage,publication.route.supportLanguage,c),
  });
 }
 return {catalog,library:[...catalog.filter(item=>item.installed.length),...retired,...local]};
}

/** A learning source is the exact admitted publication, not whichever latest
 * Book happens to contain the same Portable member. No source is inferred when
 * its recorded identity is missing. This projection never offers admission. */
export function projectPackageSource(
 c:Pick<Controller,'packages'|'enrollments'|'languageContext'>,
 packageKey:string|null,
 publicationArchiveSha256?:string,
):PackageCenterItem|undefined{
 const pack=c.packages.find(pack=>pack.key===packageKey);
 if(!pack)return undefined;
 if(!publicationArchiveSha256)return {
  key:pack.key,listKey:pack.key,kind:'local',title:pack.portableOrigin.manifest.metadata.title,
  description:pack.portableOrigin.manifest.metadata.description,count:pack.content.entries.length,
  targetLanguage:pack.content.targetLanguage,supportLanguage:pack.content.supportLanguage,installed:[pack],
  updateAvailable:false,updateDownloaded:false,enrolled:false,
  routeMatchesActive:routeMatches(pack.content.targetLanguage,pack.content.supportLanguage,c),
  sourceVersion:pack.portableOrigin.manifest.metadata.version,
 };
 const publication=pack.portableOrigin.publications.find(source=>source.bookArchiveSha256===publicationArchiveSha256);
 if(!publication)return undefined;
 const group={packages:[] as InstalledPackage[],memberIndices:new Map<string,number>()};
 for(const candidate of c.packages){
  const member=candidate.portableOrigin.publications.find(source=>source.bookArchiveSha256===publicationArchiveSha256);
  if(!member)continue;
  group.packages.push(candidate);
  if(typeof member.memberIndex==='number')group.memberIndices.set(candidate.key,member.memberIndex);
 }
 orderAdmittedMembers(group);
 return {
  key:publication.book.bookKey,listKey:`source:${publicationArchiveSha256}`,kind:'published',
  title:publication.book.title,description:publication.book.description,count:publication.memberCount,
  targetLanguage:publication.route.targetLanguage,supportLanguage:publication.route.supportLanguage,
  publicationArchiveSha256,installedArchiveSha256:publicationArchiveSha256,installed:group.packages,updateAvailable:false,updateDownloaded:false,
  enrolled:c.enrollments.some(enrollment=>enrollment.source.kind==='published_book'&&enrollment.source.publicationArchiveSha256===publicationArchiveSha256),
  routeMatchesActive:routeMatches(publication.route.targetLanguage,publication.route.supportLanguage,c),
  sourceVersion:publication.book.versionNumber,
 };
}

export type PackageContentRow=Readonly<{
 pack:InstalledPackage;
 entry:InstalledPackage['content']['entries'][number];
 target:LearningTarget|undefined;
}>;

/** Discovery metadata belongs to the published edition; examples and licenses
 * belong to the actual installed edition, which may still be an older one. */
export function projectPackageMetadata(item:PackageCenterItem){
 const first=item.installed[0];
 const publication=first?.portableOrigin.publications.find(source=>source.bookArchiveSha256===(item.installedArchiveSha256??item.publicationArchiveSha256))
  ??first?.portableOrigin.publications.find(source=>source.book.bookKey===item.key
   &&source.route.targetLanguage===item.targetLanguage&&source.route.supportLanguage===item.supportLanguage
   &&(item.sourceVersion===undefined||source.book.versionNumber===item.sourceVersion));
 const metadata=first?.portableOrigin.manifest.metadata;
 const unique=<T extends {name:string;url?:string}>(values:readonly (T|undefined)[])=>[...new Map(values.filter((value):value is T=>!!value).map(value=>[JSON.stringify(value),value])).values()];
 return {
  version:item.sourceVersion??item.descriptor?.book.versionNumber??publication?.book.versionNumber??metadata?.version,
  publisher:item.descriptor?.publisher??publication?.publisher,
  publishedAt:item.descriptor?.publishedAt??publication?.publishedAt,
  changeSummary:item.descriptor?.changeSummary??publication?.changeSummary,
  installedVersion:publication?.book.versionNumber??metadata?.version,
  authors:unique(item.installed.map(pack=>pack.portableOrigin.manifest.metadata.author)),
  licenses:unique(item.installed.map(pack=>pack.portableOrigin.manifest.metadata.license)),
 };
}

export function indexPackageTargets(targets:Controller['targets']):ReadonlyMap<string,LearningTarget>{
 const indexed=new Map<string,LearningTarget>();
 for(const target of targets){
  if(target.packageKey===null)continue;
  indexed.set(identity(target.packageKey,target.identity.senseVersionId,target.identity.bindingVersionId),target);
 }
 return indexed;
}

/** Count every installed entry, but allocate row projections only inside the requested window. */
export function projectPackageContentWindow(
 packages:readonly InstalledPackage[],
 targetByEntry:ReadonlyMap<string,LearningTarget>,
 requestedLimit:number,
 browsing:{query?:string;locale?:string;offset?:number}={},
):Readonly<{entries:PackageContentRow[];total:number;offset:number}>{
 const query=browsing.query?.trim().toLocaleLowerCase(browsing.locale)??'';
 const matches=(entry:InstalledPackage['content']['entries'][number])=>!query||entry.expression.toLocaleLowerCase(browsing.locale).includes(query);
 const total=packages.reduce((count,pack)=>count+pack.content.entries.reduce((sum,entry)=>sum+Number(matches(entry)),0),0);
 const limit=Math.max(0,Math.floor(requestedLimit));
 const offset=limit?Math.min(Math.max(0,Math.floor(browsing.offset??0)),Math.max(0,Math.ceil(total/limit)-1)*limit):0;
 const entries:PackageContentRow[]=[];
 let position=0;
 for(const pack of packages){
  for(const entry of pack.content.entries){
   if(!matches(entry)||position++<offset)continue;
   if(entries.length>=limit)return {entries,total,offset};
   entries.push({
    pack,
    entry,
    target:targetByEntry.get(identity(pack.key,entry.senseVersionId,entry.bindingVersionId)),
   });
  }
 }
 return {entries,total,offset};
}
