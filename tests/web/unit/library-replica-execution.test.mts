import {test,expect,vi} from 'vitest';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec.ts';
import {mergeLibraryReplicas,mergeLibraryReplicasCooperatively,type LibraryReplicaEntry} from '../../../apps/web/src/data/library/replication/libraryReplica.ts';

test('cooperative merge lets queued work run before completing lazy body comparisons',async()=>{
 let reads=0,timerReads=-1;
 const row=(key:string,text:string):LibraryReplicaEntry=>({table:'drafts',key,get value(){reads++;return encodeBackupValue({text});}});
 const base=Array.from({length:2000},(_,i)=>row(String(i),'before'));
 const local=base.map((entry,i)=>row(entry.key,i===7?'ours':'before'));
 const remote=base.map((entry,i)=>row(entry.key,i===8?'theirs':'before'));
 // Cross the existing scheduler budget once after comparisons have started.
 // This proves an actual event-loop yield, not a wall-clock performance gate.
 const clock=vi.spyOn(performance,'now').mockImplementation(()=>reads>500?9:0);
 const timer=setTimeout(()=>{timerReads=reads;},0);
 let result:Awaited<ReturnType<typeof mergeLibraryReplicasCooperatively>>;
 try{result=await mergeLibraryReplicasCooperatively({base,local,remote});}
 finally{clearTimeout(timer);clock.mockRestore();}
 expect(timerReads).toBeGreaterThan(500);
 expect(timerReads).toBeLessThan(reads);
 expect(result!.conflicts).toEqual([]);
 expect(result!).toEqual(mergeLibraryReplicas({base,local,remote}));
});

test('unknown record ownership is rejected without reading opaque bodies',async()=>{
 let reads=0;
 const entry={table:'settings' as const,key:'providers',get value(){reads++;throw Error('must_not_read');}};
 const input={base:[],local:[entry],remote:[]};
 expect(()=>mergeLibraryReplicas(input)).toThrow('library_sync_format');
 await expect(mergeLibraryReplicasCooperatively(input)).rejects.toThrow('library_sync_format');
 expect(reads).toBe(0);
});
