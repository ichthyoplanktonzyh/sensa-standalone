import { useEffect } from "react";
import { sensaIntakeDeliveryContractVersion } from "@sensa/contracts/sensa";

import {
  acknowledgeIntakeDelivery,
  pullIntakeDeliveries,
  registerIntakeDeliveryChannel,
} from "../../data/library/intakeDelivery";
import { readCloudSync } from "../../data/library/cloudSync";
import { observeCloudSyncState, openLibrary } from "../../data/library/store";
import { useSemanticIntake } from "../intake";
import { createRefreshCoordinator } from "../library/refreshCoordinator";

/**
 * Applies remote mailbox items only after account restore has settled the local
 * library identity. A lost acknowledgement is safe: both remote delivery and
 * the local gateway replay the same operation id.
 */
export function RemoteIntakeDelivery({ online }: { online: boolean }) {
  const intake = useSemanticIntake();

  useEffect(() => {
    if (!online) return;
    let active = true;
    const coordinator = createRefreshCoordinator(async () => {
        if (!active) return;
        // The mailbox never starts a full-library transfer. Wait until the account
        // adapter has settled which library identity this browser owns.
        const sync = await readCloudSync();
        if (!sync?.revision || !["synced", "pending"].includes(sync.status)) return;
        const libraryId = (await openLibrary()).id;
        await registerIntakeDeliveryChannel(libraryId);
        for (let page = 0; page < 5; page++) {
          const deliveries = await pullIntakeDeliveries(libraryId);
          if (deliveries.length === 0) break;
          for (const delivery of deliveries) {
            if (!active) return;
            const payload = delivery.submission.intake;
            const { replayed: _replayed, ...result } = await intake.submit(payload);
            await acknowledgeIntakeDelivery({
              contractVersion: sensaIntakeDeliveryContractVersion,
              libraryId,
              deliveryId: delivery.deliveryId,
              result,
              appliedAt: new Date().toISOString(),
            });
          }
          if (deliveries.length < 20) break;
        }
    });
    const attempt = () => { void coordinator.request().catch(() => {}); };
    const visible = () => { if (document.visibilityState === "visible") attempt(); };
    attempt();
    const stop = observeCloudSyncState(attempt);
    window.addEventListener("online", attempt);
    window.addEventListener("focus", attempt);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      stop();
      window.removeEventListener("online", attempt);
      window.removeEventListener("focus", attempt);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [intake, online]);

  return null;
}
