import {canonicalJsonDigest,stableUuid} from '@sensa/learning-kernel';
import {LEARNING_PROTOCOL_PURPOSES,learningPolicyProfileRegistry} from '../../learning/runtime/policyProfiles';
import {inspectLocalTargetPurposeReadiness} from '../../learning/runtime/runtimeCoordinator';
import type {LocalCurriculumMembership,LocalLearningResource,LocalLearningTarget} from '../../learning/runtime/localProtocol';
import type {LocalStudyScopeMember,StudyScopeSource} from './studyScopes';

export function studyScopeMemberIdentity(target:LocalLearningTarget):Omit<LocalStudyScopeMember,'sources'>{
 const profile=learningPolicyProfileRegistry.get(target.committedPolicy?.profileId??target.policyAssignment.profileId,target.committedPolicy?.profileVersion);
 return {targetId:target.id,retentionTargetId:target.retentionId,senseId:target.identity.senseId,senseVersionId:target.identity.senseVersionId,bindingId:target.identity.senseExpressionBindingId,bindingVersionId:target.identity.bindingVersionId,policy:{assignmentId:target.policyAssignment.assignmentId,assignmentRevision:target.policyAssignment.revision,profileId:profile.profileId,profileVersion:profile.profileVersion}};
}

/** Immutable provenance for an actually selected Run source, not a cached
 * readiness verdict for the rest of the learner's collection. */
export function studyScopeSourceSnapshot(target:LocalLearningTarget,membership:LocalCurriculumMembership,resource:LocalLearningResource|undefined):Omit<StudyScopeSource,'introduce'|'ongoing'|'supplementalState'>{
 const profile=learningPolicyProfileRegistry.get(target.committedPolicy?.profileId??target.policyAssignment.profileId,target.committedPolicy?.profileVersion);
 const readiness=inspectLocalTargetPurposeReadiness(target,membership,resource);
 const plans=LEARNING_PROTOCOL_PURPOSES.map(purpose=>{
  const ready=readiness[purpose],binding=profile.protocols[purpose];
  const reference={purpose,readiness:ready.status,profileId:profile.profileId,profileVersion:profile.profileVersion,protocolId:binding.protocolId,protocolVersion:binding.protocolVersion,runtimeAdapterId:binding.runtimeAdapterId,contentDemands:[...structuredClone(binding.contentDemands)],materializationIds:[...ready.materializationIds],reason:ready.reason};
  return {...reference,revisionId:stableUuid(`local-scope-plan:${target.id}:${membership.id}:${canonicalJsonDigest(reference)}`)};
 });
 return {membershipId:membership.id,membershipRevision:membership.revision,membershipStatus:membership.status??'active',sourceKind:membership.sourceKind,enrollmentId:typeof membership.provenance.curriculumEnrollmentId==='string'?membership.provenance.curriculumEnrollmentId:null,packageKey:membership.packageKey,...(membership.assurancePackageKey?{assurancePackageKey:membership.assurancePackageKey}:{}),provenance:structuredClone(membership.provenance),plans};
}
