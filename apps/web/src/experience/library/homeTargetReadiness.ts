import type {InstalledPackage} from '../../data/library/packageRecords';
import type {LocalCurriculumMembership,LocalLearningTarget} from '../../learning/runtime/localProtocol';
import type {LearningPolicyId} from '../../learning/runtime/policyProfiles';

const supportedPolicies=new Set<LearningPolicyId>(['lightweight','high_assurance','interleaved_four_stage']);

/**
 * The Home queue is a cheap projection, not the authoritative protocol
 * admission boundary. It only consumes validation facts that were persisted by
 * package installation or personal-material preparation. Starting a Run still
 * performs the complete digest, policy-version and adapter checks in
 * inspectLocalTargetReadiness.
 */
export function homeTargetReadiness(
 target:Pick<LocalLearningTarget,'policyAssignment'|'committedPolicy'>,
 membership:LocalCurriculumMembership|undefined,
 resource:InstalledPackage|undefined,
):'ready'|'blocked'{
 if(!membership||membership.material.snapshot.validationStatus!=='validated')return 'blocked';
 const profileId=homeTargetPolicy(target);
 if(!supportedPolicies.has(profileId))return 'blocked';
 if(profileId!=='lightweight'&&(!resource||!membership.assurancePackageKey))return 'blocked';
 return 'ready';
}

export function homeTargetPolicy(
 target:Pick<LocalLearningTarget,'policyAssignment'|'committedPolicy'>,
):LearningPolicyId{
 return target.committedPolicy?.profileId??target.policyAssignment.profileId;
}
