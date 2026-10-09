import {test} from 'vitest';
import assert from 'node:assert/strict';
import {createConsumerRoutes} from '../../../apps/api/src/sensa/access/consumer.ts';
import {ConsumerError} from '../../../apps/api/src/sensa/access/auth.ts';
import type {ServiceRequestRecord} from '../../../apps/api/src/sensa/access/telemetry.ts';
import {sensaCorsOptions} from '../../../apps/api/src/sensa/access/cors.ts';
import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {failureDiagnostics} from '../../../apps/api/src/server/failureDiagnostics';

test("telemetry", async () => {
const records:ServiceRequestRecord[]=[];
const privateText='private-email-and-key-do-not-log';
const savedCatalog=process.env.SENSA_PACKAGE_CATALOG_JSON,savedRegistry=process.env.SENSA_PACKAGE_REGISTRY_URL;
delete process.env.SENSA_PACKAGE_CATALOG_JSON;delete process.env.SENSA_PACKAGE_REGISTRY_URL;
const app=createConsumerRoutes({telemetry:r=>records.push(r),verify:async()=>{throw new ConsumerError(401,'authentication_required');}});
const r=await app.request('/sensa/packages?secret='+privateText,{headers:{authorization:'Bearer '+privateText,'X-Request-ID':privateText}});
assert.equal(r.status,200);assert.match(r.headers.get('X-Request-ID')??'',/^[a-f0-9-]{36}$/);assert.equal(r.headers.get('Cache-Control'),'public, max-age=300');
assert.equal(records[0]?.requestId,r.headers.get('X-Request-ID'));assert.equal(records[0]?.surface,'packages');assert.equal(records[0]?.status,200);
assert.equal(records[0]?.component,'consumer.packages');assert.equal(records[0]?.release,'development');assert.equal(records[0]?.errorCode,null);
const failure=createConsumerRoutes({telemetry:r=>records.push(r),verify:async()=>{throw new Error(privateText);}});
assert.equal((await failure.request('/sensa/service/status')).status,503);assert.equal(records[1]?.status,503);
assert.equal(records[1]?.errorCode,'temporarily_unavailable');
assert.equal(records[1]?.failureKind,'unexpected');
assert(!JSON.stringify(records).includes(privateText));
const brokenSink=createConsumerRoutes({telemetry:()=>{throw Error('sink unavailable');},verify:async()=>{throw new ConsumerError(401,'authentication_required');}});
assert.equal((await brokenSink.request('/sensa/service/status')).status,401);
const corsApp=new Hono();corsApp.use('*',cors(sensaCorsOptions(['https://sensa.example'])));
const preflight=await corsApp.request('/sensa/packages',{method:'OPTIONS',headers:{origin:'https://sensa.example','access-control-request-method':'GET','access-control-request-headers':'authorization,if-none-match'}});
assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-headers')??'',/(?:^|,)if-none-match(?:,|$)/u);
console.log('PASS: correlated response/request metadata, no token/query/error payload logging, 401/503 attribution, non-fatal telemetry sink and conditional package refresh CORS.');

if(savedCatalog===undefined)delete process.env.SENSA_PACKAGE_CATALOG_JSON;else process.env.SENSA_PACKAGE_CATALOG_JSON=savedCatalog;
if(savedRegistry===undefined)delete process.env.SENSA_PACKAGE_REGISTRY_URL;else process.env.SENSA_PACKAGE_REGISTRY_URL=savedRegistry;

});

test.each([
  [Object.assign(new Error('private SQL, email, password and parameters'),{code:'42501'}),'database','42501'],
  [Object.assign(new Error('private host and token'),{code:'ECONNRESET'}),'transport','ECONNRESET'],
  [new ReferenceError('private symbol and stack'),'runtime-reference',undefined],
  [new TypeError('private body'),'runtime-type',undefined],
  [Object.assign(new Error('private message'),{code:'EMAIL'}),'unexpected',undefined],
  [Object.assign(new Error('private message'),{code:'42501\nprivate token'}),'unexpected',undefined],
] as const)('unexpected failure emits only fixed classification %s',async(error,kind,code)=>{
 const records:ServiceRequestRecord[]=[];
 const app=createConsumerRoutes({telemetry:record=>records.push(record),verify:async()=>{throw error;}});
 const response=await app.request('/sensa/service/status?private-query',{headers:{authorization:'Bearer private-token'}});
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'temporarily_unavailable'});
 assert.equal(records[0]?.requestId,response.headers.get('X-Request-ID'));
 assert.equal(records[0]?.failureKind,kind);assert.equal(records[0]?.failureCode,code);
 assert(!JSON.stringify(records).includes('private'));
});

test('failure classification does not evaluate accessors or serialize hostile exceptions',()=>{
 let calls=0;
 const error=new Error('private');
 for(const key of ['code','message','name','stack','cause'])Object.defineProperty(error,key,{get:()=>{calls++;throw Error('private getter');}});
 assert.deepEqual(failureDiagnostics(error),{failureKind:'unexpected'});assert.equal(calls,0);
 assert.deepEqual(failureDiagnostics(new Proxy({},{getOwnPropertyDescriptor:()=>{throw Error('private proxy');}})),{failureKind:'unexpected'});
 for(const value of [null,undefined,'private',123,{code:'unknown-secret',detail:'private',sql:'private'}])assert.deepEqual(failureDiagnostics(value),{failureKind:'unexpected'});
});

test('a sync POST body, principal and nested cause never enter unexpected-failure diagnostics',async()=>{
 const privateText='synthetic-private-post-body-sql-and-cause';
 const records:ServiceRequestRecord[]=[];
 const app=createConsumerRoutes({telemetry:record=>records.push(record),
  verify:async()=>({issuer:'https://fixture.supabase.co/auth/v1',subject:crypto.randomUUID(),sessionId:crypto.randomUUID(),email:'private-fixture@example.invalid'}),
  transaction:async()=>{throw Object.assign(new Error(privateText,{cause:new Error(privateText)}),{code:'23505',query:privateText,parameters:[privateText],detail:privateText});},
 });
 const response=await app.request('/sensa/library-sync/blocks/store',{method:'POST',headers:{authorization:'Bearer '+privateText,'content-type':'application/json'},body:JSON.stringify({blocks:[{hash:'a'.repeat(64),data:privateText}]})});
 assert.equal(response.status,400,'hash validation happens before the injected database boundary');
 // Use a valid hash so this second request actually reaches the transaction.
 const {createHash}=await import('node:crypto');
 const failure=await app.request('/sensa/library-sync/blocks/store',{method:'POST',headers:{authorization:'Bearer '+privateText,'content-type':'application/json'},body:JSON.stringify({blocks:[{hash:createHash('sha256').update(privateText).digest('hex'),data:privateText}]})});
 assert.equal(failure.status,503);assert.deepEqual(await failure.json(),{code:'temporarily_unavailable'});
 assert.equal(records[1]?.surface,'sync');assert.equal(records[1]?.failureKind,'database');assert.equal(records[1]?.failureCode,'23505');
 assert(!JSON.stringify(records).includes(privateText));assert(!JSON.stringify(records).includes('private-fixture@example.invalid'));
});
