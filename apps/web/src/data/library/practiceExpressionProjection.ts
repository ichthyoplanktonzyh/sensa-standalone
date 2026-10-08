/** Device-local Expression material index. No Meaning details, media or learning state. */
import type {Database,SqlValue} from '@sqlite.org/sqlite-wasm';
import {stableUuid} from '@sensa/learning-kernel';
import {sensaPersonalExpressionAnchorRevisionSnapshotSchema,sensaExpressionVersionSnapshotSchema,sensaExpressionSnapshotSchema} from '@sensa/contracts/sensa';
import type {MeaningJourneyRecord} from '../../experience/personalMeaningJourney/store';
import {isPackageCacheProjectionSource} from './packageCacheProjection';

export type PracticeMaterialSource='books'|'personal';
export interface PracticeExpression {id:string;text:string;languageTag:string;source:{kind:PracticeMaterialSource;id:string}}
export interface PracticeExpressionQuery {
 source:PracticeMaterialSource;languageTag:string;query:string;offset:number;limit:number;
 selectedIds?:readonly string[];excludedIds?:readonly string[];idsOnly?:boolean;
}
export interface PracticeExpressionPage {items:PracticeExpression[];ids:string[];total:number;revision:number}
export const practiceExpressionForm=(text:string,language:string)=>text.normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase(language);
export const practiceExpressionId=(text:string,language:string)=>stableUuid(`sensa-practice-expression:${JSON.stringify([language,practiceExpressionForm(text,language)])}`);
export function validatePracticeExpressionQuery(query:PracticeExpressionQuery):PracticeExpressionQuery{
 if(!['books','personal'].includes(query.source)||typeof query.languageTag!=='string'||!query.languageTag||query.languageTag.length>100||typeof query.query!=='string'||query.query.length>200
  ||!Number.isSafeInteger(query.offset)||query.offset<0||!Number.isSafeInteger(query.limit)||query.limit<0||query.limit>256
  ||query.idsOnly!==undefined&&typeof query.idsOnly!=='boolean'
  ||[query.selectedIds,query.excludedIds].some(ids=>ids!==undefined&&(!Array.isArray(ids)||ids.length>100_000||ids.some(id=>typeof id!=='string'||id.length>8000))))throw new Error('practice_material_query_invalid');
 return {...query,query:practiceExpressionForm(query.query,query.languageTag)};
}
class PracticeMaterialSourceError extends Error{}
/** Only read the current expression anchors, never traverse Sense or Context dependencies. */
export function practiceExpressionsFromPersonal(value:unknown,key:string,readExpression?:(key:string)=>unknown):PracticeExpression[]{
 const record=value as MeaningJourneyRecord|undefined;
 if(!record?.personalMeaning||record.personalMeaning.personalMeaningId!==key||!['active','deleted'].includes(record.personalMeaning.status)
  ||!Array.isArray(record.personalExpressionAnchors)||!Array.isArray(record.personalExpressionAnchorRevisions)||!Array.isArray(record.bindingConfirmations))throw new PracticeMaterialSourceError('practice_personal_source_invalid');
 if(record.personalMeaning.status==='deleted')return [];
 const result:PracticeExpression[]=[];
 for(const anchor of record.personalExpressionAnchors){
  if(anchor.status==='deleted')continue;
  if(anchor.status!=='active'||anchor.personalMeaningId!==key)throw new PracticeMaterialSourceError('practice_expression_anchor_invalid');
  const raw=record.personalExpressionAnchorRevisions.find(revision=>revision.personalExpressionAnchorId===anchor.personalExpressionAnchorId&&revision.revision===anchor.currentRevision);
  const parsed=sensaPersonalExpressionAnchorRevisionSnapshotSchema.safeParse(raw);
  if(!parsed.success)throw new PracticeMaterialSourceError('practice_expression_revision_invalid');
  const confirmations=record.bindingConfirmations.filter(fact=>fact.personalExpressionAnchorRevisionId===parsed.data.personalExpressionAnchorRevisionId);
  if(!confirmations.length){
   const {surfaceForm:text,languageTag}=parsed.data;result.push({id:practiceExpressionId(text,languageTag),text,languageTag,source:{kind:'personal',id:key}});
  }else for(const versionId of new Set(confirmations.map(fact=>fact.expressionVersionId))){
   const rawVersion=readExpression?.(`expressionVersions:${versionId}`) as {kind?:string;value?:unknown}|undefined;
   const version=sensaExpressionVersionSnapshotSchema.safeParse(rawVersion?.value);
   if(rawVersion?.kind!=='expressionVersions'||!version.success||version.data.expressionVersionId!==versionId)throw new PracticeMaterialSourceError('practice_expression_version_invalid');
   const rawExpression=readExpression?.(`expressions:${version.data.expressionId}`) as {kind?:string;value?:unknown}|undefined;
   const expression=sensaExpressionSnapshotSchema.safeParse(rawExpression?.value);
   if(rawExpression?.kind!=='expressions'||!expression.success||expression.data.expressionId!==version.data.expressionId)throw new PracticeMaterialSourceError('practice_expression_identity_invalid');
   const text=version.data.surfaceForm,languageTag=expression.data.languageTag;
   result.push({id:practiceExpressionId(text,languageTag),text,languageTag,source:{kind:'personal',id:key}});
  }
 }
 return result;
}
export function practiceExpressionsFromPackage(value:unknown,key:string):PracticeExpression[]{
 if(!isPackageCacheProjectionSource(value))return [];
 if(value.key!==key)throw new PracticeMaterialSourceError('practice_package_source_invalid');
 return value.content.entries.map(entry=>{
  const text=entry.expression,languageTag=value.content.targetLanguage;
  if(typeof text!=='string'||!text.trim()||typeof languageTag!=='string'||!languageTag)throw new PracticeMaterialSourceError('practice_package_expression_invalid');
  return {id:practiceExpressionId(text,languageTag),text,languageTag,source:{kind:'books',id:key}};
 });
}
const schema=`
CREATE TABLE IF NOT EXISTS sensa_practice_expressions(
 source TEXT NOT NULL,owner_key TEXT NOT NULL,expression_id TEXT NOT NULL,language_tag TEXT NOT NULL,form TEXT NOT NULL,expression TEXT NOT NULL,
 PRIMARY KEY(source,owner_key,expression_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_practice_expression_browse ON sensa_practice_expressions(source,language_tag,form,expression_id,expression,owner_key);
CREATE INDEX IF NOT EXISTS sensa_practice_expression_id ON sensa_practice_expressions(source,language_tag,expression_id,expression,owner_key);
CREATE TABLE IF NOT EXISTS sensa_practice_expression_owners(source TEXT NOT NULL,owner_key TEXT NOT NULL,valid INTEGER NOT NULL,PRIMARY KEY(source,owner_key)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_practice_expression_valid ON sensa_practice_expression_owners(source,valid);
CREATE TABLE IF NOT EXISTS sensa_practice_expression_dependencies(owner_key TEXT NOT NULL,registry_key TEXT NOT NULL,PRIMARY KEY(owner_key,registry_key)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_practice_expression_dependency ON sensa_practice_expression_dependencies(registry_key,owner_key);
CREATE TABLE IF NOT EXISTS sensa_practice_expression_meta(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,revision INTEGER NOT NULL);
`;
export class SqlitePracticeExpressionProjection {
 constructor(private database:Database,private read:(table:'semanticMeanings'|'packageCache'|'semanticRegistry',key:string)=>unknown){}
 private rows(sql:string,bind:unknown[]=[]):Record<string,any>[] {return this.database.exec({sql,bind:bind as SqlValue[],rowMode:'object',returnValue:'resultRows'}) as Record<string,any>[];}
 initialize(){
  const ready=this.rows("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('sensa_practice_expressions','sensa_practice_expression_owners','sensa_practice_expression_meta','sensa_practice_expression_dependencies')").length===4;
  if(ready&&this.rows('SELECT version FROM sensa_practice_expression_meta WHERE id=1')[0]?.version===3){this.database.exec(schema);return;}
  this.database.exec('DROP TABLE IF EXISTS sensa_practice_expressions;DROP TABLE IF EXISTS sensa_practice_expression_owners;DROP TABLE IF EXISTS sensa_practice_expression_meta;DROP TABLE IF EXISTS sensa_practice_expression_dependencies;');
  this.database.exec(schema);
  for(const [table,source] of [['semanticMeanings','personal'],['packageCache','books']] as const)
   for(const row of this.rows('SELECT record_key FROM sensa_records WHERE table_name=? ORDER BY record_key',[table]))this.replace(source,row.record_key);
  this.database.exec('INSERT INTO sensa_practice_expression_meta VALUES(1,3,0)');
 }
 private replace(source:PracticeMaterialSource,key:string){
  const value=this.read(source==='personal'?'semanticMeanings':'packageCache',key);
  const dependencies=new Set<string>();
  const expressionRead=(dependency:string)=>{dependencies.add(dependency);return this.read('semanticRegistry',dependency);};
  let items:PracticeExpression[]=[],valid:number|null=value===undefined?null:1;
  if(value!==undefined)try{items=source==='personal'?practiceExpressionsFromPersonal(value,key,expressionRead):practiceExpressionsFromPackage(value,key);}
  catch(cause){if(!(cause instanceof PracticeMaterialSourceError))throw cause;valid=0;}
  if(source==='personal'){
   this.database.exec({sql:'DELETE FROM sensa_practice_expression_dependencies WHERE owner_key=?',bind:[key]});
   for(const dependency of dependencies)this.database.exec({sql:'INSERT INTO sensa_practice_expression_dependencies VALUES(?,?)',bind:[key,dependency]});
  }
  const selected=[...new Map(items.map(item=>[item.id,item])).values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const oldValid=this.rows('SELECT valid FROM sensa_practice_expression_owners WHERE source=? AND owner_key=?',[source,key])[0]?.valid??null;
  const old=this.rows('SELECT expression_id,language_tag,expression FROM sensa_practice_expressions WHERE source=? AND owner_key=? ORDER BY expression_id',[source,key]);
  // Context, Sense or learning changes do not invalidate unchanged expression material.
  if(oldValid===valid&&old.length===selected.length&&old.every((row,index)=>row.expression_id===selected[index]!.id&&row.language_tag===selected[index]!.languageTag&&row.expression===selected[index]!.text))return false;
  this.database.exec({sql:'DELETE FROM sensa_practice_expressions WHERE source=? AND owner_key=?',bind:[source,key]});
  this.database.exec({sql:'DELETE FROM sensa_practice_expression_owners WHERE source=? AND owner_key=?',bind:[source,key]});
  if(valid!==null)this.database.exec({sql:'INSERT INTO sensa_practice_expression_owners VALUES(?,?,?)',bind:[source,key,valid]});
  for(const item of selected)this.database.exec({sql:'INSERT INTO sensa_practice_expressions VALUES(?,?,?,?,?,?)',bind:[source,key,item.id,item.languageTag,practiceExpressionForm(item.text,item.languageTag),item.text]});
  return true;
 }
 update(mutation:import('./sqliteProtocol').SqliteMutation){
  let changed=false;
  for(const [table,source] of [['semanticMeanings','personal'],['packageCache','books']] as const){
   if(mutation.clears.includes(table)){
    this.database.exec({sql:'DELETE FROM sensa_practice_expressions WHERE source=?',bind:[source]});this.database.exec({sql:'DELETE FROM sensa_practice_expression_owners WHERE source=?',bind:[source]});changed=true;
    if(source==='personal')this.database.exec('DELETE FROM sensa_practice_expression_dependencies');
   }
   const keys=new Set([...mutation.puts,...mutation.deletes].filter(row=>row.table===table).map(row=>row.key));
   for(const key of keys)changed=this.replace(source,key)||changed;
  }
  const registryKeys=[...mutation.puts,...mutation.deletes].filter(row=>row.table==='semanticRegistry').map(row=>row.key);
  const affected=mutation.clears.includes('semanticRegistry')?this.rows("SELECT owner_key FROM sensa_practice_expression_owners WHERE source='personal'")
   :registryKeys.length?this.rows('SELECT DISTINCT owner_key FROM sensa_practice_expression_dependencies WHERE registry_key IN (SELECT value FROM json_each(?))',[JSON.stringify(registryKeys)]):[];
  for(const row of affected)changed=this.replace('personal',row.owner_key)||changed;
  if(changed)this.database.exec('UPDATE sensa_practice_expression_meta SET revision=revision+1 WHERE id=1');
 }
 query(raw:PracticeExpressionQuery):PracticeExpressionPage {
  const query=validatePracticeExpressionQuery(raw);
  if(this.rows('SELECT 1 FROM sensa_practice_expression_owners WHERE source=? AND valid=0 LIMIT 1',[query.source]).length)throw new Error('practice_material_source_invalid');
  const clauses=['source=?','language_tag=?'],bind:unknown[]=[query.source,query.languageTag];
  if(query.query){clauses.push('form>=?','form<?');bind.push(query.query,query.query+'\uffff');}
  if(query.selectedIds!==undefined){clauses.push('expression_id IN (SELECT value FROM json_each(?))');bind.push(JSON.stringify(query.selectedIds));}
  if(query.excludedIds!==undefined){clauses.push('expression_id NOT IN (SELECT value FROM json_each(?))');bind.push(JSON.stringify(query.excludedIds));}
  const where=clauses.join(' AND '),total=Number(this.rows(`SELECT COUNT(DISTINCT expression_id) AS count FROM sensa_practice_expressions WHERE ${where}`,bind)[0]!.count);
  const rows=!query.limit?[]:query.idsOnly?this.rows(`SELECT DISTINCT expression_id FROM sensa_practice_expressions WHERE ${where} ORDER BY form,expression_id LIMIT ? OFFSET ?`,[...bind,query.limit,query.offset]):this.rows(`WITH picked AS MATERIALIZED (
   SELECT expression_id,MIN(owner_key) AS owner_key,MIN(form) AS form FROM sensa_practice_expressions WHERE ${where} GROUP BY expression_id ORDER BY form,expression_id LIMIT ? OFFSET ?
  ) SELECT picked.expression_id,picked.owner_key,item.expression FROM picked JOIN sensa_practice_expressions AS item
   ON item.source=? AND item.language_tag=? AND item.owner_key=picked.owner_key AND item.expression_id=picked.expression_id ORDER BY picked.form,picked.expression_id`,[...bind,query.limit,query.offset,query.source,query.languageTag]);
  return {total,revision:Number(this.rows('SELECT revision FROM sensa_practice_expression_meta WHERE id=1')[0]!.revision),ids:rows.map(row=>row.expression_id),items:query.idsOnly?[]:rows.map(row=>({id:row.expression_id,text:row.expression,languageTag:query.languageTag,source:{kind:query.source,id:row.owner_key}}))};
 }
}
