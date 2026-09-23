import {sensaLanguageForDeclaredTag} from '@sensa/contracts/sensa';
import {extensionLanguage} from './i18n';

/** Localized presentation name; the catalog tag remains the language fact. */
export function interfaceLanguageName(tag:string):string{
 const language=sensaLanguageForDeclaredTag(tag);
 if(!language)return tag;
 try{return new Intl.DisplayNames([extensionLanguage()],{type:'language'}).of(language.tag)??language.endonym;}
 catch{return language.endonym;}
}
