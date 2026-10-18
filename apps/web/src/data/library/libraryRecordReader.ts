import type {RecordValidationIndex} from './sqliteRecordValidation';
import {sqliteLibraryTables,type SqliteLibraryTable} from './sqliteProtocol';

export type LibraryRecordRow={key:string;value:any};
export type LibraryRecordRows=Record<SqliteLibraryTable,Iterable<LibraryRecordRow>>;
export type LibraryRecordLookups=Record<SqliteLibraryTable,{get(key:string):any|undefined;has(key:string):boolean;values():Iterable<any>}>;

/** One complete, immutable candidate. Entries must be repeatable and expose
 * every unique stored key; get resolves that exact key in the same snapshot.
 * Readers may decode a row on demand and need not retain decoded bodies. */
export interface LibraryRecordReader{
 /** Set only by readers whose keyset queries are backed by a verified primary key. */
 storageKeysUnique?:true;
 validationIndex?:RecordValidationIndex;
 get(table:SqliteLibraryTable,key:string):any|undefined;
 /** Existence only: do not decode media or other large fact bodies. */
 has(table:SqliteLibraryTable,key:string):boolean;
 entries(table:SqliteLibraryTable):Iterable<LibraryRecordRow>;
}

/** Existing manual backups already contain decoded rows. Index references to
 * those rows, not a second clone. Never let a duplicate silently win in a Map. */
export function libraryRowsReader(rows:LibraryRecordRows):LibraryRecordReader{
 const index=new Map<SqliteLibraryTable,Map<string,LibraryRecordRow>>();
 for(const table of sqliteLibraryTables){
  const entries=new Map<string,LibraryRecordRow>();
  for(const row of rows[table]){
   if(typeof row.key!=='string'||row.key.length===0||row.key.length>2000||entries.has(row.key))throw Error('libraryBackup.errors.inconsistent');
   entries.set(row.key,row);
  }
  index.set(table,entries);
 }
 return {get:(table,key)=>index.get(table)!.get(key)?.value,has:(table,key)=>index.get(table)!.has(key),entries:table=>index.get(table)!.values()};
}

/** Internal adapters for existing domain validators. Iteration and point
 * lookups delegate to the candidate; no full decoded table is constructed. */
export function libraryRecordViews(reader:LibraryRecordReader):{rows:LibraryRecordRows;maps:LibraryRecordLookups}{
 const rows={} as LibraryRecordRows,maps={} as LibraryRecordLookups;
 for(const table of sqliteLibraryTables){
  rows[table]={[Symbol.iterator]:()=>reader.entries(table)[Symbol.iterator]()};
  maps[table]={get:key=>reader.get(table,key),has:key=>reader.has(table,key),*values(){for(const row of reader.entries(table))yield row.value;}};
 }
 return {rows,maps};
}

export function findLibraryRow(rows:Iterable<LibraryRecordRow>,predicate:(row:LibraryRecordRow)=>boolean):LibraryRecordRow|undefined{
 for(const row of rows)if(predicate(row))return row;
}
export function everyLibraryRow(rows:Iterable<LibraryRecordRow>,predicate:(row:LibraryRecordRow)=>boolean):boolean{
 for(const row of rows)if(!predicate(row))return false;
 return true;
}
