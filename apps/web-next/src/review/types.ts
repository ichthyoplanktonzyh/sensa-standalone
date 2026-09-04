import type {
  GradedMemoryOutcome,
  MemoryOutcomeBasis,
  MemoryOutcomeGrade,
} from '@sensa/learning-kernel';

export type { MemoryOutcomeBasis, MemoryOutcomeGrade } from '@sensa/learning-kernel';

export type ReviewAssessmentKind =
  | 'context_recognition'
  | 'meaning_to_form_recall'
  | 'novel_context_transfer'
  | 'boundary_contrast';

/** Boundary requires an authored relation and is never inserted as a generic fallback. */
export const AUTOMATIC_REVIEW_KINDS: readonly ReviewAssessmentKind[] = [
  'context_recognition',
  'meaning_to_form_recall',
  'novel_context_transfer',
];

export type ReviewFocusDimension =
  | '语境辨义'
  | '词形提取'
  | '新语境迁移'
  | '义项边界';

export type ReviewMemoryOutcomeBasis = Extract<MemoryOutcomeBasis,
  | 'independent_retrieval'
  | 'transfer_confirmed'
  | 'retrieval_failed'>;

export type ReviewMemoryOutcome = GradedMemoryOutcome & Readonly<{
  basis: ReviewMemoryOutcomeBasis;
}>;

export type LearnerRatedMemoryOutcome<Grade extends MemoryOutcomeGrade = MemoryOutcomeGrade> =
  GradedMemoryOutcome & Readonly<{
    basis: 'learner_rated';
    grade: Grade;
    evidenceLevel: 'self_report';
  }>;

export interface ReviewAssessmentResult {
  assessmentId: string;
  kind: ReviewAssessmentKind;
  focusDimension: ReviewFocusDimension;
  correct: boolean;
  responseId: string | null;
  memoryOutcome: ReviewMemoryOutcome | null;
  /** Boundary previews never enter Evidence or update FSRS. */
  evidenceEligible: boolean;
}

/**
 * Boundary contrast is a semantic diagnostic preview in the current MVP. It
 * has no legal Memory Outcome/FSRS settlement by itself, so automatic Review
 * planning must not treat it as a due-completing assessment.
 */
export function canProduceReviewMemoryOutcome(kind: ReviewAssessmentKind): boolean {
  return kind !== 'boundary_contrast';
}

export function resolveReviewFocusDimension(kind: ReviewAssessmentKind): ReviewFocusDimension {
  switch (kind) {
    case 'context_recognition': return '语境辨义';
    case 'meaning_to_form_recall': return '词形提取';
    case 'novel_context_transfer': return '新语境迁移';
    case 'boundary_contrast': return '义项边界';
  }
}

export interface ReviewExampleExcerpt {
  exampleKey: string;
  textL2: string;
  textL1: string;
  targetSurface: string;
  targetStart: number;
  targetEnd: number;
}

interface ReviewAssessmentBase {
  id: string;
  /** Exact immutable Assessment Task selected by the current Action. */
  taskKey: string;
  kind: ReviewAssessmentKind;
  focusDimension: ReviewFocusDimension;
  kickerL1: string;
  titleL1: string;
  instructionL1: string;
  evidenceEligible: boolean;
}

export interface ReviewChoiceOption {
  id: string;
  labelL1: string;
  detailL1?: string;
  isCorrect: boolean;
  feedbackTitleL1: string;
  feedbackBodyL1: string;
}

export interface ReviewContextRecognitionSpec extends ReviewAssessmentBase {
  kind: 'context_recognition';
  example: ReviewExampleExcerpt;
  contextLabelL1: string;
  questionL1: string;
  options: ReviewChoiceOption[];
}

export interface ReviewMeaningToFormSpec extends ReviewAssessmentBase {
  kind: 'meaning_to_form_recall';
  cueL1: string;
  cueFeatureLabelsL1: string[];
  primaryForm: string;
  acceptedForms: string[];
}

/**
 * Package-owned transfer scenario shape. Keeping this type in the review
 * boundary prevents the runtime review model from importing an old prototype
 * content registry.
 */
export interface ReviewTransferActionOption {
  id: string;
  labelL1: string;
  detailL1: string;
  isCorrect: boolean;
  feedbackTitleL1: string;
  feedbackBodyL1: string;
}

export interface ReviewTransferScenarioSpec {
  id: string;
  exampleKey: string;
  sceneLabelL1: string;
  setupL2: string;
  setupL1: string;
  visualKind: string;
  visualAltL1: string;
  questionL1: string;
  options: ReviewTransferActionOption[];
  successTitleL1: string;
  successBodyL1: string;
  sourceObjectL1: string;
  targetObjectL1: string;
  invariantLabelsL1: string[];
}

export interface ReviewNovelTransferSpec extends ReviewAssessmentBase {
  kind: 'novel_context_transfer';
  scenario: ReviewTransferScenarioSpec & {
    revealExample: ReviewExampleExcerpt;
  };
}

export interface ReviewBoundaryContrastSpec extends ReviewAssessmentBase {
  kind: 'boundary_contrast';
  previewLabelL1: string;
  currentSenseL1: string;
  contrastSenseL1: string;
  relationLabelL1: string;
  example: ReviewExampleExcerpt;
  questionL1: string;
  options: ReviewChoiceOption[];
}

export type ReviewAssessmentSpec =
  | ReviewContextRecognitionSpec
  | ReviewMeaningToFormSpec
  | ReviewNovelTransferSpec
  | ReviewBoundaryContrastSpec;

export function resolveReviewMemoryOutcome(
  kind: ReviewAssessmentKind,
  correct: boolean,
): ReviewMemoryOutcome | null {
  if (!canProduceReviewMemoryOutcome(kind)) return null;
  const basis: ReviewMemoryOutcomeBasis = !correct
    ? 'retrieval_failed'
    : kind === 'novel_context_transfer'
      ? 'transfer_confirmed'
      : 'independent_retrieval';
  return {
    basis,
    grade: correct ? 'good' : 'again',
    evidenceLevel: 'behavioral',
    evidenceIds: [],
  };
}

/** Learner-rated protocols retain the middle "hard" grade instead of booleanizing it. */
export function resolveLearnerRatedMemoryOutcome<Grade extends MemoryOutcomeGrade>(
  grade: Grade,
): LearnerRatedMemoryOutcome<Grade> {
  return {
    basis: 'learner_rated',
    grade,
    evidenceLevel: 'self_report',
    evidenceIds: [],
  };
}
