/**
 * The AI clarification agent seam.
 *
 * One conversation produces a Sense and target Expression, plus an optional
 * Focus only when the Context needs disambiguation. The conversation runs as a simplified loop: plain
 * `chat` turns while the model listens and asks (Phase 1), then a single
 * `consolidate` extraction the learner requests when the model says it is
 * ready (Phase 2), repeatable after corrections. The agent only ever
 * *proposes*: it can never confirm anything. Confirmation is a single explicit
 * learner intent handled by the journey gateway.
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
  occurredAt: string;
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
  focus: AgentFocusCandidate | null;
  sense: AgentSenseCandidate | null;
  expression: AgentExpressionCandidate | null;
  expressions?: AgentExpressionCandidate[];
}

export type WorkingSetTrack = 'focus' | 'sense' | 'expression';

export const emptyWorkingSet = (): SemanticAgentWorkingSet => ({
  focus: null,
  sense: null,
  expression: null,
  expressions: [],
});

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
}

export interface SemanticAgentTurnInput {
  material: SemanticAgentMaterial;
  messages: SemanticAgentMessage[];
  workingSet: SemanticAgentWorkingSet;
  learnerEditedTracks: WorkingSetTrack[];
  focusLocked: boolean;
  /**
   * The simplified agent loop. `chat` turns are plain conversation (Phase 1:
   * listen and ask, no panel change); `consolidate` is one structured
   * extraction that fills the panel (Phase 2). The learner decides when to
   * consolidate — the model only says it is ready, in prose.
   */
  mode: SemanticAgentTurnMode;
  /**
   * The languages this turn is about. The agent proposes an expression in the
   * Target Language and explains the sense in the Support Language, so the
   * caller pins the active Route context once per turn and hands it over.
   * The interface language is not part of this and never reaches the model.
   */
  languages: SensaPinnedLanguageContext;
}

export type SemanticAgentTurnMode = 'chat' | 'consolidate';

/**
 * Receives streaming text deltas of the assistant's reply as they arrive.
 * Purely presentational: the final `SemanticAgentTurnResult` is always the
 * authoritative turn, and a transport without streaming simply never calls it.
 */
export type SemanticAgentDeltaHandler = (delta: string) => void;

export interface SemanticAgentPort {
  turn(
    input: SemanticAgentTurnInput,
    onDelta?: SemanticAgentDeltaHandler,
  ): Promise<SemanticAgentTurnResult>;
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
  outcome: ClarificationOutcome | null;
}
