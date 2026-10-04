import {test,expect} from 'vitest';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {semanticLookupPayload,semanticLookupSpec} from '../support/semanticLookupFixtures';
import {directPublishedFixture} from '../support/directPublishedFixture';
import {sha256} from '@sensa/learning-kernel';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {sensaPinnedLanguageContext} from '@sensa/contracts/sensa';

test('direct on-demand preparation preserves fixed facts, never sends personal Context, recovers failures and yields to existing coverage',async()=>{
 const built=await build({stdin:{contents:[
  ...['store','language','providers','speech/defaultProvider','personalLearning','directProvisioning','backupValidation'].map(name=>`export * from './apps/web/src/data/library/${name}';`),
  `export {learningSystem} from './apps/web/src/learning/system/learningSystem';`,
  `export {contentSupplySystem} from './apps/web/src/contentSupply/system/contentSupplySystem';`,
  `export {LibraryJourneyRepository} from './apps/web/src/experience/personalMeaningJourney/repository';`,
  `export {assembleLightweightInitialPresentation} from './apps/web/src/experience/learningRuntime/lightweightInitialPresentation';`,
 ].join('\n'),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'},plugins:[{name:'fixture-auth',setup(builder){builder.onLoad({filter:/[/\\]account[/\\]auth\.ts$/},()=>({contents:"export const auth={getSession:async()=>({data:{session:{access_token:'fixture',user:{id:'fixture'}}}})}; export {authStorageKey,cachedAuthSubject} from './authSessionHint';",loader:'ts'}));}}]});
 Object.assign(globalThis,{window:new EventTarget(),location:{origin:'http://direct-provisioning.fixture'},BroadcastChannel:undefined});
 const directory=await mkdtemp(join(tmpdir(),'sensa-direct-provisioning-')),realFetch=globalThis.fetch;
 let restoreSpeech=()=>{};
 try{
  await writeFile(join(directory,'provisioning.mjs'),built.outputFiles[0]!.text);const api=await import(pathToFileURL(join(directory,'provisioning.mjs')).href);
  await api.openLibrary();const languageContext=(await api.languageRoutesSnapshot()).context;
  restoreSpeech=api.replaceClientSpeechProvider({id:'fixture',revision:1,displayName:'Fixture',synthesize:async(input:any)=>({...input,audioUrl:'data:audio/mpeg;base64,UklGRg==',phoneticNotation:null,accentLabel:'en-US',source:'synthetic fixture',method:'tts'})});
  const provider=await api.saveProvider(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,name:'Fixture',kind:'compatible',endpoint:'https://fixture.invalid/v1',model:'fixture'},'fixture-secret');
  for(const purpose of ['content','review'])await api.assignProvider(crypto.randomUUID(),purpose,provider.id,(await api.providerSnapshot()).settings.revision);
  await api.setModelReviewEnabled(crypto.randomUUID(),true,(await api.providerSnapshot()).settings.revision);
  const calls:any[]=[];let mode:'good'|'offline'|'leak'|'hold'|'review-offline'|'inflected'='good',entered=false,release:(()=>void)|undefined;
  globalThis.fetch=async(url,input)=>{
   if(String(url).endsWith('/sensa/resource-facts'))return new Response(JSON.stringify({input:JSON.parse(String(input?.body)),references:[]}),{status:200});
   if(!input?.body)return new Response('[]',{headers:{'content-type':'application/json'}});
   const body=JSON.parse(String(input.body));calls.push(body);
   const review=String(body.messages?.[0]?.content).includes('independent Sensa');
   const japanese=!review&&JSON.parse(body.messages[1].content).sense.supportLanguageTag==='ja';
   if(review&&mode==='review-offline')throw new Error('fixture review unavailable');
   if(!review&&mode==='offline')throw new Error('fixture transport unavailable');
   if(!review&&mode==='hold'){entered=true;await new Promise<void>(resolve=>{release=resolve;});}
   const result=review?{accepted:true,reason:'fixed meaning retained'}:{resources:[
    {role:'experience_recall_cue',payload:{scene:mode==='leak'?'一个人想 borrow 一把伞。':'一个人向同伴借用一把雨伞，约好之后归还。',senseFocus:'临时使用并预期归还'}},
    {role:'scene_bridge',payload:{text:japanese?'受け取る側から一時的な使用と返却を表す。':'从取得者视角表达临时使用并归还。',meaningRendering:{meaning:japanese?'他人の物を一時的に借り、後で返すこと。':'临时取得他人物品并归还。',languageTag:japanese?'ja':'zh-CN'}}},
    {role:'scene_realization',payload:mode==='inflected'?{example:'May borrowed an umbrella.',targetStart:4,targetEnd:12,experienceResourceKey:'experience_recall_cue:0'}:{example:'May asked to borrow an umbrella.',targetStart:13,targetEnd:19,experienceResourceKey:'experience_recall_cue:0'}},
   ]};
   return new Response(JSON.stringify({model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}),{headers:{'content-type':'application/json'}});
  };
  const repository=new api.LibraryJourneyRepository();let sequence=0;
  const enroll=async(context=languageContext)=>{
   const memory=new MemoryJourneyRepository(),payload=semanticLookupPayload({...semanticLookupSpec,coreMeaningFocus:`临时取得他人物品并归还（固定案例 ${++sequence}）。`});payload.sense!.senseKey=`direct-generation-${sequence}`;
   await createJourneyModules({repository:memory}).semanticIntake.submit(payload);const fixture=await memory.load(),before=await repository.load(),after=structuredClone(before);
   for(const kind of Object.keys(after.registry) as Array<keyof typeof after.registry>)(after.registry[kind] as unknown[]).push(...fixture.registry[kind]);
   await repository.commit({before,after});
   const reference={origin:{kind:'semantic_registry'},senseId:fixture.registry.senses[0]!.senseId,senseVersionId:fixture.registry.senseVersions[0]!.senseVersionId,bindingId:fixture.registry.bindings[0]!.senseExpressionBindingId,bindingVersionId:fixture.registry.bindingVersions[0]!.bindingVersionId};
   const selection=await api.learningSystem.read({kind:'direct_source',reference});
   return api.learningSystem.execute({kind:'enroll_direct',operationId:crypto.randomUUID(),reference,expectedDigest:selection.sourceDigest,languageContext:context});
  };
  const prepare=(enrollmentId:string)=>api.contentSupplySystem.execute({kind:'prepare_direct_materialization',enrollmentId,signal:new AbortController().signal});
  const task=(enrollmentId:string)=>api.contentSupplySystem.read({kind:'direct_provisioning_task',enrollmentId});
  const snapshot=()=>api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
  const first=await enroll();const result=await prepare(first.enrollmentId);expect(result.status).toBe('ready');
  const ready=await task(first.enrollmentId);expect(ready.source).toMatchObject({kind:'stable_sense',enrollmentId:first.enrollmentId});expect(ready.useContext).toBe(false);
  let saved=await snapshot();expect(saved.semanticMeanings).toEqual([]);expect(saved.learningTargets).toHaveLength(1);expect(saved.learningRuns).toEqual([]);expect(saved.learningTargets[0].value).toMatchObject({memory:null,memoryRevision:0,startedAt:null,completedAt:null});api.validateBackupRows(saved);
  const attempt=saved.contentAttempts.find((row:any)=>row.key===ready.attemptId).value;
  expect(attempt.grant).toBeNull();expect(attempt.request.contextArtifacts.some((artifact:any)=>artifact.source==='personal_anchor'||artifact.personalAnchorUseGrantId!==null)).toBe(false);
  expect(JSON.stringify(calls)).not.toContain('Private source');
  const count=calls.length;expect((await prepare(first.enrollmentId)).status).toBe('already_in_scope');expect(calls).toHaveLength(count);
  const changed=structuredClone(saved);changed.contentAttempts.find((row:any)=>row.key===ready.attemptId).value.request.contextArtifacts.find((artifact:any)=>artifact.contextKind==='sense_snapshot').payload.meaning='forged meaning';expect(()=>api.validateBackupRows(changed)).toThrow();
  for(const field of ['request','bundle']){
   const damaged=structuredClone(saved);damaged.contentAttempts.find((row:any)=>row.key===ready.attemptId).value[field]=null;
   expect(()=>api.validateBackupRows(damaged)).toThrow();
  }
  const forgedCandidate=structuredClone(saved),candidate=forgedCandidate.contentAttempts.find((row:any)=>row.key===ready.attemptId).value.bundle.candidates.find((value:any)=>value.materialRoleKey==='experience_recall_cue');
  candidate.contentPayload.scene='borrow is leaked before reveal';candidate.contentDigest=sha256(canonicalConsumerJson(candidate.contentPayload));
  expect(()=>api.validateBackupRows(forgedCandidate)).toThrow();

  const forged=await enroll(),forgedTask=await api.enrollDirectProvisioning(crypto.randomUUID(),forged.enrollmentId),forgedSource=await api.readDirectProvisioningSource(forged.enrollmentId);
  forgedSource.semanticSpec.coreMeaningFocus='a caller-supplied replacement meaning';const beforeForged=calls.length;
  await expect(api.preparePersonal(forgedTask.id,forgedSource,provider,provider,new AbortController().signal,()=>{})).rejects.toThrow('accepted semantics');
  expect(calls).toHaveLength(beforeForged);expect((await task(forged.enrollmentId)).status).toBe('failed');expect((await snapshot()).learningTargets).toHaveLength(1);

  const retry=await enroll();mode='offline';await expect(prepare(retry.enrollmentId)).rejects.toThrow();
  expect((await task(retry.enrollmentId)).status).toBe('failed');expect((await snapshot()).learningTargets).toHaveLength(1);
  mode='good';expect((await prepare(retry.enrollmentId)).status).toBe('ready');expect((await snapshot()).learningTargets).toHaveLength(2);
  const invalid=await enroll();mode='leak';expect((await prepare(invalid.enrollmentId)).status).toBe('rejected');expect((await snapshot()).learningTargets).toHaveLength(2);
  mode='good';expect((await prepare(invalid.enrollmentId)).status).toBe('ready');

  const stopped=await enroll();mode='hold';entered=false;const pending=prepare(stopped.enrollmentId);await expect.poll(()=>entered).toBe(true);
  const held=await task(stopped.enrollmentId);await api.contentSupplySystem.execute({kind:'stop_provisioning',operationId:crypto.randomUUID(),taskId:held.id});release!();await expect(pending).rejects.toThrow();
  expect((await task(stopped.enrollmentId)).status).toBe('stopped');expect((await snapshot()).learningTargets).toHaveLength(3);
  mode='good';expect((await prepare(stopped.enrollmentId)).status).toBe('ready');

  const race=await enroll();mode='hold';entered=false;const competing=prepare(race.enrollmentId);await expect.poll(()=>entered).toBe(true);
  const publication=directPublishedFixture(race.selection.reference,{senseId:race.selection.reference.senseId,bindingId:race.selection.reference.bindingId,senseKey:race.selection.senseKey,semanticSpec:race.selection.semanticSpec});
  await api.restoreLibraryTransaction(async(tx:any)=>{tx.put('packageInstallations',publication.pack.key,publication.installation);tx.put('packageCache',publication.pack.key,publication.pack);});
  await api.learningSystem.execute({kind:'confirm_quantity',operationId:crypto.randomUUID(),languageContext,dailyLimit:20});
  await api.learningSystem.execute({kind:'enroll_package',operationId:crypto.randomUUID(),packageKey:publication.pack.key,languageContext});
  const beforeRelease=await snapshot(),existing=beforeRelease.learningTargets.find((row:any)=>row.key===race.targetId);
  expect(existing).toBeDefined();release!();expect((await competing).status).toBe('covered');
  saved=await snapshot();expect(saved.learningTargets.find((row:any)=>row.key===race.targetId)).toEqual(existing);expect(saved.semanticMeanings).toEqual([]);expect(saved.learningRuns).toEqual([]);api.validateBackupRows(saved);
  const covered=await task(race.enrollmentId);expect(covered.coveredByMembershipId).toBe(existing.value.curriculumMemberships[0].id);
  const resumed=await enroll();mode='review-offline';await expect(prepare(resumed.enrollmentId)).rejects.toThrow();
  const failedReview=await task(resumed.enrollmentId),failedAttempt=(await snapshot()).contentAttempts.find((row:any)=>row.key===failedReview.attemptId).value;
  expect(failedAttempt.bundle).not.toBeNull();const beforeResume=calls.length;mode='good';expect((await prepare(resumed.enrollmentId)).status).toBe('ready');
  const resumedTask=await task(resumed.enrollmentId),resumedAttempt=(await snapshot()).contentAttempts.find((row:any)=>row.key===resumedTask.attemptId).value;
  expect(resumedAttempt.resumedFrom).toBe(failedAttempt.id);expect(resumedAttempt.bundle).toEqual(failedAttempt.bundle);expect(calls).toHaveLength(beforeResume+1);api.validateBackupRows(await snapshot());

  const oldPolicy=await enroll();mode='review-offline';await expect(prepare(oldPolicy.enrollmentId)).rejects.toThrow();
  const oldTask=await task(oldPolicy.enrollmentId),oldAttempt=structuredClone((await snapshot()).contentAttempts.find((row:any)=>row.key===oldTask.attemptId).value);
  oldAttempt.request.generatorPolicyVersion='v3';oldAttempt.bundle.promptPolicyVersion='v3';
  oldAttempt.bundle.inputSnapshotDigest=sha256(canonicalConsumerJson(oldAttempt.request));
  const oldBridge=oldAttempt.bundle.candidates.find((candidate:any)=>candidate.materialRoleKey==='scene_bridge');
  delete oldBridge.contentPayload.meaningRendering;oldBridge.contentDigest=sha256(canonicalConsumerJson(oldBridge.contentPayload));
  await api.restoreLibraryTransaction(async(tx:any)=>tx.put('contentAttempts',oldAttempt.id,oldAttempt));
  const beforeNewPolicy=calls.length;mode='good';expect((await prepare(oldPolicy.enrollmentId)).status).toBe('ready');
  const newPolicyTask=await task(oldPolicy.enrollmentId),newPolicyRows=await snapshot(),newPolicyAttempt=newPolicyRows.contentAttempts.find((row:any)=>row.key===newPolicyTask.attemptId).value;
  expect(newPolicyAttempt.resumedFrom).toBeNull();expect(newPolicyAttempt.request.generatorPolicyVersion).toBe('v4');
  expect(newPolicyAttempt.bundle.materialCandidateBundleId).not.toBe(oldAttempt.bundle.materialCandidateBundleId);
  expect(calls.length).toBeGreaterThan(beforeNewPolicy+1);
  expect(newPolicyRows.contentAttempts.find((row:any)=>row.key===oldAttempt.id).value).toEqual(oldAttempt);
  api.validateBackupRows(newPolicyRows);

  const fallback=directPublishedFixture();await api.restoreLibraryTransaction(async(tx:any)=>{tx.put('packageInstallations',fallback.pack.key,fallback.installation);tx.put('packageCache',fallback.pack.key,fallback.pack);});
  const fallbackSource=await api.learningSystem.read({kind:'direct_source',reference:fallback.reference});expect(fallbackSource.expression.acceptedForms).toEqual(['borrowed']);
  const fallbackEnrollment=await api.learningSystem.execute({kind:'enroll_direct',operationId:crypto.randomUUID(),reference:fallback.reference,expectedDigest:fallbackSource.sourceDigest,languageContext});
  await api.restoreLibraryTransaction(async(tx:any)=>tx.delete('packageCache',fallback.pack.key));mode='inflected';expect((await prepare(fallbackEnrollment.enrollmentId)).status).toBe('ready');
  const fallbackTask=await task(fallbackEnrollment.enrollmentId),fallbackAttempt=(await snapshot()).contentAttempts.find((row:any)=>row.key===fallbackTask.attemptId).value;
  expect(fallbackAttempt.request.contextArtifacts.find((artifact:any)=>artifact.contextKind==='expression_snapshot').payload.acceptedForms).toEqual(['borrowed']);
  api.validateBackupRows(await snapshot());
  const japaneseContext=sensaPinnedLanguageContext(await api.addLanguageRoute(crypto.randomUUID(),'en','ja'));
  const japanese=await enroll(japaneseContext);mode='good';expect((await prepare(japanese.enrollmentId)).status).toBe('ready');
  const workspace=()=>api.learningSystem.read({kind:'workspace',languageContext:japaneseContext});
  let projection=await workspace(),target=projection.targets.find((value:any)=>value.targetId===japanese.targetId);
  expect(target.presentation.meaning).toBe('他人の物を一時的に借り、後で返すこと。');
  expect(target.material.content.resources.find((resource:any)=>resource.materialRoleKey==='sense_confirmation').contentPayload.meaning).toBe(japanese.selection.semanticSpec.coreMeaningFocus);
  await api.learningSystem.execute({kind:'confirm_quantity',operationId:crypto.randomUUID(),languageContext:japaneseContext,dailyLimit:20});
  await api.learningSystem.execute({kind:'start',operationId:crypto.randomUUID(),targetId:japanese.targetId,languageContext:japaneseContext,dailyLimit:20});
  projection=await workspace();await api.learningSystem.execute({kind:'act',operationId:crypto.randomUUID(),runId:projection.runtime.runId,expectedRevision:projection.runtime.revision,action:{kind:'reveal'}});
  projection=await workspace();const presentation=api.assembleLightweightInitialPresentation(projection.runtime.step,projection.runtime.step.materialization);
  expect(presentation.slots.senseConfirmation.meaning).toBe(target.presentation.meaning);
  await api.learningSystem.execute({kind:'act',operationId:crypto.randomUUID(),runId:projection.runtime.runId,expectedRevision:projection.runtime.revision,action:{kind:'rate',rating:'good'}});
  expect((await workspace()).records[0].meaning).toBe(target.presentation.meaning);
  saved=await snapshot();expect(saved.learningRuns).toHaveLength(1);expect(saved.semanticMeanings).toEqual([]);api.validateBackupRows(saved);
 }finally{restoreSpeech();globalThis.fetch=realFetch;await rm(directory,{recursive:true,force:true});}
});
