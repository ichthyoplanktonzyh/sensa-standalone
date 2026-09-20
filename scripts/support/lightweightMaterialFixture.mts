import type {LightweightInitialContentInput} from '../../apps/web/src/learning/runtime/lightweightInitialContent.ts';
/** Synthetic material for storage/runtime tests only; these bytes do not claim pronunciation quality. */
export const syntheticSound=(surface:string,languageTag:string)=>({audioUrl:'data:audio/wav;base64,UklGRg==',surface,languageTag,source:'synthetic-test-fixture',method:'recording' as const,phoneticNotation:null,accentLabel:null});
export function withBindingFixture(input:LightweightInitialContentInput):LightweightInitialContentInput {
 const experience=input.originExperience!.experience;
 return {...input,originExperience:{...input.originExperience!,experience:{...experience,sceneBridge:experience.sceneBridge??'Synthetic experience binding',sceneRealization:experience.sceneRealization??{example:input.expression.surface,targetStart:0,targetEnd:input.expression.surface.length}}},referenceFacts:[...input.referenceFacts,{source:'pronunciation_lexicon',sourceVersion:'synthetic-v1',fact:{factKind:'pronunciation',...syntheticSound(input.expression.surface,input.expression.languageTag)}}]};
}
