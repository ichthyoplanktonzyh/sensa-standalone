/** Partition selected catalog files, not cases: each isolated fixture stays whole. */
export function partitionTestFiles<T>(files:readonly T[],selector:string|undefined):readonly T[]{
 if(selector===undefined)return files;
 const match=/^([1-9]\d*)\/([1-9]\d*)$/u.exec(selector);
 if(!match)throw new Error(`Invalid test shard ${JSON.stringify(selector)}; expected index/total.`);
 const index=Number(match[1]),total=Number(match[2]);
 if(!Number.isSafeInteger(index)||!Number.isSafeInteger(total)||index>total)throw new Error('Test shard index must be within 1..total.');
 return files.filter((_,offset)=>offset%total===index-1);
}
