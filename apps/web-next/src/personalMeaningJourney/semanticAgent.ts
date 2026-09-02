/**
 * The AI clarification agent seam.
 *
 * One conversation produces one working set of three candidates — Focus, Sense
 * and target Expression. The agent only ever *proposes*: it fills and refines
 * the working set, and reports when it believes the three are clear enough to
 * be worth confirming. It can never confirm anything. Confirmation is a single
 * explicit learner intent handled by the journey gateway, which still records
 * three independent domain facts.
 *
 * Two things are deliberately kept apart here:
 *  - `focusLocked` steers the model (it is a conversation-level hint, and
 *    writes no domain fact);
 *  - `ConfirmClarificationInput` writes domain facts (and is never inferred
 *    from the conversation).
 */

import type {
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
 * The three candidates currently on the result panel. Co-owned: the model
 * proposes them, the learner may edit any of them by hand, and edited tracks
 * are reported back so the model carries them forward instead of overwriting.
 */
export interface SemanticAgentWorkingSet {
  focus: AgentFocusCandidate | null;
  sense: AgentSenseCandidate | null;
  expression: AgentExpressionCandidate | null;
}

export type WorkingSetTrack = 'focus' | 'sense' | 'expression';

export const emptyWorkingSet = (): SemanticAgentWorkingSet => ({
  focus: null,
  sense: null,
  expression: null,
});

export interface SemanticAgentTurnResult {
  assistantMessage: string;
  workingSet: SemanticAgentWorkingSet;
  /**
   * The model's signal that the three candidates look clear enough to confirm.
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
}

export interface SemanticAgentPort {
  turn(input: SemanticAgentTurnInput): Promise<SemanticAgentTurnResult>;
}

/** What one finished clarification thread left behind, for the done state. */
export interface ClarificationOutcome {
  meaningFocusId: string;
  senseConfirmed: boolean;
  expressionConfirmed: boolean;
  confirmedAt: string;
}

/** One clarification thread. A Personal Meaning has at most one active thread. */
export interface SemanticAgentSession {
  personalMeaningId: string;
  threadId: string;
  messages: SemanticAgentMessage[];
  workingSet: SemanticAgentWorkingSet;
  learnerEditedTracks: WorkingSetTrack[];
  focusLocked: boolean;
  readyToConfirm: boolean;
  provenance: SemanticLlmProvenance | null;
  outcome: ClarificationOutcome | null;
}
