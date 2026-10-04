/**
 * UI projections and command inputs for the Personal Meaning journey.
 *
 * These types deliberately do not mirror the local fact store one-for-one.
 * The gateway is the seam between learner intents and contract-shaped facts;
 * this file only describes what screens need to render and submit.
 */

import type {
  SensaExpressionBindingRelation,
  SensaExpressionType,
  SensaIntakeContext,
  SensaPersonalMeaningAlignmentSnapshot,
  SensaPinnedLanguageContext,
  PublishedLearningSemanticFacts,
  SensaSemanticCoverage,
  SensaSenseProposalSnapshot,
} from '@sensa/contracts/sensa';
import type {
  AgentExpressionCandidate,
  AgentSenseCandidate,
  ClarificationStartingPoint,
  MaterialBlockKind,
  SemanticAgentMessage,
} from './semanticAgent';
import type { SemanticLlmProvenance } from './semanticLlm';

type SensaSenseProposalStatus = SensaSenseProposalSnapshot['status'];
type SensaPersonalMeaningAlignmentStatus =
  SensaPersonalMeaningAlignmentSnapshot['status'];

/** A derived UI phase. It is never persisted as an authoritative fact. */
export type PersonalMeaningJourneyPhase =
  | 'unclarified'
  | 'focus_pending_acceptance'
  | 'focus_accepted'
  | 'constructing'
  | 'proposal_ready'
  | 'sense_confirmed_expression_pending'
  | 'aligned';

export type JourneyAnchorView =
  | {
      anchorId: string;
      kind: 'familiar_expression';
      surfaceForm: string;
      expressionType: SensaExpressionType;
      revision: number;
    }
  | {
      anchorId: string;
      kind: 'experience';
      surfaceForm: string;
      expressionType: null;
      revision: number;
    };

/**
 * One block of the learner's material, in the order they laid it out. Text and
 * image blocks are separate Semantic Anchors, so a block can be revised or
 * removed without disturbing the others.
 */
export interface JourneyMaterialBlockView {
  anchorId: string;
  kind: MaterialBlockKind;
  bodyText: string | null;
  personalMediaObjectId: string | null;
  /** Inline learner media carried by an accepted Learning Scene revision. */
  inlineDataUrl?: string | null;
  inlineMimeType?: string | null;
  revision: number;
  /** Original captured source remains distinct from the accepted Context wording. */
  capturedSource?:{text:string|null;source:SensaIntakeContext['source']};
}

export type JourneyFamiliarAnchorView = Extract<
  JourneyAnchorView,
  { kind: 'familiar_expression' }
>;

export type JourneyExperienceAnchorView = Extract<
  JourneyAnchorView,
  { kind: 'experience' }
>;

export interface JourneyPrototypeSceneView {
  summary: string;
  participantRoles: string[];
  states: string[];
  directionOrCausality: string | null;
}

export interface JourneyNeighborContrastView {
  label: string;
  distinction: string;
}

export interface JourneySemanticSpecView {
  coreMeaningFocus: string;
  prototypeScenes: JourneyPrototypeSceneView[];
  includedCases: string[];
  excludedCases: string[];
  neighborContrasts: JourneyNeighborContrastView[];
  openQuestions: string[];
}

export interface JourneyExpressionCandidateView {
  candidateId: string;
  expressionType: SensaExpressionType;
  languageTag: string;
  surfaceForm: string;
  rationale: string;
  /**
   * Provenance-aware marker for the current Binding projection. `used` means
   * the candidate was the source of a confirmed binding whose learner-edited
   * form no longer exactly matches the proposal candidate.
   */
  bindingStatus?: 'confirmed' | 'used';
  confirmed: boolean;
}

export interface JourneyProposalView extends JourneySemanticSpecView {
  senseProposalId: string;
  senseProposalVersionId: string;
  version: number;
  status: SensaSenseProposalStatus;
  unresolvedQuestions: string[];
  expressionCandidates: JourneyExpressionCandidateView[];
  semanticPolicyVersion: string;
  generator: { provider: string; model: string; promptVersion: string };
}

export interface JourneyConfirmedBindingView {
  expressionBindingConfirmationId: string;
  senseVersionId: string;
  expressionVersionId: string;
  bindingVersionId: string;
  expressionType: SensaExpressionType;
  surfaceForm: string;
  languageTag: string;
  relation: SensaExpressionBindingRelation;
  semanticCoverage: SensaSemanticCoverage;
}

export interface JourneyAlignmentView {
  personalMeaningAlignmentId: string;
  basisKind: 'sense_construction' | 'contextual_resolution';
  status: SensaPersonalMeaningAlignmentStatus;
  senseId: string;
  senseVersionId: string;
  senseShortId: string;
  senseVersionShortId: string;
  senseVersionNumber: number | null;
  origin: string;
  reviewStatus: string;
  resolution: 'create_new' | 'reuse_existing';
  coreMeaningFocus: string;
  semanticSpec: JourneySemanticSpecView | null;
  semanticSpecVersion: number | null;
  semanticPolicyVersion: string | null;
  generator: { provider: string; model: string; promptVersion: string } | null;
  expressionCandidates: JourneyExpressionCandidateView[];
  unresolvedQuestions: string[];
  confirmedBindings: JourneyConfirmedBindingView[];
}

export interface JourneyFocusView {
  meaningFocusId: string;
  shortId: string;
  phase: PersonalMeaningJourneyPhase;
  statement: string;
  distinguishingNotes: string[];
  aspectLabel: string | null;
  currentRevision: number;
  currentRevisionId: string;
  /** True only when acceptedRevision === currentRevision. */
  accepted: boolean;
  acceptedRevision: number | null;
  splitFromMeaningFocusId: string | null;
  proposal: JourneyProposalView | null;
  alignment: JourneyAlignmentView | null;
}

export interface JourneyDetailView {
  personalMeaningId: string;
  shortId: string;
  /** Current optimistic-concurrency revision of this Personal Meaning. */
  revision: number;
  displayLabel: string | null;
  learnerIntentNote: string | null;
  phase: PersonalMeaningJourneyPhase;
  senseFormation: JourneySenseFormationView;
  expressionBinding: JourneyExpressionBindingView;
  familiarAnchors: JourneyFamiliarAnchorView[];
  experienceAnchors: JourneyExperienceAnchorView[];
  /** Every material block in learner order, including image blocks. */
  materialBlocks: JourneyMaterialBlockView[];
  /** Original capture history, including sources whose current Anchor retired. */
  capturedSources?:Array<{anchorId:string;text:string|null;source:SensaIntakeContext['source']}>;
  /** The learner's declared conversation stance; never a domain phase. */
  startingPoint: ClarificationStartingPoint | null;
  focuses: JourneyFocusView[];
  /** Active Sense resolutions that never needed a Meaning Focus. */
  directAlignments: JourneyAlignmentView[];
  createdAt: string;
  updatedAt: string;
}

/** Compact list projection used by the Personal Meaning world/map. */
export interface JourneyListItemView {
  personalMeaningId: string;
  shortId: string;
  /** Detail journey phase retained for legacy readers; world UI uses the two axes below. */
  phase: PersonalMeaningJourneyPhase;
  primaryLabel: string;
  familiarAnchors: JourneyFamiliarAnchorView[];
  experienceAnchors: JourneyExperienceAnchorView[];
  focusCount: number;
  confirmedSenseCount: number;
  confirmedExpressionCount: number;
  senseFormation: JourneySenseFormationView;
  expressionBinding: JourneyExpressionBindingView;
  updatedAt: string;
}

/**
 * The Personal Semantic World exposes two independent, UI-only axes. Neither
 * axis is a domain fact or a writable status; both are rebuilt from Focus,
 * Construction, Proposal, Alignment and Binding facts.
 */
export type SenseFormationPhase =
  | 'focus_missing'
  | 'focus_pending_acceptance'
  | 'clarifying'
  | 'proposal_pending'
  | 'sense_confirmed';

export type ExpressionBindingPhase =
  | 'not_ready'
  | 'pending'
  | 'partial'
  | 'bound';

export interface JourneySenseFormationView {
  phase: SenseFormationPhase;
  focusCount: number;
  acceptedFocusCount: number;
  pendingFocusCount: number;
  clarifyingFocusCount: number;
  proposalPendingCount: number;
  confirmedSenseCount: number;
  nextFocusId: string | null;
}

export interface JourneyExpressionBindingView {
  phase: ExpressionBindingPhase;
  confirmedSenseCount: number;
  boundSenseCount: number;
  confirmedBindingCount: number;
  pendingBindingCount: number;
  nextFocusId: string | null;
}

export interface JourneyWorldItemView extends JourneyListItemView {
  detail: JourneyDetailView;
}

// ---------------------------------------------------------------------------
// Command inputs / results
// ---------------------------------------------------------------------------

/** One block as submitted by the material editor. */
export interface MaterialBlockInput {
  kind: MaterialBlockKind;
  /** Required for `text` blocks; ignored for `image` blocks. */
  bodyText?: string;
  /** Required for `image` blocks; the bytes live in the local media store. */
  personalMediaObjectId?: string;
}

export interface CreatePersonalMeaningInput {
  operationId: string;
  /**
   * The learner's starting wording. No expression type is
   * asked for: classifying "欲言又止" as phrase vs construction is domain work
   * the model does better, and it is confirmed later, not here. No language is
   * asked for either: the gateway pins the operation's Input Language from its
   * language context rather than treating the wording as a learner trait.
   */
  familiarExpression?: {
    surfaceForm: string;
  };
  blocks?: MaterialBlockInput[];
  startingPoint?: ClarificationStartingPoint | null;
}

export interface AddMaterialBlockInput {
  operationId: string;
  personalMeaningId: string;
  block: MaterialBlockInput;
}

export interface AddMaterialBlockResult {
  anchorId: string;
  replayed: boolean;
}

/** Replace the current Context while retaining every prior anchor revision. */
export interface ReviseContextInput {
  operationId: string;
  personalMeaningId: string;
  expectedRevision: number;
  blocks: MaterialBlockInput[];
}

export interface ReviseContextResult {
  personalMeaningRevisionId: string;
  revision: number;
  replayed: boolean;
}

export interface CreatePersonalMeaningResult {
  personalMeaningId: string;
  personalMeaningRevisionId: string;
  familiarExpressionAnchorId: string | null;
  replayed: boolean;
}

/** Inbox-owned material used by clarification before any Personal Meaning exists. */
export interface ClarificationDraftView {
  intakeId: string;
  /** The Context already captured by the entry, or null when clarification must supply it. */
  context: SensaIntakeContext | null;
  materialBlocks: MaterialBlockInput[];
  familiarExpression: string | null;
  startingPoint: ClarificationStartingPoint | null;
}

export interface CreateClarificationDraftResult {
  intakeId: string;
  status: 'pending_context' | 'pending_expression' | 'pending_sense' | 'pending_acceptance';
  replayed: boolean;
}

export type CompleteClarificationDraftInput = Omit<
  ConfirmClarificationInput,
  'personalMeaningId'
> & {
  intakeId: string;
  /** The complete Context explicitly carried into the final confirmation. */
  context: SensaIntakeContext;
  contextWordingSource?: 'learner_authored' | 'llm_suggested';
};

export interface CompleteClarificationDraftResult extends ConfirmClarificationResult {
  personalMeaningId: string;
}

/**
 * One learner confirmation at the end of a clarification thread.
 *
 * The learner clicks once, recording Sense confirmation + Alignment and,
 * when disambiguation was needed, Focus acceptance. Expression Binding may be
 * deferred only for an existing meaning; an Inbox draft must be complete before
 * it can enter the Personal Semantic World. The gateway applies the whole thing
 * or none of it: a rejected step leaves the store exactly as it was.
 */
export interface ConfirmClarificationInput {
  operationId: string;
  personalMeaningId: string;
  /** Exact learner material frame used to produce/review this proposal. */
  source:import('./clarificationSource').ClarificationSourceWitness;
  /** The context pinned by this clarification Session. */
  languageContext:SensaPinnedLanguageContext;
  focus?: {
    statement: string;
    distinguishingNotes: string[];
    aspectLabel: string;
  } | null;
  sense: Omit<AgentSenseCandidate, 'rationale'>;
  /**
   * The expression candidate on the panel. It is recorded as a Sense Proposal
   * candidate whenever present — that is provenance, not confirmation — so a
   * learner who stops at two facts can still bind it later.
   */
  expression: Omit<AgentExpressionCandidate, 'rationale'> | null;
  /** All expression candidates proposed during clarification, to populate proposal version snapshot. */
  expressionCandidates?: Array<Omit<AgentExpressionCandidate, 'rationale'>>;
  /** Whether this same intent also confirms the Expression Binding. */
  confirmExpression: boolean;
  transcript: SemanticAgentMessage[];
  provenance: SemanticLlmProvenance;
  semanticPolicyVersion: string;
}

export interface ConfirmClarificationResult {
  meaningFocusId: string | null;
  senseId: string;
  senseVersionId: string;
  personalMeaningAlignmentId: string;
  resolution: 'create_new' | 'reuse_existing';
  expressionConfirmed: boolean;
  replayed: boolean;
}

export interface ConfirmExpressionBindingInput {
  operationId: string;
  personalMeaningId: string;
  source:import('./clarificationSource').ClarificationSourceWitness;
  meaningFocusId: string;
  senseVersionId: string;
  candidateId: string;
  languageTag: string;
  surfaceForm: string;
  expressionType: SensaExpressionType;
  relation: SensaExpressionBindingRelation;
  semanticCoverage: SensaSemanticCoverage;
}

export interface ConfirmExpressionBindingResult {
  expressionBindingConfirmationId: string;
  personalExpressionAnchorRevisionId: string;
  expressionId: string;
  expressionVersionId: string;
  senseExpressionBindingId: string;
  bindingVersionId: string;
  replayed: boolean;
}

// ---------------------------------------------------------------------------
export interface PublishedLearningSceneAcceptanceInput {
  operationId: string;
  existingPersonalMeaningId: string | null;
  source: {
    packageKey: string;
    bookId: string;
    bookVersionId: string;
    contentReleaseId: string;
    publishedAt: string;
    title: string;
  };
  target: {
    learningTargetId: string;
    curriculumMembershipId: string;
    senseId: string;
    senseVersionId: string;
    bindingId: string;
    bindingVersionId: string;
    expression: string;
    targetLanguageTag: string;
  };
  semantic: PublishedLearningSemanticFacts;
  scene: {
    sceneId: string;
    revisionId: string;
    revision: number;
    body: string;
    media: Array<{
      mediaId: string;
      kind: 'image';
      dataUrl: string;
      mimeType: string;
      fileName: string;
      altText: string;
    }>;
    createdAt: number;
  };
}

export interface PublishedLearningSceneAcceptanceResult {
  personalMeaningId: string;
  personalSemanticAnchorId: string;
  personalSemanticAnchorRevisionId: string;
  replayed: boolean;
}
