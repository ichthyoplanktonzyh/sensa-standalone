/**
 * The AI clarification agent seam.
 *
 * One conversation clarifies Context, Sense and target Expression, plus an
 * optional Focus only when the Context needs disambiguation. Every learner
 * turn uses the same bounded teacher loop: the model answers naturally, judges
 * whether Context, Sense and Expression are clear, and may inspect the
 * learner's existing semantic world when reuse genuinely matters. Its hidden
 * structured assessment is final-output state, not a fake tool call. There is
 * no opening-turn exception, extraction mode, or learner-triggered extraction
 * phase.
 *
 * The agent only ever *proposes*: it can never confirm anything. Confirmation
 * is a separate explicit learner intent handled by the journey gateway.
 *
 * Two things are deliberately kept apart here:
 *  - `focusLocked` steers an optional disambiguation Focus (it is a
 *    conversation-level hint, and writes no domain fact);
 *  - `ConfirmClarificationInput` writes domain facts (and is never inferred
 *    from the conversation).
 */

import type {
  SensaPinnedLanguageContext,
  SensaExpressionBindingRelation,
  SensaExpressionType,
  SensaSemanticCoverage,
} from '@sensa/contracts/sensa';
import type {
  ProposalDraftNeighborContrast,
  ProposalDraftScene,
  SemanticLlmProvenance,
} from './semanticLlm';

/**
 * The learner's declared starting point. It is a *conversation stance*, not a
 * domain model: it only decides how the model opens the first turn. Learners
 * never classify their own material into Focus/Sense/Expression.
 */
export type ClarificationStartingPoint =
  | 'from_experience'
  | 'from_sense'
  | 'from_expression';

export const startingPointLabels: Record<ClarificationStartingPoint, string> = {
  from_experience: '我说不太清，帮我想想',
  from_sense: '我知道要的意思，缺表达',
  from_expression: '我有个说法，想确认对不对',
};

export type MaterialBlockKind = 'text' | 'image';

/** One learner-authored material block, resolved for a model call. */
export interface SemanticAgentMaterialBlock {
  blockId: string;
  kind: MaterialBlockKind;
  bodyText: string | null;
  /** `data:` URL for image blocks, resolved from the media store at call time. */
  mediaDataUrl: string | null;
  mediaMimeType: string | null;
}

export interface SemanticAgentMaterial {
  blocks: SemanticAgentMaterialBlock[];
  familiarExpression: string | null;
  startingPoint: ClarificationStartingPoint | null;
}

export interface SemanticAgentMessage {
  messageId: string;
  role: 'learner' | 'assistant';
  body: string;
  /** Locally persisted images that accompanied this learner message. */
  mediaReferenceIds?: string[];
  occurredAt: string;
}

/** A concise interpretation of the real-world situation being clarified. */
export interface AgentContextCandidate {
  summary: string;
  salientDetails: string[];
  unresolvedDetails: string[];
  rationale: string;
}

export interface AgentFocusCandidate {
  statement: string;
  distinguishingNotes: string[];
  aspectLabel: string;
  rationale: string;
}

export interface AgentSenseCandidate {
  /** Stable key used for reuse detection when the learner confirms. */
  proposedSenseKey: string;
  coreMeaningFocus: string;
  prototypeScenes: ProposalDraftScene[];
  includedCases: string[];
  excludedCases: string[];
  neighborContrasts: ProposalDraftNeighborContrast[];
  openQuestions: string[];
  unresolvedQuestions: string[];
  rationale: string;
}

export interface AgentExpressionCandidate {
  surfaceForm: string;
  expressionType: SensaExpressionType;
  languageTag: string;
  /** Proposed with a reason; never a default translation equality. */
  relation: SensaExpressionBindingRelation;
  semanticCoverage: SensaSemanticCoverage;
  rationale: string;
}

/**
 * The candidates currently on the result panel. Sense and Expression are the
 * complete tuple; Focus appears only when the Context needs an explicit aspect
 * boundary. The model proposes them, the learner may edit them, and edited
 * tracks are reported back so the model carries them forward.
 */
export interface SemanticAgentWorkingSet {
  context: AgentContextCandidate | null;
  focus: AgentFocusCandidate | null;
  sense: AgentSenseCandidate | null;
  expression: AgentExpressionCandidate | null;
  expressions?: AgentExpressionCandidate[];
}

export type WorkingSetTrack = 'context' | 'focus' | 'sense' | 'expression';

export const emptyWorkingSet = (): SemanticAgentWorkingSet => ({
  context: null,
  focus: null,
  sense: null,
  expression: null,
  expressions: [],
});

/** Read-only semantic-world material available to the lookup tool. */
export interface SemanticAgentKnownMeaning {
  personalMeaningId: string;
  senseVersionId: string;
  coreMeaningFocus: string;
  expressions: string[];
}

export interface SemanticAgentStep {
  stepId: string;
  tool: 'lookup_meanings' | 'unknown';
  status: 'completed' | 'failed';
  summary: string;
}

export interface SemanticAgentTurnResult {
  assistantMessage: string;
  workingSet: SemanticAgentWorkingSet;
  /**
   * The model's signal that the candidate tuple looks clear enough to confirm.
   * It only promotes the confirm affordance; it never confirms, and the learner
   * may confirm earlier or keep talking past it.
   */
  readyToConfirm: boolean;
  provenance: SemanticLlmProvenance;
  /** Auditable tool activity only; never hidden chain-of-thought. */
  steps: SemanticAgentStep[];
}

export interface SemanticAgentTurnInput {
  material: SemanticAgentMaterial;
  messages: SemanticAgentMessage[];
  workingSet: SemanticAgentWorkingSet;
  readyToConfirm: boolean;
  learnerEditedTracks: WorkingSetTrack[];
  focusLocked: boolean;
  knownMeanings: SemanticAgentKnownMeaning[];
  /** Cancels the whole bounded loop, including local reference lookups. */
  signal?: AbortSignal;
  /**
   * The languages this turn is about. The agent proposes an expression in the
   * Target Language and explains the sense in the Support Language, so the
   * caller pins the active Route context once per turn and hands it over.
   * The interface language is not part of this and never reaches the model.
   */
  languages: SensaPinnedLanguageContext;
}

export interface SemanticAgentPort {
  turn(input: SemanticAgentTurnInput): Promise<SemanticAgentTurnResult>;
}

/** What one finished clarification thread left behind, for the done state. */
export interface ClarificationOutcome {
  meaningFocusId: string | null;
  personalMeaningAlignmentId: string;
  senseConfirmed: boolean;
  expressionConfirmed: boolean;
  confirmedAt: string;
}

/** One clarification thread. A Personal Meaning has at most one active thread. */
export interface SemanticAgentSession {
  personalMeaningId: string;
  threadId: string;
  /** Fixed on the first turn and reused until this thread ends. */
  languageContext:SensaPinnedLanguageContext|null;
  messages: SemanticAgentMessage[];
  workingSet: SemanticAgentWorkingSet;
  learnerEditedTracks: WorkingSetTrack[];
  focusLocked: boolean;
  readyToConfirm: boolean;
  provenance: SemanticLlmProvenance | null;
  steps: SemanticAgentStep[];
  outcome: ClarificationOutcome | null;
}
