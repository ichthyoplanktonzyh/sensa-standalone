import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export async function runCrashChecks(h:any){
 const children=new Set<ReturnType<typeof fork>>();
 async function launch(mode:string,now:Date){
  const child=fork(fileURLToPath(new URL('./consumerCrashFixture.mts',import.meta.url)),[],{execArgv:['--import','tsx'],env:{PATH:process.env.PATH,SENSA_TEST_DATABASE_URL:process.env.SENSA_TEST_DATABASE_URL},silent:true});children.add(child);
  const messages:any[]=[];let failure='';child.stderr?.on('data',chunk=>failure=(failure+String(chunk)).slice(-3000));child.on('message',m=>messages.push(m));
  const wait=async(type:string)=>{const until=Date.now()+15000;while(Date.now()<until){const message=messages.find(m=>m.type===type);if(message)return message;if(child.exitCode!==null||child.signalCode)throw new Error('Crash fixture exited: '+failure);await new Promise(r=>setTimeout(r,25));}throw new Error('Crash fixture timeout: '+type+' '+failure);};
  child.send({mode,now:now.toISOString(),issuer:h.issuer,jwk:h.jwk});const {port}=await wait('ready');
  const call=async(path:string,body?:unknown,bearer?:string)=>{const response=await fetch('http://127.0.0.1:'+port+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:response.status,body:await response.json() as any};};
  const kill=async()=>{if(child.exitCode===null&&!child.signalCode){const ended=new Promise<void>(r=>child.once('exit',()=>r()));child.kill('SIGKILL');await ended;}children.delete(child);};
  return {wait,call,kill};
 }
 try{
  for(const stage of ['generating','validating','committed']){
   const subject=crypto.randomUUID();await h.pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[h.issuer,subject]);const bearer=await h.token(subject),installationId=crypto.randomUUID();await h.initialize(installationId,bearer);const boot=await h.bootstrap(installationId,bearer);
   const send=async(kind:string,payload:any)=>{const response=await h.push(boot,[{kind,payload,operationId:crypto.randomUUID(),occurredAt:h.now().toISOString(),installationId,replicaId:boot.replicaId,dependsOn:[]}],bearer);const result=response.body.results[0];assert.equal(result.status,'accepted',JSON.stringify(result));return result.value;};
   const plan=(await send('plan.confirm_quantity',{expectedRevision:null,dailyNewLimit:5,timeZone:'Asia/Shanghai'})).plan;
   const lookupId=crypto.randomUUID();await h.request('/sensa/semantic/lookups',{id:lookupId,snapshot:{sentence:'She took her time.',language:'en',source:{url:null,title:'Synthetic crash test',capturedAt:h.now().toISOString()},expression:{text:'took',start:4,end:8}}},bearer);
   const meaning=(await send('semantic.accept',{lookupId,expectedRevision:'1',intakeId:null,consent:'accept_context_expression_sense'})).meaning;
   const target=(await send('personal.add_to_learning',{meaningId:meaning.id,expectedRevision:meaning.revision,planId:plan.id,expectedScopeRevision:plan.scopeRevision})).target,id=target.learningTarget.learningTargetId;
   const task=async()=>(await h.pool.query('SELECT * FROM sensa_consumer.provisioning_tasks WHERE learning_target_id=$1 AND superseded_at IS NULL',[id])).rows[0];
   const original=await launch(stage,h.now());const inFlight=original.call('/sensa/provisioning/'+id+'/advance',{},bearer).then(()=>false,()=>true);
   assert.equal((await original.wait('stage')).stage,stage);const before=await task();assert.equal(before.status,stage==='committed'?'ready':stage);assert.equal(before.attempt_count,1);
   await original.kill();assert.equal(await inFlight,true);
   const restarted=await launch('ready',new Date(h.now().getTime()+76000));const recovered=await restarted.call('/sensa/provisioning/'+id+'/advance',{},bearer);assert.equal(recovered.status,200,JSON.stringify(recovered.body));assert.deepEqual((await restarted.call('/__counts')).body,{generates:0,reviews:0});
   if(stage==='committed'){assert.equal(recovered.body.data.plan.materializationId,before.materialization_id);assert.equal((await task()).attempt_count,1);}
   else{assert.equal(recovered.body.data.plan.reason,'attempt_timed_out');assert.equal((await task()).materialization_id,null);await send('learning.retry_preparation',{learningTargetId:id,expectedPlanRevision:recovered.body.data.plan.revision});const ready=await restarted.call('/sensa/provisioning/'+id+'/advance',{},bearer);assert.equal(ready.body.data.plan.readiness,'ready');assert.equal((await task()).attempt_count,2);assert.deepEqual((await restarted.call('/__counts')).body,{generates:1,reviews:1});}
   await restarted.kill();console.log('M2 real process recovery passed: SIGKILL during '+stage+', fresh HTTP API process, same durable target/task, no automatic regeneration.');
  }
 }finally{for(const child of children)child.kill('SIGKILL');}
}
