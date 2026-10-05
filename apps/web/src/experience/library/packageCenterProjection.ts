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
 installed:InstalledPackage[];
 updateAvailable:boolean;
 updateDownloaded:boolean;
 enrolled:boolean;
 routeMatchesActive:boolean;
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
    updateAvailable:false,
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
  for(const group of releases.values()){
   if(group.packages.length===group.memberCount&&(!latest||group.version>latest.version))latest=group;
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

export type PackageContentRow=Readonly<{
 pack:InstalledPackage;
 entry:InstalledPackage['content']['entries'][number];
 target:LearningTarget|undefined;
}>;

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
):Readonly<{entries:PackageContentRow[];total:number}>{
 const total=packages.reduce((count,pack)=>count+pack.content.entries.length,0);
 const limit=Math.max(0,Math.floor(requestedLimit));
 const entries:PackageContentRow[]=[];
 for(const pack of packages){
  for(const entry of pack.content.entries){
   if(entries.length>=limit)return {entries,total};
   entries.push({
    pack,
    entry,
    target:targetByEntry.get(identity(pack.key,entry.senseVersionId,entry.bindingVersionId)),
   });
  }
 }
 return {entries,total};
}
