import {test,expect,vi,afterEach} from 'vitest';
import {assertDeletionConfigured,deleteHostedIdentity} from '../../../apps/api/src/sensa/access/deletion';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const subject='11111111-1111-4111-8111-111111111111',base='https://fixture.supabase.co';

test('a modern server secret uses apikey without masquerading as a bearer JWT',async()=>{
 vi.stubEnv('SUPABASE_URL',base);vi.stubEnv('SUPABASE_SECRET_KEY','sb_secret_synthetic_fixture');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','');
 const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(null,{status:204}));vi.stubGlobal('fetch',fetch);
 assertDeletionConfigured();await deleteHostedIdentity(subject,base+'/auth/v1');
 expect(fetch).toHaveBeenCalledTimes(1);const [url,options]=fetch.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe(base+'/auth/v1/admin/users/'+subject);expect(options.method).toBe('DELETE');expect(new Headers(options.headers).get('apikey')).toBe('sb_secret_synthetic_fixture');expect(new Headers(options.headers).has('authorization')).toBe(false);
 expect(JSON.parse(String(options.body))).toEqual({should_soft_delete:false});
});
test('legacy server-role configuration retains its bearer header and foreign projects are never called',async()=>{
 vi.stubEnv('SUPABASE_URL',base);vi.stubEnv('SUPABASE_SECRET_KEY','');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','synthetic-legacy-role');
 const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(null,{status:404}));vi.stubGlobal('fetch',fetch);
 await deleteHostedIdentity(subject,base+'/auth/v1');const options=fetch.mock.calls[0]?.[1] as RequestInit|undefined;
 expect(new Headers(options?.headers).get('authorization')).toBe('Bearer synthetic-legacy-role');
 await expect(deleteHostedIdentity(subject,'https://other.supabase.co/auth/v1')).rejects.toThrow('account_deletion_not_configured');expect(fetch).toHaveBeenCalledTimes(1);
});
