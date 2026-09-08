import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({executablePath:process.env.SENSA_CHROMIUM_PATH,headless:true});
try{
 for(const broken of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  try{
   await page.goto('http://127.0.0.1:3001');await page.getByLabel('邮箱',{exact:true}).fill(broken?'second@sensa.invalid':'test@sensa.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续'}).click();await page.getByRole('button',{name:'确认数量并继续'}).click();await page.getByRole('button',{name:'选择学习内容',exact:true}).click();
   await page.getByRole('button',{name:'保存文字材料',exact:true}).click();const input=page.getByLabel('原文',{exact:true});await input.fill('She took her time, then took a seat.');await input.evaluate((el:HTMLTextAreaElement)=>{el.focus();el.setSelectionRange(4,8);document.dispatchEvent(new Event('selectionchange'));});await expect(page.getByText('已定位表达：took',{exact:true})).toBeVisible();await page.getByRole('button',{name:'保存待处理',exact:true}).click();await page.getByRole('button',{name:'查看句中解释',exact:true}).click();await page.getByRole('button',{name:'加入 Sensa',exact:true}).click();const meaning=page.getByRole('region',{name:'已确认的意思'});await meaning.getByRole('button',{name:'加入学习',exact:true}).click();await meaning.getByRole('button',{name:'准备 / 检查学习内容',exact:true}).click();await expect(meaning.getByText('学习内容已准备好',{exact:true})).toBeVisible();await meaning.getByRole('button',{name:'回首页',exact:true}).click();
   if(broken)await page.route('**/sensa/materializations/*/media/*',route=>route.fulfill({status:200,contentType:'audio/mpeg',body:'wrong digest'}));
   await page.getByRole('button',{name:'开始学习',exact:true}).click();await expect(page.getByRole('button',{name:'查看表达',exact:true})).toBeVisible();await expect(page.getByLabel('学习表达发音')).toHaveCount(0);await page.getByRole('button',{name:'查看表达',exact:true}).click();
   if(broken){await expect(page.getByText('发音音频暂不可用，可继续文字学习。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'想起来了',exact:true})).toBeEnabled();}
   else{const audio=page.getByLabel('学习表达发音');await expect(audio).toBeVisible();await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.readyState)).toBeGreaterThan(0);await context.setOffline(true);await audio.evaluate((el:HTMLAudioElement)=>el.play());await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.currentTime)).toBeGreaterThan(0);await audio.evaluate((el:HTMLAudioElement)=>el.pause());await context.setOffline(false);}
   await page.screenshot({path:broken?'/tmp/sensa-m2-audio-unavailable.png':'/tmp/sensa-m2-audio-ready.png',fullPage:true});await page.getByRole('button',{name:'想起来了',exact:true}).click();await expect(page.getByRole('heading',{name:'已完成首次学习',exact:true})).toBeVisible();
  }catch(e){await page.screenshot({path:'/tmp/sensa-m2-audio-failure.png',fullPage:true});throw e;}finally{await context.close();}
 }
 console.log('M2 pronunciation browser passed: private on-demand target, static expression binding, recall hides audio, reveal plays cached MP3 offline, corrupt media cannot block text or completion.');
}finally{await browser.close();}
