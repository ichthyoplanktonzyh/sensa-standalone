import {test} from 'vitest';
/** In-process Hono route and real provider selection; synthetic SQL adapter, no browser or network. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createConsumerRoutes} from '../../../apps/api/src/sensa/access/consumer.ts';
import {ConsumerError} from '../../../apps/api/src/sensa/access/auth.ts';
import {serviceStatusSchema} from '../../../packages/contracts/src/sensa/serviceStatus.ts';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {clearLearningContentRegistryCache} from '../../../apps/api/src/sensa/access/learningContentRegistry.ts';

test("service-status", async () => {
const ids={a:crypto.randomUUID(),b:crypto.randomUUID()};let active=ids.a;let revoked=false;const calls:string[]=[];
const saved={provider:process.env.SENSA_SEMANTIC_PROVIDER,key:process.env.DEEPSEEK_API_KEY,catalog:process.env.SENSA_PACKAGE_CATALOG_JSON,registry:process.env.SENSA_PACKAGE_REGISTRY_URL,unlimited:process.env.SENSA_UNLIMITED_MODEL_USAGE};
const app=createConsumerRoutes({clock:()=>new Date('2026-09-10T12:00:00Z'),verify:async req=>{if(!req.headers.has('authorization'))throw new ConsumerError(401,'authentication_required');active=req.headers.get('authorization')==='Bearer a'?ids.a:ids.b;return {issuer:'fixture',subject:active,sessionId:active,email:null};},transaction:async work=>work({query:async(sql:string,args:unknown[])=>{
 calls.push(sql);assert(!/^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql));
 if(sql.includes('invitations'))return {rows:[{revoked}],rowCount:1};
 if(sql.includes('FROM sensa_consumer.accounts'))return {rows:[{account_id:active,learner_user_id:active,epoch:'1',feed_head:'0',time_zone:'UTC'}],rowCount:1};
 if(sql.includes('sessions'))return {rows:[{id:active,revoked:false}],rowCount:1};
 assert.equal(args[0],active);
 if(sql.includes('reading_settings'))return {rows:[],rowCount:0};
 if(sql.includes('count(*)')){assert.equal((args.at(-1) as Date).toISOString(),'2026-09-09T12:00:00.000Z');return {rows:[{n:active===ids.a?4:2}],rowCount:1};}
 throw new Error('Unexpected SQL');
 }} as any)});
try{
 delete process.env.SENSA_UNLIMITED_MODEL_USAGE;
 delete process.env.SENSA_PACKAGE_CATALOG_JSON;
 delete process.env.SENSA_PACKAGE_REGISTRY_URL;
 clearLearningContentRegistryCache();
 const empty=await app.request('/sensa/packages',{headers:{authorization:'Bearer a'}});assert.equal(empty.status,200);const emptyRegistry=await empty.json() as any;assert.equal(emptyRegistry.format,'sensa-learning-content-registry-v2');assert.deepEqual(emptyRegistry.items,[]);assert.equal(empty.headers.get('cache-control'),'private, max-age=300');
 const bookId=crypto.randomUUID(),bookVersionId=crypto.randomUUID(),contentReleaseId=crypto.randomUUID(),snapshot={format:'sensa-learning-content-registry-v2' as const,publishedAt:'2026-09-10T00:00:00.000Z',items:[{format:'sensa-book-version-manifest-descriptor-v1' as const,publisher:{namespace:'sensa.official',name:'Sensa Official'},book:{bookId,bookKey:'fixture',bookVersionId,versionNumber:2,title:'Fixture Book',description:'Fixture'},contentRelease:{contentReleaseId,versionNumber:2,schemaVersion:'sensa-portable-lightweight-package-v2'},route:{targetLanguage:'en',supportLanguage:'zh-CN'},publishedAt:'2026-09-10T00:00:00.000Z',changeSummary:'Second release',memberCount:1,byteLength:100,sha256:'c'.repeat(64),url:'https://fixture.invalid/releases/book.json'}]},revision=createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex'),registry={...snapshot,revision};
 process.env.SENSA_PACKAGE_CATALOG_JSON=JSON.stringify(registry);
 const current=await app.request('/sensa/packages',{headers:{authorization:'Bearer a'}});assert.equal(current.headers.get('etag'),`"${revision}"`);assert.equal(current.headers.get('cache-control'),'private, max-age=300');assert.deepEqual(await current.json(),registry);
 const unchanged=await app.request('/sensa/packages',{headers:{authorization:'Bearer a','if-none-match':`"${revision}"`}});assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');
 assert.equal((await app.request('/sensa/packages')).status,401);revoked=true;assert.equal((await app.request('/sensa/packages',{headers:{authorization:'Bearer a'}})).status,403);revoked=false;
 process.env.SENSA_SEMANTIC_PROVIDER='deepseek';process.env.DEEPSEEK_API_KEY='fixture-never-sent';
 for(const who of ['a','b']){const response=await app.request('/sensa/service/status',{headers:{authorization:'Bearer '+who}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const raw=await response.text();assert(!raw.includes('fixture-never-sent'));const status=serviceStatusSchema.parse(JSON.parse(raw));assert.equal(status.explanationAvailable,true);assert.deepEqual(status.usage.map(u=>u.kind),['reading','reference','teacher','content']);assert.deepEqual(status.usage.map(u=>u.limit),[300,300,30,30]);assert(status.usage.every(u=>u.used===(who==='a'?4:2)));}
 process.env.SENSA_UNLIMITED_MODEL_USAGE='true';
 const unlimited=serviceStatusSchema.parse(await (await app.request('/sensa/service/status',{headers:{authorization:'Bearer a'}})).json());assert.deepEqual(unlimited.usage.map(u=>u.limit),[null,null,null,null]);delete process.env.SENSA_UNLIMITED_MODEL_USAGE;
 delete process.env.DEEPSEEK_API_KEY;const unavailable=await app.request('/sensa/service/status',{headers:{authorization:'Bearer a'}});assert.equal((await unavailable.json()).explanationAvailable,false);
 revoked=true;assert.equal((await app.request('/sensa/service/status',{headers:{authorization:'Bearer a'}})).status,403);
 const before=calls.length;assert.equal((await app.request('/sensa/service/status')).status,401);assert.equal(calls.length,before);
 console.log('PASS: real service route, per-account rolling counters, default provider without BYOK, unavailable/revoked/unauthenticated, no secret disclosure or writes. Synthetic SQL; no browser/network.');
}finally{clearLearningContentRegistryCache();for(const [name,value] of [['SENSA_SEMANTIC_PROVIDER',saved.provider],['DEEPSEEK_API_KEY',saved.key],['SENSA_PACKAGE_CATALOG_JSON',saved.catalog],['SENSA_PACKAGE_REGISTRY_URL',saved.registry],['SENSA_UNLIMITED_MODEL_USAGE',saved.unlimited]]){if(value===undefined)delete process.env[name!];else process.env[name!]=value;}}

});
