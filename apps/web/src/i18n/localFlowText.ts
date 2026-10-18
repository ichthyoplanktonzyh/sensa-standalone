import i18n from './index';
import zhCN from './locales/zh-CN/localFlow.json';
import en from './locales/en/localFlow.json';
import ja from './locales/ja/localFlow.json';
import {interfaceLocales,resolveInterfaceLocale} from './localeRegistry';
import {registerTranslationNamespace} from './registerResources';

registerTranslationNamespace('localFlow',{'zh-CN':zhCN,en,ja});
const localFlowZh=zhCN.localFlow;
export const localFlowText=(key:keyof typeof localFlowZh,values?:Record<string,unknown>):string=>i18n.t(`localFlow.${key}`,typeof values?.count==='number'?{...values,formattedCount:new Intl.NumberFormat(resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language)).format(values.count)}:values);
/** Translate presentation notices, including earlier persisted UI copy. Never translate learner content. */
export function localFlowNotice(value:string|null|undefined):string {
 if(!value)return '';
 if(value.startsWith('libraryBackup.'))return i18n.t(value);
 for(const key of Object.keys(localFlowZh) as (keyof typeof localFlowZh)[]){
  const priorCopy=interfaceLocales.some(locale=>value===i18n.getResource(locale,'localFlow',`localFlow.${key}`));
  if(value===`localFlow.${key}`||priorCopy)return localFlowText(key);
 }
 // Reviewer reasons are content; only translate the product label around them.
 const reviewPrefixes=['localFlow.reviewRejected',...interfaceLocales.map(locale=>i18n.getResource(locale,'localFlow','localFlow.reviewRejected')).filter((prefix):prefix is string=>typeof prefix==='string')];
 for(const prefix of reviewPrefixes)if(value.startsWith(prefix))return localFlowText('reviewRejected')+value.slice(prefix.length);
 return value;
}

/** Keep actionable domain failures; do not show raw transport or schema dumps to learners. */
export function localFlowErrorKey(error:unknown,fallback:string):string {
 if(error instanceof Error&&['AbortError','TimeoutError'].includes(error.name))return 'localFlow.requestTimeout';
 const candidates=error instanceof Error?[error.message]:[];
 if(error&&typeof error==='object'&&'issues' in error&&Array.isArray(error.issues))for(const issue of error.issues)if(issue&&typeof issue.message==='string')candidates.push(issue.message);
 return candidates.find(key=>key.startsWith('localFlow.')&&i18n.exists(key))??fallback;
}
