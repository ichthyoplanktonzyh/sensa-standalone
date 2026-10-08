/** Worker-owned, rebuildable lookup data. No Context, Anchors, media or learner wording. */
import type {Database,PreparedStatement,SqlValue} from '@sqlite.org/sqlite-wasm';
import {decodeBackupValue} from './backupCodec';
import {ensureSqliteSchemaIndexes} from './sqliteSchemaIndexes';
import type {SqliteMutation} from './sqliteProtocol';
import {confirmedLookupConnections,normalizeMeaningQuery,validateMeaningQuery,meaningLookupFactFields,type MeaningLookupFacts,type LookupRegistryRead} from '../../experience/personalMeaningJourney/meaningLookupFacts';
import {MEANING_LOOKUP_MAX_BYTES,type MeaningLookupMatch,type MeaningLookupResult} from '../../experience/personalMeaningJourney/meaningLookup';

export const sqliteMeaningLookupSchema=`
CREATE TABLE IF NOT EXISTS sensa_meaning_lookup_versions(
 sense_version_id TEXT PRIMARY KEY,sense_id TEXT NOT NULL,sense_key TEXT NOT NULL,spec_json TEXT NOT NULL CHECK(json_valid(spec_json))
);
CREATE TABLE IF NOT EXISTS sensa_meaning_lookup_connections(
 meaning_id TEXT NOT NULL,sense_version_id TEXT NOT NULL,expression_version_id TEXT NOT NULL,
 expression TEXT NOT NULL,language_tag TEXT NOT NULL,normalized_expression TEXT NOT NULL,normalized_focus TEXT NOT NULL,
 PRIMARY KEY(meaning_id,sense_version_id,expression_version_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_meaning_lookup_connection_version ON sensa_meaning_lookup_connections(sense_version_id);
CREATE TABLE IF NOT EXISTS sensa_meaning_lookup_dependencies(meaning_id TEXT NOT NULL,registry_key TEXT NOT NULL,PRIMARY KEY(meaning_id,registry_key)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_meaning_lookup_dependency_key ON sensa_meaning_lookup_dependencies(registry_key,meaning_id);
CREATE TABLE IF NOT EXISTS sensa_meaning_lookup_documents(
 id INTEGER PRIMARY KEY,sense_version_id TEXT NOT NULL,text TEXT NOT NULL,reference_count INTEGER NOT NULL CHECK(reference_count>0),
 UNIQUE(sense_version_id,text)
);
CREATE TABLE IF NOT EXISTS sensa_meaning_lookup_expressions(
 sense_version_id TEXT NOT NULL,expression TEXT NOT NULL,language_tag TEXT NOT NULL,normalized_expression TEXT NOT NULL,
 reference_count INTEGER NOT NULL CHECK(reference_count>0),PRIMARY KEY(sense_version_id,language_tag,expression)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_meaning_lookup_grams(
 gram TEXT NOT NULL,document_id INTEGER NOT NULL,PRIMARY KEY(gram,document_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_meaning_lookup_gram_document ON sensa_meaning_lookup_grams(document_id,gram);
CREATE VIRTUAL TABLE IF NOT EXISTS sensa_meaning_lookup_search USING fts5(sense_version_id UNINDEXED,text,tokenize='trigram');
CREATE TABLE IF NOT EXISTS sensa_meaning_lookup_meta(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
`;
export const meaningLookupProjectionVersion=5;
const registryIds={senses:'senseId',senseVersions:'senseVersionId',expressions:'expressionId',expressionVersions:'expressionVersionId',bindings:'senseExpressionBindingId',bindingVersions:'bindingVersionId'} as const;
function lookupFacts(encoded:string):MeaningLookupFacts{
  const wire=JSON.parse(encoded);
  if(!Array.isArray(wire)||wire[0]!=='object'||!Array.isArray(wire[1]))return {personalMeaning:{status:'deleted'}} as MeaningLookupFacts;
  // Strip prose before decoding, including private revision labels/notes and
  // Anchor content. Only referential identity witnesses enter this projection.
  const pairs=wire[1].flatMap(([key,node]:[keyof MeaningLookupFacts,any])=>{
   const fields=Object.hasOwn(meaningLookupFactFields,key)?new Set(meaningLookupFactFields[key]):null;
   if(!fields)return [];
   const metadata=(value:any)=>Array.isArray(value)&&value[0]==='object'&&Array.isArray(value[1])
    ?['object',value[1].filter((pair:unknown[])=>fields.has(String(pair[0])))]:value;
   return [[key,Array.isArray(node)&&node[0]==='array'?['array',node[1].map(metadata)]:metadata(node)]];
  });
  return decodeBackupValue(['object',pairs]) as MeaningLookupFacts;
}
type Row=Record<string,any>;
export class SqliteMeaningLookupProjection{
 private statements=new Map<string,PreparedStatement>();
 constructor(private readonly database:Database,private readonly get:(table:'semanticRegistry'|'semanticMeanings',key:string)=>string|null){}
 private statement(sql:string,bind:unknown[]):PreparedStatement{
  let statement=this.statements.get(sql);if(!statement){statement=this.database.prepare(sql);this.statements.set(sql,statement);}
  statement.reset(true);if(bind.length)statement.bind(bind as SqlValue[]);return statement;
 }
 private rows(sql:string,bind:unknown[]=[]):Row[]{
  const statement=this.statement(sql,bind),rows:Row[]=[];
  try{while(statement.step())rows.push(statement.get({}));return rows;}finally{statement.reset(true);}
 }
 private write(sql:string,bind:unknown[]=[]):void{
  const statement=this.statement(sql,bind);try{while(statement.step()){/* Drain RETURNING if present. */}}finally{statement.reset(true);}
 }
 close():void{for(const statement of this.statements.values())statement.finalize();this.statements.clear();}
 /** Replace only disposable derived tables, never learner records. Caller owns the transaction. */
 initialize():void{
  const tables=['search','grams','documents','connections','dependencies','expressions','versions','meta'].map(name=>`sensa_meaning_lookup_${name}`);
  const existing=this.rows("SELECT name FROM sqlite_schema WHERE type='table' AND name IN (SELECT value FROM json_each(?))",[JSON.stringify(tables)]);
  const complete=existing.length===tables.length;
  const current=complete&&this.rows('SELECT version FROM sensa_meaning_lookup_meta WHERE id=1')[0]?.version===meaningLookupProjectionVersion;
  if(current){ensureSqliteSchemaIndexes(this.database,sqliteMeaningLookupSchema);return;}
  if(!current){
   // No compatibility layer for an old cache. Rebuild from unchanged authoritative facts.
   for(const table of tables)this.write(`DROP TABLE IF EXISTS ${table}`);
  }
  this.database.exec(sqliteMeaningLookupSchema);
  if(!current)this.rebuild();
 }
 private retainDocument(versionId:string,text:string):void{
  const existing=this.rows('SELECT id FROM sensa_meaning_lookup_documents WHERE sense_version_id=? AND text=?',[versionId,text])[0];
  if(existing){this.write('UPDATE sensa_meaning_lookup_documents SET reference_count=reference_count+1 WHERE id=?',[existing.id]);return;}
  const row=this.rows('INSERT INTO sensa_meaning_lookup_documents(sense_version_id,text,reference_count) VALUES(?,?,1) RETURNING id',[versionId,text])[0]!;
  this.write('INSERT INTO sensa_meaning_lookup_search(rowid,sense_version_id,text) VALUES(?,?,?)',[row.id,versionId,text]);
  // FTS5 trigram cannot index one/two-codepoint queries. Compact postings keep
  // Chinese short queries (and literal punctuation) off the full-text scan path.
  const characters=Array.from(text),grams=new Set(characters);
  for(let index=1;index<characters.length;index++)grams.add(characters[index-1]!+characters[index]!);
  this.write('INSERT INTO sensa_meaning_lookup_grams SELECT value,? FROM json_each(?)',[row.id,JSON.stringify([...grams])]);
 }
 private releaseDocument(versionId:string,text:string):void{
  const row=this.rows('SELECT id,reference_count FROM sensa_meaning_lookup_documents WHERE sense_version_id=? AND text=?',[versionId,text])[0];
  if(!row)throw new Error('meaning_lookup_document_missing');
  if(row.reference_count>1){this.write('UPDATE sensa_meaning_lookup_documents SET reference_count=reference_count-1 WHERE id=?',[row.id]);return;}
  this.write('DELETE FROM sensa_meaning_lookup_search WHERE rowid=?',[row.id]);
  this.write('DELETE FROM sensa_meaning_lookup_grams WHERE document_id=?',[row.id]);
  this.write('DELETE FROM sensa_meaning_lookup_documents WHERE id=?',[row.id]);
 }
 private replace(meanings:readonly string[]):void{
  const registry=new Map<string,unknown>(),affected=new Set<string>();
  for(const meaningId of meanings){
   for(const row of this.rows('SELECT sense_version_id,expression,language_tag,normalized_expression,normalized_focus FROM sensa_meaning_lookup_connections WHERE meaning_id=?',[meaningId])){
    affected.add(row.sense_version_id);
    for(const text of new Set([row.normalized_focus,row.normalized_expression]))this.releaseDocument(row.sense_version_id,text);
    const expression=this.rows('SELECT reference_count FROM sensa_meaning_lookup_expressions WHERE sense_version_id=? AND language_tag=? AND expression=?',[row.sense_version_id,row.language_tag,row.expression])[0];
    if(!expression)throw new Error('meaning_lookup_expression_missing');
    if(expression.reference_count>1)this.write('UPDATE sensa_meaning_lookup_expressions SET reference_count=reference_count-1 WHERE sense_version_id=? AND language_tag=? AND expression=?',[row.sense_version_id,row.language_tag,row.expression]);
    else this.write('DELETE FROM sensa_meaning_lookup_expressions WHERE sense_version_id=? AND language_tag=? AND expression=?',[row.sense_version_id,row.language_tag,row.expression]);
   }
   this.write('DELETE FROM sensa_meaning_lookup_connections WHERE meaning_id=?',[meaningId]);
   this.write('DELETE FROM sensa_meaning_lookup_dependencies WHERE meaning_id=?',[meaningId]);
   const encoded=this.get('semanticMeanings',meaningId);if(!encoded)continue;
   const facts=lookupFacts(encoded);if(facts.personalMeaning?.status!=='active'||facts.personalMeaning.personalMeaningId!==meaningId)continue;
   const dependencies=new Set<string>();
   const read:LookupRegistryRead=(kind,id)=>{
    const key=`${kind}:${id}`;dependencies.add(key);
    if(!registry.has(key)){
      const encoded=this.get('semanticRegistry',key),row=encoded?decodeBackupValue(JSON.parse(encoded)):undefined;
      registry.set(key,row?.kind===kind&&row.value?.[registryIds[kind]]===id?row.value:undefined);
    }
    return registry.get(key) as never;
   };
   // Keep witnesses to missing versions too, so repair/reinsertion rebuilds the edge.
   for(const alignment of facts.alignments){read('senses',alignment.senseId);read('senseVersions',alignment.senseVersionId);}
   for(const confirmation of facts.bindingConfirmations){
    const binding=read('bindingVersions',confirmation.bindingVersionId),expression=read('expressionVersions',confirmation.expressionVersionId);
    if(binding)read('bindings',binding.senseExpressionBindingId);if(expression)read('expressions',expression.expressionId);
   }
   for(const connection of confirmedLookupConnections(facts,read)){
    affected.add(connection.senseVersionId);
    this.write(`INSERT INTO sensa_meaning_lookup_versions VALUES(?,?,?,?) ON CONFLICT(sense_version_id) DO UPDATE SET
      sense_id=excluded.sense_id,sense_key=excluded.sense_key,spec_json=excluded.spec_json`,
     [connection.senseVersionId,connection.senseId,connection.senseKey,JSON.stringify(connection.semanticSpec)]);
    const expression=normalizeMeaningQuery(connection.expression),focus=normalizeMeaningQuery(connection.semanticSpec.coreMeaningFocus);
    this.write('INSERT INTO sensa_meaning_lookup_connections VALUES(?,?,?,?,?,?,?)',
     [meaningId,connection.senseVersionId,connection.expressionVersionId,connection.expression,connection.languageTag,expression,focus]);
    this.write(`INSERT INTO sensa_meaning_lookup_expressions VALUES(?,?,?,?,1) ON CONFLICT(sense_version_id,language_tag,expression)
      DO UPDATE SET reference_count=reference_count+1`,[connection.senseVersionId,connection.expression,connection.languageTag,expression]);
    for(const text of new Set([focus,expression]))this.retainDocument(connection.senseVersionId,text);
   }
   for(const key of dependencies)this.write('INSERT INTO sensa_meaning_lookup_dependencies VALUES(?,?)',[meaningId,key]);
  }
  for(const versionId of affected){
   this.write(`DELETE FROM sensa_meaning_lookup_versions WHERE sense_version_id=? AND NOT EXISTS
     (SELECT 1 FROM sensa_meaning_lookup_connections WHERE sense_version_id=? LIMIT 1)`,[versionId,versionId]);
  }
 }
 /** Caller holds the SQLite transaction; derived and authoritative rows commit together. */
 update(mutation:SqliteMutation):void{
  if(mutation.clears.some(table=>table==='semanticMeanings'||table==='semanticRegistry')){this.rebuild();return;}
  const affected=new Set([...mutation.puts,...mutation.deletes].filter(row=>row.table==='semanticMeanings').map(row=>row.key));
  const registryKeys=[...mutation.puts,...mutation.deletes].filter(row=>row.table==='semanticRegistry').map(row=>row.key);
  if(registryKeys.length)for(const row of this.rows(`SELECT DISTINCT meaning_id FROM sensa_meaning_lookup_dependencies
    WHERE registry_key IN (SELECT value FROM json_each(?))`,[JSON.stringify(registryKeys)]))affected.add(row.meaning_id);
  if(affected.size)this.replace([...affected]);
 }
 rebuild():void{
  for(const table of ['connections','dependencies','versions','search','documents','expressions','grams'])this.write(`DELETE FROM sensa_meaning_lookup_${table}`);
  const ids=this.rows("SELECT record_key FROM sensa_records WHERE table_name='semanticMeanings' ORDER BY record_key").map(row=>row.record_key);
  this.replace(ids);
  this.write('INSERT INTO sensa_meaning_lookup_meta VALUES(1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version',[meaningLookupProjectionVersion]);
 }
 query(raw:string):MeaningLookupResult{
  const query=validateMeaningQuery(raw),long=Array.from(query).length>=3;
  const quoted=`"${query.replaceAll('"','""')}"`;
  const candidates=long
    ?this.rows(`SELECT DISTINCT sense_version_id FROM sensa_meaning_lookup_search WHERE sensa_meaning_lookup_search MATCH ? AND instr(text,?)>0 LIMIT 33`,[quoted,query])
    :this.rows(`SELECT DISTINCT document.sense_version_id FROM sensa_meaning_lookup_grams AS gram
      JOIN sensa_meaning_lookup_documents AS document ON document.id=gram.document_id WHERE gram.gram=? LIMIT 33`,[query]);
  const result:MeaningLookupResult={meanings:[],truncated:candidates.length>32};
  for(const candidate of candidates.slice(0,32)){
   if(result.meanings.length===5){result.truncated=true;break;}
   const id=String(candidate.sense_version_id),row=this.rows('SELECT sense_id,sense_key,spec_json FROM sensa_meaning_lookup_versions WHERE sense_version_id=?',[id])[0];
   if(!row)continue;
   const expressions=this.rows(`SELECT expression,language_tag,normalized_expression FROM sensa_meaning_lookup_expressions
     WHERE sense_version_id=? ORDER BY instr(normalized_expression,?)>0 DESC,language_tag,expression LIMIT 6`,[id,query]);
   const match:MeaningLookupMatch={senseId:row.sense_id,senseVersionId:id,senseKey:row.sense_key,semanticSpec:JSON.parse(row.spec_json),
    expressions:expressions.slice(0,5).map(item=>({expression:item.expression,languageTag:item.language_tag})),expressionsTruncated:expressions.length>5};
   if(new TextEncoder().encode(JSON.stringify({ok:true,meanings:[...result.meanings,match],truncated:true})).byteLength>MEANING_LOOKUP_MAX_BYTES){result.truncated=true;continue;}
   result.meanings.push(match);
  }
  return result;
 }
}
