import i18n from './index';
import {interfaceLocales,type InterfaceLocale} from './localeRegistry';
import type {TranslationNamespace} from './namespaces';

export type TranslationResource=Readonly<Record<string,unknown>>;
export type TranslationResources=Readonly<Partial<Record<InterfaceLocale,TranslationResource>>>;
const registered=new Set<TranslationNamespace>();
const inFlight=new Map<string,Promise<void>>();

function ensureNamespace(locale:InterfaceLocale,namespace:TranslationNamespace):Promise<void>{
 if(i18n.hasResourceBundle(locale,namespace))return Promise.resolve();
 const key=`${locale}/${namespace}`;
 const existing=inFlight.get(key);
 if(existing)return existing;
 const loading=import('./additionalMessages').then(module=>module.loadAdditionalMessages(locale,namespace)).then(messages=>{
  if(!i18n.hasResourceBundle(locale,namespace))i18n.addResourceBundle(locale,namespace,messages,true,true);
 }).finally(()=>inFlight.delete(key));
 inFlight.set(key,loading);
 return loading;
}

export async function ensureRegisteredNamespaces(locale:InterfaceLocale):Promise<void>{
 await Promise.all([...registered].map(namespace=>ensureNamespace(locale,namespace)));
}

// A lazy feature can register while an initial locale change is in flight.
// Finish that feature's messages and refresh its subscribers once, without
// changing the selected locale or storing a fallback as the preference.
i18n.on('languageChanged',(language:string)=>{
 const locale=language as InterfaceLocale;
 const missing=[...registered].filter(namespace=>!i18n.hasResourceBundle(locale,namespace));
 if(!missing.length)return;
 void Promise.all(missing.map(namespace=>ensureNamespace(locale,namespace))).then(()=>{
  if(i18n.language===locale)void i18n.changeLanguage(locale);
 });
});

/** Add one lazy feature's copy to the already initialized translation store. */
export function registerTranslationNamespace(namespace:TranslationNamespace,resources:TranslationResources):void{
 registered.add(namespace);
 for(const locale of interfaceLocales){
  const resource=resources[locale];
  if(resource)i18n.addResourceBundle(locale,namespace,resource,true,true);
 }
 const current=i18n.language as InterfaceLocale;
 if(!i18n.hasResourceBundle(current,namespace)){
  void ensureNamespace(current,namespace).then(()=>{
   if(i18n.language===current)void i18n.changeLanguage(current);
  });
 }
}
