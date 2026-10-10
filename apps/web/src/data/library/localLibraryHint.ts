import {localLibraryScopedName} from './localLibraryLocation';
const key=()=>localLibraryScopedName('sensa:local-library-present:v1');

/** Prior-open hint, not content authority. It also prevents treating a missing
 * identity as first use; it cannot prove that any records survived. */
export function hasLocalLibraryHint():boolean{
 try{return localStorage.getItem(key())==='1';}catch{return false;}
}

export function markLocalLibraryPresent():void{
 try{localStorage.setItem(key(),'1');}catch{/* The library itself is in OPFS. */}
}

export function clearLocalLibraryHint():void{
 try{localStorage.removeItem(key());}catch{/* The hint is not authoritative. */}
}
