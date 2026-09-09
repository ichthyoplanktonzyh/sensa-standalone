import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Hono} from 'hono';
import {createNativeSemanticRoutes,semanticDigest} from '../apps/api/src/sensa/personal/nativeSemantic.ts';
import {ConsumerError} from '../apps/api/src/sensa/access/auth.ts';
import {semanticProposalSchema} from '../packages/contracts/src/sensa/consumer/semantic.ts';
const proposal={explanation:'这里表示说话得体，顾及他人感受。',expression:{surface:'tactful',type:'word',language:'en'},semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'Speaking with care for another person’s feelings.',prototypeScenes:[{summary:'A person handles a sensitive conversation with care.',participantRoles:['speaker','listener'],states:[],directionOrCausality:null}],includedCases:[],excludedCases:['merely staying silent'],neighborContrasts:[],openQuestions:[]}};
const cases:any[]=[proposal];
for(const edit of [v=>{v.extra=true;},v=>{v.explanation='';},v=>{v.explanation='x'.repeat(2001);},v=>{v.expression.language='zh';},v=>{v.expression.type='lexeme';},v=>{v.semanticSpec.openQuestions=['which meaning?'];},v=>{v.semanticSpec.prototypeScenes=[];},v=>{v.semanticSpec.prototypeScenes[0].summary=' ';},v=>{delete v.semanticSpec.prototypeScenes[0].directionOrCausality;},v=>{v.semanticSpec.includedCases=[1];},v=>{v.semanticSpec.includedCases=['x'.repeat(17000)];},v=>{v.expression.surface=' tactful ';v.explanation=' yes ';},v=>{v.semanticSpec.coreMeaningFocus='😀\n" meaning';}]){const v=structuredClone(proposal);edit(v);cases.push(v);}
for(const field of ['type','language']){const v=structuredClone(proposal);v.expression[field]+=' ';cases.push(v);}
const spaced=structuredClone(proposal);spaced.semanticSpec.schemaVersion+=' ';cases.push(spaced);
const rust=spawnSync('cargo',['run','--quiet','--locked','-p','sensa-library','--example','semantic_contract'],{input:JSON.stringify(cases),encoding:'utf8'});
assert.equal(rust.status,0,rust.stderr);
const expected=cases.map(v=>{const p=semanticProposalSchema.safeParse(v);return p.success?{accepted:true,proposal:p.data}:{accepted:false};});
assert.deepEqual(JSON.parse(rust.stdout),expected);
let calls=0;
const requests=new Set<string>();
const app=new Hono();
app.route('/sensa/native/semantic',createNativeSemanticRoutes(async request=>{
 if(request.headers.get('Authorization')!=='Bearer local-native-test')throw new ConsumerError(401,'access_required');
 return async(snapshot,focus)=>{calls++;
  if(focus?.text==='simulate invalid')return {proposal:{...proposal,unexpected:true} as any,provider:'fixture',model:'no-cost'};
  if(focus?.text==='simulate failure')throw new Error('Synthetic provider unavailable');
  if(snapshot.expression!.text==='crane'&&!focus)return {proposal:null,provider:'fixture',model:'no-cost',policyVersion:'consumer-semantic-v4'};
  const p=structuredClone(proposal);p.expression.surface=snapshot.expression!.text;
  if(p.expression.surface==='crane'){p.explanation='这里指吊运重物的起重机。';p.semanticSpec.coreMeaningFocus='A machine for lifting heavy loads.';p.semanticSpec.prototypeScenes[0].summary='A crane lifts a heavy load.';}
  return {proposal:semanticProposalSchema.parse(p),provider:'fixture',model:'no-cost',policyVersion:'consumer-semantic-v4'};
 };
},async(_request,input)=>{if(requests.has(input.id))throw new ConsumerError(409,'native_request_consumed');requests.add(input.id);}));
const base={version:'sensa-native-semantic-v1',id:crypto.randomUUID(),snapshot:{sentence:'She was tactful.',language:'en',source:{url:null,title:'fixture',capturedAt:'2026-09-09T00:00:00Z'},expression:{text:'tactful',start:8,end:15}},focus:null};
const input={...base,inputDigest:await semanticDigest(base)};
const post=(body:unknown,token='local-native-test')=>app.request('/sensa/native/semantic/resolve',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
assert.equal((await post(input,'wrong')).status,401);assert.equal(calls,0);
assert.equal((await post({...input,inputDigest:'0'.repeat(64)})).status,400);assert.equal(calls,0);
const response=await post(input);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
const result=await response.json() as any;assert.equal(result.status,'ready');assert.equal(result.inputDigest,input.inputDigest);assert.deepEqual(result.proposal,proposal);assert.equal(result.provenance.outputDigest,await semanticDigest(result.proposal));
assert.equal((await post(input)).status,409);assert.equal(calls,1);
const invalidPayload={...base,id:crypto.randomUUID(),focus:'simulate invalid'};const invalid=await post({...invalidPayload,inputDigest:await semanticDigest(invalidPayload)});assert.equal(invalid.status,503);assert.deepEqual(await invalid.json(),{code:'invalid_proposal'});assert.equal(calls,2);
console.log(`PASS: ${cases.length} TS/Rust proposal cases; authenticated stateless Hono resolution, request digest, result provenance, no paid provider.`);
if(process.argv.includes('--serve')){
 const packageName='@hono/node-server';const {serve}=await import(packageName);
 serve({fetch:app.fetch,hostname:'127.0.0.1',port:4323});console.log('No-cost native semantic fixture on 127.0.0.1:4323');
}
