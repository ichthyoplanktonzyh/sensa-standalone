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
  SensaPersonalMeaningAlignmentSnapshot,
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
  revision: number;
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
  displayLabel: string | null;
  learnerIntentNote: string | null;
  phase: PersonalMeaningJourneyPhase;
  senseFormation: JourneySenseFormationView;
  expressionBinding: JourneyExpressionBindingView;
  familiarAnchors: JourneyFamiliarAnchorView[];
  experienceAnchors: JourneyExperienceAnchorView[];
  /** Every material block in learner order, including image blocks. */
  materialBlocks: JourneyMaterialBlockView[];
  /** The learner's declared conversation stance; never a domain phase. */
  startingPoint: ClarificationStartingPoint | null;
  focuses: JourneyFocusView[];
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
   * The learner's familiar (native-language) wording. No expression type is
   * asked for: classifying "欲言又止" as phrase vs construction is domain work
   * the model does better, and it is confirmed later, not here.
   */
  familiarExpression?: {
    surfaceForm: string;
    languageTag?: 'zh-CN';
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

export interface CreatePersonalMeaningResult {
  personalMeaningId: string;
  personalMeaningRevisionId: string;
  familiarExpressionAnchorId: string | null;
  replayed: boolean;
}

/**
 * One learner confirmation at the end of a clarification thread.
 *
 * The learner clicks once, but this still records three independent domain
 * facts in order — Focus acceptance, Sense confirmation + Alignment, and
 * optionally the Expression Binding. `expression: null` is the legal, supported
 * "已确认 2 / 3" outcome, not a failure. The gateway applies the whole thing or
 * none of it: a rejected step leaves the store exactly as it was.
 */
export interface ConfirmClarificationInput {
  operationId: string;
  personalMeaningId: string;
  focus: {
    statement: string;
    distinguishingNotes: string[];
    aspectLabel: string;
  };
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
  meaningFocusId: string;
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
