/** Provider-free SQLite/Wasm candidate-validation measurement, not a browser
 * restore or account-capacity guarantee. Fixture preparation is not timed. */
import assert from 'node:assert/strict';
import {MemoryJourneyRepository} from '../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../apps/web/src/experience/personalMeaningJourney/ports';
import {assertPersonalSemanticWorldRecords,type SemanticWorldRecordReader} from '../apps/web/src/experience/personalMeaningJourney/authority';
import {semanticLookupPayload,syntheticSemanticWorld} from '../tests/web/support/semanticLookupFixtures';
import {semanticRecords,sqliteLibraryCandidate,type SemanticCandidateRecord} from '../tests/web/support/semanticWorldRecordFixture.mts';
import {encodeBackupValue} from '../apps/web/src/data/library/backupCodec';

const bytes=(text:string)=>Buffer.byteLength(text,'utf8');
/** Logical value sizes only: no SQL keys/pages, compression, wire envelope or
 * media. String counters overlap JSON totals and must not be added to them. */
function profileStorage(records:Iterable<SemanticCandidateRecord>){
 const kinds=new Map<string,{records:number;jsonBytes:number;encodedBytes:number}>();
 const strings={fieldNameBytes:0,uuidValueBytes:0,otherStringValueBytes:0,dateValues:0,undefinedValues:0};
 const fields=new Map<string,{occurrences:number;valueBytes:number}>();
 const inspect=(value:unknown):void=>{
  if(value===undefined){strings.undefinedValues++;return;}
  if(value instanceof Date){strings.dateValues++;return;}
  if(typeof value==='string'){
   strings[/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)?'uuidValueBytes':'otherStringValueBytes']+=bytes(value);return;
  }
  if(Array.isArray(value)){for(const item of value)inspect(item);return;}
  if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
   strings.fieldNameBytes+=bytes(key);
   if(typeof item==='string'){
    const field=fields.get(key)??{occurrences:0,valueBytes:0};field.occurrences++;field.valueBytes+=bytes(item);fields.set(key,field);
   }
   inspect(item);
  }
 };
 for(const row of records){
  const kind=row.table==='semanticRegistry'?(row.value as {kind:string}).kind:row.table;
  const size=kinds.get(kind)??{records:0,jsonBytes:0,encodedBytes:0};
  size.records++;size.jsonBytes+=bytes(JSON.stringify(row.value));size.encodedBytes+=bytes(JSON.stringify(encodeBackupValue(row.value)));kinds.set(kind,size);inspect(row.value);
 }
 const byKind=Object.fromEntries(kinds),totals=[...kinds.values()].reduce((total,size)=>({records:total.records+size.records,jsonBytes:total.jsonBytes+size.jsonBytes,encodedBytes:total.encodedBytes+size.encodedBytes}),{records:0,jsonBytes:0,encodedBytes:0});
 return {...totals,codecOverheadBytes:totals.encodedBytes-totals.jsonBytes,byKind,stringCounters:strings,selectedStringFields:Object.fromEntries(['contractVersion','createdAt','updatedAt','bodyText','summary','coreMeaningFocus'].map(key=>[key,fields.get(key)??{occurrences:0,valueBytes:0}]))};
}

const repository=new MemoryJourneyRepository();
await createJourneyModules({repository,clock:createSeededClock('2026-10-03T00:00:00Z')}).semanticIntake.submit(semanticLookupPayload());
const seed=await repository.load(),results=[];
if(process.argv.includes('--storage-profile')){
 // This generator makes every Meaning's six Registry facts unique; it is not
 // an estimate of a user's average data, where Registry versions can be reused.
 const profile=profileStorage(semanticRecords(syntheticSemanticWorld(seed,10000)));
 assert.equal(profile.records,70001);assert.equal(profile.stringCounters.dateValues,0);assert.equal(profile.stringCounters.undefinedValues,0);
 console.log(JSON.stringify({fixture:'10000 accepted synthetic Meanings; unique Registry, one initial version; no media, Learning history or corrections',units:'UTF-8 bytes of logical record values; string counters are overlapping subsets, excluding JSON escaping/punctuation',...profile},null,2));
}else{
for(const meanings of [1000,10000]){
 const candidate=await sqliteLibraryCandidate(semanticRecords(syntheticSemanticWorld(seed,meanings)));
 try{
  // Let setup's complete synthetic World go before sampling the validator.
  (globalThis as typeof globalThis&{gc?:()=>void}).gc?.();
  const baseline=process.memoryUsage().heapUsed;let peak=baseline,reads=0;
  const sample=()=>{if(++reads%64===0)peak=Math.max(peak,process.memoryUsage().heapUsed);};
  const reader:SemanticWorldRecordReader={get:(table,key)=>{sample();return candidate.reader.get(table,key);},*entries(table){for(const row of candidate.reader.entries(table)){sample();yield row;}}};
  const started=performance.now();assertPersonalSemanticWorldRecords(reader);const validationMs=performance.now()-started;
  peak=Math.max(peak,process.memoryUsage().heapUsed);
  assert.equal(candidate.recordCount,meanings*7+1);assert.equal(candidate.metrics.iteratedRecords,candidate.recordCount);assert.equal(candidate.metrics.largestPage,64);
  results.push({meanings,records:candidate.recordCount,encodedMiB:Number((candidate.encodedBytes/1048576).toFixed(2)),validationMs:Number(validationMs.toFixed(1)),largestPage:candidate.metrics.largestPage,pointReads:candidate.metrics.pointReads,sampledHeapDeltaMiB:Number(((peak-baseline)/1048576).toFixed(2))});
 }finally{candidate.close();}
}
console.table(results);
console.log('PASS: complete PSW candidate rules cover every row at 1k/10k Meaning scale through 64-record pages and indexed references. SQLite/Wasm in Node; no OPFS, browser UI, network, Learning history, checkpoint application or 256 MiB-account claim. Sampled V8 heap excludes SQLite/Wasm memory and setup; not a whole-process peak guarantee.');
}
