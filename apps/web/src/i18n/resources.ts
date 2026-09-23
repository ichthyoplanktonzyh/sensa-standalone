import zhCN from './locales/zh-CN/common.json';
import en from './locales/en/common.json';
import type {InterfaceLocale} from './localeRegistry';

/** The common namespace is part of the initial shell. Feature namespaces are
 * registered by their existing lazy entry modules. */
export const resources={
  'zh-CN':{common:zhCN},
  en:{common:en},
} as const;

/** Locales added after the original shell stay out of its static closure. */
export async function loadCommonMessages(locale:InterfaceLocale):Promise<Record<string,unknown>>{
  if(locale==='zh-CN')return zhCN;
  if(locale==='en')return en;
  if(locale==='ja')return (await import('./locales/ja/common.json')).default;
  const {loadAdditionalMessages}=await import('./additionalMessages');
  return loadAdditionalMessages(locale,'common');
}
