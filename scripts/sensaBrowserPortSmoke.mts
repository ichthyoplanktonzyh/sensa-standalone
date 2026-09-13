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
   if(url.pathname==='/article')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><title>Article fixture</title><main style="margin:60px;font:22px system-ui"><h2 id="heading">Slow mornings</h2><p id="paragraph">She <a href="#example">took</a> her time.</p><p id="chinese">这段话本身就是学习者能读的语言，不该被翻译。</p><p contenteditable="true">Do not translate editable text.</p></main>'});
   return route.abort();
 });
 async function install(){
   await page.addScriptTag({content:'window.__name=value=>value; window.readPlayer='+readYoutubePlayer.toString()+';'});
   await page.evaluate(()=>{
     const fixture={calls:[] as any[],pending:null as any,delay:false,receive:null as any,clicks:0};
     // A stand-in device synthesizer: what matters is which language the panel
     // asks a voice for, and a headless browser cannot be heard.
     const speechFixture={spoken:[] as any[]};
     const voices=[{name:'Samantha',lang:'en-US',localService:true},{name:'Ting-Ting',lang:'zh-CN',localService:true}];
     Object.assign(window,{fixture,speechFixture,SpeechSynthesisUtterance:class{constructor(public text:string){}},chrome:{runtime:{onMessage:{addListener:(handler:any)=>fixture.receive=handler},sendMessage:async(message:any)=>{
       fixture.calls.push(message);
       if(message.kind==='youtube-captions')return {value:await (window as any).readPlayer(message.videoId)};
       // The detector and the learner's own language, stood in for: this text is
       // Chinese and this learner already reads Chinese. What the background
       // really answers is exercised against the real handler in the intake smoke.
       if(message.kind==='detect-language')return {value:{language:/\p{Script=Han}/u.test(message.text??'')?'cmn':'eng'}};
       if(message.kind==='reading-language')return {value:{familiarLanguageTag:'zh-CN',alreadyReadable:/\p{Script=Han}/u.test(message.text??'')||message.surfaceLanguage==='zh-CN'}};
       if(message.kind==='reading-run'){if(fixture.delay)return new Promise(resolve=>{fixture.pending=resolve;});return {value:{status:'ready',text:'她不慌不忙地做事。'}};}
       return {value:{savedLocally:true}};
     }}}});
     // The real window exposes speechSynthesis as a read-only accessor, so the
     // stand-in is defined rather than assigned.
     Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>voices,addEventListener:()=>{},removeEventListener:()=>{},cancel:()=>{},speak:(utterance:any)=>speechFixture.spoken.push({text:utterance.text,lang:utterance.lang,rate:Number(utterance.rate.toFixed(3)),voice:utterance.voice?.name??''})}});
     document.querySelector('#paragraph a')?.addEventListener('click',e=>{e.preventDefault();fixture.clicks++;});
   });
   await page.addScriptTag({path:resolve('apps/browser-extension/dist/content.js')});
   await page.evaluate(()=>(window as any).fixture.receive({kind:'reading',enabled:true,accountId:'fixture-account'}));
 }
 await page.goto('https://example.com/article');await install();
 const readings=()=>page.evaluate(()=>(window as any).fixture.calls.filter((c:any)=>c.kind==='reading-run').length);
 const asked=()=>page.evaluate(()=>(window as any).fixture.calls.filter((c:any)=>c.kind==='reading-language').length);
 const speechSpoken=()=>page.evaluate(()=>(window as any).speechFixture.spoken as any[]);
 await page.getByRole('button',{name:'翻译页面',exact:true}).click();
 await expect(page.locator('#paragraph + [data-sensa-ui="translation"]')).toHaveText('她不慌不忙地做事。');
 // The page holds three blocks worth translating and one the learner can already
 // read: every one is asked about, and only the ones that need it are asked for a
 // translation.
 expect(await asked()).toBe(3);expect(await readings()).toBe(2);
 await expect(page.locator('#chinese + [data-sensa-ui="translation"]')).toHaveCount(0);
 await expect(page.locator('[data-sensa-ui="page"] p')).toContainText('跳过 1 段你已能读的文字');
 // A translation is asked for with what the paragraph sits in — the page's title,
 // the heading above it, the text before it — because the model is not guessing.
 const paragraphRun=await page.evaluate(()=>(window as any).fixture.calls.filter((c:any)=>c.kind==='reading-run').find((c:any)=>c.input.text==='She took her time.'));
 expect(paragraphRun.input.context).toContain('Article fixture');expect(paragraphRun.input.context).toContain('Slow mornings');
 expect(paragraphRun.input.context).not.toContain('她不慌不忙地做事。');
 await page.getByRole('button',{name:'仅译文',exact:true}).click();await expect(page.locator('#paragraph')).toBeHidden();
 await page.getByRole('button',{name:'恢复原文',exact:true}).click();await expect(page.locator('#paragraph')).toBeVisible();await page.locator('#paragraph a').click();expect(await page.evaluate(()=>(window as any).fixture.clicks)).toBe(1);
 await page.getByRole('button',{name:'翻译页面',exact:true}).click();await expect(page.locator('#paragraph + [data-sensa-ui="translation"]')).toHaveText('她不慌不忙地做事。');expect(await readings()).toBe(2);await page.getByRole('button',{name:'恢复原文',exact:true}).click();
 // Pointing at a paragraph and asking for it is a request, and a request is never skipped.
 await page.getByRole('button',{name:'翻译页面',exact:true}).click();await page.hover('#chinese');
 await page.keyboard.press('Alt+t');
 await expect(page.locator('#chinese + [data-sensa-ui="translation"]')).toHaveText('她不慌不忙地做事。');
 expect(await readings()).toBe(3);await page.getByRole('button',{name:'恢复原文',exact:true}).click();
 // A paragraph that arrives later sits after the translation this panel inserted:
 // the context sent for it is the paragraph above, never our own translation.
 await page.getByRole('button',{name:'翻译页面',exact:true}).click();
 await page.evaluate(()=>{const added=document.createElement('p');added.id='added';added.textContent='A second thought about the afternoon.';document.querySelector('#chinese')!.before(added);});
 await expect(page.locator('#added + [data-sensa-ui="translation"]')).toHaveText('她不慌不忙地做事。');
 const addedRun=await page.evaluate(()=>(window as any).fixture.calls.filter((c:any)=>c.kind==='reading-run').find((c:any)=>c.input.text==='A second thought about the afternoon.'));
 expect(addedRun.input.context).toContain('She took her time.');expect(addedRun.input.context).toContain('Slow mornings');
 expect(addedRun.input.context).not.toContain('她不慌不忙地做事。');
 await page.getByRole('button',{name:'恢复原文',exact:true}).click();
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
 await install();await page.getByRole('button',{name:'加载字幕',exact:true}).click();
 await expect(page.getByLabel('当前原字幕',{exact:true})).toHaveText('She took her time.');
 expect(captionRequest?.searchParams.get('lang')).toBe('en');expect(captionRequest?.searchParams.get('signature')).toBe('selected-track');expect(captionRequest?.searchParams.get('pot')).toBe('fixture-proof');expect(captionRequest?.searchParams.get('fmt')).toBe('json3');
 await page.getByRole('button',{name:'翻译本句',exact:true}).click();await expect(page.getByLabel('当前字幕译文',{exact:true})).toHaveText('她不慌不忙地做事。');
 // A cue is a fragment of a conversation, so it is translated with what it is
 // sitting in: the video's title and the cue that follows it.
 const cueRun=await page.evaluate(()=>(window as any).fixture.calls.filter((c:any)=>c.kind==='reading-run').find((c:any)=>c.input.text==='She took her time.'));
 expect(cueRun.input.context).toContain('Video fixture');expect(cueRun.input.context).toContain('They looked up at the sky.');
 const caption=page.getByLabel('当前原字幕',{exact:true});
 // Actual mouse selection across the word in the subtitle shadow root.
 const points=await caption.evaluate(element=>{const node=element.firstChild!;const range=document.createRange();range.setStart(node,4);range.setEnd(node,8);const r=range.getBoundingClientRect();return {x:r.left,y:r.top+r.height/2,width:r.width};});
 await page.mouse.move(points.x,points.y);await page.mouse.down();await page.mouse.move(points.x+points.width,points.y,{steps:6});await page.mouse.up();
 const cdp=await page.context().newCDPSession(page);
 async function readingPanel(){const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});function find(n:any):any{if(n.nodeName==='SECTION'&&n.attributes?.includes('Sensa 阅读'))return n;for(const c of [...n.children??[],...n.shadowRoots??[]]){const r=find(c);if(r)return r;}}const node=find(root);return node?(await cdp.send('DOM.resolveNode',{nodeId:node.nodeId})).object.objectId:null;}
 await expect.poll(readingPanel).not.toBeNull();
 const panel=await readingPanel();
 await cdp.send('Runtime.callFunctionOn',{objectId:panel!,functionDeclaration:'function(){Array.from(this.querySelectorAll("button")).find(b=>b.textContent==="保存…").click();}'});
 await cdp.send('Runtime.callFunctionOn',{objectId:panel!,functionDeclaration:'function(){Array.from(this.querySelectorAll("button")).find(b=>["保存待处理","Save for clarification"].includes(b.textContent)).click();}'});
 await expect.poll(()=>page.evaluate(()=>(window as any).fixture.calls.some((c:any)=>c.kind==='save'))).toBe(true);
 const save=await page.evaluate(()=>(window as any).fixture.calls.find((c:any)=>c.kind==='save'));
 captureSnapshotSchema.parse(save.snapshot);expect(save.snapshot.expression.text).toBe('took');expect(save.snapshot.source.video).toEqual({platform:'youtube',videoId:'abcdefghijk',startMs:12500,endMs:15500});
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'下一句',exact:true}).click();await expect(caption).toHaveText('They looked up at the sky.');
 // Reading a cue aloud uses the track own language: an English track is read
 // with an English voice, never with whichever language is being studied.
 await page.getByRole('button',{name:'朗读本句',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>((window as any).speechFixture.spoken as any[]).length)).toBe(1);
 expect(await page.evaluate(()=>((window as any).speechFixture.spoken as any[])[0])).toEqual({text:'They looked up at the sky.',lang:'en-US',rate:0.92,voice:'Samantha'});
 await page.getByRole('button',{name:'停止朗读',exact:true}).click();
 await expect(page.getByRole('button',{name:'朗读本句',exact:true})).toBeVisible();
 // A subtitle file in the learner's own language is a track they can already
 // read: the panel says so and stops translating it on its own, while the button
 // that asks for one cue by name still translates it.
 await page.locator('input[type=file]').setInputFiles({name:'lesson.vtt',mimeType:'text/vtt',buffer:Buffer.from('WEBVTT\n\n00:00:12.500 --> 00:00:15.500\n她从容地花了些时间。\n')});
 await expect(page.getByText('这就是你已能读的语言，自动翻译已跳过',{exact:false})).toBeVisible();
 await page.evaluate(()=>{document.querySelector('video')!.currentTime=13;});await page.waitForTimeout(400);
 await expect(page.getByLabel('当前原字幕',{exact:true})).toHaveText('她从容地花了些时间。');
 const readCaptions=await readings();
 await page.getByLabel('字幕显示',{exact:true}).selectOption('bilingual');await page.waitForTimeout(400);
 await expect(page.getByLabel('当前字幕译文',{exact:true})).toHaveText('');
 expect(await readings()).toBe(readCaptions);
 await page.getByRole('button',{name:'翻译本句',exact:true}).click();await expect(page.getByLabel('当前字幕译文',{exact:true})).toHaveText('她不慌不忙地做事。');
 expect(await readings()).toBe(readCaptions+1);await page.getByLabel('字幕显示',{exact:true}).selectOption('original');
 await page.screenshot({path:'/tmp/sensa-browser-video.png'});
 emptyCaptions=true;await page.getByRole('button',{name:'加载字幕',exact:true}).click();await expect(caption).toHaveText('');await expect(page.getByText('未找到可读取的字幕。可检查视频字幕设置，或加载自己的字幕文件。',{exact:true})).toBeVisible();
 await page.evaluate(()=>{history.pushState({},'', '/watch?v=lmnopqrstuv');document.dispatchEvent(new Event('yt-navigate-start'));});
 await expect(page.getByLabel('当前原字幕',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).fixture.receive({kind:'reading',enabled:false}));await expect(page.locator('[data-sensa-ui]')).toHaveCount(0);
 const settingsPage=await browser.newPage();const settingsHtml=(await readFile('apps/browser-extension/options.html','utf8')).replace('<script src="options.js"></script>','');
 await settingsPage.route('**/*',route=>route.request().url()==='https://example.com/settings'?route.fulfill({contentType:'text/html',body:settingsHtml}):route.abort());await settingsPage.goto('https://example.com/settings');
 await settingsPage.evaluate('window.__name=value=>value');
 await settingsPage.evaluate(()=>{
   const fixture={local:{} as Record<string,unknown>,lastInput:null as any,conflict:false,settings:{revision:0,providers:[] as any[],assignments:{selection:null,page:null,subtitles:null,action:null,meaning:null},configured:true,allowedOrigins:['https://api.deepseek.com'],accountId:'fixture-account'}};
   Object.assign(window,{settingsFixture:fixture,chrome:{storage:{local:{get:async()=>fixture.local,set:async(value:any)=>Object.assign(fixture.local,value)}},runtime:{sendMessage:async(message:any)=>{
     if(message.kind==='service-status')return {value:{authorized:true,explanationAvailable:true,usage:[{kind:'reading',used:0,limit:300}]}};
     if(message.kind==='reading-settings')return {value:structuredClone(fixture.settings)};
     if(message.kind==='reading-settings-save'){
       if(fixture.conflict)return {error:'settings_conflict'};
       fixture.lastInput=message.input;fixture.settings={...fixture.settings,revision:fixture.settings.revision+1,providers:message.input.providers.map(({apiKey,...p}:any)=>({...p,keyConfigured:true})),assignments:message.input.assignments};return {value:structuredClone(fixture.settings)};
     }
     if(message.kind==='reading-models')return {value:{models:['fixture-model','deepseek-chat']}};
     return {value:{status:'ready',text:'OK'}};
   }}}});
 });
 await settingsPage.addScriptTag({path:resolve('apps/browser-extension/dist/options.js')});await expect(settingsPage.locator('#service-status')).toContainText('账号已连接');await expect(settingsPage.getByRole('button',{name:'添加连接',exact:true})).not.toBeVisible();await settingsPage.getByText('高级设置 · 自定义模型服务',{exact:true}).click();await expect(settingsPage.locator('#feedback')).toHaveText('模型设置已加载。');
 await settingsPage.getByRole('button',{name:'添加连接',exact:true}).click();await settingsPage.getByLabel('API Key',{exact:true}).fill('fixture-secret-key');
 await settingsPage.getByLabel('模型标识',{exact:true}).fill('fixture-model');await settingsPage.getByLabel('划词翻译',{exact:true}).selectOption({label:'DeepSeek'});await settingsPage.getByRole('button',{name:'保存模型设置',exact:true}).click();
 await expect(settingsPage.getByLabel('API Key（已配置，留空保留）',{exact:true})).toHaveValue('');
 expect(JSON.stringify(await settingsPage.evaluate(()=>(window as any).settingsFixture.local))).not.toContain('fixture-secret-key');
 await settingsPage.getByRole('button',{name:'重新加载高级设置',exact:true}).click();await expect(settingsPage.getByLabel('模型标识',{exact:true})).toHaveValue('fixture-model');
 await settingsPage.getByRole('button',{name:'获取已保存连接的模型列表',exact:true}).click();await expect(settingsPage.locator('#feedback')).toContainText('已获取 2 个模型');
 await settingsPage.getByRole('button',{name:'测试已保存连接',exact:true}).click();await expect(settingsPage.locator('#feedback')).toContainText('连接成功');
 await settingsPage.evaluate(()=>(window as any).settingsFixture.conflict=true);await settingsPage.getByRole('button',{name:'保存模型设置',exact:true}).click();await expect(settingsPage.locator('#feedback')).toContainText('另一处更新');
 await settingsPage.screenshot({path:'/tmp/sensa-browser-settings.png',fullPage:true});
 console.log('PASS: real page DOM translation/restore and preserved host handlers, editable exclusion, late-result isolation, a paragraph the learner already reads left alone and translated on request, every translation asked for with what its text sits in and never with a translation the panel wrote itself, main-world caption reader, subtitle selection with timestamped save, a subtitle track in the learner\'s own language skipped until asked for, a cue spoken in the language of its track, seek, SPA cleanup, reading shutdown. Network fixtures only.');
 console.log('PASS: actual settings UI save/reload, feature assignment, explicit test/model fetch, cleared password field, no secret in browser storage, conflict feedback.');
}finally{await browser.close();}
