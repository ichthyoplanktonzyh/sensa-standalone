import type {WebTestCatalogEntry} from '../catalog.mts';
import {resolve} from 'node:path';

/** Native runners batch files only when their execution boundary and env match. */
export function executionGroups(entries: readonly WebTestCatalogEntry[]) {
  const groups = new Map<string, {runner: WebTestCatalogEntry['runner']; environment: WebTestCatalogEntry['environment']; env: Record<string,string>; entries: WebTestCatalogEntry[]}>();
  for (const entry of entries) {
    const env = {...(entry.memoryLibrary ? {SENSA_TEST_MEMORY_LIBRARY: 'true'} : {}), ...entry.env};
    const sorted = Object.fromEntries(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
    const key = JSON.stringify([entry.runner, entry.environment, sorted]);
    const group = groups.get(key) ?? {runner: entry.runner, environment: entry.environment, env: sorted, entries: []};
    group.entries.push(entry); groups.set(key, group);
  }
  return [...groups.values()];
}

/** Native reports must identify exactly the selected files, not merely exit zero. */
export function reportCoversSelection(report:unknown, runner:WebTestCatalogEntry['runner'], entries:readonly WebTestCatalogEntry[], root:string) {
  if(!report||typeof report!=='object')return false;
  const value=report as {testResults?:{name?:string}[];config?:{rootDir?:string};suites?:unknown[]};
  const actual=new Set<string>();
  if(runner==='vitest')for(const file of value.testResults??[]){if(typeof file.name==='string')actual.add(resolve(root,file.name));}
  else {
    const visit=(item:unknown)=>{
      if(!item||typeof item!=='object')return;
      const suite=item as {file?:string;suites?:unknown[]};
      if(typeof suite.file==='string')actual.add(resolve(value.config?.rootDir??root,suite.file));
      suite.suites?.forEach(visit);
    };
    value.suites?.forEach(visit);
  }
  const expected=new Set(entries.map(entry=>resolve(root,entry.file)));
  return actual.size===expected.size&&[...expected].every(file=>actual.has(file));
}
