import {
  PROTOTYPE_LEARNING_PACKAGES,
  type PrototypeIntroductionPackage,
} from '../content/learningCatalog';
import {
  bindPackageToRetentionTarget,
  type SchedulablePackage,
} from '../engine/types';
import { retentionTargetIdFor } from './retentionScopes';

export type PrototypeSchedulablePackage = SchedulablePackage<PrototypeIntroductionPackage>;

/**
 * Deterministic learner bindings for Runtime/demo smoke only. Production UI binds
 * catalog Packages through its actual Learning Target before opening a queue.
 */
export const PROTOTYPE_RUNTIME_PACKAGES: readonly PrototypeSchedulablePackage[] =
  PROTOTYPE_LEARNING_PACKAGES.map((packageTemplate) => bindPackageToRetentionTarget(
    packageTemplate,
    retentionTargetIdFor(`runtime-fixture:${packageTemplate.senseId}`, 'semantic_connection'),
  ));
