const key='sensa:local-library-present:v1';

/** Navigation hint only; OPFS remains the source of truth. */
export function hasLocalLibraryHint():boolean{
 try{return localStorage.getItem(key)==='1';}catch{return false;}
}

export function markLocalLibraryPresent():void{
 try{localStorage.setItem(key,'1');}catch{/* The library itself is in OPFS. */}
}

export function clearLocalLibraryHint():void{
 try{localStorage.removeItem(key);}catch{/* The hint is not authoritative. */}
}
