export const interfaceLocaleRegistry={
  'zh-CN':{nativeName:'简体中文',direction:'ltr',fallback:null},
  en:{nativeName:'English',direction:'ltr',fallback:'zh-CN'},
  ja:{nativeName:'日本語',direction:'ltr',fallback:'en'},
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
  return interfaceLocales.find(locale=>locale.split('-')[0]!.toLowerCase()===primary)??defaultInterfaceLocale;
}
