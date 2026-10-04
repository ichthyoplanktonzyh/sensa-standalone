import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import type {ContentProvisioningTask,PersonalMeaningLearningSource} from '../../contentSupply/provisioning/contracts';
import type {WorldLearningChoice} from '../personalMeaningJourney/worldRead';

type Status='waiting'|'working'|'ready'|'failed';
export interface PersonalLearningBatchRow{choice:WorldLearningChoice;status:Status;notice:string}
export interface PersonalLearningBatchSnapshot{count:number;busy:boolean;version:number;context:SensaFormalPinnedLanguageContext|null;useContext:boolean;counts:Readonly<Record<Status,number>>}
export interface PersonalLearningBatchPort{
 resolve(choice:WorldLearningChoice):Promise<PersonalMeaningLearningSource>;
 enroll(source:PersonalMeaningLearningSource,context:SensaFormalPinnedLanguageContext,useContext:boolean):Promise<string>;
 task(id:string):Promise<ContentProvisioningTask|null>;
 revise(id:string,source:PersonalMeaningLearningSource,context:SensaFormalPinnedLanguageContext,useContext:boolean):Promise<unknown>;
 prepare(id:string,source:PersonalMeaningLearningSource):Promise<void>;
 cancel(id:string):void;
 stop(id:string):Promise<unknown>;
}
const notice=(cause:unknown)=>cause instanceof Error&&cause.message.startsWith('localFlow.')?cause.message:'localFlow.preparationPreserved';
export const isBatchTaskReady=(task:ContentProvisioningTask|undefined,context:SensaFormalPinnedLanguageContext)=>task?.status==='ready'&&task.languageContext.languageRouteId===context.languageRouteId&&task.languageContext.languageRouteRevision===context.languageRouteRevision&&task.languageContext.targetLanguageTag===context.targetLanguageTag&&task.languageContext.supportLanguageTag===context.supportLanguageTag;

/** Explicit intentions are saved before generation. Only compact choices are
 * retained: one full source during enrollment, at most three during preparation.
 * Waiting intentions survive stop; no provider work starts on reload/retry reads.
 * Progress updates replace one row, not a total-sized array per task event. */
export class PersonalLearningBatch{
 private rows:PersonalLearningBatchRow[]=[];
 private indexes=new Map<string,number>();
 private active=new Set<string>();
 private stopped=false;
 private stopping:Promise<void>|null=null;
 private stoppedTasks=new Set<string>();
 private stopFailures=new Map<string,unknown>();
 private notification:ReturnType<typeof setTimeout>|null=null;
 private listeners=new Set<()=>void>();
 private snapshot:PersonalLearningBatchSnapshot={count:0,busy:false,version:0,context:null,useContext:false,counts:{waiting:0,working:0,ready:0,failed:0}};
 constructor(private port:PersonalLearningBatchPort,private concurrency=3){if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('batch_concurrency_invalid');}
 read=()=>this.snapshot;
 rowAt=(index:number)=>this.rows[index];
 indexForKey=(key:string)=>this.indexes.get(key)??-1;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(change:Partial<PersonalLearningBatchSnapshot>={},immediate=false){
  this.snapshot={...this.snapshot,...change,version:this.snapshot.version+1};
  if(immediate){if(this.notification!==null)clearTimeout(this.notification);this.notification=null;for(const listener of this.listeners)listener();}
  else if(this.notification===null)this.notification=setTimeout(()=>{this.notification=null;for(const listener of this.listeners)listener();},16);
 }
 private mark(index:number,status:Status,message=''){
  const prior=this.rows[index]!;
  this.rows[index]={...prior,status,notice:message};
  this.publish({counts:{...this.snapshot.counts,[prior.status]:this.snapshot.counts[prior.status]-1,[status]:this.snapshot.counts[status]+(prior.status===status?0:1)}});
 }
 private result(index:number,task:ContentProvisioningTask|null,cause?:unknown){
  if(task?.status==='ready'){this.mark(index,'ready');return;}
  if(task&&['waiting','stopped'].includes(task.status)&&(!cause||this.stopped)){this.mark(index,'waiting',task.notice|| (cause?notice(cause):''));return;}
  this.mark(index,'failed',cause?notice(cause):task?.notice||(['generating','reviewing'].includes(task?.status??'')?'localFlow.preparationBusy':'localFlow.preparationPreserved'));
 }
 choices(status:Status){return this.rows.filter(row=>row.status===status).map(row=>row.choice);}
 stop=async()=>{
  if(!this.snapshot.busy)return;
  if(this.stopping)return this.stopping;
  this.stopped=true;
  const active=[...this.active];for(const id of active){this.stoppedTasks.add(id);this.port.cancel(id);}
  // At most concurrency tasks, not one stop command per waiting intention.
  this.stopping=Promise.allSettled(active.map(id=>this.port.stop(id))).then(results=>{results.forEach((result,index)=>{if(result.status==='rejected')this.stopFailures.set(active[index]!,result.reason);});});
  await this.stopping;
 };
 async run(choices:readonly WorldLearningChoice[],context:SensaFormalPinnedLanguageContext,useContext:boolean){
  if(this.snapshot.busy)return;
  const unique=[...new Map(choices.map(choice=>[choice.key,choice])).values()];
  this.rows=unique.map(choice=>({choice,status:'waiting',notice:''}));this.indexes=new Map(unique.map((choice,index)=>[choice.key,index]));
  this.stopped=false;this.stopping=null;this.active.clear();this.stoppedTasks.clear();this.stopFailures.clear();context=structuredClone(context);
  this.publish({count:unique.length,busy:true,context,useContext,counts:{waiting:unique.length,working:0,ready:0,failed:0}},true);
  const queued:{index:number;taskId:string}[]=[];
  try{
   for(let index=0;index<unique.length&&!this.stopped;index++){
    this.mark(index,'working');
    try{
     const source=await this.port.resolve(unique[index]!);
     if(this.stopped){this.mark(index,'waiting');break;}
     const taskId=await this.port.enroll(source,context,useContext);
     queued.push({index,taskId});this.mark(index,'waiting');
    }catch(cause){this.mark(index,'failed',notice(cause));}
   }
   let cursor=0;
   const worker=async()=>{
    while(!this.stopped&&cursor<queued.length){
     const {index,taskId}=queued[cursor++]!;this.mark(index,'working');
     try{
      let task=await this.port.task(taskId);if(!task)throw new Error('localFlow.enrollFirst');
      if(!isBatchTaskReady(task,context)||task.useContext!==useContext){
       const source=await this.port.resolve(unique[index]!);if(this.stopped){this.mark(index,'waiting');continue;}
       if(task.languageContext.languageRouteRevision!==context.languageRouteRevision||task.languageContext.supportLanguageTag!==context.supportLanguageTag||task.useContext!==useContext)
        await this.port.revise(taskId,source,context,useContext);
       if(this.stopped){this.mark(index,'waiting');continue;}
       this.active.add(taskId);
       try{await this.port.prepare(taskId,source);}finally{this.active.delete(taskId);}
       task=await this.port.task(taskId);if(!task)throw new Error('localFlow.enrollFirst');
      }
      this.result(index,task);
     }catch(cause){
      const task=await this.port.task(taskId).catch(()=>null);
      this.result(index,task,cause);
     }
    }
   };
   await Promise.all(Array.from({length:Math.min(this.concurrency,queued.length)},worker));
  }finally{
   if(this.stopping)await this.stopping;
   // Report the saved result of stop, not merely the cancellation request.
   for(const {index,taskId} of queued)if(this.stoppedTasks.has(taskId)){
    try{
     const task=await this.port.task(taskId);if(!task)throw new Error('localFlow.enrollFirst');
     const status=task.status==='ready'?'ready':this.stopFailures.has(taskId)||!['waiting','stopped'].includes(task.status)?'failed':'waiting';
     this.mark(index,status,status==='ready'?'':this.stopFailures.has(taskId)?notice(this.stopFailures.get(taskId)):task.notice||(['generating','reviewing'].includes(task.status)?'localFlow.preparationBusy':''));
    }catch(cause){this.mark(index,'failed',notice(cause));}
   }
   this.active.clear();this.publish({busy:false},true);
  }
 }
}
