import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {loadCommonMessages,resources} from "./resources";
import {translationNamespaces} from './namespaces';
import {defaultInterfaceLocale,interfaceLocaleRegistry,interfaceLocales,resolveInterfaceLocale,type InterfaceLocale} from './localeRegistry';

export type InterfaceLanguage = InterfaceLocale;
const LANGUAGE_KEY = "sensa:interface-language:v1";
function initialLanguage(): InterfaceLanguage {
  if (typeof window === "undefined") return defaultInterfaceLocale;
  try {
    const saved=localStorage.getItem(LANGUAGE_KEY);
    return resolveInterfaceLocale(saved??navigator.language);
  } catch {
    return defaultInterfaceLocale;
  }
}
function applyLanguage(language: string) {
  const resolved = resolveInterfaceLocale(language);
  if (typeof document !== "undefined") {
    document.documentElement.lang = resolved;
    document.documentElement.dir = interfaceLocaleRegistry[resolved].direction;
    document.title = i18n.t("brand");
  }
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LANGUAGE_KEY, resolved);
  } catch {
    /* In-session switching still works. */
  }
}
const requestedInitialLanguage=initialLanguage();
const bundledInitialLanguage=requestedInitialLanguage in resources
  ? requestedInitialLanguage
  : interfaceLocaleRegistry[requestedInitialLanguage].fallback??defaultInterfaceLocale;
void i18n.use(initReactI18next).init({
  resources,
  lng: bundledInitialLanguage,
  fallbackLng: (requested)=>{
    const locale=resolveInterfaceLocale(requested);
    const fallback=interfaceLocaleRegistry[locale].fallback;
    return fallback?[fallback]:[];
  },
  supportedLngs: interfaceLocales,
  ns: translationNamespaces,
  defaultNS: 'common',
  fallbackNS: translationNamespaces.filter(namespace=>namespace!=='common'),
  interpolation: { escapeValue: false },
  initAsync: false,
});
i18n.on("languageChanged", applyLanguage);
applyLanguage(i18n.language);

export async function changeInterfaceLanguage(language:string):Promise<void>{
  const locale=resolveInterfaceLocale(language);
  if(!i18n.hasResourceBundle(locale,'common')){
    i18n.addResourceBundle(locale,'common',await loadCommonMessages(locale),true,true);
  }
  const {ensureRegisteredNamespaces}=await import('./registerResources');
  await ensureRegisteredNamespaces(locale);
  await i18n.changeLanguage(locale);
}

if(requestedInitialLanguage!==bundledInitialLanguage)void changeInterfaceLanguage(requestedInitialLanguage);
export default i18n;
