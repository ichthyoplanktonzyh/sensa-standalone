import {
  maxPortableBookArchiveBytes,
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
  type InstalledPackage,
  type PackageInstallation,
  type PortablePublicationAttestation,
} from '../../data/library/packageRecords';
import {readLibrary,writeLibraryCache} from '../../data/library/store';
import {installPreparedPortablePackages,installPublishedPortableBookMembers} from './portablePackage';
import {readPublishedBook} from './portablePreparation';
import {preparePublishedBookOffThread} from './portablePreparationClient';
import type {ContentSupplyInstallationPhase} from '../system/contentSupplySystem';

const fetchExactBytes=async(
  url:string,
  byteLength:number,
  maximumBytes:number,
  signal:AbortSignal,
  progress:(received:number)=>void,
):Promise<Uint8Array>=>{
  if(byteLength>maximumBytes)throw new Error('localFlow.packageTooLarge');
  const response=await fetch(url,{signal,redirect:'error',credentials:'omit'});
  if(!response.ok||!response.body)throw new Error('localFlow.downloadFailed');
  const contentLength=response.headers.get('content-length');
  if(contentLength!==null){
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
  member,
});

const installBookMembers=(
  archive:SensaPortableBookPackage,
  members:readonly SensaPortableBookPackageMember[],
  signal:AbortSignal,
):Promise<readonly InstalledPackage[]>=>installPublishedPortableBookMembers(
  members.map(({member,bytes,archive:memberArchive})=>({
    bytes,
    archive:memberArchive,
    publication:attestationFor(archive.manifest,archive.archiveDigest,member),
  })),
  signal,
);

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
):boolean=>installation.artifact.kind==='portable_package'
  &&installation.artifact.bookArchiveSha256===archive.archiveDigest
  &&installation.artifact.packageId===member.member.packageId
  &&installation.artifact.version===member.member.version
  &&installation.artifact.digest===member.archive.archiveDigest
  &&installation.artifact.packageDigest===member.archive.packageDigest
  &&installation.artifact.byteLength===member.bytes.byteLength
  &&installation.artifact.targetLanguage===archive.manifest.route.targetLanguage
  &&installation.artifact.supportLanguage===archive.manifest.route.supportLanguage;

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
    cache:await tx.packageCacheProjection({kind:'identities'}),
  }));
  const facts=new Map(snapshot.installations.map(value=>[value.key,value]));
  const stale=snapshot.cache.filter(value=>facts.get(value.key)?.artifact.digest!==value.digest);
  if(stale.length)await writeLibraryCache(async tx=>{
    for(const item of stale)tx.delete('packageCache',item.key);
  });
  const ready=snapshot.cache
    .filter(value=>facts.get(value.key)?.artifact.digest===value.digest)
    .map(value=>value.key);
  const cached=new Set(ready);
  const blocked:string[]=[];
  const failed:string[]=[];
  const missing=snapshot.installations.filter(installation=>!cached.has(installation.key));
  if(!missing.length)return {ready:ready.sort(),blocked,failed};

  const groups=new Map<string,PackageInstallation[]>();
  for(const installation of missing){
    const digest=installation.artifact.bookArchiveSha256;
    if(!digest){blocked.push(installation.key);continue;}
    let group=groups.get(digest);
    if(!group){group=[];groups.set(digest,group);}
    group.push(installation);
  }
  for(const [bookArchiveSha256,installations] of groups){
    const descriptor=descriptors.find(item=>item.sha256===bookArchiveSha256);
    if(!descriptor){blocked.push(...installations.map(item=>item.key));continue;}
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
        else blocked.push(installation.key);
      }
      if(selected.length){
        const restored=await installBookMembers(archive,selected,signal);
        ready.push(...restored.map(item=>item.key));
      }
    }catch{
      if(signal.aborted)throw new Error('localFlow.downloadCancelled');
      failed.push(...installations.map(item=>item.key).filter(key=>!blocked.includes(key)));
    }
  }
  return {ready:ready.sort(),blocked:blocked.sort(),failed:failed.sort()};
};
