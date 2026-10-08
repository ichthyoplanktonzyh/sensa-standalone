import {sqlitePoolDirectory} from './sqliteProtocol';

export type LocalLibraryNamespace=string|null;
export const localLibrarySelectionKey='sensa:local-library-selection:v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
type Selection={namespace:string;preservedNamespaces:LocalLibraryNamespace[];unreadableSelectionKey?:string};

export function validateLocalLibraryNamespace(value:unknown):LocalLibraryNamespace{
 if(value===null||typeof value==='string'&&uuid.test(value))return value;
 throw new Error('localFlow.storageOpen');
}
function selectionRaw():string|null{
 try{return typeof localStorage==='undefined'?null:localStorage.getItem(localLibrarySelectionKey);}
 catch(cause){throw new Error('localFlow.storageOpen',{cause});}
}
/** Presence only: a malformed selection is not permission to open the primary pool. */
export function hasLocalLibrarySelection():boolean{try{return selectionRaw()!==null;}catch{return true;}}
function selected(raw=selectionRaw()):Selection|null{
 if(raw===null)return null;
 try{
  const value=JSON.parse(raw);
  if(!value||validateLocalLibraryNamespace(value.namespace)===null||!Array.isArray(value.preservedNamespaces))throw new Error();
  return {namespace:value.namespace,preservedNamespaces:value.preservedNamespaces.map(validateLocalLibraryNamespace),...(typeof value.unreadableSelectionKey==='string'?{unreadableSelectionKey:value.unreadableSelectionKey}:{})};
 }catch(cause){throw new Error('localFlow.storageOpen',{cause});}
}
let captured:LocalLibraryNamespace|undefined;
let capturedRaw:string|null|undefined;
/** One page instance stays bound to one physical library, including its preferences. */
export function localLibraryNamespace():LocalLibraryNamespace{
 if(captured===undefined){capturedRaw??=selectionRaw();captured=selected(capturedRaw)?.namespace??null;}
 return captured;
}
export function localLibraryScopedName(name:string,namespace:LocalLibraryNamespace=localLibraryNamespace()):string{
 return namespace===null?name:`${name}:${validateLocalLibraryNamespace(namespace)}`;
}
/** Pure Worker-safe path mapping; a new directory never opens or rewrites the old pool. */
export function localLibraryPoolDirectory(namespace:LocalLibraryNamespace):string{
 return namespace===null?sqlitePoolDirectory:`${sqlitePoolDirectory}-${validateLocalLibraryNamespace(namespace)}`;
}
export function assertLocalLibrarySelected(namespace:LocalLibraryNamespace=localLibraryNamespace()):void{
 if((selected()?.namespace??null)===namespace)return;
 if(typeof document!=='undefined')document.documentElement.dataset.librarySelection='changed';
 if(typeof window!=='undefined')window.dispatchEvent(new Event('sensa-local-library-selected'));
 throw new Error('localFlow.libraryReplaced');
}
export function observeLocalLibrarySelection(namespace:LocalLibraryNamespace,onChange:()=>void):()=>void{
 const changed=()=>{try{assertLocalLibrarySelected(namespace);}catch{onChange();}};
 const stored=(event:StorageEvent)=>{if(event.key===localLibrarySelectionKey||event.key===null)changed();};
 window.addEventListener('storage',stored);window.addEventListener('sensa-local-library-selection-written',changed);
 return ()=>{window.removeEventListener('storage',stored);window.removeEventListener('sensa-local-library-selection-written',changed);};
}
/** Called only after explicit confirmation and under the old library transaction lock.
 * No OPFS removal, logical clear, backup restore, or migration is performed here. */
export function assertSeparateLibraryStartSource():LocalLibraryNamespace|undefined{
 try{const namespace=localLibraryNamespace();assertLocalLibrarySelected(namespace);return namespace;}
 catch(cause){
  const raw=selectionRaw();
  if(captured!==undefined||capturedRaw!==raw||raw===null||!(cause instanceof Error)||cause.message!=='localFlow.storageOpen')throw cause;
  return undefined;
 }
}
export function selectSeparateLocalLibrary():string{
 const source=assertSeparateLibraryStartSource(),raw=selectionRaw(),namespace=crypto.randomUUID();
 let previous:Selection|null=null,unreadableSelectionKey:string|undefined;
 if(source===undefined){
  // Preserve the exact unreadable pointer. No old pool is guessed or opened.
  unreadableSelectionKey=`${localLibrarySelectionKey}:unreadable:${namespace}`;
  localStorage.setItem(unreadableSelectionKey,raw!);
 }else previous=selected(raw);
 const preservedNamespaces=[...new Set([...(previous?.preservedNamespaces??[]),...(unreadableSelectionKey?[]:[previous?.namespace??null])])];
 unreadableSelectionKey??=previous?.unreadableSelectionKey;
 localStorage.setItem(localLibrarySelectionKey,JSON.stringify({namespace,preservedNamespaces,...(unreadableSelectionKey?{unreadableSelectionKey}:{})} satisfies Selection));
 window.dispatchEvent(new Event('sensa-local-library-selection-written'));
 return namespace;
}
