import { useMemo, useSyncExternalStore } from 'react';
import type { SensaIntakeItem } from '@sensa/contracts/sensa';

import { semanticIntakeModule } from '../personalMeaningJourney/gateway';
import { createVersionStore } from '../services/createSnapshotStore';
import type { SemanticIntakeModule } from './semanticIntakeModule';

export const useSemanticIntake = (): SemanticIntakeModule => semanticIntakeModule;

const intakeVersionStore = createVersionStore((listener) =>
  semanticIntakeModule.subscribe(listener),
);

const inactiveSubscribe=()=>()=>{};
const inactiveVersion=()=>0;
export const useIntakeInbox = (enabled=true): SensaIntakeItem[] => {
  const version = useSyncExternalStore(
    enabled?intakeVersionStore.subscribe:inactiveSubscribe,
    enabled?intakeVersionStore.getSnapshot:inactiveVersion,
  );
  return useMemo(
    () => enabled?semanticIntakeModule.snapshot():[],
    // The version is intentionally the invalidation token for this snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version,enabled],
  );
};
