import {test,expect} from 'vitest';
import {contextDeltaFixture,contextReader,contextRowId} from '../support/contextDeltaFixture.mts';
import {validateContextDelta,admitContextDelta} from '../../../apps/web/src/data/library/contextDeltaAdmission';
import {validateLibrarySyncRecords} from '../../../apps/web/src/data/library/backupValidation';
import {observeReplicaWork} from '../../../apps/web/src/data/library/replicaWork';
import {DeltaReceiveFallback} from '../../../apps/web/src/data/library/learningDeltaAdmission';
const fixture=await contextDeltaFixture();
function input(after=fixture.after,changes=fixture.changes){return {base:contextReader(fixture.before),remote:contextReader(after),changes,alive(){},receipts:(id:string)=>fixture.before.filter(row=>row.table==='semanticReceipts'&&(row.value as any).result?.personalMeaningId===id).map(({table,key})=>({table,key}))};}
test('ordinary four-row Context edit agrees with complete sync admission and reads only its owned component',async()=>{
 expect(fixture.changes).toHaveLength(4);validateLibrarySyncRecords(contextReader(fixture.before));validateLibrarySyncRecords(contextReader(fixture.after));
 const work:Record<string,number>={};observeReplicaWork((kind,n)=>work[kind]=(work[kind]??0)+n);
 try{expect(validateContextDelta(input()).identity).toEqual(fixture.identity);const admitted=await admitContextDelta(input());expect(admitted.evidence).toMatchObject({mode:'incremental',changedRecords:4,baselineBuildRecords:0});expect(await admitted.prepare()).toEqual(fixture.changes);expect(work['context.componentKeys']).toBeGreaterThan(0);}finally{observeReplicaWork(undefined);}
});
for(const fault of ['parent','owner','erase-reference','rewrite-old-body','missing-receipt','missing-registry','wrong-new-key','extra-envelope'] as const)test(`Context component and complete oracle both reject ${fault}`,()=>{
 const rows=structuredClone(fixture.after),head=rows.find(row=>row.table==='semanticContexts'&&row.key.startsWith('anchors:'))!.value as any,newRevision=rows.find(row=>row.table==='semanticContexts'&&row.key===`anchorRevisions:${head.value.currentRevisionId}`)!,meaning=rows.find(row=>row.table==='semanticMeanings')!.value as any;
 if(fault==='parent')(newRevision.value as any).parentRevisionId=crypto.randomUUID();
 else if(fault==='owner')head.value.learnerUserId='foreign';
 else if(fault==='erase-reference')meaning.personalSemanticAnchorRevisions.shift();
 else if(fault==='rewrite-old-body')(rows.find(row=>row.table==='semanticContexts'&&row.key!==newRevision.key&&row.key.startsWith('anchorRevisions:'))!.value as any).value.personalSemanticAnchorId=crypto.randomUUID();
 else if(fault==='missing-receipt')rows.splice(rows.findIndex(row=>row.table==='semanticReceipts'&&fixture.changes.some(change=>contextRowId(change)===contextRowId(row))),1);
 else if(fault==='missing-registry')rows.splice(rows.findIndex(row=>row.table==='semanticRegistry'),1);
 else if(fault==='extra-envelope')(newRevision.value as any).unexpected=true;else newRevision.key='anchorRevisions:'+crypto.randomUUID();
 const complete=()=>validateLibrarySyncRecords(contextReader(rows));
 // Generic ReviseContext receipts are not globally required by the complete
 // oracle; missing one must safely leave the fast path rather than relax it.
 if(fault!=='missing-receipt')expect(complete).toThrow();
 expect(()=>validateContextDelta(input(rows))).toThrow();
});
test('extra/deleted changes and missing dependency proof leave Context admission',()=>{
 expect(()=>validateContextDelta({...input(),changes:[...fixture.changes,{table:'semanticRegistry',key:'unexpected'}]})).toThrow(DeltaReceiveFallback);
 expect(()=>validateContextDelta({...input(),changes:fixture.changes.map((row,i)=>({...row,...(i===0?{deleted:true}:{})}))})).toThrow(DeltaReceiveFallback);
 const broken=contextReader(fixture.before);broken.get=(table,key)=>{if(table==='semanticRegistry')throw Error('library_sync_dependency_corrupt');return contextReader(fixture.before).get(table,key);};
 expect(()=>validateContextDelta({...input(),base:broken})).toThrow('library_sync_dependency_corrupt');
});
test('a failed fence between Context component reads cannot return an admission or prepare receipt',async()=>{
 let reads=0;const value=input();await expect(admitContextDelta({...value,alive(){if(++reads>5)throw Error('library_sync_local_changed');}})).rejects.toThrow('library_sync_local_changed');
 const controller=new AbortController();const admitted=await admitContextDelta({...value,alive(){controller.signal.throwIfAborted();}});controller.abort(Error('cancelled component'));await expect(admitted.prepare()).rejects.toThrow('cancelled component');
});

test('unrelated baseline growth cannot expand the Context read set or enumerate history',()=>{
 const counts:number[]=[];for(const size of [0,4096]){
  const extra=Array.from({length:size},(_,i)=>({table:'settings' as const,key:'unrelated-'+i,value:'preserved'})),before=[...fixture.before,...extra],after=[...fixture.after,...extra],reads=new Set<string>();
  validateLibrarySyncRecords(contextReader(after));const base=contextReader(before,(table,key)=>reads.add(JSON.stringify([table,key]))),remote=contextReader(after,(table,key)=>reads.add(JSON.stringify([table,key])));base.entries=remote.entries=()=>{throw Error('forbidden whole-library enumeration');};
  expect(validateContextDelta({...input(),base,remote}).keys).toHaveLength(4);expect([...reads].some(key=>key.includes('unrelated'))).toBe(false);counts.push(reads.size);
 }expect(counts[0]).toBe(counts[1]);
});

for(const fault of ['stamp-source','stamp-carried-field','whitespace-blocks','same-context'] as const)test(`non-command ${fault} never receives a fast-path certificate`,()=>{
 const rows=structuredClone(fixture.after),meaning=rows.find(row=>row.table==='semanticMeanings')!.value as any,stamp=meaning.personalMeaningRevisions.at(-1),head=rows.find(row=>row.table==='semanticContexts'&&row.key.startsWith('anchors:'))!.value as any,revision=rows.find(row=>row.table==='semanticContexts'&&row.key===`anchorRevisions:${head.value.currentRevisionId}`)!.value as any;
 if(fault==='stamp-source')stamp.provenance.sourceReferenceIds=[crypto.randomUUID()];else if(fault==='stamp-carried-field')stamp.learnerIntentNote='not a Context-only edit';else if(fault==='whitespace-blocks')revision.value.structuredPayload.blocks[0].bodyText='  '+revision.value.bodyText+'  ';else{const prior=fixture.before.find(row=>row.table==='semanticContexts'&&row.key.startsWith('anchorRevisions:'))!.value as any;revision.value.bodyText=prior.value.bodyText;revision.value.structuredPayload.blocks=[{kind:'text',bodyText:prior.value.bodyText}];}
 expect(()=>validateContextDelta(input(rows))).toThrow();
});

test('a normal Context lineage beyond thirty keys remains bounded and fully admitted',async()=>{
 const f=await contextDeltaFixture(25),work:Record<string,number>={};observeReplicaWork((kind,n)=>work[kind]=(work[kind]??0)+n);try{
  validateLibrarySyncRecords(contextReader(f.after));expect(validateContextDelta({base:contextReader(f.before),remote:contextReader(f.after),changes:f.changes,alive(){},receipts:meaningId=>f.before.filter(row=>row.table==='semanticReceipts'&&(row.value as any).result?.personalMeaningId===meaningId)}).keys).toHaveLength(4);
  expect(work['context.componentKeys']).toBeGreaterThan(30);expect(work['context.componentKeys']).toBeLessThanOrEqual(64);
 }finally{observeReplicaWork(undefined);}
});
test('a receipt outside the command shape never renews a fast-path proof, while the complete oracle retains its own rules',()=>{
 const rows=structuredClone(fixture.after),receipt=rows.find(row=>row.table==='semanticReceipts'&&fixture.changes.some(key=>contextRowId(key)===contextRowId(row)))!.value as any;delete receipt.requestDigest;validateLibrarySyncRecords(contextReader(rows));expect(()=>validateContextDelta(input(rows))).toThrow(DeltaReceiveFallback);
});
