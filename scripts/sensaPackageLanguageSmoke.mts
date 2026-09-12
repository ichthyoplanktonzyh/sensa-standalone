/** The languages a learning target carries into provisioning.
 *
 * A learning package, an enrolled target and a prepared personal meaning each
 * name the two languages their own text is in. The runtime used to stamp the
 * shipped English pair on whatever it was handed, so material prepared from a
 * Spanish meaning was materialized as English. This exercises the real schema,
 * the real material provisioning and the real view builders that carry the
 * languages from the data to the request.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {learningPackageSchema} from '@sensa/contracts/sensa';
import {indexedDB} from 'fake-indexeddb';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const compiled=await build({
  stdin:{
    contents:[
      `export {localTargetView} from './apps/web/src/experience/library/PackageLearningViews';`,
      `export {pendingPersonalTargetView} from './apps/web/src/experience/library/PersonalLearningControls';`,
      `export {lightweightContentInputForTarget,PROTOTYPE_LEARNING_TARGETS} from './apps/web/src/experience/learningJourney/prototypeLearning';`,
      `export {provisionLightweightInitialContent} from './apps/web/src/experience/learningRuntime/lightweightInitialContent';`,
    ].join('\n'),
    resolveDir:process.cwd(),
  },
  bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'},
});
Object.assign(globalThis,{
  indexedDB,
  window:new EventTarget(),
  location:{origin:'http://127.0.0.1:9996'},
  BroadcastChannel:undefined,
});
const temp=await mkdtemp(join(tmpdir(),'sensa-package-language-'));
await writeFile(join(temp,'core.mjs'),compiled.outputFiles[0]!.text);
const api=await import(pathToFileURL(join(temp,'core.mjs')).href);
const id=()=>crypto.randomUUID();

try{
  // Real material for a Spanish target, so the package under test is a package
  // the product could actually produce.
  const material=api.provisionLightweightInitialContent({
    learnerUserId:id(),learningTargetId:id(),senseId:id(),senseVersionId:id(),senseExpressionBindingId:id(),
    resolvedLearningPlanRevisionId:'fixture-es-v1',expressionSourceVersion:'fixture-es-v1',senseSourceVersion:'fixture-es-v1',
    expression:{surface:'tomarse su tiempo',languageTag:'es',expressionKind:'phrase'},
    sense:{meaning:'从容地花时间做一件事。',familiarLanguageTag:'zh-CN'},
    originExperience:{source:'other_authoritative_source',sourceVersion:'fixture-es-v1',personalAnchorUseGrantId:null,experience:{scene:'朋友催你快点，你说这件事需要慢慢来。',senseFocus:'从容地花时间',featureLabels:[]}},
    referenceFacts:[],requestedAt:'2026-09-01T00:00:00.000Z',
  });
  assert.equal(material.status,'ready');
  const entry={senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:'tomarse su tiempo',meaning:'从容地花时间做一件事。',content:material.materialization.content};
  const pack=(over:Record<string,unknown>={})=>({format:'sensa-learning-package-v1',id:id(),version:'1',title:'合成西语验证包',targetLanguage:'es',familiarLanguage:'zh-CN',entries:[entry],...over});

  // A package says which languages its own text is in. One that teaches the
  // language it explains in is malformed, not a native-speaker learner.
  const spanish=learningPackageSchema.safeParse(pack());
  assert.equal(spanish.success,true,JSON.stringify(spanish.error?.issues));
  assert.equal((spanish.data as {targetLanguage:string}).targetLanguage,'es');
  const equal=learningPackageSchema.safeParse(pack({familiarLanguage:'es'}));
  assert.equal(equal.success,false,'a package cannot teach the language it explains in');
  assert.ok(equal.error!.issues.some(issue=>issue.message.includes('must differ')),'the rejection names the language rule');
  assert.equal(learningPackageSchema.safeParse(pack({targetLanguage:'   '})).success,false,'a blank language tag is not a language');

  // The authored starter resource names its own languages, so the release
  // builder reads data instead of asserting English.
  const authored=JSON.parse(await readFile('content/authored/web-starter.json','utf8')) as {targetLanguage:string;familiarLanguage:string};
  assert.equal(authored.targetLanguage,'en');
  assert.equal(authored.familiarLanguage,'zh-CN');
  assert.notEqual(authored.targetLanguage,authored.familiarLanguage);

  // Provisioning takes the languages from the target rather than from a constant.
  const borrow=api.lightweightContentInputForTarget(api.PROTOTYPE_LEARNING_TARGETS['borrow-receive']);
  assert.equal(borrow.expression.languageTag,'en','the shipped prototype target keeps its own language');
  assert.equal(borrow.sense.familiarLanguageTag,'zh-CN');
  const spanishTarget={...api.PROTOTYPE_LEARNING_TARGETS['borrow-receive'],targetId:'fixture-es',targetLanguageTag:'es',familiarLanguageTag:'fr'};
  const spanishInput=api.lightweightContentInputForTarget(spanishTarget as never);
  assert.equal(spanishInput.expression.languageTag,'es','a target in another language is provisioned in that language');
  assert.equal(spanishInput.sense.familiarLanguageTag,'fr','the familiar language travels with the target too');

  // An enrolled package target carries the package's languages.
  const localTarget={id:'fixture',retentionId:'fixture-retention',packageKey:'fixture-package',expression:'tomarse su tiempo',meaning:'从容地花时间做一件事。',targetLanguageTag:'es',familiarLanguageTag:'zh-CN',material:{snapshot:{},content:{resources:[]}},createdAt:'2026-09-01T00:00:00.000Z',startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null};
  const localView=api.localTargetView(localTarget as never);
  assert.equal(localView.targetLanguageTag,'es','an enrolled target view names the package language');
  assert.equal(localView.familiarLanguageTag,'zh-CN');
  // A target written before the language profile existed is read as the shipped
  // pair rather than as an empty language.
  const legacyView=api.localTargetView({...localTarget,targetLanguageTag:undefined,familiarLanguageTag:undefined} as never);
  assert.equal(legacyView.targetLanguageTag,'en');
  assert.equal(legacyView.familiarLanguageTag,'zh-CN');

  // A prepared personal meaning carries the languages it was accepted in.
  const personalView=api.pendingPersonalTargetView({targetId:'fixture-personal',meaning:{targetLanguageTag:'ja',familiarLanguageTag:'zh-CN',proposal:{expression:{surface:'ありがとう'},semanticSpec:{coreMeaningFocus:'表达感谢。'}}},notice:''} as never);
  assert.equal(personalView.targetLanguageTag,'ja','a personal target view names the language its meaning was accepted in');
  assert.equal(personalView.familiarLanguageTag,'zh-CN');
  const legacyPersonal=api.pendingPersonalTargetView({targetId:'fixture-personal',meaning:{proposal:{expression:{surface:'borrow'},semanticSpec:{coreMeaningFocus:'临时取得。'}}},notice:''} as never);
  assert.equal(legacyPersonal.targetLanguageTag,'en','a meaning accepted before the profile existed reads as the shipped pair');
  assert.equal(legacyPersonal.familiarLanguageTag,'zh-CN');

  console.log('PASS: a learning package, an enrolled target and a prepared personal meaning each carry their own two languages into provisioning, and only a record older than the language profile reads as the shipped pair.');
}finally{
  await rm(temp,{recursive:true,force:true});
}
