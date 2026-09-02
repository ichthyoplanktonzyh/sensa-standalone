/**
 * React bindings for the Personal Meaning journey gateway.
 *
 * Components read view models through these hooks and issue intents on the
 * returned gateway. All re-renders are driven by the gateway's own change
 * notifications when the v2 journey fact store changes.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  journeyGateway,
  type JourneyGatewayStatus,
  type PersonalMeaningJourneyGateway,
} from './gateway';
import type {
  JourneyDetailView,
  JourneyListItemView,
  JourneyWorldItemView,
} from './types';

export const useJourneyGateway = (): PersonalMeaningJourneyGateway => journeyGateway;

const useGatewaySnapshot = <T,>(select: () => T): T => {
  const [snapshot, setSnapshot] = useState<T>(select);
  const refresh = useCallback(() => setSnapshot(select), [select]);
  useEffect(() => {
    const unsubscribe = journeyGateway.subscribe(refresh);
    refresh();
    return unsubscribe;
  }, [refresh]);
  return snapshot;
};

export const useJourneyStatus = (): JourneyGatewayStatus =>
  useGatewaySnapshot(useCallback(() => journeyGateway.getStatus(), []));

export const useJourneyList = (): JourneyListItemView[] =>
  useGatewaySnapshot(useCallback(() => journeyGateway.getListItems(), []));

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
