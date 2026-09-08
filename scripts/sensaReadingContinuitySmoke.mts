import {chromium,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {parseYoutubeCaptions} from '../apps/browser-extension/src/subtitleCues.ts';

const timed={events:[{tStartMs:1000,dDurationMs:6000,segs:[{utf8:'First sentence.',tOffsetMs:0},{utf8:' Next sentence.',tOffsetMs:2000},{utf8:' Last sentence.',tOffsetMs:4000}]}]};
expect(parseYoutubeCaptions(JSON.stringify(timed))).toEqual([{text:'First sentence.',start:1,end:3},{text:'Next sentence.',start:3,end:5},{text:'Last sentence.',start:5,end:7}]);
expect(parseYoutubeCaptions(JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'Dr.'}]},{tStartMs:1000,dDurationMs:2000,segs:[{utf8:'Smith spoke.'}]}]})).map(c=>c.text)).toEqual(['Dr. Smith spoke.']);
expect(parseYoutubeCaptions(JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'We are'}]},{tStartMs:0,dDurationMs:1500,segs:[{utf8:'We are ready.'}]},{tStartMs:3000,dDurationMs:1000,segs:[{utf8:'We are ready.'}]}]})).map(c=>c.text)).toEqual(['We are ready.','We are ready.']);
const browser=await chromium.launch({executablePath:process.env.SENSA_CHROMIUM_PATH});
try{
  const page=await browser.newPage({viewport:{width:1100,height:800}});
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Reading continuity fixture</title><style>p{margin:0;padding:20px;height:80px}main{padding-bottom:300px}</style><main></main><div class="html5-video-player"><video class="html5-main-video"></video></div>'}));
  async function install(){
    await page.addScriptTag({content:'window.__name=value=>value;'});
    await page.evaluate(captions=>{
      const fixture={calls:[] as any[],pending:[] as any[],defer:false,fail:false,receive:null as any,captions};
      Object.assign(window,{fixture,chrome:{runtime:{onMessage:{addListener:(fn:any)=>fixture.receive=fn},sendMessage:async(message:any)=>{
        if(message.kind==='youtube-captions')return {value:{json:JSON.stringify(fixture.captions)}};
        fixture.calls.push(message);
        if(fixture.defer)return new Promise(resolve=>fixture.pending.push({resolve,message}));
        return fixture.fail?{error:'reading_timeout'}:{value:{status:'ready',text:'译文：'+message.input.text}};
      }}}});
      Object.defineProperty(document.querySelector('video'),'currentTime',{value:1.5,writable:true});
    },timed);
    await page.addScriptTag({path:resolve('apps/browser-extension/dist/content.js')});
    await page.evaluate(()=>(window as any).fixture.receive({kind:'reading',enabled:true,accountId:'continuity'}));
  }
  await page.goto('https://example.org/article');
  await page.evaluate(()=>{document.querySelector('main')!.innerHTML=Array.from({length:220},(_,i)=>`<p id="p${i}">Paragraph number ${i} is readable.</p>`).join('');});
  await install();await page.getByRole('button',{name:'翻译页面',exact:true}).click();
  await expect(page.locator('#p0 + [data-sensa-ui="translation"]')).toContainText('Paragraph number 0');
  expect(await page.evaluate(()=>(window as any).fixture.calls.length)).toBeLessThan(20);
  await page.locator('#p200').scrollIntoViewIfNeeded();
  await expect(page.locator('#p200 + [data-sensa-ui="translation"]')).toContainText('Paragraph number 200');
  await page.evaluate(()=>{document.querySelector('#p200')!.textContent='Updated live paragraph.';});
  await expect(page.locator('#p200 + [data-sensa-ui="translation"]')).toHaveText('译文：Updated live paragraph.');
  await page.getByRole('button',{name:'仅译文',exact:true}).click();
  await expect(page.locator('#p200')).toBeHidden();
  await page.evaluate(()=>{document.querySelector('#p200')!.textContent='Host rewrite while hidden.';});
  await page.getByRole('button',{name:'恢复原文',exact:true}).click();
  await expect(page.locator('#p200')).toHaveText('Host rewrite while hidden.');await expect(page.locator('#p200')).toBeVisible();
  await expect(page.locator('[data-sensa-ui="translation"]')).toHaveCount(0);
  // Two simultaneous requests, then restoration before either response arrives.
  await page.evaluate(()=>{window.scrollTo(0,0);(window as any).fixture.defer=true;document.querySelector('#p0')!.textContent='First delayed update.';document.querySelector('#p1')!.textContent='Second delayed update.';});
  await page.getByRole('button',{name:'翻译页面',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).fixture.pending.length)).toBe(2);
  await page.getByRole('button',{name:'恢复原文',exact:true}).click();
  const requests=await page.evaluate(()=>(window as any).fixture.calls.length);
  await page.evaluate(()=>{for(const item of (window as any).fixture.pending.splice(0))item.resolve({value:{status:'ready',text:'Late response'}});});
  await page.waitForTimeout(300);expect(await page.evaluate(()=>(window as any).fixture.calls.length)).toBe(requests);await expect(page.locator('[data-sensa-ui="translation"]')).toHaveCount(0);
  // Failure can be retried in place; no restore/retranslate-all ceremony.
  await page.evaluate(()=>{(window as any).fixture.defer=false;(window as any).fixture.fail=true;});
  await page.getByRole('button',{name:'翻译页面',exact:true}).click();await expect(page.getByRole('button',{name:'重试失败段落',exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).fixture.fail=false);await page.getByRole('button',{name:'重试失败段落',exact:true}).click();
  await expect(page.locator('#p0 + [data-sensa-ui="translation"]')).toHaveText('译文：First delayed update.');

  // Identical visible paragraphs share one in-flight request, then render independently.
  await page.getByRole('button',{name:'恢复原文',exact:true}).click();
  await page.evaluate(()=>{document.querySelector('main')!.innerHTML='<p id="same0">Identical pending paragraph.</p><p id="same1">Identical pending paragraph.</p>';Object.assign((window as any).fixture,{calls:[],pending:[],defer:true});window.scrollTo(0,0);});
  await page.getByRole('button',{name:'翻译页面',exact:true}).click();
  await expect(page.locator('[data-sensa-ui="translation"][aria-busy="true"]')).toHaveCount(2);
  expect(await page.evaluate(()=>(window as any).fixture.calls.length)).toBe(1);
  await page.evaluate(()=>(window as any).fixture.pending.shift().resolve({value:{status:'ready',text:'Shared translation'}}));
  await expect(page.locator('#same0 + [data-sensa-ui="translation"]')).toHaveText('Shared translation');
  await expect(page.locator('#same1 + [data-sensa-ui="translation"]')).toHaveText('Shared translation');

  await page.goto('https://www.youtube.com/watch?v=abcdefghijk');await install();
  const caption=page.getByLabel('当前原字幕',{exact:true}),translation=page.getByLabel('当前字幕译文',{exact:true});
  await page.getByRole('button',{name:'加载英文字幕',exact:true}).click();await expect(caption).toHaveText('First sentence.');
  await page.evaluate(()=>(window as any).fixture.defer=true);
  await page.getByLabel('字幕显示',{exact:true}).selectOption('bilingual');
  await expect(translation).toHaveText('正在翻译…');
  await expect.poll(()=>page.evaluate(()=>(window as any).fixture.pending.length)).toBe(1);
  await page.getByRole('button',{name:'下一句',exact:true}).click();await expect(caption).toHaveText('Next sentence.');
  await page.getByRole('button',{name:'下一句',exact:true}).click();await expect(caption).toHaveText('Last sentence.');
  await page.getByLabel('字幕显示',{exact:true}).selectOption('original');
  await page.evaluate(()=>(window as any).fixture.pending.shift().resolve({value:{status:'ready',text:'First translation'}}));
  await page.waitForTimeout(300);expect(await page.evaluate(()=>(window as any).fixture.calls.length)).toBe(1);
  await page.getByLabel('字幕显示',{exact:true}).selectOption('bilingual');
  await expect.poll(()=>page.evaluate(()=>(window as any).fixture.pending.length)).toBe(1);
  // Reload with a different transcript while the old translation is still pending.
  await page.evaluate(()=>(window as any).fixture.captions={events:[{tStartMs:1000,dDurationMs:8000,segs:[{utf8:'Replacement transcript.'}]}]});
  await page.getByRole('button',{name:'加载英文字幕',exact:true}).click();await expect(caption).toHaveText('Replacement transcript.');
  await page.evaluate(()=>(window as any).fixture.pending.shift().resolve({value:{status:'ready',text:'Stale last sentence'}}));
  await expect.poll(()=>page.evaluate(()=>(window as any).fixture.pending.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).fixture.pending[0].message.input.text)).toBe('Replacement transcript.');
  await expect(translation).not.toContainText('Stale');
  await page.evaluate(()=>(window as any).fixture.pending.shift().resolve({value:{status:'ready',text:'Replacement translation'}}));
  await expect(translation).toHaveText('Replacement translation');
  // Native play resumes following after a selection/pause, without our Continue button.
  await page.getByRole('button',{name:'暂停 / 固定字幕',exact:true}).click();
  await page.evaluate(()=>{const video=document.querySelector('video')!;video.currentTime=20;video.dispatchEvent(new Event('play'));});
  await expect(caption).toHaveText('');
  await page.evaluate(()=>{history.pushState({},'', '/watch?v=lmnopqrstuv');document.dispatchEvent(new Event('yt-navigate-start'));});
  await expect(caption).toHaveText('');await expect(translation).toHaveText('');
  console.log('PASS: long-page viewport translation beyond paragraph 150, dynamic host text/restore, bounded concurrency, late responses and in-place retry; timed sentence segmentation, same-start repaint, latest-only subtitle queue, mode/reload isolation, native playback resume and SPA cleanup. No paid/network provider calls.');
}finally{await browser.close();}
