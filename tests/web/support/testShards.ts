/** Partition selected catalog files, not cases: each isolated fixture stays whole. */
// CI 38063623362 native blob wall intervals, including hooks and fixture setup.
// These are scheduling estimates, not product performance budgets. Skin uses
// the prior healthy estimate rather than preserving a 180s harness timeout.
export const browserFileWeights:Readonly<Record<string,number>>={
 'personal-meaning-journey':735,'semantic-lookup-opfs':309,'retention-review-capacity':393,
 'portable-book-capacity':313,'replica-candidate-worker':252,'web-bootstrap-budget':167,
 'account-recovery-journey':252,'reference-practice-journey':264,'learning-runtime-journey':149,
 'learning-workspace-journey':390,'package-center-journey':126,'sqlite-runtime-failure':99,
 'portable-package-journey':75,'extension-intake-journey':46,'practice-source-loading':16,
 'web-entry-hmr':8,'youglish-lifecycle':12,'skin-surface':12,'reference-presentation':9,
};

// Same sampled run minus wall intervals of now-tagged capacity cases. The new
// build cache and CI quick lane still need their own actual timing samples.
export const browserQuickFileWeights:Readonly<Record<string,number>>={
 ...browserFileWeights,
 'personal-meaning-journey':219,'semantic-lookup-opfs':81,'replica-candidate-worker':34,
 'account-recovery-journey':170,'reference-practice-journey':90,'learning-workspace-journey':206,
};

export function partitionTestFiles<T>(files:readonly T[],selector:string|undefined,weight?:(file:T)=>number):readonly T[]{
 if(selector===undefined)return files;
 const match=/^([1-9]\d*)\/([1-9]\d*)$/u.exec(selector);
 if(!match)throw new Error(`Invalid test shard ${JSON.stringify(selector)}; expected index/total.`);
 const index=Number(match[1]),total=Number(match[2]);
 if(!Number.isSafeInteger(index)||!Number.isSafeInteger(total)||index>total||total>64)throw new Error('Test shard index must be within 1..total, with at most 64 shards.');
 if(weight){
  const ranked=files.map((file,offset)=>({offset,weight:weight(file)}));
  if(ranked.some(entry=>!Number.isFinite(entry.weight)||entry.weight<=0))throw Error('Shard weights must be finite and positive');
  const shards=Array.from({length:total},()=>({load:0,members:new Set<number>()}));
  for(const entry of ranked.sort((a,b)=>b.weight-a.weight||a.offset-b.offset)){
   const shard=shards.reduce((smallest,value)=>value.load<smallest.load?value:smallest);
   shard.members.add(entry.offset);shard.load+=entry.weight;
  }
  return files.filter((_,offset)=>shards[index-1]!.members.has(offset));
 }
 return files.filter((_,offset)=>offset%total===index-1);
}
