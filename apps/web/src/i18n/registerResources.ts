import i18n from './index';
import {interfaceLocales,type InterfaceLocale} from './localeRegistry';
import type {TranslationNamespace} from './namespaces';

export type TranslationResource=Readonly<Record<string,unknown>>;
export type TranslationResources=Readonly<Record<InterfaceLocale,TranslationResource>>;

/** Add one lazy feature's copy to the already initialized translation store. */
export function registerTranslationNamespace(namespace:TranslationNamespace,resources:TranslationResources):void{
 for(const locale of interfaceLocales)i18n.addResourceBundle(locale,namespace,resources[locale],true,true);
}
