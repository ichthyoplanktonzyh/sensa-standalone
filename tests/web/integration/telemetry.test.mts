import {test} from 'vitest';
import assert from 'node:assert/strict';
import {createConsumerRoutes} from '../../../apps/api/src/sensa/access/consumer.ts';
import {ConsumerError} from '../../../apps/api/src/sensa/access/auth.ts';
import type {ServiceRequestRecord} from '../../../apps/api/src/sensa/access/telemetry.ts';
import {sensaCorsOptions} from '../../../apps/api/src/sensa/access/cors.ts';
import {Hono} from 'hono';
import {cors} from 'hono/cors';

test("telemetry", async () => {
const records:ServiceRequestRecord[]=[];
const privateText='private-email-and-key-do-not-log';
const app=createConsumerRoutes({telemetry:r=>records.push(r),verify:async()=>{throw new ConsumerError(401,'authentication_required');}});
const r=await app.request('/sensa/packages?secret='+privateText,{headers:{authorization:'Bearer '+privateText,'X-Request-ID':privateText}});
assert.equal(r.status,401);assert.match(r.headers.get('X-Request-ID')??'',/^[a-f0-9-]{36}$/);assert.equal(r.headers.get('Cache-Control'),'no-store');
assert.equal(records[0]?.requestId,r.headers.get('X-Request-ID'));assert.equal(records[0]?.surface,'packages');assert.equal(records[0]?.status,401);
assert.equal(records[0]?.component,'consumer.packages');assert.equal(records[0]?.release,'development');assert.equal(records[0]?.errorCode,'authentication_required');
const failure=createConsumerRoutes({telemetry:r=>records.push(r),verify:async()=>{throw new Error(privateText);}});
assert.equal((await failure.request('/sensa/packages')).status,503);assert.equal(records[1]?.status,503);
assert.equal(records[1]?.errorCode,'temporarily_unavailable');
assert(!JSON.stringify(records).includes(privateText));
const brokenSink=createConsumerRoutes({telemetry:()=>{throw Error('sink unavailable');},verify:async()=>{throw new ConsumerError(401,'authentication_required');}});
assert.equal((await brokenSink.request('/sensa/packages')).status,401);
const corsApp=new Hono();corsApp.use('*',cors(sensaCorsOptions(['https://sensa.example'])));
const preflight=await corsApp.request('/sensa/packages',{method:'OPTIONS',headers:{origin:'https://sensa.example','access-control-request-method':'GET','access-control-request-headers':'authorization,if-none-match'}});
assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-headers')??'',/(?:^|,)if-none-match(?:,|$)/u);
console.log('PASS: correlated response/request metadata, no token/query/error payload logging, 401/503 attribution, non-fatal telemetry sink and conditional package refresh CORS.');

});
