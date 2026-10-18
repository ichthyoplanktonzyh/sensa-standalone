/** Specialized, serial capacity invocation with a descendant-process RSS watchdog.
 * ps samples are an observed lower bound on peak RSS, not browser JS heap or
 * unique physical pages (shared pages can be counted more than once). */
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile,open,readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {cpus,totalmem,platform,arch} from 'node:os';
const split=process.argv.indexOf('--');
if(split<0)throw Error('Use --label=name --output=output/playwright/... -- command args');
const option=(key:string,fallback:string)=>process.argv.slice(2,split).find(x=>x.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const label=option('label','run');if(!/^[a-z0-9-]+$/u.test(label))throw Error('Unsafe label');
const directory=resolve(option('output','output/playwright/long-term-capacity-2250269b-20261012'));
if(!directory.startsWith(resolve('output/playwright')+'/'))throw Error('Use ignored evidence directory');
const maxMs=Number(option('max-ms','600000')),maxRss=Number(option('max-rss-mib','6144'))*1048576;
if(!(maxMs>0&&maxMs<=3600000&&maxRss>0&&maxRss<=6*1024**3))throw Error('Invalid safety budgets');
await mkdir(directory,{recursive:true});const log=await open(join(directory,label+'.log'),'wx');
await writeFile(join(directory,label+'.source-diff.patch'),execFileSync('git',['diff','HEAD','--'],{encoding:'utf8'}),{flag:'wx'});
const sourceDirectory=join(directory,label+'-sources');await mkdir(sourceDirectory,{recursive:false});
const sourceHashes:Record<string,string>={};
for(const filename of await readdir('scripts/assessment')){
 const content=await readFile(join('scripts/assessment',filename));sourceHashes[filename]=createHash('sha256').update(content).digest('hex');await writeFile(join(sourceDirectory,filename),content,{flag:'wx'});
}
await writeFile(join(sourceDirectory,'sha256.json'),JSON.stringify(sourceHashes,null,2),{flag:'wx'});
const command=process.argv.slice(split+1);if(!command.length)throw Error('Missing command');
const startedAt=new Date().toISOString(),start=performance.now();
const child=spawn(command[0]!,command.slice(1),{stdio:['ignore','pipe','pipe'],env:process.env,detached:true});
child.stdout.on('data',data=>{process.stdout.write(data);void log.write(data);});child.stderr.on('data',data=>{process.stderr.write(data);void log.write(data);});
const samples:{atMs:number;rssBytes:number;processes:number;cpuPercent:number}[]=[];let stopped:string|null=null,monitorError:string|null=null;
function stop(reason:string){if(stopped)return;stopped=reason;try{process.kill(-child.pid!,'SIGTERM');}catch{}setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},3000).unref();}
const monitor=setInterval(()=>{
 try{
  const rows=execFileSync('ps',['-axo','pid=,ppid=,rss=,%cpu='],{encoding:'utf8',timeout:3000}).trim().split('\n').map(line=>line.trim().split(/\s+/u).map(Number));
  const ids=new Set([child.pid!]);let changed=true;while(changed){changed=false;for(const [pid,parent]of rows)if(ids.has(parent!)&&!ids.has(pid!)){ids.add(pid!);changed=true;}}
  const active=rows.filter(([pid])=>ids.has(pid!));const rssBytes=active.reduce((sum,row)=>sum+row[2]!*1024,0);
  samples.push({atMs:Math.round(performance.now()-start),rssBytes,processes:active.length,cpuPercent:active.reduce((sum,row)=>sum+row[3]!,0)});
  if(rssBytes>=maxRss)stop('sampled_descendant_RSS_budget');if(performance.now()-start>=maxMs)stop('elapsed_budget');
 }catch(error){monitorError=String(error);stop('resource_monitor_unavailable');}
},500);
const exit=await new Promise<{code:number|null;signal:string|null;error?:string}>((done)=>{child.once('error',error=>done({code:null,signal:null,error:String(error)}));child.once('exit',(code,signal)=>done({code,signal}));});
clearInterval(monitor);await log.close();
const report={format:'sensa-bounded-capacity-invocation-v1',label,command,startedAt,completedAt:new Date().toISOString(),elapsedMs:performance.now()-start,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hardware:{cpu:cpus()[0]?.model,threads:cpus().length,totalmem:totalmem(),platform:platform(),arch:arch()},limits:{maxMs,maxRss},exit,stopped,monitorError,sampledPeakDescendantRssBytes:Math.max(0,...samples.map(x=>x.rssBytes)),sampleIntervalMs:500,samples,scope:'descendant summed process RSS samples; shared memory can double count; between-sample peaks, Docker VM and reparented workers excluded'};
await writeFile(join(directory,label+'.resource.json'),JSON.stringify(report,null,2),{flag:'wx'});
process.exitCode=exit.code??1;if(stopped)process.exitCode=1;
