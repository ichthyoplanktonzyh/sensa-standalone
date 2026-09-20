/** Application-lifetime scheduler. A screen owns its subscription, never a job.
 * No work starts on import/reload. Only explicit preparation enqueues a job. */
type Job={id:string;controller:AbortController;promise:Promise<void>;start:()=>void;cancel:()=>void};
export class BackgroundPreparationQueue {
 private jobs=new Map<string,Job>();
 private active=0;
 private waiting:Job[]=[];
 constructor(private concurrency=2,private capacity=64){}
 private pump(){while(this.active<this.concurrency&&this.waiting.length)this.waiting.shift()!.start();}
 run(id:string,work:(signal:AbortSignal)=>Promise<void>):Promise<void>{
  const existing=this.jobs.get(id);if(existing)return existing.promise;
  if(this.jobs.size>=this.capacity)return Promise.reject(Error('localFlow.modelQueueFull'));
  const controller=new AbortController();let resolve!:()=>void,reject!:(error:unknown)=>void;
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  const job:Job={id,controller,promise,cancel:()=>{
   controller.abort();const index=this.waiting.indexOf(job);
   if(index>=0){this.waiting.splice(index,1);this.jobs.delete(id);reject(Error('localFlow.requestStopped'));}
  },start:()=>{
   this.active++;
   void (async()=>{try{controller.signal.throwIfAborted();await work(controller.signal);resolve();}catch(error){reject(error);}finally{this.active--;this.jobs.delete(id);this.pump();}})();
  }};
  this.jobs.set(id,job);this.waiting.push(job);queueMicrotask(()=>this.pump());return promise;
 }
 cancel(id:string){this.jobs.get(id)?.cancel();}
 cancelAll(){for(const job of this.jobs.values())job.cancel();}
}
export const backgroundPreparation=new BackgroundPreparationQueue();
