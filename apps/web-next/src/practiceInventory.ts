import { PROTOTYPE_PACKAGE_BY_SENSE } from './content/learningCatalog';
import type { PracticeScope } from './practiceData';

/**
 * Executable Practice Capability Inventory for the free-practice prototype.
 *
 * The runtime model resolves a visible entry as
 *
 *   Free Practice Profile × Package Practice Manifest × client capability
 *
 * so an entry may never be hard-coded as enterable. Only a task family that
 * the Initial Profile allows AND that approved Packages inside the current
 * Practice Scope actually grant can be entered.
 */

export type PracticeTaskFamily =
  | 'immersive_browse'
  | 'portable_listening'
  | 'dictation'
  | 'quick_spelling';

export type PracticeChannel = 'listening' | 'speaking' | 'reading' | 'writing';

export type PracticeEntryStatus =
  /** Allowed by the Profile and granted by Packages inside the current Scope. */
  | 'available'
  /** Allowed by the Profile, but no Package in this Scope grants it. */
  | 'unavailable_in_scope'
  /** Outside the Initial Free Practice Profile. */
  | 'not_yet_delivered';

/** The task families the Initial Free Practice Profile is allowed to deliver. */
export const INITIAL_FREE_PRACTICE_PROFILE = {
  version: 'sensa-initial-free-practice-v1',
  taskFamilies: [
    'immersive_browse',
    'portable_listening',
    'dictation',
    'quick_spelling',
  ] as const satisfies readonly PracticeTaskFamily[],
};

export interface PracticeEntryDefinition {
  key: string;
  name: string;
  /** A practice belongs to exactly one learner-facing channel. */
  channel: PracticeChannel;
  /** promptChannel → target, the direction every Task must pin down. */
  direction: string;
  /** `false` when the family only records Activity and never scores a response. */
  graded: boolean;
  /** `null` for roadmap entries outside the Initial Profile. */
  taskFamily: PracticeTaskFamily | null;
}

export interface ResolvedPracticeEntry extends PracticeEntryDefinition {
  status: PracticeEntryStatus;
  /** Senses inside the current Scope whose Package grants this task family. */
  senseCount: number;
}

export interface PracticeChannelInventory {
  channel: PracticeChannel;
  label: string;
  entries: ResolvedPracticeEntry[];
  /** `true` when this channel currently has nothing a learner can enter. */
  empty: boolean;
}

export const practiceChannelLabel: Record<PracticeChannel, string> = {
  listening: '听',
  speaking: '说',
  reading: '读',
  writing: '写',
};

/** Fixed channel order required by the product IA. */
const CHANNEL_ORDER: readonly PracticeChannel[] = ['listening', 'speaking', 'reading', 'writing'];

/**
 * The full confirmed catalogue. Roadmap entries stay listed so the page keeps
 * telling the truth about what free practice will cover, but their status is
 * derived, never authored.
 */
export const PRACTICE_ENTRY_CATALOG: readonly PracticeEntryDefinition[] = [
  {
    key: 'portable_listening',
    name: '随身听',
    channel: 'listening',
    direction: '音 → 义',
    graded: false,
    taskFamily: 'portable_listening',
  },
  {
    key: 'listening_discrimination',
    name: '听音辨义',
    channel: 'listening',
    direction: '音 → 义',
    graded: true,
    taskFamily: null,
  },
  {
    key: 'shadowing',
    name: '跟读',
    channel: 'speaking',
    direction: '音 → 说',
    graded: true,
    taskFamily: null,
  },
  {
    key: 'sense_to_speech',
    name: '看义说词',
    channel: 'speaking',
    direction: '义 → 说',
    graded: true,
    taskFamily: null,
  },
  {
    key: 'example_read_aloud',
    name: '例句朗读',
    channel: 'speaking',
    direction: '形 → 说',
    graded: true,
    taskFamily: null,
  },
  {
    key: 'immersive_browse',
    name: '沉浸刷词',
    channel: 'reading',
    direction: '形 → 义',
    graded: false,
    taskFamily: 'immersive_browse',
  },
  {
    key: 'contextual_sense',
    name: '语境辨义',
    channel: 'reading',
    direction: '境 → 义',
    graded: true,
    taskFamily: null,
  },
  {
    key: 'sense_contrast',
    name: '义项辨析',
    channel: 'reading',
    direction: '义 → 义',
    graded: true,
    taskFamily: null,
  },
  {
    key: 'quick_spelling',
    name: '随手拼写',
    channel: 'writing',
    direction: '义 → 写',
    graded: true,
    taskFamily: 'quick_spelling',
  },
  {
    key: 'dictation',
    name: '听写',
    channel: 'writing',
    direction: '音 → 写',
    graded: true,
    taskFamily: 'dictation',
  },
  {
    key: 'example_cloze',
    name: '例句填空',
    channel: 'writing',
    direction: '境 → 写',
    graded: true,
    taskFamily: null,
  },
];

/**
 * Count, per task family, how many Senses in this Scope are backed by an
 * approved Package grant. A Sense whose Package says nothing about a family
 * contributes nothing: the manifest is the only authority.
 */
export const countGrantedSenses = (scope: PracticeScope): Record<PracticeTaskFamily, number> => {
  const counts: Record<PracticeTaskFamily, number> = {
    immersive_browse: 0,
    portable_listening: 0,
    dictation: 0,
    quick_spelling: 0,
  };

  scope.items.forEach((item) => {
    const grants = PROTOTYPE_PACKAGE_BY_SENSE.get(item.senseId)?.content.practiceManifest?.grants;
    if (!grants) return;

    const seen = new Set<PracticeTaskFamily>();
    grants.forEach((grant) => {
      if (grant.resourceKeys.length === 0) return;
      if (seen.has(grant.taskFamily)) return;
      seen.add(grant.taskFamily);
      counts[grant.taskFamily] += 1;
    });
  });

  return counts;
};

export const resolvePracticeEntries = (scope: PracticeScope): ResolvedPracticeEntry[] => {
  const counts = countGrantedSenses(scope);

  return PRACTICE_ENTRY_CATALOG.map((entry) => {
    if (!entry.taskFamily) {
      return { ...entry, status: 'not_yet_delivered' as const, senseCount: 0 };
    }

    const senseCount = counts[entry.taskFamily];
    return {
      ...entry,
      status: senseCount > 0 ? ('available' as const) : ('unavailable_in_scope' as const),
      senseCount,
    };
  });
};

export const resolvePracticeInventory = (scope: PracticeScope): PracticeChannelInventory[] => {
  const entries = resolvePracticeEntries(scope);

  return CHANNEL_ORDER.map((channel) => {
    const channelEntries = entries.filter((entry) => entry.channel === channel);
    return {
      channel,
      label: practiceChannelLabel[channel],
      entries: channelEntries,
      empty: channelEntries.every((entry) => entry.status !== 'available'),
    };
  });
};
