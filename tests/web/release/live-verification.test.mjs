import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {assertApplicationExecution,preflightApplication,verifyPublicFiles,verifyApiIdentity,verifyTraffic,verifyLiveApplication} from '../../../scripts/release/liveVerification.mjs';
const sha=character=>character.repeat(40),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const versionId='11111111-1111-4111-8111-111111111111';
const env={SENSA_WEB_ORIGIN:'https://learn.example.com',VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SENSA_API_URL:'https://fixture.supabase.co/functions/v1/sensa-api',VITE_SENSA_SUPPORT_URL:'mailto:support@example.com',CLOUDFLARE_ACCOUNT_ID:'c'.repeat(32),CLOUDFLARE_WORKER_NAME:'sensa-standalone',CLOUDFLARE_API_TOKEN:'private-fixture-token'};
const bodies={'index.html':'<html>fixture</html>','sw.js':'// fixture','assets/app.js':'export {};'};
const candidate={commit:sha('b'),webOrigin:env.SENSA_WEB_ORIGIN,apiUrl:env.VITE_SENSA_API_URL,supabaseOrigin:env.VITE_SUPABASE_URL,supportUrl:env.VITE_SENSA_SUPPORT_URL,database:{sha256:'d'.repeat(64)},files:Object.entries(bodies).map(([name,body])=>({path:'apps/web/dist/'+name,bytes:Buffer.byteLength(body),sha256:hash(body)}))};
const previous={api:{releaseSha:sha('a')},web:{versionId},candidate:{manifestSha256:'d'.repeat(64)},verification:{format:'sensa-application-live-verification-v1',apiCommit:sha('a'),webVersionId:versionId,trafficPercentage:100,webOrigin:candidate.webOrigin,apiUrl:candidate.apiUrl,candidateManifestSha256:'d'.repeat(64),verifiedFileCount:3},database:{migrationSetSha256:'d'.repeat(64)},targets:{webOrigin:candidate.webOrigin,apiUrl:candidate.apiUrl,supabaseOrigin:candidate.supabaseOrigin,supportUrl:candidate.supportUrl}};
const plan=mode=>({format:'sensa-system-release-plan-v2',request:{scope:'auto'},source:{commit:candidate.commit,changes:[{path:'apps/web/src/App.tsx',impact:'application'}]},authorization:{outcome:'approved'},decision:{deployApplication:true,applicationMode:mode},previousRelease:{components:{application:previous}}});
const calls=[];
const response=(url,options,commit=sha('b'),percentage=100)=>{
  calls.push({url,options});
  if(url.startsWith('https://api.cloudflare.com/'))return new Response(JSON.stringify({success:true,result:{deployments:[{id:'deployment',versions:[{version_id:versionId,percentage}]}]}}));
  if(url.endsWith('/sensa/release'))return new Response(JSON.stringify({format:'sensa-api-release-v1',commit}));
  return new Response(bodies[new URL(url).pathname.slice(1)]??'wrong');
};

test('Web-only release preserves the proven backend and refuses target, migration or identity drift',async()=>{
  expect(assertApplicationExecution(plan('web-only'),candidate,env)).toEqual({mode:'web-only',apiCommit:sha('a')});
  await expect(preflightApplication(plan('web-only'),candidate,env,(url,options)=>response(url,options,sha('a')))).resolves.toEqual({mode:'web-only',apiCommit:sha('a')});
  for(const change of [{apiUrl:'https://other.supabase.co/functions/v1/sensa-api'},{database:{sha256:'e'.repeat(64)}}])expect(()=>assertApplicationExecution(plan('web-only'),{...candidate,...change},env)).toThrow();
  expect(()=>assertApplicationExecution({...plan('web-only'),previousRelease:null},candidate,env)).toThrow();
  expect(()=>assertApplicationExecution({...plan('web-only'),source:{commit:candidate.commit,changes:[{path:'apps/api/src/app.ts',impact:'application'}]}},candidate,env)).toThrow();
  expect(()=>assertApplicationExecution({...plan('full'),authorization:{outcome:'requires-approval'}},candidate,env)).toThrow();
  await expect(preflightApplication(plan('web-only'),candidate,env,response)).rejects.toThrow(/API build identity/);
  await expect(preflightApplication(plan('web-only'),candidate,env,(url,options)=>response(url,options,sha('a'),50))).rejects.toThrow(/100%/);
});

test('preview and public proof hash actual decoded file bytes instead of only accepting a shell',async()=>{
  await expect(verifyPublicFiles(candidate,candidate.webOrigin,response)).resolves.toMatchObject({verifiedFileCount:3});
  await expect(verifyPublicFiles(candidate,candidate.webOrigin,async()=>new Response('stale version'))).rejects.toThrow(/sealed candidate/);
  await expect(verifyPublicFiles(candidate,candidate.webOrigin,async()=>new Response('redirect',{status:302}))).rejects.toThrow(/redirect/);
  await expect(verifyPublicFiles({...candidate,files:candidate.files.slice(1)},candidate.webOrigin,response)).rejects.toThrow(/Sealed/);
});

test('success proof combines exact API build, public bytes and provider 100% traffic; credentials remain confined',async()=>{
  calls.length=0;
  const version={format:'sensa-cloudflare-version-v1',releaseSha:candidate.commit,versionId};
  const report=await verifyLiveApplication(plan('full'),candidate,version,env,response);
  expect(report).toMatchObject({commit:candidate.commit,apiCommit:candidate.commit,webVersionId:versionId,trafficPercentage:100,verifiedFileCount:3,candidateManifestSha256:hash(JSON.stringify(candidate,null,2)+'\n')});
  expect(JSON.stringify(report)).not.toContain(env.CLOUDFLARE_API_TOKEN);
  expect(calls.every(call=>!call.options.headers.authorization||call.url.startsWith('https://api.cloudflare.com/'))).toBe(true);
  expect(calls.every(call=>call.options.redirect===(new URL(call.url).origin===candidate.webOrigin?'manual':'error'))).toBe(true);
  await expect(verifyApiIdentity(candidate.apiUrl,sha('a'),response)).rejects.toThrow(/identity differs/);
  await expect(verifyTraffic(versionId,env,(url,options)=>response(url,options,sha('b'),50))).rejects.toThrow(/100%/);
  await expect(verifyLiveApplication(plan('full'),candidate,{...version,releaseSha:sha('a')},env,response)).rejects.toThrow(/Uploaded/);
});

test('canonical same-origin asset redirects still prove the original sealed bytes',async()=>{
  const fetchCanonical=async(url,options)=>{
    const parsed=new URL(url);
    if(parsed.pathname==='/index.html')return new Response(null,{status:307,headers:{location:'/'+parsed.search}});
    return parsed.pathname==='/'?new Response(bodies['index.html']):response(url,options);
  };
  await expect(verifyPublicFiles(candidate,candidate.webOrigin,fetchCanonical)).resolves.toMatchObject({verifiedFileCount:3});
  await expect(verifyPublicFiles(candidate,candidate.webOrigin,async(url,options)=>new URL(url).pathname==='/'?new Response('stale shell'):fetchCanonical(url,options))).rejects.toThrow(/sealed candidate/);
});

test('asset redirects cannot leave the approved origin or loop without a bound',async()=>{
  for(const location of ['https://other.example.com/index.html','https://user:password@learn.example.com/','/#fragment']){
    const seen=[];
    await expect(verifyPublicFiles(candidate,candidate.webOrigin,async url=>{seen.push(url);return new Response(null,{status:307,headers:{location}});})).rejects.toThrow(/approved origin/);
    expect(seen.every(url=>new URL(url).origin===candidate.webOrigin&&new URL(url).pathname!=='/')).toBe(true);
  }
  let calls=0;
  await expect(verifyPublicFiles(candidate,candidate.webOrigin,async url=>{calls++;return new Response(null,{status:307,headers:{location:url}});})).rejects.toThrow(/bound/);
  expect(calls).toBeLessThanOrEqual(12);
});
