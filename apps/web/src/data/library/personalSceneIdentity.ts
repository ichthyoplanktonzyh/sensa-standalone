/** One newly admitted World owner per private Scene across devices. Existing
 * stored owners take precedence; this never rewrites learner identities. */
import {stableUuid} from '@sensa/learning-kernel';

export const learningScenePersonalMeaningId=(sceneId:string)=>stableUuid(`sensa:personal-learning-scene-meaning:v1:${sceneId}`);

/** The first Scene acceptance has one reusable Context across devices. A later
 * explicit reintroduction after replacing its composition keeps the retired
 * association and introduces a new Context at the end. */
export const learningSceneContextId=(sceneId:string)=>stableUuid(`sensa:personal-learning-scene-context:v1:${sceneId}`);
