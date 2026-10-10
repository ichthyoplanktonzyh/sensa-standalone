import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {parse} from '@babel/parser';
import {test} from 'vitest';

// Deno's own application modules must import Buffer explicitly. Typecheck and
// ordinary Node execution alone do not establish this hosted-runtime boundary.
test('API Buffer member references require an explicit node runtime import',async()=>{
 const checked:string[]=[];
 async function visitDirectory(directory:string):Promise<void>{
  for(const entry of await readdir(directory,{withFileTypes:true})){
   const path=join(directory,entry.name);
   if(entry.isDirectory()){await visitDirectory(path);continue;}
   if(!entry.isFile()||!entry.name.endsWith('.ts')||entry.name.endsWith('.d.ts'))continue;
   const ast=parse(await readFile(path,'utf8'),{sourceType:'module',plugins:['typescript']});
   let referencesBuffer=false;
   function visit(node:unknown):void{
    if(!node||typeof node!=='object')return;
    const value=node as Record<string,any>;
    if(['MemberExpression','OptionalMemberExpression'].includes(value.type)&&value.object?.type==='Identifier'&&value.object.name==='Buffer')referencesBuffer=true;
    for(const [key,child] of Object.entries(value)){
     if(['loc','start','end','extra','comments','leadingComments','trailingComments','innerComments'].includes(key))continue;
     if(Array.isArray(child))child.forEach(visit);else if(child&&typeof child==='object')visit(child);
    }
   }
   visit(ast.program);
   if(!referencesBuffer)continue;
   checked.push(path);
   const imported=ast.program.body.some(statement=>statement.type==='ImportDeclaration'
    &&statement.source.value==='node:buffer'&&statement.importKind!=='type'
    &&statement.specifiers.some(specifier=>specifier.type==='ImportSpecifier'&&specifier.importKind!=='type'
     &&specifier.local.name==='Buffer'&&specifier.imported.type==='Identifier'&&specifier.imported.name==='Buffer'));
   assert(imported,`${path}: Buffer is not a runtime global in the hosted application`);
  }
 }
 await visitDirectory('apps/api/src');
 assert(checked.includes(join('apps/api/src','sensa/library/sync.ts')));
 assert(checked.includes(join('apps/api/src','sensa/speech/edgeTts.ts')));
});
