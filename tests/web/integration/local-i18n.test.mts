import {test} from 'vitest';
/** Locale resources are data: registry, directories, namespaces, message keys,
 * interpolation variables, and runtime switching must stay in lockstep. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {parse} from '@babel/parser';
import {translationNamespaces} from '../../../apps/web/src/i18n/namespaces.ts';
import {defaultInterfaceLocale,interfaceLocaleRegistry,interfaceLocales,resolveInterfaceLocale} from '../../../apps/web/src/i18n/localeRegistry.ts';

test("local-i18n", async () => {

type Messages=Record<string,unknown>;
const localeRoot='apps/web/src/i18n/locales';
const localeDirectories=(await readdir(localeRoot,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
assert.deepEqual(localeDirectories,[...interfaceLocales].sort(),'locale registry and resource directories must match');

const readMessages=async(locale:string,namespace:string):Promise<Messages>=>JSON.parse(await readFile(`${localeRoot}/${locale}/${namespace}.json`,'utf8')) as Messages;
const resources=new Map<string,Map<string,Messages>>();
for(const locale of interfaceLocales){
  const files=(await readdir(`${localeRoot}/${locale}`)).filter(file=>file.endsWith('.json')).map(file=>file.slice(0,-5)).sort();
  assert.deepEqual(files,[...translationNamespaces].sort(),`${locale}: namespaces must match the registry`);
  resources.set(locale,new Map(await Promise.all(translationNamespaces.map(async namespace=>[namespace,await readMessages(locale,namespace)] as const))));
}

const placeholders=(value:string)=>[...value.matchAll(/\{\{(.*?)\}\}/gu)].map(match=>match[1]).sort();
const pluralSuffix=/^(.*)_(zero|one|two|few|many|other)$/u;
type MessageGroup={plain?:string;plurals:Map<string,string>};
function messageGroups(input:unknown,path=''):Map<string,MessageGroup>{
  const result=new Map<string,MessageGroup>();
  const visit=(value:unknown,current:string):void=>{
    if(typeof value==='string'){
      assert(value.trim(),`${current}: message must not be empty`);
      const match=pluralSuffix.exec(current);
      const base=match?.[1]??current,group=result.get(base)??{plurals:new Map<string,string>()};
      if(match)group.plurals.set(match[2]!,value);else group.plain=value;
      result.set(base,group);
      return;
    }
    assert(value&&typeof value==='object',`${current}: message tree contains only containers and strings`);
    for(const [key,item] of Object.entries(value))visit(item,current?`${current}.${key}`:key);
  };
  visit(input,path);
  return result;
}
const translatedCoverage=new Map<string,{comparable:number;distinct:number}>();
function parity(reference:unknown,candidate:unknown,namespace:string,locale:string):void{
  const expected=messageGroups(reference),actual=messageGroups(candidate);
  assert.deepEqual([...actual.keys()].sort(),[...expected.keys()].sort(),`${locale}:${namespace}: semantic message keys`);
  const requiredPluralCategories=[...new Intl.PluralRules(locale).resolvedOptions().pluralCategories].sort();
  for(const [key,referenceGroup] of expected){
    const candidateGroup=actual.get(key)!;
    const isPlural=referenceGroup.plurals.size>0;
    assert.equal(candidateGroup.plurals.size>0,isPlural,`${locale}:${key}: plural shape`);
    const referenceValue=referenceGroup.plain??referenceGroup.plurals.get('other')??[...referenceGroup.plurals.values()][0]!;
    const values=isPlural?[...candidateGroup.plurals.values()]:[candidateGroup.plain!];
    if(isPlural)assert.deepEqual([...candidateGroup.plurals.keys()].sort(),requiredPluralCategories,`${locale}:${key}: CLDR plural categories`);
    for(const value of values){
      assert.deepEqual(placeholders(value),placeholders(referenceValue),`${locale}:${key}: interpolation variables`);
      if(locale!=='en'&&/[A-Za-z]/u.test(referenceValue)){
        const coverage=translatedCoverage.get(locale)??{comparable:0,distinct:0};
        coverage.comparable++;
        if(value!==referenceValue)coverage.distinct++;
        translatedCoverage.set(locale,coverage);
      }
    }
  }
}
for(const locale of interfaceLocales){
  for(const namespace of translationNamespaces)parity(resources.get('en')!.get(namespace),resources.get(locale)!.get(namespace),namespace,locale);
}
for(const locale of interfaceLocales.filter(locale=>locale!=='en')){
  const coverage=translatedCoverage.get(locale);
  assert(coverage&&coverage.comparable>0&&coverage.distinct/coverage.comparable>.95,`${locale}: resources must be translated data, not an English alias`);
}

assert.equal(resolveInterfaceLocale('ja-JP'),'ja');
assert.equal(resolveInterfaceLocale('en-US'),'en');
assert.equal(resolveInterfaceLocale('zh-Hant-HK'),'zh-TW');
assert.equal(resolveInterfaceLocale('zh-SG'),'zh-CN');
assert.equal(resolveInterfaceLocale('pt-PT'),'en');
assert.equal(resolveInterfaceLocale('unsupported'),defaultInterfaceLocale);
for(const locale of interfaceLocales){
  const metadata=interfaceLocaleRegistry[locale];
  assert(metadata.nativeName.trim());
  assert(['ltr','rtl'].includes(metadata.direction));
  if(metadata.fallback)assert(interfaceLocales.includes(metadata.fallback));
}

const stored=new Map<string,string>();
const documentElement={lang:'',dir:''};
Object.assign(globalThis,{
  window:{},
  document:{documentElement,title:''},
  localStorage:{getItem:(key:string)=>stored.get(key)??null,setItem:(key:string,value:string)=>stored.set(key,value)},
});
const {changeInterfaceLanguage,default:i18n}=await import('../../../apps/web/src/i18n/index.ts');
await import('../../../apps/web/src/i18n/workspaceResources.ts');
const {localFlowText,localFlowErrorKey,localFlowNotice}=await import('../../../apps/web/src/i18n/localFlowText.ts');
for(const locale of interfaceLocales){
  await changeInterfaceLanguage(locale);
  assert.equal(documentElement.lang,locale);
  assert.equal(documentElement.dir,interfaceLocaleRegistry[locale].direction);
  assert.equal(stored.get('sensa:interface-language:v1'),locale);
  for(const namespace of translationNamespaces)assert(i18n.hasResourceBundle(locale,namespace),`${locale}:${namespace}: registered`);
  assert.equal(i18n.t('nav.home'),((resources.get(locale)!.get('common')!.nav as Messages).home));
  assert.equal(localFlowNotice('localFlow.preparationStopped'),(resources.get(locale)!.get('localFlow')!.localFlow as Record<string,string>).preparationStopped);
  assert.equal(i18n.t('learningPreferences.quantitySaveUnconfirmed'),(resources.get(locale)!.get('learning')!.learningPreferences as Record<string,string>).quantitySaveUnconfirmed);
  assert.equal(i18n.t('study.manageContent'),(resources.get(locale)!.get('learning')!.study as Messages).manageContent);
  assert.equal(i18n.t('bookPlanHeading.empty'),(resources.get(locale)!.get('learning')!.bookPlanHeading as Messages).empty);
  assert.equal(localFlowNotice('localFlow.supplementalEmpty'),(resources.get(locale)!.get('localFlow')!.localFlow as Record<string,string>).supplementalEmpty);
}

const zhLocalFlow=(resources.get('zh-CN')!.get('localFlow')!.localFlow as Record<string,string>);
const enLocalFlow=(resources.get('en')!.get('localFlow')!.localFlow as Record<string,string>);
const jaLocalFlow=(resources.get('ja')!.get('localFlow')!.localFlow as Record<string,string>);
for(const locale of ['zh-CN','en','de'] as const){
  await changeInterfaceLanguage(locale);
  assert(localFlowText('packageExpressionCount',{count:1000}).includes(new Intl.NumberFormat(locale).format(1000)));
  assert(!localFlowText('packagePreviewDirectory',{count:1}).includes('{{'));
}
await changeInterfaceLanguage('ja');
assert.equal(localFlowNotice('localFlow.preparationStopped'),jaLocalFlow.preparationStopped);
assert.equal(localFlowNotice(zhLocalFlow.preparationStopped),jaLocalFlow.preparationStopped);
assert.equal(localFlowNotice(enLocalFlow.preparationStopped),jaLocalFlow.preparationStopped);
assert.equal(localFlowErrorKey(new Error('localFlow.closeOldTabs'),'localFlow.networkRetry'),'localFlow.closeOldTabs');
assert.equal(localFlowErrorKey(new Error('transport exploded'),'localFlow.networkRetry'),'localFlow.networkRetry');
const reason='原文とモデルの理由はそのまま保持';
assert.equal(localFlowNotice(zhLocalFlow.reviewRejected+reason),jaLocalFlow.reviewRejected+reason,'reviewer content is never translated');

const folders=['apps/web/src/data/library','apps/web/src/experience/library'];
const files=(await Promise.all(folders.map(async directory=>(await readdir(directory)).filter(file=>/\.tsx?$/u.test(file)).map(file=>`${directory}/${file}`)))).flat();
files.push(...['App.tsx','account/AccountExperience.tsx','account/AccountDeletion.tsx','account/ExtensionIntake.tsx','appearance/AppearanceSettings.tsx','components/ProfileScreen.tsx','components/LocalAgentPanel.tsx','components/ProviderPanel.tsx','components/ModelExecutionPanel.tsx','components/LibraryBackupPanel.tsx','components/LocalDataControlPanel.tsx','components/ExpressionChatInput.tsx','components/learning/RichExperience.tsx','components/learning/LearningResourceDetails.tsx','components/PersonalMeaningComposer.tsx','components/PersonalMeaningDetailScreen.tsx','components/StudyScreen.tsx','components/learning/LearningPreferencesPanel.tsx','components/learning/LightweightRuntimeStartScreen.tsx'].map(path=>'apps/web/src/experience/'+path));
files.push(...['IntroductionCard','ExperienceRenderer','SensaRecognitionCard','SensaRecallCard','NovelTransferCard','review/SensaReviewAssessmentCard','review/SensaReviewFeedbackCard'].map(name=>`apps/web/src/experience/components/cards/${name}.tsx`));
files.push(...['SceneEditorModal','ReferenceDictionaryScreen','learning/RuntimeTools','learning/InterleavedFourStageRuntimeScreen','learning/InterleavedFourStageReviewScreen','LearnScreen','SensaExampleScreen','examples/ExampleCardCarousel','examples/LearningExampleLookup'].map(name=>`apps/web/src/experience/components/${name}.tsx`));
files.push(...['ContentComingSoonScreen.tsx','QuickDictPopup.tsx','StudyCalendar.tsx','ClickableSentence.tsx','ContentWorkspace.tsx','useImmediateDictionaryLookup.ts'].map(name=>`apps/web/src/experience/components/${name}`));
files.push('apps/web/src/experience/learningPresentation.ts');
for(const file of files){
  const ast=parse(await readFile(file,'utf8'),{sourceType:'module',plugins:['typescript','jsx']});
  function visit(node:any,parent?:any):void{
    if(!node||typeof node!=='object')return;
    const translator=node.type==='CallExpression'&&(node.callee?.type==='Identifier'&&node.callee.name==='t'
      ||node.callee?.type==='MemberExpression'&&!node.callee.computed&&node.callee.property?.name==='t');
    if(translator&&node.arguments[0]?.type==='StringLiteral')assert(i18n.exists(node.arguments[0].value,{ns:[...translationNamespaces]}),`${file}:${node.loc?.start.line}: unknown static translation key ${node.arguments[0].value}`);
    const value=node.type==='StringLiteral'||node.type==='JSXText'?node.value:node.type==='TemplateElement'?node.value.raw:'';
    const frozenProvider=file.endsWith('/providers.ts')&&parent?.type==='ObjectProperty'&&parent.key?.name==='name'&&value==='Sensa 服务';
    if(typeof value==='string'&&(/^(localFlow|libraryBackup)\.[a-zA-Z]/u.test(value)))assert(i18n.exists(value),`${file}: unknown message key ${value}`);
    if(typeof value==='string'&&!frozenProvider)assert(!/[\u4e00-\u9fff]/u.test(value),`${file}:${node.loc?.start.line}: untranslated UI literal ${value}`);
    for(const [key,item] of Object.entries(node)){
      if(['loc','start','end','extra','comments','leadingComments','trailingComments','innerComments'].includes(key))continue;
      if(Array.isArray(item))item.forEach(child=>visit(child,node));
      else if(item&&typeof item==='object')visit(item,node);
    }
  }
  visit(ast);
}

const extensionAst=parse(await readFile('apps/browser-extension/src/i18n.ts','utf8'),{sourceType:'module',plugins:['typescript']});
const messageDeclaration=(extensionAst.program.body as any[])
  .filter(node=>node.type==='VariableDeclaration')
  .flatMap(node=>node.declarations)
  .find((node:any)=>node.id.name==='messages');
const extensionMessageObject=messageDeclaration?.init?.type==='TSAsExpression'?messageDeclaration.init.expression:messageDeclaration?.init;
assert(extensionMessageObject?.type==='ObjectExpression','extension message table exists');
const extensionMessages=new Map<string,string>();
for(const property of extensionMessageObject.properties as any[]){
  assert(property.type==='ObjectProperty'&&property.key.type==='Identifier'&&property.value.type==='ArrayExpression');
  const [zh,en]=property.value.elements;
  assert(zh?.type==='StringLiteral'&&en?.type==='StringLiteral');
  extensionMessages.set(property.key.name,en.value);
}
const extensionLocales=(await readdir('apps/browser-extension/src/locales')).filter(file=>file.endsWith('.json')).map(file=>file.slice(0,-5)).sort();
assert.deepEqual(extensionLocales,interfaceLocales.filter(locale=>locale!=='en'&&locale!=='zh-CN').sort(),'extension locale files match interface registry');
const extensionPlaceholders=(value:string)=>[...value.matchAll(/\{([^{}]+)\}/gu)].map(match=>match[1]).sort();
for(const locale of extensionLocales){
  const translated=JSON.parse(await readFile(`apps/browser-extension/src/locales/${locale}.json`,'utf8')) as Record<string,string>;
  assert.deepEqual(Object.keys(translated).sort(),[...extensionMessages.keys()].sort(),`${locale}: extension message keys`);
  let distinct=0;
  for(const [key,english] of extensionMessages){
    const value=translated[key];
    assert(typeof value==='string'&&value.trim(),`${locale}:${key}: nonempty extension message`);
    assert.deepEqual(extensionPlaceholders(value),extensionPlaceholders(english),`${locale}:${key}: extension placeholders`);
    if(value!==english)distinct++;
  }
  assert(distinct/extensionMessages.size>.9,`${locale}: extension messages must be translated data`);
}
const extensionI18n=await import('../../../apps/browser-extension/src/i18n.ts');
assert.deepEqual([...extensionI18n.extensionLocales].sort(),[...interfaceLocales].sort(),'Web and extension support the same interface locales');
for(const file of ['options.html','popup.html','src/background.ts','src/options.ts','src/popup.ts','src/pageReading.ts','src/readingPanel.ts','src/inputTranslation.ts','src/youtubeReading.ts','src/readingClient.ts']){
  const source=await readFile(`apps/browser-extension/${file}`,'utf8');
  assert(!/[\u4e00-\u9fff]/u.test(source),`${file}: extension UI contains an untranslated Chinese literal`);
}
const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
for(const locale of extensionLocales){
  Object.defineProperty(globalThis,'navigator',{value:{language:locale},configurable:true});
  assert.equal(extensionI18n.extensionLanguage(),locale,`${locale}: extension locale detection`);
  assert.equal(extensionI18n.t('connected'),(JSON.parse(await readFile(`apps/browser-extension/src/locales/${locale}.json`,'utf8')) as Record<string,string>).connected);
}
Object.defineProperty(globalThis,'navigator',{value:{language:'zh-Hant-HK'},configurable:true});
assert.equal(extensionI18n.extensionLanguage(),'zh-TW');
Object.defineProperty(globalThis,'navigator',{value:{language:'pt-PT'},configurable:true});
assert.equal(extensionI18n.extensionLanguage(),'en');
Object.defineProperty(globalThis,'navigator',originalNavigator??{value:undefined,configurable:true});

console.log(`PASS: ${interfaceLocales.length} locales × ${translationNamespaces.length} Web namespaces and extension messages have matching keys and placeholders; runtime switching, persisted notices, direction, and ${files.length} Web files passed.`);

});
