/** Optional local assessment seam. Counts contain no keys, facts or credentials. */
let observer:((kind:string,count:number)=>void)|undefined;
export function observeReplicaWork(next:typeof observer):void{observer=next;}
export function replicaWork(kind:string,count=1):void{observer?.(kind,count);}
