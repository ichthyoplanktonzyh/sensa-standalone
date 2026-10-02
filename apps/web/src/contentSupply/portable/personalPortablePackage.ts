import type {
  SensaPortableLightweightMedia,
  SensaPortableLightweightPackage,
} from '@sensa/contracts/sensa';
import {createSensaPortableLightweightPackage} from '@sensa/content-validator/portable-lightweight';
import {sha256,stableUuid} from '@sensa/learning-kernel';

import type {ContentProvisioningTask} from '../provisioning/contracts';
import type {LocalCurriculumMembership,LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {openLibrary,readLibrary} from '../../data/library/store';
import type {PortablePackageExport} from './portablePackage';

type Payload=Record<string,unknown>;

const invalid=():never=>{throw new Error('localFlow.resourceInvalid');};
const requiredString=(value:unknown):string=>typeof value==='string'&&value.trim()?value:invalid();
const optionalString=(value:unknown):string|undefined=>typeof value==='string'&&value.trim()?value:undefined;
const nullableString=(value:unknown):string|null|undefined=>value===null?null:optionalString(value);
const object=(value:unknown):Payload=>value&&typeof value==='object'&&!Array.isArray(value)?value as Payload:invalid();

const base64ToBytes=(value:string):{mimeType:string;bytes:Uint8Array}=>{
  const match=/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if(!match)return invalid();
  const binary=atob(match[2]!);
  return {
    mimeType:match[1]!,
    bytes:Uint8Array.from(binary,character=>character.charCodeAt(0)),
  };
};

const resourcesFor=(membership:LocalCurriculumMembership)=>{
  const resources=membership.material.content.resources;
  const all=(role:string)=>resources
    .filter(resource=>resource.materialRoleKey===role)
    .sort((left,right)=>left.ordinal-right.ordinal)
    .map(resource=>object(resource.contentPayload));
  const one=(role:string)=>all(role)[0]??invalid();
  return {all,one};
};

/**
 * Reuses the public Portable v2 contract for learner-private Web Agent output.
 * Generation traces, provider settings, grants and learning state never enter
 * the exported artifact; only the admitted learning material crosses the seam.
 */
export async function exportPersonalPortablePackage(taskId:string):Promise<PortablePackageExport>{
  await openLibrary();
  const state=await readLibrary(async tx=>{
    const task=await tx.get<ContentProvisioningTask>('personalLearning',taskId);
    if(!task||task.status!=='ready')return null;
    const target=await tx.get<LocalLearningTarget>('learningTargets',task.targetId);
    const membership=target?.curriculumMemberships.find(item=>item.id===task.curriculumMembershipId);
    return target&&membership?{task,target,membership}:null;
  });
  if(!state)return invalid();
  const {task,target,membership}=state;
  const {one,all}=resourcesFor(membership);
  const media: SensaPortableLightweightMedia[]=[];
  const mediaById=new Map<string,Uint8Array>();
  const mediaByIdentity=new Map<string,string>();
  const addMedia=(value:unknown,kind:'audio'|'image'):string=>{
    const {mimeType,bytes}=base64ToBytes(requiredString(value));
    if(!mimeType.toLowerCase().startsWith(`${kind}/`))return invalid();
    const digest=sha256(bytes),identity=`${kind}:${mimeType}:${digest}`;
    const known=mediaByIdentity.get(identity);
    if(known)return known;
    const mediaId=`${kind}-${digest}`;
    if(media.some(item=>item.mediaId===mediaId))return invalid();
    media.push({mediaId,kind,mimeType,sha256:digest,sizeBytes:bytes.byteLength});
    mediaById.set(mediaId,bytes);
    mediaByIdentity.set(identity,mediaId);
    return mediaId;
  };

  const cue=one('experience_recall_cue');
  const cueText=optionalString(cue.scene);
  const cueImages=Array.isArray(cue.images)?cue.images.map((raw,index)=>{
    const image=object(raw);
    return {
      mediaId:addMedia(image.dataUrl,'image'),
      // Personal image names originate in local filenames, not authored alt text.
      altText:`Learning image ${index+1}`,
    };
  }):undefined;
  const cueHtml=optionalString(cue.html);
  if(!cueText&&!cueImages?.length&&!cueHtml)return invalid();

  const expression=one('target_expression');
  const confirmation=one('sense_confirmation');
  const pronunciation=one('pronunciation');
  const bridge=one('scene_bridge');
  const realization=one('scene_realization');
  const translation=nullableString(realization.translation);
  const targetStart=realization.targetStart;
  const targetEnd=realization.targetEnd;
  if(!Number.isInteger(targetStart)||!Number.isInteger(targetEnd))return invalid();

  const optional:{
    recallSupport?:Array<{text:string}>;
    languageStructure?:{
      expressionTypeLabel:string|null;
      partOfSpeech:string|null;
      usagePattern?:string|null;
      contrastNote?:string|null;
    };
    usageGuidance?:Array<{example:string;translation?:string|null;audioMediaId?:string}>;
    boundaryContrast?:{text:string;source:string;sourceUrl:string};
    wordFormation?:{text:string;source:string;sourceUrl:string};
    mnemonic?:{text:string};
    etymology?:{text:string;source:string;sourceUrl:string};
  }={};
  const recallSupport=all('recall_support').map(item=>({text:requiredString(item.text)}));
  if(recallSupport.length)optional.recallSupport=recallSupport;
  const structures=all('language_structure');
  if(structures.length){
    const structure=structures[0]!;
    optional.languageStructure={
      expressionTypeLabel:nullableString(structure.expressionTypeLabel)??null,
      partOfSpeech:nullableString(structure.partOfSpeech)??null,
      ...(structure.usagePattern!==undefined?{usagePattern:nullableString(structure.usagePattern)??null}:{}),
      ...(structure.contrastNote!==undefined?{contrastNote:nullableString(structure.contrastNote)??null}:{}),
    };
  }
  const usage=all('usage_guidance').map(item=>({
    example:requiredString(item.example),
    ...(item.translation!==undefined?{translation:nullableString(item.translation)??null}:{}),
    ...(item.audioUrl?{audioMediaId:addMedia(item.audioUrl,'audio')}:{}),
  }));
  if(usage.length)optional.usageGuidance=usage;
  const sourced=(role:'boundary_contrast'|'word_formation'|'etymology')=>{
    const item=all(role)[0];
    if(item)optional[role==='boundary_contrast'
      ?'boundaryContrast'
      :role==='word_formation'
        ?'wordFormation'
        :'etymology']={
      text:requiredString(item.explanation),
      source:requiredString(item.source),
      sourceUrl:requiredString(item.sourceUrl),
    };
  };
  sourced('boundary_contrast');
  sourced('word_formation');
  sourced('etymology');
  const mnemonic=all('mnemonic')[0];
  if(mnemonic)optional.mnemonic={text:requiredString(mnemonic.text)};

  const expressionText=requiredString(expression.surface);
  const meaning=requiredString(confirmation.meaning);
  const expressionKind=requiredString(expression.expressionKind) as SensaPortableLightweightPackage['targetExpression']['expressionKind'];
  const acceptedForms=Array.isArray(expression.acceptedForms)
    ?expression.acceptedForms.map(requiredString)
    :undefined;
  const manifest:SensaPortableLightweightPackage={
    format:'sensa-portable-lightweight-package-v2',
    metadata:{
      packageId:stableUuid(`sensa-personal-portable:${task.id}`),
      version:membership.revision,
      title:`${expressionText} — ${meaning}`.slice(0,500),
      description:'Personal learning material created in Sensa.',
      createdAt:membership.material.snapshot.createdAt,
      author:{name:'Sensa learner'},
      license:{name:'Private personal use'},
    },
    route:{
      targetLanguage:task.languageContext.targetLanguageTag,
      supportLanguage:task.languageContext.supportLanguageTag,
    },
    sense:{senseId:task.source.senseId,meaning},
    targetExpression:{
      text:expressionText,
      expressionKind,
      ...(optionalString(expression.spokenForm)?{spokenForm:optionalString(expression.spokenForm)}:{}),
      ...(acceptedForms?.length?{acceptedForms}:{}),
    },
    resources:{
      experienceRecallCue:{
        ...(cueText?{text:cueText}:{}),
        senseFocus:requiredString(cue.senseFocus),
        ...(cueImages?.length?{images:cueImages}:{}),
        ...(cueHtml?{html:cueHtml}:{}),
      },
      senseConfirmation:{text:meaning},
      pronunciation:{
        surface:requiredString(pronunciation.surface),
        audioMediaId:addMedia(pronunciation.audioUrl,'audio'),
        method:requiredString(pronunciation.method) as 'recording'|'tts',
        source:requiredString(pronunciation.source),
        phoneticNotation:nullableString(pronunciation.phoneticNotation)??null,
        accentLabel:nullableString(pronunciation.accentLabel)??null,
      },
      sceneBridge:{text:requiredString(bridge.text)},
      sceneRealization:{
        example:requiredString(realization.example),
        ...(translation!==undefined?{translation}:{}),
        targetStart:targetStart as number,
        targetEnd:targetEnd as number,
        ...(realization.audioUrl?{audioMediaId:addMedia(realization.audioUrl,'audio')}:{}),
      },
      optional,
    },
    media,
  };
  let bytes:Uint8Array;
  try{bytes=createSensaPortableLightweightPackage(manifest,mediaById);}
  catch(cause){throw new Error('localFlow.resourceInvalid',{cause});}
  return {
    fileName:`${manifest.metadata.packageId}-v${manifest.metadata.version}.sensa`,
    bytes,
  };
}
