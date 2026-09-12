/** No login, mutation, provider request or user data. */
const web=new URL(process.env.SENSA_WEB_ORIGIN),api=new URL(process.env.VITE_SENSA_API_URL);
if(web.protocol!=='https:'||api.protocol!=='https:')throw Error('Hosted HTTPS targets required');

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fetchEventually(url,init,accept,label){
 let lastStatus='no response';
 for(let attempt=1;attempt<=10;attempt++){
  try{
   const response=await fetch(url,{...init,signal:AbortSignal.timeout(20000)});
   lastStatus=String(response.status);
   if(accept(response))return response;
   await response.body?.cancel();
  }catch(error){lastStatus=error instanceof Error?error.message:String(error);}
  if(attempt<10)await wait(3000);
 }
 throw Error(`${label}: ${lastStatus}`);
}

for(const path of ['/','/profile','/study','/sw.js']){
 const r=await fetchEventually(
  new URL(path,web),
  {redirect:'error'},
  response=>response.ok,
  `Web route unavailable: ${path}`,
 );
 const text=await r.text();if(path==='/sw.js'?!text.includes('sensa-shell-'):!text.includes('<html'))throw Error(`Unexpected Web content: ${path}`);
 if(path==='/sw.js'&&!/no-cache/.test(r.headers.get('cache-control')??''))throw Error('Service worker cache policy missing');
}
const unauthorized=await fetchEventually(
 api.href.replace(/\/$/,'')+'/sensa/packages',
 {headers:{Origin:web.origin},redirect:'error'},
 response=>response.status===401,
 'API authentication boundary failed',
);
if((await unauthorized.json()).code!=='authentication_required')throw Error('API authentication boundary failed');
if(unauthorized.headers.get('access-control-allow-origin')!==web.origin)throw Error('Web/API CORS mismatch');
console.log('PASS: public routes, offline shell headers, API auth boundary and Web CORS. Real login, model quality and deletion require separate acceptance.');
