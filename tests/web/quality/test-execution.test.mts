import {test, expect} from 'vitest';
import {webTestCatalog, type WebTestCatalogEntry} from '../catalog.mts';
import {executionGroups, reportCoversSelection} from '../support/executionGroups';
import {readFile, mkdir, mkdtemp, writeFile, rm, stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve, join} from 'node:path';

test('every catalog entry names an existing test file across all CI boundaries', async () => {
  const missing = (await Promise.all(webTestCatalog.map(async ({id, file}) => {
    try { if ((await stat(resolve(file))).isFile()) return null; } catch {}
    return {id, file};
  }))).filter(entry => entry !== null);
  expect(missing).toEqual([]);
});

test('native batching preserves every catalog file once and separates memory/provider environments', () => {
  const selected = webTestCatalog.filter(entry => ['fast', 'foundation'].includes(entry.suite));
  const groups = executionGroups(selected);
  const combined = groups.flatMap(group => group.entries);
  expect(combined).toHaveLength(selected.length); expect(new Set(combined)).toEqual(new Set(selected));
  expect(groups.length).toBeLessThan(10);
  for (const group of groups) {
    expect(new Set(group.entries.map(entry => entry.environment)).size).toBe(1);
    expect(new Set(group.entries.map(entry => entry.runner)).size).toBe(1);
    expect(new Set(group.entries.map(entry => !!entry.memoryLibrary)).size).toBe(1);
  }
  const base = selected[0]!;
  expect(executionGroups([{...base, env: {B:'2', A:'1'}}, {...base, id:'other', env:{A:'1', B:'2'}}] as WebTestCatalogEntry[])).toHaveLength(1);
  expect(executionGroups([{...base, env: {GENKIT_ENV:'prod'}}, {...base, id:'other'}] as WebTestCatalogEntry[])).toHaveLength(2);
});

test('native report coverage rejects missing, extra or unidentified selected files despite a zero runner exit',()=>{
 const entry=webTestCatalog[0]!,root=process.cwd();
 expect(reportCoversSelection({testResults:[{name:resolve(entry.file)}]},'vitest',[entry],root)).toBe(true);
 expect(reportCoversSelection({testResults:[]},'vitest',[entry],root)).toBe(false);
 expect(reportCoversSelection({testResults:[{name:resolve(entry.file)},{name:resolve('unselected.test.mjs')}]},'vitest',[entry],root)).toBe(false);
 expect(reportCoversSelection({config:{rootDir:root},suites:[{file:entry.file,suites:[{file:entry.file}]}]},'playwright',[entry],root)).toBe(true);
 expect(reportCoversSelection({suites:[{}]},'playwright',[entry],root)).toBe(false);
});

test('Vitest batch runs keep globals isolated even with one worker, and failed assertions remain failures', async () => {
  await mkdir(resolve('.tmp'), {recursive:true});
  const directory = await mkdtemp(resolve('.tmp/runner-isolation-'));
  try {
    await writeFile(join(directory, 'vitest.config.mjs'), `export default {test:{root:${JSON.stringify(directory)},include:['*.test.mjs'],isolate:true,maxWorkers:1}};\n`);
    await writeFile(join(directory, 'a.test.mjs'), "import {test,expect} from 'vitest';test('isolated a',()=>{globalThis.__sensaRunnerSentinel='fixture';expect(globalThis.__sensaRunnerSentinel).toBe('fixture')});\n");
    await writeFile(join(directory, 'b.test.mjs'), "import {test,expect} from 'vitest';test('isolated b',()=>expect(globalThis.__sensaRunnerSentinel).toBeUndefined());\n");
    const execute = () => execFileSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', '--config', join(directory, 'vitest.config.mjs')], {cwd:process.cwd(),stdio:'pipe'});
    expect(execute().toString()).toContain('2 passed');
    await writeFile(join(directory, 'b.test.mjs'), "import {test,expect} from 'vitest';test('real failure',()=>expect(1).toBe(2));\n");
    expect(execute).toThrow();
  } finally { await rm(directory, {recursive:true, force:true}); }
});

test('browser fixture groups have standalone literal registrations and independent fixture paths', async () => {
  const {parse} = await import('@babel/parser');
  const files = ['package-center-journey','account-recovery-journey','reference-practice-journey','learning-runtime-journey','learning-workspace-journey'];
  const labels:string[]=[];
  const walk=(node:unknown)=>{
    if(!node||typeof node!=='object')return;
    const value=node as {type?:string;callee?:{type?:string;name?:string};arguments?:{type?:string;value?:string}[]};
    if(value.type==='CallExpression'&&value.callee?.type==='Identifier'&&value.callee.name==='test'&&value.arguments?.[0]?.type==='StringLiteral')labels.push(value.arguments[0].value!);
    for(const child of Object.values(node))if(Array.isArray(child))child.forEach(walk);else if(child&&typeof child==='object')walk(child);
  };
  for(const id of files){
    const entry=webTestCatalog.find(test=>test.id===id)!;expect(entry.runner).toBe('playwright');
    const source=await readFile(entry.file,'utf8');walk(parse(source,{sourceType:'module',plugins:['typescript']}));
    expect(source).toContain('createPackageCenterFixture(');
  }
  expect(labels.length).toBeGreaterThan(0);expect(new Set(labels).size).toBe(labels.length);
  const fixture=await readFile('tests/web/browser/packageCenterFixture.ts','utf8');
  expect(fixture).toContain("resolve(root,'.tmp/package-center-journey',group)");
  expect(fixture).not.toContain('fullyParallel');
});
