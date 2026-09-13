import type { SensaRuntimeLearningRelease } from '@sensa/contracts/sensa';
import type { RepairResourceReference } from '../engine/types';
import type { RuntimeLearningContent } from './learningCatalog';

/** Resolve one Package-declared repair resource from the exact pinned release. */
export function materializeReviewRepairContent(
  content: RuntimeLearningContent,
  resourceRef: RepairResourceReference | null | undefined,
  release: SensaRuntimeLearningRelease,
): RuntimeLearningContent | null {
  if (!resourceRef || resourceRef.source !== 'package_declared' || !resourceRef.key) return null;
  const packageItem = release.packages.find((candidate) =>
    candidate.identity.packageKey === content.packageKey
    && candidate.identity.senseKey === content.senseKey,
  );
  if (!packageItem) return null;

  switch (resourceRef.role) {
    case 'experience_recap':
      if (packageItem.experience.recap.recapKey !== resourceRef.key) return null;
      return {
        ...content,
        experienceSketch: {
          labelsL1: packageItem.experience.recap.steps.map((step) => step.labelL1),
          bodyL1: packageItem.experience.recap.bodyL1,
        },
      };
    case 'l1_bridge':
      if (packageItem.l1Bridge.assetKey !== resourceRef.key) return null;
      return { ...content, l1Bridge: packageItem.l1Bridge.bodyL1 };
    case 'learning_example': {
      const rawExample = packageItem.examples.find((example) =>
        example.exampleKey === resourceRef.key && example.visibility === 'learning_only');
      const projectedExample = content.learningExamples.find((example) =>
        example.exampleKey === resourceRef.key);
      return rawExample && projectedExample ? { ...content, studyExample: projectedExample } : null;
    }
    case 'sense_features': {
      const relation = release.relations.find((candidate) => candidate.relationKey === resourceRef.key);
      const boundary = content.boundaryContrast;
      return relation && boundary?.relationKey === resourceRef.key
        ? { ...content, studyExample: boundary.example }
        : null;
    }
  }
}
