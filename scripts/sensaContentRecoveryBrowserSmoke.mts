import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({executablePath:process.env.SENSA_CHROMIUM_PATH,headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
try{
 await page.goto('http://127.0.0.1:3001');await page.getByLabel('邮箱',{exact:true}).fill('test@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续'}).click();await page.getByRole('button',{name:'确认数量并继续'}).click();await page.getByRole('button',{name:'选择学习内容',exact:true}).click();
 await page.getByRole('button',{name:'保存文字材料',exact:true}).click();const input=page.getByLabel('原文',{exact:true});await input.fill('She sat by the bank.');await input.evaluate((el:HTMLTextAreaElement)=>{el.focus();el.setSelectionRange(15,19);document.dispatchEvent(new Event('selectionchange'));});await expect(page.getByText('已定位表达：bank',{exact:true})).toBeVisible();
 const saved=page.waitForResponse(r=>r.url().endsWith('/sensa/sync/push')&&r.request().method()==='POST');await page.getByRole('button',{name:'保存待处理',exact:true}).click();const intake=(await (await saved).json()).results[0].value.intake;
 await page.goto('http://127.0.0.1:3001/?intake='+intake.id);
 let calls=0;page.on('request',r=>{if(r.url().endsWith('/sensa/semantic/lookups')&&r.method()==='POST')calls++;});
 await page.getByRole('button',{name:'查看句中解释',exact:true}).click();await expect(page.getByText('暂时无法确定这个意思，材料仍留在收件箱。',{exact:true})).toBeVisible();
 await page.getByLabel('补充你关心的意思',{exact:true}).fill('我关注河边的地形');await page.getByRole('button',{name:'按关注点重新解释',exact:true}).click();await expect(page.getByText('这里指河边的陆地。',{exact:true})).toBeVisible();expect(calls).toBe(2);
 await page.screenshot({path:'/tmp/sensa-m2-clarification.png',fullPage:true});await page.reload();await page.getByRole('button',{name:'查看句中解释',exact:true}).click();await expect(page.getByText('这里指河边的陆地。',{exact:true})).toBeVisible();expect(calls).toBe(2);
 await page.getByRole('button',{name:'加入 Sensa',exact:true}).click();const confirmed=page.getByRole('region',{name:'已确认的意思'});await expect(confirmed.getByText('当时的关注点：我关注河边的地形',{exact:true})).toBeVisible();await confirmed.getByRole('button',{name:'加入学习',exact:true}).click();await expect(confirmed.getByText('已加入学习，等待内容准备',{exact:true})).toBeVisible();
 // Lose the successful removal response. Reload reconciles the original outbox operation.
 await page.route('**/sensa/sync/push',async route=>{await route.fetch();await route.abort('failed');});await confirmed.getByRole('button',{name:'移出我的内容',exact:true}).click();await expect(page.getByText('操作结果尚未确认，请检查同步结果。本机请求仍保留。',{exact:true})).toBeVisible();await page.unroute('**/sensa/sync/push');await page.reload();await expect(page.getByRole('region',{name:'已确认的意思'})).toHaveCount(0);
 await page.getByText('已移除的内容（1）',{exact:true}).click();await page.getByRole('button',{name:'恢复到我的内容',exact:true}).click();await expect(page.getByRole('region',{name:'已确认的意思'}).getByText('已加入学习，等待内容准备',{exact:true})).toBeVisible();await page.screenshot({path:'/tmp/sensa-m2-restored-meaning.png',fullPage:true});
 console.log('M2 Web recovery passed: manual occurrence, ambiguous resolution, learner focus, reload reuses lookup without paid retry, explicit acceptance/add, lost archive response and restore preserve the target.');
}catch(error){await page.screenshot({path:'/tmp/sensa-m2-recovery-failure.png',fullPage:true});throw error;}finally{await browser.close();}
