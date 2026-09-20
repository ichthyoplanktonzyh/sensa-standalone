/** Explicit real-provider acceptance; never included in ordinary checks. */
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {indexedDB} from 'fake-indexeddb';
import {loadLocalModelEnvironment} from './local/sensaLocalModelEnvironment.mjs';
import {makeRequest,validateBundle,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND} from '@sensa/contracts/sensa';
if(!process.argv.includes('--allow-real-models'))throw Error('Explicit --allow-real-models is required; this test incurs real provider usage.');
const env=loadLocalModelEnvironment({root:process.cwd(),enabled:true,environment:process.env});
const base='http://127.0.0.1:4319',output=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)??'.sensa-local/acceptance'),realFetch=globalThis.fetch;
const session=await realFetch(base+'/__sensa_local/session').then(r=>r.json());
Object.assign(globalThis,{indexedDB,window:new EventTarget(),location:{origin:'http://127.0.0.1:9998'},BroadcastChannel:undefined,__acceptanceSession:session});
const bundled=await build({stdin:{resolveDir:process.cwd(),contents:['store','providers','transport','contentGenerationLoop','backgroundPreparation'].map(n=>`export * from './apps/web/src/data/library/${n}';`).join('\n')},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':JSON.stringify({VITE_SENSA_API_URL:base})},plugins:[{name:'local-session',setup(b){b.onLoad({filter:/[/\\]account[/\\]auth\.ts$/},()=>({contents:'export const auth={getSession:async()=>({data:{session:globalThis.__acceptanceSession}})};',loader:'ts'}));}}]});
const temporary=await mkdtemp(join(tmpdir(),'sensa-acceptance-'));await writeFile(join(temporary,'runtime.mjs'),bundled.outputFiles[0].text);
const api=await import(pathToFileURL(join(temporary,'runtime.mjs')).href),id=()=>crypto.randomUUID();
await api.openLibrary();
const provider=await api.saveProvider(id(),{id:id(),expectedRevision:0,name:'Project DeepSeek acceptance',kind:'compatible',endpoint:'https://api.deepseek.com',model:env.SENSA_CONTENT_MODEL??env.SENSA_SEMANTIC_MODEL??'deepseek-flash'},env.DEEPSEEK_API_KEY);
await mkdir(output,{recursive:true});
execFileSync('python3',['-c',"from PIL import Image,ImageDraw; import sys; im=Image.new('RGB',(640,360),'white'); d=ImageDraw.Draw(im); d.ellipse((65,100,225,260),fill=(30,100,210)); d.rectangle((415,100,575,260),fill=(215,55,45)); im.save(sys.argv[1],quality=90)",join(output,'spatial-context.jpg')]);
const picture={id:id(),name:'spatial-context.jpg',dataUrl:'data:image/jpeg;base64,'+(await readFile(join(output,'spatial-context.jpg'))).toString('base64')};
const cases=[
 {key:'generic-word',expression:'fragile',expressionKind:'word',meaning:'物体容易破损，需要小心对待',prototype:'一个容易破损的物品需要小心搬动。',personal:false,text:'',images:[]},
 {key:'personal-word',expression:'borrow',expressionKind:'word',meaning:'暂时取得他人物品，并预期归还',prototype:'向他人借用物品，之后归还。',personal:true,text:'昨天我向同事借了一把伞，并约好今天归还。',images:[]},
 {key:'image-only-phrase',expression:'on the left',expressionKind:'phrase',meaning:'处于观察者所见的左侧位置',prototype:'一个对象位于另一对象的左侧。',personal:true,text:'',images:[picture]},
 {key:'image-text-phrase',expression:'on the left',expressionKind:'phrase',meaning:'处于观察者所见的左侧位置',prototype:'一个对象位于另一对象的左侧。',personal:true,text:'这是我摆放的两个图形：蓝色圆形在左边，红色正方形在右边。',images:[picture]},
 {key:'personal-construction',expression:'Would you mind if …?',expressionKind:'construction',spokenForm:'Would you mind if I opened the window?',formParts:[{kind:'fixed',text:'Would you mind if'},{kind:'slot',text:'clause',constraint:'提出希望获准进行的动作'},{kind:'fixed',text:'?'}],meaning:'委婉询问对方是否介意自己做某事，以征求许可',prototype:'希望先征求同事同意，再打开窗户。',personal:true,text:'房间有点闷。我想先征求同事的同意，再打开窗户。',images:[]},
 {key:'personal-sentence',expression:'The meeting starts at nine.',expressionKind:'sentence',meaning:'告知会议在九点开始',prototype:'告知会议的开始时间。',personal:true,text:'同事告诉我，会议九点开始。',images:[]},
];
const selected=process.argv.find(a=>a.startsWith('--case='))?.slice(7),results:any[]=[];
await mkdir(output,{recursive:true});
try{
 for(const test of cases.filter(c=>!selected||c.key===selected)){
  const steps:any[]=[],errors:any[]=[];let request:any,checkpoint:any;
  globalThis.fetch=async(url,options)=>{const response=await realFetch(url,options);if(!response.ok&&String(url).startsWith('https://api.deepseek.com')){const error=await response.clone().json().catch(()=>({}));errors.push({status:response.status,code:error.error?.code,type:error.error?.type,message:String(error.error?.message??'').replaceAll(env.DEEPSEEK_API_KEY,'[redacted]').slice(0,500)});}return response;};
  const result:any={case:test.key,model:provider.model,input:test,startedAt:new Date().toISOString()};
  try{
   const semanticSpec={schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:test.meaning,prototypeScenes:[{summary:test.prototype,participantRoles:[],states:[],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]};
   request=await makeRequest({id:id(),learner_user_id:id(),learning_target_id:id(),fixed_input:{targetLanguageTag:'en',supportLanguageTag:'zh-CN',senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),planRevision:'acceptance',expression:test.expression,expressionKind:test.expressionKind,spokenForm:test.spokenForm,formParts:test.formParts,semanticSpec,meaning:test.meaning,prototype:test.prototype,...(test.personal?{anchor:{sentence:test.text,images:test.images,contextVersion:'acceptance',grantId:id()}}:{}),demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND}},id(),new Date());
   request.attemptBudget={maxModelTurns:8,maxToolCalls:24,timeoutMs:240000};
   request.approvedTools=api.contentAgentTools.map((t:any)=>({toolKey:t.function.name,toolVersion:'v1',description:t.function.description,inputSchemaId:'acceptance.'+t.function.name,inputSchemaVersion:'v1',inputJsonSchema:t.function.parameters,outputContextKinds:['reference_fact'],outputMaterialRoleKeys:[],maxCalls:24}));
   console.log(`START ${test.key}`);
   const bundle=await api.backgroundPreparation.run(test.key,async(signal:AbortSignal)=>{
    result.bundle=await api.generateLearningCandidate(request,provider,test.personal,signal,async(step:any)=>{steps.push(step);console.log(`${test.key} round ${step.round}: ${step.tool??'candidate'} ${step.accepted?'ok':'repair'}`);},undefined,async(state:any)=>{checkpoint=state;});
   }).then(()=>result.bundle);
   const checked=await validateBundle(request,bundle,null,new Date());result.contractAccepted=!!checked.content;result.issues=[...checked.issues,...checked.contentIssues];result.resources=bundle.candidates.map((c:any)=>({role:c.materialRoleKey,payload:c.contentPayload}));result.plan=checked.content?.resourcePlan;
   const cue=bundle.candidates.find((c:any)=>c.materialRoleKey==='experience_recall_cue');
   result.originalImagesRetained=JSON.stringify(cue?.contentPayload.images??[])===JSON.stringify(test.images);
   result.accepted=result.contractAccepted&&result.originalImagesRetained;
   delete result.bundle;
  }catch(error){delete result.bundle;result.accepted=false;result.error=error instanceof Error?error.message:'failed';}
  result.steps=steps;result.providerErrors=errors;result.finishedAt=new Date().toISOString();
  await writeFile(join(output,test.key+'.json'),JSON.stringify({...result,checkpoint},null,2));
  const {input,resources,plan,...summary}=result;results.push(summary);await writeFile(join(output,selected?'summary-'+selected+'.json':'summary.json'),JSON.stringify(results,null,2));
  console.log(`RESULT ${test.key}: ${result.accepted?'PASS':'NOT ACCEPTED'} ${result.error??JSON.stringify(result.issues)}`);
 }
}finally{globalThis.fetch=realFetch;api.clearAllCredentials();await rm(temporary,{recursive:true,force:true});}
