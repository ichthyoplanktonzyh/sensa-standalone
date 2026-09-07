import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { LearningEntryScreen } from '../apps/web/src/experience/components/learning/LearningEntryScreen';
import { LearningTargetDetailScreen } from '../apps/web/src/experience/components/learning/LearningTargetDetailScreen';
import { LearningPolicyScreen } from '../apps/web/src/experience/components/learning/LearningPolicyScreen';
import { PROTOTYPE_LEARNING_TARGETS } from '../apps/web/src/experience/learningJourney/prototypeLearning';
import type { PrototypeLearningPolicy } from '../apps/web/src/experience/learningJourney/prototypeLearning';
import i18n from '../apps/web/src/i18n';

async function main() {
  const window = new Window({url:'http://localhost:3000/study/learning-entry'});
  Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,Event:window.Event,IS_REACT_ACT_ENVIRONMENT:true});
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');
  document.body.append(container);
  const root=createRoot(container);
  let opened='',backs=0,worlds=0;
  const click=async (label:string)=>{
    const button=[...container.querySelectorAll('button')].find(item=>item.textContent===label);
    assert.ok(button,'Missing button: '+label);
    await act(()=>button.click());
  };
  await act(()=>root.render(<LearningEntryScreen active onBack={()=>backs++} onOpenTarget={id=>{opened=id;}} onOpenPersonalSemanticWorld={()=>worlds++}/>));
  assert.equal(opened,'','browsing must not implicitly select a target');
  assert.equal(container.querySelectorAll('li').length,2);
  assert.ok(!container.textContent?.includes('tactful'),'personal sample is not a catalog membership');
  await click('词书内容');
  assert.equal(container.querySelectorAll('li').length,1);
  await act(()=>container.querySelector<HTMLButtonElement>('li button')!.click());
  assert.equal(opened,'lend-give');
  await click('全部内容');
  const input=container.querySelector('input')!;
  await act(()=>{
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(input,'no-such-meaning');
    input.dispatchEvent(new window.Event('input',{bubbles:true}));
  });
  assert.equal(container.querySelectorAll('li').length,0);
  assert.ok(container.textContent?.includes('没有找到匹配'));
  await click('清空搜索');
  assert.equal(container.querySelectorAll('li').length,2);
  await click('前往查看');assert.equal(worlds,1);

  let saved:PrototypeLearningPolicy|null=null;
  const policyProps={active:true,target:null,selectedPolicy:'lightweight' as PrototypeLearningPolicy,onBack:()=>backs++,onSelect:(policy:PrototypeLearningPolicy)=>{saved=policy;}};
  await act(()=>root.render(<LearningPolicyScreen {...policyProps}/>));
  const radio=container.querySelector<HTMLInputElement>('input[value="high_assurance"]')!;
  await act(()=>radio.click());
  assert.equal(saved,null,'draft selection does not persist');
  await click('返回');assert.equal(saved,null,'cancel leaves policy unchanged');
  await act(()=>root.render(<LearningPolicyScreen {...policyProps} active={false}/>));
  await act(()=>root.render(<LearningPolicyScreen {...policyProps}/>));
  assert.ok(container.querySelector<HTMLInputElement>('input[value="lightweight"]')!.checked,'re-entry resets cancelled draft');
  await act(()=>container.querySelector<HTMLInputElement>('input[value="high_assurance"]')!.click());
  await click('确认学习方式');assert.equal(saved,'high_assurance');
  const beforeError=backs;
  await act(()=>root.render(<LearningPolicyScreen {...policyProps} onSelect={()=>{throw new Error('save failed');}}/>));
  await click('确认学习方式');
  assert.ok(container.querySelector('[role="alert"]'));
  assert.equal(backs,beforeError,'failed save must keep the page open');
  await act(()=>root.render(<LearningPolicyScreen {...policyProps} target={PROTOTYPE_LEARNING_TARGETS['tactful-expression']}/>));
  assert.ok(container.querySelectorAll('input:disabled').length>0,'unsupported methods are unavailable');

  let action='';
  const props:React.ComponentProps<typeof LearningTargetDetailScreen>={
    active:true,target:PROTOTYPE_LEARNING_TARGETS['borrow-receive'],selectedPolicy:'lightweight',
    preparation:'preparing',committedPolicy:null,initialCompletionKind:null,reviewDue:false,
    relearning:false,retentionRuntimeState:null,nextReviewLabel:null,declaredMastery:false,isAdded:false,
    onBack:()=>{},onAdd:()=>{action='add';},onOpenPolicy:()=>{action='policy';},onOpenSource:()=>{},
    onRefreshPreparation:()=>{action='check';},onGoHome:()=>{action='home';},onStartReview:()=>{action='review';},
    onContinueRetentionRuntime:()=>{action='retention';},onContinueRuntime:()=>{action='continue';},
    onRevokeDeclaredMastery:()=>{action='restore';},
  };
  await act(()=>root.render(<LearningTargetDetailScreen {...props}/>));
  await click('加入我的学习');assert.equal(action,'add','preparing target can join curriculum');
  await act(()=>root.render(<LearningTargetDetailScreen {...props} isAdded/>));
  await click('重新检查准备情况');assert.equal(action,'check');
  assert.ok(container.textContent?.includes('内容仍在准备'));
  await act(()=>root.render(<LearningTargetDetailScreen {...props} isAdded committedPolicy="lightweight"/>));
  await click('继续学习');assert.equal(action,'continue');
  assert.ok(![...container.querySelectorAll('button')].some(button=>button.textContent==='更换'));
  await act(()=>root.render(<LearningTargetDetailScreen {...props} isAdded initialCompletionKind="study_completion" reviewDue retentionRuntimeState="relearning_retest"/>));
  await click('继续巩固');assert.equal(action,'retention','active retention work wins over new review');
  await act(()=>root.render(<LearningTargetDetailScreen {...props} isAdded declaredMastery retentionRuntimeState="reviewing"/>));
  await click('恢复学习');assert.equal(action,'restore','declaration wins over active work');
  await act(()=>i18n.changeLanguage('en'));
  assert.ok(container.textContent?.includes('Marked as known'));
  await act(()=>root.unmount());
  await window.happyDOM.abort();
  console.log('Learning setup smoke passed: catalog search/filter, explicit selection, policy draft/cancel/save/error, unavailable methods, target action precedence, language switching. No provider calls.');
}
void main();
