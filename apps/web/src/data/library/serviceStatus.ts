import {serviceStatusSchema} from '@sensa/contracts/sensa';
import {auth} from '../consumer/client';
export async function readServiceStatus(){
 const session=(await auth?.getSession())?.data.session;
 if(!session)throw new Error('请登录 Sensa 后查看服务状态。');
 const endpoint=import.meta.env.VITE_SENSA_API_URL;
 if(!endpoint)throw new Error('在线服务尚未配置。');
 const response=await fetch(endpoint.replace(/\/+$/,'')+'/sensa/service/status',{headers:{authorization:'Bearer '+session.access_token},signal:AbortSignal.timeout(15000),redirect:'error'});
 if((await auth?.getSession())?.data.session?.user.id!==session.user.id)throw new Error('账号已改变，请重新读取。');
 if(!response.ok)throw new Error(response.status===403?'当前账号尚未获得服务访问权限。':'服务状态暂不可用，请稍后重试。');
 return serviceStatusSchema.parse(await response.json());
}
