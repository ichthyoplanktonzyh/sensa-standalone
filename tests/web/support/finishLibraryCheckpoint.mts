/** Drains the real page protocol for tests whose boundary is the selected root. */
export async function finishLibraryCheckpoint(call:(path:string,body?:any)=>Promise<{status:number;value:any}>,input:Record<string,unknown>){
 let body=input;
 for(let page=0;page<=200000;page++){
  const reply=await call('/compact',body);
  if(reply.status!==200||!reply.value.preparation)return reply;
  const next=reply.value.preparation;body={baseRevision:next.revision,operationId:next.operationId,page:next.page};
 }
 throw Error('checkpoint_test_cursor_did_not_finish');
}
