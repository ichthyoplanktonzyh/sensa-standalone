import assert from 'node:assert/strict';
import {test} from 'vitest';

import { decodeBackupValue, encodeBackupValue } from '../../../apps/web/src/data/library/backupCodec.ts';
import {
  replicaEntryId,
  type LibraryReplicaEntry,
} from '../../../apps/web/src/data/library/replication/libraryReplica.ts';
import { createLibraryConvergenceWorld } from '../support/libraryConvergenceWorld.mts';

const note = (key: string, body: string, revision = 1): LibraryReplicaEntry => ({
  table: 'annotations',
  key,
  value: encodeBackupValue({
    id: key,
    kind: 'sense_note',
    senseId: `sense:${key}`,
    body,
    revision,
  }),
});

const sharedIdentity = (): LibraryReplicaEntry => ({
  table: 'meta',
  key: 'identity',
  value: encodeBackupValue({
    id: '10000000-0000-4000-8000-000000000001',
    learnerId: '10000000-0000-4000-8000-000000000002',
    deviceId: '10000000-0000-4000-8000-000000000003',
    createdAt: '2026-09-23T00:00:00.000Z',
    schemaVersion: 2,
  }),
});

const upsert = (
  entries: readonly LibraryReplicaEntry[],
  replacement: LibraryReplicaEntry,
): LibraryReplicaEntry[] => [
  ...entries.filter((entry) => replicaEntryId(entry) !== replicaEntryId(replacement)),
  replacement,
];

const bodies = (entries: readonly LibraryReplicaEntry[]): Record<string, string> => Object.fromEntries(
  entries
    .filter((entry) => entry.table === 'annotations')
    .map((entry) => [entry.key, (decodeBackupValue(entry.value) as { body: string }).body]),
);

test('[integration][durability][convergence] offline devices retry a lost acknowledgement and converge independent writes', () => {
  const base = [sharedIdentity()];
  const world = createLibraryConvergenceWorld({ base, deviceIds: ['device-a', 'device-b'] });
  world.update('device-a', (entries) => upsert(entries, note('note-a', 'written on A')));
  world.update('device-b', (entries) => upsert(entries, note('note-b', 'written on B')));

  assert.equal(world.sync('device-a', { fault: 'lost-ack' }).status, 'lost-ack');
  let state = world.snapshot();
  assert.deepEqual(bodies(state.cloud), { 'note-a': 'written on A' }, 'the cloud committed before the acknowledgement was lost');
  assert.deepEqual(
    state.devices['device-a']!.confirmedBase,
    base,
    'the sender cannot confirm a response it never received',
  );

  assert.equal(world.sync('device-a').status, 'synced', 'retrying the same local state is idempotent');
  assert.equal(world.sync('device-b', { fault: 'offline' }).status, 'offline');
  state = world.snapshot();
  assert.deepEqual(bodies(state.devices['device-b']!.current), { 'note-b': 'written on B' }, 'offline failure preserves local work');

  assert.equal(world.sync('device-b').status, 'synced');
  assert.equal(world.sync('device-a').status, 'synced');
  assert.equal(world.sync('device-a').status, 'synced', 'a duplicate sync remains a no-op');
  state = world.snapshot();
  const expected = { 'note-a': 'written on A', 'note-b': 'written on B' };
  assert.deepEqual(bodies(state.cloud), expected);
  assert.deepEqual(bodies(state.devices['device-a']!.current), expected);
  assert.deepEqual(bodies(state.devices['device-b']!.current), expected);
});

test('[integration][local-correctness][convergence] explicit conflicts retain both branches while independent records converge', () => {
  const shared = note('shared', 'base');
  const world = createLibraryConvergenceWorld({
    base: [sharedIdentity(), shared],
    deviceIds: ['device-a', 'device-b'],
  });
  world.update('device-a', (entries) => upsert(upsert(entries, note('shared', 'A edit', 2)), note('note-a', 'A addition')));
  world.update('device-b', (entries) => upsert(upsert(entries, note('shared', 'B edit', 2)), note('note-b', 'B addition')));

  assert.equal(world.sync('device-a').status, 'synced');
  const conflict = world.sync('device-b');
  assert.equal(conflict.status, 'conflict');
  assert.deepEqual(conflict.conflicts, [replicaEntryId(shared)]);

  assert.equal(world.sync('device-a').status, 'synced');
  assert.equal(world.sync('device-b').status, 'conflict', 'retries keep the unresolved choice explicit');
  const state = world.snapshot();
  assert.deepEqual(bodies(state.cloud), {
    'note-a': 'A addition',
    'note-b': 'B addition',
    shared: 'A edit',
  });
  assert.deepEqual(bodies(state.devices['device-a']!.current), bodies(state.cloud));
  assert.deepEqual(bodies(state.devices['device-b']!.current), {
    'note-a': 'A addition',
    'note-b': 'B addition',
    shared: 'B edit',
  });
  assert.equal(state.devices['device-b']!.syncState, 'conflict');
});
