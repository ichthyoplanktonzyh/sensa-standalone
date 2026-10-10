import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

/** A dev server must not consume transient output from a concurrent package build. */
export function workspaceSourceAliases(repositoryRoot:string){
  return ['contracts','learning-kernel','content-validator'].flatMap(directory=>{
    const root=join(repositoryRoot,'packages',directory);
    const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8')) as {name:string;exports:Record<string,unknown>};
    return Object.entries(manifest.exports).map(([subpath,target])=>{
      if(typeof target!=='string'||!target.startsWith('./dist/')||!target.endsWith('.js')){
        throw new Error(`Unsupported workspace development export: ${manifest.name}/${subpath}`);
      }
      const specifier=manifest.name+(subpath==='.'?'':subpath.slice(1));
      if(!/^@sensa\/[a-z0-9/-]+$/u.test(specifier))throw new Error(`Invalid workspace export: ${specifier}`);
      const replacement=join(root,'src',target.slice('./dist/'.length,-'.js'.length)+'.ts');
      if(!existsSync(replacement))throw new Error(`Workspace source missing: ${specifier}`);
      return {find:new RegExp(`^${specifier}$`,'u'),replacement};
    });
  });
}
