/** Web tool-loop integration. Live DeepSeek is an explicit opt-in, never CI. */
import assert from 'node:assert/strict';
import {afterAll,test} from 'vitest';
import {build} from 'esbuild';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {indexedDB} from 'fake-indexeddb';
import {makeRequest,validateBundle,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND} from '@sensa/contracts/sensa';
import {readSensaPortableLightweightPackage} from '@sensa/content-validator/portable-lightweight';
import {syntheticSound} from '../../../scripts/support/lightweightMaterialFixture.mts';
const live=process.env.SENSA_TEST_LIVE_DEEPSEEK==='true',base=live?'http://127.0.0.1:4319':'https://agent.fixture.invalid';
const originalFetch=globalThis.fetch;
const session=live?await originalFetch(base+'/__sensa_local/session').then(r=>r.json()):{access_token:'fixture',user:{id:'fixture'}};
Object.assign(globalThis,{indexedDB,window:new EventTarget(),location:{origin:'http://127.0.0.1:9998'},BroadcastChannel:undefined,__agentSession:session});
const compiled=await build({stdin:{resolveDir:process.cwd(),contents:['store','providers','contentGenerationLoop','backgroundPreparation','speech/defaultProvider'].map(name=>`export * from './apps/web/src/data/library/${name}';`).join('\n')},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':JSON.stringify({VITE_SENSA_API_URL:base})},plugins:[{name:'auth',setup(b){b.onLoad({filter:/[/\\]account[/\\]auth\.ts$/},()=>({contents:'export const auth={getSession:async()=>({data:{session:globalThis.__agentSession}})};',loader:'ts'}));}}]});
const temp=await mkdtemp(join(tmpdir(),'sensa-agent-'));await writeFile(join(temp,'core.mjs'),compiled.outputFiles[0].text);
const api=await import(pathToFileURL(join(temp,'core.mjs')).href),id=()=>crypto.randomUUID();
await api.openLibrary();
// Online reference lookup requires an admitted local owner, not only an SDK token.
await api.command({id:id(),kind:'service.local-access',input:{subject:session.user.id}},async(tx:any)=>{tx.put('meta','service-owner',{subject:session.user.id});tx.put('meta','signed-out',false);});
const provider=live?api.defaultSensaProvider:await api.saveProvider(id(),{id:id(),expectedRevision:0,name:'Fixture',kind:'compatible',endpoint:base,model:'fixture'},'test-key');
let cachedSound:any=syntheticSound('borrow','en');
if(live){
 const catalog=JSON.parse(await readFile('release-candidate/portable-catalog.json','utf8'));
 const manifest=JSON.parse(await readFile('apps/web/public'+new URL(catalog.items[0].url).pathname,'utf8'));
 for(const member of manifest.members){
  const archive=readSensaPortableLightweightPackage(await readFile('apps/web/public'+new URL(member.url).pathname));
  if(archive.package.targetExpression.text!=='borrow')continue;
  const pronunciation=archive.package.resources.pronunciation,media=archive.package.media.find((item:any)=>item.mediaId===pronunciation.audioMediaId)!;
  cachedSound={...pronunciation,languageTag:archive.package.route.targetLanguage,audioUrl:`data:${media.mimeType};base64,${Buffer.from(archive.mediaById.get(media.mediaId)!).toString('base64')}`};
 }
}
const image={id:id(),name:'original.jpg',dataUrl:'data:image/jpeg;base64,/9j/2Q=='};
const createRequest=async()=>{
 const request=await makeRequest({id:id(),learner_user_id:id(),learning_target_id:id(),fixed_input:{targetLanguageTag:'en',supportLanguageTag:'zh-CN',senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),planRevision:'fixture',expression:'borrow',expressionKind:'word',meaning:'暂时取得他人物品并预期归还',prototype:'向同伴借伞，之后归还。',anchor:{sentence:'我向同伴借了一把伞，约好用完归还。',images:live?[]:[image],contextVersion:'fixture',grantId:id()},...(live?{pronunciation:cachedSound}:{}) ,demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND}},id(),new Date());
 request.attemptBudget={maxModelTurns:8,maxToolCalls:24,timeoutMs:240000};
 request.approvedTools=api.contentAgentTools.map((t:any)=>({toolKey:t.function.name,toolVersion:'v1',description:t.function.description,inputSchemaId:'fixture.'+t.function.name,inputSchemaVersion:'v1',inputJsonSchema:t.function.parameters,outputContextKinds:['reference_fact'],outputMaterialRoleKeys:[],maxCalls:24}));return request;
};
const cue={role:'experience_recall_cue',payload:{scene:'我向同伴借了一把伞，约好用完归还。',senseFocus:'临时使用并归还',imageIds:[]}};
const bridge={role:'scene_bridge',payload:{text:'从取得者视角描述暂时使用他人的物品，并准备归还。',meaningRendering:{meaning:'暂时取得他人物品并预期归还',languageTag:'zh-CN'}}};
const scene={role:'scene_realization',payload:{example:'I borrow an umbrella.',targetStart:2,targetEnd:8,experienceResourceKey:'experience_recall_cue:0'}};
const tool=(name:string,args:unknown={})=>({id:id(),type:'function',function:{name,arguments:JSON.stringify(args)}});
afterAll(async()=>{globalThis.fetch=originalFetch;await rm(temp,{recursive:true,force:true});});
 if(live){
  await test('opt-in live model tool loop admits a validated candidate',async()=>{
  const request=await createRequest(),steps:any[]=[];let liveCheckpoint:any;
  const bundle=await api.generateLearningCandidate(request,provider,true,new AbortController().signal,async(s:any)=>{steps.push(s);console.log(`Live round ${s.round}: ${s.tool??'candidate'} ${s.accepted?'accepted':'repair'}`);},undefined,async(checkpoint:any)=>{liveCheckpoint=checkpoint;await mkdir('.sensa-local',{recursive:true});await writeFile('.sensa-local/agent-live-checkpoint.json',JSON.stringify(checkpoint,null,2));});
  assert.match(bundle.model,/deepseek/i);const checked=await validateBundle(request,bundle,null,new Date());if(!checked.content)console.log(JSON.stringify({issues:checked.issues,contentIssues:checked.contentIssues,draft:liveCheckpoint?.resources}));assert(checked.content);
  assert(bundle.toolCalls.length>0,'real model used the tool loop');
  await mkdir('.sensa-local',{recursive:true});await writeFile('.sensa-local/agent-live-smoke.json',JSON.stringify({model:bundle.model,steps,resources:bundle.candidates.map((c:any)=>({role:c.materialRoleKey,payload:c.contentPayload})),usage:bundle.usage},null,2));
  });
 }else{
  for(const interrupted of [false,true]){
   await test(interrupted?'checkpoint resume preserves partial resources after an offline interruption':'tool-loop repairs a partial candidate while retaining the original image',async()=>{
   let turn=0,speechCalls=0,referenceCalls=0,inflight=0,peak=0,checkpoint:any;
   const restoreSpeech=api.replaceClientSpeechProvider({id:`fixture-${interrupted}`,revision:1,displayName:'Fixture',synthesize:async(input:any)=>{speechCalls++;inflight++;peak=Math.max(peak,inflight);await new Promise(r=>setTimeout(r,5));inflight--;return {...syntheticSound(input.surface,input.languageTag),method:'tts'};}});
   const responses=[[tool('prepare_pronunciation'),tool('prepare_pronunciation'),tool('lookup_references'),tool('lookup_references')],[tool('submit_resources',{resources:[cue,bridge,{...scene,payload:{...scene.payload,example:'I borroweded an umbrella.'}}]})],[tool('validate_resources')],[tool('submit_resources',{resources:[scene]})],[tool('validate_resources')]];
   globalThis.fetch=async(url,options)=>{
    if(String(url).endsWith('/sensa/resource-facts')){
     inflight++;peak=Math.max(peak,inflight);await new Promise(r=>setTimeout(r,5));inflight--;
     referenceCalls++;return new Response(JSON.stringify({input:JSON.parse(String(options?.body)),references:[]}));
    }
    const body=JSON.parse(String(options?.body));assert(body.tools.length===4);assert(body.messages[1].content.some((p:any)=>p.type==='image_url'&&p.image_url.url===image.dataUrl));
    if(interrupted&&turn===2){turn++;throw Error('simulated offline');}
    const index=interrupted&&turn>2?turn-1:turn;turn++;
    return new Response(JSON.stringify({model:'fixture',choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:responses[index]}}]}));
   };
   const request=await createRequest();const run=()=>api.generateLearningCandidate(request,provider,true,new AbortController().signal,async()=>{},checkpoint,async(c:any)=>{checkpoint=c;});
   if(interrupted){await assert.rejects(run(),/simulated offline/);assert.equal(checkpoint.resources.length,2);}
   const bundle=await run(),result=await validateBundle(request,bundle,null,new Date());assert(result.content);
   assert.equal(speechCalls,1);assert.equal(referenceCalls,1);assert.equal(peak,2);
   assert.deepEqual(bundle.candidates.find((c:any)=>c.materialRoleKey==='experience_recall_cue').contentPayload.images,[image]);
   assert.equal(bundle.candidates.find((c:any)=>c.materialRoleKey==='scene_realization').contentPayload.targetEnd,8);
   assert(bundle.toolCalls.length>=6);assert(checkpoint.history.some((m:any)=>m.role==='tool'&&m.content.includes('target text not found')));
   restoreSpeech();
   });
  }
  for(const responseKind of ['direct-json','validate-tool','prepare-tool']){
   await test(`speech service failure stops ${responseKind} without spending further model turns`,async()=>{
    let modelCalls=0,checkpoint:any;
    const restoreSpeech=api.replaceClientSpeechProvider({id:'unavailable',revision:1,displayName:'Unavailable',synthesize:async()=>{throw Error('edge_tts_connection_failed');}});
    const resources=[cue,bridge,scene];
    globalThis.fetch=async(url,options)=>{
     if(String(url).endsWith('/sensa/resource-facts'))return new Response(JSON.stringify({input:JSON.parse(String(options?.body)),references:[]}));
     modelCalls++;
     const message=responseKind==='direct-json'?{content:JSON.stringify({resources})}:{content:null,tool_calls:responseKind==='validate-tool'?[tool('submit_resources',{resources}),tool('validate_resources')]:[tool('prepare_pronunciation')]};
     return new Response(JSON.stringify({model:'fixture',choices:[{finish_reason:responseKind==='direct-json'?'stop':'tool_calls',message}]}));
    };
    try{
     await assert.rejects(api.generateLearningCandidate(await createRequest(),provider,true,new AbortController().signal,async()=>{},undefined,async(c:any)=>{checkpoint=c;}),/localFlow.spokenResourceUnavailable/);
     assert.equal(modelCalls,1,'a speech outage cannot be repaired by another model turn');
     assert.equal(checkpoint.resources.length,responseKind==='prepare-tool'?0:3,'the candidate remains recoverable');
    }finally{restoreSpeech();}
   });
  }
  await test('background queue bounds concurrency, deduplicates and cancels pending work',async()=>{
  const queue=new api.BackgroundPreparationQueue(2);let active=0,max=0;const released:(()=>void)[]=[];
  const work=()=>new Promise<void>(resolve=>{active++;max=Math.max(max,active);released.push(()=>{active--;resolve();});});
  const first=queue.run('one',work),same=queue.run('one',work),second=queue.run('two',work),third=queue.run('three',work);assert.equal(first,same);
  await Promise.resolve();assert.equal(max,2);released.shift()!();await first;await Promise.resolve();released.shift()!();released.shift()!();await Promise.all([second,third]);assert.equal(max,2);
  let ran=false;const cancelled=queue.run('cancel',async(signal:AbortSignal)=>{signal.throwIfAborted();ran=true;});queue.cancel('cancel');await assert.rejects(cancelled);assert.equal(ran,false);
  });
 }
