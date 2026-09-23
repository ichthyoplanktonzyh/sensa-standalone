/**
 * Paid, real-provider browser acceptance for every Target × Support Route.
 * Set SENSA_LIVE_ACCEPTANCE=1 only from the isolated live acceptance runner.
 */
import {expect, test, type Page} from '@playwright/test';
import {mkdir, rename, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Locator} from '@playwright/test';
import type {AgentTraceEvent} from '../../../apps/web/src/observability/agentTrace';
import {languageMatrixCases, type LanguageMatrixCase} from './languageMatrixFixtures';

const enabled = process.env.SENSA_LIVE_ACCEPTANCE === '1';
const webUrl = process.env.SENSA_LIVE_WEB_URL;
const serviceUrl = process.env.SENSA_LIVE_SERVICE_URL;
const reportDirectory = process.env.SENSA_LIVE_REPORT_DIR;

test.skip(!enabled, 'Paid live matrix is opt-in through the isolated acceptance runner.');
test.setTimeout(15 * 60 * 1000);
test.use({locale: 'en-US'});

function caseKey({targetLanguageTag, supportLanguageTag}: LanguageMatrixCase): string {
  return `web-${targetLanguageTag}--${supportLanguageTag}`;
}

type StageName = 'session'|'route'|'clarification_acceptance'|'enrollment_resources'|'dictionary_runtime'|'refresh_persistence';
type StageRecord = {status:'running'|'passed'|'failed';startedAt:string;durationMs?:number;error?:string;evidence?:StageEvidence};
type ObservedRequest = {method:string;origin:string;path:string;status?:number;durationMs?:number};
type ObservedSocket = {origin:string;path:string;receivedFrames:number;receivedBytes:number};
type StageEvidence = {httpRequests:number;successfulHttpResponses:number;modelRequests:number;successfulModelResponses:number;referenceRequests:number;successfulReferenceResponses:number;edgeTtsSockets:number;edgeAudioBytes:number};
type CaseReport = {
  schemaVersion:1;caseKey:string;targetLanguageTag:string;supportLanguageTag:string;
  startedAt:string;finishedAt?:string;durationMs?:number;status:'running'|'passed'|'failed';
  sessionStatus?:number;stages:Partial<Record<StageName,StageRecord>>;requests:ObservedRequest[];websockets:ObservedSocket[];agentEvents:AgentTraceEvent[];dictionaryResult?:{languageTag:string;hasGloss:boolean};failure?:string;
};

const requestedFilter = process.env.SENSA_LIVE_CASE_FILTER?.split(',').map(value=>value.trim()).filter(Boolean);
const requestedLimit = process.env.SENSA_LIVE_CASE_LIMIT;
if (requestedLimit !== undefined && (!/^\d+$/u.test(requestedLimit) || Number(requestedLimit) < 1)) {
  throw new Error('SENSA_LIVE_CASE_LIMIT must be a positive integer.');
}
const unknownFilters = (requestedFilter ?? []).filter(key=>!languageMatrixCases.some(item=>caseKey(item)===`web-${key}`));
if (unknownFilters.length) throw new Error(`Unknown live matrix case filter(s): ${unknownFilters.join(', ')}.`);
const selectedCases = languageMatrixCases
  .filter(item=>!requestedFilter?.length || requestedFilter.includes(`${item.targetLanguageTag}--${item.supportLanguageTag}`))
  .slice(0, requestedLimit === undefined ? undefined : Number(requestedLimit));

if (enabled && selectedCases.length === 0) throw new Error('Live language matrix selected no cases.');
if (enabled && !reportDirectory) throw new Error('SENSA_LIVE_REPORT_DIR is required for a live run.');

async function selectRoute(page: Page, item: LanguageMatrixCase): Promise<void> {
  await page.getByRole('button', {name: 'Account & settings'}).click();
  await page.locator('#settings-preferences').click();
  await page.locator('#account-languages').click();

  const targetSelect = page.getByLabel('Choose a target language');
  const supportSelect = page.getByLabel('Choose a support language');
  const targetOption=await targetSelect.locator(`option[value="${item.targetLanguageTag}"]`).textContent();
  const targetEndonym=targetOption?.split('·')[0]?.trim()??item.targetLanguageTag;
  const routeCards=page.getByRole('radiogroup',{name:'Learning routes'}).locator('article');
  let selectedRoute:Locator|undefined;
  for(let index=0;index<await routeCards.count();index+=1){
    const routeArticle=routeCards.nth(index);
    const radio=routeArticle.getByRole('radio');
    const supportValue=await routeArticle.locator('select').inputValue();
    const routeLabel=await radio.innerText();
    if(supportValue===item.supportLanguageTag&&routeLabel.includes(targetEndonym)){selectedRoute=radio;break;}
  }
  if(!selectedRoute){
    await targetSelect.selectOption(item.targetLanguageTag);
    await supportSelect.selectOption(item.supportLanguageTag);
    await page.getByRole('button', {name: 'Add route', exact: true}).click();
    selectedRoute=routeCards.last().getByRole('radio');
  }
  await expect(selectedRoute).toBeVisible();
  await expect(selectedRoute).toContainText(targetEndonym);
  if(await selectedRoute.getAttribute('aria-checked')!=='true')await selectedRoute.click();
  await expect(selectedRoute).toHaveAttribute('aria-checked', 'true');
  const supportValue=await selectedRoute.locator('xpath=ancestor::article').locator('select').inputValue();
  expect(supportValue).toBe(item.supportLanguageTag);
  await page.getByRole('button', {name: 'Done', exact: true}).click();
}

async function openPersonalConversation(page: Page): Promise<void> {
  await page.locator('[data-sensa-shell-navigation-item]').filter({hasText: 'My semantic world'}).click();
  await expect(page.locator('#s-content')).toBeVisible();
  await page.getByRole('button', {name: 'Talk to Sensa', exact: true}).click();
  await expect(page.locator('#s-personal-meaning')).toBeVisible();
}

async function clarifyAndAccept(page: Page, item: LanguageMatrixCase): Promise<void> {
  const fixture=item.fixture;
  const input = page.getByLabel('What would you like to express?');
  const context = `${fixture.sentence}\n\n${item.supportFixture.context}`;
  await input.fill(context);
  await page.getByRole('button', {name: 'Send', exact: true}).click();

  const candidate = page.getByRole('region', {name: 'Expression to save'});
  // The target sentence and the human-authored context are the initial user
  // evidence. If the real model asks a clarification, provide only the
  // fixture's human-authored sense baseline, never a generated translation.
  for (let turn = 0; turn < 2; turn += 1) {
    const candidateVisible = await candidate.isVisible({timeout: 180_000}).catch(() => false);
    if (candidateVisible) break;
    const followUp = page.getByLabel('What would you like to express?');
    await expect(followUp).toBeVisible();
    await followUp.fill(item.supportFixture.clarification);
    await page.getByRole('button', {name: 'Send', exact: true}).click();
  }

  await expect(candidate).toBeVisible({timeout: 180_000});
  await expect(candidate.getByRole('heading', {name: fixture.expression, exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Save this expression', exact: true}).click();
  await expect(page.getByText('Meaning confirmed', {exact: true})).toBeVisible({timeout: 60_000});
  await expect(page.getByText('Saved locally.', {exact: true})).toBeVisible();
}

async function enrollAndPrepare(page: Page, fixture: LanguageMatrixCase['fixture']): Promise<void> {
  const preparation = page.getByRole('region', {name: 'Personal learning preparation'});
  await expect(preparation).toBeVisible();
  const sourceConsent = preparation.getByRole('checkbox');
  if (!(await sourceConsent.isChecked())) await sourceConsent.check();
  await preparation.getByRole('button', {name: 'Add to learning', exact: true}).click();

  await expect(preparation.getByRole('button', {name: 'Start / continue learning', exact: true}))
    .toBeVisible({timeout: 12 * 60 * 1000});
  await expect(preparation.getByText(fixture.expression, {exact: true})).toBeVisible();

  const resources = preparation.getByText('View learning resources', {exact: true});
  await resources.click();
  const audio = preparation.locator('audio[src]');
  await expect(audio.first()).toBeAttached();
  const audioResult = await audio.first().evaluate(async element => {
    const response = await fetch((element as HTMLAudioElement).src);
    const bytes = await response.arrayBuffer();
    return {ok: response.ok, byteLength: bytes.byteLength};
  });
  expect(audioResult.ok, 'real Edge TTS audio URL should resolve').toBe(true);
  expect(audioResult.byteLength, 'synthesized audio should contain bytes').toBeGreaterThan(100);
}

async function inspectRuntimeAndDictionary(page: Page, fixture: LanguageMatrixCase['fixture'], item: LanguageMatrixCase, report:CaseReport): Promise<void> {
  const preparation = page.getByRole('region', {name: 'Personal learning preparation'});
  await preparation.getByRole('button', {name: 'Start / continue learning', exact: true}).click();
  const confirmStart = page.getByRole('button', {name: 'Confirm quantity and start', exact: true});
  if (await confirmStart.isVisible().catch(() => false)) await confirmStart.click();

  const runtime = page.locator('.screen.active');
  await expect(runtime).toBeVisible({timeout: 60_000});
  const showExpression = page.getByRole('button', {name: 'See the expression', exact: true});
  await expect(showExpression).toBeVisible({timeout: 60_000});
  // Reveal is the first learning interaction and allows a contextual lookup;
  // the test later completes the visible initial rating control normally.
  await showExpression.click();
  const reveal = page.locator('.sensa-expression-reveal');
  await expect(reveal).toBeVisible({timeout: 60_000});
  await expect(reveal.getByRole('heading', {name: fixture.expression, exact: true})).toBeVisible();

  // The token click sends the generated learning example and exact offsets to
  // the real contextual dictionary service. It also verifies the displayed
  // source language on the returned dictionary result.
  const targetToken = reveal.locator('button.tok-target').first();
  await expect(targetToken).toBeVisible();
  await targetToken.click();
  const dictionary = page.locator('#sensa-reference-quick-title');
  await expect(dictionary).toBeVisible({timeout: 120_000});
  await expect(dictionary).toHaveAttribute('lang', item.targetLanguageTag);
  const resultSense = page.locator('[aria-label="Brief meanings"] p[lang]').first();
  await expect(resultSense).toBeVisible();
  await expect(resultSense).toHaveAttribute('lang', item.supportLanguageTag);
  report.dictionaryResult={languageTag:(await resultSense.getAttribute('lang'))??'',hasGloss:Boolean((await resultSense.textContent())?.trim())};
  const dictionaryCalls=report.requests.filter(request=>isReferenceRequest(request.origin,request.path)&&request.status!==undefined&&request.status>=200&&request.status<400);
  expect(dictionaryCalls.length,'dictionary lookup must reach a real reference source').toBeGreaterThan(0);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await reveal.getByRole('group',{name:'How connected does this feel?'}).getByRole('button',{name:'Connected',exact:true}).click();
  // The response above is a genuine user-visible completion action on this
  // synthetic account; no database rows or learning outcome are seeded by test code.
  await expect(page.getByText('Initial learning complete',{exact:true})).toBeVisible({timeout:60_000});
}

async function refreshAndInspectPersistence(page: Page, fixture: LanguageMatrixCase['fixture']): Promise<void> {
  await page.reload({waitUntil: 'domcontentloaded'});
  await expect(page.locator('[data-sensa-shell-navigation]')).toBeVisible({timeout: 60_000});
  await page.getByRole('button',{name:'Account & settings'}).click();
  await page.locator('#settings-preferences').click();
  await page.locator('#account-languages').click();
  const activeRoute=page.getByRole('radio',{checked:true});
  await expect(activeRoute).toBeVisible();
  await expect(activeRoute.locator('xpath=ancestor::article').locator('select')).toHaveValue(fixture.expectedLabels.supportLanguageTag);
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.locator('[data-sensa-shell-navigation-item]').filter({hasText:'Learning'}).click();
  await page.getByRole('button', {name:'View content',exact:true}).click();
  const library=page.locator('#s-learning-library');
  const targetRow=library.getByRole('button').filter({has:page.getByText(fixture.expression,{exact:true})}).first();
  await expect(targetRow).toBeVisible({timeout:60_000});
  await expect(targetRow).toContainText('Initial learning completed');
  await targetRow.click();
  await expect(page.locator('#s-learning-target')).toBeVisible();
  await expect(page.locator('#s-learning-target').getByText(fixture.expression,{exact:true})).toBeVisible();
  await expect(page.locator('#s-learning-target').getByText('View learning resources',{exact:true})).toBeVisible();
  await page.locator('#s-learning-target').getByText('View learning resources',{exact:true}).click();
  const persistedAudio=page.locator('#s-learning-target audio[src]').first();
  await expect(persistedAudio).toBeAttached();
  const persistedAudioBytes=await persistedAudio.evaluate(async element=>(await (await fetch((element as HTMLAudioElement).src)).arrayBuffer()).byteLength);
  expect(persistedAudioBytes,'audio resource remains readable after refresh').toBeGreaterThan(100);
}

function isModelRequest(origin:string,path:string):boolean {
  return path.endsWith('/chat/completions')||path.includes('/sensa/model/turn');
}
function safePath(path:string):string {
  return path.split('/').map(segment=>/^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(segment)?':id':segment).join('/');
}
function isReferenceRequest(origin:string,path:string):boolean {
  const host=new URL(origin).hostname;
  return ['api.wiktapi.dev','api.dictionaryapi.dev','en.wiktionary.org'].includes(host)
    ||path.includes('/sensa/reference');
}
function safeFailure(error:unknown):string {
  if (!(error instanceof Error)) return 'unknown_failure';
  if (/timeout|timed out/iu.test(error.name+' '+error.message)) return 'timeout';
  if (/trace must include|business trace id|Genkit trace\/tokens/iu.test(error.message)) return 'agent_observation_incomplete';
  if (/network|fetch failed|ECONN/iu.test(error.message)) return 'network_failure';
  if (/expect|locator|assertion/iu.test(error.name+' '+error.message)) return 'ui_assertion_failed';
  return 'case_failed';
}
async function collectAgentEvents(page:Page,report:CaseReport):Promise<void>{
  const events=await page.evaluate(()=>{
    const surface=globalThis as typeof globalThis&{__sensaLiveAgentTraceEvents?:AgentTraceEvent[]};
    const captured=surface.__sensaLiveAgentTraceEvents??[];
    surface.__sensaLiveAgentTraceEvents=[];
    return captured;
  });
  const allowlisted=(event:AgentTraceEvent):AgentTraceEvent=>({
    version:event.version,businessTraceId:event.businessTraceId,agentRunId:event.agentRunId,agent:event.agent,event:event.event,
    occurredAt:event.occurredAt,elapsedMs:event.elapsedMs,round:event.round,targetLanguageTag:event.targetLanguageTag,
    ...(event.durationMs!==undefined?{durationMs:event.durationMs}:{}),
    supportLanguageTag:event.supportLanguageTag,promptVersion:event.promptVersion,
    ...(event.status?{status:event.status}:{}),...(event.reason?{reason:event.reason}:{}),...(event.tool?{tool:event.tool}:{}),
    ...(typeof event.accepted==='boolean'?{accepted:event.accepted}:{}),...(event.issueCount!==undefined?{issueCount:event.issueCount}:{}),
    ...(event.providerKind?{providerKind:event.providerKind}:{}),...(event.execution?{execution:event.execution}:{}),
    ...(event.model?{model:event.model}:{}),...(event.modelExecutionId?{modelExecutionId:event.modelExecutionId}:{}),
    ...(event.genkitTraceId?{genkitTraceId:event.genkitTraceId}:{}),...(event.inputTokens!==undefined?{inputTokens:event.inputTokens}:{}),
    ...(event.outputTokens!==undefined?{outputTokens:event.outputTokens}:{}),
  });
  report.agentEvents.push(...events.map(allowlisted));
}
function assertAgentEvents(report:CaseReport):void{
  const businessTraceIds=new Set<string>();
  for(const agent of ['clarification','content_generation'] as const){
    const events=report.agentEvents.filter(event=>event.agent===agent);
    for(const eventName of ['run_started','model_completed','run_finished'] as const){
      expect(events.some(event=>event.event===eventName),`${agent} trace must include ${eventName}`).toBe(true);
    }
    const ids=new Set(events.map(event=>event.businessTraceId));
    expect(ids.size,`${agent} events share one business trace id`).toBe(1);
    for(const id of ids)businessTraceIds.add(id);
    for(const modelEvent of events.filter(event=>event.event==='model_completed')){
      if(modelEvent.genkitTraceId||modelEvent.inputTokens!==undefined||modelEvent.outputTokens!==undefined){
        expect(modelEvent.modelExecutionId,`${agent} Genkit trace/tokens stay correlated to their model event`).toBeTruthy();
      }
    }
  }
  expect(businessTraceIds.size,'clarification and content generation share one business trace id').toBe(1);
}
function stageEvidence(report:CaseReport,startIndex:number,startSocketIndex:number):StageEvidence {
  const requests=report.requests.slice(startIndex),sockets=report.websockets.slice(startSocketIndex);
  return {
    httpRequests:requests.length,
    successfulHttpResponses:requests.filter(request=>request.status!==undefined&&request.status>=200&&request.status<400).length,
    modelRequests:requests.filter(request=>isModelRequest(request.origin,request.path)).length,
    successfulModelResponses:requests.filter(request=>isModelRequest(request.origin,request.path)&&request.status!==undefined&&request.status>=200&&request.status<300).length,
    referenceRequests:requests.filter(request=>isReferenceRequest(request.origin,request.path)).length,
    successfulReferenceResponses:requests.filter(request=>isReferenceRequest(request.origin,request.path)&&request.status!==undefined&&request.status>=200&&request.status<400).length,
    edgeTtsSockets:sockets.filter(socket=>new URL(socket.origin).hostname==='speech.platform.bing.com').length,
    edgeAudioBytes:sockets.filter(socket=>new URL(socket.origin).hostname==='speech.platform.bing.com').reduce((sum,socket)=>sum+socket.receivedBytes,0),
  };
}

async function recordStage<T>(report:CaseReport,name:StageName,work:()=>Promise<T>,checkEvidence?:(evidence:StageEvidence)=>void):Promise<T>{
  const started=Date.now();
  const requestIndex=report.requests.length,socketIndex=report.websockets.length;
  report.stages[name]={status:'running',startedAt:new Date(started).toISOString()};
  await writeCaseReport(report);
  try{
    const value=await work();
    const evidence=stageEvidence(report,requestIndex,socketIndex);
    checkEvidence?.(evidence);
    report.stages[name]={status:'passed',startedAt:new Date(started).toISOString(),durationMs:Date.now()-started,evidence};
    await writeCaseReport(report);
    return value;
  }catch(error){
    report.stages[name]={status:'failed',startedAt:new Date(started).toISOString(),durationMs:Date.now()-started,error:safeFailure(error),evidence:stageEvidence(report,requestIndex,socketIndex)};
    await writeCaseReport(report);
    throw error;
  }
}

async function writeCaseReport(report:CaseReport):Promise<void>{
  if(!reportDirectory)throw new Error('SENSA_LIVE_REPORT_DIR is required; case report was not written.');
  const directory=resolve(reportDirectory);
  await mkdir(directory,{recursive:true});
  const name=`${report.targetLanguageTag}--${report.supportLanguageTag}.json`;
  const destination=resolve(directory,name);
  const temporary=`${destination}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary,`${JSON.stringify(report,null,2)}\n`,{mode:0o600});
  await rename(temporary,destination);
}

test.describe('live personal learning language matrix', () => {
  test.describe.configure({mode:'serial'});
  for (const item of selectedCases) {
    test(`${item.targetLanguageTag} → ${item.supportLanguageTag}`, async ({page}) => {
      // Keep locator failures diagnosable. Resource preparation has its own
      // explicit long timeout below; a route UI selector should not consume
      // the full 15-minute case budget when its scope is wrong.
      page.setDefaultTimeout(30_000);
      const started=Date.now();
      const report:CaseReport={schemaVersion:1,caseKey:caseKey(item),targetLanguageTag:item.targetLanguageTag,supportLanguageTag:item.supportLanguageTag,startedAt:new Date(started).toISOString(),status:'running',stages:{},requests:[],websockets:[],agentEvents:[]};
      const requestStarted=new WeakMap<object,number>();
      const requestRecords=new WeakMap<object,ObservedRequest>();
      page.on('request',request=>{
        requestStarted.set(request,Date.now());
        const url=new URL(request.url());
        const observed:ObservedRequest={method:request.method(),origin:url.origin,path:safePath(url.pathname)};
        report.requests.push(observed);
        requestRecords.set(request,observed);
      });
      page.on('response',response=>{
        const request=response.request();
        const record=requestRecords.get(request);
        if(record){record.status=response.status();record.durationMs=Date.now()-(requestStarted.get(request)??Date.now());}
      });
      page.on('websocket',socket=>{
        const url=new URL(socket.url());
        const observed:ObservedSocket={origin:url.origin,path:safePath(url.pathname),receivedFrames:0,receivedBytes:0};
        report.websockets.push(observed);
        socket.on('framereceived',({payload})=>{
          observed.receivedFrames+=1;
          observed.receivedBytes+=typeof payload==='string'?new TextEncoder().encode(payload).byteLength:payload.byteLength;
        });
      });
      try{
        await recordStage(report,'session',async()=>{
          if(!serviceUrl)throw new Error('SENSA_LIVE_SERVICE_URL is required.');
          const response=await fetch(`${serviceUrl}/__sensa_local/session?case=${encodeURIComponent(caseKey(item))}`);
          report.sessionStatus=response.status;
          if(!response.ok)throw new Error(`Synthetic session setup failed (${response.status}).`);
          const session:unknown=await response.json();
          if(!webUrl)throw new Error('SENSA_LIVE_WEB_URL is required.');
          const webOrigin=new URL(webUrl).origin;
          const authKey=`sb-${new URL(serviceUrl).hostname.split('.')[0]}-auth-token`;
          await page.addInitScript(({origin,key,value})=>{
            if(location.origin!==origin)return;
            localStorage.setItem(key,JSON.stringify(value));
            localStorage.setItem('sensa:local-bootstrap:v1','complete');
            const surface=globalThis as typeof globalThis&{__sensaLiveAgentTraceEvents?:unknown[];__sensaAgentTraceSink?:(event:unknown)=>void};
            surface.__sensaLiveAgentTraceEvents=[];
            surface.__sensaAgentTraceSink=event=>surface.__sensaLiveAgentTraceEvents?.push(event);
          },{origin:webOrigin,key:authKey,value:session});
          await page.goto(webUrl,{waitUntil:'domcontentloaded'});
          await expect(page.locator('[data-sensa-shell-navigation]')).toBeVisible({timeout:60_000});
        });
        await recordStage(report,'route',()=>selectRoute(page,item));
        await recordStage(report,'clarification_acceptance',async()=>{await openPersonalConversation(page);await clarifyAndAccept(page,item);await collectAgentEvents(page,report);},evidence=>{
          expect(evidence.modelRequests,'teacher clarification must call the configured real model').toBeGreaterThan(0);
          expect(evidence.successfulModelResponses,'teacher model call must succeed').toBeGreaterThan(0);
        });
        await recordStage(report,'enrollment_resources',async()=>{await enrollAndPrepare(page,item.fixture);await collectAgentEvents(page,report);assertAgentEvents(report);},evidence=>{
          expect(evidence.modelRequests,'content generation must call the configured real model').toBeGreaterThan(0);
          expect(evidence.successfulModelResponses,'content model call must succeed').toBeGreaterThan(0);
          expect(evidence.edgeTtsSockets,'Edge TTS must open its real WebSocket').toBeGreaterThan(0);
          expect(evidence.edgeAudioBytes,'Edge TTS must return audio frames').toBeGreaterThan(100);
          expect(report.requests.some(request=>request.path==='/sensa/resource-facts'&&request.status!==undefined&&request.status>=200&&request.status<400),'source facts endpoint must return successfully').toBe(true);
        });
        await recordStage(report,'dictionary_runtime',()=>inspectRuntimeAndDictionary(page,item.fixture,item,report),evidence=>{
          expect(evidence.referenceRequests,'contextual dictionary lookup must call a real dictionary source').toBeGreaterThan(0);
          expect(evidence.successfulReferenceResponses,'dictionary source must return a usable response').toBeGreaterThan(0);
        });
        await recordStage(report,'refresh_persistence',()=>refreshAndInspectPersistence(page,item.fixture));
        report.status='passed';
      }catch(error){
        report.status='failed';
        report.failure=safeFailure(error);
        throw error;
      }finally{
        report.finishedAt=new Date().toISOString();
        report.durationMs=Date.now()-started;
        await writeCaseReport(report);
      }
    });
  }
});
