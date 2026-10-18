import {afterEach,expect,test,vi} from 'vitest';
import {CloudSyncDeadline} from '../../../apps/web/src/data/library/cloudSyncDeadline';
afterEach(()=>vi.useRealTimers());

test('first transfer may exceed 90 seconds with completed work; daily pass still expires',async()=>{
 vi.useFakeTimers();const daily=new CloudSyncDeadline(),first=new CloudSyncDeadline();first.beginInitial();
 for(let page=1;page<=4;page++){await vi.advanceTimersByTimeAsync(60_000);first.progress('capture',page);}
 expect(first.signal.aborted).toBe(false);expect(daily.signal.reason.message).toBe('library_sync_network');
 expect(await first.run(async()=>42)).toBe(42);daily.close();first.close();
});
test('repeated progress and a hung local phase cannot keep a transfer alive',async()=>{
 vi.useFakeTimers();const first=new CloudSyncDeadline();first.beginInitial();first.progress('capture',1);
 const pending=first.run(()=>new Promise(()=>{})),failure=expect(pending).rejects.toThrow('library_sync_stalled');
 await vi.advanceTimersByTimeAsync(60_000);first.progress('capture',1);await vi.advanceTimersByTimeAsync(30_000);await failure;first.close();
});
test('hung request terminates at 15 seconds even when transport ignores abort',async()=>{
 vi.useFakeTimers();const first=new CloudSyncDeadline();first.beginInitial();
 const pending=first.request(()=>new Promise(()=>{})),failure=expect(pending).rejects.toThrow('library_sync_network');
 await vi.advanceTimersByTimeAsync(15_000);await failure;first.close();
});
test('cancellation rejects late request completion and prevents further work',async()=>{
 const caller=new AbortController(),first=new CloudSyncDeadline(caller.signal);first.beginInitial();let finish!:(value:number)=>void;
 const pending=first.request(()=>new Promise<number>(resolve=>finish=resolve));caller.abort();finish(42);
 await expect(pending).rejects.toThrow('library_sync_cancelled');expect(()=>first.progress('commit',1)).toThrow('library_sync_cancelled');first.close();
});

test('cancellation after the atomic commit boundary honors its eventual result',async()=>{
 const caller=new AbortController(),deadline=new CloudSyncDeadline(caller.signal);deadline.beginInitial();let finish!:(value:number)=>void;
 const pending=deadline.run(beginCommit=>{beginCommit();return new Promise<number>(resolve=>finish=resolve);});caller.abort();finish(42);
 expect(await pending).toBe(42);deadline.close();
});
