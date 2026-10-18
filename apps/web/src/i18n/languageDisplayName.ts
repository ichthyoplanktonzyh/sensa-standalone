import {sensaLanguageForDeclaredTag} from '@sensa/contracts/sensa/language';
import type {InterfaceLocale} from './localeRegistry';

/** Language names are presentation data. The learning catalogue supplies the
 * canonical tag and endonym; the platform localizes its display name for the
 * active interface locale. */
export function interfaceLanguageDisplayName(tag:string,locale:InterfaceLocale):string{
  const language=sensaLanguageForDeclaredTag(tag);
  if(!language)return tag;
  try{return new Intl.DisplayNames([locale],{type:'language'}).of(language.tag)??language.endonym;}
  catch{return language.endonym;}
}
