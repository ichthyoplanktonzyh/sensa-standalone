import {test,expect} from 'vitest';
import {betaAuthConfig,reconcileBetaAuth} from '../../../scripts/release/betaAuthConfig.mjs';
import {inviteBetaUser} from '../../../scripts/operations/inviteBetaUser.mjs';

const projectRef='abcdefghijklmnopqrst',subject='11111111-1111-4111-8111-111111111111';
const email='invited@example.invalid';
const user={id:subject,email,email_confirmed_at:'2026-10-19T00:00:00Z'};

test('beta Auth closes signup and verifies only the intended fields without changing SMTP or sessions',async()=>{
 const environment={SUPABASE_PROJECT_REF:projectRef,SENSA_WEB_ORIGIN:'https://sensa.example.com',SUPABASE_ACCESS_TOKEN:'synthetic-token'};
 let config={site_url:environment.SENSA_WEB_ORIGIN,uri_allow_list:environment.SENSA_WEB_ORIGIN+'/**',external_email_enabled:true,smtp_host:'smtp.example.invalid',smtp_port:'587',smtp_user:'synthetic-sender',smtp_admin_email:'support@example.invalid',smtp_pass:'private',jwt_exp:3600};
 const calls=[];
 const fetchImpl=async(url,init)=>{calls.push(init);if(init.method==='PATCH')config={...config,...JSON.parse(init.body)};return Response.json(config);};
 const db={query:async()=>({rows:[{blocked:0}]})};
 await expect(reconcileBetaAuth({environment,fetchImpl})).rejects.toThrow('does not match');
 expect(calls).toHaveLength(1);calls.length=0;
 await expect(reconcileBetaAuth({mode:'apply',environment,fetchImpl})).rejects.toThrow('preflight');
 expect(calls).toHaveLength(1);calls.length=0;
 await expect(reconcileBetaAuth({mode:'apply',environment,fetchImpl,db:{query:async()=>({rows:[{blocked:1}]})}})).rejects.toThrow('need review');
 expect(calls).toHaveLength(1);calls.length=0;
 await reconcileBetaAuth({mode:'apply',environment,fetchImpl,db});
 expect(calls.map(call=>call.method??'GET')).toEqual(['GET','PATCH','GET']);
 expect(JSON.parse(calls[1].body)).toEqual(betaAuthConfig);
 expect(config.smtp_pass).toBe('private');expect(config.jwt_exp).toBe(3600);
 expect(config.disable_signup).toBe(true);expect(config.mailer_otp_length).toBe(6);expect(config.mailer_otp_exp).toBe(600);
 expect(config.mailer_templates_magic_link_content).toContain('{{ .Token }}');
 expect(config.mailer_templates_magic_link_content).not.toContain('ConfirmationURL');
 calls.length=0;await reconcileBetaAuth({environment,fetchImpl});expect(calls).toHaveLength(1);
 for(const patch of [{external_email_enabled:false},{smtp_host:''},{smtp_port:0},{smtp_port:'invalid'},{hook_send_email_enabled:true}]){
  const saved=config;config={...config,...patch};calls.length=0;
  await expect(reconcileBetaAuth({mode:'apply',environment,fetchImpl,db})).rejects.toThrow(/Email authentication|Custom SMTP|SMTP port|send-email hook/);
  expect(calls).toHaveLength(1);config=saved;
 }
});

function fixture(existing=user){
 let users=existing?[existing]:[],invitation,fail=false;
 const creates=[],queries=[];
 const admin={listUsers:async()=>({data:{users},error:null}),createUser:async input=>{creates.push(input);users=[user];return {data:{user},error:null};}};
 const db={query:async(sql,params)=>{queries.push({sql,params});if(fail&&sql.startsWith('INSERT'))throw Error('synthetic database failure');if(sql.startsWith('INSERT'))invitation??={revoked:false};return {rows:sql.startsWith('SELECT revoked')&&invitation?[invitation]:[]};}};
 return {admin,db,creates,queries,setRevoked:()=>{invitation={revoked:true};},setFail:value=>{fail=value;}};
}

test('inviting by email previews without writes, reuses the exact identity and never revives revocation',async()=>{
 const f=fixture(),run=apply=>inviteBetaUser({email:' INVITED@example.invalid ',projectRef,...f,apply});
 expect(await run(false)).toEqual({status:'would-invite'});expect(f.creates).toHaveLength(0);expect(f.queries.every(q=>q.sql.startsWith('SELECT'))).toBe(true);
 expect(await run(true)).toEqual({status:'invited',subject});
 expect(f.queries.find(q=>q.sql.startsWith('INSERT')).params).toEqual([`https://${projectRef}.supabase.co/auth/v1`,subject]);
 expect(await run(true)).toEqual({status:'already-invited',subject});expect(f.creates).toHaveLength(0);
 f.setRevoked();const count=f.queries.length;await expect(run(true)).rejects.toThrow('revoked');expect(f.queries.slice(count).every(q=>q.sql.startsWith('SELECT'))).toBe(true);
});

test('new beta identity has no password or session; database failure can be retried without replacing it',async()=>{
 const f=fixture(null),run=apply=>inviteBetaUser({email,projectRef,...f,apply});
 expect(await run(false)).toEqual({status:'would-create-and-invite'});expect(f.creates).toHaveLength(0);
 f.setFail(true);await expect(run(true)).rejects.toThrow('synthetic database failure');
 expect(f.creates).toEqual([{email,email_confirm:true}]);expect(f.queries.at(-1).sql).toBe('ROLLBACK');
 f.setFail(false);expect(await run(true)).toEqual({status:'invited',subject});expect(f.creates).toHaveLength(1);
});

test('unconfirmed or banned existing Auth identities are not altered or admitted',async()=>{
 for(const existing of [{...user,email_confirmed_at:null},{...user,banned_until:'2999-01-01T00:00:00Z'}]){
  const f=fixture(existing);await expect(inviteBetaUser({email,projectRef,...f,apply:true})).rejects.toThrow('review');expect(f.creates).toHaveLength(0);expect(f.queries).toHaveLength(0);
 }
});
