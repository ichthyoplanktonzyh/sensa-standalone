/**
 * 学习旅程状态的入口。App 只通过这里读写每条 Target 的进度。
 *
 * 与 learningFlow / runtimeSession 一致，用 useReducer：全部合法转移列在
 * journeyState.ts 一处，reducer 是纯的，将来加持久化不需要动调用点。
 */
import { useCallback, useMemo, useReducer } from 'react';
import {
  INITIAL_JOURNEY,
  journeyReducer,
  type JourneyAction,
  type JourneyState,
} from './journeyState';

export interface JourneyStore {
  readonly journey: JourneyState;
  readonly dispatchJourney: (action: JourneyAction) => void;
}

export function useJourneyState(): JourneyStore {
  const [journey, dispatch] = useReducer(journeyReducer, INITIAL_JOURNEY);
  const dispatchJourney = useCallback((action: JourneyAction) => dispatch(action), []);
  return useMemo(() => ({ journey, dispatchJourney }), [journey, dispatchJourney]);
}
