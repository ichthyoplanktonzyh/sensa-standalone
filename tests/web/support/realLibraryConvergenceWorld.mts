import type { Page } from '@playwright/test';

import type { LibraryCloudBrowserFixture } from './libraryCloudBrowserFixture.mts';

export type RealConvergenceFault = 'offline' | 'lost-ack';
export type RealConflictDecision = 'local' | 'remote';

export type RealDraftSnapshot = Readonly<{
  id: string;
  revision: number;
  text: string;
}>;

export type RealDeviceSnapshot = Readonly<{
  identity: Readonly<{
    id: string;
    deviceId: string;
  }>;
  drafts: readonly RealDraftSnapshot[];
  sync: Readonly<{
    status: string;
    conflictRecords: number;
    completeConflictRecords: boolean;
    remoteRevision: number | null;
  }>;
}>;

export type RealLibraryConvergenceWorld = Readonly<{
  add(deviceId: string, text: string): Promise<RealDraftSnapshot>;
  edit(deviceId: string, draftId: string, text: string): Promise<RealDraftSnapshot>;
  sync(deviceId: string, options?: Readonly<{ fault?: RealConvergenceFault }>): Promise<void>;
  resolve(deviceId: string, decision: RealConflictDecision): Promise<void>;
  snapshot(deviceId: string): Promise<RealDeviceSnapshot>;
  cloudRevision(): Promise<number | null>;
  close(): Promise<void>;
}>;

/** Drive observable convergence behavior through real browser and cloud interfaces. */
export async function createRealLibraryConvergenceWorld(
  fixture: LibraryCloudBrowserFixture,
  deviceIds: readonly string[],
): Promise<RealLibraryConvergenceWorld> {
  if (deviceIds.length === 0) throw new Error('At least one real replica device is required.');
  if (new Set(deviceIds).size !== deviceIds.length) throw new Error('Real replica device ids must be unique.');

  const account = await fixture.createAccount();
  const devices = new Map<string, Page>();
  for (const deviceId of deviceIds) devices.set(deviceId, await fixture.createClient(account));

  const device = (deviceId: string): Page => {
    const selected = devices.get(deviceId);
    if (!selected) throw new Error(`Unknown real replica device ${JSON.stringify(deviceId)}`);
    return selected;
  };

  let closed = false;
  return {
    add(deviceId, text) {
      return device(deviceId).evaluate(async (draftText) => {
        const core = (window as any).core;
        const saved = await core.saveDraft(crypto.randomUUID(), {
          id: crypto.randomUUID(),
          expectedRevision: 0,
          text: draftText,
        });
        return { id: saved.id, revision: saved.revision, text: saved.text };
      }, text);
    },

    edit(deviceId, draftId, text) {
      return device(deviceId).evaluate(async ({ id, draftText }) => {
        const core = (window as any).core;
        const current = (await core.listDrafts()).find((draft: any) => draft.id === id);
        if (!current) throw new Error(`Draft ${id} is missing`);
        const saved = await core.saveDraft(crypto.randomUUID(), {
          id,
          expectedRevision: current.revision,
          text: draftText,
        });
        return { id: saved.id, revision: saved.revision, text: saved.text };
      }, { id: draftId, draftText: text });
    },

    async sync(deviceId, options = {}) {
      const selected = device(deviceId);
      await selected.evaluate((fault) => {
        const browserWindow = window as any;
        browserWindow.offline = fault === 'offline';
        browserWindow.failAck = fault === 'lost-ack';
      }, options.fault);
      try {
        await selected.evaluate(() => (window as any).sync());
      } finally {
        await selected.evaluate(() => { (window as any).offline = false; });
      }
    },

    resolve(deviceId, decision) {
      return device(deviceId).evaluate(
        (selectedDecision) => (window as any).core.resolveCloudSyncConflicts(selectedDecision),
        decision,
      );
    },

    snapshot(deviceId) {
      return device(deviceId).evaluate(async () => {
        const core = (window as any).core;
        const [identity, drafts, sync] = await Promise.all([
          core.openLibrary(),
          core.listDrafts(),
          core.readCloudSync(),
        ]);
        return {
          identity: { id: identity.id, deviceId: identity.deviceId },
          drafts: drafts
            .map((draft: any) => ({ id: draft.id, revision: draft.revision, text: draft.text }))
            .sort((left: RealDraftSnapshot, right: RealDraftSnapshot) => left.id.localeCompare(right.id)),
          sync: {
            status: sync.status,
            conflictRecords: sync.conflict?.records?.length ?? 0,
            completeConflictRecords: sync.conflict?.records?.every((record: any) => (
              record.base && record.local && record.remote
            )) ?? true,
            remoteRevision: sync.conflict?.remoteRevision ?? null,
          },
        };
      });
    },

    async cloudRevision() {
      const result = await fixture.pool.query<{ revision: number | string }>(
        'SELECT revision FROM sensa_consumer.library_cloud WHERE account_id=$1',
        [account.accountId],
      );
      return result.rows[0] ? Number(result.rows[0].revision) : null;
    },

    async close() {
      if (closed) return;
      closed = true;
      await Promise.all([...devices.values()].map(async (page) => page.context().close()));
    },
  };
}
