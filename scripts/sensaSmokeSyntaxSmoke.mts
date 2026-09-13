/** Every check in this repository still parses.
 *
 * The checks that need a browser, a database, an edge runtime or a release
 * candidate are run by hand, so one that no longer parses is invisible to CI
 * until somebody runs it — which is how a broken one was committed and stayed
 * broken. Transpiling each file costs milliseconds and catches the whole class
 * of defect, including the strings that end early and the braces that do not
 * close, which are exactly the mistakes hand-edited single-line checks make.
 *
 * This proves the files can be read, not that they assert anything: a check that
 * runs is still the only evidence it covers its boundary.
 */
import {readdir,readFile} from 'node:fs/promises';
import {transform} from 'esbuild';

const files:string[]=[];
async function walk(directory:string){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=`${directory}/${entry.name}`;
    if(entry.isDirectory()){if(entry.name!=='node_modules')await walk(path);}
    else if(/\.(?:mts|ts|mjs|js)$/u.test(entry.name))files.push(path);
  }
}
await walk('scripts');
let checked=0;
for(const file of files.sort()){
  const loader=file.endsWith('.mjs')||file.endsWith('.js')?'js':'ts';
  try{
    await transform(await readFile(file,'utf8'),{loader,format:'esm',target:'es2022'});
  }catch(error){
    const detail=error instanceof Error?error.message.split('\n')[0]:String(error);
    throw new Error(`${file} does not parse: ${detail}`);
  }
  checked++;
}
console.log(`PASS: all ${checked} checks under scripts/ still parse, including the ones CI never runs because they need a browser, a database, an edge runtime or a release candidate. Transpiled, not executed, and no network.`);
