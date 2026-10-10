/** Chromium/source-backed cue UI with controlled Chrome ports and platform data.
 * No installed permissions, live YouTube availability or model quality claim. */
import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {readYoutubePlayer} from '../../../apps/browser-extension/src/youtubePlayer';
let content:string;
test.use({locale:'zh-CN',viewport:{width:1200,height:850}});
test.beforeAll(async()=>{content=(await build({entryPoints:['apps/browser-extension/src/content.ts'],bundle:true,write:false,platform:'browser',format:'iife'})).outputFiles[0]!.text;});
const videoId='abcdefghijk';
async function open(page:Page){
 await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="en"><title>Caption fixture</title><body><div id="movie_player"><video class="html5-main-video"></video></div></body></html>'}));
 await page.goto('https://www.youtube.com/watch?v='+videoId);
 await page.addScriptTag({content:'window.__name=value=>value;window.readPlayer='+readYoutubePlayer.toString()+';'});
 await page.evaluate(()=>{
  const f={ports:[] as any[],calls:[] as any[],held:[] as Array<()=>void>,holdOld:false,response:{language:'en',json:JSON.stringify({events:[{tStartMs:0,dDurationMs:2000,segs:[{utf8:'She took her time.'}]},{tStartMs:3000,dDurationMs:2000,segs:[{utf8:'They looked up at the sky.'}]}]})} as any,native:false};
  Object.defineProperty(document.querySelector('video'),'currentTime',{value:0,writable:true});
  Object.assign(window,{captionFixture:f,chrome:{runtime:{onMessage:{addListener:(receive:any)=>(f as any).receive=receive},sendMessage:async(message:any)=>{
   f.calls.push(message);
   if(message.kind==='youtube-captions')return {value:f.native?await (window as any).readPlayer(message.videoId):f.response};
   if(message.kind==='detect-language'){
    if(f.holdOld&&message.text.includes('Old English'))await new Promise<void>(resolve=>f.held.push(resolve));
    return {value:{language:{code:message.text.includes('Bonjour')?'fra':'eng',confidence:1}}};
   }
   if(message.kind==='reading-language')return {value:{supportLanguageTag:'zh-CN',sourceLanguageTag:message.surfaceLanguage,alreadyReadable:false}};
   return {value:{}};
  },connect:()=>{
   const callbacks:Array<(frame:any)=>void>=[],closed:Array<()=>void>=[];
   const state={input:null as any,disconnected:false,partial:(text:string)=>callbacks.forEach(fn=>fn({type:'partial',text})),finish:(text:string)=>callbacks.forEach(fn=>fn({type:'result',value:{status:'ready',text}}))};f.ports.push(state);
   return {onMessage:{addListener:(fn:any)=>callbacks.push(fn)},onDisconnect:{addListener:(fn:any)=>closed.push(fn)},postMessage:(input:any)=>{if(input.type!=='ping')state.input=input;},disconnect:()=>{if(state.disconnected)return;state.disconnected=true;closed.forEach(fn=>fn());}};
  }}}});
 });
 await page.addScriptTag({content});await page.evaluate(()=>(window as any).captionFixture.receive({kind:'reading',enabled:true,accountId:'caption-scope'}));
 return page.locator('[data-sensa-ui="youtube"]');
}
const vtt=(text:string)=>({name:'captions.vtt',mimeType:'text/vtt',buffer:Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n'+text+'\n')});
test('cue, file and video replacement disconnect obsolete translations and a new cue need not wait for old work',async({page})=>{
 const panel=await open(page),original=panel.getByLabel('当前原字幕',{exact:true}),translated=panel.getByLabel('当前字幕译文',{exact:true});
 await panel.getByRole('button',{name:'加载字幕',exact:true}).click();await expect(original).toHaveText('She took her time.');
 await panel.getByRole('button',{name:'翻译本句',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).captionFixture.ports.length)).toBe(1);
 await panel.getByRole('button',{name:'下一句',exact:true}).click();await expect(original).toHaveText('They looked up at the sky.');
 expect(await page.evaluate(()=>(window as any).captionFixture.ports[0].disconnected)).toBe(true);
 await panel.getByRole('button',{name:'翻译本句',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).captionFixture.ports.length)).toBe(2);
 await page.evaluate(()=>{const p=(window as any).captionFixture.ports;p[0].partial('old cue');p[0].finish('old result');p[1].partial('current cue');});await expect(translated).toHaveText('current cue');
 await page.evaluate(()=>{document.querySelector('video')!.currentTime=0;});
 await panel.locator('input[type=file]').setInputFiles(vtt('Bonjour à tous.'));await expect(original).toHaveText('Bonjour à tous.');await expect(original).toHaveAttribute('lang','fr');
 expect(await page.evaluate(()=>(window as any).captionFixture.ports[1].disconnected)).toBe(true);
 await panel.getByRole('button',{name:'翻译本句',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).captionFixture.ports.length)).toBe(3);
 expect(await page.evaluate(()=>(window as any).captionFixture.ports[2].input.input.sourceLanguageTag)).toBe('fr');
 await page.evaluate(()=>{history.pushState({},'', '/watch?v=lmnopqrstuv');document.dispatchEvent(new Event('yt-navigate-start'));});await expect(panel).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).captionFixture.ports[2].disconnected)).toBe(true);
});
test('a delayed old file language cannot replace a newer file; an oversized selection preserves the current valid captions',async({page})=>{
 const panel=await open(page),original=panel.getByLabel('当前原字幕',{exact:true});
 await page.evaluate(()=>(window as any).captionFixture.holdOld=true);
 await panel.locator('input[type=file]').setInputFiles(vtt('Old English text.'));await expect.poll(()=>page.evaluate(()=>(window as any).captionFixture.held.length)).toBe(1);
 await panel.locator('input[type=file]').setInputFiles(vtt('Bonjour à tous.'));await expect(original).toHaveText('Bonjour à tous.');await expect(original).toHaveAttribute('lang','fr');
 await page.evaluate(()=>(window as any).captionFixture.held.splice(0).forEach((resolve:any)=>resolve()));await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
 await panel.getByRole('button',{name:'翻译本句',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).captionFixture.ports.length)).toBe(1);
 expect(await page.evaluate(()=>(window as any).captionFixture.ports[0].input.input.sourceLanguageTag)).toBe('fr');
 await panel.locator('input[type=file]').setInputFiles({name:'too-large.vtt',mimeType:'text/vtt',buffer:Buffer.alloc(2_000_001,120)});
 await expect(panel.getByRole('status')).toContainText('字幕文件超过 2 MB');await expect(original).toHaveText('Bonjour à tous.');await expect(original).toHaveAttribute('lang','fr');
});
test('live and oversized caption sources report their real reason instead of claiming no captions or partial success',async({page})=>{
 const panel=await open(page),load=panel.getByRole('button',{name:'加载字幕',exact:true});
 await page.evaluate(()=>(window as any).captionFixture.response={error:'live_unsupported'});await load.click();await expect(panel.getByRole('status')).toHaveText('当前直播字幕尚不支持。');
 await page.evaluate(()=>(window as any).captionFixture.response={error:'captions_too_large'});await load.click();await expect(panel.getByRole('status')).toContainText('字幕数据过大');
 await page.evaluate(()=>(window as any).captionFixture.response={language:'en',json:JSON.stringify({events:Array.from({length:10001},(_,i)=>({tStartMs:i*10,dDurationMs:20,segs:[{utf8:'Caption.'}]}))})});
 await load.click();await expect(panel.getByRole('status')).toContainText('字幕数据过大');await expect(panel.getByLabel('当前原字幕',{exact:true})).toHaveText('');
});
test('the actual selected French track stays French even when an English track is also available',async({page})=>{
 const panel=await open(page);let requested:URL|undefined,oversized=false;
 await page.route('https://www.youtube.com/api/timedtext**',route=>{requested=new URL(route.request().url());return oversized?route.fulfill({contentType:'application/json',body:'x'.repeat(2_000_001)}):route.fulfill({json:{events:[{tStartMs:0,dDurationMs:2000,segs:[{utf8:'Bonjour à tous.'}]}]}});});
 await page.evaluate(()=>{
  const f=(window as any).captionFixture;f.native=true;
  const player=document.querySelector('#movie_player') as any;
  player.getPlayerResponse=()=>({videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en',vssId:'.en',baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en'},{languageCode:'fr',vssId:'.fr',baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=fr&signature=french'}]}}});
  player.getOption=()=>({languageCode:'fr',vssId:'.fr'});
 });
 await panel.getByRole('button',{name:'加载字幕',exact:true}).click();await expect(panel.getByLabel('当前原字幕',{exact:true})).toHaveText('Bonjour à tous.');
 expect(requested?.searchParams.get('lang')).toBe('fr');expect(requested?.searchParams.get('signature')).toBe('french');await expect(panel.getByLabel('当前原字幕',{exact:true})).toHaveAttribute('lang','fr');
 oversized=true;await panel.getByRole('button',{name:'加载字幕',exact:true}).click();await expect(panel.getByRole('status')).toContainText('字幕数据过大');await expect(panel.getByLabel('当前原字幕',{exact:true})).toHaveText('');
});
