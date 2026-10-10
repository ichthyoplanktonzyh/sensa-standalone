import {test,expect} from 'vitest';
import {PersonalLearningBatch,isBatchTaskReady,type PersonalLearningBatchPort} from '../../../apps/web/src/experience/library/personalLearningBatch';
import {personalLearningSourceKey,type PersonalMeaningLearningSource,type ContentProvisioningTask} from '../../../apps/web/src/contentSupply/provisioning/contracts';
import {worldLearningChoice} from '../../../apps/web/src/experience/personalMeaningJourney/worldRead';
import {semanticLookupSpec} from '../support/semanticLookupFixtures';
import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';

const context:SensaFormalPinnedLanguageContext={languageRouteId:crypto.randomUUID(),languageRouteRevision:1,targetLanguageTag:'en',supportLanguageTag:'zh-CN'};
const source=():PersonalMeaningLearningSource=>({sourceKind:'personal_meaning_alignment',reference:{personalMeaningId:crypto.randomUUID(),personalMeaningRevisionId:crypto.randomUUID(),personalMeaningAlignmentId:crypto.randomUUID(),alignmentRevision:1,alignmentBasisReferenceId:crypto.randomUUID(),meaningFocusId:null,senseId:crypto.randomUUID(),senseVersionId:crypto.randomUUID(),bindingId:crypto.randomUUID(),bindingVersionId:crypto.randomUUID()},targetLanguageTag:'en',context:{text:'private Context',images:[],personalSemanticAnchorRevisionIds:[]},expression:{surfaceForm:'borrow',expressionType:'word',languageTag:'en'},semanticSpec:semanticLookupSpec});
const tick=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};
function fixture(size:number){
 const sources=Array.from({length:size},source),choices=sources.map(worldLearningChoice),byKey=new Map(sources.map(source=>[personalLearningSourceKey(source.reference),source]));
 const tasks=new Map<string,ContentProvisioningTask>(),events:string[]=[],held=new Map<string,{resolve:()=>void;reject:(cause:Error)=>void}>();
 let active=0,maxActive=0;
 const port:PersonalLearningBatchPort={
  resolve:async choice=>byKey.get(choice.key)!,
  enroll:async(source,languageContext,useContext)=>{
   const id=personalLearningSourceKey(source.reference);events.push(`enroll:${id}`);
   if(!tasks.has(id))tasks.set(id,{id,source:source.reference,targetId:crypto.randomUUID(),curriculumMembershipId:crypto.randomUUID(),languageContext,useContext,status:'waiting',planRevision:crypto.randomUUID(),attemptId:null,leaseUntil:0,notice:'',createdAt:new Date().toISOString()});
   return id;
  },
  task:async id=>tasks.get(id)??null,
  revise:async(id,source,languageContext,useContext)=>{Object.assign(tasks.get(id)!,{languageContext,useContext,contextPin:[...source.context.personalSemanticAnchorRevisionIds],status:'waiting'});events.push(`revise:${id}`);},
  prepare:async id=>{
   active++;maxActive=Math.max(maxActive,active);events.push(`prepare:${id}`);tasks.get(id)!.status='generating';
   try{await new Promise<void>((resolve,reject)=>held.set(id,{resolve,reject}));tasks.get(id)!.status='ready';}
   finally{held.delete(id);active--;}
  },
  cancel:id=>held.get(id)?.reject(new Error('localFlow.requestStopped')),
  stop:async id=>{events.push(`stop:${id}`);tasks.get(id)!.status='stopped';},
 };
 return {sources,choices,tasks,events,held,port,active:()=>active,maxActive:()=>maxActive};
}

test('all explicit intentions precede generation, duplicates are idempotent, and preparation is bounded',async()=>{
 const f=fixture(100),batch=new PersonalLearningBatch(f.port,3),work=batch.run([...f.choices,f.choices[0]!],context,false);
 await tick();
 while(!f.events.some(event=>event.startsWith('prepare:')))await tick();
 expect(f.tasks.size).toBe(100);expect(f.events.slice(0,100).every(event=>event.startsWith('enroll:'))).toBe(true);
 expect(batch.read().count).toBe(100);expect(batch.read().counts.working).toBe(3);
 while(batch.read().busy){for(const held of [...f.held.values()])held.resolve();await tick();}
 await work;expect(f.maxActive()).toBe(3);expect(batch.read().counts).toEqual({waiting:0,working:0,ready:100,failed:0});
 expect(batch.rowAt(99)?.choice).toEqual(f.choices[99]);expect(batch.rowAt(99)).not.toHaveProperty('context');
});

test('ready material from an old route revision is selectable and explicitly revised before regeneration',async()=>{
 const f=fixture(1),choice=f.choices[0]!,id=await f.port.enroll(f.sources[0]!,context,false);
 f.tasks.get(id)!.status='ready';const next={...context,languageRouteRevision:2,supportLanguageTag:'fr'};
 expect(isBatchTaskReady(f.tasks.get(id),context)).toBe(true);expect(isBatchTaskReady(f.tasks.get(id),next)).toBe(false);
 const batch=new PersonalLearningBatch(f.port),work=batch.run([choice],next,false);
 while(!f.held.size)await tick();expect(f.events.some(event=>event===`revise:${id}`)).toBe(true);
 f.held.get(id)!.resolve();await work;expect(isBatchTaskReady(f.tasks.get(id),next)).toBe(true);
});

test('a failed explicit update is not reported as prepared just because old material remains ready',async()=>{
 const f=fixture(1),id=await f.port.enroll(f.sources[0]!,context,false);f.tasks.get(id)!.status='ready';
 f.port.revise=async()=>{throw new Error('localFlow.storageUnavailable');};
 const batch=new PersonalLearningBatch(f.port);await batch.run(f.choices,{...context,languageRouteRevision:2,supportLanguageTag:'ja'},false);
 expect(batch.read().counts).toEqual({ready:0,failed:1,waiting:0,working:0});
 expect(batch.rowAt(0)?.notice).toBe('localFlow.storageUnavailable');
 expect(f.tasks.get(id)).toMatchObject({status:'ready',languageContext:context});
 expect(f.events.some(event=>event.startsWith('prepare:'))).toBe(false);
});

test('a preparation error after durable success still reports the saved ready result',async()=>{
 const f=fixture(1);f.port.prepare=async id=>{f.tasks.get(id)!.status='ready';throw new Error('notification_failed');};
 const batch=new PersonalLearningBatch(f.port);await batch.run(f.choices,context,false);
 expect(batch.read().counts).toEqual({ready:1,failed:0,waiting:0,working:0});
});

test('covered tasks reuse existing material without preparing or changing Context consent',async()=>{
 const f=fixture(2);
 for(const source of f.sources){const id=await f.port.enroll(source,context,false);Object.assign(f.tasks.get(id)!,{status:'covered',coveredByMembershipId:crypto.randomUUID()});}
 const batch=new PersonalLearningBatch(f.port);await batch.run(f.choices,{...context,languageRouteRevision:2},true);
 expect(batch.read().counts).toEqual({ready:2,failed:0,waiting:0,working:0});
 expect(f.events.some(event=>event.startsWith('prepare:')||event.startsWith('revise:'))).toBe(false);
 expect([...f.tasks.values()].every(task=>task.useContext===false)).toBe(true);
});

test('a revised task already covered in the new route pair never starts a redundant preparation',async()=>{
 const f=fixture(1),id=await f.port.enroll(f.sources[0]!,context,false);f.tasks.get(id)!.status='covered';
 f.port.revise=async(taskId,_source,languageContext,useContext)=>{Object.assign(f.tasks.get(taskId)!,{languageContext,useContext,status:'covered',coveredByMembershipId:crypto.randomUUID()});};
 const batch=new PersonalLearningBatch(f.port);await batch.run(f.choices,{...context,languageRouteRevision:2,supportLanguageTag:'ja'},false);
 expect(batch.read().counts.ready).toBe(1);expect(f.events.some(event=>event.startsWith('prepare:'))).toBe(false);
});

test('a failed persistent stop never reports an active lease as a saved waiting task',async()=>{
 const f=fixture(1),batch=new PersonalLearningBatch(f.port);
 f.port.stop=async()=>{throw new Error('localFlow.storageUnavailable');};
 const work=batch.run(f.choices,context,false);while(!f.held.size)await tick();
 await batch.stop();await work;expect(f.tasks.get(f.choices[0]!.key)?.status).toBe('generating');
 expect(batch.read().counts).toEqual({waiting:0,working:0,ready:0,failed:1});expect(batch.rowAt(0)?.notice).toBe('localFlow.storageUnavailable');
});

test('stop during a post-preparation read does not turn a saved rejection into a waiting intention',async()=>{
 const f=fixture(1);let reads=0,finishRead:(()=>void)|null=null;
 f.port.prepare=async id=>{Object.assign(f.tasks.get(id)!,{status:'rejected',notice:'localFlow.validationRejected'});};
 f.port.task=async id=>{if(++reads===2)await new Promise<void>(resolve=>{finishRead=resolve;});return f.tasks.get(id)??null;};
 const batch=new PersonalLearningBatch(f.port),work=batch.run(f.choices,context,false);while(!finishRead)await tick();
 await batch.stop();(finishRead as ()=>void)();await work;
 expect(batch.read().counts).toEqual({waiting:0,working:0,ready:0,failed:1});expect(batch.rowAt(0)?.notice).toBe('localFlow.validationRejected');
 expect(f.events.filter(event=>event.startsWith('stop:'))).toEqual([]);
});

test('10k progress retains compact rows and coalesces notifications instead of forcing a render per intention',async()=>{
 const f=fixture(10_000);f.port.prepare=async id=>{f.tasks.get(id)!.status='ready';};
 const batch=new PersonalLearningBatch(f.port);let notifications=0;const stop=batch.subscribe(()=>{notifications++;});
 await batch.run(f.choices,context,false);stop();expect(batch.read().counts.ready).toBe(10_000);expect(notifications).toBeLessThan(100);
 expect(batch.read().busy).toBe(false);expect(batch.rowAt(9999)?.choice).not.toHaveProperty('context');
});

test('stop cancels only active tasks, preserves waiting intentions, and explicit resume honors Context consent',async()=>{
 const f=fixture(50),batch=new PersonalLearningBatch(f.port,2),work=batch.run(f.choices,context,false);
 while(f.held.size<2)await tick();
 await batch.stop();await work;
 expect(f.events.filter(event=>event.startsWith('stop:'))).toHaveLength(2);expect(f.tasks.size).toBe(50);
 expect(batch.read()).toMatchObject({busy:false,counts:{waiting:50,working:0,ready:0,failed:0}});
 expect(f.events.filter(event=>event.startsWith('prepare:'))).toHaveLength(2);
 const resumed=batch.run(batch.choices('waiting'),context,true);
 while(batch.read().busy){for(const held of [...f.held.values()])held.resolve();await tick();}
 await resumed;expect(f.tasks.size).toBe(50);expect([...f.tasks.values()].every(task=>task.useContext&&task.status==='ready')).toBe(true);
 expect(batch.read().counts.ready).toBe(50);
});

test('stale pins fail closed before enrollment; preparation failure retries only failed compact choices',async()=>{
 const f=fixture(4),resolve=f.port.resolve;
 f.port.resolve=async choice=>{if(choice.key===f.choices[0]!.key)throw new Error('localFlow.meaningChanged');return resolve(choice);};
 const batch=new PersonalLearningBatch(f.port),work=batch.run(f.choices,context,false);
 while(f.held.size<3)await tick();
 f.held.get(f.choices[1]!.key)!.reject(new Error('localFlow.checkModels'));
 for(const [key,held] of f.held)if(key!==f.choices[1]!.key)held.resolve();
 await work;expect(f.tasks.size).toBe(3);expect(batch.read().counts).toEqual({waiting:0,working:0,ready:2,failed:2});
 expect(batch.rowAt(0)?.notice).toBe('localFlow.meaningChanged');
 f.port.resolve=resolve;const retry=batch.run(batch.choices('failed'),context,false);
 while(batch.read().busy){for(const held of [...f.held.values()])held.resolve();await tick();}
 await retry;expect(batch.read().count).toBe(2);expect(batch.read().counts.ready).toBe(2);expect(f.tasks.size).toBe(4);
});

test('stop during enrollment starts no generation; run stays busy until outstanding stop writes settle',async()=>{
 const f=fixture(3);let release!:()=>void;
 const enroll=f.port.enroll;f.port.enroll=async(...args)=>{const id=await enroll(...args);await new Promise<void>(resolve=>{release=resolve;});return id;};
 const batch=new PersonalLearningBatch(f.port),work=batch.run(f.choices,context,false);await tick();
 await batch.stop();release();await work;expect(f.tasks.size).toBe(1);expect(f.held.size).toBe(0);expect(batch.read().counts.waiting).toBe(3);
 const second=fixture(1);let finishStop!:()=>void;
 second.port.stop=()=>new Promise(resolve=>{finishStop=()=>resolve(null);});
 const waiting=new PersonalLearningBatch(second.port),running=waiting.run(second.choices,context,false);
 while(!second.held.size)await tick();
 const stopping=waiting.stop();await tick();expect(waiting.read().busy).toBe(true);
 finishStop();await stopping;await running;expect(waiting.read().busy).toBe(false);
});
