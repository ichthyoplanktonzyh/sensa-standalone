/** Canonical local-fact presence; real bookmark owner commands, memory adapter. */
import {test,expect,vi} from 'vitest';
Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:{origin:'http://127.0.0.1:4319'}});

test('local usability follows replica ownership and stops in a bounded batch, including annotation-only libraries',async()=>{
 const library=await import('../../../apps/web/src/data/library/store');
 const {hasGuestLibraryContent}=await import('../../../apps/web/src/experience/account/guestLibraryConnection');
 await library.openLibrary();
 expect(await library.readLibrary(hasGuestLibraryContent)).toBe(false);
 await library.restoreLibraryTransaction(async tx=>{tx.put('settings','providers',{revision:1,assignments:{}});tx.put('meta','signed-out',true);});
 expect(await library.readLibrary(hasGuestLibraryContent)).toBe(false);
 const {personalContentSystem}=await import('../../../apps/web/src/personalContent/system');
 // Existing bookmarks may outlive their available source; this is not a new
 // public example-acquisition entry or an invented learning/Meaning result.
 for(let index=0;index<140;index++)await personalContentSystem.execute({kind:'set_saved_example',operationId:crypto.randomUUID(),exampleId:crypto.randomUUID(),saved:true});
 expect(await library.readLibrary(tx=>tx.count('semanticMeanings'))).toBe(0);
 expect(await library.readLibrary(tx=>tx.count('learningTargets'))).toBe(0);
 const adapter=await (await import('../../../apps/web/src/data/library/sqliteAdapter')).sqliteRecordAdapter();
 const pages:Array<{table:string;limit:number;rows:number}>=[],page=adapter.recordKeysPage.bind(adapter);
 const spy=vi.spyOn(adapter,'recordKeysPage').mockImplementation(async(table,after,limit)=>{const keys=await page(table,after,limit);pages.push({table,limit,rows:keys.length});return keys;});
 const hydrated=vi.spyOn(adapter,'entriesPage').mockImplementation(async()=>{throw new Error('presence must not decode a batch of fact bodies');});
 const whole=vi.spyOn(adapter,'entries').mockImplementation(async()=>{throw new Error('presence must not hydrate a whole table');});
 try{expect(await library.readLibrary(hasGuestLibraryContent)).toBe(true);}finally{spy.mockRestore();whole.mockRestore();hydrated.mockRestore();}
 expect(pages.every(row=>row.limit===128)).toBe(true);expect(pages.filter(row=>row.table==='annotations')).toHaveLength(1);
 expect(pages.find(row=>row.table==='annotations')?.rows).toBe(128);
});
