import { useSyncExternalStore } from 'react';
import { learnerSemanticProjectionSystem } from './system/learnerSemanticProjectionSystem';

/**
 * The learning slice is loaded from the authoritative async Library. The
 * remaining synchronous sources contain presentation annotations and the
 * Personal Meaning journey; they cannot create Memory State.
 *
 * One store shared by every caller: the projection is rebuilt once per change
 * rather than once per mounted component.
 */
const inactiveSubscribe=()=>()=>{};
export const useLearnerSemanticProjection = (enabled=true) => useSyncExternalStore(
  enabled?learnerSemanticProjectionSystem.subscribe:inactiveSubscribe,
  learnerSemanticProjectionSystem.read,
);
