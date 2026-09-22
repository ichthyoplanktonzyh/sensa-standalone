/**
 * Content Supply-owned entry to the Lightweight Initial v1 provisioning contract.
 * The contract implementation remains pure so authoring tools and validators can
 * use the same admission logic without opening a learner Library.
 */
export {
  lightweightMaterializedResourcesForRole,
  admitLightweightInitialCandidateBundle,
  createLightweightInitialGenerationRequest,
  prepareLightweightInitialAgentAttempt,
  provisionLightweightInitialContent,
  validateLightweightInitialMaterialization,
} from '../../learning/runtime/lightweightInitialContent';
export type {
  LightweightInitialAgentAttemptPreparation,
  LightweightInitialContentInput,
  LightweightInitialLearningMaterialization,
  LightweightInitialOriginExperienceInput,
  LightweightInitialProvisioningResult,
  LightweightInitialReferenceFactInput,
} from '../../learning/runtime/lightweightInitialContent';
