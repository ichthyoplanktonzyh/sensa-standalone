/** Offline index representation experiment over captured exact refs. No DB,
 * network or production protocol writes. Not domain/restore integration proof. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {encodeLibrarySyncBlock,decodeLibrarySyncBlock,splitLibrarySyncText} from '../../packages/contracts/src/sensa/librarySyncBlocks';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
type Refs=Record<string,string[]>;
type Edit={key:string;refs:string[]|null};
const canonical=(refs:Refs)=>JSON.stringify(Object.entries(refs).sort(([a],[b])=>a.localeCompare(b)));
const clone=(refs:Refs):Refs=>JSON.parse(JSON.stringify(refs));
const blocks=(value:unknown)=>splitLibrarySyncText(JSON.stringify(value)).map(part=>{const data=encodeLibrarySyncBlock(part);assert.equal(decodeLibrarySyncBlock(data),part);return {hash:hash(data),data,bytes:Buffer.byteLength(data)};});
const patch=(before:Refs,after:Refs):Edit[]=>[...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key])).map(key=>({key,refs:after[key]??null}));
const apply=(before:Refs,edits:Edit[])=>{const next=clone(before);for(const {key,refs} of edits){if(refs===null)delete next[key];else{assert(refs.length>0&&refs.every(h=>/^[a-f0-9]{64}$/u.test(h)));next[key]=[...refs];}}return next;};
class IndexModel{
 revision=0;seq=0;generation=0;tailBytes=0;
 current:Refs;snapshot:Refs;tail:{seq:number;prev:string;edits:Edit[];digest:string;data:string}[]=[];
 root:string;receipts=new Map<string,{digest:string;root:string;revision:number}>();
 stored=new Map<string,string>();retainedRoots=new Map<string,Set<string>>();
 snapshotHashes:string[]=[];compactions=0;compactionMetrics:{generation:number;rows:number;encodedBytes:number}[]=[];
 constructor(refs:Refs){this.current=clone(refs);this.snapshot=clone(refs);this.snapshotHashes=this.store(blocks({format:'capacity-index-snapshot-v1',generation:0,rows:Object.entries(refs).sort(([a],[b])=>a.localeCompare(b))}));this.root=this.rootHash();this.pin();}
 store(input:ReturnType<typeof blocks>){for(const b of input)this.stored.set(b.hash,b.data);return input.map(b=>b.hash);}
 rootHash(){return hash(JSON.stringify({format:'capacity-index-root-v1',generation:this.generation,snapshot:this.snapshotHashes,tail:this.tail.map(t=>t.digest),seq:this.seq,revision:this.revision}));}
 pin(){this.retainedRoots.set(this.root,new Set([...this.snapshotHashes,...this.tail.map(t=>t.digest),...Object.values(this.current).flat()]));}
 commit(operationId:string,base:number,edits:Edit[]){
  const request=JSON.stringify({base,edits}),digest=hash(request),receipt=this.receipts.get(operationId);
  if(receipt){assert.equal(receipt.digest,digest,'same operationId changed request');return {...receipt,retry:true,bytes:0,compacted:false};}
  assert.equal(base,this.revision,'CAS conflict');
  for(const edit of edits){const table=JSON.parse(edit.key)[0];if(['learningEvents','studyScopes','learningReconciliations'].includes(table)&&this.current[edit.key])assert.deepEqual(edit.refs,this.current[edit.key],'immutable fact refs changed');}
  const body={format:'capacity-index-log-v1',seq:this.seq+1,prev:this.root,edits},packed=blocks(body);assert.equal(packed.length,1,'bounded single-log envelope exceeded');
  const b=packed[0]!;this.store(packed);this.tail.push({seq:body.seq,prev:body.prev,edits,digest:b.hash,data:b.data});this.tailBytes+=b.bytes;this.current=apply(this.current,edits);this.seq++;this.revision++;
  let compacted=false,bytes=b.bytes;
  if(this.tail.length>=32||this.tailBytes>=1048576){this.generation++;this.snapshot=clone(this.current);const packed=blocks({format:'capacity-index-snapshot-v1',generation:this.generation,rows:Object.entries(this.snapshot).sort(([a],[b])=>a.localeCompare(b))});this.snapshotHashes=this.store(packed);const snapshotBytes=packed.reduce((n,b)=>n+b.bytes,0);bytes+=snapshotBytes;this.compactionMetrics.push({generation:this.generation,rows:Object.keys(this.snapshot).length,encodedBytes:snapshotBytes});this.tail=[];this.tailBytes=0;this.compactions++;compacted=true;}
  this.root=this.rootHash();this.pin();const result={digest,root:this.root,revision:this.revision};this.receipts.set(operationId,result);return {...result,bytes,compacted,retry:false};
 }
 restore(){const snapshotText=this.snapshotHashes.map(h=>{const data=this.stored.get(h);assert(data!==undefined,'snapshot missing');assert.equal(hash(data),h,'snapshot corrupt');return decodeLibrarySyncBlock(data);}).join('');const parsed=JSON.parse(snapshotText);assert.equal(parsed.format,'capacity-index-snapshot-v1');assert.equal(parsed.generation,this.generation);assert.equal(new Set(parsed.rows.map((r:any)=>r[0])).size,parsed.rows.length);let next:Refs=Object.fromEntries(parsed.rows);assert.equal(canonical(next),canonical(this.snapshot));let seq=this.seq-this.tail.length;for(const t of this.tail){assert.equal(t.seq,++seq);assert.equal(hash(t.data),t.digest,'corrupt log');const decoded=JSON.parse(decodeLibrarySyncBlock(t.data));assert.equal(decoded.seq,t.seq);assert.equal(decoded.prev,t.prev);assert.deepEqual(decoded.edits,t.edits);next=apply(next,t.edits);}assert.equal(canonical(next),canonical(this.current));return next;}
}
const directory='output/playwright/long-term-capacity-2250269b-20261012';await mkdir(directory,{recursive:true});
const oldPath='output/playwright/sync-scale-diagnostic-2250269b-20261012/final-v1/measurements.json';
const bytes=await readFile(oldPath),source=JSON.parse(bytes.toString('utf8'));
const extra=process.argv.find(arg=>arg.startsWith('--extra='))?.slice(8);if(extra){const newer=JSON.parse(await readFile(extra,'utf8'));for(const row of newer.cases){if(row.status==='completed')source.results.push({scenario:{name:row.name},phases:row.phases});}}
function normalize(refs:Refs){return Object.fromEntries(Object.entries(refs).map(([key,value])=>[key.startsWith('[')?key:JSON.stringify([key.slice(0,key.indexOf(':')),key.slice(key.indexOf(':')+1)]),value]));}
const results:any[]=[];
for(const row of source.results){
 const initial=normalize(row.phases[0].after.recordRefs),model=new IndexModel(initial),phases:any[]=[];
 for(const [i,phase]of row.phases.slice(1).entries()){
  const after=normalize(phase.after.recordRefs),edits=patch(model.current,after),rootBefore=model.root,base=model.revision;
  const start=performance.now(),committed=edits.length?model.commit(`${row.scenario.name}-${i}`,base,edits):{bytes:0,compacted:false},commitMs=performance.now()-start;
  const restoreStart=performance.now();assert.equal(canonical(model.restore()),canonical(after));const restoreMs=performance.now()-restoreStart;
  if(edits.length){const retry=model.commit(`${row.scenario.name}-${i}`,base,edits);assert.equal(retry.bytes,0);assert.equal(retry.root,model.root);assert.equal(retry.revision,model.revision);assert(model.retainedRoots.has(rootBefore));assert.throws(()=>model.commit('cas-rejected-'+i,base,edits));}
  const pins=model.retainedRoots.get(model.root)!;for(const refs of Object.values(after))for(const h of refs)assert(pins.has(h));
  phases.push({name:phase.name,changedKeys:edits.length,modelEncodedIndexPublicationBytes:committed.bytes,actualManifestUploadedBytes:phase.manifestUploadedBytes??phase.manifestUploadedStoredBytes,commitMs,restoreMapMs:restoreMs,tailEntries:model.tail.length,tailBytes:model.tailBytes,compacted:committed.compacted,exactTupleOracle:true,oldRootRetained:true});
 }
 // Adversarial index-only operations. They are not asserted legal domain edits.
 const key=JSON.stringify(['drafts','capacity-isolated-key']),original=clone(model.current),fake=(n:number)=>[hash('capacity-index-'+n)];
 for(let i=0;i<70;i++){const edit:Edit={key,refs:i%7===0?null:fake(i)};model.commit(`adversarial-${i}`,model.revision,[edit]);model.restore();}
 const beforeFailure=canonical(model.current),snapshotHash=model.snapshotHashes[0]!,snapshotData=model.stored.get(snapshotHash)!;model.stored.delete(snapshotHash);assert.throws(()=>model.restore());assert.equal(canonical(model.current),beforeFailure);model.stored.set(snapshotHash,snapshotData);if(model.tail.length){const t=model.tail[0]!,saved=t.data;t.data+='corrupt';assert.throws(()=>model.restore());assert.equal(canonical(model.current),beforeFailure);t.data=saved;}
 const historic=Object.keys(original).find(k=>JSON.parse(k)[0]==='learningEvents');if(historic)assert.throws(()=>model.commit('immutable-rejection',model.revision,[{key:historic,refs:fake(999)}]));
 const chosen=JSON.stringify(['drafts','explicit-conflict']),base=model.revision,left=[{key:chosen,refs:fake(1000)}],right=[{key:chosen,refs:fake(1001)}];model.commit('left',base,left);assert.throws(()=>model.commit('right',base,right));const conflictBranches={left:left[0]!.refs,right:right[0]!.refs};assert.notDeepEqual(conflictBranches.left,conflictBranches.right);
 results.push({scenario:row.scenario.name,initialRows:Object.keys(initial).length,initialSnapshotBytes:[...model.stored.entries()].filter(([h])=>model.retainedRoots.values().next().value?.has(h)).reduce((n,[,data])=>n+Buffer.byteLength(data),0),phases,adversarialOperations:70,compactions:model.compactions,compactionMetrics:model.compactionMetrics,indexStoredBytesRetainedWithoutGc:[...model.stored.values()].reduce((n,data)=>n+Buffer.byteLength(data),0),assertions:['exact ordered row/ref tuple oracle','tombstone replay; duplicate edits not constructed','in-memory same-operation receipt replay; no network ACK','CAS competing branch rejected','model partial protected Event/Scope/Reconciliation refs unchanged','current and retained-root pin-set accounting; no payload GC','serialized snapshot blocks hash/decode/exact map; missing snapshot/corrupt log reject without map mutation','stale CAS rejection; local conflict branch arrays retained, no durable conflict choice'],unverified:['server operation digest persistence/transaction','domain replay from actual snapshot-tail wire','missing tail/retention-floor bootstrap','read lease expiry/GC/concurrent compaction','durable migration interruption and browser crash','log previous-root chain cryptographic verification independent of in-memory expected tail','tree alternative implementation']});
}
const report={scriptSha256:hash((await readFile(new URL(import.meta.url))).toString('utf8')),format:'sensa-offline-index-experiment-v1',startedAt:new Date().toISOString(),sourcePath:oldPath,sourceSha256:hash(bytes.toString('utf8')),sourceCommit:source.commit,extra,model:'new hypothetical root/snapshot/log representation, 32 changes or 1MiB tail compaction; immutable existing fact block refs retained; no production schema or wire changes',conditions:'Node offline encoding and in-memory map reconstruction; synthetic index adversarial edits; exact original maps from actual captured Hono/Postgres runs. Comparison isolates index stored codec bytes, excludes root/request/hash checks/API validation/network/header overhead. Delta diff computed from full oracle maps here, NOT evidence for O(delta) extraction in production. Commit timings include clone of current map in experiment, NOT optimized indexed persistence.',results};
await writeFile(join(directory,'index-log-'+(process.argv.find(x=>x.startsWith('--label='))?.slice(8)??'experiment-final')+'.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({scenarios:results.length,phases:results.reduce((n,r)=>n+r.phases.length,0),assertions:'passed',conditions:report.conditions}));
