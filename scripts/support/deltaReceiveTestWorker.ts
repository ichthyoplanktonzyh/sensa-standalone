/// <reference lib="webworker" />
// Test-only fault seams around the shipped Worker. No production fault API,
// per-SQL timing, IO policy change, or simulated native-crash claim.
import {SqliteRecordDatabase} from '../../apps/web/src/data/library/sqliteDatabase';
import {decodeBackupValue} from '../../apps/web/src/data/library/backupCodec';
import {SqliteReplicaCandidates} from '../../apps/web/src/data/library/sqliteReplicaCandidates';
let database:SqliteRecordDatabase|undefined,drift=false,failCommit=false,loseAck=false,pause=false,release:(()=>void)|undefined;
let cooperativePreparation=false;
const initialize=SqliteRecordDatabase.prototype.initialize;
SqliteRecordDatabase.prototype.initialize=function(){database=this;return initialize.call(this);};
const begin=SqliteReplicaCandidates.prototype.beginIndex;
SqliteReplicaCandidates.prototype.beginIndex=function(...args){const id=begin.apply(this,args);if(drift){drift=false;Reflect.get(database!,'database').exec('UPDATE sensa_sync_base SET value_json=value_json WHERE table_name=\'meta\' AND record_key=\'identity\'');}return id;};
const request=SqliteRecordDatabase.prototype.replicaCandidate;
SqliteRecordDatabase.prototype.replicaCandidate=async function(message){if(message.kind==='validate'&&pause){pause=false;self.postMessage({deltaBarrier:true});await new Promise<void>(resolve=>{release=resolve;});}return request.call(this,message);};
const prepare=SqliteReplicaCandidates.prototype.validate;
SqliteReplicaCandidates.prototype.validate=async function(...args){
 if(!cooperativePreparation)return prepare.apply(this,args);cooperativePreparation=false;
 const raw=Reflect.get(database!,'database'),exec=raw.exec,compile=raw.prepare,nativeNow=performance.now.bind(performance);const nativeTimer=self.setTimeout.bind(self),timer=self.setTimeout;let clock=0,transaction=false,announced=false,held=false;
 const steps:Array<{statement:any;step:any}>=[];
 // Exhaust the cooperative budget and hold its first timer yield after a
 // scratch batch. Release only after the real history read or local write.
 performance.now=()=>nativeNow()+(clock+=10);
 self.setTimeout=((handler:TimerHandler,delay?:number,...args:any[])=>{
  if(announced&&!held&&delay===0){held=true;release=()=>nativeTimer(handler,0,...args);return nativeTimer(()=>{if(transaction)throw Error('delta_fixture_yield_inside_transaction');raw.exec('BEGIN IMMEDIATE');raw.exec('COMMIT');self.postMessage({deltaCooperative:{outsideTransaction:true}});},0);}
  return nativeTimer(handler,delay,...args);
 }) as typeof self.setTimeout;
 const wrap=(sql:string,statement:any)=>{if(sql!=='INSERT INTO sensa_replica_candidate_encoded_v1 VALUES(?,?,?,?,?,?,?)'||steps.some(row=>row.statement===statement))return statement;const step=statement.step;steps.push({statement,step});statement.step=function(...args:any[]){const result=step.apply(this,args);if(!announced)announced=true;return result;};return statement;};
 for(const [sql,statement]of Reflect.get(this,'statements'))wrap(sql,statement);
 raw.prepare=function(sql:string){return wrap(sql,compile.call(this,sql));};
 raw.exec=function(...input:any[]){const sql=typeof input[0]==='string'?input[0]:input[0]?.sql;if(sql==='BEGIN IMMEDIATE')transaction=true;const result=exec.apply(this,input);if(sql==='COMMIT'||sql==='ROLLBACK')transaction=false;return result;};
 try{return await prepare.apply(this,args);}finally{raw.exec=exec;raw.prepare=compile;for(const row of steps)row.statement.step=row.step;performance.now=nativeNow;self.setTimeout=timer;release=undefined;self.postMessage({deltaPreparationDone:true});}
};
const commit=SqliteRecordDatabase.prototype.commit;
SqliteRecordDatabase.prototype.commit=function(mutation){
 if(!mutation.replicaCandidateRestore?.update)return commit.call(this,mutation);
 const raw=Reflect.get(this,'database'),exec=raw.exec;
 if(failCommit){failCommit=false;raw.exec=function(...args:any[]){const sql=typeof args[0]==='string'?args[0]:args[0]?.sql;if(sql==='COMMIT')throw Error('delta_fixture_commit_failed');return exec.apply(this,args);};}
 try{const result=commit.call(this,mutation);if(loseAck){loseAck=false;self.postMessage({deltaLostAck:true});throw Error('delta_fixture_lost_local_ack');}return result;}finally{raw.exec=exec;}
};
self.addEventListener('message',event=>{
 if(!event.data?.deltaTest)return;event.stopImmediatePropagation();const {id,command}=event.data;
 try{
  const raw=Reflect.get(database!,'database');let result:unknown=null;
  if(command==='drift-after-begin')drift=true;
  else if(command==='fail-commit')failCommit=true;
  else if(command==='lose-ack')loseAck=true;
  else if(command==='pause-validation')pause=true;
  else if(command==='cooperative-preparation')cooperativePreparation=true;
  else if(command==='release'){release?.();release=undefined;}
  else if(command==='bad-certificate')raw.exec("UPDATE sensa_sync_dependency_state_v1 SET certificate_json='{' WHERE id=1");
  else if(command==='missing-certificate')raw.exec('UPDATE sensa_sync_dependency_state_v1 SET certificate_json=NULL WHERE id=1');
  else if(command==='corrupt-baseline')raw.exec("UPDATE sensa_sync_base SET value_json='[\"null\"]' WHERE table_name='meta' AND record_key='identity'");
  else if(command==='lost-edge')raw.exec('DELETE FROM sensa_sync_dependency_edges_v1 WHERE (table_name,record_key,kind,target)=(SELECT table_name,record_key,kind,target FROM sensa_sync_dependency_edges_v1 LIMIT 1)');
  else if(command==='snapshot')result={base:raw.exec({sql:'SELECT table_name,record_key,block_refs_json FROM sensa_sync_base ORDER BY 1,2',rowMode:'array',returnValue:'resultRows'}),certificate:raw.exec({sql:'SELECT * FROM sensa_sync_dependency_state_v1',rowMode:'object',returnValue:'resultRows'}),revision:decodeBackupValue(JSON.parse(database!.get('meta','local-content-revision')!))};
  else throw Error('delta_fixture_unknown_command');
  self.postMessage({deltaTest:id,result});
 }catch(cause){self.postMessage({deltaTest:id,error:String(cause)});}
});
const pending:unknown[]=[],buffer=(event:MessageEvent)=>{pending.push(event.data);event.stopImmediatePropagation();};self.addEventListener('message',buffer);
await import('../../apps/web/src/data/library/sqliteWorker');self.removeEventListener('message',buffer);for(const data of pending)self.dispatchEvent(new MessageEvent('message',{data}));
