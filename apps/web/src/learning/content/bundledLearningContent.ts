import type { SensaRuntimeLearningRelease } from '@sensa/contracts/sensa';
import runtimeRelease from './releases/golden-learning-release-v1.json';
import {
  installLearningRelease,
  type RuntimeLearningContent,
  type RuntimeLearningPackage,
} from './learningCatalog';

/**
 * Explicit adapter for the starter content shipped with the Web application.
 * Formal Package execution receives its own pinned release and never falls
 * back to this singleton.
 */
export const bundledLearningCatalog = installLearningRelease(runtimeRelease);
export const bundledLearningRelease: SensaRuntimeLearningRelease = bundledLearningCatalog.release;
export const BUNDLED_LEARNING_CONTENT: readonly RuntimeLearningContent[] =
  bundledLearningCatalog.packages.map((pkg) => pkg.content);
export const BUNDLED_LEARNING_PACKAGES: readonly RuntimeLearningPackage[] =
  bundledLearningCatalog.packages;
export const BUNDLED_PACKAGE_BY_SENSE: ReadonlyMap<string, RuntimeLearningPackage> = new Map(
  BUNDLED_LEARNING_PACKAGES.map((pkg) => [pkg.senseId, pkg] as const),
);

export const bundledPackageBySense = (senseId: string): RuntimeLearningPackage | null =>
  bundledLearningCatalog.getPackageBySense(senseId);
