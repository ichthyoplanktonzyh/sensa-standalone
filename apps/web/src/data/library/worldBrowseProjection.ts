import {learningScenePersonalMeaningId} from './personalSceneIdentity';
import {hydrateMeaningContexts,meaningContextKeys} from '../../experience/personalMeaningJourney/contextRecords';
/** Worker-owned, rebuildable PRIVATE World index; source facts remain authoritative. */
import type {Database,PreparedStatement,SqlValue} from '@sqlite.org/sqlite-wasm';
import {decodeBackupValue} from './backupCodec';
import {ensureSqliteSchemaIndexes} from './sqliteSchemaIndexes';
import type {SqliteMutation} from './sqliteProtocol';
import type {LibraryRecordReader} from './libraryRecordReader';
import {isWorldRecordVisible,summarizeWorldItem,validateWorldQuery,worldItemFromRegistry,worldRegistryClosure,worldSearchText,WorldSourceInvalidError,validateWorldLearningChoiceQuery,worldLearningChoice,worldReferenceSenseIds,projectWorldGraphItem,type WorldGraphQuery,type WorldGraphRead,type WorldGraphItem,type WorldLearningChoiceQuery,type WorldLearningChoicePage,type WorldLearningChoice,type WorldBrowseItem,type WorldBrowsePage,type WorldBrowseQuery,type WorldRecordRead} from '../../experience/personalMeaningJourney/worldRead';
import type {MeaningJourneyRecord} from '../../experience/personalMeaningJourney/store';
import {buildPersonalMeaningLearningSources} from '../../experience/personalMeaningJourney/learningSource';
import {indexRegistry} from '../../experience/personalMeaningJourney/registryRead';
import {confirmedLookupConnections} from '../../experience/personalMeaningJourney/meaningLookupFacts';
import {isUuid} from '../../experience/personalMeaningJourney/ids';
import {meaningHistoryRecords} from '../../experience/personalMeaningJourney/meaningHistoryRead';
import {contextBrowseFacts,validateContextQuery,type ContextBrowseQuery,type ContextBrowsePage} from '../../experience/personalMeaningJourney/contextRead';
import type {ContextRecord} from '../../experience/personalMeaningJourney/contextRecords';

const schema=`
CREATE TABLE IF NOT EXISTS sensa_world_browse(
 id INTEGER PRIMARY KEY,meaning_id TEXT NOT NULL UNIQUE,updated_at TEXT NOT NULL,
 formation TEXT NOT NULL,binding TEXT NOT NULL,valid INTEGER NOT NULL,visible INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','deleted')),
 summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),graph_json TEXT NOT NULL CHECK(graph_json='' OR json_valid(graph_json)),search_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sensa_world_browse_order ON sensa_world_browse(visible,updated_at DESC,meaning_id);
CREATE INDEX IF NOT EXISTS sensa_world_browse_status ON sensa_world_browse(status,updated_at DESC,meaning_id);
CREATE INDEX IF NOT EXISTS sensa_world_browse_valid ON sensa_world_browse(valid);
CREATE INDEX IF NOT EXISTS sensa_world_browse_pending ON sensa_world_browse(updated_at DESC,meaning_id) WHERE visible=1 AND (formation<>'sense_confirmed' OR binding<>'bound');
CREATE TABLE IF NOT EXISTS sensa_world_expression_members(meaning_id TEXT NOT NULL,expression_id TEXT NOT NULL,language_tag TEXT NOT NULL,visible INTEGER NOT NULL,PRIMARY KEY(meaning_id,expression_id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_world_expression_language ON sensa_world_expression_members(language_tag,meaning_id,expression_id);
CREATE INDEX IF NOT EXISTS sensa_world_expression_visible_language ON sensa_world_expression_members(visible,language_tag);
CREATE TABLE IF NOT EXISTS sensa_world_learning_choices(choice_key TEXT PRIMARY KEY,meaning_id TEXT NOT NULL,language_tag TEXT NOT NULL,updated_at TEXT NOT NULL,choice_json TEXT NOT NULL CHECK(json_valid(choice_json))) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_world_learning_choice_language ON sensa_world_learning_choices(language_tag,updated_at DESC,meaning_id,choice_key);
CREATE INDEX IF NOT EXISTS sensa_world_learning_choice_meaning ON sensa_world_learning_choices(meaning_id);
CREATE TABLE IF NOT EXISTS sensa_world_scene_meanings(scene_id TEXT NOT NULL,meaning_id TEXT NOT NULL,PRIMARY KEY(scene_id,meaning_id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_world_scene_meaning_owner ON sensa_world_scene_meanings(meaning_id);
CREATE TABLE IF NOT EXISTS sensa_world_browse_dependencies(meaning_id TEXT NOT NULL,registry_key TEXT NOT NULL,PRIMARY KEY(meaning_id,registry_key)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_world_browse_dependency_key ON sensa_world_browse_dependencies(registry_key,meaning_id);
CREATE VIRTUAL TABLE IF NOT EXISTS sensa_world_browse_search USING fts5(text,tokenize='trigram');
CREATE TABLE IF NOT EXISTS sensa_world_browse_meta(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sensa_context_browse(id INTEGER PRIMARY KEY,context_id TEXT NOT NULL UNIQUE,revision_id TEXT NOT NULL,updated_at TEXT NOT NULL,summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),search_text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sensa_context_browse_order ON sensa_context_browse(updated_at DESC,context_id);
CREATE TABLE IF NOT EXISTS sensa_context_meanings(context_id TEXT NOT NULL,meaning_id TEXT NOT NULL,PRIMARY KEY(context_id,meaning_id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_context_meaning_owner ON sensa_context_meanings(meaning_id);
CREATE VIRTUAL TABLE IF NOT EXISTS sensa_context_search USING fts5(text,tokenize='trigram');
`;
const version=22,tables=[...['search','dependencies','meta',''].map(name=>`sensa_world_browse${name?'_'+name:''}`),'sensa_world_learning_choices','sensa_world_expression_members','sensa_world_scene_meanings','sensa_context_browse','sensa_context_meanings','sensa_context_search'];
type Row=Record<string,any>;
export class SqliteWorldBrowseProjection{
 private statements=new Map<string,PreparedStatement>();
 private read:WorldRecordRead;
 private languageMenu:string[]|null=null;
 private languages():string[]{return [...(this.languageMenu??=this.rows("SELECT DISTINCT language_tag AS tag FROM sensa_world_expression_members WHERE visible=1 ORDER BY language_tag").map(row=>row.tag))];}
 constructor(private database:Database,private get:(table:'semanticRegistry'|'semanticMeanings'|'semanticContexts',key:string)=>string|null,private decodedReader?:()=>LibraryRecordReader|undefined){
  this.read=(table,key)=>{const reader=this.decodedReader?.();if(reader)return reader.get(table,key);const encoded=this.get(table,key);return encoded===null?undefined:decodeBackupValue(JSON.parse(encoded));};
 }
 private statement(sql:string,bind:unknown[]):PreparedStatement{
  let statement=this.statements.get(sql);if(!statement){statement=this.database.prepare(sql);this.statements.set(sql,statement);}
  statement.reset(true);if(bind.length)statement.bind(bind as SqlValue[]);return statement;
 }
 private rows(sql:string,bind:unknown[]=[]):Row[]{const statement=this.statement(sql,bind),rows:Row[]=[];try{while(statement.step())rows.push(statement.get({}));return rows;}finally{statement.reset(true);}}
 private write(sql:string,bind:unknown[]=[]):void{const statement=this.statement(sql,bind);try{while(statement.step()){}}finally{statement.reset(true);}}
 close(){for(const statement of this.statements.values())statement.finalize();this.statements.clear();}
 initialize(){
  const complete=this.rows("SELECT name FROM sqlite_schema WHERE type='table' AND name IN (SELECT value FROM json_each(?))",[JSON.stringify(tables)]).length===tables.length;
  const current=complete&&this.rows('SELECT version FROM sensa_world_browse_meta WHERE id=1')[0]?.version===version;
  if(current){ensureSqliteSchemaIndexes(this.database,schema);return;}
  if(!current){for(const table of tables)this.write(`DROP TABLE IF EXISTS ${table}`);this.write('DROP TABLE IF EXISTS sensa_world_browse_grams');}
  this.database.exec(schema);if(!current)this.rebuild();
 }
 private replace(ids:readonly string[]){
  for(const id of ids){
   const old=this.rows('SELECT id FROM sensa_world_browse WHERE meaning_id=?',[id])[0];
   const oldMembers=this.rows('SELECT expression_id,language_tag,visible FROM sensa_world_expression_members WHERE meaning_id=? ORDER BY expression_id',[id]);
   this.write('DELETE FROM sensa_world_expression_members WHERE meaning_id=?',[id]);
   if(old)this.write('DELETE FROM sensa_world_browse_search WHERE rowid=?',[old.id]);
   this.write('DELETE FROM sensa_world_browse WHERE meaning_id=?',[id]);this.write('DELETE FROM sensa_world_browse_dependencies WHERE meaning_id=?',[id]);
   this.write('DELETE FROM sensa_world_learning_choices WHERE meaning_id=?',[id]);
   this.write('DELETE FROM sensa_world_scene_meanings WHERE meaning_id=?',[id]);
   this.write('DELETE FROM sensa_context_meanings WHERE meaning_id=?',[id]);
   const raw=this.read('semanticMeanings',id);if(!raw){if(oldMembers.length)this.languageMenu=null;continue;}
   const record=hydrateMeaningContexts(raw,key=>this.read('semanticContexts',key));
   if(record.personalMeaning.status==='active')for(const anchor of record.personalSemanticAnchors)if(anchor.status==='active')this.write('INSERT INTO sensa_context_meanings VALUES(?,?)',[anchor.personalSemanticAnchorId,id]);
   const dependencies=new Set<string>(meaningContextKeys(raw as MeaningJourneyRecord).map(key=>`context:${key}`));
   let derived:{summary:WorldBrowseItem;text:string;visible:boolean;choices:WorldLearningChoice[];graph:WorldGraphItem|null}|undefined;
   try{
    if(record.personalMeaning?.personalMeaningId!==id)throw new WorldSourceInvalidError('world_record_identity_invalid');
    const registry=worldRegistryClosure(record,this.read,key=>dependencies.add(key)),item=worldItemFromRegistry(record,registry);
    derived={summary:summarizeWorldItem(item),text:worldSearchText(item),visible:isWorldRecordVisible(record,registry),choices:buildPersonalMeaningLearningSources(record,indexRegistry(registry)).map(worldLearningChoice),graph:confirmedLookupConnections(record,indexRegistry(registry)).length?projectWorldGraphItem(item):null};
   }catch(cause){
    // Invalid domain sources are a read failure. Do NOT catch SQLite failures:
    // a failed derived write must roll back its authoritative transaction.
    if(!(cause instanceof WorldSourceInvalidError))throw cause;
   }
   if(derived){
    const sceneIds=new Set(meaningHistoryRecords(record).flatMap(branch=>branch.personalSemanticAnchorRevisions).map(revision=>(revision.structuredPayload.learningScene as {sceneId?:unknown}|undefined)?.sceneId).filter(isUuid));
    for(const sceneId of sceneIds)this.write('INSERT INTO sensa_world_scene_meanings VALUES(?,?)',[sceneId,id]);
    const {summary,text,visible,choices,graph}=derived;
    const members=(summary.expressions??[]).map(expression=>({expression_id:expression.expressionId,language_tag:expression.languageTag,visible:visible?1:0})).sort((a,b)=>a.expression_id.localeCompare(b.expression_id));
    if(JSON.stringify(members)!==JSON.stringify(oldMembers))this.languageMenu=null;
    for(const member of members)this.write('INSERT INTO sensa_world_expression_members VALUES(?,?,?,?)',[id,member.expression_id,member.language_tag,member.visible]);
    const row=this.rows('INSERT INTO sensa_world_browse(meaning_id,updated_at,formation,binding,valid,visible,status,summary_json,graph_json,search_text) VALUES(?,?,?,?,1,?,?,?,?,?) RETURNING id',
     [id,summary.updatedAt,summary.senseFormation.phase,summary.expressionBinding.phase,visible?1:0,summary.status,JSON.stringify(summary),graph?JSON.stringify(graph):'',text])[0]!;
    this.write('INSERT INTO sensa_world_browse_search(rowid,text) VALUES(?,?)',[row.id,text]);
    if(visible)for(const choice of choices)this.write('INSERT INTO sensa_world_learning_choices VALUES(?,?,?,?,?)',[choice.key,id,choice.targetLanguageTag,summary.updatedAt,JSON.stringify(choice)]);
   }else{
    if(oldMembers.length)this.languageMenu=null;
    // Record corruption is a visible read failure, never a fabricated empty
    // World. Missing references are tracked so an actual repair can recover.
    this.write("INSERT INTO sensa_world_browse(meaning_id,updated_at,formation,binding,valid,visible,status,summary_json,graph_json,search_text) VALUES(?,'','','',0,0,'active','{}','','')",[id]);
   }
   for(const key of dependencies)this.write('INSERT INTO sensa_world_browse_dependencies VALUES(?,?)',[id,key]);
  }
 }
 rebuild(){for(const _ of this.rebuildPages())void _;}
 /** Yields bounded rebuild steps for an unselected private generation. */
 *rebuildPages(selectKeys?:(table:string,keys:string[])=>string[]):Generator<number>{
  this.languageMenu=null;
  for(const table of tables.filter(table=>!table.endsWith('_meta')))this.write(`DELETE FROM ${table}`);
  yield 0;let after='';for(;;){const keys=this.rows("SELECT record_key FROM sensa_records WHERE table_name='semanticMeanings' AND record_key>? ORDER BY record_key LIMIT 64",[after]).map(row=>row.record_key),ids=selectKeys?selectKeys('semanticMeanings',keys):keys;if(!ids.length)break;this.replace(ids);after=ids.at(-1)!;yield ids.length;}
  after='anchors';for(;;){const all=this.rows("SELECT record_key FROM sensa_records WHERE table_name='semanticContexts' AND record_key>= 'anchors:' AND record_key>? AND record_key<'anchors;' ORDER BY record_key LIMIT 64",[after]).map(row=>row.record_key),keys=selectKeys?selectKeys('semanticContexts',all):all;if(!keys.length)break;this.replaceContexts(keys.map(key=>key.slice('anchors:'.length)));after=keys.at(-1)!;yield keys.length;}
  this.write('INSERT INTO sensa_world_browse_meta VALUES(1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version',[version]);
 }
 update(mutation:SqliteMutation){
  if(mutation.clears.some(table=>table==='semanticMeanings'||table==='semanticRegistry'||table==='semanticContexts')){this.rebuild();return;}
  const affected=new Set([...mutation.puts,...mutation.deletes].filter(row=>row.table==='semanticMeanings').map(row=>row.key));
  const keys=[...mutation.puts,...mutation.deletes].filter(row=>row.table==='semanticRegistry'||row.table==='semanticContexts').map(row=>row.table==='semanticContexts'?`context:${row.key}`:row.key);
  if(keys.length)for(const row of this.rows('SELECT DISTINCT meaning_id FROM sensa_world_browse_dependencies WHERE registry_key IN (SELECT value FROM json_each(?))',[JSON.stringify(keys)]))affected.add(row.meaning_id);
  this.replace([...affected]);
  const contexts=new Set<string>();for(const row of [...mutation.puts,...mutation.deletes])if(row.table==='semanticContexts'){if(row.key.startsWith('anchors:'))contexts.add(row.key.slice('anchors:'.length));else {const fact=this.read('semanticContexts',row.key) as ContextRecord|undefined;if(fact?.kind==='anchorRevisions')contexts.add(fact.value.personalSemanticAnchorId);}}
  this.replaceContexts([...contexts]);
 }
 private replaceContexts(ids:readonly string[]){
  for(const id of ids){const old=this.rows('SELECT id FROM sensa_context_browse WHERE context_id=?',[id])[0];if(old)this.write('DELETE FROM sensa_context_search WHERE rowid=?',[old.id]);this.write('DELETE FROM sensa_context_browse WHERE context_id=?',[id]);
   const head=this.read('semanticContexts',`anchors:${id}`) as ContextRecord|undefined;if(!head)continue;if(head.kind!=='anchors')throw Error('semantic_context_invalid');
   const revision=this.read('semanticContexts',`anchorRevisions:${head.value.currentRevisionId}`) as ContextRecord|undefined;if(revision?.kind!=='anchorRevisions')throw Error('semantic_context_invalid');
   const {item,text}=contextBrowseFacts(head.value,revision.value);const inserted=this.rows('INSERT INTO sensa_context_browse(context_id,revision_id,updated_at,summary_json,search_text) VALUES(?,?,?,?,?) RETURNING id',[id,item.revisionId,item.updatedAt,JSON.stringify(item),text])[0]!;this.write('INSERT INTO sensa_context_search(rowid,text) VALUES(?,?)',[inserted.id,text]);
  }
 }
 contexts(raw:ContextBrowseQuery):ContextBrowsePage{
  const query=validateContextQuery(raw),bind:unknown[]=[],clauses:string[]=[];let join='';if(query.query){if(Array.from(query.query).length>=3){join='JOIN sensa_context_search ON sensa_context_search.rowid=ctx.id';clauses.push('sensa_context_search MATCH ?');bind.push(`"${query.query.replaceAll('"','""')}"`);}clauses.push('instr(ctx.search_text,?)>0');bind.push(query.query);}
  if((query.status??'active')!=='all'){clauses.push("json_extract(ctx.summary_json,'$.status')=?");bind.push(query.status??'active');}if(query.contextId){clauses.push('ctx.context_id=?');bind.push(query.contextId);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'',total=this.rows(`SELECT count(*) AS total FROM sensa_context_browse ctx ${join} ${where}`,bind)[0]!.total;
  const items=this.rows(`SELECT ctx.summary_json,(SELECT count(*) FROM sensa_context_meanings WHERE context_id=ctx.context_id) AS meaning_count FROM sensa_context_browse ctx ${join} ${where} ORDER BY ctx.updated_at DESC,ctx.context_id LIMIT ? OFFSET ?`,[...bind,query.limit,query.offset]).map(row=>({...JSON.parse(row.summary_json),meaningCount:row.meaning_count}));return {items,total};
 }
 private selection(query:WorldBrowseQuery){
  if(this.rows('SELECT 1 FROM sensa_world_browse WHERE valid=0 LIMIT 1').length)throw new Error('world_source_invalid');
  const clauses=[query.filter==='deleted'?"world.status='deleted'":'world.visible=1'],bind:unknown[]=[],characters=Array.from(query.query);
  if(query.filter==='continue')clauses.push("world.formation<>'sense_confirmed'");
  if(query.filter==='pending')clauses.push("(world.formation<>'sense_confirmed' OR world.binding<>'bound')");
  if(query.filter==='binding')clauses.push("world.binding IN ('pending','partial')");
  if(query.filter==='complete')clauses.push("world.binding='bound'");
  let join='';
  if(query.referenceFilter&&query.referenceFilter!=='all'){
   const prefix=query.referenceFilter==='saved'?'saved_sense:':'sense_note:';
   const reader=this.decodedReader?.();
   const annotations=this.rows("SELECT record_key,value_json FROM sensa_records WHERE table_name='annotations' AND record_key>=? AND record_key<?",[prefix,`${prefix}\uffff`]).map(row=>reader?reader.get('annotations',row.record_key):decodeBackupValue(JSON.parse(row.value_json)));
   clauses.push("EXISTS (SELECT 1 FROM json_each(world.summary_json,'$.senseIds') AS sense WHERE sense.value IN (SELECT value FROM json_each(?)))");bind.push(JSON.stringify(worldReferenceSenseIds(annotations,query.referenceFilter)));
  }
  if(query.expressionLanguages?.length){
   clauses.push("world.meaning_id IN (SELECT meaning_id FROM sensa_world_expression_members WHERE language_tag IN (SELECT value FROM json_each(?)))");
   bind.push(JSON.stringify(query.expressionLanguages));
  }
  if(query.senseIds!==undefined){
   clauses.push('world.meaning_id IN (SELECT meaning_id FROM sensa_world_browse_dependencies WHERE registry_key IN (SELECT value FROM json_each(?)))');
   bind.push(JSON.stringify(query.senseIds.map(id=>`senses:${id}`)));
  }
  if(query.query){
   if(characters.length>=3){join='JOIN sensa_world_browse_search AS search ON search.rowid=world.id';clauses.push('sensa_world_browse_search MATCH ?','instr(world.search_text,?)>0');bind.push(`"${query.query.replaceAll('"','""')}"`,query.query);}
   else{clauses.push('instr(world.search_text,?)>0');bind.push(query.query);}
  }
  return {join,clauses,bind};
 }
 sceneMeaning(sceneId:string):string|null{
  if(!isUuid(sceneId))throw new Error('scene_identity_invalid');
  if(this.rows('SELECT 1 FROM sensa_world_browse WHERE valid=0 LIMIT 1').length)throw new Error('world_source_invalid');
  // Include recycled owners: a missing local link must not manufacture a new
  // identity for a scene whose original Meaning has been explicitly deleted.
  const owners=this.rows('SELECT meaning_id FROM sensa_world_scene_meanings WHERE scene_id=? AND meaning_id=? LIMIT 2',[sceneId,learningScenePersonalMeaningId(sceneId)]);
  if(owners.length>1)throw new Error('scene_owner_ambiguous');
  return owners[0]?.meaning_id??null;
 }
 learningChoices(raw:WorldLearningChoiceQuery):WorldLearningChoicePage{
  const query=validateWorldLearningChoiceQuery(raw),{join,clauses,bind}=this.selection(query);
  const decode=(row:Row):WorldLearningChoice=>JSON.parse(row.choice_json);
  if(query.query===''&&query.filter==='all'&&query.senseIds===undefined&&!query.expressionLanguages?.length&&(!query.referenceFilter||query.referenceFilter==='all')){
   // Choices are maintained only for visible, verified Meaning sources. The
   // covering index counts/orders compact keys without loading skipped JSON.
   const total=Number(this.rows('SELECT COUNT(*) AS count FROM sensa_world_learning_choices WHERE language_tag=?',[query.targetLanguageTag])[0]!.count);
   const items=this.rows(`WITH page AS MATERIALIZED (
    SELECT choice_key,updated_at,meaning_id FROM sensa_world_learning_choices INDEXED BY sensa_world_learning_choice_language
    WHERE language_tag=? ORDER BY updated_at DESC,meaning_id,choice_key LIMIT ? OFFSET ?
   ) SELECT choice.choice_json FROM page JOIN sensa_world_learning_choices AS choice ON choice.choice_key=page.choice_key
   ORDER BY page.updated_at DESC,page.meaning_id,page.choice_key`,[query.targetLanguageTag,query.limit,query.offset]).map(decode);
   return {items,total};
  }
  clauses.push('choice.language_tag=?');bind.push(query.targetLanguageTag);
  if(query.expressionLanguages?.length){clauses.push('choice.language_tag IN (SELECT value FROM json_each(?))');bind.push(JSON.stringify(query.expressionLanguages));}
  const from=`FROM sensa_world_browse AS world ${join} JOIN sensa_world_learning_choices AS choice ON choice.meaning_id=world.meaning_id WHERE ${clauses.join(' AND ')}`;
  const total=Number(this.rows(`SELECT COUNT(*) AS count ${from}`,bind)[0]!.count);
  const items=this.rows(`SELECT choice.choice_json ${from} ORDER BY world.updated_at DESC,world.meaning_id,choice.choice_key LIMIT ? OFFSET ?`,[...bind,query.limit,query.offset]).map(decode);
  return {items,total};
 }
 graph(raw:WorldGraphQuery):WorldGraphRead{
  const query=validateWorldQuery({...raw,offset:0,limit:256}),{join,clauses,bind}=this.selection(query);
  clauses.push("world.graph_json<>''");
  const items:WorldGraphItem[]=this.rows(`SELECT world.graph_json FROM sensa_world_browse AS world ${join} WHERE ${clauses.join(' AND ')} ORDER BY world.updated_at DESC,world.meaning_id`,bind).map(row=>JSON.parse(row.graph_json));
  const expressionLanguages=this.languages();
  const expressionIds=new Set(items.flatMap(item=>[...item.detail.focuses.flatMap(focus=>focus.alignment?[focus.alignment]:[]),...item.detail.directAlignments].flatMap(alignment=>alignment.confirmedBindings.filter(binding=>!query.expressionLanguages?.length||query.expressionLanguages.includes(binding.languageTag)).map(binding=>binding.expressionId))));
  return {items,expressionLanguages,expressionCount:expressionIds.size};
 }
 query(raw:WorldBrowseQuery):WorldBrowsePage{
  const query=validateWorldQuery(raw),{join,clauses,bind}=this.selection(query);
  const from=`FROM sensa_world_browse AS world ${query.filter==='pending'?'INDEXED BY sensa_world_browse_pending':''} ${join} WHERE ${clauses.join(' AND ')}`;
  const total=Number(this.rows(`SELECT COUNT(*) AS count ${from}`,bind)[0]!.count);
  const items=this.rows(`SELECT world.summary_json ${from} ORDER BY world.updated_at DESC,world.meaning_id LIMIT ? OFFSET ?`,[...bind,query.limit,query.offset]).map(row=>JSON.parse(row.summary_json));
  const next=this.rows("SELECT summary_json FROM sensa_world_browse INDEXED BY sensa_world_browse_pending WHERE visible=1 AND (formation<>'sense_confirmed' OR binding<>'bound') ORDER BY updated_at DESC,meaning_id LIMIT 1")[0];
  const pending=Number(this.rows("SELECT COUNT(*) AS count FROM sensa_world_browse INDEXED BY sensa_world_browse_pending WHERE visible=1 AND (formation<>'sense_confirmed' OR binding<>'bound')")[0]!.count);
  const expressionLanguages=this.languages();
  const languageClause=query.expressionLanguages?.length?" AND expression.language_tag IN (SELECT value FROM json_each(?))":'';
  const expressionCount=Number(this.rows(`SELECT COUNT(DISTINCT expression.expression_id) AS count FROM sensa_world_browse AS world ${join} JOIN sensa_world_expression_members AS expression ON expression.meaning_id=world.meaning_id WHERE ${clauses.join(' AND ')}${languageClause}`,[...bind,...(languageClause?[JSON.stringify(query.expressionLanguages)]:[])])[0]!.count);
  return {items,total,pending,next:next?JSON.parse(next.summary_json):null,expressionLanguages,expressionCount};
 }
}
