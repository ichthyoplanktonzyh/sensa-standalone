import {test,expect} from '@playwright/test';
import {createLocalSnapshotBrowserFixture} from '../support/localSnapshotBrowserFixture.mts';
test('checkpointed native source copy streams while real source reads continue',async({browser},info)=>{
 const fixture=await createLocalSnapshotBrowserFixture(browser,'scripts/support/snapshotSourceBrowserEntry.ts');
 try{const page=await fixture.createPage(),result=await page.evaluate(()=>(window as any).snapshotApi.roundtrip());expect(result.result.integrity).toBe('ok');expect(result.result.identity).toBeTruthy();expect(result.result.padding).toBeGreaterThan(8*1024*1024);expect(result.chunks).toBeGreaterThan(2);expect(result.probes.length).toBeGreaterThan(2);expect(result.byteLength).toBeGreaterThan(8*1024*1024);expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);await info.attach('native-copy.json',{body:JSON.stringify(result),contentType:'application/json'});await page.evaluate(()=>(window as any).snapshotApi.close());expect(fixture.externalRequests).toEqual([]);}finally{await fixture.close();}
});
for(const mode of ['write','abort','close'] as const)test(`source copy ${mode} interruption preserves the source and releases its transaction`,async({browser})=>{
 const fixture=await createLocalSnapshotBrowserFixture(browser,'scripts/support/snapshotSourceBrowserEntry.ts');
 try{const page=await fixture.createPage(),result=await page.evaluate(mode=>(window as any).snapshotApi.interrupt(mode),mode);expect(result.fired).toBe(true);expect(result.error).toBeTruthy();if(mode!=='close'){expect(result.identity).toBeTruthy();if(mode==='write')expect(result.write).toContain('survives-copy-cancellation');await page.evaluate(()=>(window as any).snapshotApi.close());}expect(fixture.externalRequests).toEqual([]);}finally{await fixture.close();}
});

test('actual SQLite Worker refuses a source transaction while an older candidate can resume',async({browser})=>{
 const fixture=await createLocalSnapshotBrowserFixture(browser,'scripts/support/snapshotSourceBrowserEntry.ts');
 try{const page=await fixture.createPage(),result=await page.evaluate(()=>(window as any).snapshotApi.candidateBusy());expect(result.copyError).toContain('sqlite_snapshot_source_busy');expect(result.candidateError).toBeTruthy();expect(result.identity).toBeTruthy();await page.evaluate(()=>(window as any).snapshotApi.close());}finally{await fixture.close();}
});
test('private native producer preserves source reads and exports only an unselected H-bound file',async({browser},info)=>{
 const fixture=await createLocalSnapshotBrowserFixture(browser,'scripts/support/snapshotSourceBrowserEntry.ts');
 try{const page=await fixture.createPage(),result=await page.evaluate(()=>(window as any).snapshotApi.prepare());expect(result.error).toBeUndefined();expect(result.checked).toMatchObject({integrity:'ok',records:1,baseline:1,pending:1});expect(result.checked.padding).toBeUndefined();expect(result.byteLength).toBeLessThan(8*1024*1024);expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);expect(result.io.hashedBytes).toBe(result.byteLength);expect(result.sourceTransfer.io.hashedBytes).toBe(0);expect(result.sourceTransfer.io.hashMs).toBe(0);expect(result.sourceTransfer.byteLength).toBeGreaterThan(result.byteLength);expect(result.metadata).toMatchObject({format:'sensa-own-cloud-db-v2',records:1});expect(result.work).toMatchObject({baselineRows:1,dependencyRows:1,portableRows:1});expect(result.probes.length).toBeGreaterThan(2);await info.attach('private-producer.json',{body:JSON.stringify(result),contentType:'application/json'});await page.evaluate(()=>(window as any).snapshotApi.close());expect(fixture.externalRequests).toEqual([]);}finally{await fixture.close();}
});
test('a source write during private native preparation invalidates the final source proof',async({browser})=>{
 const fixture=await createLocalSnapshotBrowserFixture(browser,'scripts/support/snapshotSourceBrowserEntry.ts');
 try{const page=await fixture.createPage(),result=await page.evaluate(()=>(window as any).snapshotApi.prepare('write'));expect(result.error).toContain('sqlite_snapshot_source_changed');expect(result.identity).toBeTruthy();expect(result.write).toContain('survives-private-preparation');expect(result.retained).toEqual([]);await page.evaluate(()=>(window as any).snapshotApi.close());expect(fixture.externalRequests).toEqual([]);}finally{await fixture.close();}
});
test('hard cancellation verifies private SAH handles before removing only its owned transfer directory',async({browser})=>{
 const fixture=await createLocalSnapshotBrowserFixture(browser,'scripts/support/snapshotSourceBrowserEntry.ts');
 try{const page=await fixture.createPage(),result=await page.evaluate(()=>(window as any).snapshotApi.prepare('abort'));expect(result.error,JSON.stringify(result.errorDetails)).toContain('private-preparation-cancel');expect(result.error).not.toContain('cleanup_unconfirmed');expect(result.identity).toBeTruthy();expect(result.retained).toEqual([]);await page.evaluate(()=>(window as any).snapshotApi.close());expect(fixture.externalRequests).toEqual([]);}finally{await fixture.close();}
});
test('hard cancellation after an actual output write preserves source and reclaims only its transfer files',async({browser})=>{
 const fixture=await createLocalSnapshotBrowserFixture(browser,'scripts/support/snapshotSourceBrowserEntry.ts');
 try{const page=await fixture.createPage(),result=await page.evaluate(()=>(window as any).snapshotApi.prepare('abort-export'));expect(result.error,JSON.stringify(result.errorDetails)).toContain('private-export-cancel');expect(result.error).not.toContain('cleanup_unconfirmed');expect(result.progress.some((step:any)=>step.stage==='file-export'&&step.bytes>0)).toBe(true);expect(result.identity).toBeTruthy();expect(result.retained).toEqual([]);await page.evaluate(()=>(window as any).snapshotApi.close());expect(fixture.externalRequests).toEqual([]);}finally{await fixture.close();}
});
