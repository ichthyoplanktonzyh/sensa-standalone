const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function fetchEventually(url,init,accept,label){
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

export async function verifyHostedWeb(origin){
 const web=new URL(origin);
 if(web.protocol!=='https:')throw Error('Hosted Web HTTPS target required');
 for(const path of ['/','/profile','/study','/sw.js']){
  const response=await fetchEventually(new URL(path,web),{redirect:'error'},value=>value.ok,`Web route unavailable: ${path}`);
  const body=await response.text();
  if(path==='/sw.js'?!body.includes('sensa-shell-'):!body.includes('<html'))throw Error(`Unexpected Web content: ${path}`);
  if(path==='/sw.js'&&!/no-cache/.test(response.headers.get('cache-control')??''))throw Error('Service worker cache policy missing');
 }
 const integrationAssets={
  '/integrations/sensa-mcp.mjs':/^#!\/usr\/bin\/env node/u,
  '/integrations/SKILL.md':/sensa-managed: "true"/u,
  '/integrations/request-example.json':/"contractVersion": "sensa-intake-v3"/u,
 };
 for(const [path,expected] of Object.entries(integrationAssets)){
  const response=await fetchEventually(new URL(path,web),{redirect:'error'},value=>value.ok,`Agent integration unavailable: ${path}`);
  if(!expected.test(await response.text()))throw Error(`Unexpected Agent integration content: ${path}`);
  if(!/no-cache/.test(response.headers.get('cache-control')??''))throw Error(`Agent integration cache policy missing: ${path}`);
 }
 return web;
}

export async function verifyHostedApi(web,endpoint){
 const api=new URL(endpoint);
 if(api.protocol!=='https:')throw Error('Hosted API HTTPS target required');
 const unauthorized=await fetchEventually(
  api.href.replace(/\/$/,'')+'/sensa/packages',
  {headers:{Origin:web.origin},redirect:'error'},
  response=>response.status===401,
  'API authentication boundary failed',
 );
 if((await unauthorized.json()).code!=='authentication_required')throw Error('API authentication boundary failed');
 if(unauthorized.headers.get('access-control-allow-origin')!==web.origin)throw Error('Web/API CORS mismatch');
 const invalidSetup=await fetchEventually(
  api.href.replace(/\/$/,'')+'/sensa/agent/connection-setups/exchange',
  {method:'POST',headers:{Origin:web.origin,'content-type':'application/json'},body:JSON.stringify({contractVersion:'sensa-agent-connection-v1',setupId:'00000000-0000-4000-8000-000000000001',setupCode:'sensa_setup_invalid-invalid-invalid-invalid'}),redirect:'error'},
  response=>response.status===401,
  'Agent setup exchange boundary failed',
 );
 if((await invalidSetup.json()).code!=='agent_setup_invalid')throw Error('Agent setup exchange boundary failed');
}
