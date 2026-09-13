import { useSyncExternalStore } from 'react';
import { contentAnnotations } from '../data/library/contentAnnotations';
import { readLearning } from '../data/library/learning';
import { observeLibrary } from '../data/library/store';
import { buildContentProjection } from './contentProjection';
import { journeyGateway } from './personalMeaningJourney/gateway';
import { subscribeAll } from './services/createSnapshotStore';
import type { LocalLearningTarget } from '../learning/runtime/localProtocol';

/**
 * The learning slice is loaded from the authoritative async Library. The
 * remaining synchronous sources contain presentation annotations and the
 * Personal Meaning journey; they cannot create Memory State.
 *
 * One store shared by every caller: the projection is rebuilt once per change
 * rather than once per mounted component.
 */
const projectionStore = (() => {
  let targets: readonly LocalLearningTarget[] = [];
  let snapshot = buildContentProjection(targets);
  let stopSources: (() => void) | null = null;
  let loadRevision = 0;
  const listeners = new Set<() => void>();

  const publish = () => {
    snapshot = buildContentProjection(targets);
    for (const listener of listeners) listener();
  };

  const loadLibrary = async () => {
    const revision = ++loadRevision;
    try {
      const learning = await readLearning();
      if (revision !== loadRevision) return;
      targets = learning.targets;
      publish();
    } catch {
      // Account/bootstrap surfaces can mount before IndexedDB is available.
      // Keep the last valid projection; the next Library event retries it.
    }
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      stopSources = subscribeAll([
        (onChange) => observeLibrary(() => { void loadLibrary(); }),
        (onChange) => contentAnnotations.subscribe(onChange),
        (onChange) => journeyGateway.subscribe(onChange),
      ])(() => publish());
      void loadLibrary();
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopSources?.();
        stopSources = null;
      }
    };
  };

  return { subscribe, getSnapshot: () => snapshot };
})();

export const useContentProjection = () =>
  useSyncExternalStore(projectionStore.subscribe, projectionStore.getSnapshot);
