/** Specialized artifact validator, not a general-purpose test runner.
 * Never rewrites the fixture or synthesizes missing historical facts. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const argument=process.argv.find(value=>value.startsWith('--fixture='))?.slice('--fixture='.length);
if(!argument||process.env.SENSA_TEST_MEMORY_LIBRARY!=='true')throw new Error('Use --fixture with isolated Node storage enabled');
const directory=resolve(argument);
if(!directory.startsWith(resolve('.tmp')+'/retention-capacity-facts-'))throw new Error('Fixture must be an isolated capacity artifact');
const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')) as {format:string;clock:string;targets:number;runs:number;events:number;bytes:number;batches:{table:string;file:string;rowCount:number;sha256:string}[]};
if(manifest.format!=='sensa-retention-capacity-facts-v1'||!Number.isSafeInteger(manifest.targets)||manifest.targets<1||manifest.targets>10000||!Number.isFinite(Date.parse(manifest.clock)))throw new Error('Invalid capacity manifest');
const NativeDate=Date,clock=Date.parse(manifest.clock);
class FixtureDate extends NativeDate{
 constructor(...args:any[]){super(0);return Reflect.construct(NativeDate,args.length?args:[clock],new.target);}
 static now(){return clock;}
 static [Symbol.hasInstance](value:unknown){return value instanceof NativeDate;}
}
Object.assign(globalThis,{Date:FixtureDate,window:new EventTarget(),location:new URL('http://capacity-verifier.fixture.invalid/'),BroadcastChannel:undefined});
const start=performance.now();
try{
 const [{libraryTables},{decodeBackupValue},{validateBackupRows}]=await Promise.all([
  import('../../apps/web/src/data/library/store'),import('../../apps/web/src/data/library/backupCodec'),import('../../apps/web/src/data/library/backupValidation'),
 ]);
 const rows=Object.fromEntries(libraryTables.map(table=>[table,[]])) as unknown as import('../../apps/web/src/data/library/backupValidation').BackupRows;
 const files=new Set<string>();let bytesRead=0;
 for(const batch of manifest.batches){
  if(!libraryTables.includes(batch.table as typeof libraryTables[number])||!/^\w+-\d+\.json$/u.test(batch.file)||files.has(batch.file)||!Number.isSafeInteger(batch.rowCount)||batch.rowCount<1||batch.rowCount>64)throw new Error('Invalid capacity batch');
  files.add(batch.file);
  const bytes=await readFile(join(directory,batch.file));bytesRead+=bytes.length;
  if(createHash('sha256').update(bytes).digest('hex')!==batch.sha256)throw new Error(`Capacity digest mismatch: ${batch.file}`);
  const chunk=decodeBackupValue(JSON.parse(bytes.toString('utf8')));
  if(!Array.isArray(chunk)||chunk.length!==batch.rowCount||chunk.some(row=>typeof row?.key!=='string'))throw new Error(`Capacity batch shape mismatch: ${batch.file}`);
  rows[batch.table as typeof libraryTables[number]].push(...chunk);
 }
 if(bytesRead!==manifest.bytes||rows.learningTargets.length!==manifest.targets||rows.learningRuns.length!==manifest.runs||rows.learningEvents.length!==manifest.events)throw new Error('Capacity manifest counts differ from actual facts');
 console.info(JSON.stringify({stage:'digests_and_counts_verified',targets:rows.learningTargets.length,runs:rows.learningRuns.length,events:rows.learningEvents.length,bytesRead,studyScopes:rows.studyScopes.length,learningSessions:rows.learningSessions.length,elapsedMs:Math.round(performance.now()-start)}));
 validateBackupRows(rows);
 const report={stage:'current_authority_verified',directory,validatedAt:new NativeDate().toISOString(),clock:manifest.clock,counts:Object.fromEntries(libraryTables.map(table=>[table,rows[table].length])),bytesRead,durationMs:Math.round(performance.now()-start),scope:'Exact artifact digests, counts and full current backup/domain replay validation. No browser, fixture rewriting, fabricated outcomes, latency or paid-provider claim.'};
 const evidenceDirectory=resolve('.tmp/retention-capacity-validation');await mkdir(evidenceDirectory,{recursive:true});
 await writeFile(join(evidenceDirectory,`${basename(directory)}.json`),JSON.stringify(report,null,2));
 console.info(JSON.stringify(report));
}finally{Object.assign(globalThis,{Date:NativeDate});}
