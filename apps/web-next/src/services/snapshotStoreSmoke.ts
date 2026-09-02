/**
 * Deterministic smoke for the external-store adapters.
 *
 * These sit under every screen that reads a service, and their contract is
 * easy to break silently: `useSyncExternalStore` demands a referentially
 * stable snapshot, and a store that recomputes per call would spin React in an
 * infinite loop rather than fail loudly. So the invariants are asserted here.
 *
 * No React, browser or network: run with `npm run smoke:stores`.
 */

import { createSnapshotStore, createVersionStore, subscribeAll } from './createSnapshotStore';

const failures: string[] = [];
let checked = 0;

const expect = (label: string, actual: unknown, expected: unknown): void => {
  checked += 1;
  if (actual !== expected) failures.push(`${label}: ${String(actual)} !== ${String(expected)}`);
};

/** A stand-in service: a listener set plus a value that changes on demand. */
const createFakeService = () => {
  const listeners = new Set<() => void>();
  return {
    value: 0,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get listenerCount(): number {
      return listeners.size;
    },
    change(next: number): void {
      this.value = next;
      for (const listener of [...listeners]) listener();
    },
  };
};

// --- createSnapshotStore -----------------------------------------------------
{
  const service = createFakeService();
  let computeCount = 0;
  const store = createSnapshotStore(
    () => {
      computeCount += 1;
      return { value: service.value };
    },
    (onChange) => service.subscribe(onChange),
  );

  const first = store.getSnapshot();
  expect('snapshot is stable across calls', store.getSnapshot(), first);

  const seenA: number[] = [];
  const seenB: number[] = [];
  const unsubA = store.subscribe(() => seenA.push(store.getSnapshot().value));
  const unsubB = store.subscribe(() => seenB.push(store.getSnapshot().value));
  expect('one source subscription for many readers', service.listenerCount, 1);

  const beforeChange = computeCount;
  service.change(7);
  expect('recomputed once per change, not once per reader', computeCount - beforeChange, 1);
  expect('reader A notified', seenA.join(','), '7');
  expect('reader B notified', seenB.join(','), '7');
  expect('snapshot reflects the change', store.getSnapshot().value, 7);

  const afterChange = store.getSnapshot();
  expect('snapshot stable between changes', store.getSnapshot(), afterChange);

  unsubA();
  expect('source kept while a reader remains', service.listenerCount, 1);
  unsubB();
  expect('source released with the last reader', service.listenerCount, 0);
}

// --- createVersionStore ------------------------------------------------------
{
  const service = createFakeService();
  const store = createVersionStore((onChange) => service.subscribe(onChange));

  const start = store.getSnapshot();
  expect('version is stable across calls', store.getSnapshot(), start);

  const unsub = store.subscribe(() => {});
  service.change(1);
  expect('version advances on change', store.getSnapshot(), start + 1);
  service.change(2);
  expect('version advances again', store.getSnapshot(), start + 2);
  expect('version stable between changes', store.getSnapshot(), start + 2);
  unsub();
  expect('source released', service.listenerCount, 0);
}

// --- subscribeAll ------------------------------------------------------------
{
  const a = createFakeService();
  const b = createFakeService();
  let notifications = 0;
  const unsubscribe = subscribeAll([
    (listener) => a.subscribe(listener),
    (listener) => b.subscribe(listener),
  ])(() => {
    notifications += 1;
  });

  a.change(1);
  b.change(1);
  expect('every source notifies', notifications, 2);
  unsubscribe();
  expect('all sources released (a)', a.listenerCount, 0);
  expect('all sources released (b)', b.listenerCount, 0);
}

console.log(`snapshot store smoke: ${checked} 项`);
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`);
  for (const failure of failures) console.error('  ' + failure);
  process.exit(1);
}
console.log('全部通过');
