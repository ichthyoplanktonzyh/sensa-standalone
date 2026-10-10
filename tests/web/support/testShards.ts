/** Partition selected catalog files, not cases: each isolated fixture stays whole. */
// Bootstrap scheduling estimates from CI 38042467589, in seconds. Relocated
// groups use summed case durations. These are not product performance budgets.
export const browserFileWeights:Readonly<Record<string,number>>={
 'personal-meaning-journey':870,'semantic-lookup-opfs':350,'retention-review-capacity':325,
 'portable-book-capacity':320,'replica-candidate-worker':230,'web-bootstrap-budget':180,
 'account-recovery-journey':280,'reference-practice-journey':305,'learning-runtime-journey':185,
 'learning-workspace-journey':270,'package-center-journey':150,'sqlite-runtime-failure':100,
 'portable-package-journey':90,'extension-intake-journey':60,'practice-source-loading':25,
 'web-entry-hmr':20,'youglish-lifecycle':20,'skin-surface':12,'reference-presentation':12,
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
