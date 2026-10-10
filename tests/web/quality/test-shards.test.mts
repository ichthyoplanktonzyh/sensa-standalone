import {test,expect} from 'vitest';
import {webTestCatalog} from '../catalog.mts';
import {partitionTestFiles} from '../support/testShards';
import {readFile} from 'node:fs/promises';

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
test('CI excludes the Book timing tag only after a required isolated benchmark step',async()=>{
 const workflow=await readFile('.github/workflows/sensa-consumer-check.yml','utf8');
 const config=await readFile('playwright.config.ts','utf8');
 expect(workflow).toContain('--grep @book-scale-performance --output .tmp/playwright-results/book-scale-performance');
 expect(workflow.indexOf('name: Isolated Book scale benchmark')).toBeLessThan(workflow.indexOf('name: Browser integration and OPFS durability'));
 expect(workflow).toMatch(/if: matrix.shard == 2/);expect(workflow).toContain("SENSA_SKIP_BOOK_SCALE_BENCHMARK: 'true'");
 expect(config).toMatch(/grepInvert:.*SENSA_SKIP_BOOK_SCALE_BENCHMARK.*@book-scale-performance/);
 expect(workflow).toContain('SHARD_RESULT: ${{ needs.browser-shards.result }}');
});
