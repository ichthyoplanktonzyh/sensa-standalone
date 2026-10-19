import {test,expect} from 'vitest';
import {webTestCatalog} from '../catalog.mts';
import {partitionTestFiles,browserFileWeights,browserQuickFileWeights} from '../support/testShards';
import {selectBrowserDepth,browserGrepInvert} from '../support/browserDepth';

test('optional browser shards cover every catalog file exactly once, preserving within-shard order',()=>{
 const files=webTestCatalog.filter(entry=>entry.suite==='browser');
 const shards=[1,2,3].map(index=>partitionTestFiles(files,`${index}/3`,entry=>browserFileWeights[entry.id]??5));
 const combined=shards.flat();
 expect(combined).toHaveLength(files.length);expect(new Set(combined).size).toBe(files.length);
 expect(new Set(combined)).toEqual(new Set(files));
 for(const shard of shards)expect(shard.map(entry=>files.indexOf(entry))).toEqual(shard.map(entry=>files.indexOf(entry)).sort((a,b)=>a-b));
 expect(partitionTestFiles(files,undefined)).toBe(files);expect(partitionTestFiles(files,'1/1')).toEqual(files);
});
test('duration-informed file scheduling balances work without splitting mutable fixture cases',()=>{
 const files=[{id:'large',weight:90},{id:'medium',weight:45},{id:'other-medium',weight:45},{id:'tiny',weight:5}];
 const shards=[1,2].map(index=>partitionTestFiles(files,`${index}/2`,file=>file.weight));
 expect(shards.map(shard=>shard.reduce((sum,file)=>sum+file.weight,0)).sort()).toEqual([90,95]);
 expect(new Set(shards.flat()).size).toBe(files.length);
 for(const weight of [0,-1,NaN,Infinity])expect(()=>partitionTestFiles(files,'1/2',()=>weight)).toThrow();
 expect(()=>partitionTestFiles(files,'1/65')).toThrow();
});
test('malformed or out-of-range shard selectors cannot silently omit tests',()=>{
 for(const selector of ['0/3','1/0','4/3','1','1/3/4','1.5/3','-1/3','99999999999999999/99999999999999999'])expect(()=>partitionTestFiles([1,2,3],selector)).toThrow();
});
test('explicit local quick/full selectors preserve their specialist boundaries',async()=>{
 const full=webTestCatalog.filter(entry=>entry.suite==='browser');
 expect(selectBrowserDepth(full,'full')).toBe(full);
 const quick=selectBrowserDepth(full,'quick');
 expect(quick.map(entry=>entry.id)).not.toContain('retention-review-capacity');
 expect(quick.map(entry=>entry.id)).not.toContain('portable-book-capacity');
 for(const id of ['personal-meaning-journey','semantic-lookup-opfs','account-recovery-journey','replica-candidate-worker'])expect(quick.map(entry=>entry.id)).toContain(id);
 expect(browserGrepInvert({})).toBeUndefined();expect(browserGrepInvert({SENSA_BROWSER_DEPTH:'full'})).toBeUndefined();
 expect(browserGrepInvert({SENSA_BROWSER_DEPTH:'quick'})?.some(pattern=>pattern.test('@capacity'))).toBe(true);
 expect(browserGrepInvert({SENSA_BROWSER_DEPTH:'full',SENSA_SKIP_BOOK_SCALE_BENCHMARK:'true'})?.some(pattern=>pattern.test('@capacity'))).toBe(false);
 expect(()=>browserGrepInvert({SENSA_BROWSER_DEPTH:'typo'})).toThrow();
 const shards=[1,2,3].map(index=>partitionTestFiles(quick,`${index}/3`,entry=>browserQuickFileWeights[entry.id]??5));
 expect(new Set(shards.flat())).toEqual(new Set(quick));expect(shards.flat()).toHaveLength(quick.length);
});
