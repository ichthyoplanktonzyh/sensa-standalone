/** Exercise the actual prepared Book through the library/runtime without a browser. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {learningContentRegistrySchema,defaultSensaLanguageRoute,sensaPinnedLanguageContext,bookReleaseBundleSchema} from '@sensa/contracts/sensa';
import {openLibrary,command} from '../apps/web/src/data/library/store.ts';
import {installPackage} from '../apps/web/src/data/library/packages.ts';
import {confirmLearningQuantity,enrollPackage,startLearning,actLearning,finishLearning,readLearning} from '../apps/web/src/data/library/learning.ts';
Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});
const id=()=>crypto.randomUUID();
await openLibrary();
await command({id:id(),kind:'fixture.owner',input:{}},async tx=>{tx.put('meta','service-owner',{subject:id()});});
const registry=learningContentRegistrySchema.parse(JSON.parse(await readFile('release-candidate/catalog.json','utf8')));
const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
await confirmLearningQuantity(id(),context,20);
const fetchBefore=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Offline validation must not fetch');};
try{
 for(const descriptor of registry.items){
  const bytes=await readFile('apps/web/public'+new URL(descriptor.url).pathname);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),descriptor.sha256);
  const bundle=bookReleaseBundleSchema.parse(JSON.parse(bytes.toString()));
  assert.equal(bundle.entries.length,3);
  for(const entry of bundle.entries){
   assert.equal(entry.content.resourcePlan?.categories.length,8);
   assert.equal(entry.content.resourcePlan?.categories.find(c=>c.category==='etymology')?.preparation,'ready');
   assert(entry.content.resources.some(r=>r.materialRoleKey==='etymology'));
  }
  const pack=await installPackage(bytes,descriptor);
  const targetIds=await enrollPackage(id(),pack.key,context);
  for(const target of targetIds){
   const now=new Date().toISOString();
   let run=await startLearning(id(),target,context,20,now);
   run=await actLearning(id(),run.id,run.revision,{kind:'reveal'},now);
   run=await actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'},now);
   assert(run.completedAt);await finishLearning(id(),run.id);
   const learned=(await readLearning()).targets.find(t=>t.id===target)!;
   assert(learned.memory);const due=learned.memory.dueAt.toISOString();
   run=await startLearning(id(),target,context,20,due);
   assert.equal(run.purpose,'retention_review');
   run=await actLearning(id(),run.id,run.revision,{kind:'reveal'},due);
   run=await actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'},due);
   assert(run.completedAt);await finishLearning(id(),run.id);
  }
 }
 console.log('PASS: actual prepared 3-entry Book → digest/schema → install → enroll → reveal → completion → due review, with all network disabled. In-memory library; browser/OPFS and audible playback remain owner acceptance.');
}finally{globalThis.fetch=fetchBefore;}
