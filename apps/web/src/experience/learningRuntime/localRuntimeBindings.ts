import { learningPolicyProfileRegistry, type LearningProtocolPurpose, type PrototypeLearningPolicy } from './policyProfiles';
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
export function localRuntimeAdapter(protocolVersion: string, purpose: LearningProtocolPurpose): string {
  return learningPolicyProfileRegistry.get(localRuntimePolicy(protocolVersion)).protocols[purpose].runtimeAdapterId;
}
