import {learningSupportMeaning,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import type {
  LocalCurriculumMembership,
  LocalExecutableLearningTarget,
  LocalLearningMaterialization,
  LocalLearningRunParticipant,
  LocalLearningTarget,
} from './localProtocol';

const samePair=(left:SensaFormalPinnedLanguageContext,right:SensaFormalPinnedLanguageContext)=>
  left.targetLanguageTag===right.targetLanguageTag&&left.supportLanguageTag===right.supportLanguageTag;
type MembershipRouteFacts = Pick<LocalCurriculumMembership,'status'|'languageContext'>;
const active=(membership:MembershipRouteFacts)=>membership.status!=='superseded';

/** Membership survives later Route revisions, while material remains usable
 * only when its pinned pair still matches the current Route. */
export function localCurriculumMembershipForContext<Membership extends MembershipRouteFacts>(
  target:Readonly<{curriculumMemberships:readonly Membership[]}>,
  context:SensaFormalPinnedLanguageContext,
):Membership|undefined {
  return [...target.curriculumMemberships].reverse().find(membership=>
    active(membership)&&membership.languageContext.languageRouteId===context.languageRouteId&&samePair(membership.languageContext,context));
}

export function localCurriculumMembershipForRoute<Membership extends MembershipRouteFacts>(
  target:Readonly<{curriculumMemberships:readonly Membership[]}>,
  languageRouteId:string,
):Membership|undefined {
  return [...target.curriculumMemberships].reverse().find(membership=>active(membership)&&membership.languageContext.languageRouteId===languageRouteId);
}

export function localTargetInRoute(
  target:Readonly<{curriculumMemberships:readonly MembershipRouteFacts[]}>,
  languageRouteId:string,
):boolean {
  return target.curriculumMemberships.some(membership=>active(membership)&&membership.languageContext.languageRouteId===languageRouteId);
}

export function localCurriculumMeaning(membership:LocalCurriculumMembership):string {
  return learningSupportMeaning(membership.material.content.resources,membership.languageContext.supportLanguageTag);
}

export function localExecutableTarget(
  target:LocalLearningTarget,
  membership:LocalCurriculumMembership,
):LocalExecutableLearningTarget {
  if(!target.curriculumMemberships.some(candidate=>candidate.id===membership.id))throw new Error('localFlow.routeMembershipMissing');
  return {
    ...structuredClone(target),
    curriculumMembership:structuredClone(membership),
    packageKey:membership.packageKey,
    ...(membership.assurancePackageKey?{assurancePackageKey:membership.assurancePackageKey}:{}),
    supportLanguageTag:membership.languageContext.supportLanguageTag,
    meaning:localCurriculumMeaning(membership),
    material:structuredClone(membership.material),
  };
}

export function localExecutableTargetForParticipant(
  target:LocalLearningTarget,
  participant:Pick<LocalLearningRunParticipant,'curriculumMembershipId'|'languageContext'|'material'>,
  presentedMaterial:LocalLearningMaterialization=participant.material,
):LocalExecutableLearningTarget {
  const membership=target.curriculumMemberships.find(candidate=>candidate.id===participant.curriculumMembershipId);
  if(!membership)throw new Error('localFlow.routeMembershipMissing');
  return localExecutableTarget(target,{...membership,languageContext:participant.languageContext,material:presentedMaterial});
}

/** Material currently bound to this Step. An explicit compatible refresh may
 * replace it until the learner acts; the acted Step then keeps that revision. */
export function localPresentedMaterial(
  participant:Pick<LocalLearningRunParticipant,'presentedMaterials'>,
  stepId:string,
):LocalLearningMaterialization {
  const material=participant.presentedMaterials[stepId];
  if(!material)throw new Error('localFlow.resourceInvalid');
  return material;
}

/** Historical summaries use the last material the Run actually presented, not
 * either today's Curriculum material or the Run's older planning baseline. */
export function localLastPresentedMaterial(
  participant:Pick<LocalLearningRunParticipant,'material'|'presentedMaterials'>,
):LocalLearningMaterialization {
  return Object.values(participant.presentedMaterials).at(-1)??participant.material;
}

/** Adding another source is idempotent and never changes Target/Retention identity. */
export function upsertLocalCurriculumMembership(
  target:LocalLearningTarget,
  membership:LocalCurriculumMembership,
):LocalLearningTarget {
  const index=target.curriculumMemberships.findIndex(candidate=>candidate.id===membership.id);
  const curriculumMemberships=index<0
    ?[...target.curriculumMemberships,membership]
    :target.curriculumMemberships.map((candidate,position)=>position===index?membership:candidate);
  return {...target,curriculumMemberships};
}
