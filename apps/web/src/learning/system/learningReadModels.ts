import type {
  SensaFormalPinnedLanguageContext,
  SensaProtocolStepDefinition,
  SensaProtocolStepMaterialBinding,
  SensaMaterializedResource,
} from '@sensa/contracts/sensa';

import type { LightweightInitialLearningMaterialization } from '../../contentSupply/provisioning/lightweightInitialContent';
import type { AssessmentResource } from '../content/assessmentResources';
import type { RuntimeLearningContent } from '../content/learningCatalog';
import type {
  ReviewAssessmentResult,
  ReviewAssessmentSpec,
} from '../review/types';
import type {
  LearningStepKind,
  RepairResourceReference,
} from '../engine/types';

export type LearningPolicy = 'lightweight' | 'high_assurance' | 'interleaved_four_stage';
export const LEARNING_LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND = 'lightweight_experience_recall' as const;
export const LEARNING_LIGHTWEIGHT_EXPRESSION_REVEAL_STEP_KIND = 'lightweight_expression_reveal' as const;
export type LearningLightweightRating = 'again' | 'hard' | 'good';
export type LearningReadiness = 'ready' | 'preparing' | 'blocked';
export type LearningPurpose = 'initial_learning' | 'retention_review' | 'relearning';

export interface LearningPolicyOption {
  readonly id: LearningPolicy;
  readonly localSelectable: boolean;
}

export type LearningSourceKind = 'book' | 'direct' | 'personal_semantic_world';

/** Stable presentation of one Learning Target. No Run, Policy registry or
 * Curriculum aggregate is exposed to the caller. */
export interface LearningTargetPresentation {
  readonly targetId: string;
  readonly expression: string;
  readonly expressionTypeLabel: string;
  readonly partOfSpeech: string;
  readonly meaning: string;
  readonly targetLanguageTag: string;
  readonly supportLanguageTag: string;
  readonly example: string;
  readonly sourceKind: LearningSourceKind;
  readonly sourceLabel: string;
  readonly runtimeSenseId: string | null;
  readonly personalExperienceGrounding: Readonly<{
    scene: string;
    focus: string;
    featureLabels: readonly string[];
  }> | null;
  readonly policy: LearningPolicy;
  readonly lightweightReadiness: Readonly<{
    status: LearningReadiness;
    label: string;
    detail: string;
  }>;
}

export type LearningTargetState =
  | 'blocked'
  | 'preparing'
  | 'ready'
  | 'committed'
  | 'completed'
  | 'review_due'
  | 'relearning'
  | 'declared_mastery';

/** Everything a Learning screen may display or use to submit an intent for a
 * Target. Exact identities are included only where another Module needs a
 * typed handoff, never so the page can resolve policy or readiness itself. */
export interface LearningTargetProjection {
  readonly targetId: string;
  readonly presentation: LearningTargetPresentation;
  readonly state: LearningTargetState;
  readonly preparation: LearningReadiness;
  readonly policy: LearningPolicy;
  readonly committedPolicy: LearningPolicy | null;
  readonly allowedPolicies: readonly LearningPolicy[];
  readonly started: boolean;
  readonly completed: boolean;
  readonly reviewDue: boolean;
  readonly relearning: boolean;
  readonly declaredMastery: boolean;
  readonly nextReviewAt: string | null;
  readonly curriculumMembershipId: string;
  readonly languageContext: SensaFormalPinnedLanguageContext;
  readonly packageKey: string | null;
  readonly publicationArchiveSha256: string | null;
  readonly assurancePackageKey: string | null;
  readonly material: LightweightInitialLearningMaterialization;
  readonly studyContent: RuntimeLearningContent | null;
  readonly identity: Readonly<{
    senseId: string;
    senseVersionId: string;
    bindingId: string;
    bindingVersionId: string;
  }>;
  readonly personalMeaningId: string | null;
}

export type LearningRecordKind = LearningPurpose;

export interface LearningRecordProjection {
  readonly recordId: string;
  readonly targetId: string;
  readonly meaning?: string;
  readonly expression: string;
  readonly languageTag: string;
  readonly occurredAt: string;
  readonly kind: LearningRecordKind;
  readonly label: string;
  readonly detail: string;
}

export interface LearningQueueProjection {
  readonly activeTargetIds: readonly string[];
  readonly dueTargetIds: readonly string[];
  readonly initialReadyTargetIds: readonly string[];
  readonly nextTargetId: string | null;
  readonly nextChangeAt: number | null;
}

export interface LearningHomeProjection {
  readonly activeRunId: string | null;
  readonly dailyLimit: number | null;
  readonly readyInitialCount: number;
  readonly reviewDueCount: number;
  readonly mixedReadyCount: number;
  readonly nextTargetId: string | null;
  readonly nextReviewTargetId: string | null;
  readonly nextChangeAt: number | null;
  readonly nextTargetPolicy: LearningPolicy | null;
  readonly policyOptions: readonly LearningPolicyOption[];
}

export interface LearningPersonalEnrollmentIndex {
  readonly targets: readonly Readonly<{
    targetId: string;
    curriculumMembershipIds: readonly string[];
  }>[];
}

export interface LearningSemanticMemoryProjection {
  readonly targets: readonly Readonly<{
    targetId: string;
    senseId: string;
    declaredMastery: boolean;
    memory: Readonly<{
      dueAt: Date;
      fsrsCardState: string;
      fsrsLastReviewedAt: Date;
      fsrsStability: number;
      reps: number;
    }> | null;
  }>[];
}

export type LearningRuntimeCapability =
  | 'toast'
  | 'dictionary'
  | 'notes'
  | 'personal_scenes'
  | 'personal_content_menu'
  | 'declared_mastery';

export type LearningAction =
  | Readonly<{ kind: 'reveal' }>
  | Readonly<{ kind: 'rate'; rating: 'again' | 'hard' | 'good' }>
  | Readonly<{ kind: 'assurance'; response: unknown }>
  | Readonly<{ kind: 'protocol'; response: unknown }>;

export interface LearningLightweightStepProjection {
  readonly protocolStepInstanceId: string;
  readonly protocolRunId: string;
  readonly retentionTargetId: string;
  readonly ordinal: number;
  readonly definition: SensaProtocolStepDefinition;
  readonly materialBindings: readonly SensaProtocolStepMaterialBinding[];
  readonly materialization: LightweightInitialLearningMaterialization;
}

interface LearningRuntimeProjectionBase {
  readonly runId: string;
  readonly revision: number;
  readonly purpose: LearningPurpose;
  readonly completed: boolean;
  readonly policy: LearningPolicy;
  readonly capabilities: readonly LearningRuntimeCapability[];
  readonly targetIds: readonly string[];
  readonly currentTargetId: string;
}

export interface LearningLightweightRuntimeProjection extends LearningRuntimeProjectionBase {
  readonly kind: 'lightweight';
  readonly target: LearningTargetProjection;
  readonly phase: 'experience' | 'reveal';
  readonly step: LearningLightweightStepProjection | null;
  /** Current Step bindings plus the experience actually acted on before Reveal. */
  readonly questionResources: readonly SensaMaterializedResource[];
  readonly questionUsesPersonalContext: boolean;
}

export interface LearningStructuredRuntimeProjection extends LearningRuntimeProjectionBase {
  readonly kind: 'structured';
  readonly target: LearningTargetProjection;
  readonly content: RuntimeLearningContent | null;
  readonly stepKind: LearningStepKind | null;
  readonly action: Readonly<{
    ordinal: number;
    totalTarget: number;
    intent?: string;
    repairResourceRef?: RepairResourceReference | null;
  }> | null;
  readonly resource: AssessmentResource | null;
  readonly state: Readonly<{
    mode: 'independent' | 'first_letter' | 'choice';
    revealed: boolean;
    feedback: Readonly<{ correct: boolean; answer: string }> | null;
  }>;
  readonly reviewSpec: ReviewAssessmentSpec | null;
  readonly reviewResult: ReviewAssessmentResult | null;
}

export type FourStageInitialPresentation =
  | 'meaning_choice'
  | 'context_recall'
  | 'sound_choice'
  | 'final_recall';

export interface FourStageInitialSessionProjection {
  readonly sessionOrdinal: number;
  readonly targetId: string;
  readonly checkpointId: string;
  readonly presentation: FourStageInitialPresentation;
  readonly phase: 'assessment' | 'feedback';
  readonly result: boolean | null;
}

export type FourStageReviewAnswer = 'known' | 'vague' | 'forgotten';

export interface FourStageReviewSessionProjection {
  readonly ordinal: number;
  readonly targetId: string;
  readonly mode: 'review' | 'relearning';
  readonly phase: 'assessment' | 'feedback';
  readonly answer: FourStageReviewAnswer | null;
  readonly memoryOutcome: Readonly<{ grade: string }> | null;
}

export interface FourStageTargetPresentation {
  readonly expression: string;
  readonly meaning: string;
  readonly example: string;
  readonly partOfSpeech: string;
}

export interface LearningFourStageInitialRuntimeProjection extends LearningRuntimeProjectionBase {
  readonly kind: 'four_stage_initial';
  readonly session: FourStageInitialSessionProjection | null;
  readonly target: FourStageTargetPresentation | null;
  readonly content: RuntimeLearningContent | null;
  readonly targetCount: number;
  readonly completedTargetCount: number;
  readonly currentTargetCheckpointCredits: number;
}

export interface LearningFourStageReviewRuntimeProjection extends LearningRuntimeProjectionBase {
  readonly kind: 'four_stage_review';
  readonly session: FourStageReviewSessionProjection | null;
  readonly target: FourStageTargetPresentation | null;
  readonly targetCount: number;
}

export type LearningRuntimeProjection =
  | LearningLightweightRuntimeProjection
  | LearningStructuredRuntimeProjection
  | LearningFourStageInitialRuntimeProjection
  | LearningFourStageReviewRuntimeProjection;

export type LearningCurriculumEnrollmentProjection=Readonly<{
 enrollmentId:string;
 languageRouteId:string;
 source:Readonly<{
  kind:'published_book';
  publisherNamespace:string;
  bookId:string;
  bookVersionId:string;
  bookVersionNumber:number;
  publicationArchiveSha256:string;
 }>|Readonly<{
  kind:'portable_package';
  packageId:string;
  packageVersion:number;
  packageKey:string;
 }>|Readonly<{
  kind:'stable_sense';senseId:string;senseVersionId:string;bindingId:string;bindingVersionId:string;expression:string;meaning:string;
 }>;
}>;

export interface LearningWorkspaceProjection {
  readonly enrollments:readonly LearningCurriculumEnrollmentProjection[];
  readonly targets: readonly LearningTargetProjection[];
  readonly queue: LearningQueueProjection;
  readonly runtime: LearningRuntimeProjection | null;
  readonly activeRunId: string | null;
  readonly dailyLimit: number | null;
  readonly records: readonly LearningRecordProjection[];
  readonly policyOptions: readonly LearningPolicyOption[];
}

/** Active execution plus compact continuation planning, without collection
 * material, completed Run history or study records. */
export interface LearningRuntimeWorkspaceProjection {
  readonly runtime: LearningRuntimeProjection | null;
  readonly dailyLimit: number | null;
  /** Continuation is planned only at a Run boundary, never during a Step. */
  readonly nextTargetId: string | null;
  readonly nextChangeAt: number | null;
  readonly policyOptions: readonly LearningPolicyOption[];
}
