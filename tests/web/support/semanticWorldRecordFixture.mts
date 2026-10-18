import {storeMeaningContexts,collectMeaningContexts,contextKey,contextRecordId,type ContextRecord} from '../../../apps/web/src/experience/personalMeaningJourney/contextRecords';
/** Candidate storage fixture, not a learner-fact write or a cloud restore. */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {decodeBackupValue,encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import type {SemanticWorldRecordReader,SemanticWorldRecordTable} from '../../../apps/web/src/experience/personalMeaningJourney/authority';
import type {JourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store';
import type {LibraryRecordReader} from '../../../apps/web/src/data/library/libraryRecordReader';
import type {SqliteLibraryTable} from '../../../apps/web/src/data/library/sqliteProtocol';

export type SemanticCandidateRecord={table:SemanticWorldRecordTable;key:string;value:unknown};
export type LibraryCandidateRecord={table:SqliteLibraryTable;key:string;value:unknown};
const ids={senses:'senseId',senseVersions:'senseVersionId',expressions:'expressionId',expressionVersions:'expressionVersionId',bindings:'senseExpressionBindingId',bindingVersions:'bindingVersionId'} as const;
export function* semanticRecords(state:JourneyState):Generator<SemanticCandidateRecord>{
 state={...state,contexts:{...state.contexts}};collectMeaningContexts(state);
 yield {table:'semanticState',key:'root',value:{version:state.version}};
 for(const value of state.meanings)yield {table:'semanticMeanings',key:value.personalMeaning.personalMeaningId,value:storeMeaningContexts(value)};
 for(const kind of ['anchors','anchorRevisions'] as const)for(const value of state.contexts[kind]){const row={kind,value,...(kind==='anchorRevisions'?{parentRevisionId:state.contexts.anchorRevisionParents[(value as JourneyState['contexts']['anchorRevisions'][number]).personalSemanticAnchorRevisionId]}:{})} as ContextRecord;yield {table:'semanticContexts',key:contextKey(kind,contextRecordId(row)),value:row};}
 for(const kind of Object.keys(ids) as Array<keyof typeof ids>){let ordinal=0;for(const value of state.registry[kind])yield {table:'semanticRegistry',key:`${kind}:${(value as unknown as Record<string,string>)[ids[kind]]}`,value:{kind,ordinal:ordinal++,value}};}
 for(const value of state.inboxItems)yield {table:'semanticInbox',key:value.intakeId,value};
 for(const value of state.clarificationDrafts)yield {table:'semanticDrafts',key:value.intakeId,value};
 for(const value of state.commandReceipts)yield {table:'semanticReceipts',key:value.operationId,value};
}
export function memorySemanticReader(records:readonly SemanticCandidateRecord[]):SemanticWorldRecordReader{
 const values=new Map(records.map(row=>[JSON.stringify([row.table,row.key]),row.value]));
 return {get:(table,key)=>values.get(JSON.stringify([table,key])),entries:table=>records.filter(row=>row.table===table)};
}

export async function sqliteLibraryCandidate(records:Iterable<LibraryCandidateRecord>){
 const sqlite=await sqlite3InitModule(),database=new sqlite.oo1.DB(':memory:','c');
 database.exec('CREATE TABLE candidate(table_name TEXT NOT NULL,record_key TEXT NOT NULL,value_json TEXT NOT NULL,PRIMARY KEY(table_name,record_key)) WITHOUT ROWID');
 let encodedBytes=0,recordCount=0;
 database.exec('BEGIN');
 try{for(const row of records){const text=JSON.stringify(encodeBackupValue(row.value));encodedBytes+=new TextEncoder().encode(text).length;recordCount++;database.exec({sql:'INSERT INTO candidate VALUES(?,?,?)',bind:[row.table,row.key,text]});}database.exec('COMMIT');}
 catch(cause){database.exec('ROLLBACK');database.close();throw cause;}
 const metrics={largestPage:0,pointReads:0,existenceReads:0,iteratedRecords:0};
 const reader:LibraryRecordReader={
  get(table,key){metrics.pointReads++;const rows=database.exec({sql:'SELECT value_json FROM candidate WHERE table_name=? AND record_key=?',bind:[table,key],rowMode:0,returnValue:'resultRows'}) as string[];return rows.length?decodeBackupValue(JSON.parse(rows[0]!)):undefined;},
  has(table,key){metrics.existenceReads++;return (database.exec({sql:'SELECT 1 FROM candidate WHERE table_name=? AND record_key=?',bind:[table,key],rowMode:0,returnValue:'resultRows'}) as number[]).length!==0;},
  *entries(table){
   let after:string|null=null;
   while(true){
    const page=database.exec({sql:`SELECT record_key,value_json FROM candidate WHERE table_name=? ${after===null?'':'AND record_key>?'} ORDER BY record_key LIMIT 64`,bind:after===null?[table]:[table,after],rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[];
    metrics.largestPage=Math.max(metrics.largestPage,page.length);
    if(!page.length)return;
    for(const row of page){metrics.iteratedRecords++;yield {key:row.record_key,value:decodeBackupValue(JSON.parse(row.value_json))};}
    after=page.at(-1)!.record_key;
   }
  },
 };
 return {reader,metrics,encodedBytes,recordCount,close:()=>database.close()};
}
