import assert from 'node:assert/strict';
import {expect,type Page} from '@playwright/test';
export const personalFixtureProposal={explanation:'临时使用并归还。',expression:{surface:'borrow',type:'word',language:'en'},semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'临时取得他人物品，并预期归还。',prototypeScenes:[{summary:'一个人向同伴借用物品，约好稍后归还。',participantRoles:['借用者','所有者'],states:['临时使用'],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]}};
async function rows(page:Page,name:string){return page.evaluate(async name=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('sensa:local-library:v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const values=await new Promise<any[]>((resolve,reject)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return values;},name);}
export async function runPersonalIntakeBrowserChecks(page:Page,origin:string){
 // This scenario intentionally exercises optional review interruption and recovery.
 const slowId=crypto.randomUUID(),fastId=crypto.randomUUID();
 await page.goto(origin+'/profile?intakeFixture='+slowId);
 // tsx preserves nested function names using this helper in serialized test callbacks.
 await page.evaluate('globalThis.__name = (fn) => fn');
 await page.evaluate(({slowId,fastId,proposal})=>{
  const request=(operationId:string,fast:boolean)=>({version:'sensa-intake-v1',libraryId:'',clientId:crypto.randomUUID(),operationId,snapshot:{sentence:'May asked to borrow an umbrella.',language:'en',source:{url:'https://example.org/fixture',title:fast?'快轨资料':'慢轨资料',capturedAt:new Date().toISOString()},expression:{text:'borrow',start:13,end:19}},resolution:fast?{kind:'proposal',proposal}:null,acceptance:fast?{kind:'direct',consent:'accept_context_expression_sense',authorization:'browser:explicit_accept_button'}:null});
  const queue=[request(slowId,false),request(fastId,true)];
  window.addEventListener('message',event=>{const q=event.data;if(event.source!==window||q?.channel!=='sensa-web-intake-request')return;let value:unknown;
   if(q.kind==='web-connect-prepare')value={connected:true};
   else if(q.kind==='web-delivery-config')value={configured:true};
   else if(q.kind==='web-intake-pull')value=queue.map((r:any)=>({...r,libraryId:q.libraryId}));
   else{const i=queue.findIndex(r=>r.operationId===q.receipt?.operationId);if(i>=0)queue.splice(i,1);value={ok:true};}
   window.postMessage({channel:'sensa-web-intake-response',id:q.id,value},location.origin);
  });
 },{slowId,fastId,proposal:personalFixtureProposal});
 await page.getByRole('button',{name:/模型服务/}).click();
 await page.getByText('高级设置 · 自定义模型服务',{exact:true}).click();
 const reviewToggle=page.getByLabel('启用额外模型审核',{exact:true});
 await expect(reviewToggle).not.toBeChecked();await reviewToggle.click();await expect(reviewToggle).toBeChecked();
 await expect.poll(async()=> (await rows(page,'settings')).some(s=>s.modelReviewEnabled===true)).toBe(true);
 await expect.poll(async()=> (await rows(page,'drafts')).length,{timeout:30000}).toBe(2);
 assert.equal((await rows(page,'meanings')).length,1);assert.equal((await rows(page,'personalLearning')).length,0);
 await page.goto(origin+'/personal-meaning?meaningId='+slowId);
 await page.getByRole('complementary').getByLabel('界面语言',{exact:true}).selectOption('en');
 await expect(page.getByLabel('What would you like to express?',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Continue conversation',exact:true}).click();
 await page.getByRole('complementary').getByLabel('Interface language',{exact:true}).selectOption('zh-CN');await expect(page.getByText('这件物品是否需要归还？',{exact:true})).toBeVisible();await page.getByLabel('你想表达什么？').fill('是的，之后需要归还。');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(async()=> (await rows(page,'sessions')).find(s=>s.draftId===slowId)?.status).toBe('proposal');
 // Existing confirmation layer, no shortcut into the database.
 await page.getByRole('button',{name:'保存这个表达',exact:true}).click();await expect(page.getByRole('heading',{name:'内容详情',exact:true})).toBeVisible();
 const controls=page.getByRole('region',{name:'个人内容学习准备'});await controls.getByRole('button',{name:'加入学习',exact:true}).click();assert.equal((await rows(page,'learningTargets')).length,0);
 await expect(controls.getByRole('button',{name:'重试 / 恢复准备',exact:true})).toBeVisible({timeout:15000});await page.getByRole('complementary').getByLabel('界面语言',{exact:true}).selectOption('en');
 const englishControls=page.getByRole('region',{name:'Personal learning preparation',exact:true});await expect(englishControls.getByRole('button',{name:'Retry / resume preparation',exact:true})).toBeVisible();assert(!/[\u4e00-\u9fff]/u.test(await englishControls.innerText()));
 await page.getByRole('complementary').getByLabel('Interface language',{exact:true}).selectOption('zh-CN');
 const attempts=await rows(page,'contentAttempts');assert(attempts[0].bundle);assert.equal((await rows(page,'learningTargets')).length,0);
 const task=(await rows(page,'personalLearning'))[0];await page.goto(origin+'/learning-target?targetId='+task.targetId);await expect(page.getByRole('region',{name:'个人内容学习准备'}).getByRole('button',{name:'重试 / 恢复准备',exact:true})).toBeVisible();
 await page.goto(origin+'/personal-meaning?meaningId='+slowId);await page.reload();await page.getByRole('region',{name:'个人内容学习准备'}).getByRole('button',{name:'重试 / 恢复准备',exact:true}).click();await expect(page.getByRole('button',{name:'开始 / 继续学习',exact:true})).toBeVisible({timeout:15000});assert.equal((await rows(page,'contentAttempts')).length,2);
 await page.getByRole('button',{name:'开始 / 继续学习',exact:true}).click();await page.getByRole('button',{name:'确认数量并开始',exact:true}).click();await page.getByRole('button',{name:'显示表达',exact:true}).click();await page.getByRole('button',{name:/顺利想起/}).click();await expect(page.getByText('本次首次学习已完成',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('本次首次学习已完成',{exact:true})).toBeVisible();assert.equal((await rows(page,'learningTargets'))[0].memoryRevision,1);
 const runtimeUrl=page.url();await page.goto(origin+'/profile');await page.getByRole('complementary').getByLabel('界面语言',{exact:true}).selectOption('en');await page.goto(runtimeUrl);await expect(page.locator('#s-lightweight-runtime').getByText('Initial learning completed',{exact:true})).toBeVisible();
 await page.goto(origin+'/profile');await page.getByRole('complementary').getByLabel('Interface language',{exact:true}).selectOption('zh-CN');
 await page.goto(origin+'/personal-meaning?meaningId='+fastId);await expect(page.getByRole('heading',{name:'内容详情',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'加入学习',exact:true})).toBeVisible();await page.getByRole('button',{name:'加入学习',exact:true}).click();await expect(page.getByRole('button',{name:'开始 / 继续学习',exact:true})).toBeVisible();assert.equal((await rows(page,'learningTargets')).length,1,'Same semantic identity reuses runtime target without new generation');
 for(const width of [390,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
}
