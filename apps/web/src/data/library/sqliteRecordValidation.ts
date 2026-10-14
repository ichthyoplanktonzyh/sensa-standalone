import type {Database,PreparedStatement} from '@sqlite.org/sqlite-wasm';

export class RecordValidationStorageError extends Error{constructor(cause:unknown){super(cause instanceof Error?cause.message:'sqlite_record_validation_failed',{cause});}}

/** Private, disk-backed uniqueness witnesses for one sealed cloud candidate. */
export const sqliteRecordValidationSchema=`
CREATE TABLE IF NOT EXISTS sensa_record_validation_keys(scope TEXT NOT NULL,kind TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,kind,value)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_record_validation_scenes(scope TEXT NOT NULL,scene_id TEXT NOT NULL,meaning_id TEXT NOT NULL,PRIMARY KEY(scope,scene_id)) WITHOUT ROWID;
`;
export interface RecordValidationIndex{
 unique(kind:'registry-slot'|'sense-key',value:string):boolean;
 sceneOwner(sceneId:string,meaningId:string):boolean;
}
export class SqliteRecordValidation implements RecordValidationIndex{
 private scope=crypto.randomUUID();
 private statements=new Map<string,PreparedStatement>();
 private keys=new Map<string,{kind:string;value:string}>();
 private scenes=new Map<string,string>();
 private pendingBytes=0;
 private reserve(...values:string[]){const bytes=values.reduce((total,value)=>total+new TextEncoder().encode(value).length,0);if(this.pendingBytes&&this.pendingBytes+bytes>1024*1024)this.flush();this.pendingBytes+=bytes;}
 constructor(private database:Database,private alive:()=>void){database.exec(sqliteRecordValidationSchema);}
 private rows<T>(sql:string,bind:string[]):T[]{
  this.alive();let statement=this.statements.get(sql);if(!statement){statement=this.database.prepare(sql);this.statements.set(sql,statement);}
  statement.reset(true);statement.bind(bind);const rows:T[]=[];try{while(statement.step())rows.push(statement.get({}) as T);return rows;}finally{statement.reset(true);}
 }
 private flush(){
  if(!this.keys.size&&!this.scenes.size)return;this.alive();this.database.exec('BEGIN IMMEDIATE');
  try{for(const {kind,value}of this.keys.values())this.rows('INSERT INTO sensa_record_validation_keys VALUES(?,?,?)',[this.scope,kind,value]);for(const [scene,meaning]of this.scenes)this.rows('INSERT INTO sensa_record_validation_scenes VALUES(?,?,?)',[this.scope,scene,meaning]);this.database.exec('COMMIT');this.keys.clear();this.scenes.clear();this.pendingBytes=0;}
  catch(cause){this.database.exec('ROLLBACK');throw cause;}
 }
 unique(kind:'registry-slot'|'sense-key',value:string){try{return this.uniqueKey(kind,value);}catch(cause){throw new RecordValidationStorageError(cause);}}
 private uniqueKey(kind:'registry-slot'|'sense-key',value:string){const id=JSON.stringify([kind,value]);if(this.keys.has(id)||this.rows('SELECT 1 FROM sensa_record_validation_keys WHERE scope=? AND kind=? AND value=?',[this.scope,kind,value]).length)return false;this.reserve(id,kind,value);this.keys.set(id,{kind,value});if(this.keys.size+this.scenes.size>=64)this.flush();return true;}
 sceneOwner(sceneId:string,meaningId:string){try{return this.scene(sceneId,meaningId);}catch(cause){throw new RecordValidationStorageError(cause);}}
 private scene(sceneId:string,meaningId:string){
  const prior=this.scenes.get(sceneId)??this.rows<{meaning_id:string}>('SELECT meaning_id FROM sensa_record_validation_scenes WHERE scope=? AND scene_id=?',[this.scope,sceneId])[0]?.meaning_id;if(prior!==undefined)return prior===meaningId;this.reserve(sceneId,meaningId);this.scenes.set(sceneId,meaningId);if(this.keys.size+this.scenes.size>=64)this.flush();return true;
 }
 close(erase=true){
  this.keys.clear();this.scenes.clear();
  try{if(erase){this.database.exec({sql:'DELETE FROM sensa_record_validation_keys WHERE scope=?',bind:[this.scope]});this.database.exec({sql:'DELETE FROM sensa_record_validation_scenes WHERE scope=?',bind:[this.scope]});}}
  finally{for(const statement of this.statements.values())statement.finalize();this.statements.clear();}
 }
}
