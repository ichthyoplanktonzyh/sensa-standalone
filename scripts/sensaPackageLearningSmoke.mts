import {inspectLocalTargetReadiness,LearningRuntimeCoordinator} from '../apps/web/src/learning/runtime/runtimeCoordinator.ts';
import {LearningPolicyProfileRegistry,learningPolicyProfileRegistry} from '../apps/web/src/learning/runtime/policyProfiles.ts';
import {LocalRuntimePresentationRegistry,localRuntimePresentationContractVersion} from '../apps/web/src/experience/learningRuntime/localRuntimePresentations.ts';
import {assembleLightweightInitialPresentation} from '../apps/web/src/experience/learningRuntime/lightweightInitialPresentation.ts';
import {LIGHTWEIGHT_EXPERIENCE_RECALL_STEP,LIGHTWEIGHT_EXPRESSION_REVEAL_STEP,localLightweightPhase} from '../apps/web/src/learning/runtime/lightweightInitialProtocol.ts';
import assert from 'node:assert/strict';
import {canonicalJsonDigest,stableUuid} from '@sensa/learning-kernel';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext,sensaInitialLearningCompletionSchema,sensaSchedulingHandoffSchema,sensaMemoryOutcomeSnapshotSchema,sensaSchedulingDecisionSchema,sensaRelearningCompletionSchema} from '@sensa/contracts/sensa';
import {provisionLightweightInitialContent} from '../apps/web/src/learning/runtime/lightweightInitialContent.ts';
import {openLibrary,command,readLibrary,observeLibrary,LibraryTransaction} from '../apps/web/src/data/library/store.ts';
import {installPackage,downloadPackage,sha256} from '../apps/web/src/data/library/packages.ts';
import {enrollPackage,readLearning,startLearning,actLearning,finishLearning,continueLearning,confirmLearningQuantity,setLocalDeclaredMastery} from '../apps/web/src/data/library/learning.ts';
import {createLocalProtocolProgress,executeLocalProtocolTransition,reduceLocalProtocolAction,localLearningPurpose,localProtocolOutcomePermissions,localRunOpenPlanningInterruption} from '../apps/web/src/learning/runtime/localProtocol.ts';
import {hasDeclaredMasteryOverride} from '../apps/web/src/learning/runtime/targetPlanningOverrides.ts';
import {localCurriculumMeaning,localCurriculumMembershipForContext,localExecutableTarget} from '../apps/web/src/learning/runtime/localCurriculum.ts';
import {addLanguageRoute,setActiveLanguageRoute} from '../apps/web/src/data/library/language.ts';
import {contentAnnotations} from '../apps/web/src/data/library/contentAnnotations.ts';
import {readHomeLearningProjection} from '../apps/web/src/experience/library/homeLearningProjection.ts';
Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});
const identity=await openLibrary();await command({id:crypto.randomUUID(),kind:'fixture.owner',input:{}},async tx=>{tx.put('meta','service-owner',{subject:crypto.randomUUID()});});
const id=()=>crypto.randomUUID();
const languageContext=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
const result=provisionLightweightInitialContent({learnerUserId:identity.learnerId,learningTargetId:id(),senseId:id(),senseVersionId:id(),senseExpressionBindingId:id(),resolvedLearningPlanRevisionId:'fixture-v1',expressionSourceVersion:'fixture-v1',senseSourceVersion:'fixture-v1',expression:{surface:'borrow',languageTag:'en',expressionKind:'word'},sense:{meaning:'临时取得他人物品，并预期归还。',supportLanguageTag:'zh-CN'},originExperience:{source:'other_authoritative_source',sourceVersion:'fixture-v1',personalAnchorUseGrantId:null,experience:{scene:'下雨了，你向同事要一把伞，约好明天归还。',senseFocus:'临时取得他人的物品',featureLabels:[]}},referenceFacts:[],requestedAt:new Date().toISOString()});
assert.equal(result.status,'ready',JSON.stringify(result));if(result.status!=='ready')throw Error();
const entry={senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:'borrow',meaning:'临时取得他人物品，并预期归还。',content:result.materialization.content};
const bundle={format:'sensa-learning-package-v1',id:id(),version:'1',title:'合成验证包',targetLanguage:'en',supportLanguage:'zh-CN',entries:[entry]};
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
 const [targetId]=await enrollPackage(id(),pack.key,languageContext);await enrollPackage(id(),pack.key,languageContext);
 assert.equal((await readLearning()).targets.length,1);
 const target=(await readLearning()).targets[0]!;
 const homeBeforeStart=await readHomeLearningProjection(languageContext.languageRouteId);
    assert.equal(homeBeforeStart.targets.length,1);assert.equal(homeBeforeStart.availablePackageKeys.size,1);assert.equal(homeBeforeStart.activeRun,null);assert.equal(homeBeforeStart.dailyLimit,undefined);
    assert(!('content' in homeBeforeStart.targets[0]!.curriculumMemberships[0]!.material),'the home projection must not transfer learning material');
 // A new Profile reuses the registered execution engine and Surface without a new page or branch.
 const base=learningPolicyProfileRegistry.get('lightweight');
 const variant={...structuredClone(base),profileId:'fixture-reused-profile'};
 const profiles=new LearningPolicyProfileRegistry([variant], [{...variant,profileVersion:'archived-v1'}]);
 assert.equal(profiles.get(variant.profileId,'archived-v1').profileVersion,'archived-v1');
 assert.throws(()=>profiles.get(variant.profileId,'unknown-version'));
 const coordinator=new LearningRuntimeCoordinator(profiles);
 assert.throws(()=>new LearningRuntimeCoordinator(new LearningPolicyProfileRegistry([{...variant,protocols:{...variant.protocols,initial_learning:{...variant.protocols.initial_learning,protocolVersion:'unsupported-v99'}}}])),'an execution plugin must explicitly admit every exact Protocol version');
 const renderer=()=>null,binding=variant.protocols.initial_learning;
 const presentationBinding={surface:coordinator.surfaceFor(variant.profileId,'initial_learning'),runtimeAdapterId:binding.runtimeAdapterId,purpose:'initial_learning' as const,protocolId:binding.protocolId,protocolVersion:binding.protocolVersion,localProtocolVersion:binding.localProtocolVersion!};
 const surfaces=new LocalRuntimePresentationRegistry([{manifest:{contractVersion:localRuntimePresentationContractVersion,pluginId:'fixture.renderer',pluginVersion:'v1',displayName:'Fixture renderer',capabilities:[],bindings:[presentationBinding]},render:renderer}]);
 assert.equal(surfaces.resolve(presentationBinding).render,renderer);
 assert.throws(()=>surfaces.resolve({...presentationBinding,protocolVersion:'unsupported'}));
 const relearningLaunch=coordinator.planRelearning([{targetId:'fixture-target',profileId:variant.profileId,ready:true,executable:true}])[0]!;
 assert.equal(relearningLaunch.purpose,'relearning');
 assert.equal(relearningLaunch.protocol.protocolId,variant.protocols.relearning.protocolId);
 const engine=coordinator.localExecutionFor(variant.profileId,'initial_learning');
 const copiedTarget=localExecutableTarget(structuredClone(target),structuredClone(target.curriculumMemberships[0]!)),protocolRunId=id(),commitment={commitmentId:id(),revision:1,assignmentId:copiedTarget.policyAssignment.assignmentId,assignmentRevision:copiedTarget.policyAssignment.revision,profileId:variant.profileId,profileVersion:variant.profileVersion,committedByProtocolRunId:protocolRunId,committedAt:'2026-09-10T08:00:00.000Z'};
 let copiedRun:any={id:id(),targetId:target.id,targetIds:[target.id],participants:{[target.id]:{protocolRunId,curriculumMembershipId:copiedTarget.curriculumMembership.id,languageContext,startReason:{kind:'initial_learning_ready',selectionReason:'requested_target',triggerAt:'2026-09-10T08:00:00.000Z',triggerMemoryRevision:0},outcomePermissions:localProtocolOutcomePermissions('initial_learning',variant.protocols.initial_learning),material:copiedTarget.material,presentedMaterials:{},policyCommitment:commitment,resolvedPlan:{resolvedLearningPlanRevisionId:id(),revision:1,learningTargetId:target.id,retentionTargetId:target.retentionId,purpose:'initial_learning',profileId:variant.profileId,profileVersion:variant.profileVersion,protocolBinding:variant.protocols.initial_learning,contentDemands:variant.protocols.initial_learning.contentDemands,learningMaterializationIds:[copiedTarget.material.snapshot.learningMaterializationId],readiness:'ready',resolvedAt:'2026-09-10T08:00:00.000Z'},progress:createLocalProtocolProgress(protocolRunId,variant.protocols.initial_learning),memoryRevision:0,dueAt:null,evidenceIds:[]}},targetCompletions:{},languageContext,purpose:'initial_learning',policyProfileId:variant.profileId,policyProfileVersion:variant.profileVersion,protocolVersion:variant.protocols.initial_learning.localProtocolVersion,protocolBinding:variant.protocols.initial_learning,protocolState:{adapterId:'lightweight',value:null},schedulingPolicyId:variant.lifecycle.schedulingPolicyId,schedulingPolicy:variant.lifecycle.schedulingPolicy,learnerVisibleClaimBoundary:variant.lifecycle.learnerVisibleClaimBoundary,ordinal:1,revision:1,lifecycleEvents:[],startedAt:'2026-09-10T08:00:00.000Z',completedAt:null};
 copiedRun.protocolState=engine.initialize(copiedTarget,pack,'initial_learning',copiedRun);
 const immutableRun=structuredClone(copiedRun),malicious={...engine,unsafeTransition:(_target:any,working:any)=>{working.policyProfileVersion='mutated-by-plugin';return {protocolEffects:[],evaluation:null,settlement:null};}};
 assert.throws(()=>executeLocalProtocolTransition({execution:malicious,target:copiedTarget,run:copiedRun,resource:pack,action:{kind:'reveal'},at:copiedRun.startedAt}));
 assert.deepEqual(copiedRun,immutableRun,'a rejected plugin mutation cannot touch live Run state');
 const forgedCompletion={...engine,unsafeTransition:(_target:any,working:any)=>{working.targetCompletions[target.id]={at:working.startedAt,kind:'forged'};return {protocolEffects:[],evaluation:null,settlement:null,sessionCompletion:null};}};
 assert.throws(()=>executeLocalProtocolTransition({execution:forgedCompletion,target:copiedTarget,run:copiedRun,resource:pack,action:{kind:'reveal'},at:copiedRun.startedAt}),'a Protocol plugin cannot write formal completion markers');
 const escalatedRun=structuredClone(copiedRun);escalatedRun.participants[target.id].outcomePermissions.memoryOutcome='due_review';
 assert.throws(()=>executeLocalProtocolTransition({execution:engine,target:copiedTarget,run:escalatedRun,resource:pack,action:{kind:'reveal'},at:copiedRun.startedAt}),'a persisted Run cannot escalate its scheduler authority');
 const reviewBinding=variant.protocols.retention_review,reviewRun=structuredClone(copiedRun);
 Object.assign(reviewRun,{purpose:'retention_review',protocolBinding:reviewBinding,protocolVersion:reviewBinding.localProtocolVersion});
 Object.assign(reviewRun.participants[target.id],{startReason:{kind:'due_review',selectionReason:'requested_target',triggerAt:reviewRun.startedAt,triggerMemoryRevision:0},outcomePermissions:localProtocolOutcomePermissions('retention_review',reviewBinding),resolvedPlan:{...reviewRun.participants[target.id].resolvedPlan,purpose:'retention_review',protocolBinding:reviewBinding},progress:createLocalProtocolProgress(reviewRun.participants[target.id].protocolRunId,reviewBinding)});
 reviewRun.protocolState={adapterId:'lightweight',value:{phase:'reveal',initial:null}};
 const outcomeWithoutEvaluation={...engine,unsafeTransition:()=>({protocolEffects:[],evaluation:null,settlement:{kind:'memory_outcome' as const,schedulerEligibility:'due_review' as const,outcome:{basis:'learner_rated' as const,grade:'good' as const,evidenceLevel:'self_report' as const},relearning:null},sessionCompletion:null})};
 assert.throws(()=>reduceLocalProtocolAction({operationId:id(),stepKey:'forged-review',at:reviewRun.startedAt,execution:outcomeWithoutEvaluation,target:copiedTarget,run:reviewRun,resource:pack,action:{kind:'rate',rating:'good'}}),'Memory Outcome admission requires a kernel-materialized assessment Evaluation');
 const corruptTarget=structuredClone(target),corruptMembership=corruptTarget.curriculumMemberships[0]!;corruptMembership.material.snapshot.contentDigest='corrupt';
 assert.equal(inspectLocalTargetReadiness(corruptTarget,corruptMembership,pack).status,'blocked','UI planning reads material facts instead of hard-coding ready');
 assert.equal(localLearningPurpose(copiedTarget),'initial_learning');
 assert.throws(()=>executeLocalProtocolTransition({execution:engine,target:copiedTarget,run:copiedRun,resource:pack,action:{kind:'reveal',extra:true} as any,at:copiedRun.startedAt}));
 copiedRun=executeLocalProtocolTransition({execution:engine,target:copiedTarget,run:copiedRun,resource:pack,action:{kind:'reveal'},at:copiedRun.startedAt}).run;
 const copiedResult=executeLocalProtocolTransition({execution:engine,target:copiedTarget,run:copiedRun,resource:pack,action:{kind:'rate',rating:'good'},at:copiedRun.startedAt});
 copiedRun=copiedResult.run;const copiedCompletion=copiedResult.transition;
 assert(copiedRun.protocolState.value.initial.progress.completed);
 assert.equal(copiedCompletion.settlement?.kind,'initial_learning_completion');
 assert.equal(copiedTarget.memoryRevision,0,'protocol adapters cannot write scheduler state');

 for(const definition of [LIGHTWEIGHT_EXPERIENCE_RECALL_STEP,LIGHTWEIGHT_EXPRESSION_REVEAL_STEP]){
  const presentation=assembleLightweightInitialPresentation({protocolStepInstanceId:id(),protocolRunId:id(),retentionTargetId:target.retentionId,ordinal:1,definition,materialBindings:copiedTarget.material.content.resources.filter(r=>definition.materialRequirements.some(m=>m.materialRoleKey===r.materialRoleKey)).map(r=>({materialRoleKey:r.materialRoleKey,resourceKey:r.resourceKey,learningMaterializationId:copiedTarget.material.snapshot.learningMaterializationId}))},copiedTarget.material);
  if(presentation.kind==='expression_reveal')assert.equal(presentation.slots.expressionPrimary.surface,'borrow');else assert(!JSON.stringify(presentation).includes('borrow'));
 }
 globalThis.fetch=async()=>{throw Error('Offline');};
 const at='2026-09-10T08:00:00.000Z';await assert.rejects(startLearning(id(),targetId!,languageContext,20,at));await confirmLearningQuantity(id(),languageContext,20);let run=await startLearning(id(),targetId!,languageContext,20,at);
 const homeRunning=await readHomeLearningProjection(languageContext.languageRouteId);assert.equal(homeRunning.dailyLimit,20);assert.equal(homeRunning.activeRun?.id,run.id);
 const committedTarget=(await readLearning()).targets.find(item=>item.id===targetId)!;
 assert(committedTarget.committedPolicy);assert.equal(committedTarget.committedPolicy.assignmentId,committedTarget.policyAssignment.assignmentId);
 assert.equal(run.participants[targetId!].policyCommitment.commitmentId,committedTarget.committedPolicy.commitmentId);
 assert.equal(run.participants[targetId!].resolvedPlan.readiness,'ready');
 assert.equal(run.participants[targetId!].resolvedPlan.protocolBinding.protocolVersion,run.protocolBinding.protocolVersion);
 assert.equal((await startLearning(id(),targetId!,languageContext,20,at)).id,run.id);
 const realDateNow=Date.now;Date.now=()=>Date.parse(at);
 const learningScene=await contentAnnotations.saveLearningScene({operationId:id(),learningTargetId:target.id,languageRouteId:languageContext.languageRouteId,curriculumMembershipId:target.curriculumMemberships[0]!.id,senseId:target.identity.senseId,senseVersionId:target.identity.senseVersionId,bindingVersionId:target.identity.bindingVersionId,body:'我在雨天向同事借了这把伞。',media:[]});
 Date.now=realDateNow;
 const declaration=id();await setLocalDeclaredMastery(declaration,targetId!,true,at);
 let paused=await readLearning();const pausedTarget=paused.targets.find(item=>item.id===targetId!)!,pausedRun=paused.runs.find(item=>item.id===run.id)!;
 assert(hasDeclaredMasteryOverride(pausedTarget));assert.equal(paused.active,undefined);assert.equal(pausedTarget.memory,null);assert.equal(pausedTarget.memoryRevision,0);assert.equal(paused.events.length,0);
 assert.equal(pausedRun.revision,run.revision+1);assert.equal(localRunOpenPlanningInterruption(pausedRun)?.operationId,declaration);
 await assert.rejects(actLearning(id(),pausedRun.id,pausedRun.revision,{kind:'reveal'},at));
 await assert.rejects(startLearning(id(),targetId!,languageContext,20,at));
 await setLocalDeclaredMastery(id(),targetId!,false,at);paused=await readLearning();assert(!hasDeclaredMasteryOverride(paused.targets.find(item=>item.id===targetId!)!));assert(localRunOpenPlanningInterruption(paused.runs.find(item=>item.id===run.id)!));
 run=await startLearning(id(),targetId!,languageContext,20,at);assert.equal(run.id,pausedRun.id);assert.equal(run.lifecycleEvents.length,2);assert.equal(localRunOpenPlanningInterruption(run),null);assert.equal((await readLearning()).events.length,0);assert.equal((await readLearning()).targets.find(item=>item.id===targetId!)!.memory,null);
 await assert.rejects(actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'},at));
 const reveal=id(),revealRevision=run.revision;run=await actLearning(reveal,run.id,revealRevision,{kind:'reveal'},at);
 assert.deepEqual((await readLearning()).events.find(event=>event.id===reveal)!.detail.personalLearningScene,{sceneId:learningScene.sceneId,revisionId:learningScene.revisions[0]!.revisionId,revision:1},'the action pins the exact learner scene revision used by the runtime');
 assert.equal(localLightweightPhase((await readLearning()).runs[0]!),'reveal');
 assert.equal((await actLearning(reveal,run.id,revealRevision,{kind:'reveal'},at)).revision,run.revision);
 const original=LibraryTransaction.prototype.put;
 LibraryTransaction.prototype.put=function(table,key,value){if(table==='learningEvents')throw Error('injected disk failure');return original.call(this,table,key,value);};
 await assert.rejects(actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'},at));LibraryTransaction.prototype.put=original;
 assert.equal((await readLearning()).targets[0]!.memory,null);assert.equal((await readLearning()).runs[0]!.revision,run.revision);
 const rating=id(),ratingRevision=run.revision;run=await actLearning(rating,run.id,ratingRevision,{kind:'rate',rating:'good'},at);
 await actLearning(rating,run.id,ratingRevision,{kind:'rate',rating:'good'},at);
 let learningState=await readLearning();assert.equal(learningState.targets[0]!.memoryRevision,1);
 const initialRetention=learningState.events.find(event=>event.id===rating)!.detail.transition.retention;
 assert.equal(initialRetention?.kind,'initial_learning_completion');
 if(initialRetention?.kind!=='initial_learning_completion')throw Error('missing initial completion');
 sensaInitialLearningCompletionSchema.parse(initialRetention.completion);sensaSchedulingHandoffSchema.parse(initialRetention.handoff);
 assert.equal(initialRetention.handoff.initialLearningCompletionId,initialRetention.completion.initialLearningCompletionId);
 await finishLearning(id(),run.id);
 await assert.rejects(startLearning(id(),targetId!,languageContext,20,at));
 const due=(await readLearning()).targets[0]!.memory!.dueAt.toISOString();run=await startLearning(id(),targetId!,languageContext,20,due);assert.equal(run.purpose,'retention_review');
 run=await actLearning(id(),run.id,run.revision,{kind:'reveal'},due);
 const reviewRating=id();run=await actLearning(reviewRating,run.id,run.revision,{kind:'rate',rating:'again'},due);assert(run.completedAt);await finishLearning(id(),run.id);
 const t=(await readLearning()).targets[0]!;assert.equal(t.memoryRevision,2);assert(t.relearnAt);
 const reviewEvent=(await readLearning()).events.find(event=>event.id===reviewRating)!;
 const reviewRetention=reviewEvent.detail.transition.retention;
 assert.equal(reviewRetention?.kind,'memory_outcome');if(reviewRetention?.kind!=='memory_outcome')throw Error('missing memory outcome');
 sensaMemoryOutcomeSnapshotSchema.parse(reviewRetention.outcome);sensaSchedulingDecisionSchema.parse(reviewRetention.schedulingDecision);
 assert.equal(reviewRetention.schedulingDecision.memoryOutcomeId,reviewRetention.outcome.memoryOutcomeId);
 assert.equal(reviewRetention.outcome.evaluationId,reviewEvent.detail.formalEvaluation?.evaluation.evaluationId,'the kernel owns the Evaluation identity consumed by Memory Outcome');
 await assert.rejects(startLearning(id(),targetId!,languageContext,20,due));
 run=await startLearning(id(),targetId!,languageContext,20,t.relearnAt!);assert.equal(run.purpose,'relearning');
 run=await actLearning(id(),run.id,run.revision,{kind:'reveal'},t.relearnAt!);const relearningRating=id();run=await actLearning(relearningRating,run.id,run.revision,{kind:'rate',rating:'good'},t.relearnAt!);
 assert.equal((await readLearning()).targets[0]!.memoryRevision,2);assert.equal((await readLearning()).targets[0]!.relearnAt,null);
 const relearningRetention=(await readLearning()).events.find(event=>event.id===relearningRating)!.detail.transition.retention;
 assert.equal(relearningRetention?.kind,'relearning_completion');if(relearningRetention?.kind!=='relearning_completion')throw Error('missing relearning completion');sensaRelearningCompletionSchema.parse(relearningRetention.completion);
 await finishLearning(id(),run.id);
 // Daily admission and explicit sign-out remain enforced while fetch is unavailable.
 const extra={...bundle,id:id(),entries:[{...entry,senseVersionId:id(),bindingVersionId:id()}]};
 const extraPack=await installPackage(new TextEncoder().encode(JSON.stringify(extra)));const [extraId]=await enrollPackage(id(),extraPack.key,languageContext);
 await confirmLearningQuantity(id(),languageContext,1);await assert.rejects(startLearning(id(),extraId!,languageContext,1,at));
 await command({id:id(),kind:'fixture.signout',input:{}},async tx=>{tx.put('meta','signed-out',true);});
 await assert.rejects(enrollPackage(id(),extraPack.key,languageContext));await assert.rejects(startLearning(id(),extraId!,languageContext,1,'2026-09-11T08:00:00.000Z'));
 const corrupted=structuredClone(bundle);corrupted.entries[0]!.content.resources[0]!.contentDigest='invalid';await assert.rejects(installPackage(new TextEncoder().encode(JSON.stringify(corrupted))));
 assert.equal(canonicalJsonDigest((await readLearning()).targets[0]!.curriculumMemberships[0]!.material.content),canonicalJsonDigest(entry.content));

 await command({id:id(),kind:'fixture.resume',input:{}},async tx=>tx.delete('meta','signed-out'));
 const rich=structuredClone(bundle);rich.id=id();rich.entries[0]!.senseVersionId=id();rich.entries[0]!.bindingVersionId=id();
 const cue=rich.entries[0]!.content.resources.find(r=>r.materialRoleKey==='experience_recall_cue')!;
 cue.contentPayload={scene:'',senseFocus:'临时使用并归还',images:[{id:id(),name:'context.jpg',dataUrl:'data:image/jpeg;base64,/9j/2Q=='}],html:'<button data-action="toggle" data-target="cue">Hint</button><p id="cue" hidden>Imagine this moment.</p>'};cue.contentDigest=canonicalJsonDigest(cue.contentPayload);
 const richPack=await installPackage(new TextEncoder().encode(JSON.stringify(rich)));const [richId]=await enrollPackage(id(),richPack.key,languageContext);const richTarget=(await readLearning()).targets.find(t=>t.id===richId)!,richMembership=richTarget.curriculumMemberships[0]!;
 const definition=LIGHTWEIGHT_EXPERIENCE_RECALL_STEP;
 const richPresentation=assembleLightweightInitialPresentation({protocolStepInstanceId:id(),protocolRunId:id(),retentionTargetId:richTarget.retentionId,ordinal:1,definition,materialBindings:richMembership.material.content.resources.filter(r=>definition.materialRequirements.some(m=>m.materialRoleKey===r.materialRoleKey)).map(r=>({materialRoleKey:r.materialRoleKey,resourceKey:r.resourceKey,learningMaterializationId:richMembership.material.snapshot.learningMaterializationId}))},richMembership.material);
 assert.equal(richPresentation.kind,'experience_recall');if(richPresentation.kind==='experience_recall'){assert.equal(richPresentation.slots.experienceSketch.images?.length,1);assert(richPresentation.slots.experienceSketch.html?.includes('data-action'));}
 // A Session pins its Route context. Changing this surface's active selection
 // affects the next journey, never the material already running.
 await confirmLearningQuantity(id(),languageContext,20);
 let pinnedRun=await startLearning(id(),richId!,languageContext,20,'2026-09-11T08:00:00.000Z');
 const frenchRoute=await addLanguageRoute(id(),'fr','en');await setActiveLanguageRoute(id(),frenchRoute.id);
 assert.deepEqual(pinnedRun.languageContext,languageContext);
 pinnedRun=await actLearning(id(),pinnedRun.id,pinnedRun.revision,{kind:'reveal'},'2026-09-11T08:00:00.000Z');
 pinnedRun=await actLearning(id(),pinnedRun.id,pinnedRun.revision,{kind:'rate',rating:'good'},'2026-09-11T08:00:00.000Z');
 assert.deepEqual(pinnedRun.participants[richId!].languageContext,languageContext);
 await finishLearning(id(),pinnedRun.id);
 const unsafe=structuredClone(rich);unsafe.id=id();const unsafeCue=unsafe.entries[0]!.content.resources.find(r=>r.materialRoleKey==='experience_recall_cue')!;unsafeCue.contentPayload={scene:'scene',senseFocus:'meaning',html:'<script>fetch("https://example.org")</script>'};unsafeCue.contentDigest=canonicalJsonDigest(unsafeCue.contentPayload);await assert.rejects(installPackage(new TextEncoder().encode(JSON.stringify(unsafe))));
 // A package names the languages its own text is in, and every target it
 // enrolls carries them, so material provisioned from a Spanish package can
 // never be stamped with the English one the product happens to ship.
 const spanishContent=provisionLightweightInitialContent({learnerUserId:identity.learnerId,learningTargetId:id(),senseId:id(),senseVersionId:id(),senseExpressionBindingId:id(),resolvedLearningPlanRevisionId:'fixture-es-v1',expressionSourceVersion:'fixture-es-v1',senseSourceVersion:'fixture-es-v1',expression:{surface:'tomarse su tiempo',languageTag:'es',expressionKind:'phrase'},sense:{meaning:'从容地花时间做一件事。',supportLanguageTag:'zh-CN'},originExperience:{source:'other_authoritative_source',sourceVersion:'fixture-es-v1',personalAnchorUseGrantId:null,experience:{scene:'朋友催你快点，你说这件事需要慢慢来。',senseFocus:'从容地花时间',featureLabels:[]}},referenceFacts:[],requestedAt:new Date().toISOString()});
 assert.equal(spanishContent.status,'ready');if(spanishContent.status!=='ready')throw Error();
 const spanishBundle={...bundle,id:id(),title:'合成西语验证包',targetLanguage:'es',entries:[{...entry,senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:'tomarse su tiempo',meaning:'从容地花时间做一件事。',content:spanishContent.materialization.content}]};
 const spanishPack=await installPackage(new TextEncoder().encode(JSON.stringify(spanishBundle)));
 const spanishRoute=await addLanguageRoute(id(),'es','zh-CN'),spanishContext=sensaPinnedLanguageContext(spanishRoute);
 const [spanishTargetId]=await enrollPackage(id(),spanishPack.key,spanishContext);
 const learning=await readLearning();
 assert.equal(learning.targets.find(t=>t.id===spanishTargetId!)!.targetLanguageTag,'es','an enrolled target carries the package language, not the shipped one');
 assert.equal(learning.targets.find(t=>t.id===spanishTargetId!)!.curriculumMemberships[0]!.languageContext.supportLanguageTag,'zh-CN');
 assert.equal(learning.targets.find(t=>t.id===targetId!)!.targetLanguageTag,'en','the English package still enrolls English targets');
 // Target and Support may intentionally be the same in an immersion package;
 // the package does not infer learner proficiency from that choice.
 const immersion=await installPackage(new TextEncoder().encode(JSON.stringify({...spanishBundle,id:id(),supportLanguage:'es'})));
 assert.equal(immersion.bundle.targetLanguage,immersion.bundle.supportLanguage);

 // The same Learning Target may be taught through another Support Language.
 // It gains another Membership and rendering; Retention identity is not split.
 const japaneseMaterial=provisionLightweightInitialContent({learnerUserId:identity.learnerId,learningTargetId:id(),senseId:entry.senseId,senseVersionId:entry.senseVersionId,senseExpressionBindingId:entry.bindingId,resolvedLearningPlanRevisionId:'fixture-ja-v1',expressionSourceVersion:'fixture-ja-v1',senseSourceVersion:'fixture-ja-v1',expression:{surface:'borrow',languageTag:'en',expressionKind:'word'},sense:{meaning:'一時的に借りて、後で返す。',supportLanguageTag:'ja'},originExperience:{source:'other_authoritative_source',sourceVersion:'fixture-ja-v1',personalAnchorUseGrantId:null,experience:{scene:'同僚から傘を借り、翌日に返す。',senseFocus:'一時的に借りる',featureLabels:[]}},referenceFacts:[],requestedAt:new Date().toISOString()});
 assert.equal(japaneseMaterial.status,'ready');if(japaneseMaterial.status!=='ready')throw Error();
 const japaneseRoute=await addLanguageRoute(id(),'en','ja'),japaneseContext=sensaPinnedLanguageContext(japaneseRoute);
 const japaneseBundle={...bundle,id:id(),title:'English through Japanese',supportLanguage:'ja',entries:[{...entry,meaning:'一時的に借りて、後で返す。',content:japaneseMaterial.materialization.content}]};
 const japanesePack=await installPackage(new TextEncoder().encode(JSON.stringify(japaneseBundle)));
 const targetCount=(await readLearning()).targets.length;
 const [sameTargetId]=await enrollPackage(id(),japanesePack.key,japaneseContext);
 const shared=(await readLearning()).targets.find(item=>item.id===targetId!)!;
 assert.equal(sameTargetId,targetId);assert.equal((await readLearning()).targets.length,targetCount,'another Support Language does not duplicate the Learning Target');
 assert.equal(shared.curriculumMemberships.length,2);
 assert.deepEqual(shared.curriculumMemberships.map(item=>item.languageContext.supportLanguageTag).sort(),['ja','zh-CN']);
 assert.equal(localCurriculumMeaning(shared.curriculumMemberships.find(item=>item.languageContext.supportLanguageTag==='ja')!),'一時的に借りて、後で返す。');
 assert.equal(shared.retentionId,target.retentionId,'both Route memberships share Retention identity');

 // A downloaded Book Version is applied explicitly. Stable target identities
 // retain progress, removed members leave future planning, and an open Session
 // stays pinned to the Membership and material with which it began.
 const bookId=id(),retained={...entry,senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id()},removed={...entry,senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id()};
 const release=(versionNumber:number,bookVersionId:string,contentReleaseId:string,entries:typeof bundle.entries,changeSummary:string)=>({format:'sensa-book-release-bundle-v1' as const,book:{bookId,bookKey:'update-smoke',bookVersionId,versionNumber,title:'更新验证书',description:'验证不可变版本的应用语义。'},contentRelease:{contentReleaseId,versionNumber,schemaVersion:'sensa-consumer-content-v1'},targetLanguage:'en',supportLanguage:'zh-CN',publishedAt:`2026-09-${10+versionNumber}T00:00:00.000Z`,changeSummary,entries:entries.map(item=>({...item,semantic:{senseKey:`fixture:${item.senseId}`,senseVersionNumber:1,semanticPolicyVersion:'fixture-v1',semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1' as const,coreMeaningFocus:item.meaning,prototypeScenes:[{summary:item.meaning,participantRoles:[],states:[],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]},expressionId:stableUuid(`fixture-expression:${item.bindingId}`),expressionVersionId:stableUuid(`fixture-expression-version:${item.bindingVersionId}`),expressionType:'word' as const,expressionVersionNumber:1,expressionStructure:{},bindingVersionNumber:1,relation:'realizes' as const,semanticCoverage:'exact' as const,registerLabel:null,usageConstraints:[]}}))});
 const firstBookVersion=id(),firstContentRelease=id(),firstRelease=release(1,firstBookVersion,firstContentRelease,[retained,removed],'首次发布');
 const firstBytes=new TextEncoder().encode(JSON.stringify(firstRelease)),firstInstalled=await installPackage(firstBytes),[retainedId,removedId]=await enrollPackage(id(),firstInstalled.key,languageContext);
 const beforeUpdate=(await readLearning()).targets.find(item=>item.id===retainedId!)!,beforeMembership=localCurriculumMembershipForContext(beforeUpdate,languageContext)!;
 await confirmLearningQuantity(id(),languageContext,20);const updateRun=await startLearning(id(),retainedId!,languageContext,20,'2026-09-12T08:00:00.000Z');
 assert.equal(updateRun.participants[retainedId!]!.curriculumMembershipId,beforeMembership.id);
 const retainedV2=structuredClone(retained),recallCue=retainedV2.content.resources.find(resource=>resource.materialRoleKey==='experience_recall_cue')!;
 recallCue.contentPayload={...(recallCue.contentPayload as Record<string,unknown>),images:[{id:id(),name:'new-context.jpg',dataUrl:'data:image/jpeg;base64,/9j/2Q=='}]};recallCue.contentDigest=canonicalJsonDigest(recallCue.contentPayload);
 const added={...entry,senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id()},secondBookVersion=id(),secondContentRelease=id(),secondRelease=release(2,secondBookVersion,secondContentRelease,[retainedV2,added],'补充场景图片并调整范围');
 const secondInstalled=await installPackage(new TextEncoder().encode(JSON.stringify(secondRelease)));const [sameRetainedId,addedId]=await enrollPackage(id(),secondInstalled.key,languageContext);
 assert.equal(sameRetainedId,retainedId,'unchanged Sense and Binding versions preserve the Learning Target');
 const afterApply=await readLearning(),retainedTarget=afterApply.targets.find(item=>item.id===retainedId!)!,removedTarget=afterApply.targets.find(item=>item.id===removedId!)!,addedTarget=afterApply.targets.find(item=>item.id===addedId!)!,currentMembership=localCurriculumMembershipForContext(retainedTarget,languageContext)!;
 assert.equal(retainedTarget.retentionId,beforeUpdate.retentionId);assert.equal(retainedTarget.memoryRevision,beforeUpdate.memoryRevision);assert.equal(currentMembership.packageKey,secondInstalled.key);assert.equal(currentMembership.provenance.bookVersionId,secondBookVersion);assert.equal(beforeMembership.status,'active');assert.equal(retainedTarget.curriculumMemberships.find(item=>item.id===beforeMembership.id)?.status,'superseded');
 assert.equal(localCurriculumMembershipForContext(removedTarget,languageContext),undefined,'a removed member leaves future planning without deleting its target or history');assert(localCurriculumMembershipForContext(addedTarget,languageContext));
 const stillOpen=(await readLearning()).runs.find(item=>item.id===updateRun.id)!;assert.equal(stillOpen.participants[retainedId!]!.curriculumMembershipId,beforeMembership.id);assert.equal(stillOpen.participants[retainedId!]!.material.snapshot.provenance.bookVersionId,firstBookVersion);assert.equal(currentMembership.material.snapshot.provenance.bookVersionId,secondBookVersion);
 const japaneseRelease={...secondRelease,supportLanguage:'ja',entries:[{...secondRelease.entries[0]!,meaning:'一時的に借りて、後で返す。',content:japaneseMaterial.materialization.content}]};const japaneseBookInstalled=await installPackage(new TextEncoder().encode(JSON.stringify(japaneseRelease)));
 assert.notEqual(japaneseBookInstalled.key,secondInstalled.key,'the same Book Version can install separate exact language-pair Bundles');await enrollPackage(id(),japaneseBookInstalled.key,japaneseContext);const multilingualTarget=(await readLearning()).targets.find(item=>item.id===retainedId!)!;assert(localCurriculumMembershipForContext(multilingualTarget,languageContext));assert(localCurriculumMembershipForContext(multilingualTarget,japaneseContext));

 // Continuing a learning journey must never publish the empty active-Run state
 // between the completed word and its successor; that state renders the
 // runtime's unavailable fallback for a frame.
 let completedUpdateRun=await actLearning(id(),updateRun.id,updateRun.revision,{kind:'reveal'},'2026-09-12T08:00:00.000Z');
 completedUpdateRun=await actLearning(id(),completedUpdateRun.id,completedUpdateRun.revision,{kind:'rate',rating:'good'},'2026-09-12T08:00:00.000Z');
 assert(completedUpdateRun.completedAt);
 const activeSnapshots:Array<string|undefined>=[],snapshotReads:Promise<void>[]=[];
 const stopObserving=observeLibrary(()=>{snapshotReads.push(readLearning().then(snapshot=>{activeSnapshots.push(snapshot.active);}));});
 const continuedRun=await continueLearning(id(),completedUpdateRun.id,addedId!,languageContext,20,'2026-09-12T08:00:00.000Z');
 await Promise.all(snapshotReads);stopObserving();
 assert.deepEqual(activeSnapshots,[continuedRun.id],'the next-word transition published an empty active Run and exposed the unavailable fallback');

 console.log('PASS: verified download/import, immutable Book updates, explicit enrollment, progress preservation, removed-member planning, open-Session pinning, declared-mastery interruption/resume, local learning/replay and rollback; memory storage Adapter, no browser/model calls.');
}finally{globalThis.fetch=realFetch;}
