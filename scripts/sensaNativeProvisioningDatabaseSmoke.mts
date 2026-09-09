import assert from 'node:assert/strict';
import pg from 'pg';
import {createConsumerRoutes} from '../apps/api/dist/sensa/access/consumer.js';
import {semanticDigest} from '../apps/api/dist/sensa/personal/nativeSemantic.js';
import type {DatabaseExecutor} from '../apps/api/src/database/index.js';
const url=process.env.SENSA_TEST_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.startsWith('/sensa_native_provisioning_'))throw new Error('Isolated native provisioning database required');
const pool=new pg.Pool({connectionString:url});
async function transaction<T>(work:(db:DatabaseExecutor)=>Promise<T>){const c=await pool.connect();await c.query('BEGIN');try{const r=await work({query:(s,p)=>c.query(s,p as unknown[])});await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
const subject=crypto.randomUUID(),session=crypto.randomUUID(),issuer='native-provisioning-smoke';let generation=0,review=0,revoke=false,now=new Date();
const app=createConsumerRoutes({transaction,clock:()=>now,verify:async()=>({issuer,subject,sessionId:session,email:null}),contentGenerator:async request=>{generation++;assert.ok(request.contextArtifacts.every(a=>a.source!=='personal_anchor'));return {cue:{scene:'你要提出不同意见，先顾及对方的感受，再委婉地表达自己的想法。',senseFocus:'表达得体，顾及感受'},provider:'fixture-generator',model:'no-cost'};},contentReviewer:async()=>{review++;if(revoke)await pool.query('UPDATE sensa_consumer.invitations SET revoked=true WHERE issuer=$1 AND subject=$2',[issuer,subject]);return {accepted:true,provider:'fixture-independent-review',model:'no-cost',reason:'fixed rubric passed'};}});
const post=async(path:string,body:unknown)=>{const r=await app.request(path,{method:'POST',headers:{Authorization:'Bearer native-test','Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
async function input(){const id=()=>crypto.randomUUID();const p={version:'sensa-native-provisioning-v1',id:id(),taskId:id(),learnerId:id(),planRevision:id(),policy:{profileId:'lightweight',profileVersion:'v1'},protocol:{id:'consumer-initial',version:'v1',purpose:'initial_learning'},demandReference:{contentDemandKey:'lightweight-initial-content',definitionVersion:'v1'},target:{senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:{surface:'tactful',type:'word',language:'en'},semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'Care for feelings in communication.',prototypeScenes:[{summary:'A sensitive conversation.',participantRoles:[],states:[],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]}},requestedAt:now.toISOString()};return {...p,inputDigest:await semanticDigest(p)};}
try{
 await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[issuer,subject]);
 assert.equal((await post('/sensa/account/session',{installationId:crypto.randomUUID(),platform:'web',timeZone:'Asia/Shanghai'})).status,200);
 const first=await input();const concurrent=await Promise.all([post('/sensa/native/content/prepare',first),post('/sensa/native/content/prepare',first)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);assert.equal(generation,1);assert.equal(review,1);assert.equal(concurrent.find(r=>r.status===200)!.body.status,'ready');
 assert.equal((await post('/sensa/native/content/prepare',{...first,snapshot:'PRIVATE'})).status,400);assert.equal(generation,1);
 for(let i=1;i<30;i++){const r=await post('/sensa/native/content/prepare',await input());assert.equal(r.status,200);assert.equal(r.body.status,'ready');}
 assert.equal((await post('/sensa/native/content/prepare',await input())).body.code,'daily_preparation_limit');assert.equal(generation,30);assert.equal(review,30);
 const account=(await pool.query('SELECT account_id FROM sensa_consumer.accounts WHERE issuer=$1 AND subject=$2',[issuer,subject])).rows[0].account_id;
 const rows=(await pool.query('SELECT * FROM sensa_consumer.native_content_usage WHERE account_id=$1',[account])).rows;assert.equal(rows.length,30);assert.deepEqual(Object.keys(rows[0]).sort(),['account_id','created_at','input_digest','request_id']);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM sensa_consumer.provisioning_tasks WHERE learner_user_id=$1',[account])).rows[0].n,0);
 now=new Date(now.getTime()+86400001);revoke=true;assert.equal((await post('/sensa/native/content/prepare',await input())).status,403);assert.equal(generation,31);assert.equal(review,31);
 console.log('PASS: native content HTTP + real Postgres usage quota/concurrent dedup/day rollover/revocation, separate generator/reviewer, no persisted private task or content payload.');
}finally{await pool.end();}
