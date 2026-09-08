import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export async function runIntakeChecks({request,initialize,bootstrap,push,token,subject,pool,issuer,failLedger}:any){
 const bearer=await token(subject),installation=crypto.randomUUID();await initialize(installation,bearer);const boot=await bootstrap(installation,bearer);
 const snapshot={sentence:'😀 She took her time, then took a seat.',language:'en',source:{url:'https://example.org/read',title:'Reading',capturedAt:'2026-09-08T00:00:00.000Z'},expression:{text:'took',start:6,end:10}};
 const operation=()=>({operationId:crypto.randomUUID(),occurredAt:new Date().toISOString(),installationId:installation,replicaId:boot.replicaId,dependsOn:[],kind:'intake.save',payload:{snapshot}});
 const op=operation(),first=await push(boot,[op],bearer);assert.equal(first.status,200,JSON.stringify(first.body));const value=first.body.results[0].value;assert.equal(value.plan,null);assert.equal(value.intake.snapshot.sentence,snapshot.sentence);
 assert.equal((await push(boot,[op],bearer)).body.results[0].status,'replayed');
 assert.equal((await push(boot,[{...op,payload:{snapshot:{...snapshot,source:{...snapshot.source,title:'Changed'}}}}],bearer)).body.results[0].error.code,'operation_id_reuse');
 const duplicate=await push(boot,[{...operation(),payload:{snapshot:{...snapshot,source:{...snapshot.source,title:'Changed'}}}}],bearer);assert.equal(duplicate.body.results[0].value.intake.id,value.intake.id);assert.equal(duplicate.body.results[0].value.intake.snapshot.source.title,'Reading');
 const second=await push(boot,[{...operation(),payload:{snapshot:{...snapshot,expression:{text:'took',start:26,end:30}}}}],bearer);assert.equal(second.body.results[0].status,'accepted');assert.notEqual(second.body.results[0].value.intake.id,value.intake.id);
 assert.equal((await push(boot,[{...operation(),payload:{snapshot:{...snapshot,expression:{text:'took',start:7,end:11}}}}],bearer)).status,400);
 const retry={...operation(),payload:{snapshot:{...snapshot,source:{...snapshot.source,url:'https://example.org/another'}}}};failLedger(true);assert.equal((await push(boot,[retry],bearer)).status,503);failLedger(false);assert.equal((await push(boot,[retry],bearer)).body.results[0].value.alreadySaved,false);
 assert.equal((await request('/sensa/intakes/'+value.intake.id,undefined,bearer)).body.data.id,value.intake.id);
 const otherSub=crypto.randomUUID();await pool.query('INSERT INTO sensa_consumer.invitations(issuer,subject) VALUES($1,$2)',[issuer,otherSub]);const other=await token(otherSub);await initialize(crypto.randomUUID(),other);assert.equal((await request('/sensa/intakes/'+value.intake.id,undefined,other)).status,404);
 assert.equal((await bootstrap(installation,bearer)).intakes.length,3);
 const extInstallation=crypto.randomUUID(),verifier='v'.repeat(64),state='s'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url');
 const input={installationId:extInstallation,state,challenge,redirectUri:'https://'+'a'.repeat(32)+'.chromiumapp.org/sensa'};
 assert.equal((await request('/sensa/extension/authorize',{...input,redirectUri:'https://evil.invalid'},bearer)).status,400);
 const authorized=await request('/sensa/extension/authorize',input,bearer);assert.equal(authorized.status,200);const code=new URL(authorized.body.redirectUri).searchParams.get('code');
 const exchange={code,installationId:extInstallation,state,verifier};assert.equal((await request('/sensa/extension/exchange',{...exchange,verifier:'x'.repeat(64)},bearer)).status,401);
 const credential=await request('/sensa/extension/exchange',exchange,bearer);assert.equal(credential.status,200);assert.equal((await request('/sensa/extension/exchange',exchange,bearer)).status,401);
 const ext=credential.body.token;assert.equal((await initialize(extInstallation,ext)).status,200);assert.equal((await initialize(crypto.randomUUID(),ext)).status,403);assert.equal((await bootstrap(installation,ext)).code,'installation_scope_mismatch');
 const extBoot=await bootstrap(extInstallation,ext);assert.equal((await push(extBoot,[{...operation(),installationId:extInstallation,replicaId:extBoot.replicaId}],ext)).body.results[0].value.alreadySaved,true);
 await request('/sensa/account/session/revoke',{operationId:crypto.randomUUID()},bearer);assert.equal((await push(extBoot,[],ext)).status,401);
 console.log('M2-A intake/extension checks passed: Unicode occurrence, duplicate identity, atomic rollback, private feed, PKCE, one-use code, installation scope, revocation; capture requires no learning plan.');
}
