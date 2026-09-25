import {
  installedLearningContentSchema,
  type InstalledLearningContent,
} from '@sensa/contracts/sensa';
import {validateRuntimeLearningRelease} from '@sensa/content-validator/runtime';
import {canonicalJsonDigest,sha256} from '@sensa/learning-kernel';

/** Validate the device-local Runtime projection compiled from admitted Portable bytes. */
export const validateInstalledLearningContent=(raw:unknown):InstalledLearningContent=>{
  const content=installedLearningContentSchema.parse(raw);
  if(content.assurance){
    const {release,audio}=content.assurance;
    if(validateRuntimeLearningRelease(release).issues.length){
      throw new Error('localFlow.resourceInvalid');
    }
    if(new Set(content.entries.map(entry=>entry.assurancePackageKey)).size!==content.entries.length){
      throw new Error('localFlow.packageMismatch');
    }
    for(const media of release.media){
      const data=audio[media.mediaKey];
      if(media.kind!=='audio'||!data)throw new Error('localFlow.audioIncomplete');
      const bytes=Uint8Array.from(atob(data.split(',')[1]!),character=>character.charCodeAt(0));
      if('sha256:'+sha256(bytes)!==media.sha256)throw new Error('localFlow.resourceInvalid');
    }
    if(Object.keys(audio).length!==release.media.length)throw new Error('localFlow.resourceInvalid');
    for(const entry of content.entries){
      const pack=release.packages.find(candidate=>candidate.identity.packageKey===entry.assurancePackageKey);
      const lexeme=release.lexemes.find(candidate=>candidate.lexemeKey===pack?.identity.lexemeKey);
      if(!pack||lexeme?.lemma!==entry.expression||pack.sense.guideLabelL1!==entry.meaning){
        throw new Error('localFlow.packageMismatch');
      }
    }
  }else if(content.entries.some(entry=>entry.assurancePackageKey)){
    throw new Error('localFlow.packageMismatch');
  }
  for(const entry of content.entries){
    const expression=entry.content.resources.find(
      resource=>resource.materialRoleKey==='target_expression',
    )?.contentPayload.surface;
    const meaning=entry.content.resources.find(
      resource=>resource.materialRoleKey==='sense_confirmation',
    )?.contentPayload.meaning;
    if(expression!==entry.expression||meaning!==entry.meaning){
      throw new Error('localFlow.packageMismatch');
    }
    for(const resource of entry.content.resources){
      if(resource.contentDigest!==canonicalJsonDigest(resource.contentPayload)){
        throw new Error('localFlow.resourceInvalid');
      }
      const audio=resource.contentPayload.audioUrl;
      if(
        audio!=null
        &&(
          typeof audio!=='string'
          ||!/^data:audio\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/u.test(audio)
        )
      )throw new Error('localFlow.audioIncomplete');
    }
  }
  return content;
};
