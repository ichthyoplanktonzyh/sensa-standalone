/** UI read lifecycle and bounded window cache. No command-gateway subscription. */
import type {JourneyGatewayStatus} from './gateway';
import type {WorldBrowseItem,WorldBrowseQuery,WorldLearningChoice,WorldLearningChoiceQuery} from './worldRead';
import type {WorldDetailSnapshot,WorldPageSnapshot,WorldReadStamp,WorldLearningChoiceSnapshot} from './worldRepository';

export interface WorldReadPort{
 subscribe(listener:()=>void):()=>void;
 page(query:WorldBrowseQuery):Promise<WorldPageSnapshot>;
 detail(id:string):Promise<WorldDetailSnapshot>;
}
const loading=():JourneyGatewayStatus=>({ok:true,error:null,errorKind:null,loading:true});
const ready=():JourneyGatewayStatus=>({ok:true,error:null,errorKind:null,loading:false});
const failed=(cause:unknown):JourneyGatewayStatus=>({ok:false,loading:false,
 error:cause instanceof Error?cause.message:String(cause),
 errorKind:cause instanceof Error&&['StoreCorruptedError','WorldSourceInvalidError','ZodError'].includes(cause.name)?'corrupted':'unavailable'});
const sameFrame=(left:WorldReadStamp,right:WorldReadStamp)=>left.incarnation===right.incarnation&&left.revision===right.revision;

interface WindowPage<Item> extends WorldReadStamp{items:Item[];total:number;pending?:number;inboxCount?:number;next?:WorldBrowseItem|null;expressionLanguages?:string[];expressionCount?:number}
interface WindowPort<Item,Query>{subscribe(listener:()=>void):()=>void;page(query:Query&{offset:number;limit:number}):Promise<WindowPage<Item>>}
export interface WorldWindowSnapshot<Item=WorldBrowseItem>{
 items:ReadonlyMap<number,Item>;total:number;pending:number;inboxCount:number;next:WorldBrowseItem|null;status:JourneyGatewayStatus;
 expressionLanguages?:string[];expressionCount?:number;
}
const pageSize=64,maxPages=8;
/** At most eight compact pages, independent of the size of the whole World.
 * Results from different Library frames or superseded queries are never mixed. */
export class WorldWindowReader<Item=WorldBrowseItem,Query=Pick<WorldBrowseQuery,'query'|'filter'>>{
 private snapshot:WorldWindowSnapshot<Item>={items:new Map(),total:0,pending:0,inboxCount:0,next:null,status:loading()};
 private listeners=new Set<()=>void>();
 private stop:(()=>void)|null=null;
 private generation=0;
 private frame:WorldReadStamp|null=null;
 private pages=new Map<number,Item[]>();
 private inFlight=new Map<number,Promise<void>>();
 private wanted=new Set<number>([0]);
 constructor(private port:WindowPort<Item,Query>,private query:Query){}
 read=()=>this.snapshot;
 private publish(next:WorldWindowSnapshot<Item>){this.snapshot=next;for(const listener of this.listeners)listener();}
 subscribe=(listener:()=>void)=>{
  this.listeners.add(listener);
  if(this.listeners.size===1){this.stop=this.port.subscribe(this.reload);this.reload();}
  return()=>{this.listeners.delete(listener);if(!this.listeners.size){this.stop?.();this.stop=null;this.generation++;this.inFlight.clear();}};
 };
 reload=()=>{
  this.generation++;this.frame=null;this.pages.clear();this.inFlight.clear();
  // total is only a scrollbar placeholder until the next coherent page. No
  // continuation action or Inbox badge may carry forward an unverified frame.
  this.publish({...this.snapshot,items:new Map(),pending:0,inboxCount:0,next:null,status:loading()});
  if(this.listeners.size)for(const offset of new Set([0,...this.wanted]))this.load(offset);
 };
 request=(indexes:readonly number[])=>{
  const wanted=new Set(indexes.filter(index=>index>=0&&index<this.snapshot.total).map(index=>Math.floor(index/pageSize)*pageSize));
  if(wanted.size>maxPages)throw new Error('world_window_too_wide');
  this.wanted=wanted;
  if(this.listeners.size&&this.snapshot.status.ok)for(const offset of this.wanted)this.load(offset);
 };
 private load(offset:number){
  if(this.pages.has(offset)||this.inFlight.has(offset))return;
  const generation=this.generation;
  const work=this.port.page({...this.query,offset,limit:pageSize}).then(page=>{
   if(generation!==this.generation||!this.listeners.size)return;
   if(this.frame&&!sameFrame(this.frame,page)){
    // A change may arrive before its notification. Invalidate other pending
    // reads too, not just rows that have already been cached.
    this.generation++;this.pages.clear();this.inFlight.clear();
   }
   this.frame=page;this.pages.delete(offset);this.pages.set(offset,page.items);
   for(const key of this.pages.keys())if(this.pages.size>maxPages&&!this.wanted.has(key))this.pages.delete(key);
   const items=new Map<number,Item>();for(const [start,rows] of this.pages)rows.forEach((item,index)=>items.set(start+index,item));
   this.publish({items,total:page.total,pending:page.pending??0,inboxCount:page.inboxCount??0,next:page.next??null,status:ready(),expressionLanguages:page.expressionLanguages,expressionCount:page.expressionCount});
  },cause=>{if(generation===this.generation&&this.listeners.size)this.publish({...this.snapshot,items:new Map(),pending:0,inboxCount:0,next:null,status:failed(cause)});})
   .finally(()=>{if(this.inFlight.get(offset)===work)this.inFlight.delete(offset);});
  this.inFlight.set(offset,work);
 }
}

/** Explicit select-all enumerates compact pins, not details. A concurrent
 * revision invalidates the whole read, rather than silently skipping/duplicating
 * items at shifted offsets. The caller commits the selection only on success. */
export async function collectLearningChoices(port:{learningChoices(query:WorldLearningChoiceQuery):Promise<WorldLearningChoiceSnapshot>},query:Omit<WorldLearningChoiceQuery,'offset'|'limit'>,signal:AbortSignal):Promise<WorldLearningChoice[]>{
 const choices=new Map<string,WorldLearningChoice>();let frame:WorldReadStamp|null=null,total:number|null=null;
 for(let offset=0;;offset+=256){
  signal.throwIfAborted();
  const page=await port.learningChoices({...query,offset,limit:256});signal.throwIfAborted();
  if(frame&&(!sameFrame(frame,page)||total!==page.total))throw new Error('localFlow.meaningChanged');
  frame=page;total=page.total;
  for(const choice of page.items){if(choices.has(choice.key))throw new Error('localFlow.meaningChanged');choices.set(choice.key,choice);}
  if(choices.size===total)return [...choices.values()];
  if(!page.items.length||choices.size>total)throw new Error('localFlow.meaningChanged');
 }
}

export interface WorldSnapshotRead<Value>{value:Value|null;status:JourneyGatewayStatus}
export type WorldDetailRead=WorldSnapshotRead<WorldDetailSnapshot>;
/** A single coherent snapshot with late-result fencing and explicit retry. */
export class WorldSnapshotReader<Value>{
 private snapshot:WorldSnapshotRead<Value>={value:null,status:loading()};
 private listeners=new Set<()=>void>();
 private stop:(()=>void)|null=null;
 private generation=0;
 private pending:AbortController|null=null;
 constructor(private port:{subscribe(listener:()=>void):()=>void;read(signal:AbortSignal):Promise<Value>},private onIdle:()=>void=()=>{}){}
 read=()=>this.snapshot;
 subscribe=(listener:()=>void)=>{
  this.listeners.add(listener);
  if(this.listeners.size===1){this.stop=this.port.subscribe(this.reload);this.reload();}
  return()=>{this.listeners.delete(listener);if(!this.listeners.size){this.stop?.();this.stop=null;this.generation++;this.pending?.abort();this.pending=null;this.onIdle();}};
 };
 reload=()=>{
  const generation=++this.generation;
  this.pending?.abort();const controller=new AbortController();this.pending=controller;
  // Keep one coherent prior frame while rechecking it. Replacing the detail
  // with null on every notification would unmount an unsaved Context editor.
  this.snapshot={value:this.snapshot.value,status:loading()};for(const listener of this.listeners)listener();
  if(!this.listeners.size)return;
  void this.port.read(controller.signal).then(value=>{
   if(generation!==this.generation||!this.listeners.size)return;
   this.snapshot={value,status:ready()};for(const listener of this.listeners)listener();
  },cause=>{
   if(generation!==this.generation||!this.listeners.size)return;
   this.snapshot={value:null,status:failed(cause)};for(const listener of this.listeners)listener();
  });
 };
}

/** Shared by the detail, draft and learning controls for this one Meaning. */
export class WorldDetailReader extends WorldSnapshotReader<WorldDetailSnapshot>{
 constructor(port:WorldReadPort,id:string,onIdle:()=>void=()=>{}){super({subscribe:listener=>port.subscribe(listener),read:()=>port.detail(id)},onIdle);}
}
