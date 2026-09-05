import type { ResolvedPracticeScope } from './practiceScope';

/** The four stable learner-facing areas. They organise activities, not progress. */
export type PracticeArea = 'listening' | 'speaking' | 'reading' | 'writing';

export type PracticeActivityId =
  | 'real_world_speech_variation'
  | 'oral_scenario_rehearsal'
  | 'contextual_meaning_inference'
  | 'written_scenario_response';

export type PracticeActivityStatus =
  | 'available'
  | 'unavailable_in_scope'
  | 'not_yet_delivered';

export interface PracticeActivityDefinition {
  id: PracticeActivityId;
  name: string;
  primaryArea: PracticeArea;
  cue: string;
  iconHref: string;
  stimulusChannels: readonly ('audio' | 'context' | 'text')[];
  responseChannels: readonly ('navigation' | 'voice' | 'reveal' | 'text')[];
}

export interface ResolvedPracticeActivity extends PracticeActivityDefinition {
  areaLabel: string;
  status: PracticeActivityStatus;
  targetCount: number;
}

export const practiceAreaLabel: Record<PracticeArea, string> = {
  listening: '听',
  speaking: '说',
  reading: '读',
  writing: '写',
};

const AREA_ORDER: readonly PracticeArea[] = ['listening', 'speaking', 'reading', 'writing'];

/** The first profile deliberately contains one activity in each area. */
export const INITIAL_FREE_PRACTICE_PROFILE = {
  version: 'sensa-initial-free-practice-v2',
  activityIds: [
    'real_world_speech_variation',
    'oral_scenario_rehearsal',
    'contextual_meaning_inference',
    'written_scenario_response',
  ] as const satisfies readonly PracticeActivityId[],
};

export const PRACTICE_ACTIVITY_DEFINITIONS: readonly PracticeActivityDefinition[] = [
  {
    id: 'real_world_speech_variation',
    name: '真实语流泛化',
    primaryArea: 'listening',
    cue: '听见不同口音与语速',
    iconHref: '#i-vol',
    stimulusChannels: ['audio', 'context'],
    responseChannels: ['navigation'],
  },
  {
    id: 'oral_scenario_rehearsal',
    name: '情境口语排演',
    primaryArea: 'speaking',
    cue: '开口回应一个情境',
    iconHref: '#i-head',
    stimulusChannels: ['context'],
    responseChannels: ['voice'],
  },
  {
    id: 'contextual_meaning_inference',
    name: '语境推义',
    primaryArea: 'reading',
    cue: '从短语境里找到意思',
    iconHref: '#i-bookopen',
    stimulusChannels: ['text', 'context'],
    responseChannels: ['reveal'],
  },
  {
    id: 'written_scenario_response',
    name: '情境书面表达',
    primaryArea: 'writing',
    cue: '写出你在情境中想说的话',
    iconHref: '#i-write',
    stimulusChannels: ['context'],
    responseChannels: ['text'],
  },
];

const DELIVERED_ACTIVITY_IDS: ReadonlySet<PracticeActivityId> = new Set([
  'real_world_speech_variation',
]);

/**
 * Resolve the page from the profile and the prototype's actual capabilities.
 * YouGlish is provider-backed, so it only needs an Expression-bearing scope;
 * the other three definitions stay visible but cannot pretend their runtimes exist.
 */
export const resolvePracticeActivities = (
  scope: ResolvedPracticeScope,
): readonly ResolvedPracticeActivity[] => {
  const targetCount = scope.targets.length;

  return AREA_ORDER.map((area) => {
    const definition = PRACTICE_ACTIVITY_DEFINITIONS.find(
      (candidate) => candidate.primaryArea === area,
    );
    if (!definition) throw new Error(`Missing activity definition for ${area}`);

    const status: PracticeActivityStatus = !DELIVERED_ACTIVITY_IDS.has(definition.id)
      ? 'not_yet_delivered'
      : targetCount > 0
        ? 'available'
        : 'unavailable_in_scope';

    return {
      ...definition,
      areaLabel: practiceAreaLabel[area],
      status,
      targetCount,
    };
  });
};
