/// <reference lib="webworker" />
/** Diagnostic wrapper only. No instrumentation is compiled into the product. */
import {SqliteRecordDatabase} from '../../apps/web/src/data/library/sqliteDatabase';
type Metric={calls:number;ms:number};
const phases:Record<string,Metric>={},projections:Record<string,Metric>={},reads:Record<string,Metric>={},sql=new Map<string,Metric>();
let phase='initialize';
const record=(metrics:Record<string,Metric>,key:string,elapsed:number)=>{const metric=metrics[key]??={calls:0,ms:0};metric.calls++;metric.ms+=elapsed;};
const emit=()=>self.postMessage({sensaRestoreProfile:{phases,projections,reads,execTimings:[...sql].sort((a,b)=>b[1].ms-a[1].ms).slice(0,25).map(([sql,metric])=>({sql,...metric}))}});
const instrumented=new WeakSet<object>(),initialize=SqliteRecordDatabase.prototype.initialize;
SqliteRecordDatabase.prototype.initialize=function(){
 const raw=Reflect.get(this,'database') as {exec(...args:unknown[]):unknown};
 if(!instrumented.has(raw)){
  instrumented.add(raw);const exec=raw.exec;
  raw.exec=function(...args){const text=typeof args[0]==='string'?args[0]:(args[0] as {sql?:string})?.sql??'',key=`${phase}: ${text.replace(/\s+/gu,' ').trim()}`,started=performance.now();
   try{return Reflect.apply(exec,this,args);}finally{const metric=sql.get(key)??{calls:0,ms:0};metric.calls++;metric.ms+=performance.now()-started;sql.set(key,metric);}
  };
  for(const name of ['meaningLookup','worldBrowseProjection','practiceExpressionProjection','journeyIdentities']){
   const projection=Reflect.get(this,name),update=projection.update;
   projection.update=function(...args:unknown[]){const started=performance.now();try{return Reflect.apply(update,this,args);}finally{record(projections,name,performance.now()-started);}};
  }
  const get=this.get;
  this.get=function(table,key){const started=performance.now();try{return get.call(this,table,key);}finally{record(reads,`${phase}:${table}`,performance.now()-started);}};
 }
 try{return initialize.call(this);}finally{phase='outside';}
};
const candidate=SqliteRecordDatabase.prototype.replicaCandidate;
SqliteRecordDatabase.prototype.replicaCandidate=async function(request){
 phase=request.kind;const started=performance.now();
 try{return await candidate.call(this,request);}finally{record(phases,request.kind,performance.now()-started);phase='outside';if(request.kind==='validate')emit();}
};
const commit=SqliteRecordDatabase.prototype.commit;
SqliteRecordDatabase.prototype.commit=function(mutation){
 phase=mutation.replicaCandidateRestore?'promotion':'other-commit';const started=performance.now();
 try{return commit.call(this,mutation);}finally{record(phases,phase,performance.now()-started);if(mutation.replicaCandidateRestore)emit();phase='outside';}
};
// Unlike a static production entry, this wrapper awaits a dynamic import.
// Preserve requests arriving during that await until the shipped listener is
// installed; otherwise the first initialize RPC can be consumed without reply.
const pending:unknown[]=[],buffer=(event:MessageEvent)=>{pending.push(event.data);event.stopImmediatePropagation();};
self.addEventListener('message',buffer);
await import('../../apps/web/src/data/library/sqliteWorker');
self.removeEventListener('message',buffer);
for(const data of pending)self.dispatchEvent(new MessageEvent('message',{data}));
