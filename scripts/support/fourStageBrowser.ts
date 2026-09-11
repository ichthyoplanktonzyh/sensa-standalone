import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect,type Page} from '@playwright/test';
import {fourStageQueue,fourStageContent} from '../../apps/web/src/data/library/fourStage';
import type {InstalledPackage} from '../../apps/web/src/data/library/packages';

export async function runFourStageBrowser({page,rows,pack}:{page:Page;rows:(table:string)=>Promise<any[]>;pack:InstalledPackage}){
 const details=page.locator('#s-learning-target'),entry=page.locator('#s-learning-entry');
 const choose=async()=>{
  await details.getByRole('button',{name:'更换',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('radio')).toHaveCount(2);
  await dialog.getByRole('radio',{name:'四阶段交错学习',exact:true}).click();
  await expect(dialog.getByRole('radio',{name:'四阶段交错学习',exact:true})).toHaveAttribute('aria-checked','true');
  await dialog.getByRole('button',{name:'关闭学习偏好',exact:true}).click();
 };
 await choose();await details.getByRole('button',{name:'返回',exact:true}).click();
 await entry.getByRole('button',{name:'查看 lend 的详情',exact:true}).click();await choose();
 assert((await rows('learningTargets')).every(t=>t.policyProfileId==='interleaved_four_stage'));
 await details.getByRole('button',{name:'开始 / 继续学习',exact:true}).click();await page.getByRole('button',{name:'确认数量并开始',exact:true}).click();
 const runtime=page.locator('#s-four-stage-runtime');await expect(runtime).toBeVisible();
 await mkdir('/tmp/sensa-four-stage',{recursive:true});let steps=0,failed=false,reloaded=false;const seen=new Set<string>(),firstTargets:string[]=[];
 while(steps++<70){
  const run=(await rows('learningRuns')).find(r=>r.protocolState);if(run.completedAt)break;
  assert.equal(run.targetIds.length,2);
  const queue=fourStageQueue(run),session=queue.getCurrentSession()!;
  if(!reloaded&&steps>3){
   const revision=run.revision;await page.reload();await expect(runtime).toBeVisible();
   await runtime.getByRole('button',{name:'暂时退出学习',exact:true}).click();
   await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');
   await page.goto(new URL('/?flow=lightweight',page.url()).href);await expect(runtime.getByText(/^Stage [1-4]/).first()).toBeVisible();
   await page.screenshot({path:'/tmp/sensa-four-stage/english-resume.png'});
   await runtime.getByRole('button',{name:'Pause learning',exact:true}).click();
   await page.getByRole('combobox',{name:'Interface language',exact:true}).selectOption('zh-CN');
   await page.goto(new URL('/?flow=lightweight',page.url()).href);await expect(runtime).toBeVisible();
   assert.equal((await rows('learningRuns'))[0].revision,revision);reloaded=true;
  }
  if('presentation' in session&&!seen.has(session.presentation)){
   seen.add(session.presentation);await page.screenshot({path:'/tmp/sensa-four-stage/'+session.presentation+'.png'});
   await page.setViewportSize({width:390,height:844});assert(await runtime.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:'/tmp/sensa-four-stage/'+session.presentation+'-mobile.png'});await page.setViewportSize({width:1280,height:900});
  }
  if(session.phase==='feedback')await runtime.getByRole('button',{name:'继续穿插学习',exact:true}).click();
  else if('presentation' in session){
   if(firstTargets.length<2)firstTargets.push(session.targetId);
   const target=(await rows('learningTargets')).find(t=>t.id===session.targetId),content=fourStageContent(target,pack);
   if(session.presentation==='meaning_choice'||session.presentation==='sound_choice'){
    if(session.presentation==='sound_choice')await runtime.getByRole('button',{name:'▶ 播放目标发音',exact:true}).click();
    const option=content.recognitionAssessment.options.find(o=>o.isCorrect)!;
    await runtime.getByRole('button',{name:option.textL1+' 选择',exact:true}).click();
   }else if(session.presentation==='context_recall'&&!failed){failed=true;await runtime.getByRole('button',{name:'没有认出 四阶段清零',exact:true}).click();}
   else await runtime.getByRole('button',{name:session.presentation==='context_recall'?'认出来了 进入下一阶段':'认识 完成这个目标',exact:true}).click();
  }
  await expect.poll(async()=>(await rows('learningRuns'))[0].revision).toBe(run.revision+1);
 }
 assert.equal(new Set(firstTargets).size,2);assert.equal(seen.size,4);assert(failed&&reloaded);
 await expect(runtime.getByRole('heading',{name:'2 个目标已连续通过四阶段',exact:true})).toBeVisible();
 await runtime.getByRole('button',{name:'完成并回到首页',exact:true}).click();
 const targets=await rows('learningTargets');assert(targets.every(t=>t.memoryRevision===1));
 const due=Math.max(...targets.map(t=>t.memory.dueAt.getTime()))+1000;
 await page.clock.install({time:due});await page.reload();
 // The same target detail starts the registered retention Surface once due.
 await page.goto(new URL('/study/learning-entry',page.url()).href);await entry.getByRole('button',{name:/Borrow & lend/}).click();
 await entry.getByRole('button',{name:'查看 borrow 的详情',exact:true}).click();
 await expect(details.getByRole('button',{name:'更换',exact:true})).toHaveCount(0);
 await details.getByRole('button',{name:'开始 / 继续复习',exact:true}).click();
 const review=page.locator('#s-four-stage-review-runtime');await expect(review).toBeVisible();let forgotten=false,sawRepair=false;
 while(steps++<100){
  const run=(await rows('learningRuns')).find(r=>r.purpose==='retention_review');assert(run);if(run.completedAt)break;
  const session=fourStageQueue(run).getCurrentSession()!;
  if(session.phase==='feedback')await review.getByRole('button',{name:'继续',exact:true}).click();
  else if('mode' in session){
   if(session.mode==='relearning')sawRepair=true;
   await review.getByRole('button',{name:!forgotten?'忘记了 Again · 进入重学':session.mode==='relearning'?'认识 完成重学':'认识 Good',exact:true}).click();forgotten=true;
  }
  await expect.poll(async()=>(await rows('learningRuns')).find(r=>r.id===run.id).revision).toBe(run.revision+1);
 }
 assert(sawRepair);assert((await rows('learningTargets')).every(t=>t.memoryRevision===2&&!t.relearnAt));
 await expect(review.getByRole('heading',{name:'2 个目标已处理',exact:true})).toBeVisible();
 await page.screenshot({path:'/tmp/sensa-four-stage/review-complete.png'});
 await review.getByRole('button',{name:'完成并回到首页',exact:true}).click();
 await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');
 await page.goto(new URL('/study/learning-entry',page.url()).href);await entry.getByRole('button',{name:/Borrow & lend/}).click();
 await entry.getByRole('button',{name:'View details for borrow',exact:true}).click();
 await expect(details.getByText('Interleaved four-stage learning',{exact:true})).toBeVisible();
 console.log('PASS: real four-stage selection, original four-stage pages, two-target interleaving, failure/reset, audio, refresh, mobile, due review/relearning and English target method. No provider calls.');
}
