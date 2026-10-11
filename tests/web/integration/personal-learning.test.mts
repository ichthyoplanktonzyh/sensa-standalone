import {test} from 'vitest';
/** Canonical Personal Semantic World → Add-to-Learning → runtime smoke. */
import assert from 'node:assert/strict';
import {
  readSensaPortableLightweightPackage,
  validateSensaPortableLightweightPackage,
} from '@sensa/content-validator/portable-lightweight';
import {
  canonicalConsumerJson,
  SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,
  generationSystem,
  independentReviewSystem,
  makeRequest,
  requestLanguages,
  sensaIntakePayloadSchema,
} from '@sensa/contracts/sensa';
import {sha256} from '@sensa/learning-kernel';
import {directPublishedFixture} from '../support/directPublishedFixture';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {indexedDB} from 'fake-indexeddb';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test("personal-learning", async () => {

const compiled=await build({stdin:{contents:[
  ...['store','providers','personalLearning','learning','language','speech/defaultProvider','backupValidation'].map(name=>`export * from './apps/web/src/data/library/${name}';`),
  `export * from './apps/web/src/experience/personalMeaningJourney/gateway';`,
  `export {worldReadRepository} from './apps/web/src/experience/personalMeaningJourney/worldRepository';`,
  `export {readPersonalProvisioningPresentation} from './apps/web/src/data/library/personalProvisioningSource';`,
  `export {sqliteRecordAdapter} from './apps/web/src/data/library/sqliteAdapter';`,
  `export {learningSystem} from './apps/web/src/learning/system/learningSystem';`,
  `export {startLearning,actLearning} from './tests/web/support/learningRunFixture';`,
  `export * from './apps/web/src/contentSupply/portable/personalPortablePackage';`,
  `export * from './apps/web/src/contentSupply/portable/portablePackage';`,
  `export {readLearningWorkspaceProjection} from './apps/web/src/learning/system/learningProjection';`,
  `export {runBaselineMaterial,runStepMaterial} from './apps/web/src/learning/runtime/runMaterialPins';`,
].join('\n'),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':JSON.stringify({VITE_SENSA_API_URL:'https://speech.fixture.invalid'})},plugins:[{name:'fixture-auth',setup(build){build.onLoad({filter:/[/\\]account[/\\]auth\.ts$/},()=>({contents:"export const auth={getSession:async()=>({data:{session:{access_token:'fixture',user:{id:'fixture'}}}})}; export {authStorageKey,cachedAuthSubject} from './authSessionHint';",loader:'ts'}));}}]});
Object.assign(globalThis,{indexedDB,window:new EventTarget(),location:{origin:'http://127.0.0.1:9998'},BroadcastChannel:undefined});
const temp=await mkdtemp(join(tmpdir(),'sensa-personal-'));
await writeFile(join(temp,'core.mjs'),compiled.outputFiles[0]!.text);
const api=await import(pathToFileURL(join(temp,'core.mjs')).href);
const restoreSpeech=api.replaceClientSpeechProvider({id:'fixture',revision:1,displayName:'Fixture',synthesize:async(input:any)=>({...input,audioUrl:'data:audio/mpeg;base64,UklGRg==',phoneticNotation:null,accentLabel:'en-US',source:'synthetic test fixture',method:'tts'})});
const id=()=>crypto.randomUUID();
const library=await api.openLibrary(),accountId=id();
await api.command({id:id(),kind:'fixture.owner',input:{}},async(tx:any)=>tx.put('meta','service-owner',{subject:accountId,accountId}));
const languageContext=(await api.languageRoutesSnapshot()).context;
const provider=await api.saveProvider(id(),{id:id(),expectedRevision:0,name:'Fixture',kind:'compatible',endpoint:'https://fixture.invalid/v1',model:'fixture'},'fixture-secret');
for(const purpose of ['content','review']){
  const {settings}=await api.providerSnapshot();
  await api.assignProvider(id(),purpose,provider.id,settings.revision);
}

const semanticSpec={schemaVersion:'sensa-sense-semantic-spec-v1' as const,coreMeaningFocus:'临时取得他人物品，并预期归还。',prototypeScenes:[{summary:'一个人向同伴借用物品，约好稍后归还。',participantRoles:['借用者','所有者'],states:['临时使用'],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]};
const canonicalIntake=(complete:boolean)=>{
  const sentence='Private marker: May asked to borrow an umbrella.',observed='borrow',start=sentence.indexOf(observed);
  return sensaIntakePayloadSchema.parse({
    contractVersion:'sensa-intake-v3',operationId:id(),capturedAt:'2026-09-16T01:00:00.000Z',
    context:{modality:'text',textSegment:sentence,mediaReferenceIds:[],languageTag:'en',source:{client:'sensa-browser-extension',url:'https://example.org/article',title:'Private fixture',sourceReferenceId:null,domSelector:null,paragraphContext:null}},
    expression:{surfaceForm:observed,languageTag:'en',occurrence:{surfaceForm:observed,locator:{kind:'text_span',start,end:start+observed.length}},expressionTypeHint:'word'},
    sense:complete?{senseKey:null,semanticSpec,wordingSource:'llm_suggested',resolutionProvenance:{resolverKind:'language_model',provider:'fixture',model:'fixture',policyVersion:'fixture-v1',sourceReferenceIds:['personal-learning-smoke']}}:null,
    acceptance:complete?{mode:'learner_direct'}:null,
  });
};

const calls:any[]=[];
let mode:'good'|'reject'|'review-fail'|'hold'|'leak'='good';
let generationEntered:(()=>void)|undefined,releaseGeneration:(()=>void)|undefined;
const realFetch=globalThis.fetch;
globalThis.fetch=async(_url,input)=>{
  if(String(_url).endsWith('/sensa/resource-facts'))return new Response(JSON.stringify({input:JSON.parse(String(input?.body)),references:[]}),{status:200});
  if(!input?.body)return new Response('[]',{headers:{'content-type':'application/json'}});
  const body=JSON.parse(String(input?.body));calls.push(body);
  const review=String(body.messages?.[0]?.content).includes('independent Sensa');
  const prompt=typeof body.messages[1].content==='string'?body.messages[1].content:body.messages[1].content.filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n');
  const japanese=!review&&JSON.parse(prompt).sense.supportLanguageTag==='ja';
  if(!review&&mode==='hold'){generationEntered?.();await new Promise<void>(resolve=>{releaseGeneration=resolve;});}
  if(review&&mode==='review-fail')throw Error('Offline');
  const result=review
    ?{accepted:mode!=='reject',reason:mode==='reject'?'场景改变了原意':'符合固定含义与来源'}
    :{resources:[{role:'experience_recall_cue',payload:{scene:mode==='leak'?'一个人想要 borrow 一把雨伞。':japanese?'ある人が友人の傘を一時的に使い、後で返す約束をした。':'一个人向同伴临时借用一把雨伞，约好之后归还。',senseFocus:japanese?'一時的に使い、後で返すこと':'临时使用并预期归还'}},{role:'scene_bridge',payload:{text:japanese?'受け取る側から、一時的に使って返すことを表す。':'从取得者的视角表达临时使用并准备归还。',meaningRendering:{meaning:japanese?'他人の物を一時的に使い、後で返すこと。':'从取得者的视角表达临时使用并准备归还。',languageTag:japanese?'ja':'zh-CN'}}},{role:'scene_realization',payload:{example:'May asked to borrow an umbrella.',targetStart:13,targetEnd:19,experienceResourceKey:'experience_recall_cue:0'}}]};
  return new Response(JSON.stringify({model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}),{headers:{'content-type':'application/json'}});
};

try{
  const modules=api.createJourneyModules();
  const gateway=modules.personalMeaningJourney;
  const intake=modules.semanticIntake;

  // Incomplete data enters one Inbox. Clarification closes it into the same
  // Personal Meaning shape used by direct intake, preserving captured context.
  const slow=canonicalIntake(false),queued=await intake.submit(slow);
  assert.equal(queued.route,'inbox');
  const completed=await gateway.completeClarificationDraft({operationId:id(),intakeId:queued.intakeId,source:await gateway.captureClarificationSource('intake',queued.intakeId),context:slow.context!,languageContext:{supportLanguageTag:'zh-CN',targetLanguageTag:'en'},focus:null,sense:{proposedSenseKey:'borrow-temporarily',coreMeaningFocus:semanticSpec.coreMeaningFocus,prototypeScenes:semanticSpec.prototypeScenes,includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[],unresolvedQuestions:[]},expression:{surfaceForm:'borrow',expressionType:'word',languageTag:'en',relation:'realizes',semanticCoverage:'exact'},expressionCandidates:[{surfaceForm:'borrow',expressionType:'word',languageTag:'en',relation:'realizes',semanticCoverage:'exact'}],confirmExpression:true,transcript:[{messageId:id(),role:'learner',body:'这里强调临时使用并归还。',occurredAt:'2026-09-16T01:01:00.000Z'}],provenance:{provider:'fixture',model:'fixture',promptVersion:'v1'},semanticPolicyVersion:'fixture-v1'});
  assert.equal((await api.worldReadRepository.inbox()).items.length,0);
  const slowDetail=await api.worldReadRepository.detail(completed.personalMeaningId);
  const slowSource=slowDetail.sources[0];
  assert(slowSource);assert.equal(slowSource.context.text,slow.context!.textSegment);assert.equal(slowSource.expression.surfaceForm,'borrow');
  const detail=slowDetail.detail!;
  assert.equal(detail.directAlignments[0]?.basisKind,'sense_construction');

  // Add-to-Learning sees only an authoritative Alignment reference. Enrolling
  // twice is idempotent and never manufactures a second Meaning record.
  const forgedSource=structuredClone(slowSource);forgedSource.semanticSpec.coreMeaningFocus='永久购买并拥有物品。';
  await assert.rejects(()=>api.enrollPersonal(id(),forgedSource,languageContext,false),/meaningChanged/);
  assert.equal((await api.personalLearningSnapshot()).length,0,'altered semantics cannot save a learning intention');
  const withoutWorldScan=async<T,>(work:()=>Promise<T>):Promise<T>=>{
    const adapter=await api.sqliteRecordAdapter(),entries=adapter.entries.bind(adapter),page=adapter.entriesPage.bind(adapter);
    const bounded=(table:string)=>{if(['semanticMeanings','semanticRegistry'].includes(table))throw new Error('preparation enumerated the World');};
    adapter.entries=async(table:string)=>{bounded(table);return entries(table);};
    adapter.entriesPage=async(table:string,after:string|null,limit:number)=>{bounded(table);return page(table,after,limit);};
    try{return await work();}finally{adapter.entries=entries;adapter.entriesPage=page;}
  };
  const enrollOperation=id();
  const task:any=await withoutWorldScan(()=>api.enrollPersonal(enrollOperation,slowSource,languageContext,false));
  assert.deepEqual(await api.enrollPersonal(enrollOperation,slowSource,languageContext,false),task,'replaying a lost enrollment response returns the same durable intention');
  await assert.rejects(()=>api.enrollPersonal(enrollOperation,slowSource,languageContext,true),/operationConflict/,'the same operation cannot silently acquire new Context consent');
  const changeMembership=(expectedRevision:number,active:boolean)=>api.learningSystem.execute({kind:'change_supplemental_membership',operationId:id(),source:{kind:'personal_meaning_alignment',id:task.id},expectedRevision,active,languageContext});
  await changeMembership(0,false);
  const callsBeforeRemoved=calls.length;
  await assert.rejects(()=>api.preparePersonal(task.id,slowSource,provider,null,new AbortController().signal,()=>{}),/membershipRemoved/);
  assert.equal(calls.length,callsBeforeRemoved,'withdrawn personal intent cannot initiate paid preparation');
  assert.equal((await api.personalLearningTaskSnapshot(task.id)).curriculumActive,false);
  assert.deepEqual((await api.readLibrary((tx:any)=>tx.all('learningTargets'))),[]);
  await changeMembership(1,true);
  assert.equal((await api.personalLearningTaskSnapshot(task.id)).curriculumActive,true);
  await api.enrollPersonal(id(),slowSource,languageContext,false);
  assert.equal((await api.personalLearningSnapshot()).length,1);
  assert.deepEqual(Object.keys(task).includes('meaning'),false);
  assert.equal((await api.readLearning()).targets.length,0);

  for(const field of ['meaning','expression','context'] as const){
    const changed=structuredClone(slowSource);
    if(field==='meaning')changed.semanticSpec.coreMeaningFocus='永久购买并拥有物品。';
    if(field==='expression')changed.expression.surfaceForm='buy';
    if(field==='context')changed.context.text='Caller supplied private text that was never accepted.';
    await assert.rejects(()=>api.preparePersonal(task.id,changed,provider,null,new AbortController().signal,()=>{}),/meaningChanged/);
  }
  assert.equal(calls.length,0,'source revalidation rejects before any model or speech preparation');
  assert.equal((await api.personalLearningSnapshot())[0].status,'waiting','rejected callers cannot change the durable intention');

  await assert.rejects(api.exportPersonalPortablePackage(id()),/localFlow.resourceInvalid/u,'unknown tasks cannot produce a Portable artifact');
  await assert.rejects(api.exportPersonalPortablePackage(task.id),/localFlow.resourceInvalid/u,'waiting material cannot be exported as if ready');

  const prepare=async()=>{const review=await api.selectedReviewProvider();return withoutWorldScan(()=>api.preparePersonal(task.id,slowSource,provider,review,new AbortController().signal,()=>{}));};
  mode='leak';await prepare();
  assert.equal((await api.personalLearningSnapshot())[0].status,'rejected','the validator blocks target-expression leakage before publication');
  await assert.rejects(api.exportPersonalPortablePackage(task.id),/localFlow.resourceInvalid/u,'rejected material cannot cross the export boundary');
  assert.equal((await api.readLearning()).targets.length,0);
  await api.setModelReviewEnabled(id(),true,(await api.providerSnapshot()).settings.revision);
  mode='review-fail';await assert.rejects(prepare());assert.equal((await api.readLearning()).targets.length,0);
  mode='good';await prepare();
  assert.equal((await api.personalLearningSnapshot())[0].status,'ready');
  const learning=await api.readLearning();assert.equal(learning.targets.length,1);
  assert.equal(learning.targets[0].identity.senseVersionId,slowSource.reference.senseVersionId);
  assert.equal(learning.targets[0].identity.bindingVersionId,slowSource.reference.bindingVersionId);
  const saved=await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
  api.validateBackupRows(saved);
  // A failed checkpoint is resumable, so its fixed input and consent require
  // the same source admission as a ready bundle before it may be restored.
  for(const corruption of ['fixed-identity','unauthorized-context'] as const){
    const changed=structuredClone(saved),savedTask=changed.personalLearning.find((row:any)=>row.key===task.id).value;
    const checkpoint=structuredClone(changed.contentAttempts.find((row:any)=>row.key===savedTask.attemptId).value);
    checkpoint.id=id();checkpoint.status='failed';checkpoint.readyAt=null;checkpoint.bundle=null;checkpoint.review=null;checkpoint.validation=null;checkpoint.resumedFrom=null;checkpoint.generationCheckpoint={};
    savedTask.attemptId=checkpoint.id;savedTask.status='failed';
    if(corruption==='fixed-identity')checkpoint.request.senseId=id();
    else{
      const origin=checkpoint.request.contextArtifacts.find((artifact:any)=>artifact.contextKind==='origin_experience');
      const contextDigest=sha256(canonicalConsumerJson(slowSource.context)),grantId=id();
      checkpoint.grant={id:grantId,contextDigest,recipients:[provider.endpoint]};
      origin.source='personal_anchor';origin.sourceVersion=contextDigest;origin.personalAnchorUseGrantId=grantId;
      origin.payload={scene:slowSource.context.text,senseFocus:slowSource.semanticSpec.coreMeaningFocus,featureLabels:[]};
      origin.contentDigest=sha256(canonicalConsumerJson(origin.payload));
    }
    changed.contentAttempts.push({key:checkpoint.id,value:checkpoint});
    assert.throws(()=>api.validateBackupRows(changed),/Personal preparation/,'a resumable failed checkpoint cannot replace fixed identities or acquire ungranted private Context');
  }
  const tampered=structuredClone(saved),readyTask=tampered.personalLearning.find((row:any)=>row.key===task.id).value;
  const readyAttempt=tampered.contentAttempts.find((row:any)=>row.key===readyTask.attemptId).value;
  delete readyAttempt.validation.content.resources.find((resource:any)=>resource.materialRoleKey==='scene_bridge').contentPayload.meaningRendering;
  const material=tampered.learningTargets[0].value.curriculumMemberships[0].material;
  material.content=structuredClone(readyAttempt.validation.content);
  assert.throws(()=>api.validateBackupRows(tampered),/admitted candidate evidence/,'personal restoration rechecks real v4 evidence rather than trusting matching validation and membership claims');
  const bridgeCandidate=readyAttempt.bundle.candidates.find((candidate:any)=>candidate.materialRoleKey==='scene_bridge');
  delete bridgeCandidate.contentPayload.meaningRendering;bridgeCandidate.contentDigest=sha256(canonicalConsumerJson(bridgeCandidate.contentPayload));
  assert.throws(()=>api.validateBackupRows(tampered),/admitted candidate evidence/,'matching candidate digests cannot waive the v4 required rendering');

  const firstExport=await api.exportPersonalPortablePackage(task.id);
  const secondExport=await api.exportPersonalPortablePackage(task.id);
  assert.match(firstExport.fileName,/\.sensa$/u);
  assert.deepEqual(firstExport.bytes,secondExport.bytes,'unchanged admitted material exports deterministically');
  assert.equal(validateSensaPortableLightweightPackage(firstExport.bytes).status,'satisfied');
  const personalPackage=readSensaPortableLightweightPackage(firstExport.bytes);
  assert.equal(personalPackage.package.metadata.version,1);
  assert.equal(personalPackage.package.route.targetLanguage,'en');
  assert.equal(personalPackage.package.route.supportLanguage,'zh-CN');
  assert.equal(personalPackage.package.targetExpression.text,'borrow');
  assert.equal(personalPackage.package.resources.sceneRealization.example,'May asked to borrow an umbrella.');
  const workspace=await api.readLearningWorkspaceProjection({languageContext,clock:Date.now(),retries:[]});
  assert.equal(workspace.targets[0].presentation.example,personalPackage.package.resources.sceneRealization.example,'the target context displays its actual admitted scene, not an optional unrelated usage example');
  assert.equal(personalPackage.package.media.length,1,'the generated TTS pronunciation is carried by .sensa');
  assert.equal(personalPackage.package.semanticDeclaration,undefined,'private export does not claim registry authority');
  const exportedManifest=JSON.stringify(personalPackage.package);
  for(const privateValue of ['Private marker:', 'fixture-secret', completed.personalMeaningId, task.id, task.targetId]){
    assert(!exportedManifest.includes(privateValue),'private source, credentials and learner identities must not leak into the Portable manifest');
  }
  const reinstalled=await api.installPortablePackage(firstExport.bytes,personalPackage.archiveDigest);
  assert.equal(reinstalled.content.entries[0].expression,'borrow','the personal .sensa re-enters through the public import path');

  await api.confirmLearningQuantity(id(),languageContext,20);
  const beforeBackdatedStart=await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
  const sourceMaterial=(await api.readLearning()).targets.find((target:any)=>target.id===task.targetId).curriculumMemberships[0].material;
  const sourceReadyAt=sourceMaterial.snapshot.provenance.sourceReadyAt;
  assert.equal(sourceReadyAt,(await api.readLibrary((tx:any)=>tx.get('contentAttempts',sourceMaterial.snapshot.provenance.attemptId)))?.readyAt);
  await assert.rejects(api.startLearning(id(),task.targetId,languageContext,20,new Date(Date.parse(sourceReadyAt)-1).toISOString()),/clockChanged/);
  assert.deepEqual(await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)])))),beforeBackdatedStart,'starting before Ready cannot persist a Run, policy commitment, active selection or receipt');
  let run=await api.startLearning(id(),task.targetId,languageContext,20);
  run=await api.actLearning(id(),run.id,run.revision,{kind:'reveal'});
  run=await api.actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'});
  assert.equal((await api.readLearning()).targets[0].memoryRevision,1);
  const afterLearningExport=await api.exportPersonalPortablePackage(task.id);
  assert.deepEqual(afterLearningExport.bytes,firstExport.bytes,'settled learning history and scheduling state cannot alter the shared material archive');

  // Consent changes belong to a new explicit preparation, never a reused
  // candidate carrying an earlier private Context grant.
  const beforeUpdate=structuredClone(await api.readLearning()),beforeConsentCalls=calls.length;
  await api.requestPersonalResourceUpdate(id(),task.id,slowSource,languageContext,true);
  mode='review-fail';await assert.rejects(prepare());
  const privateFailure=(await api.personalLearningSnapshot()).find((candidate:any)=>candidate.id===task.id);
  assert.equal(privateFailure.status,'failed');
  assert.deepEqual((await api.readLearning()).targets,beforeUpdate.targets,'failed resource update leaves admitted material usable');
  assert(JSON.stringify(calls.slice(beforeConsentCalls)).includes('Private marker:'),'explicitly granted Context reaches the configured provider');
  const privateAttempt=await api.readLibrary((tx:any)=>tx.get('contentAttempts',privateFailure.attemptId));assert(privateAttempt.grant);
  const beforeRevocationCalls=calls.length;
  await api.requestPersonalResourceUpdate(id(),task.id,slowSource,languageContext,false);
  mode='good';await prepare();
  const publicTask=(await api.personalLearningSnapshot()).find((candidate:any)=>candidate.id===task.id);
  const publicAttempt=await api.readLibrary((tx:any)=>tx.get('contentAttempts',publicTask.attemptId));
  assert.equal(publicAttempt.grant,null);assert.equal(publicAttempt.resumedFrom,null);
  assert(!publicAttempt.request.contextArtifacts.some((artifact:any)=>artifact.source==='personal_anchor'||artifact.personalAnchorUseGrantId!==null));
  assert(!JSON.stringify(calls.slice(beforeRevocationCalls)).includes('Private marker:'),'revoked Context cannot leak through a saved candidate or reviewer request');
  assert.deepEqual(await api.readLibrary((tx:any)=>tx.get('contentAttempts',privateAttempt.id)),privateAttempt,'old authorized evidence stays immutable');
  assert.deepEqual((await api.readLearning()).runs,beforeUpdate.runs,'resource replacement cannot rewrite settled Runtime history');

  // A complete payload from any entry bypasses Inbox mechanically and yields
  // the same learning-source shape; provenance remains data on that record.
  const fast=canonicalIntake(true);fast.sense!.senseKey='borrow-temporarily';const accepted=await intake.submit(fast);
  assert.equal(accepted.route,'fast_track');
  const fastDetail=await api.worldReadRepository.detail(accepted.personalMeaningId);
  const fastSource=fastDetail.sources[0];
  assert(fastSource);assert.equal(fastSource.sourceKind,'personal_meaning_alignment');
  assert.equal(fastDetail.detail!.directAlignments[0]?.basisKind,'contextual_resolution');
  assert.equal((await api.personalLearningSnapshot()).length,1,'admission never enrolls learning implicitly');
  assert.equal(fastSource.reference.senseVersionId,slowSource.reference.senseVersionId);
  assert.equal(fastSource.reference.bindingVersionId,slowSource.reference.bindingVersionId);
  const beforeCoverage=structuredClone(await api.readLearning()),beforeCoverageCalls=calls.length;
  const covered=await api.enrollPersonal(id(),fastSource,languageContext,true);
  assert.equal(covered.status,'covered','another Personal Meaning must reuse the established connection');
  assert.equal(covered.coveredByMembershipId,task.curriculumMembershipId);
  assert.equal(covered.attemptId,null);
  await api.preparePersonal(covered.id,fastSource,provider,await api.selectedReviewProvider(),new AbortController().signal,()=>{});
  assert.equal(calls.length,beforeCoverageCalls,'existing coverage needs no model call or Context disclosure');
  assert.deepEqual(await api.readLearning(),beforeCoverage,'coverage cannot replace material, membership or history');

  for(const kind of ['book','direct','race'] as const){
    const input=canonicalIntake(true);input.sense!.senseKey=`covered-${kind}`;
    const admitted=await intake.submit(input),source=(await api.worldReadRepository.detail(admitted.personalMeaningId)).sources[0];assert(source);
    const publication=directPublishedFixture(source.reference,{senseId:source.reference.senseId,bindingId:source.reference.bindingId,senseKey:`covered-${kind}`,semanticSpec:source.semanticSpec});
    await api.restoreLibraryTransaction(async(tx:any)=>{tx.put('packageInstallations',publication.pack.key,publication.installation);tx.put('packageCache',publication.pack.key,publication.pack);});
    const beforeCalls=calls.length;
    let personalTask:any,pending:Promise<void>|undefined;
    if(kind==='race'){
      personalTask=await api.enrollPersonal(id(),source,languageContext,false);mode='hold';
      const entered=new Promise<void>(resolve=>{generationEntered=resolve;});
      pending=api.preparePersonal(personalTask.id,source,provider,await api.selectedReviewProvider(),new AbortController().signal,()=>{});await entered;
    }
    if(kind==='direct'){
      const selected=await api.learningSystem.read({kind:'direct_source',reference:publication.reference});
      const direct=await api.learningSystem.execute({kind:'enroll_direct',operationId:id(),reference:publication.reference,expectedDigest:selected.sourceDigest,languageContext});
      await api.learningSystem.execute({kind:'prepare_direct',operationId:id(),enrollmentId:direct.enrollmentId});
    }else await api.enrollPackage(id(),publication.pack.key,languageContext);
    const supplied=structuredClone(await api.readLearning());
    if(kind==='race'){releaseGeneration!();await pending;mode='good';generationEntered=undefined;releaseGeneration=undefined;}
    else{
      personalTask=await api.enrollPersonal(id(),source,languageContext,true);
      assert.equal(personalTask.status,'covered',`${kind} material should be reused at enrollment`);
      await api.preparePersonal(personalTask.id,source,provider,await api.selectedReviewProvider(),new AbortController().signal,()=>{});
    }
    const savedTask=(await api.personalLearningSnapshot()).find((candidate:any)=>candidate.id===personalTask.id);
    assert.equal(savedTask.status,'covered');assert(savedTask.coveredByMembershipId);
    assert.equal(calls.length,beforeCalls+(kind==='race'?1:0),`${kind}: no redundant generation/review after compatible material exists`);
    assert.deepEqual(await api.readLearning(),supplied,`${kind}: new personal source must preserve the winning material and progress`);
    const rows=await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
    if(kind==='race')assert.equal(rows.contentAttempts.find((row:any)=>row.key===savedTask.attemptId).value.status,'stopped');
    api.validateBackupRows(rows);
    const wrongCoverage=structuredClone(rows);wrongCoverage.personalLearning.find((row:any)=>row.key===savedTask.id).value.coveredByMembershipId=id();
    assert.throws(()=>api.validateBackupRows(wrongCoverage),'restoration must verify the covering membership actually exists');
    if(kind==='book'){
      const originalTarget=rows.learningTargets.find((row:any)=>row.key===savedTask.targetId).value;
      const retired=structuredClone(originalTarget);retired.curriculumMemberships.find((member:any)=>member.id===savedTask.coveredByMembershipId).status='superseded';
      await api.restoreLibraryTransaction(async(tx:any)=>tx.put('learningTargets',savedTask.targetId,retired));
      assert.equal((await api.personalLearningTaskSnapshot(savedTask.id)).status,'waiting','a historical covered outcome is not current readiness after Book retirement');
      const readState=await api.readLibrary((tx:any)=>tx.get('personalLearning',savedTask.id));assert.equal(readState.status,'covered','read projection never rewrites saved history');
      const reenrolled=await api.enrollPersonal(id(),source,languageContext,true);assert.equal(reenrolled.status,'waiting');assert.equal(reenrolled.coveredByMembershipId,undefined);
      await api.restoreLibraryTransaction(async(tx:any)=>tx.put('learningTargets',savedTask.targetId,originalTarget));
      assert.equal((await api.enrollPersonal(id(),source,languageContext,true)).status,'covered');
    }
  }

  const contextBefore=await api.worldReadRepository.detail(completed.personalMeaningId);
  await gateway.reviseContext({operationId:id(),personalMeaningId:completed.personalMeaningId,expectedRevision:contextBefore.detail.revision,blocks:[{kind:'text',bodyText:'Updated private Context: I borrowed a bicycle and returned it on Sunday.'}]});
  const revisedSource=(await api.worldReadRepository.detail(completed.personalMeaningId)).sources[0];
  assert.equal(revisedSource.context.text,'Updated private Context: I borrowed a bicycle and returned it on Sunday.','explicit resource updates must be able to select the current Context, not only the acceptance-time anchor');
  assert.equal(revisedSource.reference.senseVersionId,slowSource.reference.senseVersionId);
  assert.equal(revisedSource.reference.bindingVersionId,slowSource.reference.bindingVersionId);
  const imageId=id(),imageData='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nWQAAAAASUVORK5CYII=';
  await api.restoreLibraryTransaction(async(tx:any)=>tx.put('media',imageId,{mediaId:imageId,mediaKind:'image',mimeType:'image/png',dataUrl:imageData,sizeBytes:68,createdAt:new Date().toISOString()}));
  const afterText=await api.worldReadRepository.detail(completed.personalMeaningId);
  await gateway.reviseContext({operationId:id(),personalMeaningId:completed.personalMeaningId,expectedRevision:afterText.detail.revision,blocks:[{kind:'text',bodyText:revisedSource.context.text},{kind:'image',personalMediaObjectId:imageId}]});
  const richSource=(await api.worldReadRepository.detail(completed.personalMeaningId)).sources[0];
  assert.equal(richSource.context.images[0].dataUrl,imageData,'stored Context images are resolved from their exact media rows');
  const beforeRichUpdate=structuredClone(await api.readLearning()),beforeRichCalls=calls.length;
  await api.requestPersonalResourceUpdate(id(),task.id,richSource,languageContext,true);
  const presentation=await api.readLibrary((tx:any)=>api.readPersonalProvisioningPresentation({get:(table:string,key:string)=>{assert.notEqual(table,'media','library row must not hydrate personal Context media');return tx.get(table,key);}},richSource.reference,richSource.context.personalSemanticAnchorRevisionIds));
  assert.deepEqual(presentation,{expression:richSource.expression.surfaceForm,meaning:richSource.semanticSpec.coreMeaningFocus});
  assert(!JSON.stringify(presentation).includes(imageData),'library presentation never transfers image payloads');
  await api.preparePersonal(task.id,richSource,provider,await api.selectedReviewProvider(),new AbortController().signal,()=>{});
  const richTask=(await api.personalLearningSnapshot()).find((candidate:any)=>candidate.id===task.id);
  const richAttempt=await api.readLibrary((tx:any)=>tx.get('contentAttempts',richTask.attemptId));
  assert.deepEqual(richTask.contextPin,richSource.context.personalSemanticAnchorRevisionIds);assert.deepEqual(richAttempt.contextPin,richTask.contextPin);
  assert.equal(richAttempt.request.contextArtifacts.find((artifact:any)=>artifact.contextKind==='origin_experience').payload.scene,richSource.context.text);
  assert.equal(richAttempt.validation.content.resources.find((resource:any)=>resource.materialRoleKey==='experience_recall_cue').contentPayload.images[0].dataUrl,imageData);
  assert(JSON.stringify(calls.slice(beforeRichCalls)).includes('Updated private Context:'));assert(!JSON.stringify(calls.slice(beforeRichCalls)).includes('Private marker:'));
  assert.deepEqual((await api.readLearning()).runs,beforeRichUpdate.runs);

  const flightInput=canonicalIntake(true);flightInput.sense!.senseKey='fixed-context-inflight';
  const flightMeaning=await intake.submit(flightInput),flightDetail=await api.worldReadRepository.detail(flightMeaning.personalMeaningId),flightSource=flightDetail.sources[0];
  const flightTask=await api.enrollPersonal(id(),flightSource,languageContext,true);mode='hold';
  const entered=new Promise<void>(resolve=>{generationEntered=resolve;});
  const flight=api.preparePersonal(flightTask.id,flightSource,provider,await api.selectedReviewProvider(),new AbortController().signal,()=>{});await entered;
  await gateway.reviseContext({operationId:id(),personalMeaningId:flightMeaning.personalMeaningId,expectedRevision:flightDetail.detail.revision,blocks:[{kind:'text',bodyText:'Edited while the existing generation is running.'}]});
  releaseGeneration!();await flight;mode='good';generationEntered=undefined;releaseGeneration=undefined;
  const finishedFlight=(await api.personalLearningSnapshot()).find((candidate:any)=>candidate.id===flightTask.id);
  assert.equal(finishedFlight.status,'ready');assert.deepEqual(finishedFlight.contextPin,flightTask.contextPin);
  const flightAttempt=await api.readLibrary((tx:any)=>tx.get('contentAttempts',finishedFlight.attemptId));
  assert.equal(flightAttempt.request.contextArtifacts.find((artifact:any)=>artifact.contextKind==='origin_experience').payload.scene,flightSource.context.text,'in-flight generation keeps the explicitly pinned old Context');
  const finalRows=await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));api.validateBackupRows(finalRows);
  for(const corruption of ['historical-pin','revoked-grant','recipient'] as const){
    const changed=structuredClone(finalRows),attempt=changed.contentAttempts.find((row:any)=>row.key===privateAttempt.id).value;
    if(corruption==='historical-pin')attempt.contextPin=[...richSource.context.personalSemanticAnchorRevisionIds];
    if(corruption==='revoked-grant')attempt.fixedInput.useContext=false;
    if(corruption==='recipient')attempt.grant.recipients.push('https://unapproved.fixture.invalid/v1');
    assert.throws(()=>api.validateBackupRows(changed),/Personal preparation/,'historical attempts must match their own pinned Context and authorized recipients, not the task current settings');
  }
  const badPin=structuredClone(finalRows);badPin.contentAttempts.find((row:any)=>row.key===flightAttempt.id).value.contextPin=[id()];assert.throws(()=>api.validateBackupRows(badPin));

  // The Run starts with private material. An explicit Portable update may
  // refresh the unacted Step without replacing that baseline or acted evidence.
  const registry=await api.readLibrary(async(tx:any)=>{
    const get=async(kind:string,key:string)=>(await tx.get('semanticRegistry',`${kind}:${key}`)).value;
    const senseVersion=await get('senseVersions',flightSource.reference.senseVersionId);
    const bindingVersion=await get('bindingVersions',flightSource.reference.bindingVersionId);
    const expressionVersion=await get('expressionVersions',bindingVersion.expressionVersionId);
    return {sense:await get('senses',senseVersion.senseId),senseVersion,binding:await get('bindings',bindingVersion.senseExpressionBindingId),bindingVersion,expressionVersion,expression:await get('expressions',expressionVersion.expressionId)};
  });
  const portableOptions={packageId:id(),expression:'borrow',semanticDeclaration:{
    contractVersion:'sensa-portable-semantic-declaration-v1' as const,
    sense:{senseId:flightSource.reference.senseId,senseVersionId:flightSource.reference.senseVersionId,senseKey:registry.sense.senseKey,versionNumber:registry.senseVersion.versionNumber,semanticPolicyVersion:registry.senseVersion.semanticPolicyVersion,semanticSpec:flightSource.semanticSpec},
    expression:{expressionId:registry.expression.expressionId,expressionVersionId:registry.expressionVersion.expressionVersionId,versionNumber:registry.expressionVersion.versionNumber,expressionType:registry.expression.expressionType,structure:registry.expressionVersion.structure},
    binding:{senseExpressionBindingId:flightSource.reference.bindingId,bindingVersionId:flightSource.reference.bindingVersionId,versionNumber:registry.bindingVersion.versionNumber,relation:registry.binding.relation,semanticCoverage:registry.bindingVersion.semanticCoverage,registerLabel:registry.bindingVersion.registerLabel,usageConstraints:registry.bindingVersion.usageConstraints},
  }};
  let mixedRun=await api.startLearning(id(),flightTask.targetId,languageContext,20);
  mixedRun=await api.actLearning(id(),mixedRun.id,mixedRun.revision,{kind:'reveal'});
  const personalStep=await api.readLibrary(async(tx:any)=>(await tx.all('learningEvents')).find((event:any)=>event.runId===mixedRun.id&&event.kind==='reveal').detail.stepId);
  const publicationTemplate=directPublishedFixture().pack.portableOrigin.publications[0]!;
  const installPublished=async(version:number,scene?:string)=>{
    const fixture=portablePackageFixture({...portableOptions,version,...(scene?{scene}:{})}),archive=readSensaPortableLightweightPackage(fixture.bytes);
    const publication={...publicationTemplate,book:{...publicationTemplate.book,bookVersionId:id(),versionNumber:version},contentRelease:{...publicationTemplate.contentRelease,contentReleaseId:id(),versionNumber:version},member:{packageId:portableOptions.packageId,version}};
    return (await api.installPublishedPortableBookMembers([{bytes:fixture.bytes,archive,publication}]))[0];
  };
  const installedV1=await installPublished(1);
  await api.enrollPackage(id(),installedV1.key,languageContext);
  const installedV2=await installPublished(2,'同事借出一把伞，约好第二天归还。');
  await api.enrollPackage(id(),installedV2.key,languageContext);
  assert((await api.readLearning()).targets.find((target:any)=>target.id===flightTask.targetId).curriculumMemberships.some((member:any)=>member.packageKey===installedV2.key));
  const installedV3=await installPublished(3,'周末向邻居借一把伞，约好第二天归还。');
  await api.enrollPackage(id(),installedV3.key,languageContext);
  const mixedRows=await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
  const mixedSaved=mixedRows.learningRuns.find((row:any)=>row.key===mixedRun.id).value,mixedParticipant=mixedSaved.participants[flightTask.targetId];
  assert.equal(api.runBaselineMaterial(mixedParticipant).snapshot.provenance.packageKey,undefined);
  assert.equal(api.runStepMaterial(mixedParticipant,personalStep).snapshot.provenance.packageKey,undefined);
  assert(Object.values(mixedParticipant.presentedMaterials).some((reference:any)=>mixedParticipant.materializations[reference].snapshot.provenance.packageKey===installedV3.key));
  mixedRows.packageCache=[];api.validateBackupRows(mixedRows);
  await api.actLearning(id(),mixedSaved.id,mixedSaved.revision,{kind:'rate',rating:'good'});

  // Language roles are frozen into requests and prompts, not inferred from UI locale.
  const spanish={supportLanguageTag:'zh-CN',targetLanguageTag:'es'};
  const request=await makeRequest({id:id(),learner_user_id:accountId,learning_target_id:id(),fixed_input:{targetLanguageTag:'es',supportLanguageTag:'zh-CN',senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),planRevision:'fixture:1',expression:'tomar prestado',expressionKind:'phrase',meaning:semanticSpec.coreMeaningFocus,prototype:'一个人向同伴借用物品。',demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND}},id(),new Date());
  assert.deepEqual(requestLanguages(request),spanish);
  assert(generationSystem(true,spanish).includes('Spanish target-expression'));
  assert(generationSystem(false,spanish).includes('Chinese (Simplified) recall cue'));
  assert(independentReviewSystem(spanish).includes('Spanish target-expression leakage'));

  // A membership decision is Route-owned, not bound to a Content Task's old
  // support language. A real in-place support update must admit a new Scope.
  const pairInput=canonicalIntake(true);pairInput.sense!.senseKey='supplemental-pair-update';
  pairInput.sense!.semanticSpec.coreMeaningFocus='临时取得一把雨伞并预期归还（辅助语言更新案例）。';
  const pairMeaning=await intake.submit(pairInput),pairSource=(await api.worldReadRepository.detail(pairMeaning.personalMeaningId)).sources[0];
  const pairTask=await api.enrollPersonal(id(),pairSource,languageContext,false);
  const decide=(expectedRevision:number,active:boolean)=>api.learningSystem.execute({kind:'change_supplemental_membership',operationId:id(),source:{kind:'personal_meaning_alignment',id:pairTask.id},expectedRevision,active,languageContext});
  await decide(0,false);await decide(1,true);
  await api.updateLanguageRouteSupport(id(),languageContext.languageRouteId,'ja');
  const revisedContext=(await api.languageRoutesSnapshot()).context;
  await api.requestPersonalResourceUpdate(id(),pairTask.id,pairSource,revisedContext,false);
  mode='good';await api.preparePersonal(pairTask.id,pairSource,provider,await api.selectedReviewProvider(),new AbortController().signal,()=>{});
  assert.equal((await api.personalLearningTaskSnapshot(pairTask.id)).status,'ready');
  await api.learningSystem.execute({kind:'start',operationId:id(),targetId:pairTask.targetId,languageContext:revisedContext,dailyLimit:20});
  const activeScope=await api.readLibrary(async(tx:any)=>tx.get('studyScopes',(await tx.get('learningSessions',await tx.get('meta','learning-session-active'))).scopeRevisionId));
  const scopedSource=activeScope.members.find((member:any)=>member.targetId===pairTask.targetId).sources.find((source:any)=>source.membershipId===pairTask.curriculumMembershipId);
  assert.equal(activeScope.languageContext.supportLanguageTag,'ja');assert.equal(scopedSource.supplementalState.languageContext.supportLanguageTag,'zh-CN');
  api.validateBackupRows(await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)])))));

  // A correction retires the current personal connection, not the accepted
  // preparation attempts, real Memory/Run history or their historical pins.
  const historicalBefore=await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
  assert(historicalBefore.contentAttempts.some((row:any)=>row.value.fixedInput?.source.personalMeaningId===completed.personalMeaningId));
  assert(historicalBefore.learningTargets.some((row:any)=>row.value.memory),'this is actual saved learning, not empty-table no-cascade evidence');
  const correctionSeed=await api.worldReadRepository.correction(completed.personalMeaningId,slowSource.reference.personalMeaningAlignmentId),correctionId=id();
  const correctedSense={...correctionSeed.payload.sense,senseKey:null,wordingSource:'learner_authored',resolutionProvenance:{resolverKind:'learner',provider:'sensa-web-manual',model:null,policyVersion:null,sourceReferenceIds:[]},semanticSpec:{...correctionSeed.payload.sense.semanticSpec,coreMeaningFocus:'把自己的物品暂时交给别人使用，之后收回。'}};
  await gateway.correctPersonalMeaning({operationId:correctionId,personalMeaningId:completed.personalMeaningId,personalMeaningAlignmentId:slowSource.reference.personalMeaningAlignmentId,source:correctionSeed.source,payload:{...correctionSeed.payload,operationId:correctionId,acceptance:{mode:'learner_direct'},sense:correctedSense,expression:{...correctionSeed.payload.expression,surfaceForm:'lend',occurrence:{...correctionSeed.payload.expression.occurrence,surfaceForm:'lend'}}}});
  const historicalAfter=await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
  for(const table of api.libraryTables as string[])if(!table.startsWith('semantic')&&table!=='meta')assert.deepEqual(historicalAfter[table],historicalBefore[table],`${table} is independent of personal correction`);
  api.validateBackupRows(historicalAfter);
  assert(!(await api.worldReadRepository.detail(completed.personalMeaningId)).sources.some((source:any)=>source.reference.personalMeaningAlignmentId===slowSource.reference.personalMeaningAlignmentId));

  const dump=JSON.stringify(await api.readLibrary(async(tx:any)=>({attempts:await tx.all('contentAttempts'),tasks:await tx.all('personalLearning')})));
  assert(!dump.includes('fixture-secret'));
  console.log('PASS: incomplete canonical Intake → one Inbox → clarified Personal Meaning; complete Intake → direct Personal Meaning; both expose the same explicit Add-to-Learning path and authoritative Alignment references.');
  console.log('PASS: canonical Personal Meaning → generated material → learning runtime, with pinned language roles and no transport-specific or legacy Meaning copy. Fake IDB/HTTP; no paid models.');
}finally{
  restoreSpeech();
  globalThis.fetch=realFetch;
  await rm(temp,{recursive:true,force:true});
}

});
