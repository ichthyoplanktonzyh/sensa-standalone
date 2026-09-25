import {test} from 'vitest';
/** Canonical Personal Semantic World → Add-to-Learning → runtime smoke. */
import assert from 'node:assert/strict';
import {
  readSensaPortableLightweightPackage,
  validateSensaPortableLightweightPackage,
} from '@sensa/content-validator/portable-lightweight';
import {
  SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,
  generationSystem,
  independentReviewSystem,
  makeRequest,
  requestLanguages,
  sensaIntakePayloadSchema,
} from '@sensa/contracts/sensa';
import {indexedDB} from 'fake-indexeddb';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test("personal-learning", async () => {

const compiled=await build({stdin:{contents:[
  ...['store','providers','personalLearning','learning','language','speech/defaultProvider'].map(name=>`export * from './apps/web/src/data/library/${name}';`),
  `export * from './apps/web/src/experience/personalMeaningJourney/gateway';`,
  `export * from './apps/web/src/contentSupply/portable/personalPortablePackage';`,
  `export * from './apps/web/src/contentSupply/portable/portablePackage';`,
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
const realFetch=globalThis.fetch;
globalThis.fetch=async(_url,input)=>{
  if(String(_url).endsWith('/sensa/resource-facts'))return new Response(JSON.stringify({input:JSON.parse(String(input?.body)),references:[]}),{status:200});
  if(!input?.body)return new Response('[]',{headers:{'content-type':'application/json'}});
  const body=JSON.parse(String(input?.body));calls.push(body);
  const review=String(body.messages?.[0]?.content).includes('independent Sensa');
  if(review&&mode==='review-fail')throw Error('Offline');
  const result=review
    ?{accepted:mode!=='reject',reason:mode==='reject'?'场景改变了原意':'符合固定含义与来源'}
    :{resources:[{role:'experience_recall_cue',payload:{scene:mode==='leak'?'一个人想要 borrow 一把雨伞。':'一个人向同伴临时借用一把雨伞，约好之后归还。',senseFocus:'临时使用并预期归还'}},{role:'scene_bridge',payload:{text:'从取得者的视角表达临时使用并准备归还。'}},{role:'scene_realization',payload:{example:'May asked to borrow an umbrella.',targetStart:13,targetEnd:19,experienceResourceKey:'experience_recall_cue:0'}}]};
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
  const completed=await gateway.completeClarificationDraft({operationId:id(),intakeId:queued.intakeId,context:slow.context!,languageContext:{supportLanguageTag:'zh-CN',targetLanguageTag:'en'},focus:null,sense:{proposedSenseKey:'borrow-temporarily',coreMeaningFocus:semanticSpec.coreMeaningFocus,prototypeScenes:semanticSpec.prototypeScenes,includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[],unresolvedQuestions:[]},expression:{surfaceForm:'borrow',expressionType:'word',languageTag:'en',relation:'realizes',semanticCoverage:'exact'},expressionCandidates:[{surfaceForm:'borrow',expressionType:'word',languageTag:'en',relation:'realizes',semanticCoverage:'exact'}],confirmExpression:true,transcript:[{messageId:id(),role:'learner',body:'这里强调临时使用并归还。',occurredAt:'2026-09-16T01:01:00.000Z'}],provenance:{provider:'fixture',model:'fixture',promptVersion:'v1'},semanticPolicyVersion:'fixture-v1'});
  assert.equal(intake.snapshot().length,0);
  const slowSource=gateway.getLearningSources(completed.personalMeaningId)[0];
  assert(slowSource);assert.equal(slowSource.context.text,slow.context!.textSegment);assert.equal(slowSource.expression.surfaceForm,'borrow');
  const detail=gateway.getDetail(completed.personalMeaningId)!;
  assert.equal(detail.directAlignments[0]?.basisKind,'sense_construction');

  // Add-to-Learning sees only an authoritative Alignment reference. Enrolling
  // twice is idempotent and never manufactures a second Meaning record.
  const task=await api.enrollPersonal(id(),slowSource,languageContext,false);
  await api.enrollPersonal(id(),slowSource,languageContext,false);
  assert.equal((await api.personalLearningSnapshot()).length,1);
  assert.deepEqual(Object.keys(task).includes('meaning'),false);
  assert.equal((await api.readLearning()).targets.length,0);

  const prepare=async()=>api.preparePersonal(task.id,slowSource,provider,await api.selectedReviewProvider(),new AbortController().signal,()=>{});
  mode='leak';await prepare();
  assert.equal((await api.personalLearningSnapshot())[0].status,'rejected','the validator blocks target-expression leakage before publication');
  assert.equal((await api.readLearning()).targets.length,0);
  await api.setModelReviewEnabled(id(),true,(await api.providerSnapshot()).settings.revision);
  mode='review-fail';await assert.rejects(prepare());assert.equal((await api.readLearning()).targets.length,0);
  mode='good';await prepare();
  assert.equal((await api.personalLearningSnapshot())[0].status,'ready');
  const learning=await api.readLearning();assert.equal(learning.targets.length,1);
  assert.equal(learning.targets[0].identity.senseVersionId,slowSource.reference.senseVersionId);
  assert.equal(learning.targets[0].identity.bindingVersionId,slowSource.reference.bindingVersionId);

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
  assert.equal(personalPackage.package.media.length,1,'the generated TTS pronunciation is carried by .sensa');
  assert.equal(personalPackage.package.semanticDeclaration,undefined,'private export does not claim registry authority');
  const reinstalled=await api.installPortablePackage(firstExport.bytes,personalPackage.archiveDigest);
  assert.equal(reinstalled.content.entries[0].expression,'borrow','the personal .sensa re-enters through the public import path');

  await api.confirmLearningQuantity(id(),languageContext,20);
  let run=await api.startLearning(id(),task.targetId,languageContext,20);
  run=await api.actLearning(id(),run.id,run.revision,{kind:'reveal'});
  run=await api.actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'});
  assert.equal((await api.readLearning()).targets[0].memoryRevision,1);

  // A complete payload from any entry bypasses Inbox mechanically and yields
  // the same learning-source shape; provenance remains data on that record.
  const fast=canonicalIntake(true),accepted=await intake.submit(fast);
  assert.equal(accepted.route,'fast_track');
  const fastSource=gateway.getLearningSources(accepted.personalMeaningId)[0];
  assert(fastSource);assert.equal(fastSource.sourceKind,'personal_meaning_alignment');
  assert.equal(gateway.getDetail(accepted.personalMeaningId)!.directAlignments[0]?.basisKind,'contextual_resolution');
  assert.equal((await api.personalLearningSnapshot()).length,1,'admission never enrolls learning implicitly');

  // Language roles are frozen into requests and prompts, not inferred from UI locale.
  const spanish={supportLanguageTag:'zh-CN',targetLanguageTag:'es'};
  const request=await makeRequest({id:id(),learner_user_id:accountId,learning_target_id:id(),fixed_input:{targetLanguageTag:'es',supportLanguageTag:'zh-CN',senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),planRevision:'fixture:1',expression:'tomar prestado',expressionKind:'phrase',meaning:semanticSpec.coreMeaningFocus,prototype:'一个人向同伴借用物品。',demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND}},id(),new Date());
  assert.deepEqual(requestLanguages(request),spanish);
  assert(generationSystem(true,spanish).includes('Spanish target-expression'));
  assert(generationSystem(false,spanish).includes('Chinese (Simplified) recall cue'));
  assert(independentReviewSystem(spanish).includes('Spanish target-expression leakage'));

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
