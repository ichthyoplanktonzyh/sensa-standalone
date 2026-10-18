/** New local snapshot boundary only. No Cloud blocks/restore or paid services. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cpus,platform,arch,totalmem} from 'node:os';
import {chromium} from 'playwright-core';
import {createLocalSnapshotBrowserFixture} from '../../tests/web/support/localSnapshotBrowserFixture.mts';
const option=(key:string,fallback:string)=>process.argv.find(value=>value.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const requestedFixture=option('fixture','');if(!requestedFixture)throw Error('Explicit frozen --fixture path required');
const sourcePath=resolve(requestedFixture);
if(!sourcePath.startsWith(resolve('.tmp')+'/retention-capacity-facts-'))throw Error('Isolated frozen fixture required');
const label=option('label','local-snapshot-'+randomUUID());if(!/^[a-z0-9-]+$/u.test(label))throw Error('Invalid output label');
const output=resolve('output/playwright',label);await mkdir(output,{recursive:false});
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const manifestBytes=await readFile(join(sourcePath,'manifest.json')),manifest=JSON.parse(manifestBytes.toString());
assert.equal(manifest.targets,1000);assert.equal(manifest.runs,2001);assert.equal(manifest.events,4000);
const report:any={testedRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTree:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),workingDiffSha256:sha(execFileSync('git',['diff'],{encoding:'utf8'})),startedAt:new Date().toISOString(),hardware:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem(),peakMemory:'1s sampled RSS; see resources, not an allocation peak'},fixture:{path:sourcePath,manifestSha256:sha(manifestBytes),targets:manifest.targets,runs:manifest.runs,events:manifest.events,clock:manifest.clock,taggedFixtureBytes:manifest.bytes,storedFactBytes:manifest.storedFactBytes,construction:manifest.source},conditions:'New route absolute timings; fresh Chromium context/OPFS, protected dev Worker, loopback only; no Cloud protocol, active-pointer/crash acceptance, UI/CWV, paid model/TTS, or strict comparison with historical 2101 Runs',phases:{},status:'running'};
await writeFile(join(output,'fixture-manifest.json'),manifestBytes);
await writeFile(join(output,'executed-source.mts'),await readFile(new URL(import.meta.url)));
const save=()=>writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
await save();
let server:Awaited<ReturnType<typeof chromium.launchServer>>|undefined,browser:Awaited<ReturnType<typeof chromium.connect>>|undefined,fixture:Awaited<ReturnType<typeof createLocalSnapshotBrowserFixture>>|undefined;
let phase='startup',sampling:Promise<void>|undefined;
const samples:any[]=[],execute=promisify(execFile),sampleStarted=performance.now();
const cpuMilliseconds=(value:string)=>{const [seconds,minutes,hours]=value.split(':').reverse().map(Number);return ((hours??0)*3600+(minutes??0)*60+(seconds??0))*1000;};
const sampleResources=()=>{
 if(sampling)return sampling;
 sampling=(async()=>{
  try{
   const {stdout}=await execute('ps',['-A','-o','pid=,ppid=,rss=,time=']);
   const rows=stdout.trim().split('\n').map(line=>{const [pid,ppid,rss,cpu]=line.trim().split(/\s+/u);return {pid:Number(pid),ppid:Number(ppid),rss:Number(rss)*1024,cpuMs:cpuMilliseconds(cpu)};});
   const tree=(root:number)=>{const ids=new Set([root]);let changed=true;while(changed){changed=false;for(const row of rows)if(ids.has(row.ppid)&&!ids.has(row.pid)){ids.add(row.pid);changed=true;}}return rows.filter(row=>ids.has(row.pid));};
   const ownedBrowser=tree(report.ownedBrowserPid),assessment=tree(process.pid),node=process.memoryUsage();
   samples.push({atMs:performance.now()-sampleStarted,phase,browserProcesses:ownedBrowser.length,browserRssBytes:ownedBrowser.reduce((n,row)=>n+row.rss,0),assessmentTreeRssBytes:assessment.reduce((n,row)=>n+row.rss,0),browserCpuMs:ownedBrowser.reduce((n,row)=>n+row.cpuMs,0),nodeRssBytes:node.rss,nodeHeapUsedBytes:node.heapUsed});
  }catch(error){report.resourceSamplingError=String(error);}
 })().finally(()=>{sampling=undefined;});return sampling;
};
const resourceTimer=setInterval(()=>{void sampleResources();},1000);
const stage=async(name:string,work:()=>Promise<any>,limit=120000)=>{
 const started=performance.now();let timer:ReturnType<typeof setTimeout>|undefined;
 phase=name;await sampleResources();
 console.log(JSON.stringify({phase:name,status:'start',limitMs:limit}));
 try{const value=await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(name+'_120s_budget')),limit);})]);report.phases[name]={elapsedMs:performance.now()-started,value};await save();console.log(JSON.stringify({phase:name,status:'passed',elapsedMs:report.phases[name].elapsedMs}));return value;}
 catch(error){report.phases[name]={elapsedMs:performance.now()-started,error:String(error)};await save();throw error;}
 finally{if(timer)clearTimeout(timer);}
};
try{
 server=await chromium.launchServer({headless:true,host:'127.0.0.1'});browser=await chromium.connect(server.wsEndpoint());report.ownedBrowserPid=server.process().pid;report.browser=browser.version();
 await sampleResources();
 fixture=await createLocalSnapshotBrowserFixture(browser);report.origin=fixture.origin;
 const page=await fixture.createPage();await page.clock.setFixedTime(new Date(manifest.clock));
 phase='fixture-setup';const setup=performance.now();
 for(const batch of manifest.batches){if(!/^\w+-\d+\.json$/u.test(batch.file))throw Error('Unsafe fixture batch');const bytes=await readFile(join(sourcePath,batch.file));assert.equal(sha(bytes),batch.sha256);await page.evaluate(({table,text})=>(window as any).snapshotApi.loadBatch(table,text),{table:batch.table,text:bytes.toString()});}
 report.fixtureSetupMs=performance.now()-setup;report.sourceCounts=await page.evaluate(()=>(window as any).snapshotApi.counts());
 assert.equal(report.sourceCounts.targets,1000);assert.equal(report.sourceCounts.runs,2001);assert.equal(report.sourceCounts.events,4000);await save();
 phase='source-hash-verification';const verificationStart=performance.now(),expected=await page.evaluate(()=>(window as any).snapshotApi.hashes());report.sourceHashVerificationMs=performance.now()-verificationStart;report.expectedFactHashRoot=sha(JSON.stringify(Object.entries(expected).sort()));report.expectedPortableRecords=Object.keys(expected).length;
 await stage('producer',()=>page.evaluate(()=>(window as any).snapshotApi.exportSnapshot()));
 const imported=await stage('receiver',()=>page.evaluate(()=>(window as any).snapshotApi.importSnapshot()));
 const reopened=await stage('reopen',()=>page.evaluate(()=>(window as any).snapshotApi.reopenSnapshot()));
 assert.equal(reopened.targets,1000);assert.equal(reopened.runs,2001);assert.equal(reopened.events,4000);
 await stage('exact-fact-verification',async()=>{assert.deepEqual(await page.evaluate(()=>(window as any).snapshotApi.hashes(true)),expected);return {samePortableRecords:true,includesMemoryAndAllPins:true};});
 await page.evaluate(()=>(window as any).snapshotApi.close());
 const learner=await fixture.createPage();await learner.clock.setFixedTime(new Date(manifest.clock));await learner.evaluate(namespace=>(window as any).snapshotApi.attachForLearning(namespace),imported.namespace);
 const before=await learner.evaluate(()=>(window as any).snapshotApi.counts(true)),at=await learner.evaluate(id=>(window as any).snapshotApi.targetClock(id),manifest.probeTargetId);await learner.clock.setFixedTime(new Date(at));
 await stage('post-restore-learning',()=>learner.evaluate(({id,at})=>(window as any).snapshotApi.settle(id,at),{id:manifest.probeTargetId,at}));
 const after=await learner.evaluate(()=>(window as any).snapshotApi.counts(true));assert.equal(after.events,before.events+2);report.postRestoreCounts=after;
 await learner.evaluate(()=>(window as any).snapshotApi.close());assert.deepEqual(fixture.externalRequests,[]);report.externalRequests=fixture.externalRequests;
 report.status='passed';
}catch(error){report.status='failed';report.error=error instanceof Error?error.stack:String(error);process.exitCode=1;console.error(JSON.stringify({status:'failed',error:report.error}));}
finally{
 clearInterval(resourceTimer);await sampleResources();if(sampling)await sampling;
 const peak=(items:any[],key:string)=>Math.max(0,...items.map(item=>item[key]));
 report.resources={measurement:'1s sampled process-tree RSS, shared pages may be counted by more than one process; observed maxima, not allocation peaks; assessment tree includes Node and test-owned browser only',samples:samples.length,peakBrowserRssBytes:peak(samples,'browserRssBytes'),peakAssessmentTreeRssBytes:peak(samples,'assessmentTreeRssBytes'),peakNodeHeapUsedBytes:peak(samples,'nodeHeapUsedBytes'),phases:Object.fromEntries([...new Set(samples.map(item=>item.phase))].map(name=>{const items=samples.filter(item=>item.phase===name);return [name,{samples:items.length,peakBrowserRssBytes:peak(items,'browserRssBytes'),peakAssessmentTreeRssBytes:peak(items,'assessmentTreeRssBytes'),peakNodeHeapUsedBytes:peak(items,'nodeHeapUsedBytes')}];}))};
 await writeFile(join(output,'resources.json'),JSON.stringify(samples,null,2)+'\n');
 await fixture?.close().catch(()=>{});await browser?.close().catch(()=>{});await server?.close().catch(()=>{});report.completedAt=new Date().toISOString();await save();console.log(JSON.stringify({status:report.status,report:join(output,'report.json')}));
}
