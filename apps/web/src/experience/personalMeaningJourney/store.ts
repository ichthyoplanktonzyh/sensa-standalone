/**
 * In-memory fact state for the Personal Meaning journey.
 *
 * Persistence is normalized by the repository module. This shape remains the
 * gateway's private working model so domain commands can preserve their atomic
 * invariants without making React or transport callers understand storage rows.
 */

import type {
  SensaConfirmExpressionBindingFact,
  SensaConfirmSenseProposalFact,
  SensaExpressionSnapshot,
  SensaExpressionVersionSnapshot,
  SensaMeaningFocusAcceptanceFact,
  SensaMeaningFocusRevisionSnapshot,
  SensaMeaningFocusSnapshot,
  SensaPersonalExpressionAnchorRevisionSnapshot,
  SensaPersonalExpressionAnchorSnapshot,
  SensaPersonalMeaningAlignmentEvent,
  SensaPersonalMeaningAlignmentSnapshot,
  SensaPersonalMeaningRevisionSnapshot,
  SensaPersonalMeaningSnapshot,
  SensaPersonalSemanticAnchorRevisionSnapshot,
  SensaPersonalSemanticAnchorSnapshot,
  SensaSenseConstructionSnapshot,
  SensaSenseConstructionTurn,
  SensaSenseExpressionBindingSnapshot,
  SensaSenseExpressionBindingVersionSnapshot,
  SensaSenseProposalSnapshot,
  SensaSenseProposalVersionSnapshot,
  SensaSenseSnapshot,
  SensaSenseVersionSnapshot,
  SensaIntakeItem,
  SensaSemanticAcceptanceFact,
} from '@sensa/contracts/sensa';
import type { ClarificationStartingPoint } from './semanticAgent';

export const JOURNEY_STORE_VERSION = 'sensa-personal-meaning-journey-store-v5';

/** Recoverable adapter state; none of these values are domain facts. */
export interface JourneyMockState {
  /** UI-only label for a Focus aspect; not a contract snapshot field. */
  focusAspectLabels: Record<string, string>;
  /**
   * The learner's declared conversation stance for this material. It only
   * decides how the agent opens its first turn, so it is adapter state, not a
   * domain fact, and never a phase. Absent on records created before it existed.
   */
  startingPoint?: ClarificationStartingPoint | null;
}

/** All authoritative facts for one Personal Meaning. */
export interface MeaningJourneyRecord {
  /** Explicit conflict decisions retain both immutable branches, separate from
   * the current Meaning. Ordinary records incur no branch archive. */
  conflictHistory?: import('./meaningConflictHistory').MeaningConflictHistory;
  personalMeaning: SensaPersonalMeaningSnapshot;
  personalMeaningRevisions: SensaPersonalMeaningRevisionSnapshot[];
  personalSemanticAnchors: SensaPersonalSemanticAnchorSnapshot[];
  personalSemanticAnchorRevisions: SensaPersonalSemanticAnchorRevisionSnapshot[];
  personalExpressionAnchors: SensaPersonalExpressionAnchorSnapshot[];
  personalExpressionAnchorRevisions: SensaPersonalExpressionAnchorRevisionSnapshot[];
  focuses: SensaMeaningFocusSnapshot[];
  focusRevisions: SensaMeaningFocusRevisionSnapshot[];
  focusAcceptances: SensaMeaningFocusAcceptanceFact[];
  constructions: SensaSenseConstructionSnapshot[];
  constructionTurns: SensaSenseConstructionTurn[];
  proposals: SensaSenseProposalSnapshot[];
  proposalVersions: SensaSenseProposalVersionSnapshot[];
  senseConfirmations: SensaConfirmSenseProposalFact[];
  semanticAcceptances: SensaSemanticAcceptanceFact[];
  alignments: SensaPersonalMeaningAlignmentSnapshot[];
  alignmentEvents: SensaPersonalMeaningAlignmentEvent[];
  bindingConfirmations: SensaConfirmExpressionBindingFact[];
  mockState: JourneyMockState;
}

/** Global reusable registry facts owned by the mock Semantic Registry adapter. */
export interface SenseRegistryState {
  senses: SensaSenseSnapshot[];
  senseVersions: SensaSenseVersionSnapshot[];
  expressions: SensaExpressionSnapshot[];
  expressionVersions: SensaExpressionVersionSnapshot[];
  bindings: SensaSenseExpressionBindingSnapshot[];
  bindingVersions: SensaSenseExpressionBindingVersionSnapshot[];
}

export interface CommandReceipt {
  operationId: string;
  command: string;
  /** Present for commands whose idempotency key must also bind exact input. */
  requestDigest?: string;
  /** Small stable result payload needed for exact replay. */
  result: Record<string, string | number | boolean | null>;
}

export interface JourneyState {
  version: typeof JOURNEY_STORE_VERSION;
  meanings: MeaningJourneyRecord[];
  registry: SenseRegistryState;
  /** Slow-track draft materials waiting for learner confirmation. */
  inboxItems: SensaIntakeItem[];
  /** Conversation-only hints for Inbox drafts; never Personal Meaning facts. */
  clarificationDrafts: Array<{
    intakeId: string;
    startingPoint: ClarificationStartingPoint | null;
  }>;
  commandReceipts: CommandReceipt[];
}

export class StoreCorruptedError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'StoreCorruptedError';
  }
}

export const emptyRegistry = (): SenseRegistryState => ({
  senses: [],
  senseVersions: [],
  expressions: [],
  expressionVersions: [],
  bindings: [],
  bindingVersions: [],
});

export const emptyJourneyState = (): JourneyState => ({
  version: JOURNEY_STORE_VERSION,
  meanings: [],
  registry: emptyRegistry(),
  inboxItems: [],
  clarificationDrafts: [],
  commandReceipts: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireArray = (record: Record<string, unknown>, key: string): void => {
  if (!Array.isArray(record[key])) {
    throw new StoreCorruptedError(`本机的个人意义数据缺少 ${key} 数组。`);
  }
};

/**
 * Structural guard for repository reconstruction. The Personal Semantic World
 * authority validates every fact, reference and transition at the Repository
 * seam; this guard prevents partial rows from being treated as an empty store.
 */
export const parseJourneyState = (parsed: unknown): JourneyState => {
  if (!isRecord(parsed)) {
    throw new StoreCorruptedError('本机的个人意义数据不是有效对象。');
  }
  if (parsed.version !== JOURNEY_STORE_VERSION) {
    throw new StoreCorruptedError(
      `本机数据版本不匹配（${String(parsed.version)}）。为避免误读，已停止读取。`,
    );
  }
  requireArray(parsed, 'meanings');
  requireArray(parsed, 'inboxItems');
  requireArray(parsed, 'clarificationDrafts');
  requireArray(parsed, 'commandReceipts');
  if (!isRecord(parsed.registry)) {
    throw new StoreCorruptedError('本机的语义注册表数据结构损坏。');
  }
  for (const key of [
    'senses',
    'senseVersions',
    'expressions',
    'expressionVersions',
    'bindings',
    'bindingVersions',
  ]) {
    requireArray(parsed.registry, key);
  }
  return parsed as unknown as JourneyState;
};
