import {test} from 'vitest';
/** In-process Web model route checks. Synthetic provider only; no database or network. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {createModelTurnRoutes} from '../../../apps/api/src/sensa/models/turn.ts';
import {ConsumerError} from '../../../apps/api/src/sensa/access/auth.ts';

test("model-turn", async () => {

const base={id:crypto.randomUUID(),name:'Teacher',enabled:true,baseUrl:'https://example.invalid',model:'fixture',apiKey:'fixture'};
const connections:{[purpose:string]:typeof base}={teacher:base,reference:{...base,id:crypto.randomUUID(),name:'Reference'}};
let authorizations=0,reservations=0,completions=0,running=0,succeeded=0;const selected:string[]=[];
const receipts=new Map<string,{digest:string;response?:unknown;state:'reserved'|'running'|'succeeded'|'unknown'}>();
const app=createModelTurnRoutes({
  // The route authenticates first and resolves its connection only once the purpose is known.
  authorize:async()=>{authorizations++;return {select:(purpose:keyof typeof connections)=>{selected.push(purpose);return connections[purpose]??connections.teacher;}};},
  reserve:async(_request,input,select)=>{
   const old=receipts.get(input.id);
   if(old){if(old.digest!==input.inputDigest)throw new ConsumerError(409,'model_request_conflict');if(old.state==='succeeded')return {kind:'replay' as const,response:old.response};throw new ConsumerError(409,'model_request_in_progress');}
   reservations++;const connection=select();receipts.set(input.id,{digest:input.inputDigest,state:'reserved'});
   return {kind:'execute' as const,connection,
    markRunning:async()=>{running++;receipts.get(input.id)!.state='running';},
    succeed:async response=>{succeeded++;Object.assign(receipts.get(input.id)!,{state:'succeeded',response});},
    failBeforeExecution:async()=>{receipts.delete(input.id);},
    failAfterExecution:async()=>{receipts.get(input.id)!.state='unknown';},
   };
  },
  complete:async(connection,_body,_signal,meta,onText)=>{completions++;await meta.onExecutionStart();if(onText){await onText('{"reply":"流');await onText('式回复"}');}return {model:'fixture',purpose:meta.purpose,connection:connection.name};},
});
const message=[{role:'system' as const,content:'fixture'},{role:'user' as const,content:'fixture'}];
const sendTo=(path:string,turn:Record<string,unknown>)=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...turn,inputDigest:createHash('sha256').update(canonicalConsumerJson(turn)).digest('hex')})});
const send=(turn:Record<string,unknown>)=>sendTo('/turn',turn);

const teacher={id:crypto.randomUUID(),purpose:'teacher',body:{model:'sensa-managed',messages:message,max_tokens:100,stream:false}};
const accepted=await send(teacher);
const acceptedJson=await accepted.json();
assert.equal(accepted.status,200);assert.equal(accepted.headers.get('cache-control'),'no-store');assert.deepEqual(acceptedJson,{id:teacher.id,inputDigest:createHash('sha256').update(canonicalConsumerJson(teacher)).digest('hex'),response:{model:'fixture',purpose:'teacher',connection:'Teacher'}});
assert.equal(authorizations,2);assert.equal(reservations,1);assert.equal(completions,1);assert.deepEqual(selected,['teacher']);
assert.equal(running,1);assert.equal(succeeded,1);

const replayed=await send(teacher);assert.equal(replayed.status,200);assert.deepEqual(await replayed.json(),acceptedJson);
assert.equal(reservations,1);assert.equal(completions,1);assert.equal(authorizations,3);assert.deepEqual(selected,['teacher']);
const changed={...teacher,body:{...teacher.body,messages:[...message,{role:'user' as const,content:'different'}]}};
const conflict=await send(changed);assert.equal(conflict.status,409);assert.deepEqual(await conflict.json(),{code:'model_request_conflict'});

// The native clarification teacher may expose only semantic-world lookup.
const teacherTools={...teacher,id:crypto.randomUUID(),body:{...teacher.body,response_format:{type:'json_object' as const},tools:['lookup_meanings'].map(name=>({type:'function' as const,function:{name,description:name,parameters:{type:'object'}}}))}};
const toolsAccepted=await send(teacherTools);
assert.equal(toolsAccepted.status,200);assert.equal(reservations,2);assert.equal(completions,2);assert.deepEqual(selected,['teacher','teacher']);

// A proposal is final model output, not even a recognized executable tool.
const fakeProposalTool={...teacher,id:crypto.randomUUID(),body:{...teacher.body,tools:[{type:'function' as const,function:{name:'propose_meaning',description:'not a capability',parameters:{type:'object'}}}]}};
const proposalDenied=await send(fakeProposalTool);assert.equal(proposalDenied.status,400);assert.deepEqual(await proposalDenied.json(),{code:'invalid_request'});assert.equal(reservations,2);assert.equal(completions,2);

// Each purpose resolves its own account connection.
const reference={id:crypto.randomUUID(),purpose:'reference',body:{model:'sensa-managed',messages:message,max_tokens:400,stream:false,response_format:{type:'json_object'}}};
const resolved=await send(reference);
assert.equal(resolved.status,200);assert.deepEqual(selected,['teacher','teacher','reference']);assert.equal((await resolved.json() as {response:{connection:string}}).response.connection,'Reference');assert.equal(completions,3);assert.equal(reservations,3);

// A purpose that exposes no tools rejects one, and never reserves.
const withTool={...reference,id:crypto.randomUUID(),body:{...reference.body,tools:[{type:'function',function:{name:'lookup_meanings',description:'lookup',parameters:{}}}]}};
const denied=await send(withTool);assert.equal(denied.status,400);assert.deepEqual(await denied.json(),{code:'unapproved_tool'});assert.equal(reservations,3);assert.equal(completions,3);

const mismatch=await app.request('/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...teacher,inputDigest:'0'.repeat(64)})});
assert.equal(mismatch.status,400);assert.deepEqual(await mismatch.json(),{code:'input_digest_mismatch'});assert.equal(reservations,3);assert.equal(completions,3);

const streamed={...teacher,id:crypto.randomUUID()};
const streamedResponse=await sendTo('/turn/stream',streamed);
assert.equal(streamedResponse.status,200);assert.match(streamedResponse.headers.get('content-type')??'',/application\/x-ndjson/u);assert.equal(streamedResponse.headers.get('cache-control'),'no-store');assert.equal(streamedResponse.headers.get('x-accel-buffering'),'no');
const events=(await streamedResponse.text()).trim().split('\n').map(line=>JSON.parse(line));
assert.deepEqual(events.slice(0,2),[{type:'delta',text:'{"reply":"流'},{type:'delta',text:'式回复"}'}]);
assert.deepEqual(events[2],{type:'result',value:{id:streamed.id,inputDigest:createHash('sha256').update(canonicalConsumerJson(streamed)).digest('hex'),response:{model:'fixture',purpose:'teacher',connection:'Teacher'}}});
assert.equal(reservations,4);assert.equal(completions,4);assert.equal(authorizations,13);assert.deepEqual(selected,['teacher','teacher','reference','teacher']);
console.log('PASS: Web model turn validates its digest, resolves a connection before reserving, replays a matching receipt without re-execution, conflicts on changed input, permits only approved tools, marks actual execution, and exposes a no-store NDJSON stream. Synthetic provider; no database/network.');

// Resource tools follow the same managed Genkit transport allowlist.
for(const name of ['prepare_pronunciation','lookup_references','submit_resources','validate_resources']){
 const response=await send({...teacher,id:crypto.randomUUID(),purpose:'content',body:{...teacher.body,tools:[{type:'function',function:{name,description:name,parameters:{type:'object'}}}]}});assert.equal(response.status,200);
}

const lifecycle=async(code:string,start:boolean)=>{
 let state='none',unknown:boolean|undefined;
 const scenario=createModelTurnRoutes({
  authorize:async()=>({select:()=>base}),
  reserve:async(_request,_input,select)=>{const connection=select();state='reserved';return {kind:'execute',connection,markRunning:async()=>{state='running';},succeed:async()=>{state='succeeded';},failBeforeExecution:async()=>{state='failed_before_execution';},failAfterExecution:async(_error,value)=>{state=value?'execution_unknown':'failed_after_execution';unknown=value;}};},
  complete:async(_connection,_body,_signal,meta)=>{if(start)await meta.onExecutionStart();throw new ConsumerError(503,code);},
 });
 const turn={...teacher,id:crypto.randomUUID()};const response=await scenario.request('/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...turn,inputDigest:createHash('sha256').update(canonicalConsumerJson(turn)).digest('hex')})});
 assert.equal((await response.json() as {code:string}).code,code);return {state,unknown};
};
assert.deepEqual(await lifecycle('model_queue_full',false),{state:'failed_before_execution',unknown:undefined});
assert.deepEqual(await lifecycle('model_cancelled',false),{state:'failed_before_execution',unknown:undefined});
assert.deepEqual(await lifecycle('model_request_rejected',true),{state:'failed_after_execution',unknown:false});
assert.deepEqual(await lifecycle('provider_timeout',true),{state:'execution_unknown',unknown:true});

let lostAuthorizations=0,lostCompletions=0,lostState:'none'|'reserved'|'running'|'succeeded'='none',lostResponse:unknown;
const lostApp=createModelTurnRoutes({
 authorize:async()=>{if(++lostAuthorizations===2)throw new ConsumerError(401,'access_revoked');return {select:()=>base};},
 reserve:async(_request,_input,select)=>lostState==='succeeded'?{kind:'replay',response:lostResponse}:{kind:'execute',connection:select(),markRunning:async()=>{lostState='running';},succeed:async response=>{lostState='succeeded';lostResponse=response;},failBeforeExecution:async()=>{lostState='none';},failAfterExecution:async()=>{}},
 complete:async(_connection,_body,_signal,meta)=>{lostCompletions++;await meta.onExecutionStart();return {model:'fixture',answer:'saved-before-response'};},
});
const lostTurn={...teacher,id:crypto.randomUUID()},lostBody=JSON.stringify({...lostTurn,inputDigest:createHash('sha256').update(canonicalConsumerJson(lostTurn)).digest('hex')});
assert.equal((await lostApp.request('/turn',{method:'POST',headers:{'content-type':'application/json'},body:lostBody})).status,401);
const recovered=await lostApp.request('/turn',{method:'POST',headers:{'content-type':'application/json'},body:lostBody});assert.equal(recovered.status,200);assert.equal(lostCompletions,1);assert.equal((await recovered.json() as any).response.answer,'saved-before-response');
console.log('PASS: pre-execution queue/cancel failures release reservations; upstream rejection consumes a known terminal state; timeout remains unknown; a lost HTTP response replays the saved result without a second model call.');

});
