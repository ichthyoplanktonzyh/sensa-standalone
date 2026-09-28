import {
  canonicalConsumerJson,
  maxBookVersionManifestBytes,
  maxPublishedPortablePackageBytes,
  sensaBookVersionManifestDescriptorSchema,
  sensaBookVersionManifestSchema,
  type SensaBookVersionManifest,
  type SensaBookVersionManifestDescriptor,
  type SensaPublishedPortableArtifact,
} from '@sensa/contracts/sensa';

import {
  type InstalledPackage,
  type PackageInstallation,
  type PortablePublicationAttestation,
} from '../../data/library/packageRecords';
import {readLibrary,writeLibraryCache} from '../../data/library/store';
import {installPublishedPortablePackage} from './portablePackage';

const sha256=async(bytes:Uint8Array)=>Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),
  value=>value.toString(16).padStart(2,'0'),
).join('');

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

export const fetchPublishedBookManifest=async(
  raw:SensaBookVersionManifestDescriptor,
  signal:AbortSignal,
):Promise<SensaBookVersionManifest>=>{
  const descriptor=sensaBookVersionManifestDescriptorSchema.parse(raw);
  const bytes=await fetchExactBytes(
    descriptor.url,
    descriptor.byteLength,
    maxBookVersionManifestBytes,
    signal,
    ()=>{},
  );
  if(await sha256(bytes)!==descriptor.sha256)throw new Error('localFlow.catalogMismatch');
  let manifest:SensaBookVersionManifest;
  try{
    manifest=sensaBookVersionManifestSchema.parse(JSON.parse(new TextDecoder(
      'utf-8',
      {fatal:true},
    ).decode(bytes)));
  }catch(cause){
    throw new Error('localFlow.catalogMismatch',{cause});
  }
  const expected=sensaBookVersionManifestDescriptorSchema.parse({
    format:'sensa-book-version-manifest-descriptor-v1',
    publisher:manifest.publisher,
    book:manifest.book,
    contentRelease:manifest.contentRelease,
    route:manifest.route,
    publishedAt:manifest.publishedAt,
    changeSummary:manifest.changeSummary,
    memberCount:manifest.members.length,
    byteLength:bytes.byteLength,
    sha256:descriptor.sha256,
    url:descriptor.url,
  });
  if(canonicalConsumerJson(expected)!==canonicalConsumerJson(descriptor)){
    throw new Error('localFlow.catalogMismatch');
  }
  return manifest;
};

const attestationFor=(
  manifest:SensaBookVersionManifest,
  manifestSha256:string,
  member:SensaPublishedPortableArtifact,
):PortablePublicationAttestation=>({
  format:'sensa-portable-publication-attestation-v1',
  publisher:manifest.publisher,
  book:manifest.book,
  contentRelease:manifest.contentRelease,
  route:manifest.route,
  publishedAt:manifest.publishedAt,
  changeSummary:manifest.changeSummary,
  manifestSha256,
  memberCount:manifest.members.length,
  member,
});

const fetchPublishedMember=async(
  manifest:SensaBookVersionManifest,
  manifestSha256:string,
  member:SensaPublishedPortableArtifact,
  signal:AbortSignal,
  progress:(received:number)=>void,
):Promise<InstalledPackage>=>{
  const bytes=await fetchExactBytes(
    member.url,
    member.byteLength,
    maxPublishedPortablePackageBytes,
    signal,
    progress,
  );
  if(await sha256(bytes)!==member.archiveSha256)throw new Error('localFlow.catalogMismatch');
  return installPublishedPortablePackage(
    bytes,
    attestationFor(manifest,manifestSha256,member),
    signal,
  );
};

export const downloadPublishedBook=async(
  descriptor:SensaBookVersionManifestDescriptor,
  signal:AbortSignal,
  onProgress:(fraction:number)=>void,
):Promise<readonly InstalledPackage[]>=>{
  onProgress(0);
  const manifest=await fetchPublishedBookManifest(descriptor,signal);
  const total=manifest.members.reduce((sum,member)=>sum+member.byteLength,0);
  let completed=0;
  const installed:InstalledPackage[]=[];
  for(const member of manifest.members){
    const base=completed;
    installed.push(await fetchPublishedMember(
      manifest,
      descriptor.sha256,
      member,
      signal,
      received=>onProgress(Math.min(1,(base+received)/total)),
    ));
    completed+=member.byteLength;
  }
  onProgress(1);
  return installed;
};

const installationMatchesMember=(
  installation:PackageInstallation,
  manifest:SensaBookVersionManifest,
  member:SensaPublishedPortableArtifact,
):boolean=>installation.artifact.kind==='portable_package'
  &&installation.artifact.packageId===member.packageId
  &&installation.artifact.version===member.version
  &&installation.artifact.digest===member.archiveSha256
  &&installation.artifact.packageDigest===member.packageDigest
  &&installation.artifact.byteLength===member.byteLength
  &&installation.artifact.targetLanguage===manifest.route.targetLanguage
  &&installation.artifact.supportLanguage===manifest.route.supportLanguage;

export type PortableRehydrationResult=Readonly<{
  ready:string[];
  blocked:string[];
  failed:string[];
}>;

/** Restore only artifacts already represented by synchronized installation facts. */
export const rehydratePublishedPortableInstallations=async(
  descriptors:readonly SensaBookVersionManifestDescriptor[],
  signal:AbortSignal=AbortSignal.timeout(120_000),
):Promise<PortableRehydrationResult>=>{
  const snapshot=await readLibrary(async tx=>({
    installations:(await tx.all<PackageInstallation>('packageInstallations')),
    cache:await tx.all<InstalledPackage>('packageCache'),
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
  const manifests:(Readonly<{
    descriptor:SensaBookVersionManifestDescriptor;
    manifest:SensaBookVersionManifest;
  }>)[]=[];
  let manifestUnavailable=false;
  for(const descriptor of descriptors){
    try{
      manifests.push({descriptor,manifest:await fetchPublishedBookManifest(descriptor,signal)});
    }catch{
      if(signal.aborted)throw new Error('localFlow.downloadCancelled');
      manifestUnavailable=true;
    }
  }
  for(const installation of missing){
    const located=manifests.flatMap(item=>item.manifest.members.map(member=>({
      ...item,
      member,
    }))).find(item=>installationMatchesMember(installation,item.manifest,item.member));
    if(!located){
      (manifestUnavailable?failed:blocked).push(installation.key);
      continue;
    }
    try{
      await fetchPublishedMember(
        located.manifest,
        located.descriptor.sha256,
        located.member,
        signal,
        ()=>{},
      );
      ready.push(installation.key);
    }catch{
      failed.push(installation.key);
    }
  }
  return {ready:ready.sort(),blocked:blocked.sort(),failed:failed.sort()};
};
