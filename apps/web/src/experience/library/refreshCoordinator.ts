export interface RefreshCoordinator {
  request(): Promise<void>;
}

/**
 * Coalesce notification bursts while preserving a refresh requested during an
 * in-flight read. Callers share one deep scheduling seam instead of each table
 * subscription starting its own workspace reconstruction.
 */
export function createRefreshCoordinator(refresh:()=>Promise<void>):RefreshCoordinator{
 let requested=0;
 let completed=0;
 let drain:Promise<void>|null=null;
 const request=()=>{
  requested++;
  drain??=Promise.resolve().then(async()=>{
   let latestFailed=false;
   let latestError:unknown;
   while(completed<requested){
    const target=requested;
    try{await refresh();latestFailed=false;latestError=undefined;}
    catch(error){latestFailed=true;latestError=error;}
    finally{completed=target;}
   }
   if(latestFailed)throw latestError;
  }).finally(()=>{drain=null;});
  return drain;
 };
 return {request};
}
