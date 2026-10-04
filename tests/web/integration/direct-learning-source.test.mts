import {test,expect} from 'vitest';
import {resolveDirectLearningSource,type DirectLearningReference} from '../../../apps/web/src/learning/system/directLearningSource';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {semanticLookupPayload,advanceSemanticHeads} from '../support/semanticLookupFixtures';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSensaPortableLightweightPackage,readSensaPortableLightweightPackage} from '@sensa/content-validator/portable-lightweight';
import {sha256} from '@sensa/learning-kernel';
import type {SensaPortableLightweightPackage} from '@sensa/contracts/sensa';
import {preparePortablePackage} from '../../../apps/web/src/contentSupply/portable/portablePreparation';
import type {PortablePublicationAttestation} from '../../../apps/web/src/data/library/packageRecords';
import {assertDirectEnrollmentSource} from '../../../apps/web/src/data/library/curriculumEnrollments';

async function fixture(){
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 const state=await repository.load();
 const reference:DirectLearningReference={origin:{kind:'semantic_registry'},senseId:state.registry.senses[0]!.senseId,senseVersionId:state.registry.senseVersions[0]!.senseVersionId,bindingId:state.registry.bindings[0]!.senseExpressionBindingId,bindingVersionId:state.registry.bindingVersions[0]!.bindingVersionId};
 const rows=new Map<string,unknown>(),reads:string[]=[];
 const populate=(registry:typeof state.registry)=>{for(const [kind,values] of Object.entries(registry))for(const [ordinal,value] of values.entries()){
  const id=kind==='senses'?value.senseId:kind==='senseVersions'?value.senseVersionId:kind==='bindings'?value.senseExpressionBindingId:kind==='bindingVersions'?value.bindingVersionId:kind==='expressions'?value.expressionId:value.expressionVersionId;
  rows.set(`semanticRegistry/${kind}:${id}`,{kind,ordinal,value:structuredClone(value)});
 }};
 populate(state.registry);
 const reader={get:async(table:string,key:string)=>{reads.push(`${table}/${key}`);return structuredClone(rows.get(`${table}/${key}`));}};
 return {state,reference,rows,reads,reader,populate};
}

test('direct source resolves six exact registry rows without reading or creating a Personal Meaning',async()=>{
 const f=await fixture(),source=await resolveDirectLearningSource(f.reader,f.reference);
 expect(f.reads).toHaveLength(6);expect(f.reads.every(key=>key.startsWith('semanticRegistry/'))).toBe(true);
 expect(source).toMatchObject({sourceKind:'stable_sense',reference:f.reference,expression:{surfaceForm:'borrow',languageTag:'en'},reviewStatus:'learner_confirmed',publishedContent:null});
 expect(JSON.stringify(source)).not.toContain('Private source');expect(source).not.toHaveProperty('context');expect(source.reference).not.toHaveProperty('personalMeaningId');
 source.semanticSpec.coreMeaningFocus='local display edit';
 expect((await resolveDirectLearningSource(f.reader,f.reference)).semanticSpec.coreMeaningFocus).not.toBe('local display edit');
});

test('direct source pins the reviewed historical versions after every registry head advances',async()=>{
 const f=await fixture(),original=await resolveDirectLearningSource(f.reader,f.reference);
 f.populate(advanceSemanticHeads(f.state).registry);
 expect(await resolveDirectLearningSource(f.reader,f.reference,original.sourceDigest)).toEqual(original);
 f.rows.delete(`semanticRegistry/senseVersions:${f.reference.senseVersionId}`);
 await expect(resolveDirectLearningSource(f.reader,f.reference)).rejects.toMatchObject({reason:'missing'});
});

test('direct source rejects reference-only input, broken pins, rejected or non-exact bindings',async()=>{
 const f=await fixture();
 await expect(resolveDirectLearningSource(f.reader,{...f.reference,senseId:'ref.dictionary.borrow.1'})).rejects.toMatchObject({reason:'not_learnable'});
 expect(f.reads).toEqual([]);
 const bindingKey=`semanticRegistry/bindings:${f.reference.bindingId}`,versionKey=`semanticRegistry/bindingVersions:${f.reference.bindingVersionId}`;
 const binding:any=f.rows.get(bindingKey),version:any=f.rows.get(versionKey);
 version.value.senseVersionId=crypto.randomUUID();await expect(resolveDirectLearningSource(f.reader,f.reference)).rejects.toMatchObject({reason:'changed'});version.value.senseVersionId=f.reference.senseVersionId;
 binding.value.relation='approximates';await expect(resolveDirectLearningSource(f.reader,f.reference)).rejects.toMatchObject({reason:'not_learnable'});binding.value.relation='realizes';
 version.value.semanticCoverage='broader';await expect(resolveDirectLearningSource(f.reader,f.reference)).rejects.toMatchObject({reason:'not_learnable'});version.value.semanticCoverage='exact';
 version.value.reviewStatus='rejected';await expect(resolveDirectLearningSource(f.reader,f.reference)).rejects.toMatchObject({reason:'not_learnable'});version.value.reviewStatus='learner_confirmed';
 const sense:any=f.rows.get(`semanticRegistry/senseVersions:${f.reference.senseVersionId}`);sense.value.reviewStatus='rejected';
 await expect(resolveDirectLearningSource(f.reader,f.reference)).rejects.toMatchObject({reason:'not_learnable'});
});

test('direct source preserves declared language and rejects a changed preview digest without following replacements',async()=>{
 const f=await fixture();const expression=f.state.registry.expressions[0]!,version=f.state.registry.expressionVersions[0]!;
 (f.rows.get(`semanticRegistry/expressions:${expression.expressionId}`) as any).value.languageTag='en-US';
 const original=await resolveDirectLearningSource(f.reader,f.reference);expect(original.targetLanguageTag).toBe('en-US');
 (f.rows.get(`semanticRegistry/expressionVersions:${version.expressionVersionId}`) as any).value.surfaceForm='lend';
 await expect(resolveDirectLearningSource(f.reader,f.reference,original.sourceDigest)).rejects.toMatchObject({reason:'changed'});
});

test('direct published source requires exact installation and semantic declaration, never package media or Context in its result',async()=>{
 const f=await fixture(),packageId=crypto.randomUUID(),packageKey=JSON.stringify([packageId,'1']),packageDigest='a'.repeat(64);
 const reference:DirectLearningReference={...f.reference,origin:{kind:'published_package',packageKey,packageDigest}};
 const registry=f.state.registry;
 // The adapter here supplies already-admitted publication records. Public
 // archive validation is a separate suite, not proved by this controlled reader.
 const publication={member:{packageId,version:1},route:{targetLanguage:'en',supportLanguage:'zh-CN'}};
 const manifest={metadata:{packageId,version:1},route:publication.route,targetExpression:{text:'borrow'},semanticDeclaration:{
  contractVersion:'sensa-portable-semantic-declaration-v1',
  sense:{senseId:reference.senseId,senseVersionId:reference.senseVersionId,senseKey:'temporary-borrow',versionNumber:1,semanticPolicyVersion:'fixture-v1',semanticSpec:structuredClone(registry.senseVersions[0]!.semanticSpec)},
  expression:{expressionId:registry.expressions[0]!.expressionId,expressionVersionId:registry.expressionVersions[0]!.expressionVersionId,versionNumber:1,expressionType:'word',structure:{}},
  binding:{senseExpressionBindingId:reference.bindingId,bindingVersionId:reference.bindingVersionId,versionNumber:1,relation:'realizes',semanticCoverage:'exact',registerLabel:null,usageConstraints:[]},
 }};
 const archiveDigest='b'.repeat(64);
 const pack={key:packageKey,digest:archiveDigest,portableOrigin:{packageDigest,archiveDigest,manifest,publications:[publication]},content:{targetLanguage:'en',supportLanguage:'zh-CN',entries:[{
  senseId:reference.senseId,senseVersionId:reference.senseVersionId,bindingId:reference.bindingId,bindingVersionId:reference.bindingVersionId,expression:'borrow',
  content:{fixture:'large runtime media must not enter the selection'},semantic:{senseKey:'temporary-borrow',senseVersionNumber:1,semanticPolicyVersion:'fixture-v1',semanticSpec:registry.senseVersions[0]!.semanticSpec,
   expressionId:registry.expressions[0]!.expressionId,expressionVersionId:registry.expressionVersions[0]!.expressionVersionId,expressionType:'word',expressionVersionNumber:1,expressionStructure:{},bindingVersionNumber:1,relation:'realizes',semanticCoverage:'exact',registerLabel:null,usageConstraints:[]},
 }]}};
 f.rows.set(`packageCache/${packageKey}`,pack);f.rows.set(`packageInstallations/${packageKey}`,{format:'sensa-package-installation-v1',key:packageKey,artifact:{kind:'portable_package',packageId,version:1,packageDigest,digest:'b'.repeat(64),byteLength:1000,targetLanguage:'en',supportLanguage:'zh-CN'}});
 const source=await resolveDirectLearningSource(f.reader,reference);
 expect(f.reads).toHaveLength(2);expect(source.publishedContent).toEqual({packageKey,packageDigest,archiveDigest,supportLanguageTag:'zh-CN'});expect(JSON.stringify(source)).not.toContain('large runtime media');
 pack.content.supportLanguage='ja';await expect(resolveDirectLearningSource(f.reader,reference)).rejects.toMatchObject({reason:'changed'});pack.content.supportLanguage='zh-CN';
 pack.portableOrigin.publications=[];await expect(resolveDirectLearningSource(f.reader,reference)).rejects.toMatchObject({reason:'not_learnable'});
 pack.portableOrigin.publications=[publication];
 pack.content.entries[0]!.semantic.semanticSpec={...pack.content.entries[0]!.semantic.semanticSpec,coreMeaningFocus:'a changed compiled meaning'};
 await expect(resolveDirectLearningSource(f.reader,reference)).rejects.toMatchObject({reason:'changed'});
 pack.digest='c'.repeat(64);await expect(resolveDirectLearningSource(f.reader,reference)).rejects.toMatchObject({reason:'changed'});
 f.rows.delete(`packageCache/${packageKey}`);await expect(resolveDirectLearningSource(f.reader,reference)).rejects.toMatchObject({reason:'missing'});
});

test('the production Learning query resolves standalone registry facts without enrollment or Personal Meaning side effects',async()=>{
 const compiled=await build({stdin:{contents:[
  `export * from './apps/web/src/data/library/store';`,
  `export {learningSystem} from './apps/web/src/learning/system/learningSystem';`,
 ].join('\n'),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'},plugins:[{name:'fixture-auth',setup(builder){builder.onLoad({filter:/[/\\]account[/\\]auth\.ts$/},()=>({contents:"export const auth={getSession:async()=>({data:{session:null}})}; export {authStorageKey,cachedAuthSubject} from './authSessionHint';",loader:'ts'}));}}]});
 Object.assign(globalThis,{window:new EventTarget(),location:{origin:'http://direct-source.fixture'},BroadcastChannel:undefined});
 const directory=await mkdtemp(join(tmpdir(),'sensa-direct-source-'));
 try{
  await writeFile(join(directory,'source.mjs'),compiled.outputFiles[0]!.text);const api=await import(pathToFileURL(join(directory,'source.mjs')).href);
  await api.openLibrary();const f=await fixture();
  await api.restoreLibraryTransaction(async(tx:any)=>{for(const [key,row] of f.rows)tx.put('semanticRegistry',key.slice('semanticRegistry/'.length),row);});
  const counts=()=>api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(['semanticMeanings','semanticInbox','semanticReceipts','learningTargets','learningRuns','personalLearning','operations'].map(async table=>[table,await tx.count(table)]))));
  const before=await counts(),source=await api.learningSystem.read({kind:'direct_source',reference:f.reference});
  expect(source).toMatchObject({sourceKind:'stable_sense',expression:{surfaceForm:'borrow'}});
  expect(await counts()).toEqual(before);expect(before.semanticMeanings).toBe(0);expect(before.learningTargets).toBe(0);
  const choices=await api.learningSystem.read({kind:'direct_choices',query:' BOR',targetLanguageTag:'en',page:0});
  expect(choices).toEqual({items:[{reference:f.reference,expression:'borrow',meaning:source.semanticSpec.coreMeaningFocus}],hasMore:false});
  expect(await api.learningSystem.read({kind:'direct_choices',query:'borrow',targetLanguageTag:'ja',page:0})).toEqual({items:[],hasMore:false});
  expect(await counts()).toEqual(before);
  const query={kind:'direct_source',reference:f.reference,expectedDigest:source.sourceDigest};
  await api.restoreLibraryTransaction(async(tx:any)=>tx.delete('semanticRegistry',`bindingVersions:${f.reference.bindingVersionId}`));
  await expect(api.learningSystem.read(query)).rejects.toMatchObject({reason:'missing'});
  expect(await counts()).toEqual(before);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('a production-compiled published archive keeps separate digests and its actual spoken realization',async()=>{
 const f=await fixture(),registry=f.state.registry,packageId=crypto.randomUUID(),at='2026-10-05T00:00:00Z';
 const audio=new TextEncoder().encode('ID3 direct source fixture');
 const manifest:SensaPortableLightweightPackage={format:'sensa-portable-lightweight-package-v2',
  metadata:{packageId,version:1,title:'Borrow fixture',description:'Direct source test',createdAt:at,author:{name:'Fixture'},license:{name:'CC0'}},
  route:{targetLanguage:'en',supportLanguage:'zh-CN'},sense:{senseId:'borrow-fixture',meaning:'临时取得他人物品，并预期归还。'},
  targetExpression:{text:'borrow',expressionKind:'word',spokenForm:'borrow'},
  resources:{experienceRecallCue:{text:'May needs an umbrella and asks a colleague for one.',senseFocus:'临时借用'},senseConfirmation:{text:'临时使用，之后归还。'},
   pronunciation:{surface:'borrow',audioMediaId:'pronunciation',method:'recording',source:'Fixture'},sceneBridge:{text:'暂时使用同事的物品。'},
   sceneRealization:{example:'May asked to borrow an umbrella.',translation:'May 想借一把伞。',targetStart:13,targetEnd:19},optional:{}},
  media:[{mediaId:'pronunciation',kind:'audio',mimeType:'audio/x-fixture',sha256:sha256(audio),sizeBytes:audio.byteLength}],
  semanticDeclaration:{contractVersion:'sensa-portable-semantic-declaration-v1',
   sense:{senseId:f.reference.senseId,senseVersionId:f.reference.senseVersionId,senseKey:'temporary-borrow',versionNumber:1,semanticPolicyVersion:'fixture',semanticSpec:registry.senseVersions[0]!.semanticSpec},
   expression:{expressionId:registry.expressions[0]!.expressionId,expressionVersionId:registry.expressionVersions[0]!.expressionVersionId,versionNumber:1,expressionType:'word',structure:{spokenForm:'generic metadata is not the published realization'}},
   binding:{senseExpressionBindingId:f.reference.bindingId,bindingVersionId:f.reference.bindingVersionId,versionNumber:1,relation:'realizes',semanticCoverage:'exact',registerLabel:null,usageConstraints:[]}},
 };
 const bytes=createSensaPortableLightweightPackage(manifest,new Map([['pronunciation',audio]])),archive=readSensaPortableLightweightPackage(bytes);
 const publication:PortablePublicationAttestation={format:'sensa-portable-publication-attestation-v2',publisher:{namespace:'sensa.fixture',name:'Fixture'},
  book:{bookId:crypto.randomUUID(),bookKey:'direct-source-fixture',bookVersionId:crypto.randomUUID(),versionNumber:1,title:'Fixture',description:''},
  contentRelease:{contentReleaseId:crypto.randomUUID(),versionNumber:1,schemaVersion:'sensa-portable-lightweight-package-v2'},route:manifest.route,publishedAt:at,changeSummary:'fixture',bookArchiveSha256:'c'.repeat(64),memberCount:1,member:{packageId,version:1}};
 const prepared=preparePortablePackage(bytes,archive,publication),canonical=prepared.canonical;
 expect(canonical.archiveDigest).not.toBe(canonical.packageDigest);
 const key=prepared.installation.key;
 const pack={key,digest:canonical.archiveDigest,content:prepared.content,installedAt:at,portableOrigin:{format:'sensa-portable-installation-origin-v2',manifest:canonical.package,packageDigest:canonical.packageDigest,archiveDigest:canonical.archiveDigest,validatorVersion:'fixture',publications:[publication]}};
 f.rows.set(`packageInstallations/${key}`,prepared.installation);f.rows.set(`packageCache/${key}`,pack);
 const reference:DirectLearningReference={...f.reference,origin:{kind:'published_package',packageKey:key,packageDigest:canonical.packageDigest}};
  const source=await resolveDirectLearningSource(f.reader,reference);
  expect(source.expression.spokenForm).toBe('borrow');expect(source.publishedContent).toMatchObject({archiveDigest:canonical.archiveDigest,packageDigest:canonical.packageDigest});
  pack.portableOrigin.archiveDigest='d'.repeat(64);await expect(resolveDirectLearningSource(f.reader,reference)).rejects.toMatchObject({reason:'changed'});
  f.rows.delete(`packageCache/${key}`);
  expect(()=>assertDirectEnrollmentSource(source,(table,key)=>f.rows.get(`${table}/${key}`))).not.toThrow();
  const installation:any=f.rows.get(`packageInstallations/${key}`);installation.artifact.packageDigest='e'.repeat(64);
  expect(()=>assertDirectEnrollmentSource(source,(table,key)=>f.rows.get(`${table}/${key}`))).toThrow('changed');
});
