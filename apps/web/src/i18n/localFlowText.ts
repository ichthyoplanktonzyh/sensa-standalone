import i18n from './index';
import {localFlowZh,localFlowEn} from './localFlow';
export const localFlowText=(key:keyof typeof localFlowZh,values?:Record<string,unknown>):string=>i18n.t(`localFlow.${key}`,values);
/** Translate presentation notices, including earlier persisted UI copy. Never translate learner content. */
export function localFlowNotice(value:string|null|undefined):string {
 if(!value)return '';
 if(value.startsWith('libraryBackup.'))return i18n.t(value);
 for(const key of Object.keys(localFlowZh) as (keyof typeof localFlowZh)[]){
  if(value===`localFlow.${key}`||value===localFlowZh[key]||value===localFlowEn[key])return localFlowText(key);
 }
 // Reviewer reasons are content; only translate the product label around them.
 for(const prefix of ['localFlow.reviewRejected',localFlowZh.reviewRejected,localFlowEn.reviewRejected])if(value.startsWith(prefix))return localFlowText('reviewRejected')+value.slice(prefix.length);
 return value;
}

/** Keep actionable domain failures; do not show raw transport or schema dumps to learners. */
export function localFlowErrorKey(error:unknown,fallback:string):string {
 if(error instanceof Error&&['AbortError','TimeoutError'].includes(error.name))return 'localFlow.requestTimeout';
 const candidates=error instanceof Error?[error.message]:[];
 if(error&&typeof error==='object'&&'issues' in error&&Array.isArray(error.issues))for(const issue of error.issues)if(issue&&typeof issue.message==='string')candidates.push(issue.message);
 return candidates.find(key=>key.startsWith('localFlow.')&&i18n.exists(key))??fallback;
}
