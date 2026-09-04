import { PROTOTYPE_LEARNING_PACKAGES } from './src/content/learningCatalog';
import { LearnQueue } from './src/engine/LearnQueue';

console.log('Total runtime Senses:', PROTOTYPE_LEARNING_PACKAGES.length);

console.log('Checking LearnQueue initialization...');
const q = new LearnQueue(PROTOTYPE_LEARNING_PACKAGES, { minGap: 2 });
const s = q.getCurrentSession();
console.log('First session:', s);
