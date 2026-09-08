import type {ReadingRequest} from '@sensa/contracts/sensa';
export const readingError=(error:unknown)=>({
  provider_not_configured:'请先在阅读设置中配置模型连接。',provider_vault_unavailable:'服务端尚未启用安全凭据存储，请联系服务维护者。',
  provider_origin_not_allowed:'此服务地址尚未获服务端支持，请使用设置中列出的服务。',provider_key_required:'请输入该连接的 API Key。',
  settings_conflict:'设置已在另一处更新，请重新加载后再保存。',provider_auth_failed:'模型连接认证失败，请检查密钥。',
  provider_rate_limited:'模型服务正在限流，请稍后重试。',reading_daily_budget:'今日阅读请求额度已用完，保存原文仍可使用。',
  reading_busy:'还有阅读请求正在处理，请稍后重试。',reading_timeout:'请求超时，请重试。',authentication_required:'请先连接 Sensa 账号。',
  account_mismatch:'账号已变化，请重新打开阅读模式。',provider_invalid_response:'模型返回的内容不完整，请重试。',
}[error instanceof Error?error.message:String(error)]??'暂时无法完成，请检查连接后重试。');
export async function runReading(accountId:string,feature:ReadingRequest['feature'],text:string,context='',instruction='',id=crypto.randomUUID()):Promise<string>{
  const response=await chrome.runtime.sendMessage({kind:'reading-run',accountId,pageUrl:location.href,input:{id,feature,text,context,instruction}});
  if(response.error)throw new Error(response.error);
  if(response.value.status!=='ready')throw new Error(response.value.error??'reading_busy');
  return response.value.text;
}
