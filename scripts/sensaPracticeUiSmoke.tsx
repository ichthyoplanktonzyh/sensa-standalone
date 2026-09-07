import assert from 'node:assert/strict';
import React,{act} from 'react';
import {Window} from 'happy-dom';
import {SensaFreePracticeScreen} from '../apps/web/src/experience/components/SensaFreePracticeScreen';
import {PracticeScopeScreen} from '../apps/web/src/experience/components/PracticeScopeScreen';
import {YouGlishListeningScreen} from '../apps/web/src/experience/components/YouGlishListeningScreen';
import {resolvePracticeScopeCatalog} from '../apps/web/src/experience/practiceScope';
import i18n from '../apps/web/src/i18n';
async function main(){
 const window=new Window({url:'http://localhost:3000/academy'});
 Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,Event:window.Event,IS_REACT_ACT_ENVIRONMENT:true});
 let closed=0,fetches=0,fail=true;
 window.YG={Widget:class {
  events:any;
  constructor(_id:unknown,options:any){const effectiveComponents=options.components?options.components:255;assert.equal(Number(effectiveComponents),0,'provider defaulting must not re-enable search, title or captions');this.events=options.events;}
  fetch(){fetches++;queueMicrotask(()=>fail?this.events.onError({}):(this.events.onFetchDone({totalResult:3}),this.events.onCaptionChange({caption:encodeURIComponent('A [[[fragile]]] connection.')})));}
  play(){} pause(){} replay(){} move(){} next(){} previous(){} setSpeed(){} close(){closed++;}
 }};
 const {createRoot}=await import('react-dom/client');
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const catalog=resolvePracticeScopeCatalog({selection:{sourceId:'current_study'},personalMeanings:[]});
 let entered=0,back=0;
 await act(()=>root.render(<SensaFreePracticeScreen active onBack={()=>{}} onOpenPracticeScope={()=>{}} onOpenRealWorldListening={()=>{entered++;}} practiceScope={catalog.currentScope}/>));
 assert.equal(container.querySelectorAll('button:disabled').length,3);
 await act(()=>[...container.querySelectorAll('button')].find(button=>button.textContent?.includes('开始练习'))!.click());assert.equal(entered,1);
 await act(()=>root.render(<PracticeScopeScreen active catalog={catalog} onBack={()=>{back++;}} onSelectScope={()=>{}}/>));
 await act(()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='更换范围')!.click());
 assert.equal(container.querySelectorAll('button:disabled').length,1);
 await act(()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='返回')!.click());assert.equal(back,0);
 await act(()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='返回')!.click());assert.equal(back,1);
 const props={active:true,targets:catalog.currentScope.targets,onBack:()=>{},toast:()=>{}};
 await act(async()=>{root.render(<YouGlishListeningScreen {...props}/>);});
 assert.ok(container.textContent?.includes('片段加载失败'));
 assert.ok(container.querySelector<HTMLButtonElement>('button[aria-label="播放"]')!.disabled);
 fail=false;
 await act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent==='重新加载')!.click();});
 assert.ok(container.textContent?.includes('3 个片段'));assert.equal(container.querySelector('mark')?.textContent,'fragile','custom captions retain highlighted expression');assert.equal(fetches,2);assert.ok(closed>=1);
 await act(()=>i18n.changeLanguage('en'));assert.ok(container.textContent?.includes('Real-world speech'));
 const closes=closed;
 await act(()=>root.render(<YouGlishListeningScreen {...props} active={false}/>));assert.equal(closed,closes+1);
 await act(()=>root.unmount());window.happyDOM.abort();
 console.log('Practice UI smoke passed: capability states, scope back flow, player retry, disabled controls, teardown, i18n. No provider requests.');
}
void main();
