import { previewStorage } from './services/previewStorage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useJourneyLearningSources,useJourneyStatus } from './personalMeaningJourney/usePersonalMeaningJourney';
import {journeyGateway} from './personalMeaningJourney/gateway';
import {
  CURRENT_STUDY_SCOPE_ID,
  DEFAULT_PRACTICE_SCOPE_SELECTION,
  PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
  resolvePracticeScopeCatalog,
  type PracticeScopeCatalog,
  type PracticeScopeSelection,
  type PracticeStudyTarget,
} from './practiceScope';

const PRACTICE_SCOPE_SELECTION_KEY = 'sensa.free-practice.scope-selection.v2';
export type PracticeScopeAvailability='loading'|'ready'|'unavailable';

const selectionKey = (selection: PracticeScopeSelection): string =>
  selection.sourceId === CURRENT_STUDY_SCOPE_ID
    ? CURRENT_STUDY_SCOPE_ID
    : `${PERSONAL_SEMANTIC_WORLD_SCOPE_ID}:${selection.targetIds.join(',')}`;

const readSelection = (): PracticeScopeSelection => {
  if (typeof window === 'undefined') return DEFAULT_PRACTICE_SCOPE_SELECTION;
  try {
    const parsed = JSON.parse(
      previewStorage.getItem(PRACTICE_SCOPE_SELECTION_KEY) ?? 'null',
    ) as unknown;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PRACTICE_SCOPE_SELECTION;
    const candidate = parsed as { sourceId?: unknown; targetIds?: unknown };
    if (candidate.sourceId === CURRENT_STUDY_SCOPE_ID) {
      return DEFAULT_PRACTICE_SCOPE_SELECTION;
    }
    if (
      candidate.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID
      && Array.isArray(candidate.targetIds)
      && candidate.targetIds.every((targetId) => typeof targetId === 'string')
    ) {
      return {
        sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
        targetIds: candidate.targetIds,
      };
    }
  } catch {
    // A damaged preference must not prevent Free Practice from opening.
  }
  return DEFAULT_PRACTICE_SCOPE_SELECTION;
};

export interface PracticeScopeState {
  readonly catalog: PracticeScopeCatalog;
  readonly selectScope: (selection: PracticeScopeSelection) => void;
  /** A provisional fallback is not a learner-selected Session scope. */
  readonly availability: PracticeScopeAvailability;
  readonly reload:()=>void;
}

export interface UsePracticeScopeInput {
  readonly studyTargets: readonly PracticeStudyTarget[];
  readonly activeLanguageTag: string;
  readonly enabled?:boolean;
}

/**
 * React binding for the Practice Scope Module. The screen learns one selector;
 * source projection, validation, fallback and persistence stay behind it.
 */
export const usePracticeScope = ({
  studyTargets,
  activeLanguageTag,
  enabled=true,
}: UsePracticeScopeInput): PracticeScopeState => {
  const { t } = useTranslation();
  const personalMeaningSources = useJourneyLearningSources(enabled);
  const journeyStatus=useJourneyStatus(enabled);
  const [selection, setSelection] = useState<PracticeScopeSelection>(readSelection);
  const catalog = useMemo(
    () => resolvePracticeScopeCatalog({
      selection,
      personalMeaningSources,
      studyTargets,
      studyTitle: t('practice.currentStudySubtitle'),
      activeLanguageTag,
    }),
    [personalMeaningSources, studyTargets, t, activeLanguageTag, selection],
  );
  const normalizedKey = selectionKey(catalog.selection);

  useEffect(() => {
    // Inactive or still-loading sources cannot invalidate a saved learner choice.
    if(!enabled||journeyStatus.loading||!journeyStatus.ok)return;
    if (selectionKey(selection) !== normalizedKey) {
      setSelection(catalog.selection);
      return;
    }
    try {
      previewStorage.setItem(
        PRACTICE_SCOPE_SELECTION_KEY,
        JSON.stringify(catalog.selection),
      );
    } catch {
      // The in-memory selection remains valid when storage is unavailable.
    }
  }, [catalog.selection, normalizedKey, selection,enabled,journeyStatus.loading,journeyStatus.ok]);

  const selectScope = useCallback((next: PracticeScopeSelection) => {
    setSelection(next);
  }, []);

  const availability:PracticeScopeAvailability=!journeyStatus.ok?'unavailable':!enabled||journeyStatus.loading?'loading':'ready';
  const reload=useCallback(()=>journeyGateway.reload(),[]);
  return useMemo(() => ({ catalog, selectScope,availability,reload }), [catalog, selectScope,availability,reload]);
};
