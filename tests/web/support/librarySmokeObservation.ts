/** Import-free so the same observer runs inside page.evaluate and deterministic contracts. */
type Bridge=Pick<NonNullable<Window['__sensaBrowserSmoke']>,'syncStatus'|'cloudSyncStateForTest'|'cloudCheckpointForTest'|'durableBackupFactsForTest'|'seedSemanticWorld'>;
export type SmokeRead='ready'|'status'|'checkpoint'|'facts';
export async function observeLibrarySmoke(options:{operation:SmokeRead;allowNativeReplacement?:boolean},getBridge?:()=>Bridge|undefined,getSelection?:()=>string|null){
 const bridge=getBridge?getBridge():window.__sensaBrowserSmoke;
 if(!bridge||['syncStatus','cloudSyncStateForTest','cloudCheckpointForTest','durableBackupFactsForTest','seedSemanticWorld'].some(key=>typeof bridge[key as keyof Bridge]!=='function'))return {state:'initializing' as const};
 try{
  // Fence the physical selection even before a library has cloud-sync metadata.
  const beforeSelection=options.operation==='facts'||options.operation==='checkpoint'?(getSelection?getSelection():typeof localStorage==='undefined'?null:localStorage.getItem('sensa:local-library-selection:v1')):undefined;
  const before=options.operation==='facts'||options.operation==='checkpoint'?await bridge.cloudSyncStateForTest():undefined;
  const value=options.operation==='ready'?true:options.operation==='status'?await bridge.syncStatus():options.operation==='facts'?await bridge.durableBackupFactsForTest():await bridge.cloudCheckpointForTest();
  if(options.operation==='facts'||options.operation==='checkpoint'){
   const after=await bridge.cloudSyncStateForTest();
   if(beforeSelection!==(getSelection?getSelection():typeof localStorage==='undefined'?null:localStorage.getItem('sensa:local-library-selection:v1')))throw Error('testFixture.libraryChangedDuringRead');
   if(JSON.stringify(before?{owner:before.owner,incarnation:before.incarnation}:null)!==JSON.stringify(after?{owner:after.owner,incarnation:after.incarnation}:null))throw Error('testFixture.libraryChangedDuringRead');
  }
  if((getBridge?getBridge():window.__sensaBrowserSmoke)!==bridge)throw Error('testFixture.bridgeReplaced');
  return {state:'ready' as const,value};
 }catch(error){
  if(options.operation==='status'&&options.allowNativeReplacement===true&&error instanceof Error&&error.message==='localFlow.libraryReplaced')return {state:'library-replacing' as const};
  throw error;
 }
}
