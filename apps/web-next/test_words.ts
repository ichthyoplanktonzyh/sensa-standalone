import { WORDS } from './src/data';
import { LearnQueue } from './src/engine/LearnQueue';

console.log('Total words:', WORDS.length);

WORDS.forEach((w, i) => {
  if (!w.w) console.error(`Word ${i} missing w`);
  if (!w.syl) console.error(`Word ${i} (${w.w}) missing syl`);
  if (!w.ph) console.error(`Word ${i} (${w.w}) missing ph`);
  if (!w.senses || !w.senses.length) console.error(`Word ${i} (${w.w}) missing senses`);
  if (!w.options || !w.options.length) console.error(`Word ${i} (${w.w}) missing options`);
  if (!w.sentences || !w.sentences.length) console.error(`Word ${i} (${w.w}) missing sentences`);
  if (!w.mnemo) console.error(`Word ${i} (${w.w}) missing mnemo`);
  if (!w.def) console.error(`Word ${i} (${w.w}) missing def`);
});

console.log('Checking LearnQueue initialization...');
const q = new LearnQueue(WORDS.slice(0, 5), { groupSize: 5, minGap: 2 });
const s = q.getCurrentSession();
console.log('First session:', s);
