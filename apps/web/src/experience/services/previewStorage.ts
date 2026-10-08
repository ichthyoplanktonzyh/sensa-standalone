import {assertLocalLibrarySelected,localLibraryScopedName} from '../../data/library/localLibraryLocation';
/** Device UI state, not domain facts. Appearance is global; drafts and selections
 * belong to one local library. New libraries never migrate or clear old keys. */
const PREFIX = 'sensa:web-ui:v1:';
const storageKey=(key:string)=>{
 if(key==='appearance')return PREFIX+key;
 assertLocalLibrarySelected();return localLibraryScopedName(PREFIX+key);
};
export const previewStorage = {
  getItem(key: string): string | null {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(storageKey(key));
  },
  setItem(key: string, value: string): void {
    if (typeof window !== 'undefined') window.localStorage.setItem(storageKey(key), value);
  },
  removeItem(key: string): void {
    if (typeof window !== 'undefined') window.localStorage.removeItem(storageKey(key));
  },
  subscribe(key: string, listener: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const selectedKey = storageKey(key);
    const handle = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && (event.key === selectedKey || event.key === null)) listener();
    };
    window.addEventListener('storage', handle);
    return () => window.removeEventListener('storage', handle);
  },
};
