/** Actual Intake, teacher, provisioning and runtime functions; fake IDB and bounded model transport. */
import assert from 'node:assert/strict';
import {makeRequest,requestLanguages,generationSystem,independentReviewSystem,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND} from '@sensa/contracts/sensa';
import {indexedDB,IDBFactory} from 'fake-indexeddb';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const compiled=await build({stdin:{contents:['store','intake','teacher','providers','personalLearning','learning','drafts','backup','packages','backupValidation','dataControl','language'].map(n=>`export * from './apps/web/src/data/library/${n}';`).join('\n'),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'}});
Object.assign(globalThis,{indexedDB,window:new EventTarget(),location:{origin:'http://127.0.0.1:9998'},BroadcastChannel:undefined});
const temp=await mkdtemp(join(tmpdir(),'sensa-personal-'));await writeFile(join(temp,'core.mjs'),compiled.outputFiles[0]!.text);
const api=await import(pathToFileURL(join(temp,'core.mjs')).href);
const id=()=>crypto.randomUUID(),library=await api.openLibrary(),accountId=id();await api.command({id:id(),kind:'fixture.owner',input:{}},async(tx:any)=>tx.put('meta','service-owner',{subject:accountId,accountId}));
const languageContext=(await api.languageRoutesSnapshot()).context;
const provider=await api.saveProvider(id(),{id:id(),expectedRevision:0,name:'Fixture',kind:'compatible',endpoint:'https://fixture.invalid/v1',model:'fixture'},'fixture-secret');
for(const purpose of ['teacher','content','review']){const {settings}=await api.providerSnapshot();await api.assignProvider(id(),purpose,provider.id,settings.revision);}
const proposal={explanation:'临时使用并归还。',expression:{surface:'borrow',type:'word',language:'en'},semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'临时取得他人物品，并预期归还。',prototypeScenes:[{summary:'一个人向同伴借用物品，约好稍后归还。',participantRoles:['借用者','所有者'],states:['临时使用'],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]}};
const raw=()=>({version:'sensa-intake-v1',libraryId:library.id,clientId:id(),operationId:id(),languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},snapshot:{sentence:'Private marker: May asked to borrow an umbrella.',language:'en',languageSource:'detector',languageConfidence:.9,source:{url:'https://example.org/article',title:'Private fixture',capturedAt:new Date().toISOString()},expression:{text:'borrow',start:29,end:35}},resolution:null,acceptance:null});
const calls:any[]=[];let holdTeacher=false;let mode:'good'|'reject'|'review-fail'|'hold'|'leak'='good',teacherTurn=0,release:(()=>void)|undefined,arrived:(()=>void)|undefined;
const realFetch=globalThis.fetch;globalThis.fetch=async(_url,input)=>{const body=JSON.parse(String(input?.body));calls.push(body);let value:unknown;
 if(body.tools){if(holdTeacher)await new Promise<void>(resolve=>{release=resolve;arrived?.();});teacherTurn++;value={model:'fixture',choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:id(),type:'function',function:teacherTurn===1?{name:'ask_learner',arguments:JSON.stringify({question:'是否需要归还这件物品？'})}:{name:'propose_meaning',arguments:JSON.stringify(proposal)}}]}}]};}
 else{const review=body.messages[0].content.includes('independent Sensa');if(review&&mode==='review-fail')throw Error('Offline');if(!review&&mode==='hold'){await new Promise<void>(resolve=>{release=resolve;arrived?.();});}
 const result=review?{accepted:mode!=='reject',reason:mode==='reject'?'场景改变了原意':'符合固定含义与来源'}:{scene:(mode==='leak'||mode==='review-fail'&&body.messages.length===2)?'一个人想要 borrow 一把雨伞。':'一个人向同伴临时借用一把雨伞，约好之后归还。',senseFocus:'临时使用并预期归还'};
 value={model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]};}
 return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});};
const taskForMeaning=async(meaningId:string)=>(await api.personalLearningSnapshot()).find((task:any)=>task.meaningId===meaningId&&task.languageContext.languageRouteId===languageContext.languageRouteId);
const prepare=async(meaningId:string)=>api.preparePersonal((await taskForMeaning(meaningId)).id,provider,await api.selectedReviewProvider(),new AbortController().signal,()=>{});
/** One pinned language context used throughout this fixture. */
const languages={supportLanguageTag:'zh-CN',targetLanguageTag:'en'};
assert.equal(await api.selectedReviewProvider(),null);

try{
 const slow=raw();await api.receiveWebIntake(accountId,slow);await assert.rejects(api.enrollPersonal(id(),slow.operationId,languageContext,false));const draft=await api.readLibrary((tx:any)=>tx.get('drafts',slow.operationId));let session=await api.createTeacher(id(),draft,languages);await api.continueTeacher(session.id,provider,new AbortController().signal,()=>{});session=await api.getTeacher(session.id);assert.equal(session.status,'waiting');await api.sayToTeacher(id(),session.id,session.revision,'是的，需要归还。');await api.continueTeacher(session.id,provider,new AbortController().signal,()=>{});session=await api.getTeacher(session.id);assert.equal(session.status,'proposal');assert.equal((await api.readLearning()).targets.length,0);
 const meaning=await api.acceptTeacher(id(),session.id,session.revision);assert.equal((await api.personalLearningSnapshot()).length,0);await api.enrollPersonal(id(),meaning.id,languageContext,false);await api.enrollPersonal(id(),meaning.id,languageContext,false);assert.equal((await api.personalLearningSnapshot()).length,1);assert.equal((await api.readLearning()).targets.length,0);
 const defaultBefore=calls.length;mode='leak';await prepare(meaning.id);
 assert.equal(calls.length-defaultBefore,3,'Rejected candidates exhaust the bounded generator feedback loop without model review');
 assert.equal((await api.personalLearningSnapshot())[0].status,'rejected','Code validator blocks target-expression leakage without model review');
 assert.equal((await api.readLearning()).targets.length,0);
 await api.setModelReviewEnabled(id(),true,(await api.providerSnapshot()).settings.revision);
 const before=calls.length;mode='review-fail';await assert.rejects(prepare(meaning.id));assert.equal(calls.length-before,3);assert(!JSON.stringify(calls.slice(before)).includes('Private marker'));assert.equal((await api.readLearning()).targets.length,0);
 mode='good';await prepare(meaning.id);assert.equal(calls.length-before,4,'Retry must reuse saved candidate and call only the reviewer');let task=(await api.personalLearningSnapshot())[0];assert.equal(task.status,'ready');const learning=await api.readLearning(),learningMaterial=learning.targets[0].curriculumMemberships.find((membership:any)=>membership.id===task.curriculumMembershipId).material;assert.equal(learning.targets.length,1);assert.equal(learning.runs.length,0);assert.equal(learningMaterial.snapshot.provisioningPath,'on_demand');assert.equal(learningMaterial.snapshot.personalAnchorUseGrantIds.length,0);
 await api.confirmLearningQuantity(id(),languageContext,20);let run=await api.startLearning(id(),task.targetId,languageContext,20);run=await api.actLearning(id(),run.id,run.revision,{kind:'reveal'});run=await api.actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'});assert.equal((await api.readLearning()).targets[0].memoryRevision,1);
 // Fast-track acceptance is independent from membership and supports explicit source consent.
 const fastRaw=raw();fastRaw.snapshot.sentence='Private marker: May offered to lend an umbrella.';fastRaw.snapshot.expression={text:'lend',start:31,end:35};const fast={...fastRaw,resolution:{kind:'proposal',proposal:{...proposal,expression:{...proposal.expression,surface:'lend'}}},acceptance:{kind:'direct',consent:'accept_context_expression_sense',authorization:'browser:explicit_accept_button'}};await api.receiveWebIntake(accountId,fast);const fastMeaning=(await api.listMeanings()).find((m:any)=>m.draftId===fast.operationId);await api.enrollPersonal(id(),fastMeaning.id,languageContext,true);mode='reject';await prepare(fastMeaning.id);const fastTask=(await api.personalLearningSnapshot()).find((t:any)=>t.meaningId===fastMeaning.id);assert.equal(fastTask.status,'rejected');assert.equal((await api.readLearning()).targets.length,1);assert(JSON.stringify(calls.at(-1)).includes('Private marker'));
 // A cancellation fences a late generator, even if its HTTP implementation ignores abort.
 mode='hold';const held=new Promise<void>(resolve=>{arrived=resolve;});const work=prepare(fastMeaning.id);await held;await api.stopPersonalPreparation(id(),(await taskForMeaning(fastMeaning.id)).id);release!();await assert.rejects(work);assert.equal((await api.readLearning()).targets.length,1);
 // A failed final write cannot publish a ready material or leak a partial target.
 mode='good';const put=api.LibraryTransaction.prototype.put;api.LibraryTransaction.prototype.put=function(table:any,key:any,value:any){if(table==='learningTargets')throw Error('injected disk error');return put.call(this,table,key,value);};await assert.rejects(prepare(fastMeaning.id));api.LibraryTransaction.prototype.put=put;assert.equal((await api.readLearning()).targets.length,1);
 await api.setModelReviewEnabled(id(),false,(await api.providerSnapshot()).settings.revision);
 assert.equal(await api.selectedReviewProvider(),null);const beforeCodeOnly=calls.length;await prepare(fastMeaning.id);assert.equal(calls.length,beforeCodeOnly,'Disabling model review reuses the saved candidate with zero model calls');
 const codeAttempt=await api.readLibrary(async(tx:any)=>(await tx.all('contentAttempts')).find((a:any)=>a.status==='ready'&&a.reviewProvider===null));assert.equal(codeAttempt.review,null);assert(codeAttempt.validation.content);assert.equal((await api.readLearning()).targets.length,2);
 const dump=JSON.stringify(await api.readLibrary(async(tx:any)=>({attempts:await tx.all('contentAttempts'),tasks:await tx.all('personalLearning')})));assert(!dump.includes('fixture-secret'));

 // Updating learner-owned material refreshes a current, not-yet-acted Step.
 // The Run plan remains pinned, while each acted Step records what was shown.
 await api.finishLearning(id(),run.id);
 const readyFastTask=await taskForMeaning(fastMeaning.id);assert.equal(readyFastTask.status,'ready');
 let materialRun=await api.startLearning(id(),readyFastTask.targetId,languageContext,20);
 const materialParticipant=materialRun.participants[readyFastTask.targetId];
 const baselineMaterialId=materialParticipant.material.snapshot.learningMaterializationId;
 const originalStep=Object.entries(materialParticipant.presentedMaterials)[0] as [string,any];assert(originalStep);
 const materialRunRevision=materialRun.revision;
 await api.updateMeaningContext(id(),fastMeaning.id,1,'Updated fast context.',[{id:id(),name:'learner-context.jpg',dataUrl:'data:image/jpeg;base64,/9j/2Q=='}]);
 await api.requestPersonalResourceUpdate(id(),readyFastTask.id,languageContext,true);await prepare(fastMeaning.id);
 materialRun=(await api.readLearning()).runs.find((candidate:any)=>candidate.id===materialRun.id);
 const refreshedStep=materialRun.participants[readyFastTask.targetId].presentedMaterials[originalStep[0]];
 assert.equal(materialRun.revision,materialRunRevision+1,'Publishing material invalidates the stale UI revision');
 const refreshEvent=materialRun.lifecycleEvents.at(-1);assert.equal(refreshEvent.kind,'current_step_material_refreshed');assert.equal(refreshEvent.stepId,originalStep[0]);
 assert.equal(refreshedStep.content.resources.find((resource:any)=>resource.materialRoleKey==='experience_recall_cue').contentPayload.images.length,1);
 assert.notEqual(refreshedStep.snapshot.learningMaterializationId,baselineMaterialId,'The unacted Step adopts a purpose-specific revision of the new material');
 assert.equal(materialRun.participants[readyFastTask.targetId].material.snapshot.learningMaterializationId,baselineMaterialId,'The resolved Run plan keeps its original baseline');
 const revealMaterial=id();materialRun=await api.actLearning(revealMaterial,materialRun.id,materialRun.revision,{kind:'reveal'});
 const revealEvent=(await api.readLearning()).events.find((event:any)=>event.id===revealMaterial);
 assert.equal(revealEvent.detail.materializationId,refreshedStep.snapshot.learningMaterializationId,'The action history pins the material actually shown');
 const nextStep=Object.entries(materialRun.participants[readyFastTask.targetId].presentedMaterials).at(-1) as [string,any];
 assert.notEqual(nextStep[0],originalStep[0]);assert.equal(nextStep[1].snapshot.contentDigest,refreshedStep.snapshot.contentDigest,'The following Step resolves the newest compatible material too');
 materialRun=await api.actLearning(id(),materialRun.id,materialRun.revision,{kind:'rate',rating:'good'});await api.finishLearning(id(),materialRun.id);

 const previousTarget=(await api.readLearning()).targets.find((t:any)=>t.id===learning.targets[0].id);
 const previousMembership=previousTarget.curriculumMemberships.find((membership:any)=>membership.id===task.curriculumMembershipId);
 const edited=await api.updateMeaningContext(id(),meaning.id,1,'Updated private context.',[{id:id(),name:'context.jpg',dataUrl:'data:image/jpeg;base64,/9j/2Q=='}]);
 await assert.rejects(api.updateMeaningContext(id(),meaning.id,1,'Stale edit',[]));
 assert.equal(edited.senseVersionId,meaning.senseVersionId);assert.equal((await api.readLearning()).targets.find((t:any)=>t.id===previousTarget.id).curriculumMemberships.find((membership:any)=>membership.id===task.curriculumMembershipId).material.snapshot.learningMaterializationId,previousMembership.material.snapshot.learningMaterializationId);
 await api.requestPersonalResourceUpdate(id(),task.id,languageContext,true);await prepare(meaning.id);
 const updatedTarget=(await api.readLearning()).targets.find((t:any)=>t.id===previousTarget.id);
 const updatedMembership=updatedTarget.curriculumMemberships.find((membership:any)=>membership.id===task.curriculumMembershipId);
 assert.equal(updatedTarget.memoryRevision,previousTarget.memoryRevision);assert.deepEqual(updatedTarget.memory,previousTarget.memory);assert.notEqual(updatedMembership.material.snapshot.learningMaterializationId,previousMembership.material.snapshot.learningMaterializationId);
 assert.equal(updatedMembership.material.content.resources.find((r:any)=>r.materialRoleKey==='experience_recall_cue').contentPayload.images.length,1);
 const pinnedRun=(await api.readLearning()).runs.find((r:any)=>r.targetId===previousTarget.id);
 assert.notEqual(pinnedRun.participants[previousTarget.id].material.snapshot.learningMaterializationId,updatedMembership.material.snapshot.learningMaterializationId,'A Run owns its purpose-specific Materialization identity');
 assert.equal(pinnedRun.participants[previousTarget.id].material.snapshot.contentDigest,previousMembership.material.snapshot.contentDigest,'A later Curriculum refresh cannot rewrite the Run material bytes');
 assert.deepEqual(pinnedRun.participants[previousTarget.id].resolvedPlan.learningMaterializationIds,[pinnedRun.participants[previousTarget.id].material.snapshot.learningMaterializationId]);
 if(process.argv.includes('--backup')){
  // Include published resources, review/relearning history and a resumable reveal step.
  await api.finishLearning(id(),run.id);
  const content=(await api.readLearning()).targets.find((t:any)=>t.id===run.targetId).curriculumMemberships.find((membership:any)=>membership.id===task.curriculumMembershipId).material.content;
  const pack=await api.installPackage(new TextEncoder().encode(JSON.stringify({format:'sensa-learning-package-v1',id:id(),version:'1',title:'Backup fixture',targetLanguage:'en',supportLanguage:'zh-CN',entries:[{senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:'borrow',meaning:proposal.semanticSpec.coreMeaningFocus,content}]})));
  const [packageTarget]=await api.enrollPackage(id(),pack.key,languageContext);
  let packageRun=await api.startLearning(id(),packageTarget,languageContext,20);
  packageRun=await api.actLearning(id(),packageRun.id,packageRun.revision,{kind:'reveal'});packageRun=await api.actLearning(id(),packageRun.id,packageRun.revision,{kind:'rate',rating:'good'});await api.finishLearning(id(),packageRun.id);
  const due=(await api.readLearning()).targets.find((t:any)=>t.id===packageTarget).memory.dueAt.toISOString();packageRun=await api.startLearning(id(),packageTarget,languageContext,20,due);
  packageRun=await api.actLearning(id(),packageRun.id,packageRun.revision,{kind:'reveal'},due);packageRun=await api.actLearning(id(),packageRun.id,packageRun.revision,{kind:'rate',rating:'again'},due);await api.finishLearning(id(),packageRun.id);
  const relearnAt=(await api.readLearning()).targets.find((t:any)=>t.id===packageTarget).relearnAt;packageRun=await api.startLearning(id(),packageTarget,languageContext,20,relearnAt);packageRun=await api.actLearning(id(),packageRun.id,packageRun.revision,{kind:'reveal'},relearnAt);
  await api.setLocalDeclaredMastery(id(),packageTarget,true,relearnAt);
  const interruptedRun=(await api.readLearning()).runs.find((r:any)=>r.id===packageRun.id);assert.equal(interruptedRun.lifecycleEvents.at(-1).kind,'interrupted_by_planning_override');assert.equal((await api.readLearning()).active,undefined);
  const inFlightDraft=await api.saveDraft(id(),{id:id(),expectedRevision:0,text:'An interrupted clarification'}),inFlightSession=await api.createTeacher(id(),inFlightDraft,languages);
  holdTeacher=true;const teacherArrived=new Promise<void>(resolve=>{arrived=resolve;});const teacherWork=api.continueTeacher(inFlightSession.id,provider,new AbortController().signal,()=>{});await teacherArrived;
  const password='local-backup-test-password', exported=await api.exportLibraryBackup(password);
  assert.equal(exported.summary.interrupted,1);await api.stopTeacher(id(),inFlightSession.id,(await api.getTeacher(inFlightSession.id)).revision);release!();await assert.rejects(teacherWork);holdTeacher=false;
  const sourceRows=await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
  api.validateBackupRows(sourceRows);const invalid=structuredClone(sourceRows);invalid.learningTargets.find((r:any)=>r.value.id===packageTarget).value.memoryRevision++;assert.throws(()=>api.validateBackupRows(invalid));

  assert(!new TextDecoder().decode(exported.file).includes('Private marker'));
  assert.equal((await api.inspectLibraryBackup(exported.file,password)).targets,3);
  await assert.rejects(api.inspectLibraryBackup(exported.file,'wrong-password'));
  const damaged=exported.file.slice();damaged[damaged.length-10]^=1;await assert.rejects(api.inspectLibraryBackup(damaged,password));
  await assert.rejects(api.restoreLibraryBackup(exported.file,password),/libraryBackup.errors.occupied/);
  const source=await api.readLearning();
  Object.assign(globalThis,{indexedDB:new IDBFactory()});
  let restored=await import(pathToFileURL(join(temp,'core.mjs')).href+'?fresh');
  const fresh=await restored.openLibrary();
  const owner=async(subject:string)=>restored.command({id:id(),kind:'service.fixture',input:{subject}},async(tx:any)=>tx.put('meta','service-owner',{subject,accountId:subject}));
  await owner(id());await assert.rejects(restored.restoreLibraryBackup(exported.file,password),/libraryBackup.errors.accountMismatch/);
  await owner(accountId);
  const originalPut=restored.LibraryTransaction.prototype.put;
  restored.LibraryTransaction.prototype.put=function(table:any,key:any,value:any){if(table==='learningEvents')throw Error('injected disk error');return originalPut.call(this,table,key,value);};
  await assert.rejects(restored.restoreLibraryBackup(exported.file,password),/disk error/);
  restored.LibraryTransaction.prototype.put=originalPut;
  assert.equal((await restored.readLearning()).targets.length,0);
  await restored.restoreLibraryBackup(exported.file,password);
  await assert.rejects(restored.openLibrary(),/libraryReplaced/);
  restored=await import(pathToFileURL(join(temp,'core.mjs')).href+'?reopened');
  await restored.openLibrary();
  assert.deepEqual(await restored.readLearning(),source);
  assert.equal((await restored.getTeacher(inFlightSession.id)).status,'stopped');assert.equal(restored.hasCredential(provider),false);
  const identity=await restored.openLibrary();assert.equal(identity.id,library.id);assert.equal(identity.learnerId,library.learnerId);assert.equal(identity.deviceId,fresh.deviceId);assert.notEqual(identity.deviceId,library.deviceId);
  await assert.rejects(restored.restoreLibraryBackup(exported.file,password),/libraryBackup.errors.occupied/);
  await restored.setLocalDeclaredMastery(id(),packageTarget,false,relearnAt);packageRun=await restored.startLearning(id(),packageTarget,languageContext,20,relearnAt);assert.equal(packageRun.lifecycleEvents.at(-1).kind,'resumed_after_planning_override');
  await restored.actLearning(id(),packageRun.id,packageRun.revision,{kind:'rate',rating:'good'},relearnAt);
  await restored.exportLibraryBackup(password);
  const preview=await restored.inspectLocalClear();
  await restored.confirmLearningQuantity(id(),languageContext,19);await assert.rejects(restored.clearLocalLibrary(preview),/clearChanged/);
  const confirmed=await restored.inspectLocalClear();
  const originalClear=restored.LibraryTransaction.prototype.clear;
  restored.LibraryTransaction.prototype.clear=function(table:any){if(table==='learningEvents')throw new DOMException('synthetic storage limit','QuotaExceededError');return originalClear.call(this,table);};
  await assert.rejects(restored.clearLocalLibrary(confirmed),/storageFull/);restored.LibraryTransaction.prototype.clear=originalClear;
  assert.equal((await restored.readLearning()).targets.length,3);
  const lateBytes=new TextEncoder().encode(JSON.stringify(pack.bundle)),lateDescriptor={id:pack.bundle.id,version:pack.bundle.version,title:pack.bundle.title,description:'fixture',entryCount:1,byteLength:lateBytes.length,sha256:await restored.sha256(lateBytes),url:'https://fixture.invalid/package.json'};
  const modelFetch=globalThis.fetch;
  let releaseDownload!:()=>void;globalThis.fetch=async()=>{await new Promise<void>(resolve=>{releaseDownload=resolve;});return new Response(lateBytes);};
  const late=restored.downloadPackage(lateDescriptor,new AbortController().signal,()=>{});
  await restored.clearLocalLibrary(confirmed);releaseDownload();await assert.rejects(late,/libraryReplaced/);await assert.rejects(restored.openLibrary(),/libraryReplaced/);
  globalThis.fetch=modelFetch;
  assert.equal((await restored.readLearning()).targets.length,0);assert.equal((await restored.readLearning()).events.length,0);
  const empty=await import(pathToFileURL(join(temp,'core.mjs')).href+'?cleared');assert.notEqual((await empty.openLibrary()).id,library.id);assert.equal((await empty.inspectLocalClear()).pending,0);
  await empty.restoreLibraryBackup(exported.file,password);
  console.log('PASS: local erasure preview CAS, full transaction rollback, stale-page and late-download fences, new empty library and backup restore.');
  console.log('PASS: encrypted backup, wrong password/corruption, account and occupied-library guards, transaction rollback, fresh-library restore, preserved runtime dates/facts and new device identity.');
 }
 // The clarification and content prompts name the learner's languages instead of
 // the pair the product shipped first. The interface language is not consulted.
 {
  const spanish={supportLanguageTag:'zh-CN',targetLanguageTag:'es'};
  const spanishRoute=await api.addLanguageRoute(id(),'es','zh-CN');
  await api.setActiveLanguageRoute(id(),spanishRoute.id);
  const talk=raw();await api.receiveWebIntake(accountId,talk);
  const talkDraft=await api.readLibrary((tx:any)=>tx.get('drafts',talk.operationId));
  const talkSession=await api.createTeacher(id(),talkDraft,spanish);
  const before=calls.length;
  await api.continueTeacher(talkSession.id,provider,new AbortController().signal,()=>{});
  const turn=calls.slice(before).find((body:any)=>body.tools);
  const systemPrompt=String(turn.messages[0].content);
  assert(systemPrompt.includes('natural Spanish expression'),'the clarification prompt names the target language the learner is learning');
  assert(!systemPrompt.includes('natural English expression'),'the shipped target language is not baked into the prompt');
  assert(systemPrompt.includes('Use Chinese (Simplified) as the Support Language'),'the explanation language is the Support Language, named separately from the Target Language');
  assert(!/Respond in/u.test(systemPrompt),'the interface language no longer decides what the model writes in');
  // A proposal in the wrong language is refused rather than recorded as a
  // meaning whose language contradicts its own material.
  const mismatched=await api.getTeacher(talkSession.id);
  assert.equal(mismatched.status,'proposal');
  await assert.rejects(api.acceptTeacher(id(),talkSession.id,mismatched.revision),/localFlow\.expressionLanguageChanged/u);

  const request=await makeRequest({id:id(),learner_user_id:accountId,learning_target_id:id(),fixed_input:{targetLanguageTag:'es',supportLanguageTag:'zh-CN',senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),planRevision:'fixture:1',expression:'tomar prestado',expressionKind:'phrase',meaning:'临时取得他人物品，并预期归还。',prototype:'一个人向同伴借用物品。',demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND}},id(),new Date());
  assert.deepEqual(requestLanguages(request),spanish,'the frozen request is where a sense’s languages are read back from, not the live Route selection');
  assert(generationSystem(true,spanish).includes('转述为中文（简体）释义'),'the personal prompt names the Support Language in the language it is written in');
  assert(generationSystem(true,spanish).includes('绝不出现西班牙语目标表达'),'the personal prompt names the target language too, so leakage in that language is refused');
  assert(generationSystem(false,spanish).includes('Chinese (Simplified) recall cue'),'the generic English prompt names the Support Language in English');
  assert(generationSystem(false,spanish).includes('the Spanish target'),'the generic English prompt names the target language in English');
  assert(independentReviewSystem(spanish).includes('Spanish target-expression leakage'),'the independent reviewer is told which language counts as leakage');
 }
 console.log('PASS: slow Intake/clarification/acceptance, fast acceptance, explicit membership/consent, separate generation/review, rejected material blocked, saved-candidate retry, cancellation fencing, atomic publication rollback and shared local runtime. Fake IDB/HTTP; no paid models.');
 console.log('PASS: clarification and content prompts name the operation’s Target and Support Languages from its pinned context and frozen request, refuse a proposal in the wrong language, and never consult the Interface Locale.');
}finally{globalThis.fetch=realFetch;await rm(temp,{recursive:true,force:true});}
