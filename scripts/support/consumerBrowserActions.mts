import {expect,type Page} from '@playwright/test';
export const webUrl=process.env.SENSA_BROWSER_TEST_URL??'http://127.0.0.1:3001';
export const apiUrl=process.env.SENSA_BROWSER_TEST_API_URL??'http://127.0.0.1:4319';
export async function assertMockServer(page:Page){
 const response=await page.request.get(apiUrl+'/__test/environment');
 expect(response.ok(),'Browser checks must use the no-cost mock server').toBe(true);
 expect(await response.json()).toEqual({semantic:'mock',content:'mock',auth:'synthetic'});
 await page.context().route('**/sensa/**',route=>new URL(route.request().url()).origin===new URL(apiUrl).origin?route.continue():route.abort('blockedbyclient'));
}
export async function login(page:Page,email='test@sensa.invalid'){
 await page.goto(webUrl);await page.getByLabel('邮箱',{exact:true}).fill(email);await page.getByRole('button',{name:'发送验证码',exact:true}).click();await page.getByLabel('验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并继续',exact:true}).click();
}
export async function goHome(page:Page){await page.goto(webUrl);await expect(page.getByRole('heading',{name:'今天',exact:true})).toBeVisible();}
export async function openComposer(page:Page){await expect(page.getByRole('heading',{name:'每天想新学多少个？'})).toBeHidden();await goHome(page);await page.getByRole('button',{name:/记录自己的场景/}).click();await expect(page.getByLabel('原文',{exact:true})).toBeVisible();}
export async function openContent(page:Page){await page.goto(webUrl+'/content');await expect(page.getByRole('heading',{name:'我的内容',exact:true})).toBeVisible();}
export async function openPreferences(page:Page){await page.goto(webUrl+'/study');await page.getByRole('button',{name:'学习偏好',exact:true}).click();}
export async function rate(page:Page,name:string){await page.getByRole('button',{name:new RegExp('^'+name)}).click();}
