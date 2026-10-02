import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {test} from 'vitest';
import {workspaceSourceAliases} from '../../../apps/web/workspaceSourceAliases.ts';

test('development aliases cover exact declared workspace exports using source, not transient build output',()=>{
 const aliases=workspaceSourceAliases(resolve('.'));
 for(const directory of ['contracts','learning-kernel','content-validator']){
  const manifest=JSON.parse(readFileSync(resolve('packages',directory,'package.json'),'utf8'));
  for(const subpath of Object.keys(manifest.exports)){
   const specifier=manifest.name+(subpath==='.'?'':subpath.slice(1));
   const matches=aliases.filter(alias=>alias.find.test(specifier));
   assert.equal(matches.length,1,specifier);
   assert(matches[0]!.replacement.startsWith(resolve('packages',directory,'src')+'/'));
   assert(matches[0]!.replacement.endsWith('.ts'));
   assert.equal(matches[0]!.replacement,resolve('packages',directory,manifest.exports[subpath].replace(/^\.\/dist\//u,'src/').replace(/\.js$/u,'.ts')));
   assert(!matches[0]!.find.test(specifier+'/not-an-export'),'root aliases must not shadow unknown subpaths');
  }
 }
});

test('production builds and static previews keep published package exports',async()=>{
 const {default:factory}=await import('../../../apps/web/vite.config.ts');
 assert(typeof factory==='function');
 for(const env of [{command:'build' as const,mode:'production',isPreview:false},{command:'serve' as const,mode:'production',isPreview:true}]){
  assert.equal((await factory(env)).resolve,undefined);
 }
});
