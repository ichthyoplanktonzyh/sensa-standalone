export const cloudSyncTransferLimits={passMs:90_000,stallMs:90_000,requestMs:15_000} as const;
export type CloudSyncProgress={phase:string;completed:number};

/** Daily passes have a fixed deadline. First transfers instead expire after
 * no completed work; reporting the same page/byte count cannot renew it. */
export class CloudSyncDeadline{
 private controller=new AbortController();
 private timer:ReturnType<typeof setTimeout>|undefined;
 private initial=false;
 private completed=new Map<string,number>();
 private caller?:AbortSignal;
 private cancel=()=>this.controller.abort(Error('library_sync_cancelled'));
 readonly signal=this.controller.signal;
 constructor(caller?:AbortSignal,private onProgress?:(progress:CloudSyncProgress)=>void){
  this.caller=caller;if(caller?.aborted)this.cancel();else caller?.addEventListener('abort',this.cancel,{once:true});
  this.arm(cloudSyncTransferLimits.passMs,'library_sync_network');
 }
 private arm(ms:number,message:string){clearTimeout(this.timer);if(!this.signal.aborted)this.timer=setTimeout(()=>this.controller.abort(Error(message)),ms);}
 get isInitial(){return this.initial;}
 beginInitial(){this.check();if(!this.initial){this.initial=true;this.arm(cloudSyncTransferLimits.stallMs,'library_sync_stalled');}}
 progress(phase:string,completed:number){
  this.check();if(!this.initial||!Number.isSafeInteger(completed)||completed<0)throw Error('library_sync_progress_invalid');
  if(completed<=(this.completed.get(phase)??-1))return;
  this.completed.set(phase,completed);this.arm(cloudSyncTransferLimits.stallMs,'library_sync_stalled');this.onProgress?.({phase,completed});
 }
 check(){if(this.signal.aborted)throw this.signal.reason;}
 async run<T>(work:(beginCommit:()=>void)=>Promise<T>,signal:AbortSignal=this.signal):Promise<T>{
  this.check();signal.throwIfAborted();
  // Existing storage/pointer commit callbacks call this synchronously at their
  // atomic boundary. Cancellation can stop preparation, then honors the actual
  // commit result instead of overwriting a completed checkpoint as cancelled.
  let committed=false;const beginCommit=()=>{this.check();signal.throwIfAborted();committed=true;clearTimeout(this.timer);};
  let stop!:()=>void;const aborted=new Promise<never>((_,reject)=>{stop=()=>{if(!committed)reject(signal.reason);};signal.addEventListener('abort',stop,{once:true});});
  try{const value=await Promise.race([work(beginCommit),aborted]);if(!committed){this.check();signal.throwIfAborted();}return value;}
  finally{signal.removeEventListener('abort',stop);}
 }
 async request<T>(work:(signal:AbortSignal)=>Promise<T>){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('library_sync_network')),cloudSyncTransferLimits.requestMs);
  try{return await this.run(()=>work(AbortSignal.any([this.signal,controller.signal])),AbortSignal.any([this.signal,controller.signal]));}
  finally{clearTimeout(timer);}
 }
 async cleanup(work:()=>Promise<unknown>){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('library_sync_cleanup_pending')),cloudSyncTransferLimits.requestMs);})]);}catch{}finally{clearTimeout(timer);}
 }
 close(){clearTimeout(this.timer);this.caller?.removeEventListener('abort',this.cancel);}
}
