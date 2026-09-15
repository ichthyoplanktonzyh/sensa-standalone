import {
  sensaLocalAgentIntakeVersion,
} from '@sensa/contracts/sensa';
import { useEffect, useState } from 'react';

import { openLibrary } from '../../data/library/store';
import { localFlowText } from '../../i18n/localFlowText';
import { useJourneyGateway } from '../personalMeaningJourney';
import { localAgentBridge } from './localAgentBridge';

/**
 * Drains the local CLI queue when this Web library opens or regains focus.
 * Absence of the optional extension/native host is a normal no-op.
 */
export function LocalAgentIntake() {
  const gateway = useJourneyGateway();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const receive = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        const libraryId = (await openLibrary()).id;
        for (;;) {
          const deliveries = await localAgentBridge(
            'web-native-intake-pull',
            libraryId,
            controller.signal,
            {},
          );
          for (const delivery of deliveries) {
            if (controller.signal.aborted) return;
            const { replayed: _replayed, ...result } = await gateway.ingest(
              delivery.intake.operationId,
              delivery.intake,
            );
            await localAgentBridge(
              'web-native-intake-ack',
              libraryId,
              controller.signal,
              {
                receipt: {
                  contractVersion: sensaLocalAgentIntakeVersion,
                  libraryId,
                  clientId: delivery.client.clientId,
                  operationId: delivery.intake.operationId,
                  requestDigest: delivery.requestDigest,
                  result,
                  appliedAt: new Date().toISOString(),
                },
              },
            );
          }
          if (deliveries.length < 10) break;
        }
        setFailed(false);
      } catch (error) {
        if (
          !controller.signal.aborted
          && !(error instanceof Error && [
            'extension_unavailable',
            'native_host_unavailable',
            'interrupted',
          ].includes(error.message))
        ) setFailed(true);
      } finally {
        running = false;
      }
    };
    const visible = () => { if (document.visibilityState === 'visible') void receive(); };
    void receive();
    window.addEventListener('focus', receive);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      window.removeEventListener('focus', receive);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [gateway]);

  return failed ? (
    <div role="status" className="fixed bottom-20 left-4 right-4 z-50 rounded-control border border-feedback-warning bg-accent-soft p-3 text-sm text-feedback-warning">
      {localFlowText('intakeStorageFailed')}
    </div>
  ) : null;
}
