import {beforeAll,expect,test} from 'vitest';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createConsumerVerifier,type ConsumerVerifier} from '../../../apps/api/src/sensa/access/auth.js';

const issuer='https://fixture.supabase.co/auth/v1',subject=crypto.randomUUID(),sessionId=crypto.randomUUID(),timestamp=1791548108;
let verify:ConsumerVerifier,sign:(claims:Record<string,unknown>)=>Promise<Request>;
beforeAll(async()=>{
 const keys=await generateKeyPair('ES256'),jwk=await exportJWK(keys.publicKey);jwk.kid='fixture';
 verify=createConsumerVerifier(issuer,createLocalJWKSet({keys:[jwk]}));
 sign=async claims=>new Request('https://api.fixture.invalid',{headers:{authorization:'Bearer '+await new SignJWT({session_id:sessionId,...claims}).setProtectedHeader({alg:'ES256',kid:'fixture'}).setIssuer(issuer).setSubject(subject).setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey)}});
});

test.each(['otp','magiclink'])('signed %s AMR supplies the actual email verification time',async method=>{
 const principal=await verify(await sign({amr:[{method,timestamp}]}));
 expect(principal.authenticatedAt).toBe(timestamp);expect(principal.subject).toBe(subject);
});
test.each(['token_refresh','oauth','password','totp','invite','email/signup','email_change','anonymous'])('%s alone is not the required email reauthentication proof',async method=>{
 expect((await verify(await sign({amr:[{method,timestamp}]}))).authenticatedAt).toBeUndefined();
});
test('only finite numeric email AMR timestamps count, not JWT issue time or user metadata',async()=>{
 const principal=await verify(await sign({amr:[null,{method:'magiclink',timestamp:String(timestamp)},{method:'otp',timestamp:null},{method:'otp'}],user_metadata:{amr:[{method:'magiclink',timestamp}]},aal:'aal2'}));
 expect(principal.authenticatedAt).toBeUndefined();
});
test('refresh cannot renew an old email proof, and the latest actual email proof wins',async()=>{
 expect((await verify(await sign({amr:[{method:'token_refresh',timestamp},{method:'magiclink',timestamp:timestamp-3600}]}))).authenticatedAt).toBe(timestamp-3600);
 expect((await verify(await sign({amr:[{method:'otp',timestamp:timestamp-30},{method:'magiclink',timestamp},{method:'oauth',timestamp:timestamp+100}]}))).authenticatedAt).toBe(timestamp);
});
