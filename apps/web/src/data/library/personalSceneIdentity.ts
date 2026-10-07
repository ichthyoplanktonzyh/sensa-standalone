/** One newly admitted World owner per private Scene across devices. Existing
 * stored owners take precedence; this never rewrites learner identities. */
import {stableUuid} from '@sensa/learning-kernel';

export const learningScenePersonalMeaningId=(sceneId:string)=>stableUuid(`sensa:personal-learning-scene-meaning:v1:${sceneId}`);
