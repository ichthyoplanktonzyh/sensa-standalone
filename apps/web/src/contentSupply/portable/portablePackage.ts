import {
  LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_KEY,
  LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_VERSION,
  SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,
  canonicalConsumerJson,
  learningPackageSchema,
  sensaLightweightInitialMaterializationContentSchema,
  type LearningPackageBundle,
  type SensaLightweightInitialMaterialRole,
  type SensaPortableLightweightPackage,
} from '@sensa/contracts/sensa';
import {
  createSensaPortableLightweightPackage,
  readSensaPortableLightweightPackage,
  sensaPortableLightweightPackageValidatorVersion,
  type SensaPortableLightweightPackageArchive,
} from '@sensa/content-validator/portable-lightweight';
import {canonicalJsonDigest,stableUuid} from '@sensa/learning-kernel';

import {contentSupplyCommand} from '../../data/library/contentSupplyAdmission';
import {learningOwner} from '../../data/library/libraryOwnership';
import {
  packageInstallationFor,
  packageInstallationSchema,
  packageKey,
  type InstalledPackage,
  type PackageInstallation,
} from '../../data/library/packageRecords';
import {openLibrary,readLibrary} from '../../data/library/store';
import {validatePackage} from '../../data/library/packages';

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

const portableKey=(value:SensaPortableLightweightPackage)=>JSON.stringify([
  value.metadata.packageId,
  String(value.metadata.version),
]);

const invalidPortablePackage=(cause:unknown):never=>{
  throw new Error('localFlow.resourceInvalid',{cause});
};

const openPortable=(bytes:Uint8Array):SensaPortableLightweightPackageArchive=>{
  try{return readSensaPortableLightweightPackage(bytes);}
  catch(cause){return invalidPortablePackage(cause);}
};

const previewStatus=(
  archive:SensaPortableLightweightPackageArchive,
  installed:readonly InstalledPackage[],
):PortablePackagePreviewStatus=>{
  const exact=installed.find(item=>item.key===portableKey(archive.package));
  if(exact){
    return exact.portableOrigin?.packageDigest===archive.packageDigest
      ?'installed'
      :'version_conflict';
  }
  const versions=installed
    .filter(item=>item.portableOrigin?.manifest.metadata.packageId===archive.package.metadata.packageId)
    .map(item=>item.portableOrigin!.manifest.metadata.version);
  if(versions.some(version=>version>archive.package.metadata.version))return 'older_version';
  if(versions.some(version=>version<archive.package.metadata.version))return 'update_available';
  return 'new';
};

export async function previewPortablePackage(bytes:Uint8Array):Promise<PortablePackagePreview>{
  await openLibrary();
  const archive=openPortable(bytes);
  const installed=await readLibrary(tx=>tx.all<InstalledPackage>('packageCache'));
  return Object.freeze({
    archiveDigest:archive.archiveDigest,
    packageDigest:archive.packageDigest,
    validatorVersion:sensaPortableLightweightPackageValidatorVersion,
    status:previewStatus(archive,installed),
    package:archive.package,
    mediaBytes:[...archive.mediaById.values()].reduce((total,value)=>total+value.byteLength,0),
    mediaCount:archive.package.media.length,
  });
}

const bytesToBase64=(bytes:Uint8Array):string=>{
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=0x8000){
    binary+=String.fromCharCode(...bytes.subarray(offset,Math.min(bytes.length,offset+0x8000)));
  }
  return btoa(binary);
};

const dataUrl=(archive:SensaPortableLightweightPackageArchive,mediaId:string):string=>{
  const media=archive.package.media.find(item=>item.mediaId===mediaId);
  const bytes=archive.mediaById.get(mediaId);
  if(!media||!bytes)return invalidPortablePackage(new Error(`Missing media: ${mediaId}`));
  return `data:${media.mimeType};base64,${bytesToBase64(bytes)}`;
};

type ResourceDraft=Readonly<{
  role:SensaLightweightInitialMaterialRole;
  ordinal:number;
  payload:Record<string,unknown>;
}>;

const compileContent=(archive:SensaPortableLightweightPackageArchive)=>{
  const value=archive.package;
  const drafts:ResourceDraft[]=[];
  const add=(role:SensaLightweightInitialMaterialRole,payload:Record<string,unknown>,ordinal=0)=>{
    drafts.push({role,ordinal,payload});
  };
  const cue=value.resources.experienceRecallCue;
  add('experience_recall_cue',{
    scene:cue.text??'',
    senseFocus:cue.senseFocus,
    ...(cue.images?.length?{images:cue.images.map(image=>({
      id:stableUuid(`sensa-portable-media:${value.metadata.packageId}:${image.mediaId}`),
      name:image.altText.slice(0,200),
      dataUrl:dataUrl(archive,image.mediaId),
    }))}:{}),
  });
  value.resources.optional.recallSupport?.forEach((item,index)=>add('recall_support',{text:item.text},index));
  add('target_expression',{
    surface:value.targetExpression.text,
    languageTag:value.route.targetLanguage,
    expressionKind:value.targetExpression.expressionKind,
    ...(value.targetExpression.spokenForm?{spokenForm:value.targetExpression.spokenForm}:{}),
    ...(value.targetExpression.acceptedForms?{acceptedForms:value.targetExpression.acceptedForms}:{}),
  });
  add('sense_confirmation',{meaning:value.resources.senseConfirmation.text});
  const pronunciation=value.resources.pronunciation;
  add('pronunciation',{
    audioUrl:dataUrl(archive,pronunciation.audioMediaId),
    surface:pronunciation.surface,
    languageTag:value.route.targetLanguage,
    source:pronunciation.source,
    method:pronunciation.method,
    phoneticNotation:pronunciation.phoneticNotation??null,
    accentLabel:pronunciation.accentLabel??null,
  });
  const structure=value.resources.optional.languageStructure;
  if(structure)add('language_structure',{
    expressionKind:value.targetExpression.expressionKind,
    expressionTypeLabel:structure.expressionTypeLabel,
    partOfSpeech:structure.partOfSpeech,
    ...(structure.usagePattern!==undefined?{usagePattern:structure.usagePattern}:{}),
    ...(structure.contrastNote!==undefined?{contrastNote:structure.contrastNote}:{}),
  });
  value.resources.optional.usageGuidance?.forEach((item,index)=>add('usage_guidance',{
    example:item.example,
    ...(item.translation!==undefined?{translation:item.translation}:{}),
    ...(item.audioMediaId?{audioUrl:dataUrl(archive,item.audioMediaId)}:{}),
  },index));
  add('scene_bridge',{text:value.resources.sceneBridge.text});
  const realization=value.resources.sceneRealization;
  add('scene_realization',{
    example:realization.example,
    translation:realization.translation,
    targetStart:realization.targetStart,
    targetEnd:realization.targetEnd,
    ...(realization.audioMediaId?{audioUrl:dataUrl(archive,realization.audioMediaId)}:{}),
    experienceResourceKey:'experience_recall_cue:0',
  });
  const sourced=(role:'boundary_contrast'|'word_formation'|'etymology',item:{text:string;source:string;sourceUrl:string}|undefined)=>{
    if(item)add(role,{explanation:item.text,source:item.source,sourceUrl:item.sourceUrl});
  };
  sourced('boundary_contrast',value.resources.optional.boundaryContrast);
  sourced('word_formation',value.resources.optional.wordFormation);
  if(value.resources.optional.mnemonic)add('mnemonic',{text:value.resources.optional.mnemonic.text,kind:'teaching_aid'});
  sourced('etymology',value.resources.optional.etymology);

  const roleOrder=new Map(SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND.materialRoles.map((role,index)=>[
    role.materialRoleKey,index,
  ]));
  const requestId=stableUuid(`sensa-portable-request:${value.metadata.packageId}:${value.sense.senseId}:${value.route.targetLanguage}:${value.route.supportLanguage}`);
  return sensaLightweightInitialMaterializationContentSchema.parse({
    contentDemandKey:LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_KEY,
    definitionVersion:LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_VERSION,
    contentGenerationRequestId:requestId,
    resources:drafts.sort((left,right)=>(roleOrder.get(left.role)??99)-(roleOrder.get(right.role)??99)||left.ordinal-right.ordinal).map(draft=>{
      const role=SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND.materialRoles.find(item=>item.materialRoleKey===draft.role)!;
      return {
        resourceKey:`${draft.role}:${draft.ordinal}`,
        materialRoleKey:draft.role,
        ordinal:draft.ordinal,
        materialCandidateId:stableUuid(`${requestId}:${draft.role}:${draft.ordinal}`),
        contentSchemaId:role.contentSchemaId,
        contentSchemaVersion:role.contentSchemaVersion,
        contentPayload:draft.payload,
        contentDigest:canonicalJsonDigest(draft.payload),
        sourceArtifactIds:[],
        sourceMaterialCandidateIds:[],
        productionMethod:'published_reuse',
        producerProvider:'sensa-portable',
        producerModel:null,
        producerPolicyId:role.provisioningPolicyId,
        producerPolicyVersion:role.provisioningPolicyVersion,
      };
    }),
  });
};

const compileBundle=(archive:SensaPortableLightweightPackageArchive):LearningPackageBundle=>{
  const value=archive.package;
  const senseSeed=`${value.metadata.packageId}:${value.sense.senseId}`;
  const bindingSeed=`${senseSeed}:${value.route.targetLanguage}:${value.targetExpression.expressionKind}:${value.targetExpression.text}:${value.targetExpression.spokenForm??''}`;
  return learningPackageSchema.parse({
    format:'sensa-learning-package-v1',
    id:value.metadata.packageId,
    version:String(value.metadata.version),
    title:value.metadata.title,
    targetLanguage:value.route.targetLanguage,
    supportLanguage:value.route.supportLanguage,
    entries:[{
      senseId:stableUuid(`sensa-portable-sense:${senseSeed}`),
      senseVersionId:stableUuid(`sensa-portable-sense-version:${senseSeed}`),
      bindingId:stableUuid(`sensa-portable-binding:${bindingSeed}`),
      bindingVersionId:stableUuid(`sensa-portable-binding-version:${bindingSeed}`),
      expression:value.targetExpression.text,
      meaning:value.resources.senseConfirmation.text,
      content:compileContent(archive),
    }],
  });
};

export async function installPortablePackage(
  bytes:Uint8Array,
  expectedArchiveDigest:string,
  signal?:AbortSignal,
):Promise<InstalledPackage>{
  await openLibrary();
  const input=openPortable(bytes);
  if(input.archiveDigest!==expectedArchiveDigest)throw new Error('localFlow.packageVersionChanged');
  if(signal?.aborted)throw new Error('localFlow.downloadCancelled');
  let canonicalBytes:Uint8Array;
  let canonical:SensaPortableLightweightPackageArchive;
  try{
    canonicalBytes=createSensaPortableLightweightPackage(input.package,input.mediaById);
    canonical=readSensaPortableLightweightPackage(canonicalBytes);
  }catch(cause){return invalidPortablePackage(cause);}
  const bundle=validatePackage(compileBundle(canonical));
  const installation=packageInstallationFor(bundle,canonical.archiveDigest,canonicalBytes.byteLength);
  let installed:InstalledPackage|undefined;
  await contentSupplyCommand({id:crypto.randomUUID(),kind:'package.install',input:{key:installation.key,digest:canonical.archiveDigest}},async tx=>{
    await learningOwner(tx);
    if(signal?.aborted)throw new Error('localFlow.downloadCancelled');
    const old=await tx.get<InstalledPackage>('packageCache',installation.key);
    const prior=await tx.get<PackageInstallation>('packageInstallations',installation.key);
    if(prior&&canonicalConsumerJson(packageInstallationSchema.parse(prior))!==canonicalConsumerJson(installation))throw new Error('localFlow.packageVersionChanged');
    if(old&&(
      old.portableOrigin?.packageDigest!==canonical.packageDigest
      ||canonicalConsumerJson(old.bundle)!==canonicalConsumerJson(bundle)
    ))throw new Error('localFlow.packageVersionChanged');
    installed=old??{
      key:packageKey(bundle),
      digest:canonical.archiveDigest,
      bundle,
      installedAt:new Date().toISOString(),
      portableOrigin:{
        format:'sensa-portable-installation-origin-v1',
        manifest:canonical.package,
        packageDigest:canonical.packageDigest,
        archiveDigest:canonical.archiveDigest,
        validatorVersion:sensaPortableLightweightPackageValidatorVersion,
      },
    };
    tx.put('packageInstallations',installation.key,installation);
    tx.put('packageCache',installation.key,installed);
    return {key:installation.key,digest:canonical.archiveDigest};
  });
  if(!installed)throw new Error('localFlow.storageWrite');
  return installed;
}

const base64ToBytes=(value:string):Uint8Array=>{
  const separator=value.indexOf(',');
  if(separator<0)return invalidPortablePackage(new Error('Invalid media Data URL'));
  const binary=atob(value.slice(separator+1));
  return Uint8Array.from(binary,character=>character.charCodeAt(0));
};

const material=(pack:InstalledPackage,role:string,ordinal=0):Record<string,unknown>=>{
  const resource=pack.bundle.entries[0]?.content.resources.find(item=>item.materialRoleKey===role&&item.ordinal===ordinal);
  if(!resource)return invalidPortablePackage(new Error(`Missing installed resource: ${role}:${ordinal}`));
  return resource.contentPayload;
};

const reconstructMedia=(pack:InstalledPackage):ReadonlyMap<string,Uint8Array>=>{
  const manifest=pack.portableOrigin?.manifest;
  if(!manifest)return invalidPortablePackage(new Error('Installed package has no portable origin'));
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
