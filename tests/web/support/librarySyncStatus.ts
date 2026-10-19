/** Native receive can retire a read captured against the previous library.
 * That observation is not ready; every other read failure still fails the test. */
export async function readRestoringSyncStatus(read?:()=>Promise<string>):Promise<string>{
 try{return await (read?read():window.__sensaBrowserSmoke!.syncStatus());}
 catch(error){
  if(error instanceof Error&&error.message==='localFlow.libraryReplaced')return 'library-replacing';
  throw error;
 }
}
