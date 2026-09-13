import type { SensaExpressionType } from '@sensa/contracts/sensa';
import type { JourneyAlignmentView, JourneyWorldItemView } from './personalMeaningJourney/types';
import { PRACTICE_SENSES, type PracticeSenseItem } from './practiceData';

export const PRACTICE_SCOPE_RESOLVER_VERSION = 'practice-scope-resolver-v1';
export const CURRENT_STUDY_SCOPE_ID = 'current_study';
export const PERSONAL_SEMANTIC_WORLD_SCOPE_ID = 'personal_semantic_world';

export type PracticeScopeSourceId =
  | typeof CURRENT_STUDY_SCOPE_ID
  | typeof PERSONAL_SEMANTIC_WORLD_SCOPE_ID;

export type PracticeScopeSelection =
  | {
      readonly sourceId: typeof CURRENT_STUDY_SCOPE_ID;
    }
  | {
      readonly sourceId: typeof PERSONAL_SEMANTIC_WORLD_SCOPE_ID;
      readonly targetIds: readonly string[];
    };

export type PracticeTargetIdentity =
  | {
      readonly kind: 'catalog_binding';
      readonly packageId: string;
      readonly senseId: string;
    }
  | {
      readonly kind: 'personal_meaning_binding';
      readonly personalMeaningId: string;
      readonly personalMeaningAlignmentId: string;
      readonly senseId: string;
      readonly senseVersionId: string;
      readonly expressionBindingConfirmationId: string;
      readonly bindingVersionId: string;
    };

/**
 * A source-neutral target available to Free Practice.
 *
 * It deliberately carries semantic identity and provenance, not a formal
 * learning status. Activity-specific resource resolution happens later.
 */
export interface PracticeScopeTarget {
  readonly targetId: string;
  readonly identity: PracticeTargetIdentity;
  readonly expression: {
    readonly surfaceForm: string;
    readonly expressionType: SensaExpressionType;
    readonly languageTag: string;
    readonly pronunciationVariant: {
      readonly accentLocale: string;
      readonly ipa: string;
    } | null;
  };
  readonly sense: {
    readonly senseId: string;
    readonly senseVersionId: string | null;
    readonly label: string;
  };
  readonly context: {
    readonly personalMeaningId: string;
    readonly preview: string;
  } | null;
  readonly provenance: {
    readonly sourceId: PracticeScopeSourceId;
    readonly sourceLabel: string;
  };
}

export interface ResolvedPracticeScope {
  readonly resolverVersion: typeof PRACTICE_SCOPE_RESOLVER_VERSION;
  readonly sourceId: PracticeScopeSourceId;
  readonly sourceLabel: string;
  readonly title: string;
  readonly targets: readonly PracticeScopeTarget[];
}

export interface PracticeScopeSourceOption {
  readonly sourceId: PracticeScopeSourceId;
  readonly title: string;
  readonly subtitle: string;
  readonly targets: readonly PracticeScopeTarget[];
  readonly selectedTargetCount: number;
  readonly selected: boolean;
}

export interface PracticeScopeCatalog {
  readonly selection: PracticeScopeSelection;
  readonly currentScope: ResolvedPracticeScope;
  readonly sources: readonly PracticeScopeSourceOption[];
}

export interface PracticeScopeInput {
  readonly selection: PracticeScopeSelection;
  readonly personalMeanings: readonly JourneyWorldItemView[];
  readonly studyItems?: readonly PracticeSenseItem[];
  readonly studyTitle?: string;
  /** The language being learned now. Free Practice is an action surface, so it
   * offers the expressions of that language: practising a language the learner
   * is not currently learning is not a smaller version of this screen, it is a
   * different one. */
  readonly activeLanguageTag?: string;
}

export const DEFAULT_PRACTICE_SCOPE_SELECTION: PracticeScopeSelection = {
  sourceId: CURRENT_STUDY_SCOPE_ID,
};

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim();

const targetsFromStudyScope = (
  items: readonly PracticeSenseItem[],
): readonly PracticeScopeTarget[] => items.map((item) => ({
  targetId: `catalog:${item.wordId}:${item.senseId}`,
  identity: {
    kind: 'catalog_binding',
    packageId: item.wordId,
    senseId: item.senseId,
  },
  expression: {
    surfaceForm: item.word,
    expressionType: 'word',
    languageTag: 'en',
    pronunciationVariant: item.phonetic
      ? { accentLocale: 'en-US', ipa: item.phonetic }
      : null,
  },
  sense: {
    senseId: item.senseId,
    senseVersionId: null,
    label: item.meaning,
  },
  context: null,
  provenance: {
    sourceId: CURRENT_STUDY_SCOPE_ID,
    sourceLabel: '当前学习范围',
  },
}));

const alignmentsFrom = (
  item: JourneyWorldItemView,
): readonly JourneyAlignmentView[] => [
  ...item.detail.focuses.flatMap((focus) => focus.alignment ? [focus.alignment] : []),
  ...item.detail.directAlignments,
];

const contextPreviewFrom = (item: JourneyWorldItemView): string => {
  const material = item.detail.materialBlocks.find((block) => compact(block.bodyText ?? ''));
  if (material?.bodyText) return compact(material.bodyText);
  const experience = item.detail.experienceAnchors.find((anchor) => compact(anchor.surfaceForm));
  return experience ? compact(experience.surfaceForm) : '';
};

const targetsFromPersonalMeanings = (
  meanings: readonly JourneyWorldItemView[],
): readonly PracticeScopeTarget[] => {
  const seen = new Set<string>();
  const targets: PracticeScopeTarget[] = [];

  for (const meaning of meanings) {
    const contextPreview = contextPreviewFrom(meaning);
    for (const alignment of alignmentsFrom(meaning)) {
      if (alignment.status !== 'active') continue;
      for (const binding of alignment.confirmedBindings) {
        const targetId = `personal:${alignment.personalMeaningAlignmentId}:${binding.bindingVersionId}`;
        if (seen.has(targetId)) continue;
        seen.add(targetId);
        targets.push({
          targetId,
          identity: {
            kind: 'personal_meaning_binding',
            personalMeaningId: meaning.personalMeaningId,
            personalMeaningAlignmentId: alignment.personalMeaningAlignmentId,
            senseId: alignment.senseId,
            senseVersionId: alignment.senseVersionId,
            expressionBindingConfirmationId: binding.expressionBindingConfirmationId,
            bindingVersionId: binding.bindingVersionId,
          },
          expression: {
            surfaceForm: binding.surfaceForm,
            expressionType: binding.expressionType,
            languageTag: binding.languageTag,
            pronunciationVariant: null,
          },
          sense: {
            senseId: alignment.senseId,
            senseVersionId: alignment.senseVersionId,
            label: compact(alignment.coreMeaningFocus) || meaning.primaryLabel,
          },
          context: {
            personalMeaningId: meaning.personalMeaningId,
            preview: contextPreview,
          },
          provenance: {
            sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
            sourceLabel: '我的语义世界',
          },
        });
      }
    }
  }

  return targets;
};

const uniqueTargetIds = (targetIds: readonly string[]): readonly string[] =>
  [...new Set(targetIds.filter((targetId) => targetId.trim().length > 0))];

/**
 * Resolve every delivered source and the learner's current selection through
 * one interface. Invalid or emptied personal selections fall back to the
 * current study scope; no caller needs to reproduce that rule.
 */
export const resolvePracticeScopeCatalog = ({
  selection,
  personalMeanings,
  studyItems = PRACTICE_SENSES,
  studyTitle = 'COCA 20000 (上)',
  activeLanguageTag,
}: PracticeScopeInput): PracticeScopeCatalog => {
  const inLanguage = (target: PracticeScopeTarget) =>
    !activeLanguageTag || target.expression.languageTag === activeLanguageTag;
  const studyTargets = targetsFromStudyScope(studyItems).filter(inLanguage);
  const personalTargets = targetsFromPersonalMeanings(personalMeanings).filter(inLanguage);
  const personalById = new Map(personalTargets.map((target) => [target.targetId, target] as const));
  const selectedPersonalTargetIds = selection.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID
    ? uniqueTargetIds(selection.targetIds).filter((targetId) => personalById.has(targetId))
    : [];
  const usePersonalScope = selectedPersonalTargetIds.length > 0;
  const normalizedSelection: PracticeScopeSelection = usePersonalScope
    ? { sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID, targetIds: selectedPersonalTargetIds }
    : DEFAULT_PRACTICE_SCOPE_SELECTION;
  const selectedPersonalTargets = selectedPersonalTargetIds
    .map((targetId) => personalById.get(targetId))
    .filter((target): target is PracticeScopeTarget => target !== undefined);
  const currentScope: ResolvedPracticeScope = usePersonalScope
    ? {
        resolverVersion: PRACTICE_SCOPE_RESOLVER_VERSION,
        sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
        sourceLabel: '我的语义世界',
        title: '我的语义世界',
        targets: selectedPersonalTargets,
      }
    : {
        resolverVersion: PRACTICE_SCOPE_RESOLVER_VERSION,
        sourceId: CURRENT_STUDY_SCOPE_ID,
        sourceLabel: '当前学习范围',
        title: studyTitle,
        targets: studyTargets,
      };

  return {
    selection: normalizedSelection,
    currentScope,
    sources: [
      {
        sourceId: CURRENT_STUDY_SCOPE_ID,
        title: '当前学习范围',
        subtitle: studyTitle,
        targets: studyTargets,
        selectedTargetCount: normalizedSelection.sourceId === CURRENT_STUDY_SCOPE_ID
          ? studyTargets.length
          : 0,
        selected: normalizedSelection.sourceId === CURRENT_STUDY_SCOPE_ID,
      },
      {
        sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
        title: '我的语义世界',
        subtitle: '已确认的意思与表达',
        targets: personalTargets,
        selectedTargetCount: normalizedSelection.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID
          ? selectedPersonalTargets.length
          : 0,
        selected: normalizedSelection.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
      },
    ],
  };
};
