import {test,expect} from 'vitest';
import {webTestCatalog} from '../catalog.mts';
import {partitionTestFiles,browserFileWeights} from '../support/testShards';
import {readFile} from 'node:fs/promises';

test('browser CI shards cover every catalog file exactly once, preserving within-shard order',()=>{
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
test('CI preserves advisory Book scale evidence without skipping required functional shards',async()=>{
 const workflow=await readFile('.github/workflows/sensa-consumer-check.yml','utf8');
 const config=await readFile('playwright.config.ts','utf8');
 expect(workflow).toContain('--grep @book-scale-performance --output .tmp/playwright-book-scale-performance');
 expect(workflow.indexOf('name: Isolated Book scale benchmark')).toBeLessThan(workflow.indexOf('name: Browser integration and OPFS durability'));
 const benchmarkStep=workflow.slice(workflow.indexOf('name: Isolated Book scale benchmark'),workflow.indexOf('name: Preserve advisory Book scale evidence'));
 expect(benchmarkStep).toContain('continue-on-error: true');
 expect(workflow).toContain("if: ${{ always() && matrix.shard == 2 }}");
 expect(workflow).toContain('path: .tmp/playwright-book-scale-performance/');
 expect(workflow).toContain("steps.book-scale-performance.outcome == 'failure'");
 const functionalStep=workflow.slice(workflow.indexOf('name: Browser integration and OPFS durability'),workflow.indexOf('name: Upload synthetic Playwright Test failure evidence'));
 expect(functionalStep).not.toContain('continue-on-error');
 expect(functionalStep).toContain('npm run test:browser -- --shard=${{ matrix.shard }}/3');
 expect(workflow).toMatch(/if: matrix.shard == 2/);expect(workflow).toContain("SENSA_SKIP_BOOK_SCALE_BENCHMARK: 'true'");
 expect(config).toMatch(/grepInvert:.*SENSA_SKIP_BOOK_SCALE_BENCHMARK.*@book-scale-performance/);
 expect(workflow).toContain('SHARD_RESULT: ${{ needs.browser-shards.result }}');
 expect(workflow).toContain('run: test "$SHARD_RESULT" = success');
});
