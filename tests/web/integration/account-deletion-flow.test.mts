import {beforeEach,test,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({subject:'account-a',sessionSubject:'account-a',token:'synthetic-old-token',epoch:null as string|null,scope:{libraryId:'library-a',incarnation:'incarnation-a'},callback:'signed-in',callbackEpoch:null as string|null,otpFailed:false,eraseError:'',signouts:0,sends:[] as unknown[],erases:[] as unknown[]}));
vi.mock('../../../apps/web/src/data/account/auth',()=>({auth:{
 getSession:async()=>({data:{session:{user:{id:fixture.sessionSubject},access_token:fixture.token}}}),
 signInWithOtp:async(input:unknown)=>{fixture.sends.push(input);expect(localStorage.getItem('sensa:account-deletion')).not.toBeNull();return {error:null};},
 verifyOtp:async()=>{fixture.token='synthetic-fresh-token';return {error:fixture.otpFailed?Error('invalid'):null,data:{session:fixture.otpFailed?null:{user:{id:fixture.sessionSubject},access_token:fixture.token}}};},
 signOut:async()=>{fixture.signouts++;},
}}));
vi.mock('../../../apps/web/src/data/account/accountSessionBoundary',()=>({accountSignoutEpoch:async()=>fixture.epoch}));
vi.mock('../../../apps/web/src/data/consumer/emailLink',()=>({emailLinkCallbackPresent:()=>new URL(window.location.href).searchParams.has('code')||new URL(window.location.href).searchParams.has('error'),emailLinkRedirect:()=> 'https://sensa.fixture.invalid/profile',emailLinkSignoutEpoch:()=>fixture.callbackEpoch,completeEmailLink:async()=>{fixture.token='synthetic-fresh-token';return fixture.callback;}}));
vi.mock('../../../apps/web/src/data/library/store',()=>({readLibrary:async(work:(tx:unknown)=>unknown)=>work({get:async()=>({subject:fixture.subject,email:'account-a@example.invalid'})})}));
vi.mock('../../../apps/web/src/data/library/dataControl',()=>({accountDeletionLocalScope:async(subject:string)=>{if(subject!==fixture.subject)throw Error('localFlow.wrongAccount');return fixture.scope;},eraseDeletedAccount:async(...args:unknown[])=>{fixture.erases.push(args);if(fixture.eraseError)throw Error(fixture.eraseError);}}));
vi.stubEnv('VITE_SENSA_API_URL','https://service.fixture.invalid');
beforeEach(()=>{
 vi.resetModules();vi.restoreAllMocks();Object.assign(fixture,{subject:'account-a',sessionSubject:'account-a',token:'synthetic-old-token',epoch:null,scope:{libraryId:'library-a',incarnation:'incarnation-a'},callback:'signed-in',callbackEpoch:null,otpFailed:false,eraseError:'',signouts:0,sends:[],erases:[]});
 const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
 vi.stubGlobal('window',{location:new URL('https://sensa.fixture.invalid/profile')});
});
const modules=async()=>({flow:(await import('../../../apps/web/src/experience/account/accountDeletionFlow')).accountDeletionFlow,state:await import('../../../apps/web/src/experience/account/accountDeletionState')});
const result=(operationId:string,state='deleted')=>new Response(JSON.stringify({operationId,state}),{status:200});

test('verification intent is durable before mail and neither cached session nor callback submits deletion',async()=>{
 const {flow,state}=await modules(),start=flow();await start.send();const receipt=state.pendingAccountDeletion()!;
 expect(receipt.phase).toBe('verifying');expect(fixture.sends).toEqual([{email:'account-a@example.invalid',options:{shouldCreateUser:false,emailRedirectTo:'https://sensa.fixture.invalid/profile'}}]);
 const fetch=vi.spyOn(globalThis,'fetch');await expect(start.verify()).rejects.toThrow('localFlow.emailLinkInvalid');await expect(start.submit()).rejects.toThrow('localFlow.deleteVerificationExpired');expect(fetch).not.toHaveBeenCalled();
 window.location.href='https://sensa.fixture.invalid/profile?code=synthetic-callback';const returned=flow();await returned.verify();expect(fetch).not.toHaveBeenCalled();
 fetch.mockImplementation(async(url)=>String(url).endsWith('/access/session')?new Response('{}',{status:200}):result(receipt.operationId));
 expect(await returned.submit()).toEqual({state:'deleted',localCleared:true});
 expect(fetch.mock.calls.map(([url])=>new URL(String(url)).pathname)).toEqual(['/sensa/web/access/session','/sensa/account/deletion']);expect(fixture.erases).toEqual([['account-a',receipt.localScope]]);expect(state.pendingAccountDeletion()).toBeNull();
});

test('failed or wrong-subject verification and a changed signout epoch cannot authorize deletion',async()=>{
 const {flow}=await modules(),start=flow();await start.send();fixture.otpFailed=true;await expect(start.verify('invalid')).rejects.toThrow('localFlow.otpInvalid');fixture.otpFailed=false;fixture.sessionSubject='account-b';await expect(start.verify('code')).rejects.toThrow('localFlow.wrongAccount');fixture.sessionSubject='account-a';await start.verify('code');fixture.epoch='later-signout';
 const fetch=vi.spyOn(globalThis,'fetch');await expect(start.submit()).rejects.toThrow('localFlow.deleteVerificationExpired');expect(fetch).not.toHaveBeenCalled();expect(fixture.erases).toEqual([]);
});

test('cached callback proof cannot be relabelled with a new logout epoch',async()=>{
 fixture.epoch='new-epoch';const {flow}=await modules(),start=flow();await start.send();window.location.href='https://sensa.fixture.invalid/profile?code=synthetic-callback';
 await expect(flow().verify()).rejects.toThrow('localFlow.emailLinkInvalid');expect(fixture.erases).toEqual([]);
});

test('lost response, status 404, reload and leaving retain one stable operation for a fresh retry',async()=>{
 const {flow,state}=await modules(),start=flow();await start.send();await start.verify('code');const operationId=start.receipt!.operationId;
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(url)=>String(url).endsWith('/access/session')?new Response('{}',{status:200}):Promise.reject(Error('lost response')));
 await expect(start.submit()).rejects.toThrow('lost response');expect(state.pendingAccountDeletion()?.phase).toBe('submitted');
 fetch.mockResolvedValue(new Response('{}',{status:404}));const recovered=flow();expect(await recovered.check()).toBeNull();expect(recovered.receipt?.operationId).toBe(operationId);await recovered.leave();expect(state.pendingAccountDeletion()?.dismissed).toBe(true);
 const retry=flow();await retry.send();await retry.verify('new-code');expect(state.pendingAccountDeletion()?.dismissed).toBe(false);
 fetch.mockImplementation(async(url)=>String(url).endsWith('/access/session')?new Response('{}',{status:200}):result(operationId));expect((await retry.submit()).state).toBe('deleted');
 const deletionCall=fetch.mock.calls.find(([url])=>String(url).endsWith('/sensa/account/deletion'));expect(JSON.parse(String(deletionCall?.[1]?.body)).operationId).toBe(operationId);
});

test('confirmed remote status does not erase a replaced guest library or sign out a different account',async()=>{
 const {flow,state}=await modules(),start=flow();await start.send();const receipt=start.receipt!;await state.storePendingAccountDeletion({...receipt,phase:'submitted'});
 fixture.eraseError='localFlow.wrongAccount';fixture.subject='guest';fixture.sessionSubject='account-b';
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(result(receipt.operationId));expect(await flow().check()).toEqual({state:'deleted',localCleared:false});expect(fixture.signouts).toBe(0);expect(fetch).toHaveBeenCalledTimes(1);expect(state.pendingAccountDeletion()).toBeNull();
});

test('provider pending and local I/O failure retain the submitted receipt for status recovery',async()=>{
 const {flow,state}=await modules(),start=flow();await start.send();await start.verify('code');const id=start.receipt!.operationId;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(url)=>String(url).endsWith('/access/session')?new Response('{}',{status:200}):result(id,'deletion_pending'));
 expect(await start.submit()).toEqual({state:'deletion_pending',localCleared:true});expect(state.pendingAccountDeletion()?.operationId).toBe(id);
 fixture.eraseError='localFlow.storageWrite';await expect(flow().check()).rejects.toThrow('localFlow.storageWrite');expect(state.pendingAccountDeletion()?.operationId).toBe(id);
});

test('same-owner replacement before submission rejects without sending; unsubmitted cancellation is safe',async()=>{
 const {flow,state}=await modules(),start=flow();await start.send();await start.verify('code');fixture.scope={...fixture.scope,incarnation:'replacement'};
 const fetch=vi.spyOn(globalThis,'fetch');await expect(start.submit()).rejects.toThrow('localFlow.libraryReplaced');expect(fetch).not.toHaveBeenCalled();await start.leave();expect(state.pendingAccountDeletion()).toBeNull();
});

test('a stale tab cannot demote or cancel a submitted receipt; completed exit cannot recreate it',async()=>{
 const {flow,state}=await modules(),stale=flow();await stale.send();const current=flow();await current.verify('code');const id=current.receipt!.operationId;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(url)=>String(url).endsWith('/access/session')?new Response('{}',{status:200}):result(id,'deletion_pending'));
 await current.submit();await stale.send();expect(state.pendingAccountDeletion()?.phase).toBe('submitted');await stale.leave();expect(state.pendingAccountDeletion()?.operationId).toBe(id);
 vi.mocked(fetch).mockResolvedValue(result(id));expect((await current.check())?.state).toBe('deleted');await current.leave();await stale.leave();expect(state.pendingAccountDeletion()).toBeNull();
});

test('another tab cancellation cannot be revived by a verified stale submission',async()=>{
 const {flow,state}=await modules(),start=flow();await start.send();await start.verify('code');const id=start.receipt!.operationId;
 vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{await state.clearPendingAccountDeletion(id,true);return new Response('{}',{status:200});});
 await expect(start.submit()).rejects.toThrow('localFlow.deleteRetry');expect(fetch).toHaveBeenCalledTimes(1);expect(state.pendingAccountDeletion()).toBeNull();
 await expect(state.storePendingAccountDeletion({...start.receipt!,phase:'submitted'})).rejects.toThrow('localFlow.deleteRetry');
});
