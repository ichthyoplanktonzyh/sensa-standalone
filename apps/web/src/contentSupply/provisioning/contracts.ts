import type {
  SensaContextImage,
  SensaExpressionType,
  SensaFormalPinnedLanguageContext,
  SensaSenseSemanticSpec,
} from '@sensa/contracts/sensa';

/** Immutable Personal Semantic World reference pinned for one provisioning task. */
export interface PersonalMeaningLearningReference {
  personalMeaningId: string;
  personalMeaningRevisionId: string;
  personalMeaningAlignmentId: string;
  alignmentRevision: number;
  alignmentBasisReferenceId: string;
  meaningFocusId: string | null;
  senseId: string;
  senseVersionId: string;
  bindingId: string;
  bindingVersionId: string;
}

/** Resolved, read-only handoff from Personal Semantic World to Content Supply. */
export interface PersonalMeaningLearningSource {
  sourceKind: 'personal_meaning_alignment';
  reference: PersonalMeaningLearningReference;
  targetLanguageTag: string;
  context: {
    text: string;
    images: SensaContextImage[];
    personalSemanticAnchorRevisionIds: string[];
  };
  expression: {
    spokenForm?: string;
    formParts?: { kind: 'fixed' | 'slot'; text: string; constraint?: string }[];
    surfaceForm: string;
    expressionType: SensaExpressionType;
    languageTag: string;
  };
  semanticSpec: SensaSenseSemanticSpec;
}

export type ContentProvisioningStatus =
  | 'waiting'
  | 'generating'
  | 'reviewing'
  | 'failed'
  | 'rejected'
  | 'stopped'
  | 'ready';

/** Learner-private Content Supply task. It is not a Curriculum or progress record. */
export interface ContentProvisioningTask {
  replacing?: boolean;
  id: string;
  source: PersonalMeaningLearningReference;
  targetId: string;
  curriculumMembershipId: string;
  languageContext: SensaFormalPinnedLanguageContext;
  planRevision: string;
  useContext: boolean;
  status: ContentProvisioningStatus;
  attemptId: string | null;
  leaseUntil: number;
  notice: string;
  createdAt: string;
}

export const personalLearningSourceKey = (
  reference: PersonalMeaningLearningReference,
): string => `${reference.personalMeaningAlignmentId}:${reference.bindingVersionId}`;

export const personalLearningSourceRevision = (
  reference: PersonalMeaningLearningReference,
): string => [
  reference.personalMeaningRevisionId,
  reference.alignmentRevision,
  reference.senseVersionId,
  reference.bindingVersionId,
].join(':');
