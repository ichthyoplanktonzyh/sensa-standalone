import {
  maxPortableBookArchiveBytes,
  maxPortableBookPreviewBytes,maxLegacyBookPreviewArchiveBytes,
  sensaPortableBookDescriptorSchema,
  type SensaPortableBookDescriptor,
  type SensaPortableBookManifest,
  type SensaPortableBookMember,
} from '@sensa/contracts/sensa';
import {
  type SensaPortableBookPackage,
  type SensaPortableBookPackageMember,
} from '@sensa/content-validator/portable-book';

import {
  portablePackageKey,
  type InstalledPackage,
  type PackageInstallation,
  type PortablePublicationAttestation,
} from '../../data/library/packageRecords';
import {readLibrary,writeLibraryCache} from '../../data/library/store';
import type {PackagePublicationIdentity} from '../../data/library/packageCacheProjection';
import {installPreparedPortablePackages,installPublishedPortableBookMembers} from './portablePackage';
import {readPublishedBook} from './portablePreparation';
import {inspectPublishedBookPreviewOffThread,preparePublishedBookOffThread} from './portablePreparationClient';
import type {ContentSupplyInstallationPhase} from '../system/contentSupplySystem';

const fetchExactBytes=async(
  url:string,
  byteLength:number,
  maximumBytes:number,
  signal:AbortSignal,
  progress:(received:number)=>void,
  checkDeclaredLength=true,
):Promise<Uint8Array>=>{
  if(byteLength>maximumBytes)throw new Error('localFlow.packageTooLarge');
  if(signal.aborted)throw new Error('localFlow.downloadCancelled');
  const response=await fetch(url,{signal,redirect:'error',credentials:'omit'});
  if(!response.ok||!response.body)throw new Error('localFlow.downloadFailed');
  const contentLength=response.headers.get('content-length');
  if(checkDeclaredLength&&contentLength!==null){
    const declared=Number(contentLength);
    if(!Number.isInteger(declared)||declared!==byteLength)throw new Error('localFlow.downloadSizeMismatch');
  }
  const reader=response.body.getReader();
  const parts:Uint8Array[]=[];
  let total=0;
  try{
    for(;;){
      const next=await reader.read();
      if(next.done)break;
      total+=next.value.byteLength;
      if(total>byteLength||total>maximumBytes)throw new Error('localFlow.downloadSizeMismatch');
      parts.push(next.value);
      progress(total);
    }
  }finally{
    await reader.cancel();
  }
  if(signal.aborted)throw new Error('localFlow.downloadCancelled');
  if(total!==byteLength)throw new Error('localFlow.downloadSizeMismatch');
  const bytes=new Uint8Array(total);
  let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  return bytes;
};

/** Public inspection only. No library reads/writes, media caching or installation. */
export const fetchPublishedBookPreview=async(raw:SensaPortableBookDescriptor,signal:AbortSignal)=>{
  const descriptor=sensaPortableBookDescriptorSchema.parse(raw),artifact=descriptor.preview??descriptor;
  if(!descriptor.preview&&descriptor.byteLength>maxLegacyBookPreviewArchiveBytes)
    throw new Error('localFlow.packagePreviewUnavailable');
  // JSON may be transparently decoded by fetch; Content-Length can describe compressed wire bytes.
  // The decoded stream remains bounded to the exact artifact length and its pinned SHA-256.
  const bytes=await fetchExactBytes(artifact.url,artifact.byteLength,
    descriptor.preview?maxPortableBookPreviewBytes:maxLegacyBookPreviewArchiveBytes,signal,()=>{},!descriptor.preview);
  return inspectPublishedBookPreviewOffThread(bytes,descriptor,signal);
};

/** Fetch and fully validate the single distributable unit represented by a Registry item. */
export const fetchPublishedBook=async(
  raw:SensaPortableBookDescriptor,
  signal:AbortSignal,
  progress:(received:number)=>void=()=>{},
):Promise<SensaPortableBookPackage>=>{
  const descriptor=sensaPortableBookDescriptorSchema.parse(raw);
  const bytes=await fetchExactBytes(
    descriptor.url,
    descriptor.byteLength,
    maxPortableBookArchiveBytes,
    signal,
    progress,
  );
  return readPublishedBook(bytes,descriptor);
};

const attestationFor=(
  manifest:SensaPortableBookManifest,
  bookArchiveSha256:string,
  member:SensaPortableBookMember,
  memberIndex:number,
):PortablePublicationAttestation=>({
  format:'sensa-portable-publication-attestation-v2',
  publisher:manifest.publisher,
  book:manifest.book,
  contentRelease:manifest.contentRelease,
  route:manifest.route,
  publishedAt:manifest.publishedAt,
  changeSummary:manifest.changeSummary,
  bookArchiveSha256,
  memberCount:manifest.members.length,
  memberIndex,
  member,
});

const installBookMembers=(
  archive:SensaPortableBookPackage,
  members:readonly SensaPortableBookPackageMember[],
  signal:AbortSignal,
):Promise<readonly InstalledPackage[]>=>{
  const positions=new Map(archive.manifest.members.map((member,index)=>[portablePackageKey(member.packageId,member.version),index]));
  return installPublishedPortableBookMembers(members.map(({member,bytes,archive:memberArchive})=>{
    const memberIndex=positions.get(portablePackageKey(member.packageId,member.version));
    if(memberIndex===undefined)throw new Error('localFlow.catalogMismatch');
    return {bytes,archive:memberArchive,publication:attestationFor(archive.manifest,archive.archiveDigest,member,memberIndex)};
  }),signal);
};

export const downloadPublishedBook=async(
  raw:SensaPortableBookDescriptor,
  signal:AbortSignal,
  onProgress:(fraction:number)=>void,
  onPhase?:(phase:ContentSupplyInstallationPhase)=>void,
):Promise<readonly InstalledPackage[]>=>{
  onPhase?.('downloading');
  onProgress(0);
  try{
    const descriptor=sensaPortableBookDescriptorSchema.parse(raw);
    const bytes=await fetchExactBytes(descriptor.url,descriptor.byteLength,maxPortableBookArchiveBytes,signal,
      received=>onProgress(Math.min(1,received/descriptor.byteLength)));
    onPhase?.('preparing');
    const prepared=await preparePublishedBookOffThread(bytes,descriptor,signal);
    const installed=await installPreparedPortablePackages(prepared,signal,()=>onPhase?.('committing'));
    onProgress(1);
    return installed;
  }catch(cause){
    if(signal.aborted)throw new Error('localFlow.downloadCancelled',{cause});
    throw cause;
  }
};

const installationMatchesMember=(
  installation:PackageInstallation,
  archive:SensaPortableBookPackage,
  member:SensaPortableBookPackageMember,
):boolean=>{
 const reference=installation.artifact.bookMemberships?.find(value=>value.archiveSha256===archive.archiveDigest);
 const matchesSource=reference
  ?reference.bookId===archive.manifest.book.bookId
   &&reference.bookVersionId===archive.manifest.book.bookVersionId
   &&reference.memberCount===archive.manifest.members.length
   &&archive.manifest.members[reference.memberIndex]?.packageId===member.member.packageId
   &&archive.manifest.members[reference.memberIndex]?.version===member.member.version
  :installation.artifact.bookArchiveSha256===archive.archiveDigest;
 return matchesSource&&installation.artifact.packageId===member.member.packageId
  &&installation.artifact.version===member.member.version
  &&installation.artifact.digest===member.archive.archiveDigest
  &&installation.artifact.packageDigest===member.archive.packageDigest
  &&installation.artifact.byteLength===member.bytes.byteLength
  &&installation.artifact.targetLanguage===archive.manifest.route.targetLanguage
  &&installation.artifact.supportLanguage===archive.manifest.route.supportLanguage;
};

const recoverySourceDigests=(installation:PackageInstallation)=>[...new Set([
 ...(installation.artifact.bookMemberships??[]).map(member=>member.archiveSha256),
 ...(installation.artifact.bookArchiveSha256?[installation.artifact.bookArchiveSha256]:[]),
])];

const hasRecoveredPublication=(installation:PackageInstallation,cached:PackagePublicationIdentity|undefined,digest:string):boolean=>{
 if(!cached||cached.digest!==installation.artifact.digest)return false;
 const required=installation.artifact.bookMemberships?.find(member=>member.archiveSha256===digest);
 return required?cached.bookMemberships.some(member=>member.archiveSha256===digest&&member.bookId===required.bookId&&member.bookVersionId===required.bookVersionId&&member.memberIndex===required.memberIndex&&member.memberCount===required.memberCount):cached.bookArchiveSha256s.includes(digest);
};

export type PortableRehydrationResult=Readonly<{
  ready:string[];
  blocked:string[];
  failed:string[];
}>;

/** Restore only artifacts already represented by synchronized installation facts. */
export const rehydratePublishedPortableInstallations=async(
  descriptors:readonly SensaPortableBookDescriptor[],
  signal:AbortSignal=AbortSignal.timeout(120_000),
):Promise<PortableRehydrationResult>=>{
  const snapshot=await readLibrary(async tx=>({
    installations:(await tx.all<PackageInstallation>('packageInstallations')),
    cache:await tx.packageCacheProjection({kind:'publication_identities'}),
  }));
  const facts=new Map(snapshot.installations.map(value=>[value.key,value]));
  const stale=snapshot.cache.filter(value=>facts.get(value.key)?.artifact.digest!==value.digest);
  if(stale.length)await writeLibraryCache(async tx=>{
    for(const item of stale)tx.delete('packageCache',item.key);
  });
  const cached=new Map(snapshot.cache.filter(value=>facts.get(value.key)?.artifact.digest===value.digest).map(value=>[value.key,value]));
  const required=new Map(snapshot.installations.map(installation=>[installation.key,recoverySourceDigests(installation)]));
  const blocked=new Set<string>();
  const failed=new Set<string>();
  const descriptorByDigest=new Map<string,SensaPortableBookDescriptor>();
  for(const descriptor of descriptors)if(!descriptorByDigest.has(descriptor.sha256))descriptorByDigest.set(descriptor.sha256,descriptor);
  const groups=new Map<string,PackageInstallation[]>();
  for(const installation of snapshot.installations){
    const wanted=required.get(installation.key)!;
    if(!wanted.length&&!cached.has(installation.key)){blocked.add(installation.key);continue;}
    for(const digest of wanted){
      if(hasRecoveredPublication(installation,cached.get(installation.key),digest))continue;
      let group=groups.get(digest);
      if(!group){group=[];groups.set(digest,group);}
      group.push(installation);
    }
  }
  for(const [bookArchiveSha256,installations] of groups){
    const descriptor=descriptorByDigest.get(bookArchiveSha256);
    if(!descriptor){for(const installation of installations)blocked.add(installation.key);continue;}
    try{
      const archive=await fetchPublishedBook(descriptor,signal);
      const selected:SensaPortableBookPackageMember[]=[];
      const membersByPackage=new Map<string,Map<number,SensaPortableBookPackageMember>>();
      for(const candidate of archive.members){
        let versions=membersByPackage.get(candidate.member.packageId);
        if(!versions){versions=new Map();membersByPackage.set(candidate.member.packageId,versions);}
        if(!versions.has(candidate.member.version))versions.set(candidate.member.version,candidate);
      }
      for(const installation of installations){
        const member=membersByPackage.get(installation.artifact.packageId)?.get(installation.artifact.version);
        if(member&&installationMatchesMember(
          installation,
          archive,
          member,
        ))selected.push(member);
        else blocked.add(installation.key);
      }
      if(selected.length){
        await installBookMembers(archive,selected,signal);
      }
    }catch{
      if(signal.aborted)throw new Error('localFlow.downloadCancelled');
      for(const installation of installations)if(!blocked.has(installation.key))failed.add(installation.key);
    }
  }
  // A complete warm cache has no asynchronous work after its coherent snapshot;
  // do not decode the entire installation set twice. Downloads/cache repairs
  // do await other work, so sync may have admitted another source meanwhile.
  const current=stale.length===0&&groups.size===0?snapshot:await readLibrary(async tx=>({installations:await tx.all<PackageInstallation>('packageInstallations'),cache:await tx.packageCacheProjection({kind:'publication_identities'})}));
  const recovered=new Map(current.cache.map(value=>[value.key,value]));
  const ready=new Set(current.installations.filter(installation=>recovered.get(installation.key)?.digest===installation.artifact.digest&&recoverySourceDigests(installation).every(digest=>hasRecoveredPublication(installation,recovered.get(installation.key),digest))).map(value=>value.key));
  const pending=current.installations.filter(installation=>!ready.has(installation.key)).map(value=>value.key);
  const unresolved=new Set(pending.filter(key=>blocked.has(key)||!failed.has(key)));
  return {ready:[...ready].sort(),blocked:[...unresolved].sort(),failed:pending.filter(key=>failed.has(key)&&!unresolved.has(key)).sort()};
};
