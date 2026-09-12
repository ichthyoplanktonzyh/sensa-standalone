import assert from 'node:assert/strict';
import {authRedirectConfigMatches,desiredAuthRedirectConfig,reconcileSupabaseAuth} from './release/supabaseAuthConfig.mjs';

const environment={SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',SENSA_WEB_ORIGIN:'https://sensa.example.com',SUPABASE_ACCESS_TOKEN:'fixture-token'};
const desired=desiredAuthRedirectConfig(environment);
assert.deepEqual(desired,{projectRef:'abcdefghijklmnopqrst',siteUrl:'https://sensa.example.com',uriAllowList:'https://sensa.example.com/**'});
assert(authRedirectConfigMatches({site_url:'https://sensa.example.com/',uri_allow_list:'https://sensa.example.com/**'},desired));
assert(!authRedirectConfigMatches({site_url:'http://127.0.0.1:3001',uri_allow_list:'http://127.0.0.1:3001/**'},desired));
assert.throws(()=>desiredAuthRedirectConfig({...environment,SENSA_WEB_ORIGIN:'https://sensa.example.com/profile'}),/HTTPS origin/);

const calls=[];let config={site_url:'http://127.0.0.1:3001',uri_allow_list:'http://127.0.0.1:3001/**',smtp_pass:'must-not-be-sent'};
const fetchImpl=async(url,init)=>{
 calls.push({url,method:init.method??'GET',body:init.body});
 if(init.method==='PATCH')config={...config,...JSON.parse(init.body)};
 return new Response(JSON.stringify(config),{status:200,headers:{'content-type':'application/json'}});
};
await reconcileSupabaseAuth({mode:'apply',environment,fetchImpl});
assert.deepEqual(calls.map(call=>call.method),['GET','PATCH','GET']);
assert.deepEqual(JSON.parse(calls[1].body),{site_url:'https://sensa.example.com',uri_allow_list:'https://sensa.example.com/**'});
assert(!calls[1].body.includes('smtp_pass'));
calls.length=0;
await reconcileSupabaseAuth({mode:'check',environment,fetchImpl});
assert.deepEqual(calls.map(call=>call.method),['GET']);
console.log('PASS: production Auth redirect config validates, patches only Site URL/allow list and verifies convergence.');
