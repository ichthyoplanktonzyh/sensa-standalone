import {test,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {ciWhitelist,ciCaseCounts,selectCiTests} from '../ciWhitelist.mts';
import {webTestCatalog} from '../catalog.mts';

const list=(...args:string[])=>execFileSync(process.execPath,['--import','tsx','tests/web/run.mts',...args,'--list'],{encoding:'utf8',stdio:'pipe'});
test('fixed CI selection is complete, bounded and unaffected by new catalog files',()=>{
 const approved={
  node:['canonical-digest','stored-record-codec','library-sync-blocks','consumer-auth-proof','email-link-boundary','operation-settlement','refresh-coordinator','version-store','learning-target-view','package-cache-projection','portable-lightweight-package','learning-authority','learning-command-receipt','candidate-source','release-preflight','api-release-identity','release-archive'],
  postgres:['library-membership-migration','account-admission','operations-access-postgres','database-budget','account-deletion','model-request-state','intake-delivery'],
  e2e:['ci-core-e2e'],
 };
 expect(ciWhitelist).toEqual(approved);
 for(const lane of ['node','postgres','e2e'] as const)for(const entry of selectCiTests(webTestCatalog,lane)){
  expect(entry.runner).toBe(lane==='e2e'?'playwright':'vitest');
  expect(entry.environment).toBe(lane==='e2e'?'browser-postgres':lane==='postgres'?'postgres':'node');
 }
 expect(Object.values(ciWhitelist).map(ids=>ids.length)).toEqual([17,7,1]);
 expect(ciCaseCounts).toEqual({node:85,postgres:7,e2e:4,all:96});
 const fixed=selectCiTests(webTestCatalog,'all');
 expect(new Set(fixed).size).toBe(25);
 expect(selectCiTests([...webTestCatalog,{...webTestCatalog[0]!,id:'unknown-runtime-test',file:'unknown.test.mts'}],'all')).toEqual(fixed);
 expect(()=>selectCiTests(webTestCatalog.filter(entry=>entry.id!=='canonical-digest'),'all')).toThrow('Missing fixed CI test');
 for(const lane of ['node','postgres','e2e','all'] as const){
  const ids=list('--ci='+lane).trim().split('\n').map(line=>line.split(' | ')[0]);
  expect(ids).toEqual(selectCiTests(webTestCatalog,lane).map(entry=>entry.id));
 }
 expect(()=>list('--ci=typo')).toThrow();
 for(const selector of ['--suite=fast','--depth=quick','--shard=1/2','--id=canonical-digest'])expect(()=>list('--ci=node',selector)).toThrow();
});

test('PR and main require the same small gate and retain immutable candidate identity',async()=>{
 const workflow=await readFile('.github/workflows/sensa-consumer-check.yml','utf8');
 for(const command of ['npm run typecheck','npm run build','npm run test:edge','npm test','npm run test:ci:postgres','npm run test:ci:e2e'])expect(workflow).toContain('run: '+command);
 for(const obsolete of ['database-selection','browser-shards','storage-capacity:','ciScope','--depth=','continue-on-error:'])expect(workflow).not.toContain(obsolete);
 expect(workflow).toContain('name: Static, build and fast smoke');
 expect(workflow).toContain('name: Preserve the tested main release candidate');
 expect(workflow).toContain('sensa-production-${{ github.sha }}-attempt-${{ github.run_attempt }}');
 const scripts=JSON.parse(await readFile('package.json','utf8')).scripts;
 expect(await readFile('playwright.config.ts','utf8')).toContain('retries: 0');
 expect(scripts.test).toBe('npm run test:ci:node');
 expect(scripts.check).toBe('npm run typecheck && npm run build && npm test');
 for(const lane of ['node','postgres','e2e'])expect(scripts['test:ci:'+lane]).toBe('node --import tsx tests/web/run.mts --ci='+lane);
});

test('four smoke cases own a minimal fixture and keep long specialists executable',async()=>{
 const source=await readFile('tests/web/database/ci-core.spec.ts','utf8');
 const {parse}=await import('@babel/parser');let cases=0;
 const walk=(node:unknown)=>{
  if(!node||typeof node!=='object')return;
  const value=node as {type?:string;callee?:{type?:string;name?:string};arguments?:{type?:string}[]};
  if(value.type==='CallExpression'&&value.callee?.type==='Identifier'&&value.callee.name==='test'&&value.arguments?.[0]?.type==='StringLiteral')cases++;
  for(const child of Object.values(node))if(Array.isArray(child))child.forEach(walk);else if(child&&typeof child==='object')walk(child);
 };
 walk(parse(source,{sourceType:'module',plugins:['typescript']}));expect(cases).toBe(4);
 expect(source).toContain('singleBook:true');expect(source).not.toContain('createPackageCenterFixture');
 expect(source).not.toMatch(/from ['"].*\.spec/);
 for(const id of ['personal-meaning-journey','package-center-journey','auth-expiry-reconnect','library-sync-page','storage-scale','retention-review-capacity'])expect(webTestCatalog.some(entry=>entry.id===id)).toBe(true);
 const capacity=await readFile('.github/workflows/sensa-storage-capacity.yml','utf8');
 expect(capacity).toContain('workflow_dispatch:');expect(capacity).toContain('npm run test:capacity:storage');expect(capacity).not.toContain('continue-on-error:');
});
