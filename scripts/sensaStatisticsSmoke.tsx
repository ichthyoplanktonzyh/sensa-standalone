import assert from 'node:assert/strict';
import React, {act} from 'react';
import {Window} from 'happy-dom';
import {StatsScreen} from '../apps/web/src/experience/components/StatsScreen';
import {projectLearningStatistics} from '../apps/web/src/experience/learningJourney/learningStatistics';
import type {LearningRecordView} from '../apps/web/src/experience/learningJourney/learningHistory';
import i18n from '../apps/web/src/i18n';

const now=new Date(2026,2,10,12);
const record=(id:string,date:Date,kind:LearningRecordView['kind']='retention_review'):LearningRecordView=>({
  recordId:id,targetId:'borrow-receive',expression:'borrow',occurredAt:date.toISOString(),kind,label:'',detail:'',
});
const records=[
  record('start',new Date(2026,2,4,0),'initial_learning'),
  record('before',new Date(2026,2,3,23,59)),
  record('today',new Date(2026,2,10,0),'relearning'),
  record('future',new Date(2026,2,11)),
];
const base={now,range:'week' as const,start:'',end:'',kind:'all' as const};
const week=projectLearningStatistics([...records,records[0],{...records[0],recordId:'bad',occurredAt:'invalid'}],base);
assert.deepEqual(week.records.map(item=>item.recordId),['today','start'],'local seven-day boundary is inclusive; future, invalid and duplicate records excluded');
assert.deepEqual(week.counts,{initial_learning:1,retention_review:0,relearning:1});
assert.equal(projectLearningStatistics(records,{...base,range:'custom',start:'2026-02-30',end:'2026-03-10'}).invalidRange,true);
assert.equal(projectLearningStatistics(records,{...base,range:'custom',start:'2026-03-10',end:'2026-03-09'}).invalidRange,true);
assert.equal(projectLearningStatistics(records,{...base,range:'custom',start:'2026-03-04',end:'2026-03-04'}).records.length,1);
assert.equal(projectLearningStatistics(records,{...base,kind:'relearning'}).records.length,1);

async function main(){
  const window=new Window({url:'http://localhost:3000/study/stats'});
  Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,Event:window.Event,IS_REACT_ACT_ENVIRONMENT:true});
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);
  const root=createRoot(container);
  let back=0,target='';
  const props={active:true,onBack:()=>back++,onOpenTarget:(id:string)=>{target=id;}};
  const current=new Date();
  const yesterday=new Date(current);yesterday.setDate(yesterday.getDate()-1);
  const data=[record('a',current,'initial_learning'),record('b',yesterday)];
  await act(()=>root.render(<StatsScreen {...props} records={data}/>));
  const click=async(label:string)=>{
    const button=[...container.querySelectorAll('button')].find(item=>item.textContent===label||item.getAttribute('aria-label')===label);
    assert.ok(button,label);await act(()=>button.click());
  };
  assert.equal(container.querySelectorAll('ol li').length,2);
  await click('今天');assert.equal(container.querySelectorAll('ol li').length,1);
  await act(()=>container.querySelector<HTMLButtonElement>('ol button')!.click());assert.equal(target,'borrow-receive');
  const select=container.querySelector('select')!;
  await act(()=>{select.value='retention_review';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.ok(container.textContent?.includes('这个范围内没有可用记录'));
  await click('查看全部记录');assert.equal(container.querySelectorAll('ol li').length,2);
  await click('自选日期');
  const inputs=container.querySelectorAll('input');
  await act(()=>{
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(inputs[0],'');
    inputs[0].dispatchEvent(new window.Event('input',{bubbles:true}));
  });
  assert.ok(container.querySelector('[role="alert"]'));
  assert.equal(container.querySelector('dl'),null,'invalid filter does not masquerade as zero activity');
  await click('全部可用记录');
  await act(()=>root.render(<StatsScreen {...props} records={[]}/>));
  assert.ok(container.textContent?.includes('还没有可用的学习记录'));
  assert.deepEqual([...container.querySelectorAll('dd')].map(item=>item.textContent),['0','0','0']);
  await act(()=>i18n.changeLanguage('en'));
  assert.ok(container.textContent?.includes('Learning statistics'));
  assert.ok(container.textContent?.includes('not a complete history'));
  await click('Back');assert.equal(back,1);
  await act(()=>root.unmount());await window.happyDOM.abort();
  console.log('Statistics smoke passed: local dates, invalid ranges, deduplication, shared-record counts, filters, empty states, navigation and i18n. No provider calls.');
}
void main();
