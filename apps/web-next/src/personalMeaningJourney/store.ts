/**
 * Versioned local fact store for the Personal Meaning journey.
 *
 * The v2 key is intentionally independent from the old prototype key. There
 * is no migration or fallback: a v1 blob is not a second identity source and
 * must never be interpreted as a v2 Personal Meaning. Every authoritative
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
} from '@sensa/contracts/sensa';
import { StorageUnavailableError, type StoragePort } from './ports';
import type { ClarificationStartingPoint } from './semanticAgent';

export const JOURNEY_STORE_KEY = 'sensa_personal_meaning_journey_v2';
export const JOURNEY_STORE_VERSION = 'sensa-personal-meaning-journey-store-v2';

export interface MockFocusSuggestion {
  suggestionId: string;
  statement: string;
  distinguishingNotes: string[];
  aspectLabel: string;
}

/** Recoverable adapter state; none of these values are domain facts. */
export interface JourneyMockState {
  focusSuggestions: {
    multipleAspects: boolean;
    provenance: { provider: string; model: string; promptVersion: string };
    items: MockFocusSuggestion[];
  } | null;
  /** UI-only boundary choices awaiting a learner answer. */
  constructionHints: Record<string, { boundaryOptions: string[] }>;
  /** Mock-only reuse key; the registry remains the authoritative Sense store. */
  proposalSenseKeys: Record<string, string>;
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
  /** Small stable result payload needed for exact replay. */
  result: Record<string, string | number | boolean | null>;
}

export interface JourneyState {
  version: typeof JOURNEY_STORE_VERSION;
  meanings: MeaningJourneyRecord[];
  registry: SenseRegistryState;
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

const emptyMockState = (): JourneyMockState => ({
  focusSuggestions: null,
  constructionHints: {},
  proposalSenseKeys: {},
  focusAspectLabels: {},
  startingPoint: null,
});

export const emptyJourneyState = (): JourneyState => ({
  version: JOURNEY_STORE_VERSION,
  meanings: [],
  registry: emptyRegistry(),
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

export const loadJourneyState = (storage: StoragePort): JourneyState => {
  let raw: string | null;
  try {
    raw = storage.read(JOURNEY_STORE_KEY);
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

export const saveJourneyState = (storage: StoragePort, state: JourneyState): void => {
  try {
    storage.write(JOURNEY_STORE_KEY, JSON.stringify(state));
  } catch (cause) {
    if (cause instanceof StorageUnavailableError) throw cause;
    throw new StoreCorruptedError('无法保存本机的个人意义数据。', cause);
  }
};

export { emptyMockState };
