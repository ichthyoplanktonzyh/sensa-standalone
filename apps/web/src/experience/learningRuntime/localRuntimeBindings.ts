import type {LocalLearningTarget,LocalLearningRun} from '../../data/library/learning';
import { learningPolicyProfileRegistry, type PrototypeLearningPolicy } from './policyProfiles';
/** Compatibility bindings for already persisted local runs. Never infer a method from its card. */
export const localRuntimeBindings: Readonly<Record<string, PrototypeLearningPolicy>> = {
  'consumer-initial-v1': 'lightweight',
  'consumer-review-v1': 'lightweight',
  'consumer-relearning-v1': 'lightweight',
  'sensa-high-assurance-v1': 'high_assurance'
};
export function localRuntimePolicy(protocolVersion: string): PrototypeLearningPolicy {
  const profileId = localRuntimeBindings[protocolVersion];
  if (!profileId) throw Error('Unknown local learning protocol: ' + protocolVersion);
  learningPolicyProfileRegistry.get(profileId);
  return profileId;
}
/** Only the pre-policy persisted format needs content-based identification. */
export function localTargetPolicy(target:Pick<LocalLearningTarget,'policyProfileId'|'assurancePackageKey'>): PrototypeLearningPolicy {
  return target.policyProfileId ?? (target.assurancePackageKey ? 'high_assurance' : 'lightweight');
}
export function localRunPolicy(run:LocalLearningRun): PrototypeLearningPolicy {
  return run.policyProfileId ?? localRuntimePolicy(run.protocolVersion);
}
export function localRunBinding(run:LocalLearningRun) {
  return run.protocolBinding ?? learningPolicyProfileRegistry.get(localRunPolicy(run),run.policyProfileVersion).protocols[run.purpose];
}
