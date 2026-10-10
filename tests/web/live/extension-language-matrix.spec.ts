import {expect, test} from '@playwright/test';
import {chromium, type BrowserContext, type Page, type Request} from '@playwright/test';
import {mkdtemp, mkdir, rm, appendFile, writeFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {sensaLanguages} from '@sensa/contracts/sensa';
import {languageMatrixCases, type LanguageMatrixCase} from './languageMatrixFixtures';
import {extensionPanelButton,extensionPanelUi} from '../support/extensionReadingPanel.mts';

type Stage = {status:'passed'|'failed';durationMs:number;detail?:unknown};
type RunReport = {
  caseKey:string;
  targetLanguageTag:string;
  supportLanguageTag:string;
  startedAt:string;
  durationMs:number;
  status:'passed'|'failed';
  stages:Record<string,Stage>;
  requests:Array<{path:string;metadata:unknown;status?:number}>;
  webAgentTrace:{status:'not-triggered'|'observed';events:Array<Record<string,unknown>>};
  error?:string;
};

const enabled=process.env.SENSA_LIVE_ACCEPTANCE==='1';
const webUrl=process.env.SENSA_LIVE_WEB_URL??'http://127.0.0.1:3000';
const serviceUrl=process.env.SENSA_LIVE_SERVICE_URL??'http://127.0.0.1:4319';
const extensionPath=resolve(process.env.SENSA_LIVE_EXTENSION_PATH??'apps/browser-extension/dist-local');
const reportDirectory=process.env.SENSA_LIVE_REPORT_DIR?resolve(process.env.SENSA_LIVE_REPORT_DIR):'';
const reportPath=reportDirectory?join(reportDirectory,'extension-language-matrix.jsonl'):'';
const requested=process.env.SENSA_LIVE_CASE_FILTER?.split(',').map(value=>value.trim()).filter(Boolean)??[];
const limitValue=Number(process.env.SENSA_LIVE_LIMIT??process.env.SENSA_LIVE_CASE_LIMIT??'0');
const selectedCases=languageMatrixCases.filter(item=>requested.length===0||requested.some(filter=>caseKey(item).includes(filter)))
  .slice(0,Number.isInteger(limitValue)&&limitValue>0?limitValue:undefined);

function caseKey(item:LanguageMatrixCase){return `${item.targetLanguageTag}--${item.supportLanguageTag}`;}
function language(tag:string){const result=sensaLanguages.find(item=>item.tag===tag);if(!result)throw new Error(`Fixture names an unknown language: ${tag}`);return result;}
function duration(start:number){return Math.round(performance.now()-start);}
function errorMessage(error:unknown){return error instanceof Error?error.name:'Unknown error';}
async function stage<T>(report:RunReport,name:string,run:()=>Promise<T>):Promise<T>{
  const start=performance.now();
  try{const detail=await run();report.stages[name]={status:'passed',durationMs:duration(start),...(detail===undefined?{}:{detail})};console.info(`Live ${report.caseKey}: ${name} passed (${duration(start)}ms)`);return detail;}
  catch(error){report.stages[name]={status:'failed',durationMs:duration(start),detail:errorMessage(error)};console.info(`Live ${report.caseKey}: ${name} failed (${duration(start)}ms)`);throw error;}
}
async function optionForPair(popup:Page,item:LanguageMatrixCase){
  const target=language(item.targetLanguageTag),support=language(item.supportLanguageTag);
  const expected=await popup.evaluate(({target,support})=>{
    const names=new Intl.DisplayNames(['zh-CN'],{type:'language'});
    return `${names.of(target)} · ${names.of(support)}辅助`;
  },{target:target.tag,support:support.tag});
  const options=await popup.locator('#language-route option').evaluateAll(nodes=>nodes.map(node=>({value:(node as HTMLOptionElement).value,label:(node as HTMLOptionElement).textContent??''})));
  const match=options.find(option=>option.label===expected);
  if(!match)throw new Error(`Extension did not receive Web route ${expected}; available routes: ${options.map(option=>option.label).join(' | ')}`);
  return match.value;
}
async function expectServiceSuccess(request:Request,status:Map<Request,number>){
  await expect.poll(()=>status.get(request),{timeout:90_000}).toBeDefined();
  expect(status.get(request),'The actual service response must succeed; a terminal error is not retried by waiting').toBe(200);
}
async function closedPanelText(page:Page,className:'explanation'|'assistance'){
  return (await extensionPanelUi(page))?.[className]?.trim()??'';
}

async function openReadingPanel(page:Page,item:LanguageMatrixCase){
  const {sentence,expression}=item.fixture;
  await page.evaluate(({sentence,expression,targetLanguageTag})=>{
    const old=document.querySelector('#sensa-extension-matrix-fixture');old?.remove();
    const article=document.createElement('article');article.id='sensa-extension-matrix-fixture';article.style.cssText='position:relative;margin:32px auto;max-width:720px;padding:24px;background:white;color:#171717;font:20px/1.7 sans-serif';
    const heading=document.createElement('h1');heading.textContent='A small daily routine';
    const context=document.createElement('p');context.textContent='The plants live on the kitchen windowsill.';
    const paragraph=document.createElement('p');paragraph.id='sensa-matrix-sentence';paragraph.lang=targetLanguageTag;paragraph.textContent=sentence;
    const input=document.createElement('textarea');input.id='sensa-matrix-writing';input.setAttribute('aria-label','Write a short note');input.style.cssText='display:block;width:100%;min-height:64px;margin-top:24px';
    article.append(heading,context,paragraph,input);document.body.append(article);
    const start=sentence.indexOf(expression);if(start<0||sentence.indexOf(expression,start+expression.length)>=0)throw new Error('Fixture expression must occur exactly once in its sentence');
    const text=paragraph.firstChild;if(!text)throw new Error('Fixture sentence is empty');
    const range=document.createRange();range.setStart(text,start);range.setEnd(text,start+expression.length);
    const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerType:'mouse'}));
  },{sentence,expression,targetLanguageTag:item.targetLanguageTag});
  await page.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLElement>('[popover]')).some(host=>host.matches(':popover-open')),undefined,{timeout:20_000});
}

async function activateClosedPanelButton(page:Page,label:string){
  await expect.poll(()=>extensionPanelButton(page,label)).toBe(true);
  if(!await extensionPanelButton(page,label,true))throw new Error('The visible reading action changed before clicking');
}

async function selectAgain(page:Page,item:LanguageMatrixCase){
  await page.keyboard.press('Escape');
  await openReadingPanel(page,item);
}

async function createRoute(page:Page,item:LanguageMatrixCase){
  await page.locator('[data-sensa-shell-utility-action]').click();
  await page.locator('#settings-preferences').click();
  await page.locator('#account-languages').click();
  const target=language(item.targetLanguageTag),support=language(item.supportLanguageTag);
  const matchingDefault=item.targetLanguageTag==='en'&&item.supportLanguageTag==='zh-CN';
  if(!matchingDefault){
    if(item.targetLanguageTag==='en'){
      const englishRoute=page.locator('.sensa-language-settings article').filter({hasText:target.endonym}).first();
      const supportSelect=englishRoute.getByLabel('默认辅助语言');
      await supportSelect.selectOption(item.supportLanguageTag);
    }else{
      await page.getByLabel('选择目标语言').selectOption(item.targetLanguageTag);
      await page.getByLabel('选择辅助语言').selectOption(item.supportLanguageTag);
      await page.getByRole('button',{name:'添加路线',exact:true}).click();
      const route=page.getByRole('radio').filter({hasText:target.endonym});
      await expect(route).toHaveCount(1);
      await route.click();
    }
  }
  const active=page.getByRole('radio',{checked:true}).filter({hasText:target.endonym});
  await expect(active).toHaveCount(1);
  await expect(active.locator('..').locator('..').getByLabel('默认辅助语言')).toHaveValue(item.supportLanguageTag);
  await page.getByRole('button',{name:'完成',exact:true}).click();
  return {targetLanguageTag:item.targetLanguageTag,supportLanguageTag:item.supportLanguageTag};
}

async function installSession(context:BrowserContext,session:unknown){
  const origin=new URL(webUrl).origin;
  const authKey=`sb-${new URL(serviceUrl).hostname.split('.')[0]}-auth-token`;
  await context.addInitScript(({origin,key,session})=>{
    if(location.origin!==origin)return;
    localStorage.setItem(key,JSON.stringify(session));
    localStorage.setItem('sensa:local-bootstrap:v1','complete');
  },{origin,key:authKey,session});
  await context.addInitScript(origin=>{
    if(location.origin!==origin)return;
    const surface=window as typeof window&{__sensaAgentTraceEvents?:Array<Record<string,unknown>>;__sensaAgentTraceSink?:(event:Record<string,unknown>)=>void};
    let events:Array<Record<string,unknown>>=[];
    try{events=JSON.parse(sessionStorage.getItem('sensa-live-agent-traces')??'[]') as Array<Record<string,unknown>>;}catch{events=[];}
    surface.__sensaAgentTraceEvents=events;
    surface.__sensaAgentTraceSink=event=>{
      const safe={agent:event.agent,event:event.event,status:event.status,reason:event.reason,tool:event.tool,round:event.round,targetLanguageTag:event.targetLanguageTag,supportLanguageTag:event.supportLanguageTag};
      events.push(safe);surface.__sensaAgentTraceEvents=events;
      try{sessionStorage.setItem('sensa-live-agent-traces',JSON.stringify(events));}catch{/* Trace observation is best-effort only. */}
    };
  },origin);
}

async function runCase(item:LanguageMatrixCase){
  const key=caseKey(item),report:RunReport={caseKey:`extension-${key}`,targetLanguageTag:item.targetLanguageTag,supportLanguageTag:item.supportLanguageTag,startedAt:new Date().toISOString(),durationMs:0,status:'failed',stages:{},requests:[],webAgentTrace:{status:'not-triggered',events:[]}};
  const started=performance.now();let profile='';let context:BrowserContext|undefined;
  const requests:Request[]=[];const responseStatus=new Map<Request,number>();
  try{
    let session:Record<string,unknown>={};
    await stage(report,'synthetic-account',async()=>{
      const response=await fetch(`${serviceUrl}/__sensa_local/session?case=${encodeURIComponent(`extension-${key}`)}`);
      if(!response.ok)throw new Error(`Synthetic session endpoint returned ${response.status}`);
      const value=await response.json() as Record<string,unknown>;
      if(typeof value.access_token!=='string'||typeof value.user!=='object'||value.user===null)throw new Error('Synthetic session response has an unexpected shape');
      session=value;
      return {sessionLoaded:true};
    });
    profile=await mkdtemp(join(tmpdir(),'sensa-extension-matrix-'));
    const extensionManifest=resolve(extensionPath,'manifest.json');
    if(!(await stat(extensionManifest)).isFile())throw new Error(`Built extension manifest not found at ${extensionManifest}`);
    await stage(report,'extension-browser',async()=>{
      context=await chromium.launchPersistentContext(profile,{
        headless:false,
        ...(process.env.SENSA_CHROMIUM_PATH?{executablePath:process.env.SENSA_CHROMIUM_PATH}:{}),
        locale:'zh-CN',viewport:{width:1365,height:900},
        args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`],
      });
      return {extensionLoaded:true};
    });
    if(!context)throw new Error('Persistent extension browser context failed to start');
    context.on('request',request=>{
      const url=new URL(request.url());
      if(url.origin===serviceUrl&&/^\/sensa\/(?:reading|semantic\/lookups)/u.test(url.pathname))requests.push(request);
    });
    context.on('response',response=>{if(requests.includes(response.request()))responseStatus.set(response.request(),response.status());});
    await installSession(context,session);
    const serviceWorker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:30_000});
    const extensionId=new URL(serviceWorker.url()).host;
    if(process.env.SENSA_LIVE_EXTENSION_ORIGIN&&`chrome-extension://${extensionId}`!==process.env.SENSA_LIVE_EXTENSION_ORIGIN)throw new Error('Loaded extension does not match the exact local API origin grant');
    const page=context.pages()[0]??await context.newPage();
    await stage(report,'web-login-and-route',async()=>{
      await page.goto(webUrl,{waitUntil:'domcontentloaded',timeout:60_000});
      await page.waitForSelector('[data-sensa-shell-navigation-item]',{timeout:60_000});
      await createRoute(page,item);
      await expect.poll(async()=>{
        const popup=await context!.newPage();
        try{await popup.goto(`chrome-extension://${extensionId}/popup.html`);return (await popup.locator('#status').textContent())??'';}
        finally{await popup.close();}
      },{timeout:45_000,intervals:[250,500,1000,2000]}).toMatch(/已登录 Sensa|Signed in to Sensa/u);
      return {route:{targetLanguageTag:item.targetLanguageTag,supportLanguageTag:item.supportLanguageTag}};
    });
    const popup=await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await stage(report,'extension-current-route',async()=>{
      await expect(popup.locator('#status')).toContainText(/已登录 Sensa|Signed in to Sensa/u,{timeout:30_000});
      const routeId=await optionForPair(popup,item);
      await popup.locator('#language-route').selectOption(routeId);
      await expect(popup.locator('#status')).toHaveAttribute('aria-busy','false');
      await expect(popup.locator('#language-route')).toHaveValue(routeId);
      const status=await popup.evaluate(()=>document.querySelector('#status')?.textContent??'');
      if(!/已登录|Signed in/u.test(status))throw new Error(`Extension lost its Web connection: ${status}`);
      return {routeSelected:true,pair:{targetLanguageTag:item.targetLanguageTag,supportLanguageTag:item.supportLanguageTag}};
    });
    await stage(report,'enable-reading-surface',async()=>{
      await page.bringToFront();
      await popup.evaluate(()=>document.querySelector<HTMLButtonElement>('#toggle')?.click());
      await expect(popup.locator('#status')).toContainText(/阅读模式已开启|Reading mode enabled|已开启/u,{timeout:15_000});
      await expect(page.locator('[data-sensa-ui="page"]')).toHaveCount(1,{timeout:20_000});
      return 'Reading surface injected by the installed extension';
    });
    const startingRequestCount=requests.length;
    await openReadingPanel(page,item);
    await stage(report,'read-aloud-device-voice',async()=>{
      const button=page.locator('[data-sensa-ui="page"]').locator('[data-action="speak"]');
      await button.click();
      const speechStatus=page.locator('[data-sensa-ui="page"] [data-sensa-speech]');
      await expect.poll(async()=>((await speechStatus.textContent())??'').trim(),{timeout:10_000}).not.toBe('');
      const outcome=(await speechStatus.textContent())?.trim()??'';
      const started=await button.textContent();
      const speechStarted=/停止朗读|Stop reading aloud/u.test(started??'');
      const unavailable=/没有可用|不支持语音|无法朗读|no installed|no speech|cannot be read aloud/iu.test(outcome);
      const completed=/本页朗读完毕|Finished reading this page aloud/u.test(outcome);
      if(!speechStarted&&!unavailable&&!completed){
        throw new Error(`Device speech neither started nor reported an unavailable voice: ${outcome}`);
      }
      if(speechStarted)await button.click();
      const requestDelta=requests.length-startingRequestCount;
      if(requestDelta!==0)throw new Error(`Local page speech unexpectedly made ${requestDelta} model/dictionary request(s)`);
      return {serviceRequests:requestDelta,deviceSpeechSurface:'whole-page SpeechSynthesis control was used',outcome:speechStarted?'speech-started':unavailable?'local-voice-unavailable':'speech-completed'};
    });
    await openReadingPanel(page,item);
    await stage(report,'reading-explanation-target-to-support',async()=>{
      const before=requests.length;
      await activateClosedPanelButton(page,'句中解释');
      await expect.poll(()=>requests.slice(before).some(request=>new URL(request.url()).pathname==='/sensa/semantic/lookups/stream'),{timeout:90_000,intervals:[250,500,1000,2000]}).toBe(true);
      const request=requests.slice(before).find(value=>new URL(value.url()).pathname==='/sensa/semantic/lookups/stream')!;
      await expectServiceSuccess(request,responseStatus);
      const body=request.postDataJSON() as any;
      if(body.languages?.targetLanguageTag!==item.targetLanguageTag||body.languages?.supportLanguageTag!==item.supportLanguageTag)throw new Error('Explanation used the wrong language route');
      if(body.snapshot?.expression?.text!==item.fixture.expression)throw new Error('Explanation did not receive the selected target-language expression');
      // The background consumes a terminal NDJSON frame and cancels its reader.
      // CDP Response.finished() is not a completion oracle for that SW request.
      // A ready proposal must reach the real content UI, not only a partial.
      await expect.poll(async()=>(await extensionPanelUi(page))?.explanationBusy,{timeout:60_000}).toBe(false);
      expect(await extensionPanelButton(page,'保存到我的语义世界'),'A completed valid proposal must expose explicit acceptance; an error is not a successful explanation').toBe(true);
      const answer=await closedPanelText(page,'explanation');expect(answer).toContain(waterByLanguage[item.supportLanguageTag]);
      return {endpoint:new URL(request.url()).pathname,route:body.languages,expressionReceived:true,visibleProposal:true,answer,httpStatus:responseStatus.get(request)};
    });
    await stage(report,'reading-translation-target-to-support',async()=>{
      const before=requests.length;
      await activateClosedPanelButton(page,'翻译');
      await expect.poll(()=>requests.slice(before).some(request=>new URL(request.url()).pathname==='/sensa/reading/stream'),{timeout:90_000,intervals:[250,500,1000,2000]}).toBe(true);
      const request=requests.slice(before).find(value=>new URL(value.url()).pathname==='/sensa/reading/stream')!;
      await expectServiceSuccess(request,responseStatus);
      const body=request.postDataJSON() as any;
      if(body.feature!=='selection'||body.sourceLanguageTag!==item.targetLanguageTag)throw new Error('Selected expression was not sent as target-language reading');
      if(body.languages?.targetLanguageTag!==item.targetLanguageTag||body.languages?.supportLanguageTag!==item.supportLanguageTag)throw new Error('Reading used the wrong language route');
      await expect.poll(async()=>(await extensionPanelUi(page))?.assistanceBusy,{timeout:90_000}).toBe(false);
      const answer=await closedPanelText(page,'assistance');
      if(!answer.normalize('NFC').toLocaleLowerCase().includes(waterByLanguage[item.supportLanguageTag].normalize('NFC').toLocaleLowerCase()))throw new Error('Completed visible reading result did not contain the expected support-language water term');
      return {endpoint:new URL(request.url()).pathname,feature:body.feature,sourceLanguageTag:body.sourceLanguageTag,route:body.languages,nonEmptyVisibleAnswer:true,answer,httpStatus:responseStatus.get(request)};
    });
    await stage(report,'writing-translation-support-to-target',async()=>{
      const supportSurface=waterByLanguage[item.supportLanguageTag];
      if(!supportSurface)throw new Error(`No human-provided support-language water term for ${item.supportLanguageTag}`);
      const writing=page.locator('#sensa-matrix-writing');
      await writing.fill(supportSurface);
      await writing.focus();
      const before=requests.length;
      await page.keyboard.press('Alt+t');
      const host=page.locator('[data-sensa-ui="writing"]');
      const answer=host.locator('[role="status"]').first();
      await expect.poll(()=>answer.getAttribute('aria-busy'),{timeout:90_000}).toBeNull();
      await expect.poll(()=>requests.slice(before).some(request=>new URL(request.url()).pathname==='/sensa/reading/stream'),{timeout:15_000}).toBe(true);
      const request=requests.slice(before).find(value=>new URL(value.url()).pathname==='/sensa/reading/stream')!;
      await expectServiceSuccess(request,responseStatus);
      const body=request.postDataJSON() as any;
      if(body.feature!=='writing'||body.languages?.targetLanguageTag!==item.targetLanguageTag||body.languages?.supportLanguageTag!==item.supportLanguageTag)throw new Error('Writing used the wrong feature or language route');
      const translated=(await answer.textContent())?.trim()??'';
      if(!translated||translated.includes('provider')||translated.includes('失败'))throw new Error('Writing translation did not produce a usable visible result');
      const targetSurface=item.fixture.expression.normalize('NFC').toLocaleLowerCase();
      if(!translated.normalize('NFC').toLocaleLowerCase().includes(targetSurface))throw new Error('Writing result did not contain the expected target-language water term');
      await expect(writing).toHaveValue(supportSurface);
      await host.getByRole('button',{name:'替换输入框内容',exact:true}).click();await expect(writing).toHaveValue(translated);
      return {endpoint:new URL(request.url()).pathname,feature:body.feature,inputLanguageTag:item.supportLanguageTag,outputLanguageTag:item.targetLanguageTag,route:body.languages,visibleTargetTerm:true,answer:translated,originalPreservedUntilExplicitReplace:true,httpStatus:responseStatus.get(request)};
    });
    await stage(report,'save-capture-through-web-intake',async()=>{
      // The capture remains an explicitly saved, incomplete inbox item. No model
      // result is fabricated and the Web bridge must acknowledge its persistence.
      await selectAgain(page,item);
      await activateClosedPanelButton(page,'保存…');
      await activateClosedPanelButton(page,'保存待处理');
      await page.bringToFront();
      await expect.poll(async()=>{
        await popup.evaluate(()=>document.querySelector<HTMLButtonElement>('#sync')?.click());
        return popup.locator('#recent a').count();
      },{timeout:60_000,intervals:[500,1000,2000,4000]}).toBeGreaterThan(0);
      const recent=popup.locator('#recent a').first();
      await expect(recent).toContainText(item.fixture.expression);
      await expect(popup.locator('#recent-count')).toContainText(/1/u);
      const acknowledgement=await recent.getAttribute('href');
      const receiptUrl=acknowledgement?new URL(acknowledgement):null;
      if(!receiptUrl?.searchParams.has('intake')&&!(receiptUrl?.searchParams.get('worldAction')==='inbox'&&receiptUrl.searchParams.has('meaningId')))throw new Error('Web receipt did not route this incomplete capture to the inbox');
      await page.goto(`${webUrl}/content?worldAction=inbox`,{waitUntil:'domcontentloaded'});
      await expect(page.getByText(item.fixture.expression,{exact:false}).last()).toBeVisible({timeout:30_000});
      const traces=await page.evaluate(()=>((window as any).__sensaAgentTraceEvents??[]) as Array<Record<string,unknown>>);
      if(traces.length)throw new Error('This extension-only flow unexpectedly invoked a Web clarification or content-generation Agent');
      return {delivery:'Web Intake bridge acknowledged and Inbox item is visible in the Web application',visibleInboxItem:true,receiptRoute:'inbox'};
    });
    report.status='passed';
  }catch(error){
    report.error=errorMessage(error);report.status='failed';
    throw error;
  }finally{
    for(const request of requests){
      const path=new URL(request.url()).pathname;
      let metadata:Record<string,unknown>={};
      try{
        const body=request.postDataJSON() as any;
        const snapshot=body?.snapshot;
        metadata={feature:body?.feature??null,sourceLanguageTag:body?.sourceLanguageTag??snapshot?.language??null,targetLanguageTag:body?.languages?.targetLanguageTag??null,supportLanguageTag:body?.languages?.supportLanguageTag??null,hasExpression:Boolean(snapshot?.expression),inputLength:typeof body?.text==='string'?body.text.length:typeof snapshot?.sentence==='string'?snapshot.sentence.length:0,contextLength:typeof body?.context==='string'?body.context.length:0};
      }catch{/* Preserve only the endpoint and response status for malformed bodies. */}
      report.requests.push({path,metadata,status:responseStatus.get(request)});
    }
    if(context){
      const page=context.pages().find(candidate=>new URL(candidate.url()).origin===new URL(webUrl).origin);
      if(page)try{
        const events=await page.evaluate(()=>{
          try{return JSON.parse(sessionStorage.getItem('sensa-live-agent-traces')??'[]') as Array<Record<string,unknown>>;}
          catch{return ((window as any).__sensaAgentTraceEvents??[]) as Array<Record<string,unknown>>;}
        });
        report.webAgentTrace={status:events.length?'observed':'not-triggered',events};
      }catch{/* The Web page may have closed before the diagnostic snapshot. */}
    }
    report.durationMs=duration(started);
    report.stages['total']={status:report.status,durationMs:report.durationMs};
    await context?.close().catch(()=>undefined);
    if(profile)await rm(profile,{recursive:true,force:true}).catch(()=>undefined);
    if(reportPath)await appendFile(reportPath,`${JSON.stringify(report)}\n`,'utf8');
  }
}

// Human-provided lexical data; the live model must translate it. No local model
// generates either side of this writing-direction fixture.
const waterByLanguage:Record<string,string>={
  'zh-CN':'水',en:'water',ja:'水',ko:'물',es:'agua',fr:'eau',de:'Wasser',ru:'вода',it:'acqua',pt:'água',ar:'ماء',hi:'पानी',th:'น้ำ',vi:'nước',id:'air',tr:'su',nl:'water',pl:'woda',
};

test.describe('live browser-extension language-route matrix',()=>{
  test.skip(!enabled,'Set SENSA_LIVE_ACCEPTANCE=1 in the unified live service runner.');
  test.skip(selectedCases.length===0,'The live case filter selected no extension language pairs.');
  test.beforeAll(async()=>{
    if(!reportPath)throw new Error('SENSA_LIVE_REPORT_DIR is required for live extension acceptance');
    await mkdir(reportDirectory,{recursive:true});
    await writeFile(reportPath,'',{encoding:'utf8',flag:'wx'});
  });
  for(const item of selectedCases){
    test.describe(caseKey(item),()=>{test('installed extension completes temporary reading, explicit writing replacement and optional Inbox save',async()=>{
      test.setTimeout(240_000);
      await runCase(item);
    });});
  }
});
