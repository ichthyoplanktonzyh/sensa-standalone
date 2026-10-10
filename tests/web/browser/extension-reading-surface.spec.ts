/** Real Chromium DOM, with controlled extension ports/detection and device voice.
 * Not installed-extension permissions, real model quality or audible evidence. */
import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {extensionPanelButton} from '../support/extensionReadingPanel.mts';
let content:string;
test.use({locale:'zh-CN',viewport:{width:1100,height:800}});
test.beforeAll(async()=>{content=(await build({entryPoints:['apps/browser-extension/src/content.ts'],bundle:true,write:false,platform:'browser',format:'iife'})).outputFiles[0]!.text;});
async function open(page:Page,{language='en',delayDetection=false,automatic=false}:{language?:string;delayDetection?:boolean;automatic?:boolean}={}){
 await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="${language}"><title>Reading fixture</title><body><p id="english">May asked to borrow an umbrella from her colleague and promised to return it tomorrow.</p><p id="french" lang="fr">Ils ont décidé de prendre le train ensemble parce que la pluie était trop forte pour rentrer à pied.</p><input id="ordinary" value="我把会议改到了周四。"><textarea id="reply">我明天会把雨伞还给你。</textarea><input id="secret" type="password" value="private"><input id="locked" readonly value="fixed"></body></html>`}));
 await page.goto('https://reading.fixture.invalid/article');
 await page.evaluate(({delayDetection,automatic})=>{
  const fixture={delayDetection,automatic,unknown:false,detections:[] as Array<()=>void>,calls:[] as any[],ports:[] as any[],spoken:[] as any[]};
  Object.assign(window,{fixture,chrome:{runtime:{onMessage:{addListener:(receive:any)=>(fixture as any).receive=receive},sendMessage:async(message:any)=>{
   fixture.calls.push(message);
   if(message.kind==='detect-language')return {value:{language:fixture.unknown?null:{code:'eng',confidence:1}}};
   if(message.kind==='reading-language'){
    if(fixture.delayDetection)await new Promise<void>(resolve=>fixture.detections.push(resolve));
    return {value:{supportLanguageTag:'zh-CN',alreadyReadable:false,sourceLanguageTag:message.text.startsWith('Ils')?'fr':'en'}};
   }
   return {value:{}};
  },connect:()=>{
   const messages:Array<(frame:any)=>void>=[],disconnections:Array<()=>void>=[];
   const state={payload:null as any,disconnected:false,partial:(text:string)=>messages.forEach(receive=>receive({type:'partial',text})),finish:(text:string)=>messages.forEach(receive=>receive({type:'result',value:{status:'ready',text}}))};fixture.ports.push(state);
   return {onMessage:{addListener:(receive:any)=>messages.push(receive)},onDisconnect:{addListener:(receive:any)=>disconnections.push(receive)},postMessage:(payload:any)=>{if(payload.type==='ping')return;state.payload=payload;if(fixture.automatic)queueMicrotask(()=>state.finish('I will return the umbrella tomorrow.'));},disconnect:()=>{if(state.disconnected)return;state.disconnected=true;disconnections.forEach(receive=>receive());}};
  }}}});
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],addEventListener:()=>{},removeEventListener:()=>{},cancel:()=>{},speak:(utterance:any)=>fixture.spoken.push(utterance)}});
 },{delayDetection,automatic});
 await page.addScriptTag({content});
 await page.evaluate(()=>(window as any).fixture.receive({kind:'reading',enabled:true,accountId:'controlled-reading-scope'}));
}
test('unavailable page speech retains its reason, clears highlights and does not claim completion',async({page})=>{
 await open(page);await page.getByRole('button',{name:'朗读本页',exact:true}).click();
 const status=page.locator('[data-sensa-speech]');
 await expect(status).toBeVisible();await expect(status).toContainText('没有可用的英语本机语音');
 await expect(page.locator('[data-sensa-speaking]')).toHaveCount(0);await expect(page.getByRole('button',{name:'朗读本页',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).fixture.spoken.length)).toBe(0);
 await page.evaluate(()=>{document.documentElement.lang='';(window as any).fixture.unknown=true;});
 await page.getByRole('button',{name:'朗读本页',exact:true}).click();await expect(status).toBeVisible();await expect(status).toContainText('语言尚未确定');
});
test('short spoken blocks inherit their own declared language and synchronous completion does not strand the page reader',async({page})=>{
 await open(page);await page.evaluate(()=>{
  document.querySelector('#english')!.textContent='A rainy afternoon';document.querySelector('#french')!.textContent='Bonjour';
  const f=(window as any).fixture;f.unknown=true;
  Object.assign(window,{SpeechSynthesisUtterance:class{constructor(public text:string){}}});
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{name:'Local English',lang:'en-US',localService:true},{name:'Local French',lang:'fr-FR',localService:true}],cancel:()=>{},speak:(u:any)=>{f.spoken.push({text:u.text,lang:u.lang});u.onend();}}});
 });
 await page.getByRole('button',{name:'朗读本页',exact:true}).click();await expect(page.locator('[data-sensa-speech]')).toContainText('本页朗读完毕');
 expect(await page.evaluate(()=>(window as any).fixture.spoken)).toEqual([{text:'A rainy afternoon',lang:'en-US'},{text:'Bonjour',lang:'fr-FR'}]);
 expect(await page.evaluate(()=>(window as any).fixture.calls.filter((message:any)=>message.kind==='detect-language').length)).toBe(0);
 await expect(page.locator('[data-sensa-speaking]')).toHaveCount(0);
});
test('selection keeps its explicit block language for short and longer text without a statistical guess',async({page})=>{
 await open(page);
 const selections=[{id:'french',text:'Bonjour à tous.',tag:'fr'},{id:'english',text:'Water is essential for the basil on my windowsill.',tag:'en'},{id:'french',text:'Ils ont décidé de prendre le train ensemble parce que la pluie était trop forte pour rentrer à pied.',tag:'fr'}];
 for(const [index,item] of selections.entries()){
  await page.evaluate(({id,text,tag})=>{
   const paragraph=document.querySelector('#'+id)!;paragraph.textContent=text;paragraph.setAttribute('lang',tag);
   const range=document.createRange();range.selectNodeContents(paragraph);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);
   document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerType:'mouse'}));
  },item);
  await expect.poll(()=>extensionPanelButton(page,'句中解释')).toBe(true);expect(await extensionPanelButton(page,'句中解释',true)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).fixture.ports.length)).toBe(index+1);
  expect(await page.evaluate(i=>(window as any).fixture.ports[i].payload.input.snapshot.language,index)).toBe(item.tag);
 }
 expect(await page.evaluate(()=>(window as any).fixture.calls.filter((message:any)=>message.kind==='detect-language').length)).toBe(0);
});
test('a genuine cross-paragraph selection keeps both Context blocks and exact expression offsets',async({page})=>{
 await open(page);
 const first='🌧️ She asked to borrow an umbrella.',second='He agreed to lend it until tomorrow.';
 await page.evaluate(({first,second})=>{
  const start=document.querySelector('#english')!,end=document.querySelector('#french')!;start.textContent=first;end.textContent=second;end.removeAttribute('lang');
  const range=document.createRange();range.setStart(start.firstChild!,first.indexOf('borrow'));range.setEnd(end.firstChild!,second.indexOf('tomorrow')+'tomorrow'.length);
  const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerType:'mouse'}));
 },{first,second});
 await expect.poll(()=>extensionPanelButton(page,'句中解释')).toBe(true);expect(await extensionPanelButton(page,'句中解释',true)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).fixture.ports.length)).toBe(1);
 const snapshot=await page.evaluate(()=>(window as any).fixture.ports[0].payload.input.snapshot);
 expect(snapshot.sentence).toBe(first+'\n'+second);expect(snapshot.expression.text).toBe('borrow an umbrella.\nHe agreed to lend it until tomorrow');
 expect(Array.from(snapshot.sentence).slice(snapshot.expression.start,snapshot.expression.end).join('')).toBe(snapshot.expression.text);
});
test('restoring before detection finishes sends nothing; restoring live requests disconnects them and a new request keeps the block language',async({page})=>{
 await open(page,{delayDetection:true});await page.getByRole('button',{name:'翻译页面',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).fixture.detections.length)).toBe(2);
 await page.getByRole('button',{name:'恢复原文',exact:true}).click();
 await page.evaluate(()=>{const f=(window as any).fixture;f.delayDetection=false;f.detections.splice(0).forEach((resolve:any)=>resolve());});
 await expect(page.locator('[data-sensa-ui="translation"]')).toHaveCount(0);
 // A task-boundary roundtrip lets all released detection continuations settle.
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
 expect(await page.evaluate(()=>(window as any).fixture.ports.length)).toBe(0);
 await page.getByRole('button',{name:'翻译页面',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).fixture.ports.length)).toBe(2);
 const first=await page.evaluate(()=>(window as any).fixture.ports.map((port:any)=>port.payload.input));
 expect(first.find((request:any)=>request.text.startsWith('Ils')).sourceLanguageTag).toBe('fr');
 await page.evaluate(()=>(window as any).fixture.ports[0].partial('initial partial'));await expect(page.locator('#english + [data-sensa-ui="translation"]')).toHaveText('initial partial');
 await page.getByRole('button',{name:'恢复原文',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).fixture.ports.every((port:any)=>port.disconnected))).toBe(true);
 await page.getByRole('button',{name:'翻译页面',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).fixture.ports.length)).toBe(4);
 await page.evaluate(()=>{const ports=(window as any).fixture.ports;ports[0].partial('discarded partial');ports[0].finish('discarded old response');ports[2].finish('current response');ports[3].finish('réponse actuelle');});
 await expect(page.locator('#english + [data-sensa-ui="translation"]')).toHaveText('current response');
 await expect(page.locator('#french + [data-sensa-ui="translation"]')).toHaveText('réponse actuelle');
});
test('reading-context refresh retires old ports and cache; surrounding Context changes select new requests without leaking partials',async({page})=>{
 await open(page);await page.evaluate(()=>{document.querySelector('#english')!.textContent='The same short sentence.';document.querySelector('#french')!.textContent='The same short sentence.';});
 await page.getByRole('button',{name:'翻译页面',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).fixture.ports.length)).toBe(2);
 const inputs=await page.evaluate(()=>(window as any).fixture.ports.map((port:any)=>port.payload.input));expect(inputs[0].context).not.toBe(inputs[1].context);
 await page.evaluate(()=>{const p=(window as any).fixture.ports;p[0].partial('first Context');p[1].partial('second Context');});
 await expect(page.locator('#english + [data-sensa-ui="translation"]')).toHaveText('first Context');await expect(page.locator('#french + [data-sensa-ui="translation"]')).toHaveText('second Context');
 await page.evaluate(()=>{document.title='Changed article Context';});
 await expect.poll(()=>page.evaluate(()=>(window as any).fixture.ports.slice(0,2).every((port:any)=>port.disconnected))).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).fixture.ports.length)).toBe(4);
 await page.evaluate(()=>{const p=(window as any).fixture.ports;p[0].partial('old title');p[2].finish('current title A');p[3].finish('current title B');});
 await expect(page.locator('#english + [data-sensa-ui="translation"]')).toHaveText('current title A');
 await page.evaluate(()=>(window as any).fixture.receive({kind:'reading',enabled:true,accountId:'controlled-reading-scope',refresh:true}));
 await expect(page.locator('[data-sensa-ui="translation"]')).toHaveCount(0);
 await page.getByRole('button',{name:'翻译页面',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).fixture.ports.length)).toBe(6);
});
test('ordinary default-type inputs work; changed prose and newly protected fields cannot be replaced by an old preview',async({page})=>{
 await open(page,{automatic:true});await page.locator('#ordinary').press('Alt+t');
 const preview=page.locator('[data-sensa-ui="writing"]');await expect(preview.locator('section')).toBeVisible();
 await expect(preview.getByRole('status')).toHaveText('I will return the umbrella tomorrow.');await expect(page.locator('#ordinary')).toHaveValue('我把会议改到了周四。');
 await page.locator('#ordinary').fill('这是我刚刚改写的新内容。');await expect(preview).toHaveCount(0);await expect(page.locator('#ordinary')).toHaveValue('这是我刚刚改写的新内容。');
 await page.locator('#reply').press('Alt+t');await expect(preview.getByRole('button',{name:'替换输入框内容',exact:true})).toBeVisible();
 await page.evaluate(()=>{document.querySelector<HTMLTextAreaElement>('#reply')!.readOnly=true;});
 await preview.getByRole('button',{name:'替换输入框内容',exact:true}).click();await expect(page.locator('#reply')).toHaveValue('我明天会把雨伞还给你。');await expect(preview).toHaveCount(0);
 const before=await page.evaluate(()=>(window as any).fixture.ports.length);await page.locator('#secret').press('Alt+t');await page.locator('#locked').press('Alt+t');
 expect(await page.evaluate(()=>(window as any).fixture.ports.length)).toBe(before);
});
test('a late context refresh cannot turn stopped reading back on',async({page})=>{
 await open(page);await expect(page.getByRole('button',{name:'翻译页面',exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).fixture.receive({kind:'reading',enabled:false}));await expect(page.locator('[data-sensa-ui]')).toHaveCount(0);
 await page.evaluate(()=>(window as any).fixture.receive({kind:'reading',enabled:true,accountId:'controlled-reading-scope',refresh:true}));
 await expect(page.locator('[data-sensa-ui]')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).fixture.ports.length)).toBe(0);
 await page.evaluate(()=>(window as any).fixture.receive({kind:'reading',enabled:true,accountId:'controlled-reading-scope'}));await expect(page.getByRole('button',{name:'翻译页面',exact:true})).toBeVisible();
});
