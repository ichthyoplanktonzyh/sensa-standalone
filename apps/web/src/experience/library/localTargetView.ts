import {localCurriculumMeaning} from '../../learning/runtime/localCurriculum';
import {localTargetPolicy} from '../../learning/runtime/localRuntimeBindings';
import type {LocalCurriculumMembership} from '../../learning/runtime/localProtocol';
import type {LearningTargetView as LocalLearningTarget} from '../../learning/system';
import {localFlowText} from '../../i18n/localFlowText';

export const localTargetView=(
 t:LocalLearningTarget,
 membership:LocalCurriculumMembership,
 readiness:'ready'|'blocked'='ready',
)=>({
 targetId:t.id,
 expression:t.expression,
 meaning:localCurriculumMeaning(membership),
 targetLanguageTag:t.targetLanguageTag,
 supportLanguageTag:membership.languageContext.supportLanguageTag,
 example:String(membership.material.content.resources.find(resource=>resource.materialRoleKey==='usage_guidance')?.contentPayload.example??''),
 partOfSpeech:'',
 expressionTypeLabel:localFlowText('expression'),
 sourceKind:membership.packageKey?'book' as const:'personal_semantic_world' as const,
 sourceLabel:membership.packageKey?localFlowText('downloadedPackages'):localFlowText('semanticWorld'),
 runtimeSenseId:null,
 personalExperienceGrounding:null,
 policy:localTargetPolicy(t),
 lightweightReadiness:{
  status:readiness,
  label:readiness==='ready'?localFlowText('downloaded'):localFlowText('prepareResources'),
  detail:readiness==='ready'?localFlowText('resourcesLocal'):localFlowText('resourceInvalid'),
 },
});
