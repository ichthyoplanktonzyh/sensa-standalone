// Disposable loopback API process for SIGKILL recovery tests. Never a production entrypoint.
import {createServer} from 'node:http';
import pg from 'pg';
import {createLocalJWKSet} from 'jose';
import {createConsumerRoutes} from '../../apps/api/dist/sensa/access/consumer.js';
import {createConsumerVerifier} from '../../apps/api/dist/sensa/access/auth.js';
import {mockSemanticResolver} from './consumerSemanticChecks.mts';
const url=process.env.SENSA_TEST_DATABASE_URL;
if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname)||!new URL(url).pathname.startsWith('/sensa_m1a_'))throw new Error('Isolated local database required');
process.once('message',async(config:any)=>{
 const pool=new pg.Pool({connectionString:url,max:3});
 const transaction=async(work:any)=>{const client=await pool.connect();try{await client.query('BEGIN');const value=await work({query:(sql:string,values?:any[])=>client.query(sql,values)});await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}};
 let generates=0,reviews=0;
 const hold=async(stage:string)=>{process.send?.({type:'stage',stage});await new Promise(()=>{});};
 const app=createConsumerRoutes({verify:createConsumerVerifier(config.issuer,createLocalJWKSet({keys:[config.jwk]})),transaction,clock:()=>new Date(config.now),semanticResolver:mockSemanticResolver,
  contentGenerator:async()=>{generates++;if(config.mode==='generating')await hold('generating');return {cue:{scene:'你慢慢地完成手头的事情，按照自己的节奏行动。',senseFocus:'从容地行动'},provider:'no-cost-crash-fixture',model:'fixed'};},
  contentReviewer:async()=>{reviews++;if(config.mode==='validating')await hold('validating');return {accepted:true,provider:'independent-crash-fixture',model:'fixed',reason:'Synthetic fixture'};}});
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/__counts'){res.setHeader('content-type','application/json');res.end(JSON.stringify({generates,reviews}));return;}
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const response=await app.request(req.url!,{method:req.method,headers:req.headers as Record<string,string>,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
  if(config.mode==='committed'&&req.url?.endsWith('/advance')&&response.ok)await hold('committed');
  res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(new Uint8Array(await response.arrayBuffer()));
 }catch{res.statusCode=500;res.end('fixture request failed');}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(typeof address!=='object'||!address)throw new Error('No port');process.send?.({type:'ready',port:address.port});
});
