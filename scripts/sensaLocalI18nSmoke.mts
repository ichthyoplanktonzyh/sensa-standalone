/** Guard the new local Web slices: interface copy belongs in locale resources, content does not. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {parse} from '@babel/parser';
import {libraryBackupZh,libraryBackupEn,modelServiceZh,modelServiceEn} from '../apps/web/src/i18n/localLibrary.ts';
import {localFlowZh,localFlowEn} from '../apps/web/src/i18n/localFlow.ts';
import {accountZh,accountEn} from '../apps/web/src/i18n/account.ts';
import i18n from '../apps/web/src/i18n/index.ts';
import {localFlowNotice} from '../apps/web/src/i18n/localFlowText.ts';
function parity(a:any,b:any,path=''){
 assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),path);
 for(const key of Object.keys(a)){
  if(typeof a[key]==='object'){parity(a[key],b[key],path+'.'+key);continue;}
  assert.equal(typeof b[key],'string');assert(b[key].trim());assert(!/[\u4e00-\u9fff]/u.test(b[key]),path+'.'+key);
  const placeholders=(s:string)=>[...s.matchAll(/\{\{(.*?)\}\}/gu)].map(m=>m[1]).sort();assert.deepEqual(placeholders(a[key]),placeholders(b[key]),path+'.'+key);
 }
}
parity(libraryBackupZh,libraryBackupEn);parity(modelServiceZh,modelServiceEn);parity(localFlowZh,localFlowEn);parity(accountZh,accountEn);
const folders=['apps/web/src/data/library','apps/web/src/experience/library'];
const files=(await Promise.all(folders.map(async d=>(await readdir(d)).filter(f=>/\.tsx?$/u.test(f)).map(f=>d+'/'+f)))).flat();
files.push(...['App.tsx','account/AccountExperience.tsx','account/ExtensionIntake.tsx','components/ProfileScreen.tsx','components/ProviderPanel.tsx','components/LibraryBackupPanel.tsx','components/PersonalMeaningComposer.tsx','components/PersonalMeaningDetailScreen.tsx','components/StudyScreen.tsx','components/learning/LearningPreferencesPanel.tsx','components/learning/LightweightRuntimeStartScreen.tsx'].map(p=>'apps/web/src/experience/'+p));
for(const file of files){
 const ast=parse(await readFile(file,'utf8'),{sourceType:'module',plugins:['typescript','jsx']});
 function visit(node:any,parent?:any){
  if(!node||typeof node!=='object')return;
  const value=node.type==='StringLiteral'||node.type==='JSXText'?node.value:node.type==='TemplateElement'?node.value.raw:'';
  // Frozen default-provider metadata predates this UI migration; changing it invalidates saved request snapshots.
  const frozenProvider=file.endsWith('/providers.ts')&&parent?.type==='ObjectProperty'&&parent.key?.name==='name'&&value==='Sensa 服务';
  if(typeof value==='string'&&(/^(localFlow|libraryBackup)\.[a-zA-Z]/u.test(value)))assert(i18n.exists(value),`${file}: unknown message key ${value}`);
  if(typeof value==='string'&&!frozenProvider)assert(!/[\u4e00-\u9fff]/u.test(value),`${file}:${node.loc?.start.line}: untranslated UI literal ${value}`);
  for(const [key,item] of Object.entries(node)){if(['loc','start','end','extra','comments','leadingComments','trailingComments','innerComments'].includes(key))continue;if(Array.isArray(item))item.forEach(n=>visit(n,node));else if(item&&typeof item==='object')visit(item,node);}
 }
 visit(ast);
}
await i18n.changeLanguage('en');assert.equal(localFlowNotice('localFlow.preparationStopped'),localFlowEn.preparationStopped);assert.equal(localFlowNotice(localFlowZh.preparationStopped),localFlowEn.preparationStopped);
const reason='原文和模型理由保持原样';assert.equal(localFlowNotice(localFlowZh.reviewRejected+reason),localFlowEn.reviewRejected+reason);
assert.equal(localFlowNotice('libraryBackup.errors.occupied'),libraryBackupEn.errors.occupied);
await i18n.changeLanguage('zh-CN');assert.equal(localFlowNotice(localFlowEn.preparationStopped),localFlowZh.preparationStopped);
console.log(`PASS: ${files.length} local Web files contain no untranslated UI literals, Chinese/English keys and placeholders match, persisted notices follow language changes and reviewer content is preserved.`);
