/**
 * Adapts the app's synchronous, subscribable services to the shape
 * `useSyncExternalStore` expects.
 *
 * The hand-written pattern this replaces recomputed per component:
 *
 *     const [value, setValue] = useState(compute);
 *     useEffect(() => {
 *       const unsub = service.subscribe(() => setValue(compute()));
 *       compute();                    // and again on mount
 *       return unsub;
 *     }, []);
 *
 * which computes once while rendering, once more in the effect, and then once
 * per subscribed component on every change -- while leaving a window between
 * render and effect where the UI shows data the service has already replaced.
 *
 * Here the value is computed once per change, no matter how many components
 * read it, and `useSyncExternalStore` gives React the snapshot it needs to keep
 * a concurrent render from tearing across it.
 *
 * The snapshot must stay referentially stable between changes: returning a
 * fresh object from `getSnapshot` on every call would loop forever. So it is
 * recomputed only when a source actually fires.
 */
export interface SnapshotStore<T> {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => T;
}

export function createSnapshotStore<T>(
  compute: () => T,
  subscribeToSources: (onSourceChange: () => void) => () => void,
): SnapshotStore<T> {
  let snapshot: T = compute();
  let sourcesConnected: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const handleSourceChange = (): void => {
    snapshot = compute();
    for (const listener of listeners) listener();
  };

  const subscribe = (onStoreChange: () => void): (() => void) => {
    listeners.add(onStoreChange);
    if (listeners.size === 1) {
      // Sources are only listened to while something is actually reading, and
      // the snapshot is refreshed on connect in case they moved while detached.
      sourcesConnected = subscribeToSources(handleSourceChange);
      snapshot = compute();
    }
    return () => {
      listeners.delete(onStoreChange);
      if (listeners.size === 0 && sourcesConnected !== null) {
        sourcesConnected();
        sourcesConnected = null;
      }
    };
  };

  return { subscribe, getSnapshot: () => snapshot };
}

/**
 * A store whose snapshot is a change counter rather than the data itself.
 *
 * `useSyncExternalStore` requires a referentially stable snapshot, which rules
 * out services whose getters build a fresh object per call, and rules out
 * selectors that take an argument (one shared snapshot cannot serve
 * `getDetail(a)` and `getDetail(b)`). Subscribing to a monotonic version and
 * deriving the value with `useMemo` keeps both: the number is stable, and each
 * caller memoises its own projection of it.
 */
export interface VersionStore {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => number;
}

export function createVersionStore(
  subscribeToSources: (onSourceChange: () => void) => () => void,
): VersionStore {
  let version = 0;
  let sourcesConnected: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const bump = (): void => {
    version += 1;
    for (const listener of listeners) listener();
  };

  const subscribe = (onStoreChange: () => void): (() => void) => {
    listeners.add(onStoreChange);
    if (listeners.size === 1) sourcesConnected = subscribeToSources(bump);
    return () => {
      listeners.delete(onStoreChange);
      if (listeners.size === 0 && sourcesConnected !== null) {
        sourcesConnected();
        sourcesConnected = null;
      }
    };
  };

  return { subscribe, getSnapshot: () => version };
}

/** Combine several service `subscribe` functions into one unsubscribe. */
export const subscribeAll = (
  services: ReadonlyArray<(listener: () => void) => () => void>,
) => (onChange: () => void): (() => void) => {
  const unsubscribes = services.map((subscribe) => subscribe(onChange));
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
};
