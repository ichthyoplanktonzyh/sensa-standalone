/** Read-only batched inventory of already replay-validated synthetic fixtures.
 * Measures encoded values and repeated inline media, not DB physical pages. */
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {decodeBackupValue,encodeBackupValue} from '../../apps/web/src/data/library/backupCodec';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry} from '../../apps/web/src/data/library/replication/libraryReplica';
const argument=process.argv.find(x=>x.startsWith('--fixture='))?.slice(10);
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);
if(!argument||!output)throw Error('Use --fixture and --output');
const root=resolve(argument),destination=resolve(output);
if(!root.startsWith(resolve('.tmp')+'/retention-capacity-facts-')||!destination.startsWith(resolve('output/playwright')+'/'))throw Error('Isolated fixture/evidence paths required');
const manifestBytes=await readFile(join(root,'manifest.json')),manifest=JSON.parse(manifestBytes.toString('utf8'));
let identity:any;
for(const batch of manifest.batches.filter((b:any)=>b.table==='meta')){const bytes=await readFile(join(root,batch.file));if(createHash('sha256').update(bytes).digest('hex')!==batch.sha256)throw Error('Fixture digest mismatch');identity=(decodeBackupValue(JSON.parse(bytes.toString('utf8'))) as any[]).find(row=>row.key==='identity')?.value??identity;}
if(!identity)throw Error('Missing fixture identity');
const normalizedFacts:Record<string,string>={},normalizedPrivateBytes:Record<string,number>={},topFieldEncodedBytes:Record<string,Record<string,number>>={},nestedFieldEncodedBytes:Record<string,number>={};
const counts:Record<string,number>={},encodedValues:Record<string,number>={},purposes:Record<string,number>={},completedPurposes:Record<string,number>={};
const connections=new Set<string>(),senses=new Set<string>(),expressions=new Set<string>(),materials=new Set<string>(),media=new Set<string>();
let runMaterializationReferences=0,inlineMediaOccurrences=0,repeatedInlineMediaStringBytes=0,totalBatchBytes=0;
function inspect(value:any){if(typeof value==='string'&&/^data:(?:audio|image)\//u.test(value)){inlineMediaOccurrences++;repeatedInlineMediaStringBytes+=Buffer.byteLength(value);media.add(value);}else if(Array.isArray(value)){for(const item of value)inspect(item);}else if(value&&typeof value==='object'){for(const item of Object.values(value))inspect(item);}}
for(const batch of manifest.batches){
 if(!/^\w+-\d+\.json$/u.test(batch.file))throw Error('Invalid batch path');const bytes=await readFile(join(root,batch.file));totalBatchBytes+=bytes.length;
 if(createHash('sha256').update(bytes).digest('hex')!==batch.sha256)throw Error('Fixture digest mismatch');
 const wire=JSON.parse(bytes.toString('utf8')),rows=decodeBackupValue(wire) as {key:string;value:any}[];if(rows.length!==batch.rowCount)throw Error('Fixture count mismatch');
 counts[batch.table]=(counts[batch.table]??0)+rows.length;
 for(let i=0;i<rows.length;i++){
  const value=wire[1][i][1].find((field:any)=>field[0]==='value')[1];encodedValues[batch.table]=(encodedValues[batch.table]??0)+Buffer.byteLength(JSON.stringify(value));
  const row=rows[i]!.value;
  if(isReplicatedLibraryEntry(batch.table,rows[i]!.key)){
   const normalized=normalizeLibraryReplicaEntry({table:batch.table as any,key:rows[i]!.key,value:row},identity),text=JSON.stringify(encodeBackupValue(normalized.value));normalizedPrivateBytes[batch.table]=(normalizedPrivateBytes[batch.table]??0)+Buffer.byteLength(text);normalizedFacts[JSON.stringify([batch.table,rows[i]!.key])]=createHash('sha256').update(text).digest('hex');
   const fields=topFieldEncodedBytes[batch.table]??={};for(const [key,item] of Object.entries(normalized.value as any))fields[key]=(fields[key]??0)+Buffer.byteLength(JSON.stringify(encodeBackupValue(item)));
   if(['learningTargets','learningRuns'].includes(batch.table)){
    const walk=(value:any,path:string)=>{if(!value||typeof value!=='object'||value instanceof Date)return;for(const [key,item] of Object.entries(value)){const child=path+'.'+(/^[0-9a-f]{8}-/u.test(key)?'*':key);if(/materializations|presentation|materialSnapshot|content|audio|practice|source/u.test(child))nestedFieldEncodedBytes[child]=(nestedFieldEncodedBytes[child]??0)+Buffer.byteLength(JSON.stringify(encodeBackupValue(item)));if(child.split('.').length<7)walk(item,child);}};walk(normalized.value,batch.table);
   }
  }
  if(batch.table==='learningTargets'){const id=row.identity;connections.add(JSON.stringify([id.learnerUserId,id.senseId,id.expressionId,id.targetLanguageTag]));senses.add(id.senseId);expressions.add(id.expressionId);}
  if(batch.table==='learningRuns'){purposes[row.purpose]=(purposes[row.purpose]??0)+1;if(row.completedAt)completedPurposes[row.purpose]=(completedPurposes[row.purpose]??0)+1;for(const participant of Object.values(row.participants) as any[])for(const key of Object.keys(participant.materializations)){materials.add(key);runMaterializationReferences++;}}
  if(!['operations','meta'].includes(batch.table))inspect(row);
 }
}
if(totalBatchBytes!==manifest.bytes)throw Error('Manifest byte count mismatch');
const uniqueInlineMedia=Array.from(media).map(data=>{const comma=data.indexOf(','),bytes=Buffer.from(data.slice(comma+1),'base64');return {mime:data.slice(5,comma).replace(';base64',''),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
const report={format:'sensa-capacity-fixture-inventory-v1',fixture:root,manifestSha256:createHash('sha256').update(manifestBytes).digest('hex'),counts,encodedValueBytesByTable:encodedValues,normalizedPrivateBytes,expectedNormalizedFactHashRoot:createHash('sha256').update(JSON.stringify(Object.entries(normalizedFacts).sort())).digest('hex'),topFieldEncodedBytes,nestedFieldEncodedBytes,purposes,completedPurposes,uniqueSenseExpressionConnections:connections.size,senseIdentitiesInTargets:senses.size,expressionIdentitiesInTargets:expressions.size,uniqueRunMaterializationIds:materials.size,runMaterializationReferences,inlineMediaOccurrences,repeatedInlineMediaStringBytes,uniqueInlineMediaBytes:uniqueInlineMedia.reduce((n,row)=>n+row.bytes,0),uniqueInlineMedia,totalBatchBytes,scope:'Read-only verified batch digests/counts over a fixture already fully replay-validated by the generator; encoded-value sums exclude keys/pages/indices. Field/subtree totals overlap and exclude enclosing wire structure; never add nested totals or media occurrence bytes to the complete value total. Normalized fact root is the existing domain-normalization oracle. Not HTTP, OPFS, real AI/TTS, human activity or a replacement for full authority validation.'};
await writeFile(destination,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({targets:counts.learningTargets,reviewOutcomes:completedPurposes.retention_review,uniqueMediaBytes:report.uniqueInlineMediaBytes,inlineMediaOccurrences,repeatedInlineMediaStringBytes}));
