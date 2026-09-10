import {serviceStatusSchema} from '@sensa/contracts/sensa';
import {auth} from '../consumer/client';
export async function readServiceStatus(){
 const session=(await auth?.getSession())?.data.session;
 if(!session)throw new Error('localFlow.statusLogin');
 const endpoint=import.meta.env.VITE_SENSA_API_URL;
 if(!endpoint)throw new Error('localFlow.serviceUnconfigured');
 const response=await fetch(endpoint.replace(/\/+$/,'')+'/sensa/service/status',{headers:{authorization:'Bearer '+session.access_token},signal:AbortSignal.timeout(15000),redirect:'error'});
 if((await auth?.getSession())?.data.session?.user.id!==session.user.id)throw new Error('localFlow.accountChanged');
 if(!response.ok)throw new Error(response.status===403?'localFlow.accessDenied':'localFlow.statusUnavailable');
 return serviceStatusSchema.parse(await response.json());
}
