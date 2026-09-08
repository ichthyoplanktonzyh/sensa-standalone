import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { LearnQueue } from '../apps/web/src/experience/engine/LearnQueue.ts';
import { PROTOTYPE_RUNTIME_PACKAGES } from '../apps/web/src/experience/learningRuntime/prototypeRuntimeFixtures.ts';
const cases: any[] = [], expected: any[] = [];
const coverage=new Set<string>();
const now=123456789;
const originalNow=Date.now;
Date.now=()=>now;
function view(q:LearnQueue<any>,packages:any[]){
 const session=q.getCurrentSession();
 const clean=session?JSON.parse(JSON.stringify(session)):null;
 if(clean){delete clean.package;delete clean.action.content;}
 return JSON.parse(JSON.stringify({projection:q.getProjection(),session:clean,states:packages.map(p=>q.getState(p.retentionTargetId)),done:q.isDone(),graduated:q.getGraduatedRetentionTargetIds(),stats:q.getStats()}));
}
function invoke(q:LearnQueue<any>,e:any){switch(e.kind){
 case 'next':q.next();break;case 'introduction':q.completeIntroduction();break;
 case 'recognition':q.completeRecognition(e.correct);break;case 'recall':q.completeMeaningToFormRecall(e.outcome);break;
 case 'transfer':q.completeNovelTransfer(e.outcome);break;case 'boundary':q.completeBoundary(e.correct);break;
 case 'settle':q.settle(e.correct);break;case 'mistake':q.markMistake();break;case 'mastery':q.setDeclaredMastery(e.target,e.mastered);break;case 'skip':q.skipCurrent();break;case 'undo':q.undo();break;
}}
for(const count of [0,1,3])for(const seed of [0,1,2,3])for(const minGap of [0,2]){
 const packages=PROTOTYPE_RUNTIME_PACKAGES.slice(0,count).map(p=>({...p,content:null}));
 let q=new LearnQueue(packages,{minGap});const events:any[]=[];const trace:any[]=[{ok:view(q,packages)}];
 const apply=(event:any)=>{const prior=view(q,packages);events.push(event);try{invoke(q,event);
  const after=view(q,packages);
  if(prior.session&&!prior.session.settled&&prior.session.action.intent==='repair'&&after.session?.settled){coverage.add('repair');assert.equal(after.stats.totalAttempts,prior.stats.totalAttempts);assert.equal(after.stats.correctAttempts,prior.stats.correctAttempts);}
  if(event.kind==='recall'&&['first_letter','choice'].includes(event.outcome)&&prior.session&&!prior.session.settled&&prior.session.action.intent==='assessment'&&prior.session.action.capability==='meaning_to_form_recall'){coverage.add(event.outcome);assert.equal(after.session.result,false);assert.equal(after.stats.correctAttempts,prior.stats.correctAttempts);}
  if(event.kind==='skip'){coverage.add('mastery');assert.deepEqual(after.graduated,prior.graduated);assert.deepEqual(after.states.map((s:any)=>s.protocolProgress),prior.states.map((s:any)=>s.protocolProgress));}
trace.push({ok:view(q,packages)});}catch(e){trace.push({error:(e as Error).message,state:view(q,packages)});}const before=view(q,packages);q=LearnQueue.restoreCheckpoint(q.exportCheckpoint());assert.deepEqual(view(q,packages),before);};
 for(let n=0;n<65;n++){
  const s=q.getCurrentSession();
  if(n===2&&seed===1) {apply({kind:'skip'});apply({kind:'next'});continue;}
  if(n===4&&seed===1&&packages[0])apply({kind:'mastery',target:packages[0].retentionTargetId,mastered:false});
  if(!s){if(q.isDone())break;apply({kind:'next'});continue;}
  if(s.action.kind==='introduction'&&s.action.intent==='instruction')apply({kind:'introduction'});
  else switch(s.action.capability){
   case 'contextual_recognition':apply({kind:'recognition',correct:seed===0||n%5!==1});break;
   case 'meaning_to_form_recall':apply({kind:'recall',outcome:seed===0?'independent':['independent','first_letter','choice','miss'][n%4]});break;
   case 'novel_context_transfer':apply({kind:'transfer',outcome:seed===0||n%4!==1?'success':'repair'});break;
   case 'boundary_discrimination':apply({kind:'boundary',correct:seed===0||n%3!==1});break;
  }
  if(seed===2&&n%9===4){apply({kind:'mistake'});apply({kind:'undo'});}
  if(seed===3&&n%7===2){apply({kind:'undo'});apply({kind:'settle',correct:true});}
  // A repeated settled action cannot count twice. Wrong-capability calls are inert.
  if(n%11===1){apply({kind:'settle',correct:false});apply({kind:'boundary',correct:true});}
  apply({kind:'next'});
 }
 if(seed===0){assert.equal(q.isDone(),true,'Independent success must finish the cohort');assert.equal(q.getGraduatedRetentionTargetIds().length,count);}
 apply({kind:'undo'});
 const order=packages.map(p=>p.retentionTargetId).sort((a,b)=>a.localeCompare(b));
 cases.push({packages:packages.map(p=>({packageId:p.packageId,senseId:p.senseId,retentionTargetId:p.retentionTargetId,runId:`prototype:${p.retentionTargetId}:structured-acquisition:v1`,inventory:{requiredCapabilities:p.requiredCapabilities,actions:p.actions,reviewActions:p.reviewActions,repairActions:p.repairActions??[]}})),minGap,startTime:now,order,events});expected.push(trace);
}
Date.now=originalNow;
for(const key of ['repair','first_letter','choice','mastery'])assert.ok(coverage.has(key),`Missing lifecycle coverage: ${key}`);
const run=(input:any[])=>{const r=spawnSync('cargo',['run','--quiet','--locked','-p','sensa-core','--example','assurance_queue_runner'],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:256*1024*1024});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
const actual=run(cases);let states=0;
for(let i=0;i<cases.length;i++){assert.deepEqual(actual[i].trace??actual[i],expected[i],`Assurance lifecycle trace ${i}`);states+=expected[i].length;}
const restored=run(actual.map((a:any)=>({snapshot:a.snapshot,events:[{kind:'next'},{kind:'undo'}]})));
// Independently continued source states validate that undo history was restored too.
for(let i=0;i<cases.length;i++){
 Date.now=()=>now;
 const ps=PROTOTYPE_RUNTIME_PACKAGES.slice(0,cases[i].packages.length).map(p=>({...p,content:null}));
 const q=new LearnQueue(ps,{minGap:cases[i].minGap});for(const e of cases[i].events)invoke(q,e);
 const tail=[{ok:view(q,ps)}];q.next();tail.push({ok:view(q,ps)});q.undo();tail.push({ok:view(q,ps)});
 assert.deepEqual(restored[i].trace,tail,`Cross-process continuation ${i}`);
}
Date.now=originalNow;
const bad=actual.slice(0,8).map((a:any,i:number)=>{const s=JSON.parse(a.snapshot);if(i%2)s.formatVersion=99;else s.frame.totalAttempts+=1;return {snapshot:JSON.stringify(s),events:[]};});
for(const result of run(bad))assert.equal(typeof result.error,'string');
console.log(`Native assurance acquisition lifecycle: ${cases.length} traces, ${states} exact TS/Rust states; ${restored.length} cross-process next/undo continuations; ${bad.length} invalid snapshots rejected`);
