import i18n from './index';

type TranslationSection=Readonly<Record<string,unknown>>;

/** Add one lazy feature's copy to the already initialized translation store. */
export function registerTranslationSections(zh:TranslationSection,en:TranslationSection):void{
 i18n.addResourceBundle('zh-CN','translation',zh,true,true);
 i18n.addResourceBundle('en','translation',en,true,true);
}
