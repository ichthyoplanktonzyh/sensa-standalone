/** Standalone specialized generator, not a third general-purpose test runner.
 * Generates genuine immutable history through LearningSystem commands. Its
 * output is a validated, guest-owned test snapshot, not invented projections. */
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const count=Number(process.argv.find(arg=>arg.startsWith('--targets='))?.slice('--targets='.length)??1000);
if(!Number.isSafeInteger(count)||count<1||count>10000)throw new Error('--targets must be an integer from 1 to 10000');
if(process.env.SENSA_TEST_MEMORY_LIBRARY!=='true')throw new Error('Isolated Node fixture storage must be explicitly enabled');
const NativeDate=Date;
let clock=Date.UTC(2026,9,5,8);
class CapacityDate extends NativeDate{
 constructor(...args:any[]){super(0);return Reflect.construct(NativeDate,args.length?args:[clock],new.target);}
 static now(){return clock;}
 static [Symbol.hasInstance](value:unknown){return value instanceof NativeDate;}
}
Object.assign(globalThis,{Date:CapacityDate,window:new EventTarget(),location:new URL('http://retention-capacity.fixture.invalid/'),BroadcastChannel:undefined});
const begin=performance.now();
const [{useNodeLearningCapacityStorage},{portableBookDeliveryFixture},{contentSupplySystem},{learningSystem},store,{sensaPinnedLanguageContext,defaultSensaLanguageRoute},{validateBackupRows},{encodeBackupValue}]=await Promise.all([
 import('./nodeLearningCapacity.mts'),import('./portablePackageFixture.mts'),import('../../apps/web/src/contentSupply/system/index.ts'),import('../../apps/web/src/learning/system/index.ts'),
 import('../../apps/web/src/data/library/store.ts'),import('@sensa/contracts/sensa'),import('../../apps/web/src/data/library/backupValidation.ts'),import('../../apps/web/src/data/library/backupCodec.ts'),
]);
const database=await useNodeLearningCapacityStorage();
try{
 await store.openLibrary();
 const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),id=()=>crypto.randomUUID();
 const book=portableBookDeliveryFixture({memberExpressions:Array.from({length:count},(_,index)=>index?'capacity-'+String(index).padStart(5,'0'):'borrow'),title:'成熟复习容量样本'});
 const fetchBefore=globalThis.fetch;
 try{
  globalThis.fetch=async input=>{const body=book.responses.get(String(input));if(!body)throw new Error('Capacity fixture attempted external network');return new Response(Uint8Array.from(body).buffer);};
  await contentSupplySystem.execute({kind:'install_catalog_item',descriptor:book.descriptor,signal:new AbortController().signal});
 }finally{globalThis.fetch=fetchBefore;}
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:100});
 await learningSystem.execute({kind:'enroll_book',operationId:id(),languageContext:context,publicationArchiveSha256:book.descriptor.sha256});
 let introduced=0;
 while(introduced<count){
  await learningSystem.execute({kind:'prepare_queue',languageContext:context});
  const home=await store.readHomeLearningRecords(context.languageRouteId,clock);
  const pending=home.targets.filter(target=>!target.startedAt&&!target.completedAt);
  if(!pending.length)throw new Error('Formal fixture generation has no eligible initial Targets');
  for(const target of pending){
   await learningSystem.execute({kind:'start',operationId:id(),targetId:target.id,languageContext:context,dailyLimit:100});
   let current=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
   await learningSystem.execute({kind:'act',operationId:id(),runId:current.runId,expectedRevision:current.revision,action:{kind:'reveal'}});
   current=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
   await learningSystem.execute({kind:'act',operationId:id(),runId:current.runId,expectedRevision:current.revision,action:{kind:'rate',rating:'good'}});
   await learningSystem.execute({kind:'finish',operationId:id(),runId:current.runId});
   introduced++;
  }
  console.info(JSON.stringify({stage:'formal_initial_completion',introduced,total:count,elapsedSeconds:Math.round((performance.now()-begin)/1000)}));
  clock+=86400_000;
 }
 let home=await store.readHomeLearningRecords(context.languageRouteId,clock);
 const maxDue=Math.max(...home.targets.map(target=>target.memory!.dueAt.getTime()));
 clock=Math.max(clock,maxDue+60_000);
 // Mature-history axis: each target also has a real due Review outcome. The
 // memory projection is written exclusively by the production scheduler.
 for(let index=0;index<home.targets.length;index++){
  const target=home.targets[index]!;
  await learningSystem.execute({kind:'start',operationId:id(),targetId:target.id,languageContext:context,dailyLimit:100,sessionIntent:'review_only'});
  let current=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
  await learningSystem.execute({kind:'act',operationId:id(),runId:current.runId,expectedRevision:current.revision,action:{kind:'reveal'}});
  current=(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!;
  await learningSystem.execute({kind:'act',operationId:id(),runId:current.runId,expectedRevision:current.revision,action:{kind:'rate',rating:'hard'}});
  await learningSystem.execute({kind:'finish',operationId:id(),runId:current.runId});
  if((index+1)%100===0)console.info(JSON.stringify({stage:'formal_review_outcome',reviewed:index+1,total:count,elapsedSeconds:Math.round((performance.now()-begin)/1000)}));
 }
 home=await store.readHomeLearningRecords(context.languageRouteId,clock);
 clock=Math.max(clock,Math.max(...home.targets.map(target=>target.memory!.dueAt.getTime()))+60_000);
 // The probe starts from an actual due Review, while all previous initial
 // completions, memory handoffs and history remain genuine command results.
 const targetId=home.targets[0]!.id;
 await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:100,sessionIntent:'review_only'});
 const rows=await store.readLibrary(async tx=>Object.fromEntries(await Promise.all(store.libraryTables.map(async table=>[table,await tx.entries(table)])))) as import('../../apps/web/src/data/library/backupValidation').BackupRows;
 rows.packageCache=[];
 validateBackupRows(rows);
 const {encodeBackupArchive,decodeBackupArchive}=await import('../../apps/web/src/data/library/backupArchive.ts');
 const archive=await encodeBackupArchive(rows,null),archiveRoundtrip=await decodeBackupArchive(archive.bytes);
 validateBackupRows(archiveRoundtrip.rows);
 const storedFactBytes=database.estimateRecordBytes(store.libraryTables.filter(table=>table!=='packageCache'));
 await mkdir(resolve('.tmp'),{recursive:true});
 const directory=await mkdtemp(resolve('.tmp/retention-capacity-facts-'));
 const batches:{table:string;file:string;rowCount:number;sha256:string}[]=[];
 let totalBytes=0;
 for(const table of store.libraryTables){
  for(let offset=0;offset<rows[table].length;offset+=64){
   const file=`${table}-${String(offset).padStart(6,'0')}.json`,chunk=rows[table].slice(offset,offset+64),bytes=Buffer.from(JSON.stringify(encodeBackupValue(chunk)));
   await writeFile(join(directory,file),bytes);totalBytes+=bytes.byteLength;
   batches.push({table,file,rowCount:chunk.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
 }
 const metadata={format:'sensa-retention-capacity-facts-v1',source:'LearningSystem commands over SQLite/Wasm, no model/TTS, no direct Target/Run/Event field seeds',clock:new Date(clock).toISOString(),targets:count,runs:rows.learningRuns.length,events:rows.learningEvents.length,bytes:totalBytes,storedFactBytes,sharedArchiveBytes:archive.bytes.length,sharedArchiveRoundtrip:'full authority validation; no encryption, destination restore, OPFS file size or UI latency claim',batches,bookDescriptor:book.descriptor,probeTargetId:targetId,probeRunId:(await learningSystem.read({kind:'runtime',languageContext:context})).runtime!.runId,setupSeconds:Math.round((performance.now()-begin)/1000)};
 await writeFile(join(directory,'manifest.json'),JSON.stringify(metadata,null,2));
 console.info(JSON.stringify({stage:'validated_snapshot',directory,targets:count,runs:metadata.runs,events:metadata.events,bytes:totalBytes,storedFactBytes,sharedArchiveBytes:archive.bytes.length,setupSeconds:metadata.setupSeconds}));
}finally{database.close();Object.assign(globalThis,{Date:NativeDate});}
