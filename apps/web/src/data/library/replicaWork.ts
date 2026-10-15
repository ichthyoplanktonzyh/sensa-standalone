/** Optional local assessment seam. Counts contain no keys, facts or credentials. */
let observer:((kind:string,count:number)=>void)|undefined;
export function observeReplicaWork(next:typeof observer):void{observer=next;}
export function replicaWork(kind:string,count=1):void{observer?.(kind,count);}

/** Delay assessment callbacks until the private native batch has released its reader. */
export function deferReplicaWork(): (publish?:boolean)=>void {
  const previous=observer;if(!previous)return ()=>{};
  const counts=new Map<string,number>();observer=(kind,count)=>counts.set(kind,(counts.get(kind)??0)+count);
  return (publish=true)=>{observer=previous;if(publish)for(const [kind,count]of counts)previous(kind,count);};
}
