import { useCallback, useEffect, useState } from 'react';
import { buildContentProjection } from './contentProjection';
import { journeyGateway } from './personalMeaningJourney/gateway';
import { noteService } from './services/noteService';
import { personalContentService } from './services/personalContentService';
import { storageService } from './services/storageService';

export const useContentProjection = () => {
  const [projection, setProjection] = useState(buildContentProjection);
  const refresh = useCallback(() => setProjection(buildContentProjection()), []);

  useEffect(() => {
    const unsubscribeStorage = storageService.subscribe(refresh);
    const unsubscribePersonal = personalContentService.subscribe(refresh);
    const unsubscribeNotes = noteService.subscribe(refresh);
    // The Personal Meaning journey derives each meaning's phase; re-project when
    // its facts change (a confirmed Sense, a bound Expression, …) so the world
    // view reflects the derived phase immediately.
    const unsubscribeJourney = journeyGateway.subscribe(refresh);
    refresh();
    return () => {
      unsubscribeStorage();
      unsubscribePersonal();
      unsubscribeNotes();
      unsubscribeJourney();
    };
  }, [refresh]);

  return projection;
};
