import { stableUuid } from '@sensa/learning-kernel';

export const learningSceneSemanticOperationIds = (sceneRevisionId: string) => ({
  accept: stableUuid(`learning-scene-semantic-acceptance:${sceneRevisionId}`),
  link: stableUuid(`learning-scene-semantic-link:${sceneRevisionId}`),
});
