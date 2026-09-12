import {LearningRuntimeCoordinator} from '../apps/web/src/experience/learningRuntime/runtimeCoordinator.ts';
import {LearningPolicyProfileRegistry,learningPolicyProfileRegistry} from '../apps/web/src/experience/learningRuntime/policyProfiles.ts';
import {RuntimeSurfaceRegistry} from '../apps/web/src/experience/learningRuntime/runtimeSurfaces.ts';
import {assembleLightweightInitialPresentation} from '../apps/web/src/experience/learningRuntime/lightweightInitialPresentation.ts';
import {LIGHTWEIGHT_EXPERIENCE_RECALL_STEP,LIGHTWEIGHT_EXPRESSION_REVEAL_STEP} from '../apps/web/src/experience/learningRuntime/lightweightInitialProtocol.ts';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {canonicalJsonDigest} from '@sensa/learning-kernel';
import {provisionLightweightInitialContent} from '../apps/web/src/experience/learningRuntime/lightweightInitialContent.ts';
import {libraryDatabaseName,openLibrary,command,readLibrary,LibraryTransaction} from '../apps/web/src/data/library/store.ts';
import {installPackage,downloadPackage,sha256} from '../apps/web/src/data/library/packages.ts';
import {enrollPackage,readLearning,startLearning,actLearning,finishLearning,confirmLearningQuantity} from '../apps/web/src/data/library/learning.ts';
Object.assign(globalThis,{indexedDB,window:new EventTarget(),BroadcastChannel:undefined});
// Upgrade the previous library in place without replacing owner drafts.
await new Promise<void>((resolve,reject)=>{const r=indexedDB.open(libraryDatabaseName,1);r.onupgradeneeded=()=>{for(const name of ['meta','drafts','providers','settings','operations','sessions','meanings','identities'])r.result.createObjectStore(name);r.transaction!.objectStore('drafts').put({text:'preserved owner draft'},'existing');};r.onerror=()=>reject(r.error);r.onsuccess=()=>{r.result.close();resolve();};});
const identity=await openLibrary();assert.deepEqual(await readLibrary(tx=>tx.get('drafts','existing')),{text:'preserved owner draft'});await command({id:crypto.randomUUID(),kind:'fixture.owner',input:{}},async tx=>{tx.put('meta','service-owner',{subject:crypto.randomUUID()});});
const id=()=>crypto.randomUUID();
const result=provisionLightweightInitialContent({learnerUserId:identity.learnerId,learningTargetId:id(),senseId:id(),senseVersionId:id(),senseExpressionBindingId:id(),resolvedLearningPlanRevisionId:'fixture-v1',expressionSourceVersion:'fixture-v1',senseSourceVersion:'fixture-v1',expression:{surface:'borrow',languageTag:'en',expressionKind:'word'},sense:{meaning:'临时取得他人物品，并预期归还。',familiarLanguageTag:'zh-CN'},originExperience:{source:'other_authoritative_source',sourceVersion:'fixture-v1',personalAnchorUseGrantId:null,experience:{scene:'下雨了，你向同事要一把伞，约好明天归还。',senseFocus:'临时取得他人的物品',featureLabels:[]}},referenceFacts:[],requestedAt:new Date().toISOString()});
assert.equal(result.status,'ready',JSON.stringify(result));if(result.status!=='ready')throw Error();
const entry={senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:'borrow',meaning:'临时取得他人物品，并预期归还。',content:result.materialization.content};
const bundle={format:'sensa-learning-package-v1',id:id(),version:'1',title:'合成验证包',targetLanguage:'en',familiarLanguage:'zh-CN',entries:[entry]};
const bytes=new TextEncoder().encode(JSON.stringify(bundle));
const descriptor={id:bundle.id,version:'1',title:bundle.title,description:'fixture',entryCount:1,byteLength:bytes.length,sha256:await sha256(bytes),url:'https://fixture.invalid/package.json'};
const realFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(bytes);
try{
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(downloadPackage(descriptor,cancelled.signal,()=>{}));
 globalThis.fetch=async()=>new Response(bytes.slice(0,bytes.length-1));await assert.rejects(downloadPackage(descriptor,new AbortController().signal,()=>{}));globalThis.fetch=async()=>new Response(bytes);
 await assert.rejects(downloadPackage({...descriptor,sha256:'0'.repeat(64)},new AbortController().signal,()=>{}));
 assert.equal((await readLibrary(tx=>tx.all('packages'))).length,0);
 const pack=await downloadPackage(descriptor,new AbortController().signal,()=>{});
 assert.equal((await readLearning()).targets.length,0);
 await installPackage(bytes,descriptor);assert.equal((await readLibrary(tx=>tx.all('packages'))).length,1);
 await assert.rejects(installPackage(new TextEncoder().encode(JSON.stringify({...bundle,title:'changed'}))));
 const [targetId]=await enrollPackage(id(),pack.key);await enrollPackage(id(),pack.key);
 assert.equal((await readLearning()).targets.length,1);
 const target=(await readLearning()).targets[0]!;
 // A new Profile reuses the registered execution engine and Surface without a new page or branch.
 const base=learningPolicyProfileRegistry.get('lightweight');
 const variant={...structuredClone(base),profileId:'fixture-reused-profile'};
 const profiles=new LearningPolicyProfileRegistry([variant], [{...variant,profileVersion:'archived-v1'}]);
 assert.equal(profiles.get(variant.profileId,'archived-v1').profileVersion,'archived-v1');
 assert.throws(()=>profiles.get(variant.profileId,'unknown-version'));
 const coordinator=new LearningRuntimeCoordinator(profiles),surfaces=new RuntimeSurfaceRegistry();
 const renderer=()=>null;surfaces.bindLocalRenderer(coordinator.surfaceFor(variant.profileId,'initial_learning'),renderer);
 assert.equal(surfaces.localRenderer(coordinator.surfaceFor(variant.profileId,'initial_learning')),renderer);
 const engine=coordinator.localExecutionFor(variant.profileId,'initial_learning');
 const copiedTarget=structuredClone(target);
 const copiedRun:any={id:id(),targetId:target.id,purpose:'initial_learning',protocolVersion:variant.protocols.initial_learning.localProtocolVersion,protocolBinding:variant.protocols.initial_learning,schedulingPolicy:variant.lifecycle.schedulingPolicy,phase:'recall',ordinal:1,revision:1,startedAt:'2026-09-10T08:00:00.000Z',completedAt:null,memoryRevision:0,dueAt:null,material:target.material};
 Object.assign(copiedRun,engine.initialize(copiedTarget,pack,'initial_learning',copiedRun));
 assert.equal(engine.purpose(copiedTarget),'initial_learning');
 assert.throws(()=>engine.transition(copiedTarget,copiedRun,pack,{kind:'reveal',extra:true} as any,copiedRun.startedAt));
 engine.transition(copiedTarget,copiedRun,pack,{kind:'reveal'},copiedRun.startedAt);
 engine.transition(copiedTarget,copiedRun,pack,{kind:'rate',rating:'good'},copiedRun.startedAt);
 assert(copiedRun.lightweight.progress.completed);
 assert.equal(copiedTarget.memoryRevision,1);
 assert.equal(engine.purpose(copiedTarget),'retention_review');

 for(const definition of [LIGHTWEIGHT_EXPERIENCE_RECALL_STEP,LIGHTWEIGHT_EXPRESSION_REVEAL_STEP]){
  const presentation=assembleLightweightInitialPresentation({protocolStepInstanceId:id(),protocolRunId:id(),retentionTargetId:target.retentionId,ordinal:1,definition,materialBindings:target.material.content.resources.filter(r=>definition.materialRequirements.some(m=>m.materialRoleKey===r.materialRoleKey)).map(r=>({materialRoleKey:r.materialRoleKey,resourceKey:r.resourceKey,learningMaterializationId:target.material.snapshot.learningMaterializationId}))},target.material);
  if(presentation.kind==='expression_reveal')assert.equal(presentation.slots.expressionPrimary.surface,'borrow');else assert(!JSON.stringify(presentation).includes('borrow'));
 }
 globalThis.fetch=async()=>{throw Error('Offline');};
 const at='2026-09-10T08:00:00.000Z';await assert.rejects(startLearning(id(),targetId!,20,at));await confirmLearningQuantity(id(),20);let run=await startLearning(id(),targetId!,20,at);
 assert.equal((await startLearning(id(),targetId!,20,at)).id,run.id);
 await assert.rejects(actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'},at));
 const reveal=id();run=await actLearning(reveal,run.id,run.revision,{kind:'reveal'},at);
 assert.equal((await readLearning()).runs[0]!.phase,'reveal');
 assert.equal((await actLearning(reveal,run.id,1,{kind:'reveal'},at)).revision,run.revision);
 const original=LibraryTransaction.prototype.put;
 LibraryTransaction.prototype.put=function(table,key,value){if(table==='learningEvents')throw Error('injected disk failure');return original.call(this,table,key,value);};
 await assert.rejects(actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'},at));LibraryTransaction.prototype.put=original;
 assert.equal((await readLearning()).targets[0]!.memory,null);assert.equal((await readLearning()).runs[0]!.revision,run.revision);
 const rating=id();run=await actLearning(rating,run.id,run.revision,{kind:'rate',rating:'good'},at);
 await actLearning(rating,run.id,2,{kind:'rate',rating:'good'},at);
 assert.equal((await readLearning()).targets[0]!.memoryRevision,1);
 await finishLearning(id(),run.id);
 await assert.rejects(startLearning(id(),targetId!,20,at));
 const due=(await readLearning()).targets[0]!.memory!.dueAt.toISOString();run=await startLearning(id(),targetId!,20,due);assert.equal(run.purpose,'retention_review');
 run=await actLearning(id(),run.id,run.revision,{kind:'reveal'},due);
 run=await actLearning(id(),run.id,run.revision,{kind:'rate',rating:'again'},due);assert(run.completedAt);await finishLearning(id(),run.id);
 const t=(await readLearning()).targets[0]!;assert.equal(t.memoryRevision,2);assert(t.relearnAt);
 await assert.rejects(startLearning(id(),targetId!,20,due));
 run=await startLearning(id(),targetId!,20,t.relearnAt!);assert.equal(run.purpose,'relearning');
 run=await actLearning(id(),run.id,run.revision,{kind:'reveal'},t.relearnAt!);run=await actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'},t.relearnAt!);
 assert.equal((await readLearning()).targets[0]!.memoryRevision,2);assert.equal((await readLearning()).targets[0]!.relearnAt,null);
 await finishLearning(id(),run.id);
 // Daily admission and explicit sign-out remain enforced while fetch is unavailable.
 const extra={...bundle,id:id(),entries:[{...entry,senseVersionId:id(),bindingVersionId:id()}]};
 const extraPack=await installPackage(new TextEncoder().encode(JSON.stringify(extra)));const [extraId]=await enrollPackage(id(),extraPack.key);
 await confirmLearningQuantity(id(),1);await assert.rejects(startLearning(id(),extraId!,1,at));
 await command({id:id(),kind:'fixture.signout',input:{}},async tx=>{tx.put('meta','signed-out',true);});
 await assert.rejects(enrollPackage(id(),extraPack.key));await assert.rejects(startLearning(id(),extraId!,1,'2026-09-11T08:00:00.000Z'));
 const corrupted=structuredClone(bundle);corrupted.entries[0]!.content.resources[0]!.contentDigest='invalid';await assert.rejects(installPackage(new TextEncoder().encode(JSON.stringify(corrupted))));
 assert.equal(canonicalJsonDigest((await readLearning()).targets[0]!.material.content),canonicalJsonDigest(entry.content));

 await command({id:id(),kind:'fixture.resume',input:{}},async tx=>tx.delete('meta','signed-out'));
 const rich=structuredClone(bundle);rich.id=id();rich.entries[0]!.senseVersionId=id();rich.entries[0]!.bindingVersionId=id();
 const cue=rich.entries[0]!.content.resources.find(r=>r.materialRoleKey==='experience_recall_cue')!;
 cue.contentPayload={scene:'',senseFocus:'临时使用并归还',images:[{id:id(),name:'context.jpg',dataUrl:'data:image/jpeg;base64,/9j/2Q=='}],html:'<button data-action="toggle" data-target="cue">Hint</button><p id="cue" hidden>Imagine this moment.</p>'};cue.contentDigest=canonicalJsonDigest(cue.contentPayload);
 const richPack=await installPackage(new TextEncoder().encode(JSON.stringify(rich)));const [richId]=await enrollPackage(id(),richPack.key);const richTarget=(await readLearning()).targets.find(t=>t.id===richId)!;
 const definition=LIGHTWEIGHT_EXPERIENCE_RECALL_STEP;
 const richPresentation=assembleLightweightInitialPresentation({protocolStepInstanceId:id(),protocolRunId:id(),retentionTargetId:richTarget.retentionId,ordinal:1,definition,materialBindings:richTarget.material.content.resources.filter(r=>definition.materialRequirements.some(m=>m.materialRoleKey===r.materialRoleKey)).map(r=>({materialRoleKey:r.materialRoleKey,resourceKey:r.resourceKey,learningMaterializationId:richTarget.material.snapshot.learningMaterializationId}))},richTarget.material);
 assert.equal(richPresentation.kind,'experience_recall');if(richPresentation.kind==='experience_recall'){assert.equal(richPresentation.slots.experienceSketch.images?.length,1);assert(richPresentation.slots.experienceSketch.html?.includes('data-action'));}
 const unsafe=structuredClone(rich);unsafe.id=id();const unsafeCue=unsafe.entries[0]!.content.resources.find(r=>r.materialRoleKey==='experience_recall_cue')!;unsafeCue.contentPayload={scene:'scene',senseFocus:'meaning',html:'<script>fetch("https://example.org")</script>'};unsafeCue.contentDigest=canonicalJsonDigest(unsafeCue.contentPayload);await assert.rejects(installPackage(new TextEncoder().encode(JSON.stringify(unsafe))));
 // A package names the languages its own text is in, and every target it
 // enrolls carries them, so material provisioned from a Spanish package can
 // never be stamped with the English one the product happens to ship.
 const spanishContent=provisionLightweightInitialContent({learnerUserId:identity.learnerId,learningTargetId:id(),senseId:id(),senseVersionId:id(),senseExpressionBindingId:id(),resolvedLearningPlanRevisionId:'fixture-es-v1',expressionSourceVersion:'fixture-es-v1',senseSourceVersion:'fixture-es-v1',expression:{surface:'tomarse su tiempo',languageTag:'es',expressionKind:'phrase'},sense:{meaning:'从容地花时间做一件事。',familiarLanguageTag:'zh-CN'},originExperience:{source:'other_authoritative_source',sourceVersion:'fixture-es-v1',personalAnchorUseGrantId:null,experience:{scene:'朋友催你快点，你说这件事需要慢慢来。',senseFocus:'从容地花时间',featureLabels:[]}},referenceFacts:[],requestedAt:new Date().toISOString()});
 assert.equal(spanishContent.status,'ready');if(spanishContent.status!=='ready')throw Error();
 const spanishBundle={...bundle,id:id(),title:'合成西语验证包',targetLanguage:'es',entries:[{...entry,senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:'tomarse su tiempo',meaning:'从容地花时间做一件事。',content:spanishContent.materialization.content}]};
 const spanishPack=await installPackage(new TextEncoder().encode(JSON.stringify(spanishBundle)));
 const [spanishTargetId]=await enrollPackage(id(),spanishPack.key);
 const learning=await readLearning();
 assert.equal(learning.targets.find(t=>t.id===spanishTargetId!)!.targetLanguageTag,'es','an enrolled target carries the package language, not the shipped one');
 assert.equal(learning.targets.find(t=>t.id===spanishTargetId!)!.familiarLanguageTag,'zh-CN');
 assert.equal(learning.targets.find(t=>t.id===targetId!)!.targetLanguageTag,'en','the English package still enrolls English targets');
 await assert.rejects(installPackage(new TextEncoder().encode(JSON.stringify({...spanishBundle,id:id(),familiarLanguage:'es'}))),'a package cannot teach the language it explains in');

 console.log('PASS: verified download/import, immutable versions, separate enrollment, local initial/review/relearning, replay, stale-step rejection, rollback and pinned content; fake IndexedDB, no browser/model calls.');
}finally{globalThis.fetch=realFetch;}
