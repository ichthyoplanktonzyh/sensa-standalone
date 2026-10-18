import {test,expect,vi} from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {librarySyncTables} from '@sensa/contracts/sensa';
import type {SqliteLibraryTable,SqliteRecordChange} from '../../../apps/web/src/data/library/sqliteProtocol';

const sqlite=await sqlite3InitModule();
const encoded=(value:unknown)=>JSON.stringify(encodeBackupValue(value));
const compare=(a:SqliteRecordChange,b:SqliteRecordChange)=>a.contentRevision-b.contentRevision
 || (a.table<b.table?-1:a.table>b.table?1:0) || (a.key<b.key?-1:a.key>b.key?1:0);

function fixture(filename=':memory:'){
 const raw=new sqlite.oo1.DB(filename,'c'),db=new SqliteRecordDatabase(sqlite,raw,'memory');db.initialize();
 const records:SqliteRecordChange[]=[];
 raw.exec('BEGIN');
 for(let i=0;i<450;i++){
  const table=(['drafts','settings','annotations'] as const)[i%3]!,key='key-'+String(Math.floor(i/3)).padStart(3,'0');
  const contentRevision=i<30?7:8+Math.floor((i-30)/210),encodedValue=encoded({key,table,text:'retained '+i});
  raw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,?)',bind:[table,key,encodedValue,contentRevision]});
  records.push({table,key,encodedValue,contentRevision});
 }
 for(let i=0;i<90;i++){
  const table=(['settings','drafts','annotations'] as const)[i%3]!,key='deleted-'+String(Math.floor(i/3)).padStart(3,'0'),contentRevision=i<6?7:8;
  raw.exec({sql:'INSERT INTO sensa_record_tombstones(table_name,record_key,content_revision) VALUES(?,?,?)',bind:[table,key,contentRevision]});
  records.push({table,key,encodedValue:null,contentRevision});
 }
 raw.exec('COMMIT');
 let closed=false;
 return {raw,db,records,close:()=>{if(!closed){closed=true;db.close(false);}}};
}

test('revision tail preserves mixed tables, tied revisions and tombstones across keyset page boundaries',()=>{
 const f=fixture();try{
  const tables=['settings','drafts','settings'] as const,selected=new Set<SqliteLibraryTable>(tables);
  const expected=f.records.filter(row=>row.contentRevision>7&&selected.has(row.table)).sort(compare);
  expect(expected.length).toBeGreaterThan(256);expect(expected.some(row=>row.encodedValue===null)).toBe(true);
  expect(f.db.changesSince(7,tables)).toEqual(expected);
  for(const limit of [1,127,128]){
   const actual:SqliteRecordChange[]=[];let after:undefined|{contentRevision:number;table:SqliteLibraryTable;key:string};
   for(let page=0;;page++){
    expect(page).toBeLessThan(expected.length+1);
    const rows=f.db.changesSince(7,tables,{limit,after});expect(rows.length).toBeLessThanOrEqual(limit);actual.push(...rows);
    if(rows.length<limit)break;
    const last=rows.at(-1)!;after={contentRevision:last.contentRevision,table:last.table,key:last.key};
   }
   expect(actual).toEqual(expected);expect(new Set(actual.map(row=>row.table+'/'+row.key)).size).toBe(expected.length);
  }
  expect(f.db.changesSince(9,tables,{limit:128})).toEqual([]);
 }finally{f.close();}
});

test('a small revision tail uses the existing revision index despite populated-library planner estimates, including after index repair',()=>{
 const filename='/change-query-'+crypto.randomUUID()+'.sqlite',f=fixture(filename);let reopened:SqliteRecordDatabase|undefined;try{
  // Estimates captured from a populated library reproduce the bad choice without a large data fixture.
  f.raw.exec("ANALYZE;UPDATE sqlite_stat1 SET stat='132026 1551 776 1' WHERE idx='sensa_records_content_revision';UPDATE sqlite_stat1 SET stat='132026 776 1' WHERE idx='sqlite_autoindex_sensa_records_1';ANALYZE sqlite_schema");
  const spy=vi.spyOn(f.raw,'exec');
  const changes=f.db.changesSince(7,librarySyncTables,{limit:128});
  const query=spy.mock.calls.map(([query])=>query).find(query=>typeof query==='object'&&'sql' in query&&typeof query.sql==='string'&&query.sql.startsWith('SELECT * FROM(SELECT table_name,record_key,value_json,content_revision'));
  spy.mockRestore();expect(query).toBeTruthy();if(typeof query!=='object'||!('sql' in query))throw Error('missing actual changesSince query');
  const plan=f.raw.exec({...query,sql:'EXPLAIN QUERY PLAN '+query.sql,rowMode:'object',returnValue:'resultRows'}) as unknown as {detail:string}[];
  expect(plan.some(row=>/SEARCH sensa_records USING INDEX sensa_records_content_revision \(content_revision>\?\)/.test(row.detail))).toBe(true);
  f.raw.exec('DROP INDEX sensa_records_content_revision');
  f.close();const reopenedRaw=new sqlite.oo1.DB(filename,'w');
  reopened=new SqliteRecordDatabase(sqlite,reopenedRaw,'memory');reopened.initialize();
  expect(reopenedRaw.selectValue("SELECT count(*) FROM sqlite_schema WHERE name='sensa_records_content_revision'")).toBe(1);
  expect(reopened.changesSince(7,librarySyncTables,{limit:128})).toEqual(changes);
 }finally{reopened?.close(false);f.close();}
});
