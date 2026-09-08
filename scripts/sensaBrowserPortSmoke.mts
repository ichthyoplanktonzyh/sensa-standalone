import {chromium,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {readYoutubePlayer} from '../apps/browser-extension/src/youtubePlayer.ts';
import {captureSnapshotSchema} from '@sensa/contracts/sensa';
const browser=await chromium.launch({executablePath:process.env.SENSA_CHROMIUM_PATH});
const cues={events:[{tStartMs:12500,dDurationMs:1000,segs:[{utf8:'She took'}]},{tStartMs:13500,dDurationMs:2000,segs:[{utf8:'her time.'}]},{tStartMs:18000,dDurationMs:4000,segs:[{utf8:'They looked up at the sky.'}]}]};
let captionRequest:URL|null=null,emptyCaptions=false;
try{
 const page=await browser.newPage({viewport:{width:1200,height:850}});
 await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/timedtext'){captionRequest=url;return emptyCaptions?route.fulfill({body:''}):route.fulfill({json:cues});}
   if(url.pathname==='/watch')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Video fixture</title><div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video></div><p id="text">She took her time.</p><button id="outside">Outside</button>'});
   if(url.pathname==='/article')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Article fixture</title><main style="margin:60px;font:22px system-ui"><p id="paragraph">She <a href="#example">took</a> her time.</p><p contenteditable="true">Do not translate editable text.</p></main>'});
   return route.abort();
 });
 async function install(){
   await page.addScriptTag({content:'window.__name=value=>value; window.readPlayer='+readYoutubePlayer.toString()+';'});
   await page.evaluate(()=>{
     const fixture={calls:[] as any[],pending:null as any,delay:false,receive:null as any,clicks:0};
     Object.assign(window,{fixture,chrome:{runtime:{onMessage:{addListener:(handler:any)=>fixture.receive=handler},sendMessage:async(message:any)=>{
       fixture.calls.push(message);
       if(message.kind==='youtube-captions')return {value:await (window as any).readPlayer(message.videoId)};
       if(message.kind==='reading-run'){if(fixture.delay)return new Promise(resolve=>{fixture.pending=resolve;});return {value:{status:'ready',text:'她不慌不忙地做事。'}};}
       return {value:{savedLocally:true}};
     }}}});
     document.querySelector('#paragraph a')?.addEventListener('click',e=>{e.preventDefault();fixture.clicks++;});
   });
   await page.addScriptTag({path:resolve('apps/browser-extension/dist/content.js')});
   await page.evaluate(()=>(window as any).fixture.receive({kind:'reading',enabled:true,accountId:'fixture-account'}));
 }
 await page.goto('https://example.com/article');await install();
 await page.getByRole('button',{name:'翻译页面',exact:true}).click();
 await expect(page.locator('[data-sensa-ui="translation"]')).toHaveText('她不慌不忙地做事。');
 expect(await page.evaluate(()=>(window as any).fixture.calls.length)).toBe(1);
 await page.getByRole('button',{name:'仅译文',exact:true}).click();await expect(page.locator('#paragraph')).toBeHidden();
 await page.getByRole('button',{name:'恢复原文',exact:true}).click();await expect(page.locator('#paragraph')).toBeVisible();await page.locator('#paragraph a').click();expect(await page.evaluate(()=>(window as any).fixture.clicks)).toBe(1);
 await page.getByRole('button',{name:'翻译页面',exact:true}).click();await expect(page.locator('[data-sensa-ui="translation"]')).toHaveText('她不慌不忙地做事。');expect(await page.evaluate(()=>(window as any).fixture.calls.length)).toBe(1);await page.getByRole('button',{name:'恢复原文',exact:true}).click();
 await page.evaluate(()=>{(window as any).fixture.delay=true;document.querySelector('#paragraph')!.firstChild!.textContent='He ';});await page.getByRole('button',{name:'翻译页面',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!(window as any).fixture.pending)).toBe(true);await page.getByRole('button',{name:'恢复原文',exact:true}).click();
 await page.evaluate(()=>(window as any).fixture.pending({value:{status:'ready',text:'迟到译文'}}));await expect(page.locator('[data-sensa-ui="translation"]')).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(page.locator('[data-sensa-ui]')).toHaveCount(0);
 await page.waitForTimeout(600);await expect(page.locator('[data-sensa-ui]')).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await expect(page.getByRole('button',{name:'翻译页面',exact:true})).toBeVisible();
 await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
 await page.evaluate(()=>{
   const player=document.querySelector('#movie_player') as any;
   player.getPlayerResponse=()=>({videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en',vssId:'.en',baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&signature=selected-track'}]}}});
   player.getAudioTrack=()=>({captionTracks:[{vssId:'.ar',url:'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=ar&pot=fixture-proof'}]});
   Object.defineProperty(document.querySelector('video'),'currentTime',{value:13,writable:true});
 });
 await install();await page.getByRole('button',{name:'加载英文字幕',exact:true}).click();
 await expect(page.getByLabel('当前原字幕',{exact:true})).toHaveText('She took her time.');
 expect(captionRequest?.searchParams.get('lang')).toBe('en');expect(captionRequest?.searchParams.get('signature')).toBe('selected-track');expect(captionRequest?.searchParams.get('pot')).toBe('fixture-proof');expect(captionRequest?.searchParams.get('fmt')).toBe('json3');
 await page.getByRole('button',{name:'翻译本句',exact:true}).click();await expect(page.getByLabel('当前字幕译文',{exact:true})).toHaveText('她不慌不忙地做事。');
 const caption=page.getByLabel('当前原字幕',{exact:true});
 // Actual mouse selection across the word in the subtitle shadow root.
 const points=await caption.evaluate(element=>{const node=element.firstChild!;const range=document.createRange();range.setStart(node,4);range.setEnd(node,8);const r=range.getBoundingClientRect();return {x:r.left,y:r.top+r.height/2,width:r.width};});
 await page.mouse.move(points.x,points.y);await page.mouse.down();await page.mouse.move(points.x+points.width,points.y,{steps:6});await page.mouse.up();
 const cdp=await page.context().newCDPSession(page);
 async function readingPanel(){const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});function find(n:any):any{if(n.nodeName==='SECTION'&&n.attributes?.includes('Sensa 阅读'))return n;for(const c of [...n.children??[],...n.shadowRoots??[]]){const r=find(c);if(r)return r;}}const node=find(root);return node?(await cdp.send('DOM.resolveNode',{nodeId:node.nodeId})).object.objectId:null;}
 await expect.poll(readingPanel).not.toBeNull();
 const panel=await readingPanel();
 await cdp.send('Runtime.callFunctionOn',{objectId:panel!,functionDeclaration:'function(){Array.from(this.querySelectorAll("button")).find(b=>b.textContent==="保存…").click();}'});
 await cdp.send('Runtime.callFunctionOn',{objectId:panel!,functionDeclaration:'function(){Array.from(this.querySelectorAll("button")).find(b=>b.textContent==="保存待处理").click();}'});
 await expect.poll(()=>page.evaluate(()=>(window as any).fixture.calls.some((c:any)=>c.kind==='save'))).toBe(true);
 const save=await page.evaluate(()=>(window as any).fixture.calls.find((c:any)=>c.kind==='save'));
 captureSnapshotSchema.parse(save.snapshot);expect(save.snapshot.expression.text).toBe('took');expect(save.snapshot.source.video).toEqual({platform:'youtube',videoId:'abcdefghijk',startMs:12500,endMs:15500});
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'下一句',exact:true}).click();await expect(caption).toHaveText('They looked up at the sky.');
 await page.screenshot({path:'/tmp/sensa-browser-video.png'});
 emptyCaptions=true;await page.getByRole('button',{name:'加载英文字幕',exact:true}).click();await expect(caption).toHaveText('');await expect(page.getByText('未找到可读取的英文字幕。可检查视频字幕设置，或加载自己的字幕文件。',{exact:true})).toBeVisible();
 await page.evaluate(()=>{history.pushState({},'', '/watch?v=lmnopqrstuv');document.dispatchEvent(new Event('yt-navigate-start'));});
 await expect(page.getByLabel('当前原字幕',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).fixture.receive({kind:'reading',enabled:false}));await expect(page.locator('[data-sensa-ui]')).toHaveCount(0);
 const settingsPage=await browser.newPage();const settingsHtml=(await readFile('apps/browser-extension/options.html','utf8')).replace('<script src="options.js"></script>','');
 await settingsPage.route('**/*',route=>route.request().url()==='https://example.com/settings'?route.fulfill({contentType:'text/html',body:settingsHtml}):route.abort());await settingsPage.goto('https://example.com/settings');
 await settingsPage.evaluate('window.__name=value=>value');
 await settingsPage.evaluate(()=>{
   const fixture={local:{} as Record<string,unknown>,lastInput:null as any,conflict:false,settings:{revision:0,providers:[] as any[],assignments:{selection:null,page:null,subtitles:null,action:null,meaning:null},configured:true,allowedOrigins:['https://api.deepseek.com'],accountId:'fixture-account'}};
   Object.assign(window,{settingsFixture:fixture,chrome:{storage:{local:{get:async()=>fixture.local,set:async(value:any)=>Object.assign(fixture.local,value)}},runtime:{sendMessage:async(message:any)=>{
     if(message.kind==='reading-settings')return {value:structuredClone(fixture.settings)};
     if(message.kind==='reading-settings-save'){
       if(fixture.conflict)return {error:'settings_conflict'};
       fixture.lastInput=message.input;fixture.settings={...fixture.settings,revision:fixture.settings.revision+1,providers:message.input.providers.map(({apiKey,...p}:any)=>({...p,keyConfigured:true})),assignments:message.input.assignments};return {value:structuredClone(fixture.settings)};
     }
     if(message.kind==='reading-models')return {value:{models:['fixture-model','deepseek-chat']}};
     return {value:{status:'ready',text:'OK'}};
   }}}});
 });
 await settingsPage.addScriptTag({path:resolve('apps/browser-extension/dist/options.js')});await expect(settingsPage.getByRole('status')).toHaveText('模型设置已加载。');
 await settingsPage.getByRole('button',{name:'添加连接',exact:true}).click();await settingsPage.getByLabel('API Key',{exact:true}).fill('fixture-secret-key');
 await settingsPage.getByLabel('模型标识',{exact:true}).fill('fixture-model');await settingsPage.getByLabel('划词翻译',{exact:true}).selectOption({label:'DeepSeek'});await settingsPage.getByRole('button',{name:'保存模型设置',exact:true}).click();
 await expect(settingsPage.getByLabel('API Key（已配置，留空保留）',{exact:true})).toHaveValue('');
 expect(JSON.stringify(await settingsPage.evaluate(()=>(window as any).settingsFixture.local))).not.toContain('fixture-secret-key');
 await settingsPage.getByRole('button',{name:'重新加载',exact:true}).click();await expect(settingsPage.getByLabel('模型标识',{exact:true})).toHaveValue('fixture-model');
 await settingsPage.getByRole('button',{name:'获取已保存连接的模型列表',exact:true}).click();await expect(settingsPage.getByRole('status')).toContainText('已获取 2 个模型');
 await settingsPage.getByRole('button',{name:'测试已保存连接',exact:true}).click();await expect(settingsPage.getByRole('status')).toContainText('连接成功');
 await settingsPage.evaluate(()=>(window as any).settingsFixture.conflict=true);await settingsPage.getByRole('button',{name:'保存模型设置',exact:true}).click();await expect(settingsPage.getByRole('status')).toContainText('另一处更新');
 await settingsPage.screenshot({path:'/tmp/sensa-browser-settings.png',fullPage:true});
 console.log('PASS: real page DOM translation/restore and preserved host handlers, editable exclusion, late-result isolation, main-world caption reader, subtitle selection with timestamped save, seek, SPA cleanup, reading shutdown. Network fixtures only.');
 console.log('PASS: actual settings UI save/reload, feature assignment, explicit test/model fetch, cleared password field, no secret in browser storage, conflict feedback.');
}finally{await browser.close();}
