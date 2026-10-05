/** Genuine command-generated history in isolated Chromium/OPFS. Source setup
 * time and byte footprint are reported separately from actual UI interaction. */
import {test,expect} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join,extname,basename} from 'node:path';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';

let server:Server,origin:string,dist:string;
const fixtureDirectory=process.env.SENSA_RETENTION_CAPACITY_FIXTURE;
type Manifest={clock:string;targets:number;runs:number;events:number;bytes:number;probeTargetId:string;probeRunId:string;setupSeconds:number};
let manifest:Manifest;
const mime:Record<string,string>={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2','.svg':'image/svg+xml'};
test.setTimeout(15*60_000);
test.use({viewport:{width:1280,height:900},locale:'zh-CN'});
test.beforeAll(async()=>{
 let fixturePath=fixtureDirectory;
 if(!fixturePath){
  const count=Number(process.env.SENSA_RETENTION_CAPACITY_TARGETS??1000);
  const log=execFileSync(process.execPath,['--import','tsx','scripts/generateRetentionCapacity.mts',`--targets=${count}`],{env:{...process.env,SENSA_TEST_MEMORY_LIBRARY:'true'},encoding:'utf8',maxBuffer:16*1024*1024});
  const result=log.trim().split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(row=>row.stage==='validated_snapshot');
  if(!result?.directory)throw new Error('Capacity generator did not return validated facts');
  fixturePath=result.directory;
 }
 const fixtureRoot=resolve(fixturePath!);
 if(!fixtureRoot.startsWith(resolve('.tmp')+'/retention-capacity-facts-'))throw new Error('Capacity fixture must be isolated under .tmp');
 manifest=JSON.parse(await readFile(join(fixtureRoot,'manifest.json'),'utf8'));
 const output=await mkdtemp(resolve('.tmp/retention-capacity-web-'));dist=join(output,'dist');await mkdir(dist,{recursive:true});
 const registry={format:'sensa-learning-content-registry-v3',publishedAt:'2026-10-05T00:00:00Z',items:[]};
 server=createServer(async(request,response)=>{
  const url=new URL(request.url??'/',origin??'http://127.0.0.1');
  const json=(value:unknown,status=200)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
  try{
   if(url.pathname.startsWith('/__capacity_fixture/')){const name=basename(url.pathname),bytes=await readFile(join(fixtureRoot,name));response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(bytes);return;}
   if(url.pathname==='/sensa/packages'){json({...registry,revision:createHash('sha256').update(JSON.stringify(registry)).digest('hex')});return;}
   if(url.pathname==='/sensa/service/status'){json({authorized:false,explanationAvailable:false,checkedAt:new Date().toISOString(),windowHours:24,usage:[]});return;}
   if(url.pathname.startsWith('/sensa/')||url.pathname.startsWith('/auth/')){json({code:'not_found'},404);return;}
   const path=join(dist,url.pathname),file=extname(path)&&path.startsWith(dist)?path:join(dist,'index.html');
   const bytes=await readFile(file);response.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'});response.end(bytes);
  }catch{json({code:'fixture_missing'},404);}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 execFileSync('npm',['run','build','-w','@sensa/web','--','--outDir',dist,'--emptyOutDir'],{env:{...process.env,VITE_SENSA_MODE:'production',VITE_SENSA_BROWSER_SMOKE:'true',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-key',VITE_SENSA_API_URL:origin},stdio:'inherit'});
});
test.afterAll(async()=>{if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));});

test('mature retained Targets and formal Review history keep actual reveal, rating, next-target and return-to-history responsive',async({page})=>{
 const timings:Record<string,number>={},setupStarted=performance.now();
 const readStarts=new Map<string,number>(),readDurations:{name:string;durationMs:number}[]=[];
 page.on('console',message=>{const [prefix,phase,id,name]=message.text().split('|');if(prefix!=='__sensaLearningTrace')return;if(phase==='start')readStarts.set(id,performance.now());else if(readStarts.has(id)){readDurations.push({name,durationMs:performance.now()-readStarts.get(id)!});readStarts.delete(id);}});
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.clock.setFixedTime(new Date(manifest.clock));await page.goto(origin);
 await expect.poll(()=>page.evaluate(()=>!!window.__sensaBrowserSmoke)).toBe(true);
 const restored=await page.evaluate(()=>window.__sensaBrowserSmoke!.copyVerifiedLearningCapacityForTest('/__capacity_fixture/manifest.json'));
 expect(restored).toEqual({targets:manifest.targets,runs:manifest.runs,events:manifest.events});
 const fixtureCopyMs=performance.now()-setupStarted;
 await page.reload();await page.getByRole('button',{name:'进入 Sensa',exact:true}).first().click();
 const home=page.locator('#s-home');await expect(home.getByRole('button',{name:'继续学习',exact:true})).toBeEnabled({timeout:30_000});
 await page.evaluate(()=>window.__sensaBrowserSmoke!.traceLearningReadsForTest(true));
 let begin=performance.now();await home.getByRole('button',{name:'继续学习',exact:true}).click();
 const runtime=page.locator('#s-lightweight-runtime');await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled({timeout:30_000});timings.resume=performance.now()-begin;
 const before=await page.evaluate(targetId=>window.__sensaBrowserSmoke!.learningCapacityCheckpointForTest(targetId),manifest.probeTargetId);
 expect(before.memoryRevision).toBe(2);expect(before.activeRunId).toBe(manifest.probeRunId);
 begin=performance.now();await runtime.getByRole('button',{name:/查看表达/}).click();await expect(runtime.getByRole('button',{name:/有点印象/})).toBeEnabled();timings.reveal=performance.now()-begin;
 begin=performance.now();await runtime.getByRole('button',{name:/有点印象/}).click();await expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled({timeout:30_000});timings.ratingAndNext=performance.now()-begin;
 const after=await page.evaluate(targetId=>window.__sensaBrowserSmoke!.learningCapacityCheckpointForTest(targetId),manifest.probeTargetId);
 expect(after.memoryRevision).toBe(3);expect(after.events).toBe(before.events+2);expect(after.activeTargetId).not.toBe(manifest.probeTargetId);
 await runtime.getByRole('button',{name:'暂停',exact:true}).click();await expect(home.getByRole('heading',{name:'今天',level:1,exact:true})).toBeVisible();
 begin=performance.now();await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'我的学习',exact:true}).click();
 const study=page.locator('#s-study');await expect(study.locator('ol').getByRole('button')).toHaveCount(10,{timeout:30_000});timings.study=performance.now()-begin;
 await page.evaluate(async()=>{await window.__sensaBrowserSmoke!.failLearningManagementReadsForTest(true);window.dispatchEvent(new Event('sensa-library-changed'));});
 await expect(study.getByRole('alert')).toBeVisible();await expect(study.locator('ol')).toHaveCount(0);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningManagementReadsForTest(false));await study.getByRole('button',{name:'重试',exact:true}).click();await expect(study.locator('ol').getByRole('button')).toHaveCount(10);
 begin=performance.now();await study.getByRole('button',{name:'学习统计',exact:true}).click();
 const stats=page.locator('#s-stats');await stats.getByRole('button',{name:'全部可用记录',exact:true}).click();
 await expect(stats.locator('ol').getByRole('button')).toHaveCount(20);await expect(stats.getByRole('status').filter({hasText:`${manifest.targets*2+1} 条`})).toBeVisible();timings.statistics=performance.now()-begin;
 const selectedRecord=stats.locator('ol').getByRole('button').first(),recordExpression=await selectedRecord.locator('strong').innerText();
 begin=performance.now();await selectedRecord.click();
 const target=page.locator('#s-learning-target');await expect(target.locator('summary').filter({hasText:'查看学习资源'})).toBeVisible({timeout:30_000});timings.historyToTarget=performance.now()-begin;
 await expect(target.getByRole('heading',{name:recordExpression,level:2,exact:true})).toBeVisible();
 await page.evaluate(async()=>{await window.__sensaBrowserSmoke!.failLearningTargetReadsForTest(true);window.dispatchEvent(new Event('sensa-library-changed'));});
 await expect(target.getByRole('alert')).toBeVisible();await expect(target.locator('summary')).toHaveCount(0);
 await expect(target.getByRole('heading',{name:recordExpression,level:2,exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningTargetReadsForTest(false));await target.getByRole('button',{name:'重试',exact:true}).click();
 await expect(target.getByRole('heading',{name:recordExpression,level:2,exact:true})).toBeVisible();
 await target.getByRole('button',{name:'返回',exact:true}).click();await expect(stats.locator('ol').getByRole('button')).toHaveCount(20);
 const interactionWorkspaceReads=await page.evaluate(()=>performance.getEntriesByType('measure').filter(entry=>entry.name.startsWith('sensa.workspace.')).map(entry=>({phase:'interaction',name:entry.name,durationMs:entry.duration})));
 // Screen-memory filters intentionally reset on a full page reload. Readiness
 // is the actual recent Review; explicitly select all again to verify history.
 begin=performance.now();await page.reload();await expect(stats.locator('ol').getByRole('button').first()).toBeVisible({timeout:30_000});timings.statisticsReload=performance.now()-begin;
 await stats.getByRole('button',{name:'全部可用记录',exact:true}).click();await expect(stats.locator('ol').getByRole('button')).toHaveCount(20);await expect(stats.getByRole('status').filter({hasText:`${manifest.targets*2+1} 条`})).toBeVisible();
 // Pagination changes only the rendered list, never the complete-range count.
 await stats.getByRole('button',{name:'显示更多记录',exact:true}).click();await expect(stats.locator('ol').getByRole('button')).toHaveCount(40);
 await expect(stats.getByRole('status').filter({hasText:`${manifest.targets*2+1} 条`})).toBeVisible();
 await stats.getByRole('combobox').selectOption('initial_learning');await expect(stats.locator('ol').getByRole('button')).toHaveCount(20);
 await expect(stats.getByRole('status').filter({hasText:`${manifest.targets} 条`})).toBeVisible();
 await stats.getByRole('combobox').selectOption('retention_review');await expect(stats.locator('ol').getByRole('button')).toHaveCount(20);
 await expect(stats.getByRole('status').filter({hasText:`${manifest.targets+1} 条`})).toBeVisible();
 await page.evaluate(async()=>{await window.__sensaBrowserSmoke!.failLearningHistoryReadsForTest(true);window.dispatchEvent(new Event('sensa-library-changed'));});
 await expect(stats.getByRole('alert')).toBeVisible();await expect(stats.locator('ol')).toHaveCount(0);
 await page.evaluate(()=>window.__sensaBrowserSmoke!.failLearningHistoryReadsForTest(false));await stats.getByRole('button',{name:'重试',exact:true}).click();
 await expect(stats.locator('ol').getByRole('button')).toHaveCount(20);await expect(stats.getByRole('status').filter({hasText:`${manifest.targets+1} 条`})).toBeVisible();
 const directory=resolve('.tmp/retention-capacity-evidence');await mkdir(directory,{recursive:true});
 const workspaceReads=[...interactionWorkspaceReads,...await page.evaluate(()=>performance.getEntriesByType('measure').filter(entry=>entry.name.startsWith('sensa.workspace.')).map(entry=>({phase:'reload',name:entry.name,durationMs:entry.duration})))];
 const evidence={fixture:'formal LearningSystem command results, fully replay-validated by the Node producer before digest-checked bounded copying into isolated OPFS; not product backup restore',targets:manifest.targets,initialRuns:manifest.targets,reviewRuns:manifest.targets,events:manifest.events,sourceBytes:manifest.bytes,generatorSeconds:manifest.setupSeconds,fixtureCopyMs,clock:manifest.clock,timingsMs:timings,workspaceReads,readDurations,conditions:'Chromium 1x CPU / 1280x900 / loopback / synthetic low-media source; no audio-quality or real-provider claim; query trace durations are diagnostic Node-console arrival intervals, not budget measurements'};
 await writeFile(join(directory,`targets-${manifest.targets}.json`),JSON.stringify(evidence,null,2));console.info(JSON.stringify(evidence));
 expect(timings.reveal).toBeLessThan(750);expect(timings.ratingAndNext).toBeLessThan(1000);expect(timings.study).toBeLessThan(1500);expect(timings.statistics).toBeLessThan(1500);expect(timings.historyToTarget).toBeLessThan(1000);expect(timings.statisticsReload).toBeLessThan(2000);
});
