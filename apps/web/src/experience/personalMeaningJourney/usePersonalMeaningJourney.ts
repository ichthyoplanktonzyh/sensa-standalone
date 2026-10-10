/**
 * React bindings for the Personal Meaning journey gateway.
 *
 * Components read view models through these hooks and issue intents on the
 * returned gateway. All re-renders are driven by the gateway's own change
 * notifications when the v2 journey fact store changes.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
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
import type { PersonalMeaningLearningSource } from '../../contentSupply/system';
import {useWorldDetail} from './useWorldRead';
import {worldReadRepository,type WorldDetailSnapshot} from './worldRepository';
import type {ClarificationSourceWitness} from './clarificationSource';

export const useJourneyGateway = (): PersonalMeaningJourneyGateway => journeyGateway;

/**
 * The gateway's getters build a fresh view model on every call, so components
 * subscribe to its change count and derive their own view from it. This closes
 * the window the previous `useState` + `useEffect` pairing left open, where a
 * change landing between render and effect showed stale facts until the next
 * notification.
 */
const gatewayVersionStore = createVersionStore((listener) => journeyGateway.subscribe(listener));
const inactiveSubscription=()=>()=>undefined;
const inactiveVersion=()=>0;

const useGatewaySnapshot = <T,>(select: () => T,enabled=true): T => {
  const version = useSyncExternalStore(
    enabled?gatewayVersionStore.subscribe:inactiveSubscription,
    enabled?gatewayVersionStore.getSnapshot:inactiveVersion,
  );
  return useMemo(select, [select, version]);
};

export const useJourneyStatus = (enabled=true): JourneyGatewayStatus =>
  useGatewaySnapshot(useCallback(() => journeyGateway.getStatus(), []),enabled);

export const useJourneyList = (): JourneyListItemView[] =>
  useGatewaySnapshot(useCallback(() => journeyGateway.getListItems(), []));

export interface JourneyWorldResult {
  items: JourneyWorldItemView[];
  status: JourneyGatewayStatus;
}

/** Read the semantic world and its gateway status as one render snapshot. */
export const useJourneyWorld = (enabled=true): JourneyWorldResult =>
  useGatewaySnapshot(useCallback(() => ({
    items: enabled?journeyGateway.getWorldItems():[],
    status: journeyGateway.getStatus(),
  }), [enabled]),enabled);

/** Complete, authoritative Personal Meaning sources that may become learning
 * or Free Practice targets. UI list projections are deliberately not reused. */
export const useJourneyLearningSources = (enabled=true): PersonalMeaningLearningSource[] =>
  useGatewaySnapshot(useCallback(
    () => enabled?journeyGateway.getWorldItems().flatMap(
      (item) => journeyGateway.getLearningSources(item.personalMeaningId),
    ):[],
    [enabled],
  ),enabled);

export interface JourneyDetailResult {
  detail: JourneyDetailView | null;
  status: JourneyGatewayStatus;
  sources:PersonalMeaningLearningSource[];
  reload:()=>void;
  draft:ClarificationDraftView|null;
  source:ClarificationSourceWitness|null;
  readCurrent:()=>Promise<WorldDetailSnapshot>;
}

export const useJourneyDetail = (
  personalMeaningId: string | null,
): JourneyDetailResult => {
  const result=useWorldDetail(personalMeaningId);
  const readCurrent=useCallback(()=>personalMeaningId?worldReadRepository.detail(personalMeaningId):Promise.reject(new Error('world_meaning_id_invalid')),[personalMeaningId]);
  return {detail:result.value?.detail??null,status:result.status,sources:result.value?.sources??[],reload:result.reload,draft:result.value?.draft??null,source:result.value?.source??null,readCurrent};
};

export const useJourneyClarificationDraft = (
  intakeId: string | null,
): ClarificationDraftView | null => useWorldDetail(intakeId).value?.draft??null;
