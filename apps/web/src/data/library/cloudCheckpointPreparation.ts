import {librarySyncCompactResult,type LibrarySyncHead,type LibrarySyncNativeSnapshot,type LibrarySyncPreparation} from '@sensa/contracts/sensa';
import type {SyncRequest} from './cloudSync';
import type {CloudSyncDeadline} from './cloudSyncDeadline';

type Input={baseRevision:number;operationId?:string;page?:number;nativeSnapshot?:LibrarySyncNativeSnapshot};

/** Finishes server-owned checkpoint pages without retaining a local writer lock.
 * The server cursor is durable across cancellation, reload and lost ACKs. Every
 * request remains bounded; only newly acknowledged pages report progress. */
export async function prepareCloudCheckpoint(request:SyncRequest,input:Input,deadline:CloudSyncDeadline):Promise<LibrarySyncHead>{
 deadline.beginInitial();let nativeRestart=false,body=input,completed=0,last:LibrarySyncPreparation|undefined;
 for(;;){
  deadline.check();const result=librarySyncCompactResult.parse(await request('/compact',body));
  if('revision'in result){
   // An existing refs preparation may have been joined before this caller
   // requested native attachment. Attach only after that checkpoint is selected.
   if(input.nativeSnapshot&&result.nativeSnapshot?.manifestHash!==input.nativeSnapshot.manifestHash){if(nativeRestart||result.revision!==input.baseRevision)throw Error('library_sync_head_changed');nativeRestart=true;body=input;last=undefined;continue;}
   return result;
  }
  const next=result.preparation;
  if(last&&(next.operationId!==last.operationId||next.revision!==last.revision||next.page<=last.page))throw Error('library_sync_cursor');
  last=next;deadline.progress('checkpoint-pages',++completed);
  body={baseRevision:next.revision,operationId:next.operationId,page:next.page};
  // Yield between HTTP windows; user commands and ordinary sync stay independent.
  await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
}
