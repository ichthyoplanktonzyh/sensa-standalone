/**
 * Frozen identity of the Resolver that translates an approved learning
 * package into the capabilities the current Action runtime can execute.
 *
 * This version is a replay fact. It must change whenever identical package
 * input could resolve to a different inventory or issue set.
 */
export const sensaExecutableLearningCapabilityResolverVersion =
  "sensa-executable-learning-capability-resolver-v1" as const;

export type SensaExecutableLearningCapabilityResolverVersion =
  typeof sensaExecutableLearningCapabilityResolverVersion;
