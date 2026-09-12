/** In-process Web model route checks. Synthetic provider only; no database or network. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {createModelTurnRoutes} from '../apps/api/src/sensa/models/turn.ts';

const connection={id:crypto.randomUUID(),name:'Fixture',enabled:true,baseUrl:'https://example.invalid',model:'fixture',apiKey:'fixture'};
let authorizations=0,reservations=0,completions=0;
const app=createModelTurnRoutes({
  authorize:async()=>{authorizations++;return connection;},
  reserve:async()=>{reservations++;},
  complete:async(_connection,_body,_signal,meta)=>{completions++;return {model:'fixture',purpose:meta.purpose};},
});
const turn={id:crypto.randomUUID(),purpose:'teacher' as const,body:{model:'sensa-managed',messages:[{role:'system' as const,content:'fixture'},{role:'user' as const,content:'fixture'}],max_tokens:100,stream:false as const}};
const inputDigest=createHash('sha256').update(canonicalConsumerJson(turn)).digest('hex');
const accepted=await app.request('/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...turn,inputDigest})});
assert.equal(accepted.status,200);assert.equal(accepted.headers.get('cache-control'),'no-store');assert.deepEqual(await accepted.json(),{id:turn.id,inputDigest,response:{model:'fixture',purpose:'teacher'}});
assert.equal(authorizations,2);assert.equal(reservations,1);assert.equal(completions,1);
const rejected=await app.request('/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...turn,inputDigest:'0'.repeat(64)})});
assert.equal(rejected.status,400);assert.deepEqual(await rejected.json(),{code:'input_digest_mismatch'});assert.equal(reservations,1);assert.equal(completions,1);
console.log('PASS: Web model turn validates its digest, reserves once, reauthorizes after completion, and returns no-store. Synthetic provider; no database/network.');
