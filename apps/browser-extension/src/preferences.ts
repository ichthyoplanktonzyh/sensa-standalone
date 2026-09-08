export type ReadingPreferences={actionName:string;actionPrompt:string;disabledSites:string[]};
export const defaultPreferences:ReadingPreferences={actionName:'用法辨析',actionPrompt:'解释选中表达在当前语境中的用法，指出容易混淆的意思，并给出一个简短例句。',disabledSites:[]};
export async function readingPreferences():Promise<ReadingPreferences>{
  const stored=(await chrome.storage.local.get('readingPreferences')).readingPreferences;
  const raw=stored&&typeof stored==='object'?stored as Record<string,unknown>:{};
  return {actionName:typeof raw?.actionName==='string'?raw.actionName.slice(0,24):defaultPreferences.actionName,
    actionPrompt:typeof raw?.actionPrompt==='string'?raw.actionPrompt.slice(0,2000):defaultPreferences.actionPrompt,
    disabledSites:Array.isArray(raw?.disabledSites)?raw.disabledSites.filter((s:unknown)=>typeof s==='string').slice(0,100):[]};
}
