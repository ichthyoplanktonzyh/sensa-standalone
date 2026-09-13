import type {LocalLearningTarget,LocalLearningRun} from './localProtocol';
import { learningPolicyProfileRegistry, type LearningPolicyId } from './policyProfiles';
/** Every production Target and Run records its resolved, version-pinned Policy. */
export function localTargetPolicy(target:Pick<LocalLearningTarget,'policyAssignment'|'committedPolicy'>): LearningPolicyId {
  const profileId=target.committedPolicy?.profileId??target.policyAssignment.profileId;
  learningPolicyProfileRegistry.get(profileId,target.committedPolicy?.profileVersion);
  return profileId;
}
export function localRunPolicy(run:LocalLearningRun): LearningPolicyId {
  return run.policyProfileId;
}
export function localRunBinding(run:LocalLearningRun) {
  return run.protocolBinding;
}
