/// <reference lib="webworker" />
import {SqliteRecordDatabase} from '../../apps/web/src/data/library/sqliteDatabase';
import {SqliteInitialPublication} from '../../apps/web/src/data/library/sqliteInitialPublication';
let sqlCalls=0,sqlMs=0;const rows=(SqliteInitialPublication.prototype as any).rows;(SqliteInitialPublication.prototype as any).rows=function(...args:any[]){const at=performance.now();try{return rows.apply(this,args);}finally{sqlCalls++;sqlMs+=performance.now()-at;}};
const candidate=SqliteRecordDatabase.prototype.replicaCandidate;
SqliteRecordDatabase.prototype.replicaCandidate=async function(request){
 const at=performance.now(),beforeSql=sqlMs,beforeCalls=sqlCalls;try{return await candidate.call(this,request);}finally{if(['publicationPage','publicationBlocks','validatePublication','admitOwnPublication','prepareUpdate'].includes(request.kind))self.postMessage({publicationStage:{kind:request.kind,sqlMs:sqlMs-beforeSql,sqlCalls:sqlCalls-beforeCalls,elapsedMs:performance.now()-at,startEpochMs:performance.timeOrigin+at}});}
};
const ownExport=SqliteRecordDatabase.prototype.exportOwnCloudSnapshot;
SqliteRecordDatabase.prototype.exportOwnCloudSnapshot=async function(...args){const at=performance.now(),snapshot=await ownExport.apply(this,args);self.postMessage({publicationStage:{kind:'buildOwnSnapshot',elapsedMs:performance.now()-at,startEpochMs:performance.timeOrigin+at,timingsMs:snapshot.timingsMs,fileBytes:snapshot.bytes.length,sha256:snapshot.sha256}});return snapshot;};
const ownBaseline=SqliteRecordDatabase.prototype.ownCloudBaselinePage;
SqliteRecordDatabase.prototype.ownCloudBaselinePage=function(page){const at=performance.now();try{return ownBaseline.call(this,page);}finally{self.postMessage({publicationStage:{kind:'ownBaselinePage',done:page.done,rows:page.rows.length,elapsedMs:performance.now()-at,startEpochMs:performance.timeOrigin+at}});}};
const commit=SqliteRecordDatabase.prototype.commit;
SqliteRecordDatabase.prototype.commit=function(mutation){const at=performance.now();try{return commit.call(this,mutation);}finally{if(mutation.initialPublication)self.postMessage({publicationStage:{kind:'baselineCommit',elapsedMs:performance.now()-at,startEpochMs:performance.timeOrigin+at}});}};
const pending:unknown[]=[],buffer=(event:MessageEvent)=>{pending.push(event.data);event.stopImmediatePropagation();};self.addEventListener('message',buffer);await import('../../apps/web/src/data/library/sqliteWorker');self.removeEventListener('message',buffer);for(const data of pending)self.dispatchEvent(new MessageEvent('message',{data}));
