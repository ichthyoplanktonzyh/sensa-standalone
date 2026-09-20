/// <reference lib="webworker" />

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import sqliteWasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';

type BenchmarkMode={
  name:string;
  journal:'DELETE'|'PERSIST'|'WAL';
  synchronous:'FULL'|'NORMAL';
};

type BenchmarkRequest={
  action:'measure'|'verify';
  directory:string;
  modes:BenchmarkMode[];
  transactions:number;
};

const scope=self as unknown as DedicatedWorkerGlobalScope;
const scalar=(db:{exec:(input:unknown)=>unknown},sql:string):string=>{
  const rows=db.exec({sql,rowMode:0,returnValue:'resultRows'}) as unknown[];
  return String(rows[0]??'');
};

scope.addEventListener('message',(event:MessageEvent<BenchmarkRequest>)=>{
  void (async()=>{
    const initialize=sqlite3InitModule as unknown as (options?:{
      locateFile?:(path:string)=>string;
    })=>ReturnType<typeof sqlite3InitModule>;
    const sqlite3=await initialize({
      locateFile:(path)=>path.endsWith('.wasm')?sqliteWasmUrl:path,
    });
    const pool=await sqlite3.installOpfsSAHPoolVfs({
      directory:event.data.directory,
      initialCapacity:event.data.modes.length*2+2,
      clearOnInit:event.data.action==='measure',
      verbosity:0,
    });
    const results=[];
    const intentionallyUnclosed:Array<{close:()=>void}>=[];
    for(const mode of event.data.modes){
      const filename=`/${mode.name}.sqlite3`;
      const db=new pool.OpfsSAHPoolDb(filename);
      let keepOpen=false;
      try{
        // SQLite Wasm requires this to be the first operation when WAL is used.
        db.exec('PRAGMA locking_mode=EXCLUSIVE');
        if(event.data.action==='verify'){
          results.push({
            name:mode.name,
            count:Number(scalar(db,'SELECT COUNT(*) FROM benchmark_records')),
            integrity:scalar(db,'PRAGMA quick_check(1)'),
            journal:scalar(db,'PRAGMA journal_mode'),
            synchronous:Number(scalar(db,'PRAGMA synchronous')),
            locking:scalar(db,'PRAGMA locking_mode'),
          });
          continue;
        }
        db.exec(`PRAGMA journal_mode=${mode.journal}`);
        db.exec(`PRAGMA synchronous=${mode.synchronous}`);
        db.exec('PRAGMA temp_store=MEMORY');
        db.exec('CREATE TABLE benchmark_records(id TEXT PRIMARY KEY,value_json TEXT NOT NULL) WITHOUT ROWID');
        const payload=JSON.stringify({text:'sensa-opfs-benchmark-'.repeat(256)});
        const durations:number[]=[];
        const total=event.data.transactions+10;
        for(let transaction=0;transaction<total;transaction++){
          const started=performance.now();
          db.exec('BEGIN IMMEDIATE');
          for(let row=0;row<4;row++){
            db.exec({
              sql:'INSERT INTO benchmark_records(id,value_json) VALUES(?,?)',
              bind:[`${transaction}-${row}`,payload],
            });
          }
          db.exec('COMMIT');
          if(transaction>=10)durations.push(performance.now()-started);
        }
        const ordered=[...durations].sort((left,right)=>left-right);
        results.push({
          name:mode.name,
          count:Number(scalar(db,'SELECT COUNT(*) FROM benchmark_records')),
          integrity:scalar(db,'PRAGMA quick_check(1)'),
          journal:scalar(db,'PRAGMA journal_mode'),
          synchronous:Number(scalar(db,'PRAGMA synchronous')),
          locking:scalar(db,'PRAGMA locking_mode'),
          totalMs:durations.reduce((sum,value)=>sum+value,0),
          p50Ms:ordered[Math.floor(ordered.length*0.5)],
          p95Ms:ordered[Math.floor(ordered.length*0.95)],
        });
        // The caller terminates this Worker after receiving the result. Keeping
        // handles open verifies committed FULL-sync data without a clean close.
        keepOpen=true;
      }finally{
        if(keepOpen)intentionallyUnclosed.push(db);
        else db.close();
      }
    }
    if(event.data.action==='verify')await pool.removeVfs();
    return results;
  })().then(
    (value)=>scope.postMessage({ok:true,value}),
    (cause)=>scope.postMessage({ok:false,error:cause instanceof Error?cause.message:String(cause)}),
  );
});
