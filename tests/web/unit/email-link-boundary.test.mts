import {test,expect,vi,beforeEach} from 'vitest';
const exchange=vi.hoisted(()=>({calls:0,failed:false}));
vi.mock('../../../apps/web/src/data/account/auth',()=>({auth:{exchangeCodeForSession:async()=>{exchange.calls++;return {data:{session:exchange.failed?null:{user:{id:'synthetic-user'}}},error:exchange.failed?new Error('synthetic invalid code'):null};}}}));
beforeEach(()=>{vi.resetModules();exchange.calls=0;exchange.failed=false;const location=new URL('https://sensa.fixture.invalid/welcome?code=synthetic-code');vi.stubGlobal('window',{location,history:{replaceState:vi.fn()}});});

test('callback memo retains its original pre-logout binding across callers and remounts',async()=>{
 const callback=await import('../../../apps/web/src/data/consumer/emailLink');
 const first=callback.completeEmailLink(null);expect(await first).toBe('signed-in');
 expect(callback.emailLinkSignoutEpoch()).toBeNull();
 // A later component cannot label the old successful exchange with a newer
 // logout epoch, including the initial null/no-logout state.
 expect(callback.completeEmailLink('new-signout')).toBe(first);expect(await callback.completeEmailLink('new-signout')).toBe('signed-in');
 expect(callback.emailLinkSignoutEpoch()).toBeNull();expect(exchange.calls).toBe(1);
 expect(window.history.replaceState).toHaveBeenCalledWith(window.history.state,'','/welcome');
});
test('provider rejection cannot become a fresh successful callback proof',async()=>{
 exchange.failed=true;const callback=await import('../../../apps/web/src/data/consumer/emailLink');
 expect(await callback.completeEmailLink('before')).toBe('failed');expect(await callback.completeEmailLink('after')).toBe('failed');
 expect(callback.emailLinkSignoutEpoch()).toBe('before');expect(exchange.calls).toBe(1);
});
