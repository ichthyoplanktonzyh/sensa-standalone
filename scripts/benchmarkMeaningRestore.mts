/** Provider-free CPU/SQL profile of the shipped synchronizer over SQLite/Wasm.
 * In-memory storage is NOT Chromium/OPFS, account UI or a capacity guarantee.
 * Instrumentation lives here, never in the production protocol or interface. */
import assert from 'node:assert/strict';
import {MemoryJourneyRepository} from '../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../apps/web/src/experience/personalMeaningJourney/ports';
import {semanticLookupPayload,syntheticSemanticWorld} from '../tests/web/support/semanticLookupFixtures';
import {semanticRecords} from '../tests/web/support/semanticWorldRecordFixture.mts';
import {candidateFixture} from '../tests/web/support/replicaCandidateFixture.mts';
import {encodeBackupValue} from '../apps/web/src/data/library/backupCodec';
import type {ReplicaCandidateRecord} from '../apps/web/src/data/library/replicaCandidateProtocol';
import {librarySyncBlockFetch} from '@sensa/contracts/sensa';

const count=Number(process.argv.find(argument=>argument.startsWith('--meanings='))?.split('=')[1]??1000);
assert(Number.isSafeInteger(count)&&count>0&&count<=10000,'Use --meanings=1..10000');
assert.equal(process.env.SENSA_TEST_MEMORY_LIBRARY,'true','Explicitly enable isolated Node fixture storage');
const base64Mode=process.argv.find(argument=>argument.startsWith('--base64='))?.split('=')[1]??'platform';
assert(base64Mode==='platform'||base64Mode==='legacy','Use --base64=platform|legacy');
if(base64Mode==='legacy'){
 Object.defineProperty(Uint8Array.prototype,'toBase64',{configurable:true,value:undefined});
 Object.defineProperty(Uint8Array,'fromBase64',{configurable:true,value:undefined});
}
const base64={mode:base64Mode,encode:typeof Reflect.get(Uint8Array.prototype,'toBase64')==='function',decode:typeof Reflect.get(Uint8Array,'fromBase64')==='function'};
const repository=new MemoryJourneyRepository();
await createJourneyModules({repository,clock:createSeededClock('2026-10-03T00:00:00Z')}).semanticIntake.submit(semanticLookupPayload());
const world=syntheticSemanticWorld(await repository.load(),count),id=crypto.randomUUID();
const identity={id,learnerId:crypto.randomUUID(),deviceId:id,createdAt:'2026-10-03T00:00:00.000Z',schemaVersion:2 as const};
const records:ReplicaCandidateRecord[]=[{table:'meta',key:'identity',valueJson:JSON.stringify(encodeBackupValue(identity)),blockRefs:[]}];
for(const row of semanticRecords(world))records.push({...row,valueJson:JSON.stringify(encodeBackupValue(row.value)),blockRefs:[]});
const logicalBytes=records.reduce((sum,row)=>sum+Buffer.byteLength(row.valueJson,'utf8'),0);
const fixture=candidateFixture(records,identity),blocks=new Map([...fixture.expected.manifestBlocks,...fixture.blocks].map(block=>[block.hash,block.data]));
records.length=0;

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://meaning-profile.fixture.invalid/')});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const [{useNodeLearningCapacityStorage},{openLibrary,writeLibraryState},{sqliteRecordAdapter},{synchronizeLibrary}]=await Promise.all([
 import('./support/nodeLearningCapacity.mts'),import('../apps/web/src/data/library/store'),import('../apps/web/src/data/library/sqliteAdapter'),import('../apps/web/src/data/library/cloudSync'),
]);
const database=await useNodeLearningCapacityStorage();
type Metric={calls:number;ms:number};
const phases:Record<string,Metric>={},projections:Record<string,Metric>={},reads:Record<string,Metric>={};
const sql=new Map<string,Metric>();let phase='outside';
const record=(metrics:Record<string,Metric>,key:string,elapsed:number)=>{const metric=metrics[key]??={calls:0,ms:0};metric.calls++;metric.ms+=elapsed;};
try{
 await openLibrary();await writeLibraryState(async tx=>tx.put('meta','service-owner',{subject:crypto.randomUUID(),accountId:crypto.randomUUID()}));
 const raw=Reflect.get(database,'database'),originalExec=raw.exec;
 raw.exec=function(...args:unknown[]){
  const text=typeof args[0]==='string'?args[0]:(args[0] as {sql?:string})?.sql??'',key=`${phase}: ${text.replace(/\s+/gu,' ').trim()}`;
  const started=performance.now();try{return Reflect.apply(originalExec,this,args);}finally{const metric=sql.get(key)??{calls:0,ms:0};metric.calls++;metric.ms+=performance.now()-started;sql.set(key,metric);}
 };
 for(const name of ['meaningLookup','worldBrowseProjection','practiceExpressionProjection','journeyIdentities']){
  const projection=Reflect.get(database,name),original=projection.update;
  projection.update=function(...args:unknown[]){const started=performance.now();try{return Reflect.apply(original,this,args);}finally{record(projections,name,performance.now()-started);}};
 }
 const originalGet=database.get;
 database.get=function(table,key){const started=performance.now();try{return originalGet.call(this,table,key);}finally{record(reads,`${phase}:${table}`,performance.now()-started);}};
 const adapter=await sqliteRecordAdapter(),originalCandidate=adapter.replicaCandidate.bind(adapter),originalCommit=adapter.commit.bind(adapter);
 adapter.replicaCandidate=async message=>{phase=message.kind;const started=performance.now();try{return await originalCandidate(message);}finally{record(phases,phase,performance.now()-started);phase='outside';}};
 adapter.commit=async mutation=>{phase=mutation.replicaCandidateRestore?'promotion':'other-commit';const started=performance.now();try{return await originalCommit(mutation);}finally{record(phases,phase,performance.now()-started);phase='outside';}};
 const started=performance.now();
 await synchronizeLibrary(async(path,body)=>{
  if(path==='/head')return fixture.expected.head;
  if(path==='/blocks/fetch'){
   const {hashes}=librarySyncBlockFetch.parse(body);
   return {blocks:hashes.filter(hash=>blocks.has(hash)).map(hash=>({hash,data:blocks.get(hash)!})),missing:hashes.filter(hash=>!blocks.has(hash)),deferred:[]};
  }
  throw Error(`unexpected_profile_request:${path}`);
 });
 const durationMs=performance.now()-started;
 assert.equal(database.count('semanticMeanings'),count);
 assert.equal(database.lookupMeanings('借用编号0').meanings.length,1);
 console.log(JSON.stringify({fixture:`${count} accepted synthetic Meanings, unique initial Registry; no media/history/corrections`,storage:'Node SQLite/Wasm memory, controlled in-process transport; NOT browser/OPFS/account UI',base64,logicalBytes,durationMs,phases,projections,reads,execTimings:[...sql].sort((a,b)=>b[1].ms-a[1].ms).slice(0,25).map(([sql,metric])=>({sql,...metric})),paidCalls:0},null,2));
}finally{database.close();}
