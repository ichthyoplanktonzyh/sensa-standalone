/** Build the ordinary Web source with its Vite environment definition, then
 * run a specialized provider-free capacity fixture generator in Node. */
import {build} from 'esbuild';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';

if(process.env.SENSA_TEST_MEMORY_LIBRARY!=='true')throw new Error('Isolated Node fixture storage must be explicitly enabled');
await mkdir(resolve('.tmp'),{recursive:true});
const directory=await mkdtemp(resolve('.tmp/retention-generator-')),entry=join(directory,'generate.mjs');
await build({entryPoints:[resolve('scripts/support/generateRetentionCapacityFacts.mts')],outfile:entry,bundle:true,packages:'external',platform:'node',format:'esm',target:'es2022',define:{'import.meta.env':'{}'},logLevel:'silent'});
const child=spawn(process.execPath,[entry,...process.argv.slice(2)],{stdio:'inherit',env:process.env});
process.exitCode=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
