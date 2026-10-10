import {
  canonicalConsumerJson,
  type SensaPortableLightweightPackage,
} from '@sensa/contracts/sensa';
import {
  createSensaPortableLightweightPackage,
  readSensaPortableLightweightPackage,
  sensaPortableLightweightPackageValidatorVersion,
  type SensaPortableLightweightPackageArchive,
} from '@sensa/content-validator/portable-lightweight';

import {contentSupplyCommand} from '../../data/library/contentSupplyAdmission';
import {learningOwner} from '../../data/library/libraryOwnership';
import {
  packageInstallationSchema,
  mergePackageInstallationRecovery,
  portablePackageKey,
  type InstalledPackage,
  type InstalledPackageSummary,
  type PackageInstallation,
  type PortablePublicationAttestation,
} from '../../data/library/packageRecords';
import {openLibrary,readLibrary} from '../../data/library/store';
import {preparePortablePackage,type PreparedPortableInstallation} from './portablePreparation';
import {inspectPortablePackageOffThread,prepareStandalonePortablePackageOffThread} from './portablePreparationClient';

export type PortablePackagePreviewStatus=
  |'new'
  |'installed'
  |'update_available'
  |'older_version'
  |'version_conflict';

export type PortablePackagePreview=Readonly<{
  archiveDigest:string;
  packageDigest:string;
  validatorVersion:string;
  status:PortablePackagePreviewStatus;
  package:SensaPortableLightweightPackage;
  mediaBytes:number;
  mediaCount:number;
}>;

export type PortablePackageExport=Readonly<{
  fileName:string;
  bytes:Uint8Array;
}>;

const portableKey=(value:SensaPortableLightweightPackage)=>portablePackageKey(
  value.metadata.packageId,
  value.metadata.version,
);

const invalidPortablePackage=(cause:unknown):never=>{
  throw new Error('localFlow.resourceInvalid',{cause});
};

const openPortable=(bytes:Uint8Array):SensaPortableLightweightPackageArchive=>{
  try{return readSensaPortableLightweightPackage(bytes);}
  catch(cause){return invalidPortablePackage(cause);}
};

const previewStatus=(
  archive:Pick<SensaPortableLightweightPackageArchive,'package'|'packageDigest'>,
  installed:readonly InstalledPackageSummary[],
  prior:PackageInstallation|undefined,
):PortablePackagePreviewStatus=>{
  if(prior&&prior.artifact.packageDigest!==archive.packageDigest)return 'version_conflict';
  const exact=installed.find(item=>item.key===portableKey(archive.package));
  if(exact){
    return 'installed';
  }
  const versions=installed
    .filter(item=>item.portableOrigin.manifest.metadata.packageId===archive.package.metadata.packageId)
    .map(item=>item.portableOrigin.manifest.metadata.version);
  if(versions.some(version=>version>archive.package.metadata.version))return 'older_version';
  if(versions.some(version=>version<archive.package.metadata.version))return 'update_available';
  return 'new';
};

export async function previewPortablePackage(bytes:Uint8Array):Promise<PortablePackagePreview>{
  await openLibrary();
  const archive=await inspectPortablePackageOffThread(bytes);
  const status=await readLibrary(async tx=>previewStatus(archive,
    await tx.packageCacheProjection({kind:'summaries',packageId:archive.package.metadata.packageId}),
    await tx.get<PackageInstallation>('packageInstallations',portableKey(archive.package)),
  ));
  return Object.freeze({
    archiveDigest:archive.archiveDigest,
    packageDigest:archive.packageDigest,
    validatorVersion:sensaPortableLightweightPackageValidatorVersion,
    status,
    package:archive.package,
    mediaBytes:archive.mediaBytes,
    mediaCount:archive.mediaCount,
  });
}

export const installPreparedPortablePackages=async(
  prepared:readonly PreparedPortableInstallation[],
  signal?:AbortSignal,
  onCommitStart?:()=>void,
):Promise<readonly InstalledPackage[]>=>{
  await openLibrary();
  if(signal?.aborted)throw new Error('localFlow.downloadCancelled');
  const installed:InstalledPackage[]=[];
  await contentSupplyCommand({id:crypto.randomUUID(),kind:'package.install',input:{count:prepared.length}},async tx=>{
    if(signal)tx.requireCommitSignal(signal,'localFlow.downloadCancelled',onCommitStart);
    await learningOwner(tx);
    const keys=prepared.map(item=>item.installation.key);
    const [cachedKeys,installationKeys]=await Promise.all([
      tx.existingRecordKeys('packageCache',keys),tx.existingRecordKeys('packageInstallations',keys),
    ]);
    for(const item of prepared){
      if(signal?.aborted)throw new Error('localFlow.downloadCancelled');
      const {canonical,content,installation,publication}=item;
      const old=cachedKeys.has(installation.key)?await tx.get<InstalledPackage>('packageCache',installation.key):undefined;
      const priorRaw=installationKeys.has(installation.key)?await tx.get<PackageInstallation>('packageInstallations',installation.key):undefined;
      const prior=priorRaw?packageInstallationSchema.parse(priorRaw):undefined;
      const admittedInstallation=mergePackageInstallationRecovery(prior,installation);
      if(!admittedInstallation)throw new Error('localFlow.packageVersionChanged');
      if(old&&(
        old.portableOrigin.packageDigest!==canonical.packageDigest
        ||canonicalConsumerJson(old.content)!==canonicalConsumerJson(content)
      ))throw new Error('localFlow.packageVersionChanged');
      const publications=publication
        ?[...(old?.portableOrigin.publications??[]).filter(item=>item.bookArchiveSha256!==publication.bookArchiveSha256),publication]
        :old?.portableOrigin.publications??[];
      const value:InstalledPackage=old?{
        ...old,
        portableOrigin:{...old.portableOrigin!,publications},
      }:{
        key:portablePackageKey(canonical.package.metadata.packageId,canonical.package.metadata.version),
        digest:canonical.archiveDigest,
        content,
        installedAt:new Date().toISOString(),
        portableOrigin:{
          format:'sensa-portable-installation-origin-v2',
          manifest:canonical.package,
          packageDigest:canonical.packageDigest,
          archiveDigest:canonical.archiveDigest,
          validatorVersion:sensaPortableLightweightPackageValidatorVersion,
          publications,
        },
      };
      tx.put('packageInstallations',installation.key,admittedInstallation);
      tx.put('packageCache',installation.key,value);
      cachedKeys.add(installation.key);installationKeys.add(installation.key);
      installed.push(value);
    }
    return {count:installed.length};
  });
  return installed;
};

export const installPortablePackage=async(
  bytes:Uint8Array,
  expectedArchiveDigest:string,
  signal?:AbortSignal,
):Promise<InstalledPackage>=>installPreparedPortablePackages([
  await prepareStandalonePortablePackageOffThread(bytes,expectedArchiveDigest,signal),
],signal).then(([installed])=>installed??invalidPortablePackage(new Error('Package was not installed')));

export const installPublishedPortableBookMembers=(
  members:readonly Readonly<{
    bytes:Uint8Array;
    archive:SensaPortableLightweightPackageArchive;
    publication:PortablePublicationAttestation;
  }>[],
  signal?:AbortSignal,
):Promise<readonly InstalledPackage[]>=>{
  if(signal?.aborted)throw new Error('localFlow.downloadCancelled');
  const prepared=members.map(({bytes,archive,publication})=>
    preparePortablePackage(bytes,archive,publication));
  return installPreparedPortablePackages(prepared,signal);
};

const base64ToBytes=(value:string):Uint8Array=>{
  const separator=value.indexOf(',');
  if(separator<0)return invalidPortablePackage(new Error('Invalid media Data URL'));
  const binary=atob(value.slice(separator+1));
  return Uint8Array.from(binary,character=>character.charCodeAt(0));
};

const material=(pack:InstalledPackage,role:string,ordinal=0):Record<string,unknown>=>{
  const resource=pack.content.entries[0]?.content.resources.find(item=>item.materialRoleKey===role&&item.ordinal===ordinal);
  if(!resource)return invalidPortablePackage(new Error(`Missing installed resource: ${role}:${ordinal}`));
  return resource.contentPayload;
};

const reconstructMedia=(pack:InstalledPackage):ReadonlyMap<string,Uint8Array>=>{
  const manifest=pack.portableOrigin.manifest;
  const urls=new Map<string,string>();
  const assign=(mediaId:string|undefined,url:unknown)=>{
    if(!mediaId)return;
    if(typeof url!=='string')return invalidPortablePackage(new Error(`Missing installed media: ${mediaId}`));
    const previous=urls.get(mediaId);
    if(previous!==undefined&&previous!==url)return invalidPortablePackage(new Error(`Conflicting installed media: ${mediaId}`));
    urls.set(mediaId,url);
  };
  assign(manifest.resources.pronunciation.audioMediaId,material(pack,'pronunciation').audioUrl);
  const realization=manifest.resources.sceneRealization;
  if(realization.audioMediaId)assign(realization.audioMediaId,material(pack,'scene_realization').audioUrl);
  const images=material(pack,'experience_recall_cue').images;
  manifest.resources.experienceRecallCue.images?.forEach((image,index)=>{
    assign(image.mediaId,Array.isArray(images)?(images[index] as {dataUrl?:unknown}|undefined)?.dataUrl:undefined);
  });
  manifest.resources.optional.usageGuidance?.forEach((item,index)=>{
    if(item.audioMediaId)assign(item.audioMediaId,material(pack,'usage_guidance',index).audioUrl);
  });
  return new Map(manifest.media.map(media=>{
    const url=urls.get(media.mediaId);
    if(!url)return invalidPortablePackage(new Error(`Unrecoverable installed media: ${media.mediaId}`));
    return [media.mediaId,base64ToBytes(url)] as const;
  }));
};

export async function exportPortablePackage(packageKeyValue:string):Promise<PortablePackageExport>{
  await openLibrary();
  const pack=await readLibrary(tx=>tx.get<InstalledPackage>('packageCache',packageKeyValue));
  if(!pack?.portableOrigin)throw new Error('localFlow.resourceInvalid');
  let bytes:Uint8Array;
  try{bytes=createSensaPortableLightweightPackage(pack.portableOrigin.manifest,reconstructMedia(pack));}
  catch(cause){return invalidPortablePackage(cause);}
  const rebuilt=openPortable(bytes);
  if(
    rebuilt.archiveDigest!==pack.portableOrigin.archiveDigest
    ||rebuilt.packageDigest!==pack.portableOrigin.packageDigest
  )throw new Error('localFlow.resourceInvalid');
  return {
    fileName:`${pack.portableOrigin.manifest.metadata.packageId}-v${pack.portableOrigin.manifest.metadata.version}.sensa`,
    bytes,
  };
}
