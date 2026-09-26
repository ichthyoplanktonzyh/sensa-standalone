import {test} from 'vitest';
/** Model management has one provider entrance per runtime.
 *
 * This is a static, offline check: it reads source files and asserts that no surface
 * reaches a model provider around the model-management boundary. It costs nothing and
 * runs with the fast suite, so a new call site cannot quietly bypass the boundary.
 */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {modelPurposeSchema} from '../../../packages/contracts/src/sensa/modelExecution.ts';
import {modelAssignmentFeatures} from '../../../packages/contracts/src/sensa/consumer/reading.ts';

test("model-management", async () => {

const root=process.cwd();
const surfaces=['apps/web/src','apps/browser-extension/src','packages/model-runtime/src'];
const failures:string[]=[];

async function sources(directory:string):Promise<string[]>{
 const entries=await readdir(resolve(root,directory),{withFileTypes:true});
 const found:string[]=[];
 for(const entry of entries){
  const path=join(directory,entry.name);
  if(entry.isDirectory())found.push(...await sources(path));
  else if(/\.(?:ts|tsx)$/u.test(entry.name))found.push(path);
 }
 return found;
}

const files=(await Promise.all(surfaces.map(sources))).flat();
const text=new Map<string,string>(await Promise.all(files.map(async file=>[file,await readFile(resolve(root,file),'utf8')] as const)));
const where=(file:string,pattern:RegExp)=>[...(text.get(file)??'').matchAll(pattern)].length;
const lines=(file:string)=>((text.get(file)??'').split('\n'));
const check=(condition:boolean,message:string)=>{if(!condition)failures.push(message);};

// 1. A provider endpoint may be named only inside a runtime executor.
for(const file of files){
 const body=text.get(file)!;
 const runtime=file.startsWith('packages/model-runtime/');
 check(!/:generateContent|generativelanguage\.googleapis\.com/u.test(body),`${file}: names a provider generation endpoint directly`);
 check(!/chat\/completions/u.test(body)||['apps/web/src/data/library/transport.ts','apps/browser-extension/src/localModels.ts'].includes(file),`${file}: builds a provider completion URL outside a device executor`);
 check(runtime||!/from ['"](?:genkit|@genkit-ai\/compat-oai|openai)['"]/u.test(body),`${file}: imports a provider SDK outside the model runtime`);
}

// 2. One scheduler per runtime, and every submission declares where it executes.
const queues=files.filter(file=>/new ModelExecutionQueue\(/u.test(text.get(file)!));
assert.deepEqual(queues.sort(),['apps/web/src/data/library/modelExecution.ts','packages/model-runtime/src/index.ts'],'exactly one queue per runtime');
const submissions=files.flatMap(file=>lines(file).filter(line=>/Queue\.run\(\{/u.test(line)).map(line=>[file,line] as const));
check(submissions.length===3,`expected three submissions, found ${submissions.length}`);
for(const [file,line] of submissions)check(/execution:'(?:device|service)'/u.test(line),`${file}: submission does not declare an execution place`);

// 3. Reference resolution is a model-management consumer, not a provider client.
const reference=text.get('apps/web/src/experience/reference/referenceLookup.ts')!;
check(/selectedProvider\('reference'\)/u.test(reference),'reference lookup must select the reference purpose');
check(/complete\(\s*provider,\s*'reference'/u.test(reference),'reference lookup must execute through the shared completion boundary');
check(/VITE_GEMINI_API_KEY/u.test(reference)===false,'reference lookup must not read a bundled provider key');

// 4. Every assignable purpose is a contract purpose, and the reads are not purposes.
const contractPurposes=modelPurposeSchema.options as string[];
for(const purpose of modelAssignmentFeatures)check(contractPurposes.includes(purpose),`assignable purpose ${purpose} is not a contract purpose`);
const providers=text.get('apps/web/src/data/library/providers.ts')!;
const assignable=/const purposes=\[([^\]]*)\]/u.exec(providers)?.[1].replace(/['\s]/gu,'').split(',')??[];
assert.deepEqual(assignable,[...modelAssignmentFeatures],'the assignable purpose list and the contract agree');
check(assignable.includes('reference'),'the reference purpose must be assignable');
check(!assignable.includes('probe'),'probe is an internal purpose and is never assignable');

if(failures.length){for(const failure of failures)console.error(failure);throw new Error(`${failures.length} model boundary violation(s)`);}
console.log(`PASS: no provider endpoint outside runtime executors, one scheduler per queued runtime, declared execution place on all ${submissions.length} submissions, reference resolution inside the boundary, assignable purposes match the contract. ${files.length} source files read; no network.`);

});
