/** Reuse only the historical, isolated assessment container; retain its data.
 * A fresh database isolates this run without creating any credentials. */
import {execFileSync,spawn} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
const container='sensa-supplement-schema19-20261012';
const inspection=()=>JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
const before=inspection();const env=new Map<string,string>((before.Config.Env as string[]).map(row=>{const split=row.indexOf('=');return [row.slice(0,split),row.slice(split+1)];}));
const password=env.get('POSTGRES_PASSWORD');if(!password)throw Error('Existing isolated DB credential unavailable');
const database='sensa_m1a_capacity_'+Date.now();
let started=false;
try{
 if(!before.State.Running){execFileSync('docker',['start',container],{stdio:'ignore'});started=true;}
 for(let i=0;i<40;i++){try{execFileSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore'});break;}catch{if(i===39)throw Error('Isolated DB unavailable');await new Promise(r=>setTimeout(r,250));}}
 const mapping=inspection().NetworkSettings.Ports['5432/tcp'];if(mapping?.[0]?.HostIp!=='127.0.0.1')throw Error('Isolated DB must bind loopback only');
 execFileSync('docker',['exec',container,'createdb','-U','postgres',database]);
 const url=`postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${mapping[0].HostPort}/${database}`;
 const childEnv={...process.env,MIGRATION_DATABASE_URL:url,SENSA_ADMIN_TEST_DATABASE_URL:url};
 execFileSync(process.execPath,['--import','tsx','scripts/db-migrate.ts'],{env:childEnv,stdio:'inherit',timeout:120000});
 await mkdir('output/playwright/long-term-capacity-2250269b-20261012',{recursive:true});
 await writeFile(`output/playwright/long-term-capacity-2250269b-20261012/database-context-${database}.json`,JSON.stringify({container,database,loopbackPort:mapping[0].HostPort,startedExistingStoppedContainer:started,credentials:'inherited in memory from prior isolated fixture; not logged or created',retained:true},null,2),{flag:'wx'});
 const args=process.argv.slice(2);if(!args.length)throw Error('Missing child script');
 const child=spawn(process.execPath,['--import','tsx',...args],{env:childEnv,stdio:'inherit'});
 process.exitCode=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}finally{if(started)execFileSync('docker',['stop',container],{stdio:'ignore',timeout:30000});}
