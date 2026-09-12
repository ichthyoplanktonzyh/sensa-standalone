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
  complete:async(connection,_body,_signal,meta)=>{completions++;return {model:'fixture',purpose:meta.purpose,connection:connection.name};},
});
const message=[{role:'system' as const,content:'fixture'},{role:'user' as const,content:'fixture'}];
const send=(turn:Record<string,unknown>)=>app.request('/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...turn,inputDigest:createHash('sha256').update(canonicalConsumerJson(turn)).digest('hex')})});

const teacher={id:crypto.randomUUID(),purpose:'teacher',body:{model:'sensa-managed',messages:message,max_tokens:100,stream:false}};
const accepted=await send(teacher);
assert.equal(accepted.status,200);assert.equal(accepted.headers.get('cache-control'),'no-store');assert.deepEqual(await accepted.json(),{id:teacher.id,inputDigest:createHash('sha256').update(canonicalConsumerJson(teacher)).digest('hex'),response:{model:'fixture',purpose:'teacher',connection:'Teacher'}});
assert.equal(authorizations,2);assert.equal(reservations,1);assert.equal(completions,1);assert.deepEqual(selected,['teacher']);

// Each purpose resolves its own account connection.
const reference={id:crypto.randomUUID(),purpose:'reference',body:{model:'sensa-managed',messages:message,max_tokens:400,stream:false,response_format:{type:'json_object'}}};
const resolved=await send(reference);
assert.equal(resolved.status,200);assert.deepEqual(selected,['teacher','reference']);assert.equal((await resolved.json() as {response:{connection:string}}).response.connection,'Reference');assert.equal(completions,2);assert.equal(reservations,2);

// A purpose that exposes no tools rejects one, and never reserves.
const withTool={...reference,id:crypto.randomUUID(),body:{...reference.body,tools:[{type:'function',function:{name:'ask_learner',description:'ask',parameters:{}}}]}};
const denied=await send(withTool);assert.equal(denied.status,400);assert.deepEqual(await denied.json(),{code:'unapproved_tool'});assert.equal(reservations,2);assert.equal(completions,2);

const mismatch=await app.request('/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...teacher,inputDigest:'0'.repeat(64)})});
assert.equal(mismatch.status,400);assert.deepEqual(await mismatch.json(),{code:'input_digest_mismatch'});assert.equal(reservations,2);assert.equal(completions,2);
console.log('PASS: Web model turn validates its digest, resolves a connection per purpose, refuses unapproved tools, reserves once, reauthorizes after completion, and returns no-store. Synthetic provider; no database/network.');
