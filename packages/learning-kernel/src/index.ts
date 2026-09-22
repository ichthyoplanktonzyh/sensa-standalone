/**
 * Public interface of the pure Learning Kernel.
 *
 * The kernel exposes deterministic algorithms and their value types only. Web
 * persistence, Curriculum admission, policy selection, protocol registries,
 * sync and presentation belong to the host Learning System.
 */

export {
  canonicalJsonDigest,
  sha256,
  stableUuid,
} from './runtime/canonical.js';

export { memoryOutcomeExposesForgetting } from './runtime/memoryOutcome.js';
export type {
  GradedMemoryOutcome,
  MemoryOutcomeBasis,
  MemoryOutcomeEvidenceLevel,
  MemoryOutcomeGrade,
} from './runtime/memoryOutcome.js';

export {
  createCheckpointProgressionPolicy,
  createCompletionOnlyProgressionPolicy,
  createProtocolProgressState,
  decideAndApplyProtocolTransition,
} from './runtime/protocolProgression.js';
export type {
  LearningObservation,
  ProtocolCompletionPolicy,
  ProtocolObservationKind,
  ProtocolProgressDefinition,
  ProtocolProgressState,
  ProtocolProgressionPolicy,
  ProtocolTransitionDecision,
  ProtocolTransitionEffect,
} from './runtime/protocolProgression.js';

export {
  fsrsHandoffInitializerVersion,
  fsrsSchedulerAdapterVersion,
  initializeRetentionMemory,
  RetentionSchedulingError,
  scheduleMemoryOutcome,
} from './runtime/retentionScheduling.js';
export type {
  RetentionMemorySnapshot,
  RetentionSchedulingResult,
  RetentionSchedulingTrigger,
} from './runtime/retentionScheduling.js';

export type { ReviewSchedule } from './runtime/scheduling.js';

export { defaultWorkspaceSchedulerConfig } from './runtime/workspaceConfig.js';
export type {
  WorkspaceSchedulerConfig,
  WorkspaceSchedulerSettings,
} from './runtime/workspaceConfig.js';

export {
  lightweightProtocolStepId,
  lightweightProtocolVersions,
  lightweightSchedulingPolicy,
  transitionLightweightProtocol,
} from './runtime/lightweightProtocol.js';

export {
  sensaExecutableLearningCapabilityModule,
} from './runtime/executableLearningCapabilities.js';
export {
  sensaExecutableLearningCapabilityResolverVersion,
} from './runtime/executableLearningCapabilityVocabulary.js';
export type {
  SensaCapabilityAssetSnapshot,
  SensaCapabilityResolutionResult,
  SensaExecutableLearningCapabilityInventory,
  SensaExecutableLearningCapabilityModule,
  SensaLearningPackageCapabilitySnapshot,
} from './runtime/executableLearningCapabilities.js';
