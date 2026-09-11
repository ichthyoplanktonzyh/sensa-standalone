import {z} from 'zod';
export const modelPurposeSchema=z.enum(['teacher','content','review','reading','probe']);
export type ModelPurpose=z.infer<typeof modelPurposeSchema>;
export const modelExecutionPolicySchema=z.object({maxConcurrent:z.number().int().min(1).max(16).default(2),perProvider:z.number().int().min(1).max(8).default(1),maxQueued:z.number().int().min(1).max(256).default(64),timeoutMs:z.number().int().min(1000).max(300000).default(45000)}).strict();
export type ModelExecutionPolicy=z.infer<typeof modelExecutionPolicySchema>;
export type ModelExecutionRecord={id:string;provider:string;model:string;purpose:ModelPurpose;state:'queued'|'running'|'succeeded'|'failed'|'cancelled';queuedAt:number;startedAt?:number;endedAt?:number;error?:string;inputTokens?:number;outputTokens?:number;traceId?:string};
export class ModelExecutionError extends Error {constructor(public code:string){super(code);this.name='ModelExecutionError';}}
/** Bounded per-runtime scheduler. Payloads/credentials never enter its records. */
export class ModelExecutionQueue {
 private active=0;private lanes=new Map<string,number>();private pending:{record:ModelExecutionRecord;start:()=>void;cancel:()=>void}[]=[];
 private records:ModelExecutionRecord[]=[];private listeners=new Set<()=>void>();
 readonly policy:ModelExecutionPolicy;
 constructor(policy:Partial<ModelExecutionPolicy>={},private emit?:(record:ModelExecutionRecord)=>void){this.policy=modelExecutionPolicySchema.parse(policy);}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 snapshot=()=>this.records.map(r=>({...r}));
 clear=()=>{this.records=this.records.filter(r=>['queued','running'].includes(r.state));this.notify();};
 private notify(){for(const f of this.listeners)try{f();}catch{/* Observers cannot interrupt work. */}}
 private pump(){
  while(this.active<this.policy.maxConcurrent){
   const now=Date.now();const ordered=[...this.pending].sort((a,b)=>{
    const rank=(r:ModelExecutionRecord)=>(['teacher','reading','probe'].includes(r.purpose)?0:1)-Math.floor((now-r.queuedAt)/10000);return rank(a.record)-rank(b.record)||a.record.queuedAt-b.record.queuedAt;
   });
   const job=ordered.find(j=>(this.lanes.get(j.record.provider)??0)<this.policy.perProvider);if(!job)return;
   this.pending.splice(this.pending.indexOf(job),1);job.start();
  }
 }
 run<T>(input:{id:string;provider:string;model:string;purpose:ModelPurpose},signal:AbortSignal,work:(signal:AbortSignal,record:ModelExecutionRecord)=>Promise<T>):Promise<T>{
  if(signal.aborted)return Promise.reject(new ModelExecutionError('model_cancelled'));
  if(this.records.some(r=>r.id===input.id&&['queued','running'].includes(r.state)))return Promise.reject(new ModelExecutionError('model_duplicate'));
  if(this.pending.length>=this.policy.maxQueued)return Promise.reject(new ModelExecutionError('model_queue_full'));
  const record:ModelExecutionRecord={...input,state:'queued',queuedAt:Date.now()};this.records.push(record);
  this.records=this.records.filter((r,i,all)=>i>=all.length-100||['queued','running'].includes(r.state));this.notify();
  const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,this.policy.timeoutMs);
  return new Promise<T>((resolve,reject)=>{
   const finish=(error?:unknown)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',job.cancel);record.endedAt=Date.now();record.state=error?(controller.signal.aborted?'cancelled':'failed'):'succeeded';if(error)record.error=controller.signal.aborted?(signal.aborted?'model_cancelled':'model_timeout'):error instanceof ModelExecutionError?error.code:error instanceof Error&&/^localFlow\.[a-zA-Z]+$/u.test(error.message)?error.message:'model_failed';this.notify();try{this.emit?.({...record});}catch{/* Metadata export is best effort. */}};
   const job={record,cancel:()=>{const index=this.pending.indexOf(job);if(index<0)return;this.pending.splice(index,1);const e=new ModelExecutionError(signal.aborted?'model_cancelled':'model_timeout');finish(e);reject(e);this.pump();},start:()=>{
    this.active++;this.lanes.set(record.provider,(this.lanes.get(record.provider)??0)+1);record.state='running';record.startedAt=Date.now();this.notify();
    void (async()=>{try{const result=await work(controller.signal,record);if(controller.signal.aborted)throw new ModelExecutionError(signal.aborted?'model_cancelled':'model_timeout');finish();resolve(result);}catch(error){finish(error);reject(controller.signal.aborted?new ModelExecutionError(record.error!):error);}finally{this.active--;this.lanes.set(record.provider,(this.lanes.get(record.provider)??1)-1);this.pump();}})();
   }};
   this.pending.push(job);controller.signal.addEventListener('abort',job.cancel,{once:true});if(controller.signal.aborted)job.cancel();else this.pump();
  });
 }
}
