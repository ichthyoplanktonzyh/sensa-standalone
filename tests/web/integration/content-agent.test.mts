/** Web tool-loop integration. Live DeepSeek is an explicit opt-in, never CI. */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {indexedDB} from 'fake-indexeddb';
import {makeRequest,validateBundle,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND} from '@sensa/contracts/sensa';
import {syntheticSound} from '../../../scripts/support/lightweightMaterialFixture.mts';
const live=process.argv.includes('--live-deepseek'),base=live?'http://127.0.0.1:4319':'https://agent.fixture.invalid';
const originalFetch=globalThis.fetch;
const session=live?await originalFetch(base+'/__sensa_local/session').then(r=>r.json()):{access_token:'fixture',user:{id:'fixture'}};
Object.assign(globalThis,{indexedDB,window:new EventTarget(),location:{origin:'http://127.0.0.1:9998'},BroadcastChannel:undefined,__agentSession:session});
const compiled=await build({stdin:{resolveDir:process.cwd(),contents:['store','providers','contentGenerationLoop','backgroundPreparation','speech/defaultProvider'].map(name=>`export * from './apps/web/src/data/library/${name}';`).join('\n')},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':JSON.stringify({VITE_SENSA_API_URL:base})},plugins:[{name:'auth',setup(b){b.onLoad({filter:/[/\\]account[/\\]auth\.ts$/},()=>({contents:'export const auth={getSession:async()=>({data:{session:globalThis.__agentSession}})};',loader:'ts'}));}}]});
const temp=await mkdtemp(join(tmpdir(),'sensa-agent-'));await writeFile(join(temp,'core.mjs'),compiled.outputFiles[0].text);
const api=await import(pathToFileURL(join(temp,'core.mjs')).href),id=()=>crypto.randomUUID();
await api.openLibrary();
const provider=live?api.defaultSensaProvider:await api.saveProvider(id(),{id:id(),expectedRevision:0,name:'Fixture',kind:'compatible',endpoint:base,model:'fixture'},'test-key');
let cachedSound=syntheticSound('borrow','en');
if(live){const catalog=JSON.parse(await readFile('release-candidate/catalog.json','utf8'));const book=JSON.parse(await readFile('apps/web/public'+new URL(catalog.items[0].url).pathname,'utf8'));cachedSound=book.entries.find((e:any)=>e.expression==='borrow').content.resources.find((r:any)=>r.materialRoleKey==='pronunciation').contentPayload;}
const image={id:id(),name:'original.jpg',dataUrl:'data:image/jpeg;base64,/9j/2Q=='};
const createRequest=async()=>{
 const request=await makeRequest({id:id(),learner_user_id:id(),learning_target_id:id(),fixed_input:{targetLanguageTag:'en',supportLanguageTag:'zh-CN',senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),planRevision:'fixture',expression:'borrow',expressionKind:'word',meaning:'暂时取得他人物品并预期归还',prototype:'向同伴借伞，之后归还。',anchor:{sentence:'我向同伴借了一把伞，约好用完归还。',images:live?[]:[image],contextVersion:'fixture',grantId:id()},...(live?{pronunciation:cachedSound}:{}) ,demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND}},id(),new Date());
 request.attemptBudget={maxModelTurns:8,maxToolCalls:24,timeoutMs:240000};
 request.approvedTools=api.contentAgentTools.map((t:any)=>({toolKey:t.function.name,toolVersion:'v1',description:t.function.description,inputSchemaId:'fixture.'+t.function.name,inputSchemaVersion:'v1',inputJsonSchema:t.function.parameters,outputContextKinds:['reference_fact'],outputMaterialRoleKeys:[],maxCalls:24}));return request;
};
const cue={role:'experience_recall_cue',payload:{scene:'我向同伴借了一把伞，约好用完归还。',senseFocus:'临时使用并归还',imageIds:[]}};
const bridge={role:'scene_bridge',payload:{text:'从取得者视角描述暂时使用他人的物品，并准备归还。'}};
const scene={role:'scene_realization',payload:{example:'I borrow an umbrella.',targetStart:2,targetEnd:8,experienceResourceKey:'experience_recall_cue:0'}};
const tool=(name:string,args:unknown={})=>({id:id(),type:'function',function:{name,arguments:JSON.stringify(args)}});
try{
 if(live){
  const request=await createRequest(),steps:any[]=[];let liveCheckpoint:any;
  const bundle=await api.generateLearningCandidate(request,provider,true,new AbortController().signal,async(s:any)=>{steps.push(s);console.log(`Live round ${s.round}: ${s.tool??'candidate'} ${s.accepted?'accepted':'repair'}`);},undefined,async(checkpoint:any)=>{liveCheckpoint=checkpoint;await mkdir('.sensa-local',{recursive:true});await writeFile('.sensa-local/agent-live-checkpoint.json',JSON.stringify(checkpoint,null,2));});
  assert.match(bundle.model,/deepseek/i);const checked=await validateBundle(request,bundle,null,new Date());if(!checked.content)console.log(JSON.stringify({issues:checked.issues,contentIssues:checked.contentIssues,draft:liveCheckpoint?.resources}));assert(checked.content);
  assert(bundle.toolCalls.length>0,'real model used the tool loop');
  await mkdir('.sensa-local',{recursive:true});await writeFile('.sensa-local/agent-live-smoke.json',JSON.stringify({model:bundle.model,steps,resources:bundle.candidates.map((c:any)=>({role:c.materialRoleKey,payload:c.contentPayload})),usage:bundle.usage},null,2));
  console.log('PASS: real configured DeepSeek via managed Genkit; Web tool loop and final admission. Synthetic example, no user data changed; cached existing sound, no TTS call.');
 }else{
  for(const interrupted of [false,true]){
   let turn=0,speechCalls=0,referenceCalls=0,inflight=0,peak=0,checkpoint:any;
   const restoreSpeech=api.replaceClientSpeechProvider({id:`fixture-${interrupted}`,revision:1,displayName:'Fixture',synthesize:async(input:any)=>{speechCalls++;inflight++;peak=Math.max(peak,inflight);await new Promise(r=>setTimeout(r,5));inflight--;return {...syntheticSound(input.surface,input.languageTag),method:'tts'};}});
   const responses=[[tool('prepare_pronunciation'),tool('lookup_references')],[tool('submit_resources',{resources:[cue,bridge,{...scene,payload:{...scene.payload,example:'I borroweded an umbrella.'}}]})],[tool('validate_resources')],[tool('submit_resources',{resources:[scene]})],[tool('validate_resources')]];
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
  }
  const queue=new api.BackgroundPreparationQueue(2);let active=0,max=0;const released:(()=>void)[]=[];
  const work=()=>new Promise<void>(resolve=>{active++;max=Math.max(max,active);released.push(()=>{active--;resolve();});});
  const first=queue.run('one',work),same=queue.run('one',work),second=queue.run('two',work),third=queue.run('three',work);assert.equal(first,same);
  await Promise.resolve();assert.equal(max,2);released.shift()!();await first;await Promise.resolve();released.shift()!();released.shift()!();await Promise.all([second,third]);assert.equal(max,2);
  let ran=false;const cancelled=queue.run('cancel',async(signal:AbortSignal)=>{signal.throwIfAborted();ran=true;});queue.cancel('cancel');await assert.rejects(cancelled);assert.equal(ran,false);
  console.log('PASS: real Web tool loop, parallel cached sources, partial repair, checkpoint resume, original image retention, bounded background concurrency, deduplication and cancellation. No browser or paid calls.');
 }
}finally{globalThis.fetch=originalFetch;await rm(temp,{recursive:true,force:true});}
