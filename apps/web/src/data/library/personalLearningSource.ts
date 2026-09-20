import type {
  SensaContextImage,
  SensaExpressionType,
  SensaSenseSemanticSpec,
} from '@sensa/contracts/sensa';

/**
 * Immutable identity pinned when a Personal Meaning Alignment is explicitly
 * added to learning. It references the Personal Semantic World; it is not a
 * second Meaning record.
 */
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

/**
 * Read-only, fully resolved generation input projected from authoritative
 * Personal Semantic World facts. Callers may use it for one command, but only
 * the compact `reference` is persisted on a learning task.
 */
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
    formParts?: {kind:"fixed"|"slot";text:string;constraint?:string}[];
    surfaceForm: string;
    expressionType: SensaExpressionType;
    languageTag: string;
  };
  semanticSpec: SensaSenseSemanticSpec;
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
