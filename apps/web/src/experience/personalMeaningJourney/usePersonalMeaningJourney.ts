/**
 * React bindings for the Personal Meaning journey gateway.
 *
 * Components read view models through these hooks and issue intents on the
 * returned gateway. All re-renders are driven by the gateway's own change
 * notifications when the v2 journey fact store changes.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { SensaIntakeItem } from '@sensa/contracts/sensa';
import { createVersionStore } from '../services/createSnapshotStore';
import {
  journeyGateway,
  type JourneyGatewayStatus,
  type PersonalMeaningJourneyGateway,
} from './gateway';
import type {
  JourneyDetailView,
  ClarificationDraftView,
  JourneyListItemView,
  JourneyWorldItemView,
} from './types';
import type { PersonalMeaningLearningSource } from '../../data/library/personalLearningSource';

export const useJourneyGateway = (): PersonalMeaningJourneyGateway => journeyGateway;

/**
 * The gateway's getters build a fresh view model on every call, so components
 * subscribe to its change count and derive their own view from it. This closes
 * the window the previous `useState` + `useEffect` pairing left open, where a
 * change landing between render and effect showed stale facts until the next
 * notification.
 */
const gatewayVersionStore = createVersionStore((listener) => journeyGateway.subscribe(listener));

const useGatewaySnapshot = <T,>(select: () => T): T => {
  const version = useSyncExternalStore(
    gatewayVersionStore.subscribe,
    gatewayVersionStore.getSnapshot,
  );
  return useMemo(select, [select, version]);
};

export const useJourneyStatus = (): JourneyGatewayStatus =>
  useGatewaySnapshot(useCallback(() => journeyGateway.getStatus(), []));

export const useJourneyList = (): JourneyListItemView[] =>
  useGatewaySnapshot(useCallback(() => journeyGateway.getListItems(), []));

/**
 * The intake Inbox shares the gateway's change count, so any ingest/resolve/
 * dismiss command re-renders subscribers alongside the world view.
 */
export const useJourneyInbox = (): SensaIntakeItem[] =>
  useGatewaySnapshot(useCallback(() => journeyGateway.getInboxItems(), []));

export interface JourneyWorldResult {
  items: JourneyWorldItemView[];
  status: JourneyGatewayStatus;
}

/** Read the semantic world and its gateway status as one render snapshot. */
export const useJourneyWorld = (): JourneyWorldResult =>
  useGatewaySnapshot(useCallback(() => ({
    items: journeyGateway.getWorldItems(),
    status: journeyGateway.getStatus(),
  }), []));

/** Complete, authoritative Personal Meaning sources that may become learning
 * or Free Practice targets. UI list projections are deliberately not reused. */
export const useJourneyLearningSources = (): PersonalMeaningLearningSource[] =>
  useGatewaySnapshot(useCallback(
    () => journeyGateway.getWorldItems().flatMap(
      (item) => journeyGateway.getLearningSources(item.personalMeaningId),
    ),
    [],
  ));

export interface JourneyDetailResult {
  detail: JourneyDetailView | null;
  status: JourneyGatewayStatus;
}

export const useJourneyDetail = (
  personalMeaningId: string | null,
): JourneyDetailResult => {
  const select = useCallback((): JourneyDetailResult => {
    if (!personalMeaningId) {
      return { detail: null, status: journeyGateway.getStatus() };
    }
    return {
      detail: journeyGateway.getDetail(personalMeaningId),
      status: journeyGateway.getStatus(),
    };
  }, [personalMeaningId]);

  const result = useGatewaySnapshot(select);

  return result;
};

export const useJourneyClarificationDraft = (
  intakeId: string | null,
): ClarificationDraftView | null => useGatewaySnapshot(useCallback(
  () => intakeId ? journeyGateway.getClarificationDraft(intakeId) : null,
  [intakeId],
));
