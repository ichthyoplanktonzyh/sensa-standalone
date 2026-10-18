import RuntimeWorker from './sqliteRuntimeFailureWorker.ts?worker';
import ProductionWorker from '../../apps/web/src/data/library/sqliteWorker.ts?worker';
import type {SqliteWorkerInput,SqliteWorkerResult,SqliteWorkerResponse} from '../../apps/web/src/data/library/sqliteProtocol';

import type {ReplicaCandidateProgressObserver} from '../../apps/web/src/data/library/replicaCandidateProtocol';
let worker:Worker|undefined;
let nextId=1;
const pending=new Map<number,{resolve:(value:SqliteWorkerResult)=>void;reject:(cause:Error)=>void;onProgress?:ReplicaCandidateProgressObserver}>();
export const open=async(options:{unmodified?:boolean}={})=>{
  if(worker)throw new Error('sqlite_runtime_test_worker_already_open');
  const current=options.unmodified?new ProductionWorker():new RuntimeWorker();worker=current;
  await new Promise<void>((resolve,reject)=>{
    current.addEventListener('message',event=>{
      if(event.data.ready){resolve();return;}
      const response=event.data as SqliteWorkerResponse;
      const waiting=pending.get(response.id);
      if(waiting){if('kind' in response){waiting.onProgress?.(response.progress);return;}pending.delete(response.id);waiting.resolve(response);}
    });
    current.addEventListener('error',event=>{
      const cause=new Error(event.message||'sqlite_runtime_test_worker_error');reject(cause);
      for(const waiting of pending.values())waiting.reject(cause);
      pending.clear();
    });
    // Native Worker requests can be queued before module initialization. Only
    // the fault wrapper emits a test-ready message; keep it out of idle control.
    if(options.unmodified)resolve();
  });
};
export const request=(input:SqliteWorkerInput|{kind:'close'}|{kind:'test_arm_short_write'|'test_arm_checkpoint_short_write'|'test_arm_rollback_io_failure'|'test_arm_diagnostic_rollback_io_failure'|'test_arm_constructor_failure'|'test_probe_pool_free'|'test_native_write_stats'}|{kind:'test_seed_unsupported_schema';schemaVersion:17|18},onProgress?:ReplicaCandidateProgressObserver):Promise<SqliteWorkerResult>=>{
  if(!worker)throw new Error('sqlite_runtime_test_worker_missing');
  const id=nextId++;
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject,onProgress});worker!.postMessage({id,...input});
  });
};
export const terminate=()=>{worker?.terminate();worker=undefined;};
