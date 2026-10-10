import {test,expect} from 'vitest';
import {webTestCatalog} from '../catalog.mts';
import {partitionTestFiles} from '../support/testShards';

test('browser CI shards cover every catalog file exactly once, preserving within-shard order',()=>{
 const files=webTestCatalog.filter(entry=>entry.suite==='browser');
 const shards=[1,2,3].map(index=>partitionTestFiles(files,`${index}/3`));
 const combined=shards.flat();
 expect(combined).toHaveLength(files.length);expect(new Set(combined).size).toBe(files.length);
 expect(new Set(combined)).toEqual(new Set(files));
 for(const shard of shards)expect(shard.map(entry=>files.indexOf(entry))).toEqual(shard.map(entry=>files.indexOf(entry)).sort((a,b)=>a-b));
 expect(partitionTestFiles(files,undefined)).toBe(files);expect(partitionTestFiles(files,'1/1')).toEqual(files);
});
test('malformed or out-of-range shard selectors cannot silently omit tests',()=>{
 for(const selector of ['0/3','1/0','4/3','1','1/3/4','1.5/3','-1/3','99999999999999999/99999999999999999'])expect(()=>partitionTestFiles([1,2,3],selector)).toThrow();
});
