import {
 LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_KEY,LIGHTWEIGHT_INITIAL_CONTENT_DEMAND_VERSION,
 SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,canonicalConsumerJson,installedLearningContentSchema,
 sensaLightweightInitialMaterializationContentSchema,sensaPortableBookDescriptorSchema,
 type InstalledLearningContent,type SensaLightweightInitialMaterialRole,type SensaPortableBookDescriptor,
} from '@sensa/contracts/sensa';
import {createSensaPortableLightweightPackageArchive,readSensaPortableLightweightPackage,type SensaPortableLightweightPackageArchive} from '@sensa/content-validator/portable-lightweight';
import {readSensaPortableBook,type SensaPortableBookPackage} from '@sensa/content-validator/portable-book';
import {canonicalJsonDigest,stableUuid} from '@sensa/learning-kernel';
import {portablePackageInstallationFor,publicationBookMembership,type PackageInstallation,type PortablePublicationAttestation} from '../../data/library/packageRecords';
import {validateInstalledLearningContent} from './installedLearningContent';

const invalidPortablePackage=(cause:unknown):never=>{throw new Error('localFlow.resourceInvalid',{cause});};

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
    ...(cue.html?{html:cue.html}:{}),
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
    ...(realization.translation!==undefined?{translation:realization.translation}:{}),
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

const compileInstalledContent=(
  archive:SensaPortableLightweightPackageArchive,
  publication?:PortablePublicationAttestation,
):InstalledLearningContent=>{
  const value=archive.package;
  const declaration=publication?value.semanticDeclaration:undefined;
  if(publication&&!declaration)return invalidPortablePackage(
    new Error('Published Portable Package has no semantic declaration'),
  );
  const senseSeed=`${value.metadata.packageId}:${value.sense.senseId}`;
  const bindingSeed=`${senseSeed}:${value.route.targetLanguage}:${value.targetExpression.expressionKind}:${value.targetExpression.text}:${value.targetExpression.spokenForm??''}`;
  return installedLearningContentSchema.parse({
    format:'sensa-installed-learning-content-v1',
    targetLanguage:value.route.targetLanguage,
    supportLanguage:value.route.supportLanguage,
    entries:[{
      senseId:declaration?.sense.senseId??stableUuid(`sensa-portable-sense:${senseSeed}`),
      senseVersionId:declaration?.sense.senseVersionId??stableUuid(`sensa-portable-sense-version:${senseSeed}`),
      bindingId:declaration?.binding.senseExpressionBindingId??stableUuid(`sensa-portable-binding:${bindingSeed}`),
      bindingVersionId:declaration?.binding.bindingVersionId??stableUuid(`sensa-portable-binding-version:${bindingSeed}`),
      expression:value.targetExpression.text,
      meaning:value.resources.senseConfirmation.text,
      content:compileContent(archive),
      ...(declaration?{semantic:{
        senseKey:declaration.sense.senseKey,
        senseVersionNumber:declaration.sense.versionNumber,
        semanticPolicyVersion:declaration.sense.semanticPolicyVersion,
        semanticSpec:declaration.sense.semanticSpec,
        expressionId:declaration.expression.expressionId,
        expressionVersionId:declaration.expression.expressionVersionId,
        expressionType:declaration.expression.expressionType,
        expressionVersionNumber:declaration.expression.versionNumber,
        expressionStructure:declaration.expression.structure,
        bindingVersionNumber:declaration.binding.versionNumber,
        relation:declaration.binding.relation,
        semanticCoverage:declaration.binding.semanticCoverage,
        registerLabel:declaration.binding.registerLabel,
        usageConstraints:declaration.binding.usageConstraints,
      }}:{}),
    }],
  });
};

export type PreparedPortableInstallation=Readonly<{
  canonical:Pick<SensaPortableLightweightPackageArchive,'package'|'archiveDigest'|'packageDigest'>;
  content:InstalledLearningContent;
  installation:PackageInstallation;
  publication?:PortablePublicationAttestation;
}>;

/** Preview returns validated metadata, never transfers decoded media to the UI. */
export function inspectPortablePackage(bytes:Uint8Array){
  let archive:SensaPortableLightweightPackageArchive;
  try{archive=readSensaPortableLightweightPackage(bytes);}
  catch(cause){return invalidPortablePackage(cause);}
  return {
    package:archive.package,archiveDigest:archive.archiveDigest,packageDigest:archive.packageDigest,
    mediaBytes:[...archive.mediaById.values()].reduce((total,value)=>total+value.byteLength,0),
    mediaCount:archive.package.media.length,
  };
}

export function prepareStandalonePortablePackage(bytes:Uint8Array,expectedArchiveDigest:string){
  let archive:SensaPortableLightweightPackageArchive;
  try{archive=readSensaPortableLightweightPackage(bytes);}
  catch(cause){return invalidPortablePackage(cause);}
  if(archive.archiveDigest!==expectedArchiveDigest)throw new Error('localFlow.packageVersionChanged');
  return preparePortablePackage(bytes,archive);
}

export const preparePortablePackage=(
  bytes:Uint8Array,
  input:SensaPortableLightweightPackageArchive,
  publication?:PortablePublicationAttestation,
):PreparedPortableInstallation=>{
  if(publication&&(
    publication.member.packageId!==input.package.metadata.packageId
    ||publication.member.version!==input.package.metadata.version
    ||publication.route.targetLanguage!==input.package.route.targetLanguage
    ||publication.route.supportLanguage!==input.package.route.supportLanguage
    ||input.package.semanticDeclaration===undefined
  ))throw new Error('localFlow.catalogMismatch');
  let canonicalBytes:Uint8Array;
  let canonical:SensaPortableLightweightPackageArchive;
  try{
    const created=createSensaPortableLightweightPackageArchive(input.package,input.mediaById);
    canonicalBytes=created.bytes;
    canonical=created.archive;
  }catch(cause){return invalidPortablePackage(cause);}
  const content=validateInstalledLearningContent(compileInstalledContent(canonical,publication));
  const installation=portablePackageInstallationFor(
    canonical.package,
    canonical.archiveDigest,
    canonical.packageDigest,
    canonicalBytes.byteLength,
    publication?.bookArchiveSha256,
    publication?publicationBookMembership(publication):undefined,
  );
  return {canonical:{package:canonical.package,archiveDigest:canonical.archiveDigest,packageDigest:canonical.packageDigest},content,installation,...(publication?{publication}:{})};
};


/** Closed admission and compilation only: no library access or learning writes. */
export function readPublishedBook(bytes:Uint8Array,raw:SensaPortableBookDescriptor):SensaPortableBookPackage {
 const descriptor=sensaPortableBookDescriptorSchema.parse(raw);
 let archive:SensaPortableBookPackage;
 try{archive=readSensaPortableBook(bytes);}catch(cause){throw new Error('localFlow.catalogMismatch',{cause});}
 const manifest=archive.manifest;
 const actual=sensaPortableBookDescriptorSchema.parse({
  format:'sensa-portable-book-descriptor-v1',publisher:manifest.publisher,book:manifest.book,
  contentRelease:manifest.contentRelease,route:manifest.route,publishedAt:manifest.publishedAt,
  changeSummary:manifest.changeSummary,memberCount:manifest.members.length,
  byteLength:bytes.byteLength,sha256:archive.archiveDigest,url:descriptor.url,
 });
 if(canonicalConsumerJson(actual)!==canonicalConsumerJson(descriptor))throw new Error('localFlow.catalogMismatch');
 return archive;
}

export function preparePublishedBook(bytes:Uint8Array,descriptor:SensaPortableBookDescriptor):readonly PreparedPortableInstallation[]{
 const archive=readPublishedBook(bytes,descriptor),manifest=archive.manifest;
 return archive.members.map(({bytes,archive:memberArchive,member},memberIndex)=>preparePortablePackage(bytes,memberArchive,{
  format:'sensa-portable-publication-attestation-v2',publisher:manifest.publisher,book:manifest.book,
  contentRelease:manifest.contentRelease,route:manifest.route,publishedAt:manifest.publishedAt,
  changeSummary:manifest.changeSummary,bookArchiveSha256:archive.archiveDigest,
  memberCount:manifest.members.length,memberIndex,member,
 }));
}
