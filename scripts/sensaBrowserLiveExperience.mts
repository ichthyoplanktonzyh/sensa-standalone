/** Explicitly opt-in local browser experience. Never imported by production or CI. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {serve} from '@hono/node-server';
import {createLocalJWKSet,exportJWK,generateKeyPair,importJWK,SignJWT} from 'jose';
import {createConsumerRoutes} from '../apps/api/dist/sensa/access/consumer.js';
import {createConsumerVerifier} from '../apps/api/dist/sensa/access/auth.js';
import type {DatabaseExecutor} from '../apps/api/src/database/index.js';

if(!process.argv.includes('--live')||!process.env.DEEPSEEK_API_KEY)throw new Error('Explicit --live and server-side DeepSeek credential required');
const database=process.env.SENSA_LIVE_DATABASE;
if(!database||!/^sensa_m1a_[a-z0-9_]+$/u.test(database))throw new Error('Explicit local experience database required');
const url=new URL(process.env.DATABASE_URL??'');
if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Loopback database required');
url.pathname='/'+database;
const pool=new pg.Pool({connectionString:url.href,max:4});
if(!(await pool.query("SELECT to_regclass('sensa_consumer.reading_settings') AS ready")).rows[0]?.ready)throw new Error('Apply browser reading migration before starting');
const directory=resolve('node_modules/.cache/sensa-browser-live',database);
await mkdir(directory,{recursive:true,mode:0o700});
const statePath=resolve(directory,'private-state.json');
type State={privateKey:Awaited<ReturnType<typeof exportJWK>>;publicKey:Awaited<ReturnType<typeof exportJWK>>;vaultKey:string;used:number;limit:number};
let state:State;
try{state=JSON.parse(await readFile(statePath,'utf8'));}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const keys=await generateKeyPair('ES256',{extractable:true});state={privateKey:await exportJWK(keys.privateKey),publicKey:await exportJWK(keys.publicKey),vaultKey:randomBytes(32).toString('hex'),used:0,limit:8};await writeFile(statePath,JSON.stringify(state),{mode:0o600,flag:'wx'});}
process.env.SENSA_PROVIDER_VAULT_KEY=state.vaultKey;
process.env.SENSA_SEMANTIC_PROVIDER='deepseek';
process.env.SENSA_CONTENT_PROVIDER='deepseek';
const privateKey=await importJWK(state.privateKey,'ES256');
const publicKey={...state.publicKey,kid:'browser-live',alg:'ES256'};
const issuer='http://127.0.0.1:4319/auth/v1';
const email='test@sensa.invalid',subject='663b9d60-6d3b-4a08-98dd-f6a3d3f47858';
await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2) ON CONFLICT DO NOTHING',[issuer,subject]);
async function transaction<T>(work:(db:DatabaseExecutor)=>Promise<T>){const client=await pool.connect();await client.query('BEGIN');try{const value=await work({query:(sql,params)=>client.query(sql,params as unknown[])});await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
// Persist a reservation before sending, including failed requests. Restarts do not reset the budget.
const networkFetch=globalThis.fetch;let reservation=Promise.resolve();
globalThis.fetch=async(input,init)=>{
  const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(target.origin!=='https://api.deepseek.com'||!target.pathname.endsWith('/chat/completions'))return networkFetch(input,init);
  const reserved=reservation.then(async()=>{if(state.used>=state.limit)throw new Error('local_experience_budget_exhausted');state.used++;await writeFile(statePath,JSON.stringify(state),{mode:0o600});return state.used;});
  reservation=reserved.then(()=>undefined,()=>undefined);const sequence=await reserved;
  const started=Date.now();const response=await networkFetch(input,init);
  console.log(JSON.stringify({provider:'deepseek',sequence,status:response.status,elapsedMs:Date.now()-started}));
  return response;
};
async function session(){const sessionId=crypto.randomUUID();return {access_token:await new SignJWT({session_id:sessionId,email}).setProtectedHeader({alg:'ES256',kid:'browser-live'}).setIssuer(issuer).setSubject(subject).setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(privateKey),refresh_token:'local-only-test:'+email,token_type:'bearer',expires_in:3600,user:{id:subject,aud:'authenticated',role:'authenticated',email,email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()}};}
const app=new Hono();
app.use('*',cors({origin:'http://127.0.0.1:3001',allowHeaders:['authorization','content-type','apikey','x-client-info','x-supabase-api-version']}));
app.get('/__experience/status',c=>c.json({provider:'deepseek',used:state.used,limit:state.limit,remaining:state.limit-state.used,auth:'local synthetic login'}));
app.route('',createConsumerRoutes({verify:createConsumerVerifier(issuer,createLocalJWKSet({keys:[publicKey]})),transaction}));
app.post('/auth/v1/otp',async c=>(await c.req.json()).email===email?c.json({}):c.json({msg:'Not invited'},403));
app.post('/auth/v1/verify',async c=>{const input=await c.req.json();return input.email===email&&input.token==='123456'?c.json(await session()):c.json({msg:'Invalid OTP'},400);});
app.post('/auth/v1/token',async c=>(await c.req.json()).refresh_token==='local-only-test:'+email?c.json(await session()):c.json({msg:'Invalid token'},401));
app.post('/auth/v1/logout',c=>c.json({}));
const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:4319});
console.log('Local browser API ready at 127.0.0.1:4319; synthetic login test@sensa.invalid / 123456. DeepSeek budget persists across restarts.');
const stop=()=>{server.close(()=>void pool.end().then(()=>process.exit(0)));};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
