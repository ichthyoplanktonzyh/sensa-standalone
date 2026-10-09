import {test,expect,vi} from 'vitest';
const session=vi.hoisted(()=>({subject:''}));
vi.mock('../../../apps/web/src/data/account/auth',()=>({auth:{getSession:async()=>({data:{session:{user:{id:session.subject},access_token:'synthetic-session'}}})}}));
Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:{origin:'http://127.0.0.1:4319'}});
vi.stubEnv('VITE_SENSA_API_URL','https://service.fixture.invalid');

const library=await import('../../../apps/web/src/data/library/store');
const boundary=await import('../../../apps/web/src/data/account/accountSessionBoundary');
const delivery=await import('../../../apps/web/src/data/library/intakeDelivery');
const control=await import('../../../apps/web/src/data/library/dataControl');
const identity=await library.openLibrary(),owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()};session.subject=owner.subject;
const connect=()=>library.command({id:crypto.randomUUID(),kind:'service.connect',input:owner},async tx=>{tx.put('meta','service-owner',owner);tx.put('meta','signed-out',false);});
const signout=()=>{const id=crypto.randomUUID();return library.command({id,kind:'service.signout',input:{}},async tx=>{tx.put('meta','signed-out',true);tx.put('meta',boundary.accountSignoutEpochKey,id);return id;});};

test('logout invalidates an outstanding delivery and reconnection cannot revive its old boundary',async()=>{
 await connect();const original=await boundary.captureAccountSessionBoundary(owner.subject);
 let release!:(response:Response)=>void,entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;}),response=new Promise<Response>(resolve=>{release=resolve;});
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{entered();return response;});
 try{
  const pending=delivery.registerIntakeDeliveryChannel(identity.id);
  await ready;await signout();release(new Response(JSON.stringify({registered:true}),{status:200}));
  await expect(pending).rejects.toThrow('authentication_required');
  await expect(delivery.pullIntakeDeliveries(identity.id)).rejects.toThrow('authentication_required');expect(fetch).toHaveBeenCalledTimes(1);
  await connect();await expect(boundary.assertAccountSessionBoundary(original)).rejects.toThrow('account_changed');
  const current=await boundary.captureAccountSessionBoundary(owner.subject);await boundary.assertAccountSessionBoundary(current);
  expect(current.epoch).not.toBe(original.epoch);expect((await library.readLibrary(tx=>tx.get<typeof identity>('meta','identity')))?.id).toBe(identity.id);
 }finally{fetch.mockRestore();}
});

test('a still-present SDK session cannot send after logout or claim a different owner',async()=>{
 await connect();await signout();
 const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('network must not run'));
 try{
  await expect(delivery.registerIntakeDeliveryChannel(identity.id)).rejects.toThrow('authentication_required');
  await connect();session.subject=crypto.randomUUID();await expect(delivery.registerIntakeDeliveryChannel(identity.id)).rejects.toThrow('account_changed');
  expect(fetch).not.toHaveBeenCalled();expect(await library.readLibrary(tx=>tx.get('meta','service-owner'))).toEqual(owner);
 }finally{session.subject=owner.subject;fetch.mockRestore();}
});

test('clearing signed-out content cannot revive a pre-logout null boundary with a cached SDK session',async()=>{
 await connect();
 // Model the first logout: there is no earlier signout nonce to compare.
 await library.command({id:crypto.randomUUID(),kind:'fixture.first-signout',input:{}},async tx=>{tx.delete('meta',boundary.accountSignoutEpochKey);});
 const original=await boundary.captureAccountSessionBoundary(owner.subject);expect(original.epoch).toBeNull();
 await signout();const epoch=await boundary.accountSignoutEpoch();
 const preview=await control.attemptLocalClearSync(await control.inspectLocalClear(),async()=>{throw Error('signed out');});
 await control.clearLocalLibrary(preview,{discardPendingSync:true});
 expect(await library.readLibrary(tx=>tx.get('meta','signed-out'))).toBe(true);expect(await boundary.accountSignoutEpoch()).toBe(epoch);
 expect((await library.readLibrary(tx=>tx.get<typeof identity>('meta','identity')))?.id).not.toBe(identity.id);
 const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('network must not run'));
 try{
  await expect(boundary.assertAccountSessionBoundary(original)).rejects.toThrow('authentication_required');
  await expect(delivery.pullIntakeDeliveries(identity.id)).rejects.toThrow('authentication_required');expect(fetch).not.toHaveBeenCalled();
 }finally{fetch.mockRestore();}
});
