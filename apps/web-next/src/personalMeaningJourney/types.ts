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
  SensaSenseConstructionSnapshot,
  SensaSenseProposalSnapshot,
} from '@sensa/contracts/sensa';

type SensaSenseProposalStatus = SensaSenseProposalSnapshot['status'];
type SensaSenseConstructionStatus = SensaSenseConstructionSnapshot['status'];
type SensaPersonalMeaningAlignmentStatus =
  SensaPersonalMeaningAlignmentSnapshot['status'];

/** A derived UI phase. It is never persisted as an authoritative fact. */
export type PersonalMeaningJourneyPhase =
  | 'unclarified'
  | 'focus_suggested'
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

export type JourneyFamiliarAnchorView = Extract<
  JourneyAnchorView,
  { kind: 'familiar_expression' }
>;

export type JourneyExperienceAnchorView = Extract<
  JourneyAnchorView,
  { kind: 'experience' }
>;

export interface JourneyTurnView {
  turnId: string;
  actor: 'learner' | 'semantic_llm' | 'system';
  body: string;
  occurredAt: string;
}

export interface JourneyConstructionView {
  senseConstructionId: string;
  status: SensaSenseConstructionStatus;
  turns: JourneyTurnView[];
  awaitingLearnerAnswer: boolean;
  boundaryOptions: string[];
  readyForProposal: boolean;
}

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
  construction: JourneyConstructionView | null;
  proposal: JourneyProposalView | null;
  alignment: JourneyAlignmentView | null;
}

export interface JourneyFocusSuggestionView {
  suggestionId: string;
  statement: string;
  distinguishingNotes: string[];
  aspectLabel: string;
  provenance: { provider: string; model: string; promptVersion: string };
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
  focuses: JourneyFocusView[];
  focusSuggestions: JourneyFocusSuggestionView[];
  focusSuggestionsAreMultipleAspects: boolean;
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

export interface CreatePersonalMeaningInput {
  operationId: string;
  familiarExpression?: {
    surfaceForm: string;
    expressionType: SensaExpressionType;
    languageTag?: 'zh-CN';
  };
  experience?: string;
}

export interface CreatePersonalMeaningResult {
  personalMeaningId: string;
  personalMeaningRevisionId: string;
  familiarExpressionAnchorId: string | null;
  experienceAnchorId: string | null;
  replayed: boolean;
}

export interface AddAnchorInput {
  operationId: string;
  personalMeaningId: string;
  kind: 'familiar_expression' | 'experience';
  surfaceForm: string;
  expressionType?: SensaExpressionType;
}

export interface EditAnchorInput {
  operationId: string;
  personalMeaningId: string;
  anchorId: string;
  kind: 'familiar_expression' | 'experience';
  surfaceForm: string;
  expressionType?: SensaExpressionType;
}

export interface RemoveAnchorInput {
  operationId: string;
  personalMeaningId: string;
  anchorId: string;
  kind: 'familiar_expression' | 'experience';
}

export interface GenerateFocusSuggestionsInput {
  operationId: string;
  personalMeaningId: string;
}

export interface CreateMeaningFocusInput {
  operationId: string;
  personalMeaningId: string;
  suggestionId?: string;
  statement?: string;
  distinguishingNotes?: string[];
  aspectLabel?: string;
}

export interface CreateMeaningFocusResult {
  meaningFocusId: string;
  meaningFocusRevisionId: string;
  replayed: boolean;
}

export interface AcceptMeaningFocusRevisionInput {
  operationId: string;
  personalMeaningId: string;
  meaningFocusId: string;
  meaningFocusRevisionId: string;
}

export interface EditMeaningFocusInput {
  operationId: string;
  personalMeaningId: string;
  meaningFocusId: string;
  statement: string;
  distinguishingNotes: string[];
}

export interface SplitMeaningFocusInput {
  operationId: string;
  personalMeaningId: string;
  meaningFocusId: string;
  statement: string;
  distinguishingNotes: string[];
  aspectLabel?: string;
}

export interface AnswerConstructionInput {
  operationId: string;
  personalMeaningId: string;
  meaningFocusId: string;
  answer: string;
}

export interface ConfirmSenseInput {
  operationId: string;
  personalMeaningId: string;
  meaningFocusId: string;
  senseProposalVersionId: string;
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

export interface FocusRefInput {
  operationId: string;
  personalMeaningId: string;
  meaningFocusId: string;
}
