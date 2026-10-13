/** Specialized serial UI measurement; no product changes, paid calls or owner data. */
import {chromium,expect as baseExpect,type Page,type Locator} from '@playwright/test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,mkdtemp,stat,readdir} from 'node:fs/promises';
import {resolve,join,extname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {encodeBackupValue,decodeBackupValue} from '../../apps/web/src/data/library/backupCodec';
import {storeMeaningContexts,hydrateMeaningContexts,contextKey,contextRecordId} from '../../apps/web/src/experience/personalMeaningJourney/contextRecords';
import {syntheticSemanticWorld,semanticLookupPayload,semanticLookupSpec} from '../../tests/web/support/semanticLookupFixtures';
import {MemoryJourneyRepository} from '../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../apps/web/src/experience/personalMeaningJourney/ports';
import {assertPersonalSemanticWorldState} from '../../apps/web/src/experience/personalMeaningJourney/authority';

const expect=baseExpect.configure({timeout:30000});
const opt=(key:string,fallback='')=>process.argv.find(x=>x.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const size=Number(opt('size','10000')),samples=Number(opt('samples','30'));
const scaleProbe=process.argv.includes('--scale-probe');
const batchOutput=process.argv.includes('--batch-world'),batchInput=opt('world-batches');
const finishBatchCopy=process.argv.includes('--finish-batch-copy');
if(batchOutput&&!process.argv.includes('--generate-only'))throw Error('Batch production is a separate bounded preparation invocation');
if(![10000,50000].includes(size)||samples<1||samples>30)throw Error('Invalid bounded dimensions');
const directory=resolve(opt('output'));if(!directory.startsWith(resolve('output/playwright')+'/'))throw Error('Use evidence output');
const resume=opt('resume')?JSON.parse(await readFile(resolve(opt('resume')),'utf8')):null;
if(resume&&(!resume.isolatedProfile?.startsWith(resolve('.tmp')+'/daily-ui-profile-')||!resume.buildRoot?.startsWith(resolve('.tmp')+'/daily-ui-build-')||new URL(resume.origin).hostname!=='127.0.0.1'||Number(new URL(resume.origin).port)===3000))throw Error('Resume requires a retained isolated measurement profile and origin');
await mkdir(directory,{recursive:true});
const report:any={format:'sensa-daily-ui-measurement-v1',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),size,samples,status:'preparing',phases:[],preparation:{},conditions:'M1 Max physical host, 1x CPU, Chromium 1280x900 zh-CN; minified production build with existing smoke setup bridge; new isolated profile/OPFS and loopback origin, external requests blocked; no owner DB/profile, no paid calls. Browser cold means process restart with retained isolated profile; OS file cache is not cleared. Timings begin at actual DOM input event and end after correct visible actionable UI and two animation frames; driver polling may conservatively add latency. Synthetic lawful facts, not human lexical/media quality.'};
const save=()=>writeFile(join(directory,'measurements.json'),JSON.stringify(report,null,2));
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
await writeFile(join(directory,'executed-source.mts'),await readFile(new URL(import.meta.url)),{flag:'wx'});await save();
let start=performance.now();
let world:any,worldBytes='',worldBatchManifest:any;
if(!batchInput){
// Every relationship in this seed is produced by formal commands. Unlike the
// multi-interpretation functional fixture, no IDs are manually reconnected.
const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}),gateway=modules.personalMeaningJourney;
const expressions=[{surfaceForm:'borrow',languageTag:'en',expressionType:'word' as const,relation:'realizes' as const,semanticCoverage:'exact' as const},{surfaceForm:'emprunter',languageTag:'fr',expressionType:'word' as const,relation:'realizes' as const,semanticCoverage:'exact' as const}];
const {schemaVersion:_schema,...spec}=semanticLookupSpec,contextFact=semanticLookupPayload().context!;
const capture=await modules.semanticIntake.submit({...semanticLookupPayload(),acceptance:null,sense:null});if(capture.route!=='inbox')throw Error('Expected formal capture');
const accepted=await gateway.completeClarificationDraft({operationId:crypto.randomUUID(),intakeId:capture.intakeId,source:await gateway.captureClarificationSource('intake',capture.intakeId),context:contextFact,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:{statement:'临时借用物品',distinguishingNotes:[],aspectLabel:''},sense:{proposedSenseKey:'temporary-borrow',...spec,unresolvedQuestions:[]},expression:{...expressions[0]!},expressionCandidates:expressions,confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'fixture'},semanticPolicyVersion:'fixture'});
const record=(await repository.load()).meanings[0]!,focus=gateway.getDetail(accepted.personalMeaningId)!.focuses[0]!,candidate=record.proposalVersions[0]!.expressionCandidates.find(x=>x.surfaceForm==='emprunter')!;
await gateway.confirmExpressionBinding({operationId:crypto.randomUUID(),personalMeaningId:accepted.personalMeaningId,source:await gateway.captureClarificationSource('personal_meaning',accepted.personalMeaningId),meaningFocusId:focus.meaningFocusId,senseVersionId:focus.alignment!.senseVersionId,candidateId:candidate.candidateId,...expressions[1]!});
for(let index=1;index<=4;index++){const payload=semanticLookupPayload(),form=`borrow-${index}`,text=`Private source: May asked to ${form} an umbrella.`;payload.context!.textSegment=text;payload.expression!.surfaceForm=form;payload.expression!.occurrence={surfaceForm:form,locator:{kind:'text_span',start:29,end:29+form.length}};payload.sense!.senseKey=`borrowing-${index}`;await modules.semanticIntake.submit(payload);}
const seed=await repository.load();assertPersonalSemanticWorldState(seed);
world=opt('world-fixture')?JSON.parse(await readFile(resolve(opt('world-fixture')),'utf8')):syntheticSemanticWorld(seed,size/5);
// Existing generator specializes its first Sense label for single-node seeds.
// Multi-node seed blocks also need distinct Sense keys; references use immutable
// Sense IDs and remain untouched. This adds no graph relation or learning fact.
if(!opt('world-fixture')){
 world.registry.senses.forEach((sense:any,index:number)=>{sense.senseKey=`daily-experience-${index}`;});
 // Undo the existing single-node helper's display-text specialization. The
 // actual Context text, occurrence locator and confirmed expression remain.
 world.registry.expressionVersions.forEach((version:any,index:number)=>{const original=seed.registry.expressionVersions[index%seed.registry.expressionVersions.length]!;version.surfaceForm=original.surfaceForm;version.normalizedForm=original.normalizedForm;});
 world.registry.senseVersions.forEach((version:any,index:number)=>{version.semanticSpec=structuredClone(seed.registry.senseVersions[index%seed.registry.senseVersions.length]!.semanticSpec);});
}
assertPersonalSemanticWorldState(world);
report.preparation.worldGenerateAndAuthorityMs=performance.now()-start;
const boundExpressions=new Map<string,Set<string>>();for(const b of world.registry.bindings){const ids=boundExpressions.get(b.senseId)??new Set<string>();ids.add(b.expressionId);boundExpressions.set(b.senseId,ids);}
const edges=[...boundExpressions.values()].reduce((n,ids)=>n+ids.size*(ids.size-1)/2,0);
report.fixture={meanings:world.meanings.length,acceptedMeanings:world.meanings.filter((m:any)=>m.personalMeaning.status==='active'&&m.alignments.some((a:any)=>a.status==='active')&&(m.focusAcceptances.length||m.semanticAcceptances.length)).length,contexts:world.contexts.anchors.length,senses:world.registry.senses.length,expressions:world.registry.expressions.length,bindings:world.registry.bindings.length,graphEdges:edges,languages:Object.fromEntries([...new Set(world.registry.expressions.map((x:any)=>x.languageTag))].map(language=>[String(language),world.registry.expressions.filter((x:any)=>x.languageTag===language).length])),construction:'Formal Intake/Clarification/ConfirmExpressionBinding seed: 5 accepted Meanings, 6 distinct Expressions, one shared-Sense graph edge, no manually reconnected IDs. Expanded with existing identity mapper, all Sense keys unique and original expression/spec text preserved, complete PSW authority validation. Context text only, no image/audio. No learning enrollment implied.'};
assert.equal(report.fixture.acceptedMeanings,size);assert.equal(report.fixture.expressions,size*6/5);assert.equal(edges,size/5);
await save();console.log(JSON.stringify({stage:'full_world_authority_passed',ms:report.preparation.worldGenerateAndAuthorityMs,...report.fixture}));
if(batchOutput){
 // Same normalized records as repository.indexState; bounded fixture transport
 // reuses the existing 64-row digest-verifying browser copy helper unchanged.
 const begun=performance.now(),batches:any[]=[],tableCounts:Record<string,number>={};let totalBytes=0,maxBatchBytes=0;
 const contextRows=new Map<string,any>();for(const kind of ['anchors','anchorRevisions'] as const)for(const value of world.contexts[kind]){const row={kind,value,...(kind==='anchorRevisions'?{parentRevisionId:world.contexts.anchorRevisionParents[value.personalSemanticAnchorRevisionId]}:{})};contextRows.set(contextKey(kind,contextRecordId(row as any)),row);}
 async function emit(table:string,chunk:any[]){
  const bytes=Buffer.from(JSON.stringify(encodeBackupValue(chunk)));
  if(bytes.length>1048576&&chunk.length>1){const mid=Math.floor(chunk.length/2);await emit(table,chunk.slice(0,mid));await emit(table,chunk.slice(mid));return;}
  assert.ok(chunk.length<=64&&bytes.length<=1048576,'Fixture record exceeds bounded transport');
  const offset=tableCounts[table]??0,file=`${table}-${String(offset).padStart(6,'0')}.json`;
  await writeFile(join(directory,file),bytes,{flag:'wx'});const persisted=await readFile(join(directory,file));assert.equal(sha(persisted),sha(bytes));assert.deepEqual(decodeBackupValue(JSON.parse(persisted.toString('utf8'))),chunk);
  tableCounts[table]=offset+chunk.length;totalBytes+=bytes.length;maxBatchBytes=Math.max(maxBatchBytes,bytes.length);batches.push({table,file,rowCount:chunk.length,bytes:bytes.length,sha256:sha(bytes)});
 }
 async function table(table:string,rows:Iterable<any>){let chunk:any[]=[];for(const row of rows){chunk.push(row);if(chunk.length===64){await emit(table,chunk);chunk=[];}}if(chunk.length)await emit(table,chunk);console.log(JSON.stringify({stage:'world_table_batched',table,rows:tableCounts[table]??0,bytesSoFar:totalBytes}));}
 await table('semanticState',[{key:'root',value:{version:world.version}}]);
 await table('semanticMeanings',(function*(){for(const m of world.meanings){const value=storeMeaningContexts(m);assert.deepEqual(hydrateMeaningContexts(value,key=>contextRows.get(key)),m);yield {key:m.personalMeaning.personalMeaningId,value};}})());
 await table('semanticContexts',(function*(){for(const [key,value]of contextRows)yield {key,value};})());
 const registryIds:Record<string,string>={senses:'senseId',senseVersions:'senseVersionId',expressions:'expressionId',expressionVersions:'expressionVersionId',bindings:'senseExpressionBindingId',bindingVersions:'bindingVersionId'};
 await table('semanticRegistry',(function*(){for(const [kind,id]of Object.entries(registryIds))for(let ordinal=0;ordinal<world.registry[kind].length;ordinal++){const value=world.registry[kind][ordinal];yield {key:`${kind}:${value[id]}`,value:{kind,ordinal,value}};}})());
 for(const [name,values,key]of [['semanticInbox',world.inboxItems,'intakeId'],['semanticDrafts',world.clarificationDrafts,'intakeId'],['semanticReceipts',world.commandReceipts,'operationId']] as const)await table(name,(function*(){for(const value of values)yield {key:value[key],value};})());
 assert.equal(tableCounts.semanticMeanings,size);assert.equal(tableCounts.semanticContexts,world.contexts.anchors.length+world.contexts.anchorRevisions.length);assert.equal(tableCounts.semanticRegistry,Object.values(world.registry).reduce((n:number,rows:any)=>n+rows.length,0));assert.equal(tableCounts.semanticReceipts,world.commandReceipts.length);
 report.fixture.bytes=totalBytes;report.fixture.sha256=sha(JSON.stringify(batches));report.fixture.hashScope='Ordered digest manifest of all normalized fact batches, not whole-world JSON';report.preparation.worldBatchWriteAndVerifyMs=performance.now()-begun;
 worldBatchManifest={format:'sensa-daily-world-batches-v1',size,fixture:report.fixture,authority:'Complete original JourneyState validated before record serialization; every stored Meaning hydrated exactly, every persisted batch digest/count/value roundtrip verified.',batchLimit:{rows:64,bytes:1048576},maxBatchBytes,tableCounts,batches};
 report.fixtureSource=join(directory,'world-batches.json');await writeFile(report.fixtureSource,JSON.stringify(worldBatchManifest,null,2),{flag:'wx'});
 console.log(JSON.stringify({stage:'world_batches_verified',ms:report.preparation.worldBatchWriteAndVerifyMs,tableCounts,batches:batches.length,bytes:totalBytes,maxBatchBytes}));
}else{worldBytes=JSON.stringify(world);if(!opt('world-fixture'))await writeFile(join(directory,'world-fixture.json'),worldBytes,{flag:'wx'});report.fixtureSource=opt('world-fixture')?resolve(opt('world-fixture')):join(directory,'world-fixture.json');report.fixture.bytes=Buffer.byteLength(worldBytes);report.fixture.sha256=sha(worldBytes);}
}else{
 report.fixtureSource=resolve(batchInput);if(!report.fixtureSource.startsWith(resolve('output/playwright')+'/'))throw Error('Use retained isolated evidence batch manifest');
 worldBatchManifest=JSON.parse(await readFile(report.fixtureSource,'utf8'));assert.equal(worldBatchManifest.format,'sensa-daily-world-batches-v1');assert.equal(worldBatchManifest.size,size);report.fixture=worldBatchManifest.fixture;
 assert.equal(report.fixture.acceptedMeanings,size);assert.equal(report.fixture.expressions,size*6/5);assert.equal(report.fixture.graphEdges,size/5);assert.equal(sha(JSON.stringify(worldBatchManifest.batches)),report.fixture.sha256);
 const sums:Record<string,number>={};for(const b of worldBatchManifest.batches){assert.ok(/^\w+-\d+\.json$/u.test(b.file)&&b.rowCount>0&&b.rowCount<=64&&b.bytes<=1048576);sums[b.table]=(sums[b.table]??0)+b.rowCount;}assert.deepEqual(sums,worldBatchManifest.tableCounts);report.preparation.worldManifestReadMs=performance.now()-start;
}
await save();console.log(JSON.stringify({stage:'world_validated',...report.fixture}));
if(process.argv.includes('--generate-only')){report.status='fixture-ready';await save();process.exit(0);}
const retentionRoot=resolve(opt('retention'));
if(!retentionRoot.startsWith(resolve('.tmp')+'/retention-capacity-facts-'))throw Error('Use isolated verified retention fixture');
const retention=JSON.parse(await readFile(join(retentionRoot,'manifest.json'),'utf8'));
const dateOffsetMs=Date.parse(retention.clock)-(await stat(join(retentionRoot,'manifest.json'))).mtimeMs;report.clock={mode:'Date-only constant offset; time advances at native rate, native performance/timers/rAF unchanged',dateOffsetMs};
if(retention.targets!==1000)throw Error('This bounded journey requires exactly 1k separately counted formal Targets');
report.history={directory:retentionRoot,manifestSha256:sha(await readFile(join(retentionRoot,'manifest.json'))),targets:retention.targets,runs:retention.runs,events:retention.events,bytes:retention.bytes,clock:retention.clock,reviewCycles:retention.reviewCycles,source:'Retained exact formal command fixture; independent current full replay verification required before invocation. Target count is separate from Personal Meaning count.'};
const rebuildResume=process.argv.includes('--rebuild-resume');if(rebuildResume&&!resume)throw Error('Rebuild requires the retained isolated profile');
const buildReuse=resume??(opt('build-from')?JSON.parse(await readFile(resolve(opt('build-from')),'utf8')):null);
if(buildReuse&&(!buildReuse.buildRoot?.startsWith(resolve('.tmp')+'/daily-ui-build-')||new URL(buildReuse.origin).hostname!=='127.0.0.1'||Number(new URL(buildReuse.origin).port)===3000||buildReuse.commit!==report.commit&&!rebuildResume))throw Error('Only reuse the same production revision isolated build/origin');
const buildRoot=(rebuildResume?undefined:buildReuse?.buildRoot)??await mkdtemp(resolve('.tmp/daily-ui-build-')),dist=join(buildRoot,'dist');
const storeAssets=(await readdir(join(dist,'assets')).catch(()=>[])).filter(name=>/^store-.*\.js$/u.test(name));
if(finishBatchCopy&&(!resume||!worldBatchManifest||storeAssets.length!==1))throw Error('Finish only the exact retained failed batch setup with its unchanged build');
if(finishBatchCopy)report.preparation.batchCopyModule={file:storeAssets[0],sha256:sha(await readFile(join(dist,'assets',storeAssets[0]!))),scope:'Existing production Vite module namespaces; no code transform or runtime override'};
const batchFiles=new Map<string,string>();for(const b of retention.batches)batchFiles.set(b.file,join(retentionRoot,b.file));
if(worldBatchManifest)for(const b of worldBatchManifest.batches){if(batchFiles.has(b.file))throw Error('Duplicate fixture filename');batchFiles.set(b.file,join(resolve(report.fixtureSource,'..'),b.file));}
const copyManifest=worldBatchManifest?{...retention,batches:[...retention.batches,...worldBatchManifest.batches],source:'Exact verified current formal history plus full authority-validated Personal World normalized batches'}:retention;
let origin='';const mime:Record<string,string>={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'};
const registry={format:'sensa-learning-content-registry-v3',publishedAt:'2026-10-05T00:00:00Z',items:[]};
const server=createServer(async(req,res)=>{try{const url=new URL(req.url??'/',origin||'http://127.0.0.1');const json=(body:any,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
 if(url.pathname==='/__world'&&!worldBatchManifest){res.writeHead(200,{'content-type':'application/json'});res.end(worldBytes);return;}
 if(url.pathname==='/__capacity_fixture/manifest.json'){json(copyManifest);return;}
 if(url.pathname.startsWith('/__capacity_fixture/')){const file=batchFiles.get(basename(url.pathname));if(!file)throw Error('Unknown fixture batch');res.writeHead(200,{'content-type':'application/json'});res.end(await readFile(file));return;}
 if(url.pathname==='/sensa/packages'){json({...registry,revision:sha(JSON.stringify(registry))});return;}
 if(url.pathname.startsWith('/sensa/')||url.pathname.startsWith('/auth/')){json({code:'authentication_required'},401);return;}
 const file=extname(url.pathname)?resolve(dist,'.'+url.pathname):join(dist,'index.html');if(!file.startsWith(dist+'/')){json({},404);return;}
 res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream','cache-control':'no-store'});res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}});
server.listen(buildReuse?Number(new URL(buildReuse.origin).port):0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${(server.address() as any).port}`;
start=performance.now();if(!buildReuse||rebuildResume)execFileSync('npm',['run','build','-w','@sensa/web','--','--outDir',dist,'--emptyOutDir'],{env:{...process.env,VITE_SENSA_MODE:'production',VITE_SENSA_BROWSER_SMOKE:'true',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-key',VITE_SENSA_API_URL:origin},stdio:'pipe'});
report.buildReusedFrom=opt('build-from')||null;
report.preparation.productionBuildMs=performance.now()-start;report.origin=origin;
if(resume&&(resume.fixture.sha256!==report.fixture.sha256||resume.history.manifestSha256!==report.history.manifestSha256||resume.commit!==report.commit&&!rebuildResume))throw Error('Retained fixture/production revision differs');
const profile=resume?.isolatedProfile??await mkdtemp(resolve('.tmp/daily-ui-profile-'));report.isolatedProfile=profile;report.buildRoot=buildRoot;report.resumedFrom=opt('resume')||null;
let context=await chromium.launchPersistentContext(profile,{headless:!process.argv.includes('--headed'),viewport:{width:1280,height:900},locale:'zh-CN',executablePath:process.env.SENSA_CHROMIUM_PATH});
 let page=context.pages()[0]!;const browserInfo=await context.newCDPSession(page);report.browserVersion=(await browserInfo.send('Browser.getVersion')).product;await browserInfo.detach();
let profiler:any=null;
const init=async()=>{await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await context.addInitScript((dateOffsetMs:number)=>{(window as any).__name=(value:any)=>value;const NativeDate=Date;class ShiftedDate extends NativeDate{constructor(...args:any[]){super(0);return Reflect.construct(NativeDate,args.length?args:[NativeDate.now()+dateOffsetMs],new.target);}static now(){return NativeDate.now()+dateOffsetMs;}static [Symbol.hasInstance](value:unknown){return value instanceof NativeDate;}}Object.assign(globalThis,{Date:ShiftedDate});(window as any).__name=(value:any)=>value;(window as any).__daily={input:null,longTasks:[],frames:[]};for(const type of ['pointerdown','pointermove','keydown','input','change','wheel'])document.addEventListener(type,event=>{const d=(window as any).__daily,target=event.target as Element;if(!d.armed||d.input!==null||!event.isTrusted||type!==d.expected.type)return;const button=target.closest('button');const valid=d.expected.kind==='button'?!!button&&new RegExp(d.expected.text).test(button.getAttribute('aria-label')??button.textContent??''):d.expected.kind==='search'?target.matches('input[aria-label="搜索场景、意思或表达"]'):d.expected.kind==='canvas'?!!target.closest('[data-cy-surface]'):!!target.closest('.sensa-world.active');if(valid)d.input={at:performance.now(),type,trusted:event.isTrusted,target:button?.getAttribute('aria-label')??button?.textContent??target.tagName};},true);new PerformanceObserver(list=>(window as any).__daily.longTasks.push(...list.getEntries().map(x=>({startTime:x.startTime,duration:x.duration})))).observe({type:'longtask',buffered:true});},dateOffsetMs);};
await init();
async function measure(name:string,action:()=>Promise<unknown>,ready:()=>Promise<unknown>){const labels:Record<string,string>={'world-list-open':'我的语义世界','language-filter-fr':'fr','language-filter-all':'全部语言','world-detail-open':'borrow-','local-context-save':'保存场景','detail-return-preserved-search':'返回我的语义世界','home-warm-return':'今日','graph-open':'语义世界','graph-zoom':'放大|缩小','graph-return-list':'列表','review-first-question':'开始 / 继续复习','review-reveal':'查看表达','review-rating-to-next':'想起但费力','statistics-heatmap-open':'学习统计','statistics-range-all':'全部可用记录','statistics-range-week':'最近 7 天'};const expected=name==='search-correct-result'||name==='language-filter-combined-search'?{type:'input',kind:'search'}:name==='world-list-scroll-end'?{type:'wheel',kind:'world'}:name==='graph-canvas-select-with-context'?{type:'pointerdown',kind:'canvas'}:name==='graph-hover'?{type:'pointermove',kind:'canvas'}:{type:'pointerdown',kind:'button',text:labels[name]};if(expected.kind==='button'&&!expected.text)throw Error('Missing expected input target: '+name);await page.evaluate(expected=>{const d=(window as any).__daily;d.input=null;d.expected=expected;d.armed=true;},expected);const driverStart=performance.now();await action();await ready();const end=await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const d=(window as any).__daily;d.armed=false;return {at:performance.now(),input:d.input,stages:performance.getEntriesByType('measure').filter(x=>d.input&&x.startTime>=d.input.at).map(x=>({name:x.name,startMs:x.startTime-d.input.at,durationMs:x.duration})),longTasks:d.longTasks.filter((x:any)=>d.input&&x.startTime>=d.input.at)};});if(!end.input)throw Error('Missing trusted expected input: '+name);const row={name,elapsedMs:end.at-end.input.at,inputType:end.input.type,trusted:end.input.trusted,inputTarget:end.input.target,stages:end.stages,longTasks:end.longTasks,driverEnvelopeMs:performance.now()-driverStart};report.phases.push(row);await save();console.log(JSON.stringify({stage:'sample',...row}));return row;}
const nav=()=>page.getByRole('navigation',{name:'主要导航',exact:true});const worldUI=()=>page.locator('.sensa-world.active').last();const home=()=>page.locator('#s-home');
const rows=()=>worldUI().locator('.sensa-world-row');const search=()=>worldUI().getByRole('textbox',{name:'搜索场景、意思或表达',exact:true});const detail=()=>page.locator('#s-personal-meaning');
try{
 start=performance.now();await page.goto(origin);await page.waitForFunction(()=>!!(window as any).__sensaBrowserSmoke);
 if(finishBatchCopy){
  report.preparation.copyStartedAt=new Date().toISOString();await save();page.on('console',message=>{if(message.text().startsWith('__daily-batch|'))console.log(message.text());});
  report.preparation.copyResult=await page.evaluate(async({moduleUrl,manifest,history})=>{
   const exports=Object.values(await import(moduleUrl)) as any[],store=exports.find(value=>value?.restoreLibraryTransaction&&value?.libraryTables),codec=exports.find(value=>value?.encodeBackupValue&&value?.decodeBackupValue),adapterModule=exports.find(value=>value?.sqliteRecordAdapter);
   if(!store||!codec||!adapterModule)throw Error('Unchanged production module namespaces unavailable');const adapter=await adapterModule.sqliteRecordAdapter();
   return store.restoreLibraryTransaction(async(tx:any)=>{
    if(await tx.get('meta','service-owner'))throw Error('Batch setup requires the retained isolated guest');
    const before:any={};for(const table of ['semanticState','semanticMeanings','semanticContexts','semanticRegistry','semanticReceipts','learningTargets','learningRuns','learningEvents'])before[table]=await tx.count(table);
    if(before.semanticState!==1||before.semanticMeanings||before.semanticContexts||before.semanticRegistry||before.semanticReceipts||before.learningTargets!==history.targets||before.learningRuns!==history.runs||before.learningEvents!==history.events)throw Error('Failed setup differs from the observed empty-World/full-history continuation boundary');
    console.info('__daily-batch|continuation-before|'+JSON.stringify(before));const copied:Record<string,number>={};let verified=0;
    // Normalized heads require their immutable revisions; Meaning summaries
    // require Context and Registry closure at each ordinary adapter commit.
    // No schema/index override: only the frozen fixture admission order changes.
    const phases=[['semanticContexts','anchorRevisions'],['semanticContexts','anchors'],['semanticRegistry',null],['semanticReceipts',null],['semanticMeanings',null]] as const;
    for(const [table,kind]of phases){for(const b of manifest.batches.filter((b:any)=>b.table===table&&(!kind||(kind==='anchors'?Number(b.file.match(/-(\d+)\.json$/)[1])<manifest.fixture.contexts:Number(b.file.match(/-(\d+)\.json$/)[1])+b.rowCount>manifest.fixture.contexts)))){
     const response=await fetch('/__capacity_fixture/'+b.file);if(!response.ok)throw Error('Missing retained batch');const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==b.bytes||bytes.length>1048576)throw Error('Batch byte limit mismatch');
     const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(digest!==b.sha256)throw Error('Batch digest mismatch');const rows=codec.decodeBackupValue(JSON.parse(new TextDecoder().decode(bytes)));if(!Array.isArray(rows)||rows.length!==b.rowCount||rows.length>64)throw Error('Batch count mismatch');
     const selected=kind?rows.filter((row:any)=>row.value.kind===kind):rows;await adapter.commit({clears:[],deletes:[],puts:selected.map((row:any)=>({table,key:row.key,encodedValue:JSON.stringify(codec.encodeBackupValue(row.value))}))});copied[table]=(copied[table]??0)+selected.length;verified++;
     if(verified%500===0)console.info('__daily-batch|progress|'+JSON.stringify({verified,table,copied}));
    }console.info('__daily-batch|phase|'+JSON.stringify({table,kind,copied:copied[table]}));}
    const after:any={};for(const table of Object.keys(manifest.tableCounts)){after[table]=await tx.count(table);if(after[table]!==manifest.tableCounts[table])throw Error('Final semantic table count mismatch');if(table!=='semanticState'&&copied[table]!==manifest.tableCounts[table])throw Error('Copied semantic row count mismatch');}
    const counts={targets:await tx.count('learningTargets'),runs:await tx.count('learningRuns'),events:await tx.count('learningEvents')};if(counts.targets!==history.targets||counts.runs!==history.runs||counts.events!==history.events)throw Error('Formal history changed during fixture admission');tx.put('meta','local-incarnation',crypto.randomUUID());return {before,after,copied,verifiedBatchReads:verified,history:counts,scope:'Continuation of one failed fixture setup; exact same batches, dependency order only'};
   });
  },{moduleUrl:`${origin}/assets/${storeAssets[0]}`,manifest:worldBatchManifest,history:retention});
 }else if(!resume){report.preparation.copyStartedAt=new Date().toISOString();await save();report.preparation.copyResult=await page.evaluate(()=> (window as any).__sensaBrowserSmoke.copyVerifiedLearningCapacityForTest('/__capacity_fixture/manifest.json'));}
 const welcome=page.getByRole('button',{name:'进入 Sensa',exact:true}).first();if(await welcome.isVisible())await welcome.click();await expect(nav()).toBeVisible();
 if(!resume&&!worldBatchManifest)await page.evaluate(async()=> (window as any).__sensaBrowserSmoke.seedSemanticWorld(await(await fetch('/__world')).json()));
 report.preparation.fixtureCopyMs=performance.now()-start;await save();console.log(JSON.stringify({stage:'isolated_fixture_copied',ms:report.preparation.fixtureCopyMs}));
 // Reload preparation first, so cold browser measurement excludes fixture setup.
 await nav().getByRole('button',{name:'今日',exact:true}).click();await expect(home().getByRole('button',{name:'继续学习',exact:true})).toBeEnabled({timeout:60000});
 await context.close();context=await chromium.launchPersistentContext(profile,{headless:!process.argv.includes('--headed'),viewport:{width:1280,height:900},locale:'zh-CN',executablePath:process.env.SENSA_CHROMIUM_PATH});page=context.pages()[0]!;await init();
 const coldStart=performance.now();await page.goto(origin);const enter=page.getByRole('button',{name:'进入 Sensa',exact:true}).first();if(await enter.isVisible())await enter.click();await expect(home().getByRole('button',{name:'继续学习',exact:true})).toBeEnabled({timeout:60000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));report.phases.push({name:'browser-cold-local-home',elapsedMs:performance.now()-coldStart,navigationStart:true,sampleCount:1});await save();
 report.nativeTimingProbe=await page.evaluate(async()=>{performance.mark('daily-native-start');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));performance.mark('daily-native-end');performance.measure('daily-native-probe','daily-native-start','daily-native-end');const entry=performance.getEntriesByName('daily-native-probe').at(-1);let renderer:string|null=null;const gl=document.createElement('canvas').getContext('webgl');if(gl){const extension=gl.getExtension('WEBGL_debug_renderer_info');if(extension)renderer=gl.getParameter(extension.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();}return {entryCount:performance.getEntriesByName('daily-native-probe').length,durationMs:entry?.duration,renderer,clock:new Date().toISOString()};});expect(report.nativeTimingProbe.entryCount).toBeGreaterThan(0);
 if(process.argv.includes('--activate-update')){
  report.appUpdates=[];
  for(let attempt=0;attempt<3;attempt++){
   const pending=await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();if(!registration)return false;await registration.update();const worker=registration.installing;if(worker&&worker.state!=='installed'&&worker.state!=='activated'&&worker.state!=='redundant')await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Update installation timeout')),15000);worker.addEventListener('statechange',()=>{if(['installed','activated','redundant'].includes(worker.state)){clearTimeout(timer);resolve();}});});return !!registration.waiting;});
   if(!pending)break;
   const guard=page.locator('[data-sensa-version-guard="update"]');await expect(guard).toBeVisible();await Promise.all([page.waitForEvent('load'),guard.getByRole('button',{name:'立即更新',exact:true}).click()]);await expect(home().getByRole('button',{name:'继续学习',exact:true})).toBeEnabled();report.appUpdates.push({attempt,normalActivation:true});
  }
  await expect(page.locator('[data-sensa-version-guard]')).toHaveCount(0);await save();
 }
 report.status='measuring';report.learningFactsBeforeWorld=await page.evaluate(()=>(window as any).__sensaBrowserSmoke.rawLearningFactsForTest());
 if(process.argv.includes('--verify-save-diagnostic')){
  const expected='Private source: May asked to borrow an umbrella. Measurement edit ui-10k-cpu-diagnostic 0.';
  await nav().getByRole('button',{name:'我的语义世界',exact:true}).click();await expect(rows().first()).toBeVisible();await search().fill('borrow-1');
  await expect(worldUI().locator('[data-world-counts]')).toHaveText('2,000 个表达 · 2,000 个去重意义');await worldUI().getByRole('button',{name:/^borrow-1(?:\s|$)/u}).first().click();
  await expect(detail().getByRole('article',{name:'表达详情'}).getByText(expected,{exact:true})).toBeVisible();report.savedTextRecovery={expected,url:page.url(),afterBrowserProcessRestart:true};
  await page.reload();await expect(detail().getByRole('article',{name:'表达详情'}).getByText(expected,{exact:true})).toBeVisible();report.savedTextRecovery.afterDocumentReload=true;
  await page.screenshot({path:join(directory,'saved-text-recovery.png')});await nav().getByRole('button',{name:'今日',exact:true}).click();await expect(home().getByRole('button',{name:'继续学习',exact:true})).toBeEnabled();
 }
 if(process.argv.includes('--verify-last-save')){
  if(!resume?.savedText?.expected||new URL(resume.savedText.url).origin!==origin)throw Error('Exact retained save required');
  await page.goto(resume.savedText.url);await expect(detail()).toContainText(resume.savedText.expected);await page.reload();await expect(detail()).toContainText(resume.savedText.expected);
  report.savedTextRecovery={...resume.savedText,afterBrowserProcessRestart:true,afterDocumentReload:true};await page.screenshot({path:join(directory,'saved-text-recovery.png')});
  await nav().getByRole('button',{name:'今日',exact:true}).click();await expect(home().getByRole('button',{name:'继续学习',exact:true})).toBeEnabled();
 }
 if(process.argv.includes('--cpu-profile')){report.cpuProfiling=true;profiler=await context.newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
 if(!process.argv.includes('--remaining-only'))for(let i=0;i<samples;i++){
  await measure('world-list-open',()=>nav().getByRole('button',{name:'我的语义世界',exact:true}).click(),()=>expect(rows().first()).toBeVisible({timeout:60000}));
  if(i===0&&await worldUI().locator('.sensa-world-filters > summary').isVisible()){await worldUI().locator('.sensa-world-filters > summary').click();}
  const langs=worldUI().getByRole('group',{name:'表达语言',exact:true});
  await measure('language-filter-fr',()=>langs.getByRole('button',{name:'fr',exact:true}).click(),()=>expect(worldUI().locator('[data-world-counts]')).toHaveText(`${new Intl.NumberFormat('zh-CN').format(size/5)} 个表达 · ${new Intl.NumberFormat('zh-CN').format(size/5)} 个去重意义`));
  await measure('language-filter-all',()=>langs.getByRole('button',{name:'全部语言',exact:true}).click(),()=>expect(worldUI().locator('[data-world-counts]')).toHaveText(`${new Intl.NumberFormat('zh-CN').format(size*6/5)} 个表达 · ${new Intl.NumberFormat('zh-CN').format(size)} 个去重意义`));
  if(scaleProbe){await nav().getByRole('button',{name:'今日',exact:true}).click();await expect(home().getByRole('button',{name:'继续学习',exact:true})).toBeEnabled();continue;}
  const query=`borrow-${i%4+1}`;
  await measure('search-correct-result',async()=>{await search().fill(query);},async()=>{await expect(worldUI().locator('[data-world-counts]')).toHaveText(`${new Intl.NumberFormat('zh-CN').format(size/5)} 个表达 · ${new Intl.NumberFormat('zh-CN').format(size/5)} 个去重意义`);await expect(worldUI().getByRole('button',{name:new RegExp(`^${query}(?:\\s|$)`,'u')}).first()).toBeVisible();});
  await measure('world-detail-open',()=>worldUI().getByRole('button',{name:new RegExp(`^${query}(?:\\s|$)`,'u')}).first().click(),async()=>{await expect(detail().getByRole('heading',{name:query,exact:true})).toBeVisible();await expect(detail().getByRole('button',{name:'编辑场景',exact:true})).toBeVisible();await expect(detail().getByRole('button',{name:'编辑场景',exact:true})).toBeEnabled();});
  if(!report.saveReadinessErrors?.length){await detail().getByRole('button',{name:'编辑场景',exact:true}).click();const editor=page.locator('.pmw-screen.active form');const text=`Private source: May asked to borrow an umbrella. Measurement edit ${basename(directory)} ${i}.`;await editor.getByRole('textbox',{name:'场景',exact:true}).fill(text);
  try{await measure('local-context-save',()=>editor.getByRole('button',{name:'保存场景',exact:true}).click(),async()=>{await expect(editor).toHaveCount(0);await expect(detail()).toContainText(text);});report.savedText={expected:text,url:page.url()};}
  catch(error){report.saveReadinessErrors??=[];report.saveReadinessErrors.push({sample:i,error:String(error),url:page.url(),expected:text,visibleText:await detail().innerText()});await page.evaluate(()=>{(window as any).__daily.armed=false;});await save();console.log(JSON.stringify({stage:'save_readiness_failure',sample:i}));if(i===0)await page.screenshot({path:join(directory,'save-readiness-failure.png')});}}
  await measure('detail-return-preserved-search',()=>page.getByRole('button',{name:'返回我的语义世界',exact:true}).click(),async()=>{await expect(search()).toHaveValue(query);await expect(rows().first()).toBeVisible();});
  await search().fill('');await expect(worldUI().locator('[data-world-counts]')).toContainText(`${new Intl.NumberFormat('zh-CN').format(size)} 个去重意义`);
  const scrollBox=(await worldUI().boundingBox())!;await page.mouse.move(scrollBox.x+scrollBox.width/2,scrollBox.y+scrollBox.height/2);
  await measure('world-list-scroll-end',()=>page.mouse.wheel(0,10000000),()=>expect(worldUI().locator(`[role="listitem"][aria-posinset="${size}"] .sensa-world-row`)).toBeVisible());
  await worldUI().evaluate(el=>{el.scrollTop=0;});
  await measure('home-warm-return',()=>nav().getByRole('button',{name:'今日',exact:true}).click(),()=>expect(home().getByRole('button',{name:'继续学习',exact:true})).toBeEnabled());
 }
 if(process.argv.includes('--language-combination')){
  await nav().getByRole('button',{name:'我的语义世界',exact:true}).click();await expect(rows().first()).toBeVisible();
  const filters=worldUI().locator('.sensa-world-filters');if(!await filters.evaluate(el=>el.hasAttribute('open')))await filters.locator('summary').click();
  const langs=worldUI().getByRole('group',{name:'表达语言',exact:true});await langs.getByRole('button',{name:'fr',exact:true}).click();
  await measure('language-filter-combined-search',()=>search().fill('May'),()=>expect(worldUI().locator('[data-world-counts]')).toHaveText('2,000 个表达 · 2,000 个去重意义'));
  report.combinedLanguageSearch={query:'May',languages:['fr'],meaningCount:2000,expressionCount:2000};await search().fill('');await langs.getByRole('button',{name:'全部语言',exact:true}).click();await expect(worldUI().locator('[data-world-counts]')).toHaveText('12,000 个表达 · 10,000 个去重意义');
  await nav().getByRole('button',{name:'今日',exact:true}).click();await expect(home().getByRole('button',{name:'继续学习',exact:true})).toBeEnabled();
 }
 if(profiler){const result=await profiler.send('Profiler.stop');await writeFile(join(directory,'world-diagnostic.cpuprofile'),JSON.stringify(result.profile));await profiler.detach();profiler=null;}
 await page.screenshot({path:join(directory,'home.png')});
 report.learningFactsAfterWorld=await page.evaluate(()=>(window as any).__sensaBrowserSmoke.rawLearningFactsForTest());expect(report.learningFactsAfterWorld).toEqual(report.learningFactsBeforeWorld);
 if(!process.argv.includes('--world-only')){
 await nav().getByRole('button',{name:'我的语义世界',exact:true}).click();await expect(rows().first()).toBeVisible();
 if(!process.argv.includes('--skip-graph'))for(let i=0;i<(scaleProbe?1:3);i++){
  await measure('graph-open',()=>worldUI().getByRole('button',{name:'语义世界',exact:true}).click(),async()=>{const g=worldUI().getByRole('region',{name:'词义图谱',exact:true});await expect(g.locator('[data-graph-node-count]')).toHaveAttribute('data-graph-node-count',String(size*6/5),{timeout:60000});await expect(g.locator('[data-graph-ready="true"]')).toBeVisible();await expect(g.locator('[data-graph-edge-count]')).toHaveAttribute('data-graph-edge-count',String(size/5));});
  const inventory=await worldUI().getByRole('region',{name:'词义图谱',exact:true}).evaluate(el=>({nodes:Number(el.querySelector('[data-graph-node-count]')!.getAttribute('data-graph-node-count')),edges:Number(el.querySelector('[data-graph-edge-count]')!.getAttribute('data-graph-edge-count')),facts:[...el.querySelectorAll('[data-relation-facts]')].reduce((n,node)=>n+JSON.parse(node.getAttribute('data-relation-facts')!).length,0)}));assert.deepEqual(inventory,{nodes:12000,edges:2000,facts:4000});report.graphInventories??=[];report.graphInventories.push(inventory);
  const graph=worldUI().getByRole('region',{name:'词义图谱',exact:true}),points=graph.locator('[data-expression-id]'),canvas=graph.locator('[data-graph-camera]');await graph.getByRole('button',{name:'显示全部',exact:true}).click();
  // Keyboard locates an actual visible node; selection below is a real canvas click.
  await points.first().focus();await points.first().press('Home');await points.first().press('Enter');const preview=graph.getByRole('complementary',{name:'表达预览',exact:true});await expect(preview.getByRole('button',{name:'查看详情',exact:true})).toBeEnabled();await preview.getByRole('button',{name:'关闭',exact:true}).click();
  // Closing restores keyboard focus on the next native frame; settle that
  // camera change before capturing actual renderer coordinates for the mouse.
  await expect(points.first()).toBeFocused();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await points.first().evaluate(el=>(el as HTMLElement).blur());
  const surface=(await graph.locator('[data-cy-surface]').boundingBox())!,pos=JSON.parse((await points.first().getAttribute('data-graph-position'))!);
  report.graphPointerSetup??=[];report.graphPointerSetup.push({surface,pos});await save();
  const clickedId=await points.first().getAttribute('data-expression-id'),clickedLabel=await points.first().innerText();await page.mouse.move(surface.x+pos.x,surface.y+pos.y);
  for(let h=0;h<(scaleProbe?3:10);h++){await page.mouse.move(surface.x+2,surface.y+surface.height-2);await expect(graph.locator('[data-graph-preview]')).toHaveCount(0);await measure('graph-hover',()=>page.mouse.move(surface.x+pos.x,surface.y+pos.y),()=>expect(graph.locator('[data-graph-preview]')).toContainText(clickedLabel));}
  await measure('graph-canvas-select-with-context',()=>page.mouse.click(surface.x+pos.x,surface.y+pos.y),async()=>{await expect(graph.locator(`[data-expression-id="${clickedId}"]`)).toHaveAttribute('aria-pressed','true');await expect(preview.getByRole('heading',{name:clickedLabel,exact:true})).toBeVisible();await expect(preview.getByRole('button',{name:'查看详情',exact:true})).toBeEnabled();await expect(preview).toContainText('Private source');});
  await page.screenshot({path:join(directory,`graph-${i}.png`)});
  for(let z=0;z<(scaleProbe?3:10);z++){const before=await canvas.getAttribute('data-graph-camera');await measure('graph-zoom',()=>graph.getByRole('button',{name:z%2?'缩小':'放大',exact:true}).click(),()=>expect(canvas).not.toHaveAttribute('data-graph-camera',before!));}
  if(!scaleProbe){
  const box=(await canvas.boundingBox())!;await page.evaluate(()=>{const d=(window as any).__daily;d.frames=[];d.collectFrames=true;let prior=performance.now();const tick=(at:number)=>{d.frames.push(at-prior);prior=at;if(d.collectFrames)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  const dragBefore=await canvas.getAttribute('data-graph-camera');await page.mouse.move(box.x+box.width-20,box.y+box.height-40);await page.mouse.down();for(let n=0;n<120;n++)await page.mouse.move(box.x+box.width-20-(n%60)*2,box.y+box.height-40-(n%30),{steps:1});await page.mouse.up();await expect(canvas).not.toHaveAttribute('data-graph-camera',dragBefore!);const frames=await page.evaluate(()=>{(window as any).__daily.collectFrames=false;return (window as any).__daily.frames;});report.phases.push({name:'graph-continuous-drag-frames',frameIntervalsMs:frames,frameObservations:frames.length,operationSamples:1,scope:'rAF scheduling cadence during actual pan; not canvas-render FPS',cameraBefore:JSON.parse(dragBefore!),cameraAfter:JSON.parse((await canvas.getAttribute('data-graph-camera'))!)});await save();
  }
  if(i===2&&process.argv.includes('--verify-resize')){
   if(await preview.isVisible())await preview.getByRole('button',{name:'关闭',exact:true}).click();
   report.resizeChecks=[];
   for(const width of [390,1280]){await page.setViewportSize({width,height:900});await expect(canvas).toHaveAttribute('data-graph-node-count','12000');await expect(canvas).toHaveAttribute('data-graph-edge-count','2000');await expect(graph.locator('[data-expression-id]').first()).toHaveAttribute('data-graph-position',/.+/);await graph.getByRole('button',{name:'显示全部',exact:true}).click();await points.first().focus();await points.first().press('Home');await points.first().press('Enter');const selectedPreview=width<768?page.getByRole('dialog',{name:/^表达预览(?:\s|$)/u}):preview;await expect(selectedPreview.getByRole('button',{name:'查看详情',exact:true})).toBeEnabled();report.resizeChecks.push({width,nodes:12000,edges:2000,selection:true});await selectedPreview.getByRole('button',{name:'关闭',exact:true}).first().click();}
  }
  await measure('graph-return-list',()=>worldUI().getByRole('button',{name:'列表',exact:true}).click(),()=>expect(rows().first()).toBeVisible());
 }
 report.learningFactsAfterWorld=await page.evaluate(()=>(window as any).__sensaBrowserSmoke.rawLearningFactsForTest());expect(report.learningFactsAfterWorld).toEqual(report.learningFactsBeforeWorld);
 if(!scaleProbe&&!process.argv.includes('--graph-only')){
 await nav().getByRole('button',{name:'我的学习',exact:true}).click();await page.locator('#s-study').getByRole('button',{name:'学习偏好',exact:true}).click();const prefs=page.getByRole('dialog',{name:'学习偏好',exact:true});await prefs.getByRole('combobox',{name:'每日新学数量',exact:true}).selectOption('20');await prefs.getByRole('button',{name:'完成',exact:true}).click();
 await page.evaluate(id=>(window as any).__sensaBrowserSmoke.navigate(`/study/learning-target?targetId=${encodeURIComponent(id)}`),retention.probeTargetId);
 const runtime=page.locator('#s-lightweight-runtime');await measure('review-first-question',()=>page.locator('#s-learning-target').getByRole('button',{name:'开始 / 继续复习',exact:true}).click(),()=>expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled({timeout:60000}));
 report.reviewBefore=await page.evaluate(id=>(window as any).__sensaBrowserSmoke.learningCapacityCheckpointForTest(id),retention.probeTargetId);
 for(let i=0;i<samples;i++){await measure('review-reveal',()=>runtime.getByRole('button',{name:/查看表达/}).click(),()=>expect(runtime.getByRole('button',{name:/想起但费力/})).toBeEnabled());await measure('review-rating-to-next',()=>runtime.getByRole('button',{name:/想起但费力/}).click(),()=>expect(runtime.getByRole('button',{name:/查看表达/})).toBeEnabled({timeout:60000}));}
 report.reviewAfter=await page.evaluate(id=>(window as any).__sensaBrowserSmoke.learningCapacityCheckpointForTest(id),retention.probeTargetId);expect(report.reviewAfter.events).toBe(report.reviewBefore.events+samples*2);expect(report.reviewAfter.activeTargetId).not.toBe(report.reviewBefore.activeTargetId);
 await page.screenshot({path:join(directory,'review.png')});await runtime.getByRole('button',{name:'暂停',exact:true}).click();
 for(let i=0;i<samples;i++){await nav().getByRole('button',{name:'我的学习',exact:true}).click();await measure('statistics-heatmap-open',()=>page.locator('#s-study').getByRole('button',{name:'学习统计',exact:true}).click(),async()=>{await expect(page.locator('#s-stats .sensa-stat-calendar')).toBeVisible();await expect(page.locator('#s-stats .sensa-activity-summary')).toContainText(`${new Intl.NumberFormat('zh-CN').format(retention.targets*2+samples)} 条`);});if(i===0)await page.screenshot({path:join(directory,'statistics.png')});const stats=page.locator('#s-stats');const options=stats.locator('summary').filter({hasText:'筛选与全部记录'});if(!(await options.evaluate(el=>el.parentElement!.hasAttribute('open'))))await options.click();const all=stats.getByRole('button',{name:'全部可用记录',exact:true});await measure('statistics-range-all',()=>all.click(),()=>expect(stats.getByRole('status').filter({hasText:`${new Intl.NumberFormat('zh-CN').format(retention.targets*2+samples)} 条`})).toBeVisible());await stats.getByRole('button',{name:'年度',exact:true}).click();}
 }
 }
 report.status=report.saveReadinessErrors?.length?'completed-with-save-readiness-failure':'completed';
}catch(error){report.status=report.resourceFailure?'resource-failure':'failed';report.error=String(error);if(!page.isClosed()){await page.screenshot({path:join(directory,'failure.png')}).catch(()=>{});report.errorSurface=await page.locator('body').innerText().catch(()=>null);}console.error(report.error);process.exitCode=1;}
finally{if(!page.isClosed())report.longTasks=await page.evaluate(()=>(window as any).__daily.longTasks).catch(()=>[]);report.completedAt=new Date().toISOString();const grouped:Record<string,number[]>={};for(const p of report.phases)if(typeof p.elapsedMs==='number')(grouped[p.name]??=[]).push(p.elapsedMs);report.summary=Object.fromEntries(Object.entries(grouped).map(([name,values])=>{values.sort((a,b)=>a-b);return [name,{n:values.length,p50Ms:values[Math.ceil(values.length*.5)-1],p95Ms:values.length>=30?values[Math.ceil(values.length*.95)-1]:null,maxMs:values.at(-1),minMs:values[0]}];}));await save();await context.close().catch(()=>{});await new Promise<void>(r=>server.close(()=>r()));}
