import { useSyncExternalStore } from 'react';
import { buildContentProjection } from './contentProjection';
import { journeyGateway } from './personalMeaningJourney/gateway';
import { createSnapshotStore, subscribeAll } from './services/createSnapshotStore';
import { noteService } from './services/noteService';
import { personalContentService } from './services/personalContentService';
import { storageService } from './services/storageService';

/**
 * The content projection is derived from four independent services, so it is
 * rebuilt whenever any of them changes -- including the Personal Meaning
 * journey, which supplies each meaning's derived phase (a confirmed Sense, a
 * bound Expression, …) so the world view reflects it immediately.
 *
 * One store shared by every caller: the projection is rebuilt once per change
 * rather than once per mounted component.
 */
const projectionStore = createSnapshotStore(
  buildContentProjection,
  subscribeAll([
    (listener) => storageService.subscribe(listener),
    (listener) => personalContentService.subscribe(listener),
    (listener) => noteService.subscribe(listener),
    (listener) => journeyGateway.subscribe(listener),
  ]),
);

export const useContentProjection = () =>
  useSyncExternalStore(projectionStore.subscribe, projectionStore.getSnapshot);
