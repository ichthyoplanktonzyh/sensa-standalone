import {test,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {databaseDepthForChanges} from '../../../scripts/ciScope.mts';
import {webTestCatalog} from '../catalog.mts';

test('only documentation and explicitly listed presentation changes narrow PR database checks',()=>{
 for(const paths of [
  ['docs/sensa/engineering.md'],['README.md','CONTEXT.md'],
  ['apps/web/src/experience/ui/SensaComponents.tsx'],
  ['apps/web/src/experience/styles/world.css','docs/sensa/user-journeys.md'],
 ])expect(databaseDepthForChanges('pull_request',paths).depth).toBe('core');
 for(const path of [
  'apps/web/src/data/library/cloudSync.ts','apps/web/src/account/AccountContext.tsx',
  'apps/web/src/experience/ui/WebShell.tsx','apps/web/src/App.tsx',
  'apps/api/src/app.ts','packages/contracts/src/sensa/index.ts',
  'packages/learning-kernel/src/index.ts','db/migrations/0053_example.sql',
  'package.json','package-lock.json','.github/workflows/sensa-consumer-check.yml',
  'scripts/ciScope.mts','tests/web/catalog.mts','unknown/new-runtime.ts','AGENTS.md',
  'docs/../apps/api/src/app.ts','docs/unsafe\npath.md',
 ])expect(databaseDepthForChanges('pull_request',['docs/sensa/engineering.md',path]).depth).toBe('full');
 for(const paths of [[],null])expect(databaseDepthForChanges('pull_request',paths).depth).toBe('full');
 for(const event of ['push','workflow_dispatch','schedule','unexpected'])expect(databaseDepthForChanges(event,['README.md']).depth).toBe('full');
});

test('PR event or Git lookup failure emits full rather than silently skipping integration',async()=>{
 await mkdir('.tmp',{recursive:true});const directory=await mkdtemp(resolve('.tmp/ci-selection-'));
 try{
  const event=join(directory,'event.json'),output=join(directory,'outputs');
  for(const payload of ['invalid JSON',JSON.stringify({pull_request:{base:{sha:'a'.repeat(40)}}})]){
   await writeFile(event,payload);await writeFile(output,'');
   execFileSync(process.execPath,['--experimental-strip-types','scripts/ciScope.mts'],{
    env:{...process.env,GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:event,GITHUB_SHA:'invalid',GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:''},stdio:'pipe',
   });
   expect(await readFile(output,'utf8')).toBe('database_depth=full\n');
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});

const list=(...args:string[])=>execFileSync(process.execPath,['--import','tsx','tests/web/run.mts',...args,'--list'],{encoding:'utf8',stdio:'pipe'});
test('core database selection retains real persistence, lost ACK, migration and every cheap PostgreSQL boundary',()=>{
 const full=webTestCatalog.filter(entry=>entry.suite==='database');
 const core=full.filter(entry=>entry.databaseDepth==='core');
 const expected=['account-admission','operations-access-postgres','library-membership-migration','database-budget','account-deletion','model-request-state','intake-delivery','library-sync-page','library-cursor'];
 expect(core.map(entry=>entry.id).sort()).toEqual(expected.sort());
 const ids=list('--suite=database','--db-depth=core').trim().split('\n').map(line=>line.split(' | ')[0]);
 expect(ids.sort()).toEqual(expected.sort());
 expect(list('--suite=database').trim().split('\n')).toHaveLength(full.length);
 expect(()=>list('--suite=fast','--db-depth=core')).toThrow();
 expect(()=>list('--suite=database','--db-depth=typo')).toThrow();
});

test('10k storage assertions have a separate executable capacity boundary and stay out of fast',async()=>{
 expect(list('--suite=fast')).not.toContain('storage-scale |');
 expect(list('--suite=capacity').trim().split('\n')).toHaveLength(1);
 expect(list('--suite=capacity')).toContain('storage-scale |');
 const workflow=await readFile('.github/workflows/sensa-storage-capacity.yml','utf8');
 expect(workflow).toContain('workflow_call:');expect(workflow).toContain('workflow_dispatch:');
 expect(workflow).toContain('npm run test:capacity:storage');expect(workflow).toContain('if: always()');
 expect(workflow).not.toContain('continue-on-error:');
 const ci=await readFile('.github/workflows/sensa-consumer-check.yml','utf8');
 expect(ci).toContain('if: github.event_name == \'push\'');
 expect(ci).toContain('uses: ./.github/workflows/sensa-storage-capacity.yml');
 expect(ci).toContain('needs: database-selection');
 expect(ci).toContain('npm run test:db -- --db-depth="$SENSA_DATABASE_DEPTH"');
 expect(ci).toContain('Missing database selection; refusing to skip tests.');
});
