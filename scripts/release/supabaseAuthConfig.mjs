/** Reconcile the production Supabase Auth redirect boundary without exposing config secrets. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const apiOrigin='https://api.supabase.com';

export function desiredAuthRedirectConfig(environment=process.env){
 const projectRef=environment.SUPABASE_PROJECT_REF??'';
 if(!/^[a-z0-9]{20}$/.test(projectRef))throw Error('Invalid Supabase project ref');
 const target=new URL(environment.SENSA_WEB_ORIGIN??'');
 if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||target.origin!==target.href.replace(/\/$/,''))throw Error('Production Web origin must be an HTTPS origin');
 return {projectRef,siteUrl:target.origin,uriAllowList:`${target.origin}/**`};
}

function normalizedAllowList(value){
 return typeof value==='string'?value.split(',').map(item=>item.trim()).filter(Boolean).sort():[];
}

export function authRedirectConfigMatches(config,desired){
 let configuredOrigin;
 try{configuredOrigin=new URL(config?.site_url).origin;}catch{return false;}
 return configuredOrigin===desired.siteUrl&&
  JSON.stringify(normalizedAllowList(config?.uri_allow_list))===JSON.stringify([desired.uriAllowList]);
}

async function requestConfig(fetchImpl,url,accessToken,init={}){
 const response=await fetchImpl(url,{...init,headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`Supabase Auth configuration request failed (${response.status})`);
 return response.json();
}

export async function reconcileSupabaseAuth({mode='check',environment=process.env,fetchImpl=fetch}={}){
 if(!['check','apply'].includes(mode))throw Error('Expected --check or --apply');
 const accessToken=environment.SUPABASE_ACCESS_TOKEN??'';
 if(!accessToken)throw Error('Supabase access token required');
 const desired=desiredAuthRedirectConfig(environment);
 const endpoint=`${apiOrigin}/v1/projects/${desired.projectRef}/config/auth`;
 let current=await requestConfig(fetchImpl,endpoint,accessToken);
 if(!authRedirectConfigMatches(current,desired)&&mode==='apply'){
  await requestConfig(fetchImpl,endpoint,accessToken,{method:'PATCH',body:JSON.stringify({site_url:desired.siteUrl,uri_allow_list:desired.uriAllowList})});
  current=await requestConfig(fetchImpl,endpoint,accessToken);
 }
 if(!authRedirectConfigMatches(current,desired))throw Error('Supabase Auth redirect configuration does not match the production Web origin');
 console.log(`${mode==='apply'?'Reconciled':'Verified'} Supabase Auth redirect boundary for ${desired.siteUrl}.`);
 return desired;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2]==='--apply'?'apply':process.argv[2]==='--check'||!process.argv[2]?'check':process.argv[2];
 reconcileSupabaseAuth({mode}).catch(error=>{console.error(error instanceof Error?error.message:'Supabase Auth configuration failed');process.exitCode=1;});
}
