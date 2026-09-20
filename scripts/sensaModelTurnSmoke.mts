/** In-process Web model route checks. Synthetic provider only; no database or network. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {createModelTurnRoutes} from '../apps/api/src/sensa/models/turn.ts';

const base={id:crypto.randomUUID(),name:'Teacher',enabled:true,baseUrl:'https://example.invalid',model:'fixture',apiKey:'fixture'};
const connections:{[purpose:string]:typeof base}={teacher:base,reference:{...base,id:crypto.randomUUID(),name:'Reference'}};
let authorizations=0,reservations=0,completions=0;const selected:string[]=[];
const app=createModelTurnRoutes({
  // The route authenticates first and resolves its connection only once the purpose is known.
  authorize:async()=>{authorizations++;return {select:(purpose:keyof typeof connections)=>{selected.push(purpose);return connections[purpose]??connections.teacher;}};},
  reserve:async()=>{reservations++;},
  complete:async(connection,_body,_signal,meta,onText)=>{completions++;if(onText){await onText('{"reply":"流');await onText('式回复"}');}return {model:'fixture',purpose:meta.purpose,connection:connection.name};},
});
const message=[{role:'system' as const,content:'fixture'},{role:'user' as const,content:'fixture'}];
const sendTo=(path:string,turn:Record<string,unknown>)=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...turn,inputDigest:createHash('sha256').update(canonicalConsumerJson(turn)).digest('hex')})});
const send=(turn:Record<string,unknown>)=>sendTo('/turn',turn);

const teacher={id:crypto.randomUUID(),purpose:'teacher',body:{model:'sensa-managed',messages:message,max_tokens:100,stream:false}};
const accepted=await send(teacher);
assert.equal(accepted.status,200);assert.equal(accepted.headers.get('cache-control'),'no-store');assert.deepEqual(await accepted.json(),{id:teacher.id,inputDigest:createHash('sha256').update(canonicalConsumerJson(teacher)).digest('hex'),response:{model:'fixture',purpose:'teacher',connection:'Teacher'}});
assert.equal(authorizations,2);assert.equal(reservations,1);assert.equal(completions,1);assert.deepEqual(selected,['teacher']);

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
assert.equal(reservations,4);assert.equal(completions,4);assert.equal(authorizations,11);assert.deepEqual(selected,['teacher','teacher','reference','teacher']);
console.log('PASS: Web model turn validates its digest, resolves a connection per purpose, permits only semantic-world lookup for clarification, refuses proposal pseudo-tools and unapproved tools, reserves once, reauthorizes after completion, and exposes a no-store NDJSON stream. Synthetic provider; no database/network.');

// Resource tools follow the same managed Genkit transport allowlist.
for(const name of ['prepare_pronunciation','lookup_references','submit_resources','validate_resources']){
 const response=await send({...teacher,id:crypto.randomUUID(),purpose:'content',body:{...teacher.body,tools:[{type:'function',function:{name,description:name,parameters:{type:'object'}}}]}});assert.equal(response.status,200);
}
