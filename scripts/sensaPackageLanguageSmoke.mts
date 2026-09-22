import {withBindingFixture} from './support/lightweightMaterialFixture.mts';
/** The languages a Curriculum membership carries into provisioning.
 *
 * A learning package, a route membership and a prepared personal meaning each
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
      `export {localTargetView} from './apps/web/src/experience/library/localTargetView';`,
      `export {pendingPersonalTargetView} from './apps/web/src/experience/library/PersonalLearningControls';`,
      `export {provisionLightweightInitialContent} from './apps/web/src/contentSupply/provisioning/lightweightInitialContent';`,
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
  const material=api.provisionLightweightInitialContent(withBindingFixture({
    learnerUserId:id(),learningTargetId:id(),senseId:id(),senseVersionId:id(),senseExpressionBindingId:id(),
    resolvedLearningPlanRevisionId:'fixture-es-v1',expressionSourceVersion:'fixture-es-v1',senseSourceVersion:'fixture-es-v1',
    expression:{surface:'tomarse su tiempo',languageTag:'es',expressionKind:'phrase'},
    sense:{meaning:'从容地花时间做一件事。',supportLanguageTag:'zh-CN'},
    originExperience:{source:'other_authoritative_source',sourceVersion:'fixture-es-v1',personalAnchorUseGrantId:null,experience:{scene:'朋友催你快点，你说这件事需要慢慢来。',senseFocus:'从容地花时间',featureLabels:[]}},
    referenceFacts:[],requestedAt:'2026-09-01T00:00:00.000Z',
  }));
  assert.equal(material.status,'ready');
  const entry={senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:'tomarse su tiempo',meaning:'从容地花时间做一件事。',content:material.materialization.content};
  const pack=(over:Record<string,unknown>={})=>({format:'sensa-learning-package-v1',id:id(),version:'1',title:'合成西语验证包',targetLanguage:'es',supportLanguage:'zh-CN',entries:[entry],...over});

  // A package says which languages its own text is in; the two roles may be
  // filled by the same absolute language.
  const spanish=learningPackageSchema.safeParse(pack());
  assert.equal(spanish.success,true,JSON.stringify(spanish.error?.issues));
  assert.equal((spanish.data as {targetLanguage:string}).targetLanguage,'es');
  const equal=learningPackageSchema.safeParse(pack({supportLanguage:'es'}));
  assert.equal(equal.success,true,'an immersion package may use one language for Target and Support');
  assert.equal(learningPackageSchema.safeParse(pack({targetLanguage:'   '})).success,false,'a blank language tag is not a language');

  // The authored starter resource names its own languages, so the release
  // builder reads data instead of asserting English.
  const authored=JSON.parse(await readFile('content/authored/web-starter.json','utf8')) as {targetLanguage:string;supportLanguage:string};
  assert.equal(authored.targetLanguage,'en');
  assert.equal(authored.supportLanguage,'zh-CN');
  assert.notEqual(authored.targetLanguage,authored.supportLanguage);

  // The Target owns the target language; its Route membership owns Support.
  const membership={packageKey:'fixture-package',languageContext:{languageRouteId:id(),languageRouteRevision:1,targetLanguageTag:'es',supportLanguageTag:'zh-CN'},material:material.materialization};
  const localTarget={id:'fixture',retentionId:'fixture-retention',curriculumMemberships:[membership],expression:'tomarse su tiempo',policyAssignment:{assignmentId:'fixture-assignment',revision:1,scope:'system_default',profileId:'lightweight',assignedByOperationId:'fixture-operation',assignedAt:'2026-09-01T00:00:00.000Z',provenance:{}},committedPolicy:null,planningOverrides:[],targetLanguageTag:'es',introducedLanguageRouteId:null,createdAt:'2026-09-01T00:00:00.000Z',startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null,relearningState:null};
  const localView=api.localTargetView(localTarget as never,membership as never);
  assert.equal(localView.targetLanguageTag,'es','an enrolled target view names the package language');
  assert.equal(localView.supportLanguageTag,'zh-CN');
  // A prepared personal meaning carries the languages it was accepted in.
  const personalView=api.pendingPersonalTargetView({targetId:'fixture-personal',languageContext:{languageRouteId:id(),languageRouteRevision:1,targetLanguageTag:'ja',supportLanguageTag:'zh-CN'},meaning:{proposal:{expression:{surface:'ありがとう'},semanticSpec:{coreMeaningFocus:'表达感谢。'}}},notice:''} as never);
  assert.equal(personalView.targetLanguageTag,'ja','a personal target view names the language its meaning was accepted in');
  assert.equal(personalView.supportLanguageTag,'zh-CN');
  console.log('PASS: a learning package, a Route-scoped Curriculum membership and a prepared personal meaning carry explicit Target and Support Languages into provisioning; missing language data is never relabelled with defaults.');
}finally{
  await rm(temp,{recursive:true,force:true});
}
