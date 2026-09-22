import {
  mergeLibraryReplicas,
  partitionLibraryReplicaConflicts,
  replicaEntryId,
  type LibraryReplicaEntry,
} from '../../../apps/web/src/data/library/replication/libraryReplica.ts';

export type ConvergenceFault = 'offline' | 'lost-ack';
export type DeviceSyncState = 'confirmed' | 'dirty' | 'offline' | 'conflict' | 'unconfirmed';

export type ConvergenceDeviceSnapshot = Readonly<{
  current: readonly LibraryReplicaEntry[];
  confirmedBase: readonly LibraryReplicaEntry[];
  syncState: DeviceSyncState;
  conflicts: readonly string[];
}>;

export type LibraryConvergenceSnapshot = Readonly<{
  cloud: readonly LibraryReplicaEntry[];
  devices: Readonly<Record<string, ConvergenceDeviceSnapshot>>;
}>;

export type ConvergenceSyncOutcome = Readonly<{
  status: 'synced' | 'conflict' | 'offline' | 'lost-ack';
  conflicts: readonly string[];
}>;

export type LibraryConvergenceWorld = Readonly<{
  update(
    deviceId: string,
    change: (entries: readonly LibraryReplicaEntry[]) => readonly LibraryReplicaEntry[],
  ): void;
  sync(deviceId: string, options?: Readonly<{ fault?: ConvergenceFault }>): ConvergenceSyncOutcome;
  snapshot(): LibraryConvergenceSnapshot;
}>;

type MutableDevice = {
  current: LibraryReplicaEntry[];
  confirmedBase: LibraryReplicaEntry[];
  syncState: DeviceSyncState;
  conflicts: string[];
};

const cloneEntries = (entries: readonly LibraryReplicaEntry[]): LibraryReplicaEntry[] => {
  const byId = new Map<string, LibraryReplicaEntry>();
  for (const entry of entries) {
    const cloned = structuredClone(entry);
    const id = replicaEntryId(cloned);
    if (byId.has(id)) throw new Error(`Duplicate replica entry ${id}`);
    byId.set(id, cloned);
  }
  return [...byId.values()].sort((left, right) => replicaEntryId(left).localeCompare(replicaEntryId(right)));
};

/**
 * Deterministic Personal Library replica world. It owns confirmed-base tracking,
 * cloud publication, explicit conflict partitioning and transport fault timing;
 * scenarios provide only domain-valid snapshots and an explicit sync order.
 */
export function createLibraryConvergenceWorld(input: Readonly<{
  base: readonly LibraryReplicaEntry[];
  deviceIds: readonly string[];
}>): LibraryConvergenceWorld {
  if (input.deviceIds.length === 0) throw new Error('At least one replica device is required.');
  if (new Set(input.deviceIds).size !== input.deviceIds.length) throw new Error('Replica device ids must be unique.');

  let cloud = cloneEntries(input.base);
  const devices = new Map<string, MutableDevice>(input.deviceIds.map((deviceId) => [deviceId, {
    current: cloneEntries(input.base),
    confirmedBase: cloneEntries(input.base),
    syncState: 'confirmed',
    conflicts: [],
  }]));

  const device = (deviceId: string): MutableDevice => {
    const selected = devices.get(deviceId);
    if (!selected) throw new Error(`Unknown replica device ${JSON.stringify(deviceId)}`);
    return selected;
  };

  return {
    update(deviceId, change) {
      const selected = device(deviceId);
      selected.current = cloneEntries(change(cloneEntries(selected.current)));
      selected.syncState = 'dirty';
      selected.conflicts = [];
    },

    sync(deviceId, options = {}) {
      const selected = device(deviceId);
      if (options.fault === 'offline') {
        selected.syncState = 'offline';
        return { status: 'offline', conflicts: [] };
      }

      const remoteBeforePublication = cloneEntries(cloud);
      const merged = mergeLibraryReplicas({
        base: cloneEntries(selected.confirmedBase),
        local: cloneEntries(selected.current),
        remote: remoteBeforePublication,
      });

      let localEntries = merged.entries;
      let uploadEntries = merged.entries;
      let nextBase = (published: LibraryReplicaEntry[]): LibraryReplicaEntry[] => published;
      if (merged.conflicts.length > 0) {
        const partition = partitionLibraryReplicaConflicts({
          base: cloneEntries(selected.confirmedBase),
          local: cloneEntries(selected.current),
          remote: remoteBeforePublication,
          merged: merged.entries,
          conflicts: merged.conflicts,
        });
        localEntries = partition.local;
        uploadEntries = partition.upload;
        nextBase = partition.base;
      }

      selected.current = cloneEntries(localEntries);
      cloud = cloneEntries(uploadEntries);
      selected.conflicts = [...merged.conflicts];

      if (options.fault === 'lost-ack') {
        selected.confirmedBase = cloneEntries(nextBase(remoteBeforePublication));
        selected.syncState = 'unconfirmed';
        return { status: 'lost-ack', conflicts: [...merged.conflicts] };
      }

      selected.confirmedBase = cloneEntries(nextBase(cloud));
      selected.syncState = merged.conflicts.length > 0 ? 'conflict' : 'confirmed';
      return {
        status: merged.conflicts.length > 0 ? 'conflict' : 'synced',
        conflicts: [...merged.conflicts],
      };
    },

    snapshot() {
      return {
        cloud: cloneEntries(cloud),
        devices: Object.fromEntries([...devices].map(([deviceId, selected]) => [deviceId, {
          current: cloneEntries(selected.current),
          confirmedBase: cloneEntries(selected.confirmedBase),
          syncState: selected.syncState,
          conflicts: [...selected.conflicts],
        }])),
      };
    },
  };
}
