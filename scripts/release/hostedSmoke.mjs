/** No login, mutation, provider request or user data. */
const web=new URL(process.env.SENSA_WEB_ORIGIN),api=new URL(process.env.VITE_SENSA_API_URL);
if(web.protocol!=='https:'||api.protocol!=='https:')throw Error('Hosted HTTPS targets required');
for(const path of ['/','/profile','/study','/sw.js']){
 const r=await fetch(new URL(path,web),{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(`Web route unavailable: ${path}`);
 const text=await r.text();if(path==='/sw.js'?!text.includes('sensa-shell-'):!text.includes('<html'))throw Error(`Unexpected Web content: ${path}`);
 if(path==='/sw.js'&&!/no-cache/.test(r.headers.get('cache-control')??''))throw Error('Service worker cache policy missing');
}
const unauthorized=await fetch(api.href.replace(/\/$/,'')+'/sensa/packages',{headers:{Origin:web.origin},redirect:'error',signal:AbortSignal.timeout(20000)});
if(unauthorized.status!==401||(await unauthorized.json()).code!=='authentication_required')throw Error('API authentication boundary failed');
if(unauthorized.headers.get('access-control-allow-origin')!==web.origin)throw Error('Web/API CORS mismatch');
console.log('PASS: public routes, offline shell headers, API auth boundary and Web CORS. Real login, model quality and deletion require separate acceptance.');
