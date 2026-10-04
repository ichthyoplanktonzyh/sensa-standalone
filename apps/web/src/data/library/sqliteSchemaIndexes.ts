/** Restore only fixed, rebuildable indexes from the module-owned schema. */
import type {Database} from '@sqlite.org/sqlite-wasm';
export function ensureSqliteSchemaIndexes(database:Database,schema:string):void{
 const definitions=[...schema.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)[\s\S]*?;/gu)];
 if(!definitions.length)return;
 const existing=database.exec({sql:"SELECT name FROM sqlite_schema WHERE type='index' AND name IN (SELECT value FROM json_each(?))",bind:[JSON.stringify(definitions.map(match=>match[1]))],rowMode:'object',returnValue:'resultRows'}) as Array<{name:string}>;
 const names=new Set(existing.map(row=>row.name));
 for(const definition of definitions)if(!names.has(definition[1]!))database.exec(definition[0]);
}
