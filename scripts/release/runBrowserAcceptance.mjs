import {spawn,spawnSync} from 'node:child_process';
import {mkdir,open,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const mode=process.argv[2];
if(!['connected','local'].includes(mode))throw Error('Use runBrowserAcceptance.mjs connected|local');
const artifacts=resolve(process.env.SENSA_ACCEPTANCE_ARTIFACT_DIR??'/tmp/sensa-release-acceptance');
await mkdir(artifacts,{recursive:true});
const services=[];

async function start(name,command,args,env=process.env){
 const log=await open(resolve(artifacts,`${name}.log`),'w');
 const child=spawn(command,args,{env,stdio:['ignore',log.fd,log.fd]});
 child.once('exit',()=>log.close());
 services.push({name,child,log:resolve(artifacts,`${name}.log`)});
 return child;
}

async function waitFor(url,child,requireOk){
 let last='no response';
 for(let attempt=0;attempt<60;attempt++){
  if(child.exitCode!==null)throw Error(`Service exited before readiness: ${url}`);
  try{const response=await fetch(url,{signal:AbortSignal.timeout(1000)});last=String(response.status);if(!requireOk||response.ok){await response.body?.cancel();return;}await response.body?.cancel();}catch(error){last=error instanceof Error?error.message:String(error);}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error(`Service readiness timed out (${last}): ${url}`);
}

function run(name,args,env=process.env){
 const result=spawnSync('npm',['run',name,...args],{env,stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(`${name} failed with exit ${result.status}`);
}

async function stop(){
 for(const {child} of services)if(child.exitCode===null)child.kill('SIGTERM');
 await Promise.all(services.map(({child})=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});})));
}

try{
 if(mode==='connected'){
  const api=await start('consumer-api',process.execPath,['--import','tsx','scripts/sensaConsumerAccountSmoke.mts','--targets','--serve']);
  const web=await start('web-preview','npm',['run','preview','-w','@sensa/web','--','--port','3001']);
  await Promise.all([waitFor('http://127.0.0.1:4319/auth/v1/otp',api,false),waitFor('http://127.0.0.1:3001',web,true)]);
  run('sensa:consumer-browser-smoke',[],{...process.env,SENSA_BROWSER_ARTIFACT_DIR:resolve(artifacts,'consumer')});
  run('sensa:extension-browser-smoke',[]);
 }else{
  run('build',['-w','@sensa/web'],{...process.env,VITE_SENSA_MODE:'production',VITE_SUPABASE_URL:'http://127.0.0.1:4399',VITE_SUPABASE_PUBLISHABLE_KEY:'synthetic-test-key',VITE_SENSA_API_URL:'http://127.0.0.1:4399'});
  const web=await start('local-web-preview','npm',['run','preview','-w','@sensa/web','--','--port','3014'],{...process.env,VITE_SENSA_MODE:'production'});
  await waitFor('http://127.0.0.1:3014',web,true);
  run('sensa:web-local-journey-smoke',[]);
  run('sensa:expression-chat-browser-smoke',[]);
 }
}catch(error){
 for(const service of services){try{const log=await readFile(service.log,'utf8');console.error(`\n${service.name} log:\n${log.slice(-12000)}`);}catch{}}
 throw error;
}finally{await stop();}
