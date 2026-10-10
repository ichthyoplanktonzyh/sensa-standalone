import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {extensionArtifact as compileExtensionArtifact} from '../support/extensionArtifact.mts';
let extensionArtifact:string,artifact:Awaited<ReturnType<typeof compileExtensionArtifact>>;
test.beforeAll(async()=>{artifact=await compileExtensionArtifact();extensionArtifact=artifact.path;});
test.afterAll(async()=>{await artifact?.close();});

test.setTimeout(60_000);
test.use({locale:'zh-CN'});
test('extension popup actions and reading-site controls report their state',async({page})=>{
 await page.route('**/*',route=>route.abort());
 await page.setContent((await readFile(extensionArtifact+'/popup.html','utf8')).replace('<script src="popup.js"></script>',''));
 await page.addScriptTag({content:'window.__name = (value) => value;'});
 await page.evaluate(()=>{
  const route={id:'fixture-route',revision:1,targetLanguageTag:'en',defaultSupportLanguageTag:'zh-CN',status:'active'};
  const fixture={calls:[] as {kind:string;enabled?:boolean}[],finish:null as null|((value:unknown)=>void),status:(value:Record<string,unknown>)=>({value:{destination:'web-local',rule:null,language:{collection:{routes:[route]},context:{languageRouteId:route.id,languageRouteRevision:route.revision,targetLanguageTag:route.targetLanguageTag,supportLanguageTag:route.defaultSupportLanguageTag}},...value}})};
  Object.assign(window,{fixture,chrome:{runtime:{sendMessage:(message:{kind:string})=>{
   fixture.calls.push(message);
   if(message.kind==='open-web')return Promise.resolve({value:{}});
   return new Promise(resolve=>{fixture.finish=resolve;});
  }}}});
 });
 await page.addScriptTag({path:resolve(extensionArtifact,'popup.js')});
 const status=page.getByRole('status');
 const complete=async(error?:string,account=true)=>page.evaluate(({error,account})=>{
  const fixture=(window as any).fixture;fixture.finish(error?{error}:fixture.status({accountId:account?'fixture-account':null,pending:0,errors:[],recent:[]}));
 },{error,account});
 await expect(status).toHaveText('正在检查本机状态…');await expect(page.locator('#login')).toBeDisabled();
 await complete();await expect(status).toContainText('已登录 Sensa');
 await expect(page.locator('#language-route')).toHaveValue('fixture-route');await expect(page.locator('#language-route')).toHaveAttribute('aria-label','当前阅读路线');
 await expect(page.getByRole('heading',{name:'最近保存'})).toBeVisible();
 await expect(page.locator('#recent-empty')).toHaveText('暂无最近保存的内容。');
 await page.locator('summary').click();
 for(const [kind,waiting,done] of [
  ['login','请在 Sensa 页面登录','请在 Sensa 页面登录'],
  ['toggle','正在开启','阅读模式已开启'],
  ['stop','正在关闭','阅读模式已关闭'],
  ['sync','正在检查保存','已检查保存结果'],
  ['disconnect','正在断开','原账号材料已保留'],
 ]){
  await page.locator('#'+kind).click();await expect(status).toContainText(waiting);
  await expect(status).toHaveAttribute('aria-busy','true');
  for(const id of ['login','toggle','stop','sync','disconnect'])await expect(page.locator('#'+id)).toBeDisabled();
  const count=await page.evaluate(()=>(window as any).fixture.calls.length);
  await page.locator('#'+kind).evaluate((button:HTMLButtonElement)=>button.click());
  expect(await page.evaluate(()=>(window as any).fixture.calls.length)).toBe(count);
  await complete(undefined,kind!=='disconnect');await expect(status).toContainText(done);
  await expect(status).toHaveAttribute('aria-busy','false');await expect(page.locator('#'+kind)).toBeEnabled();
 }
 await page.locator('#toggle').click();await complete('unsupported_page');
 await expect(status).toContainText('此页面不支持采集');await expect(page.locator('#toggle')).toBeEnabled();
 await page.locator('#login').click();await complete('authorization_cancelled');
 await expect(status).toContainText('登录已取消');await expect(page.locator('#login')).toHaveText('登录 Sensa');
 await page.setViewportSize({width:352,height:600});
 await page.locator('#sync').click();
 await page.evaluate(()=>{
  const fixture=(window as any).fixture;fixture.finish(fixture.status({accountId:'fixture-account',pending:0,errors:[],recent:Array.from({length:20},(_,i)=>({id:'fixture-'+i,status:'saved',snapshot:{expression:{text:i===0?'a very long expression '.repeat(20):'expression '+i}}}))}));
 });
 await expect(page.locator('#recent a')).toHaveCount(20);
 await expect(page.locator('#recent-count')).toHaveText('20 条');
 await expect(page.locator('#recent-empty')).toBeHidden();
 const geometry=await page.locator('#recent').evaluate(element=>({height:element.clientHeight,content:element.scrollHeight,width:element.clientWidth,contentWidth:element.scrollWidth}));
 expect(geometry.height).toBeLessThanOrEqual(128);expect(geometry.content).toBeGreaterThan(geometry.height);
 expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.width);
 await page.locator('#recent').focus();await page.keyboard.press('End');
 await expect.poll(()=>page.locator('#recent').evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
 await expect(page.locator('#recent a').last()).toHaveAttribute('href',/meaningId=fixture-19$/);
 await page.locator('#recent a').last().click();
 expect(await page.evaluate(()=>(window as any).fixture.calls.at(-1))).toEqual({kind:'open-web',path:'/content?worldAction=inbox&meaningId=fixture-19'});
 await page.screenshot({path:'/tmp/sensa-recent-many.png',fullPage:true});
 await page.locator('#disconnect').click();await complete(undefined,false);
 await expect(page.locator('#recent a')).toHaveCount(0);await expect(page.locator('#recent-count')).toHaveText('0 条');
 await expect(page.locator('#recent-empty')).toHaveText('暂无最近保存的内容。');
 await page.evaluate(()=>Object.defineProperty(navigator,'language',{value:'en',configurable:true}));
 await page.locator('#sync').click();await complete(undefined,false);await expect(status).toContainText('Using locally');await expect(page.locator('#recent-empty')).toHaveText('No recently saved content.');
 // The switch that has to be reachable from a page the learner turned reading off
 // for: hidden where there is no site, and it states the rule in force in the
 // learner's language while its click applies the other one. Lifting a rule also
 // re-reads the status, so the switch's own answer and that read both complete.
 await expect(page.locator('#site')).toBeHidden();
 await page.locator('#sync').click();
 await page.evaluate(()=>{const fixture=(window as any).fixture;fixture.finish(fixture.status({accountId:null,pending:0,errors:[],recent:[],rule:{site:'example.com',disabled:false}}));});
 await expect(page.locator('#site')).toBeVisible();
 await expect(page.locator('#site')).toHaveText('Turn reading off on this site');
 await page.locator('#site').click();
 const switched=await page.evaluate(()=>(window as any).fixture.calls.at(-1));
 expect(switched.kind).toBe('reading-site');
 expect(switched.enabled).toBe(false);
 await page.evaluate(()=>{(window as any).fixture.finish({value:{site:'example.com',disabled:true,disabledSites:['example.com']}});});
 await page.waitForTimeout(50);
 await page.evaluate(()=>{const fixture=(window as any).fixture;fixture.finish(fixture.status({accountId:null,pending:0,errors:[],recent:[],rule:{site:'example.com',disabled:true}}));});
 await expect(page.locator('#site')).toHaveText('Turn reading back on here');
 await expect(status).toContainText('Reading is off on example.com.');
 await expect(page.locator('#site')).toBeEnabled();
 await page.locator('#site').click();
 expect((await page.evaluate(()=>(window as any).fixture.calls.at(-1))).enabled).toBe(true);
});
