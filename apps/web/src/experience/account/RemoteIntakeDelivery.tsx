import { useEffect, useState } from "react";
import { sensaIntakeDeliveryContractVersion } from "@sensa/contracts/sensa";

import {
  acknowledgeIntakeDelivery,
  pullIntakeDeliveries,
  registerIntakeDeliveryChannel,
} from "../../data/library/intakeDelivery";
import { openLibrary } from "../../data/library/store";
import { syncAccountLibrary } from "../../data/library/cloudSyncService";
import { localFlowText } from "../../i18n/localFlowText";
import { useJourneyGateway } from "../personalMeaningJourney";

let activeRun: Promise<void> | undefined;

/**
 * Applies remote mailbox items only after account restore has settled the local
 * library identity. A lost acknowledgement is safe: both remote delivery and
 * the local gateway replay the same operation id.
 */
export function RemoteIntakeDelivery({ online }: { online: boolean }) {
  const gateway = useJourneyGateway();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!online) return;
    let active = true;
    const run = async () => {
      if (activeRun) return activeRun;
      const work = async () => {
        await syncAccountLibrary();
        const libraryId = (await openLibrary()).id;
        await registerIntakeDeliveryChannel(libraryId);
        for (let page = 0; page < 5; page++) {
          const deliveries = await pullIntakeDeliveries(libraryId);
          if (deliveries.length === 0) break;
          for (const delivery of deliveries) {
            if (!active) return;
            const payload = delivery.submission.intake;
            const { replayed: _replayed, ...result } = await gateway.ingest(payload.operationId, payload);
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
        if (active) setFailed(false);
      };
      activeRun = work().finally(() => { activeRun = undefined; });
      return activeRun;
    };
    const attempt = () => { void run().catch(() => { if (active) setFailed(true); }); };
    attempt();
    window.addEventListener("online", attempt);
    window.addEventListener("focus", attempt);
    return () => {
      active = false;
      window.removeEventListener("online", attempt);
      window.removeEventListener("focus", attempt);
    };
  }, [gateway, online]);

  return failed ? (
    <div role="status" className="fixed bottom-20 left-4 right-4 z-50 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
      {localFlowText("remoteIntakeFailed")}
    </div>
  ) : null;
}
