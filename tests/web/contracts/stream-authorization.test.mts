import assert from 'node:assert/strict';
import {createStreamAuthorizationGate} from '../../../apps/api/src/sensa/access/streamAuthorization.ts';

let now=1_000,calls=0;
const gate=createStreamAuthorizationGate(async()=>{calls++;},{intervalMs:2_000,now:()=>now});
assert.equal(await gate(),false);
now=2_999;assert.equal(await gate(),false);
now=3_000;assert.equal(await gate(),true);assert.equal(calls,1);
now=4_999;assert.equal(await gate(),false);
now=5_000;assert.equal(await gate(),true);assert.equal(calls,2);

let release!:()=>void;
const held=new Promise<void>(resolve=>{release=resolve;});
const concurrent=createStreamAuthorizationGate(async()=>{calls++;await held;},{intervalMs:250,now:()=>now});
now=6_000;
const first=concurrent(),second=concurrent();
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(calls,3,'concurrent deltas share one revocation check');
release();assert.deepEqual(await Promise.all([first,second]),[true,true]);

let failureNow=10_000;
const rejected=createStreamAuthorizationGate(async()=>{throw new Error('access_revoked');},{intervalMs:250,now:()=>failureNow});
failureNow=10_250;
await assert.rejects(
  rejected(),
  /access_revoked/u,
);
console.log('PASS: streaming output shares a lock-free, two-second revocation budget instead of authorizing every text fragment.');
