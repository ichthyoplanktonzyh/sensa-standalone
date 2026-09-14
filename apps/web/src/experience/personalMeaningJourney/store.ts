/**
 * Versioned local fact store for the Personal Meaning journey.
 *
 * The v3 key is intentionally independent from earlier prototype keys. There
 * is no migration or fallback: an older blob is not a second identity source
 * and must never be interpreted as a current Personal Meaning. Every authoritative
 * Personal Meaning, revision, Anchor, Focus, Construction, Proposal,
 * confirmation and Alignment is owned by this aggregate.
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
import { StorageUnavailableError, type StoragePort } from './ports';
import type { ClarificationStartingPoint } from './semanticAgent';

export const JOURNEY_STORE_KEY = 'sensa_personal_meaning_journey_v3';
export const JOURNEY_STORE_VERSION = 'sensa-personal-meaning-journey-store-v3';

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
 * Structural guard for the v2 blob. Contract schemas validate individual
 * facts at the smoke boundary; this guard prevents partial/legacy blobs from
 * being silently treated as an empty store.
 */
const asJourneyState = (parsed: unknown): JourneyState => {
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

export const loadJourneyState = async (storage: StoragePort): Promise<JourneyState> => {
  let raw: string | null;
  try {
    raw = await storage.read(JOURNEY_STORE_KEY);
  } catch (cause) {
    if (cause instanceof StorageUnavailableError) throw cause;
    throw new StoreCorruptedError('无法读取本机的个人意义数据。', cause);
  }
  if (raw === null) return emptyJourneyState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new StoreCorruptedError('本机的个人意义数据无法解析（可能已损坏）。', cause);
  }
  return asJourneyState(parsed);
};

export const saveJourneyState = async (
  storage: StoragePort,
  state: JourneyState,
): Promise<void> => {
  try {
    await storage.write(JOURNEY_STORE_KEY, JSON.stringify(state));
  } catch (cause) {
    if (cause instanceof StorageUnavailableError) throw cause;
    throw new StoreCorruptedError('无法保存本机的个人意义数据。', cause);
  }
};
