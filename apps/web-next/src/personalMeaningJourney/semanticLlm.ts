/**
 * The Semantic LLM seam.
 *
 * `SemanticLlmPort` is the single boundary between the journey gateway and
 * whatever produces Meaning Focus suggestions, Sense Construction interview
 * turns and Sense Proposals. The deterministic `mockSemanticLlm` implements it
 * for the deterministic, test-backed legacy construction commands. The live,
 * open-ended clarification workspace uses the separate `SemanticAgentPort`.
 *
 * Domain invariant (personal-semantic-world-model.md §4, production-architecture
 * Module 8): the Semantic LLM only *proposes and clarifies*. It never accepts a
 * Focus, confirms a Sense, creates an Alignment or binds an Expression — those
 * are deterministic learner facts owned by the gateway regardless of adapter.
 */

import type { SensaExpressionType } from '@sensa/contracts/sensa';

/** Provenance the adapter reports so the gateway can stamp contract facts. */
export interface SemanticLlmProvenance {
  provider: string;
  model: string;
  promptVersion: string;
}

/** Shared context every call receives about the learner's private material. */
export interface SemanticLlmContext {
  familiarExpressions: Array<{
    surfaceForm: string;
    expressionType: SensaExpressionType;
  }>;
  experienceAnchors: Array<{ bodyText: string }>;
  learnerIntentNote: string | null;
}

export interface MeaningFocusSuggestion {
  statement: string;
  distinguishingNotes: string[];
  /** A short label for the aspect, e.g. “接收方向”. */
  aspectLabel: string;
}

export interface SuggestFocusesResult {
  focuses: MeaningFocusSuggestion[];
  /**
   * True when the suggested focuses are distinct aspects of the *same*
   * experience that the learner could split into sibling Meaning Focuses
   * (e.g. borrow vs lend). The UI offers an explicit “split” affordance.
   */
  multipleAspects: boolean;
  provenance: SemanticLlmProvenance;
}

export interface ConstructionTurnContext extends SemanticLlmContext {
  focusStatement: string;
  focusDistinguishingNotes: string[];
  /** Prior dialogue turns in order (learner + semantic_llm). */
  priorTurns: Array<{ actor: 'learner' | 'semantic_llm' | 'system'; body: string }>;
}

export interface ConstructionTurnDraft {
  /** The model's current synthesis or, only when needed, one discriminating question. */
  body: string;
  /** Optional closed answer choices that make the boundary question concrete. */
  boundaryOptions: string[];
  /** True when the interview has enough signal to generate a proposal. */
  readyForProposal: boolean;
  provenance: SemanticLlmProvenance;
}

export interface ProposalDraftScene {
  summary: string;
  participantRoles: string[];
  states: string[];
  directionOrCausality: string | null;
}

export interface ProposalDraftNeighborContrast {
  label: string;
  distinction: string;
}

export interface ProposalDraftExpressionCandidate {
  expressionType: SensaExpressionType;
  languageTag: string;
  surfaceForm: string;
  rationale: string;
}

export interface SenseProposalDraft {
  /**
   * A stable semantic key for reuse detection. If a Sense with this key already
   * exists in the registry, confirming resolves to `reuse_existing`; otherwise
   * it creates a new Sense. This is a governance optimisation, never a blocker.
   */
  proposedSenseKey: string;
  coreMeaningFocus: string;
  prototypeScenes: ProposalDraftScene[];
  includedCases: string[];
  excludedCases: string[];
  neighborContrasts: ProposalDraftNeighborContrast[];
  openQuestions: string[];
  unresolvedQuestions: string[];
  expressionCandidates: ProposalDraftExpressionCandidate[];
  semanticPolicyVersion: string;
  provenance: SemanticLlmProvenance;
}

export interface GenerateProposalContext extends ConstructionTurnContext {}

/**
 * The one interface both adapters implement. All methods are async so the real
 * adapter can await the network and the mock can simulate a brief pending state;
 * the mock never changes its business result between calls for the same input.
 */
export interface SemanticLlmPort {
  readonly label: string;
  suggestMeaningFocuses(context: SemanticLlmContext): Promise<SuggestFocusesResult>;
  nextConstructionTurn(context: ConstructionTurnContext): Promise<ConstructionTurnDraft>;
  generateSenseProposal(context: GenerateProposalContext): Promise<SenseProposalDraft>;
}
