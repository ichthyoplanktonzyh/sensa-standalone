export const interfaceLocaleRegistry={
  'zh-CN':{nativeName:'简体中文',direction:'ltr',fallback:null},
  en:{nativeName:'English',direction:'ltr',fallback:'zh-CN'},
  ja:{nativeName:'日本語',direction:'ltr',fallback:'en'},
  'zh-TW':{nativeName:'繁體中文',direction:'ltr',fallback:'zh-CN'},
  ko:{nativeName:'한국어',direction:'ltr',fallback:'en'},
  es:{nativeName:'Español',direction:'ltr',fallback:'en'},
  fr:{nativeName:'Français',direction:'ltr',fallback:'en'},
  de:{nativeName:'Deutsch',direction:'ltr',fallback:'en'},
  'pt-BR':{nativeName:'Português (Brasil)',direction:'ltr',fallback:'en'},
  it:{nativeName:'Italiano',direction:'ltr',fallback:'en'},
  ru:{nativeName:'Русский',direction:'ltr',fallback:'en'},
  id:{nativeName:'Bahasa Indonesia',direction:'ltr',fallback:'en'},
  vi:{nativeName:'Tiếng Việt',direction:'ltr',fallback:'en'},
  pl:{nativeName:'Polski',direction:'ltr',fallback:'en'},
  tr:{nativeName:'Türkçe',direction:'ltr',fallback:'en'},
} as const;

export type InterfaceLocale=keyof typeof interfaceLocaleRegistry;
export const interfaceLocales=Object.freeze(Object.keys(interfaceLocaleRegistry) as InterfaceLocale[]);
export const defaultInterfaceLocale:InterfaceLocale='zh-CN';

export function resolveInterfaceLocale(value:string|null|undefined):InterfaceLocale{
  if(!value)return defaultInterfaceLocale;
  let canonical:string;
  try{canonical=Intl.getCanonicalLocales(value.trim())[0]??'';}catch{return defaultInterfaceLocale;}
  const exact=interfaceLocales.find(locale=>locale.toLowerCase()===canonical.toLowerCase());
  if(exact)return exact;
  const primary=canonical.split('-')[0]!.toLowerCase();
  if(primary==='zh')return /(?:tw|hk|mo|hant)/iu.test(canonical)?'zh-TW':'zh-CN';
  if(primary==='pt')return 'en';
  return interfaceLocales.find(locale=>locale.split('-')[0]!.toLowerCase()===primary)??defaultInterfaceLocale;
}
