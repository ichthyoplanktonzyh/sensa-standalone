import { useMemo, useSyncExternalStore } from 'react';
import type { SensaIntakeItem } from '@sensa/contracts/sensa';

import { semanticIntakeModule } from '../personalMeaningJourney/gateway';
import { createVersionStore } from '../services/createSnapshotStore';
import type { SemanticIntakeModule } from './semanticIntakeModule';

export const useSemanticIntake = (): SemanticIntakeModule => semanticIntakeModule;

const intakeVersionStore = createVersionStore((listener) =>
  semanticIntakeModule.subscribe(listener),
);

export const useIntakeInbox = (): SensaIntakeItem[] => {
  const version = useSyncExternalStore(
    intakeVersionStore.subscribe,
    intakeVersionStore.getSnapshot,
  );
  return useMemo(
    () => semanticIntakeModule.snapshot(),
    // The version is intentionally the invalidation token for this snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
};
