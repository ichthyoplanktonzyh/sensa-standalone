/// <reference lib="webworker" />
// Isolated diagnostic only: one outer timer per selected phase; no SQL,
// decode, native IO hooks, profiler, storage configuration or policy changes.
import {SqliteReplicaCandidates} from '../../apps/web/src/data/library/sqliteReplicaCandidates';
import {SqliteRecordDatabase} from '../../apps/web/src/data/library/sqliteDatabase';
let active=false,sequence=0;
const seen=new Set<string>();
const start=(phase:string)=>{if(seen.has(phase))throw Error('duplicate_stage_diagnostic');seen.add(phase);const at=performance.now();self.postMessage({deltaStage:{sequence,phase,status:'started',startEpochMs:performance.timeOrigin+at}});return at;};
const end=(phase:string,at:number,error?:unknown)=>{const done=performance.now();self.postMessage({deltaStage:{sequence,phase,status:'completed',startEpochMs:performance.timeOrigin+at,endEpochMs:performance.timeOrigin+done,elapsedMs:done-at,error:error?String(error):null}});};
const begin=SqliteReplicaCandidates.prototype.beginIndex;
SqliteReplicaCandidates.prototype.beginIndex=function(...args){
 if(args[2]===undefined)return begin.apply(this,args);
 active=true;sequence++;seen.clear();const at=start('baselineCandidateBuild');let error;
 try{return begin.apply(this,args);}catch(cause){error=cause;throw cause;}finally{end('baselineCandidateBuild',at,error);}
};
const validate=SqliteReplicaCandidates.prototype.validate;
SqliteReplicaCandidates.prototype.validate=async function(...args){
 if(!active)return validate.apply(this,args);
 const at=start('restoreAdmission');let error;
 try{return await validate.apply(this,args);}catch(cause){error=cause;throw cause;}finally{end('restoreAdmission',at,error);}
};
const compare=SqliteReplicaCandidates.prototype.prepareUpdate;
SqliteReplicaCandidates.prototype.prepareUpdate=async function(...args){
 if(!active)return compare.apply(this,args);
 const at=start('domainComparison');let error;
 try{return await compare.apply(this,args);}catch(cause){error=cause;throw cause;}finally{end('domainComparison',at,error);}
};
const commit=SqliteRecordDatabase.prototype.commit;
SqliteRecordDatabase.prototype.commit=function(mutation){
 if(!active||!mutation.replicaCandidateRestore?.update)return commit.call(this,mutation);
 const at=start('factsBaselineProjectionsCleanupCommit');let error;
 try{return commit.call(this,mutation);}catch(cause){error=cause;throw cause;}finally{end('factsBaselineProjectionsCleanupCommit',at,error);}
};
const discard=SqliteReplicaCandidates.prototype.discard;
SqliteReplicaCandidates.prototype.discard=function(...args){
 if(!active)return discard.apply(this,args);
 const at=start('finalDiscard');let error;
 try{return discard.apply(this,args);}catch(cause){error=cause;throw cause;}finally{end('finalDiscard',at,error);active=false;}
};
const pending:unknown[]=[],buffer=(event:MessageEvent)=>{pending.push(event.data);event.stopImmediatePropagation();};
self.addEventListener('message',buffer);
await import('../../apps/web/src/data/library/sqliteWorker');
self.removeEventListener('message',buffer);
for(const data of pending)self.dispatchEvent(new MessageEvent('message',{data}));
