import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {indexedDB} from 'fake-indexeddb';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {BackupRows} from '../apps/web/src/data/library/backupValidation.ts';
Object.assign(globalThis,{indexedDB,window:new EventTarget(),location:{origin:'http://127.0.0.1:9998'},BroadcastChannel:undefined});
const compiled=await build({stdin:{contents:['store','packages','learning','assurance','backupValidation'].map(n=>`export * from './apps/web/src/data/library/${n}';`).join('\n'),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'}});
const temp=await mkdtemp(join(tmpdir(),'sensa-assurance-'));await writeFile(join(temp,'core.mjs'),compiled.outputFiles[0]!.text);
const {openLibrary,command,readLibrary,libraryTables,installPackage,enrollPackage,confirmLearningQuantity,startLearning,actLearning,finishLearning,readLearning,assuranceView,validateBackupRows,setLocalDeclaredMastery}=await import(pathToFileURL(join(temp,'core.mjs')).href);
const id=()=>crypto.randomUUID(),owner=await openLibrary();await command({id:id(),kind:'fixture.owner',input:{}},async tx=>{const subject=id();tx.put('meta','service-owner',{subject,accountId:subject});});
const d=JSON.parse(await readFile('release-candidate/assurance-catalog.json','utf8')).items[0];const bytes=new Uint8Array(await readFile('release-candidate/learning-packages/'+d.url.split('/').at(-1)));
const broken=JSON.parse(new TextDecoder().decode(bytes));const media=Object.keys(broken.assurance.audio)[0];broken.assurance.audio[media]='data:audio/mpeg;base64,YQ==';await assert.rejects(installPackage(new TextEncoder().encode(JSON.stringify(broken))));
const pack=await installPackage(bytes,d);assert.equal((await readLearning()).targets.length,0);const ids=await enrollPackage(id(),pack.key);await enrollPackage(id(),pack.key);assert.equal((await readLearning()).targets.length,2);await confirmLearningQuantity(id(),20);
let operations=0;
for(const targetId of ids){
 let run=await startLearning(id(),targetId,20,'2026-09-11T00:00:00Z');const beforeDeclaration=structuredClone(run);await setLocalDeclaredMastery(id(),targetId,true);assert.equal((await readLearning()).active,undefined);assert.deepEqual((await readLearning()).runs.find(r=>r.id===run.id),beforeDeclaration);await assert.rejects(startLearning(id(),targetId,20,'2026-09-11T00:00:00Z'));await setLocalDeclaredMastery(id(),targetId,false);assert.equal((await startLearning(id(),targetId,20,'2026-09-11T00:00:00Z')).id,run.id);const capabilities=new Set();let supported=false,wrong=false,undone=false;
 while(!run.completedAt&&operations++<180){
  const view=assuranceView(run,pack)!;let response:any;
  if(!view.introduction&&!undone){undone=true;response={kind:'undo'};}
  else if(view.introduction)response={kind:run.assurance!.revealed?'continue':'reveal'};
  else if(run.assurance!.feedback)response={kind:'continue'};
  else if(view.resource!.kind==='meaning_to_form_recall'&&!supported&&run.assurance!.mode!=='choice'){response={kind:'try_recall',value:'wrong-answer'};}
  else{const r=view.resource!;capabilities.add(view.action.capability);const value=r.kind==='meaning_to_form_recall'?(run.assurance!.mode==='choice'?r.choiceOptions.find(o=>o.isTarget)!.id:r.primaryForm):r.kind==='novel_context_transfer'?r.scenario.options.find(o=>o.isCorrect)!.id:r.options.find(o=>o.isCorrect)!.id;response={kind:'answer',value};if(r.kind==='meaning_to_form_recall')supported=true;if(r.kind==='novel_context_transfer'&&!wrong){wrong=true;response={kind:'skip'};}}
  const op=id(),before=run;run=await actLearning(op,run.id,run.revision,{kind:'assurance',response},'2026-09-11T00:01:00Z');assert.deepEqual(await actLearning(op,before.id,before.revision,{kind:'assurance',response},'2026-09-11T00:01:00Z'),run);
  await assert.rejects(actLearning(id(),before.id,before.revision,{kind:'assurance',response},'2026-09-11T00:01:00Z'));
  const target=(await readLearning()).targets.find(t=>t.id===targetId)!;if(!run.completedAt)assert.equal(target.memory,null);
 }
 assert(run.completedAt,'acquisition should graduate');assert.equal(capabilities.size,4);await finishLearning(id(),run.id);
}
let state=await readLearning();assert(state.targets.every(t=>t.completedAt&&t.memoryRevision===1));
const target=state.targets[0];const due=new Date(target.memory!.dueAt.getTime()+1000).toISOString();let review=await startLearning(id(),target.id,20,due);let first=true;
while(!review.completedAt&&operations++<240){const view=assuranceView(review,pack)!;let response:any;if(view.introduction)response={kind:review.assurance!.revealed?'continue':'reveal'};else if(review.assurance!.feedback)response={kind:'continue'};else{const r=view.resource!;response={kind:'answer',value:r.kind==='meaning_to_form_recall'?(first?'incorrect':r.primaryForm):r.kind==='novel_context_transfer'?r.scenario.options.find(o=>o.isCorrect!==first)!.id:r.options.find(o=>o.isCorrect!==first)!.id};first=false;}review=await actLearning(id(),review.id,review.revision,{kind:'assurance',response},due);}
assert(review.completedAt,'review and targeted relearning complete');await finishLearning(id(),review.id);state=await readLearning();assert.equal(state.targets.find(t=>t.id===target.id)!.memoryRevision,2,'one memory outcome despite repair/retest');
const rows=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async t=>[t,await tx.entries(t)]))) as BackupRows);validateBackupRows(rows);const legacyRows=structuredClone(rows);for(const {value:r} of legacyRows.learningRuns)for(const key of ['policyProfileId','policyProfileVersion','protocolBinding','schedulingPolicy','lightweight'])delete r[key];for(const {value:t} of legacyRows.learningTargets)delete t.policyProfileId;validateBackupRows(legacyRows);const changed=structuredClone(rows);changed.learningTargets[0].value.memoryRevision++;assert.throws(()=>validateBackupRows(changed));
console.log('PASS: verified high-assurance package/audio, explicit enrollment, four gates, supported recall, transfer repair, stale/replayed actions, one graduation schedule, review/relearning single outcome and replay-validated backup. No paid/network calls. Steps: '+operations);

await rm(temp,{recursive:true,force:true});
