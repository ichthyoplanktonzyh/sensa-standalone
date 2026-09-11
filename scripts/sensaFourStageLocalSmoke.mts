/** Real installed resources + existing queues + transactional storage. No network or models. */
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {indexedDB,IDBFactory} from 'fake-indexeddb';
Object.assign(globalThis,{indexedDB,window:new EventTarget(),location:{origin:'http://127.0.0.1:9998'},BroadcastChannel:undefined});
const compiled=await build({stdin:{contents:['store','packages','learning','fourStage','backupValidation','backup'].map(n=>`export * from './apps/web/src/data/library/${n}';`).join('\n'),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'}});
const dir=await mkdtemp(join(tmpdir(),'sensa-four-stage-'));
try{
 await writeFile(join(dir,'core.mjs'),compiled.outputFiles[0]!.text);const api=await import(pathToFileURL(join(dir,'core.mjs')).href);
 const id=()=>crypto.randomUUID(),subject=id();await api.openLibrary();await api.command({id:id(),kind:'fixture.owner',input:{}},async(tx:any)=>{tx.put('meta','service-owner',{subject,accountId:subject});});
 const descriptor=JSON.parse(await readFile('release-candidate/assurance-catalog.json','utf8')).items[0];
 const pack=await api.installPackage(new Uint8Array(await readFile('release-candidate/learning-packages/'+descriptor.url.split('/').at(-1))),descriptor);
 const ids=await api.enrollPackage(id(),pack.key);for(const targetId of ids)await api.selectLocalLearningPolicy(id(),targetId,'interleaved_four_stage');
 await api.confirmLearningQuantity(id(),20);const at='2026-09-11T04:00:00.000Z';let run=await api.startLearning(id(),ids[0],20,at);
 assert.deepEqual(run.targetIds,ids);assert.equal(run.participants[ids[1]].memoryRevision,0);
 await assert.rejects(api.selectLocalLearningPolicy(id(),ids[0],'high_assurance'));
 const rows=()=>api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(t:string)=>[t,await tx.entries(t)]))));
 const verify=async()=>api.validateBackupRows(await rows());
 await verify();let steps=0,failed=false,previousTarget:string|undefined;const firstTargets:string[]=[];
 while(!run.completedAt&&steps++<60){
  const queue=api.fourStageQueue(run),session=queue.getCurrentSession();let response:any;
  if(session.phase==='feedback')response={kind:'continue'};
  else{
   if(firstTargets.length<2)firstTargets.push(session.targetId);
   if(session.presentation==='meaning_choice'||session.presentation==='sound_choice'){
    const target=(await api.readLearning()).targets.find((t:any)=>t.id===session.targetId),content=api.fourStageContent(target,pack);
    response={kind:'choice',optionId:content.recognitionAssessment.options.find((o:any)=>o.isCorrect).id};
   }else{const shouldFail=!failed&&session.presentation==='context_recall';response={kind:'self_report',known:!shouldFail};if(shouldFail){failed=true;previousTarget=session.targetId;}}
  }
  const before=structuredClone(run),op=id();
  if(steps===1){
   await assert.rejects(api.actLearning(id(),run.id,run.revision,{kind:'protocol',response:{kind:'choice',optionId:'unknown'}},at));
   const put=api.LibraryTransaction.prototype.put;api.LibraryTransaction.prototype.put=function(table:any,key:any,value:any){if(table==='learningEvents')throw Error('injected disk failure');return put.call(this,table,key,value);};
   await assert.rejects(api.actLearning(id(),run.id,run.revision,{kind:'protocol',response},at));api.LibraryTransaction.prototype.put=put;
   assert.deepEqual((await api.readLearning()).runs[0],before);
  }
  run=await api.actLearning(op,run.id,run.revision,{kind:'protocol',response},at);
  assert.deepEqual(await api.actLearning(op,before.id,before.revision,{kind:'protocol',response},at),run);
  await assert.rejects(api.actLearning(id(),run.id,before.revision,{kind:'protocol',response},at));
  if(previousTarget&&response.kind==='self_report'&&!response.known){
   const projection=api.fourStageQueue(run).getProjection();
   const reset=projection.targets.find((t:any)=>t.targetId===previousTarget),other=projection.targets.find((t:any)=>t.targetId!==previousTarget);
   assert.equal(reset.progress.progressEpoch,1);assert.equal(other.progress.progressEpoch,0);
  }
  await verify();assert.deepEqual((await api.startLearning(id(),ids[1],20,at)).protocolState,run.protocolState);
 }
 assert.deepEqual(firstTargets,ids,'targets must interleave');assert(run.completedAt);assert(failed);assert.equal(Object.keys(run.targetCompletions).length,2);
 let state=await api.readLearning();assert(state.targets.every((t:any)=>t.memoryRevision===1));await api.finishLearning(id(),run.id);
 const due=new Date(Math.max(...state.targets.map((t:any)=>t.memory.dueAt.getTime()))+1000).toISOString();run=await api.startLearning(id(),ids[0],20,due);assert.equal(run.targetIds.length,2);
 let forgot=false,relearned=false;
 while(!run.completedAt&&steps++<90){
  const session=api.fourStageQueue(run).getCurrentSession();let response:any;
  if(session.phase==='feedback')response={kind:'continue'};
  else{response={kind:'review',answer:!forgot?'forgotten':session.mode==='review'?'vague':'known'};if(session.mode==='relearning')relearned=true;forgot=true;}
  run=await api.actLearning(id(),run.id,run.revision,{kind:'protocol',response},due);await verify();
 }
 assert(run.completedAt);assert(relearned);state=await api.readLearning();assert(state.targets.every((t:any)=>t.memoryRevision===2&&!t.relearnAt),'one outcome per due target despite relearning');
 await api.finishLearning(id(),run.id);await verify();
 const corrupted=await rows();corrupted.learningRuns[0].value.protocolState.checkpoint='{}';assert.throws(()=>api.validateBackupRows(corrupted));

 const password='four-stage-backup-fixture';const exported=await api.exportLibraryBackup(password);const source=await api.readLearning();
 assert.equal((await api.inspectLibraryBackup(exported.file,password)).runs,2);
 Object.assign(globalThis,{indexedDB:new IDBFactory()});
 let restored=await import(pathToFileURL(join(dir,'core.mjs')).href+'?fresh');await restored.openLibrary();
 await restored.command({id:id(),kind:'service.fixture',input:{subject}},async(tx:any)=>tx.put('meta','service-owner',{subject,accountId:subject}));
 await restored.restoreLibraryBackup(exported.file,password);
 restored=await import(pathToFileURL(join(dir,'core.mjs')).href+'?reopened');await restored.openLibrary();assert.deepEqual(await restored.readLearning(),source);
 console.log('PASS: original four-stage cohort, isolated failure reset, raw-answer grading, per-step checkpoint/replay, rollback, stale/idempotent actions, immutable assignment, per-target graduation, review/relearning with one FSRS outcome. No network/model calls.');
}finally{await rm(dir,{recursive:true,force:true});}
