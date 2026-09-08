import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {ReviewQueue} from '../apps/web/src/experience/engine/ReviewQueue.ts';
import {reviewOutcomeKey} from '../apps/web/src/experience/engine/types.ts';
import {PROTOTYPE_RUNTIME_PACKAGES} from '../apps/web/src/experience/learningRuntime/prototypeRuntimeFixtures.ts';
const now=123456789, oldNow=Date.now;Date.now=()=>now;
const cases:any[]=[], expected:any[]=[], sources:any[]=[], coverage=new Set<string>();
function action(a:any){const v={...a};delete v.content;return v;}
function candidate(c:any,ps:any[]){return {candidateIndex:ps.findIndex(p=>p.retentionTargetId===c.package.retentionTargetId),candidatePhase:c.phase,candidateCycle:c.relearning??null};}
function view(q:any,ps:any[]){const s=q.getCurrentSession();return JSON.parse(JSON.stringify({session:s?{index:s.index,totalTarget:s.totalTarget,...candidate(s.candidate,ps),action:action(s.action),assessmentKind:s.assessmentKind,stepKind:s.stepKind,settled:s.settled,result:s.result}:null,projection:q.getProjection(),done:q.isDone(),stats:q.getStats()}));}
function effect(e:any,ps:any[]){const v={...e,...candidate(e.candidate,ps),action:action(e.action)};delete v.candidate;return JSON.parse(JSON.stringify(v));}
function invoke(q:any,e:any){switch(e.kind){case 'next':q.next();break;case 'settle':q.settle(e.result);break;case 'repair':q.completeRepair();break;case 'exclude':q.excludeCurrentForDeclaredMastery();break;case 'undo':q.undo();break;}}
function result(s:any,correct:boolean,n:number){return {assessmentId:`assessment-${n}`,kind:s.assessmentKind,focusDimension:'untrusted',correct,responseId:`response-${n}`,memoryOutcome:{grade:'easy'},evidenceEligible:true};}
for(const count of [0,1,3])for(const seed of [0,1,2,3,4,5,6])for(const minGap of [0,2]){
 const ps=PROTOTYPE_RUNTIME_PACKAGES.slice(0,count).map(p=>({...p,content:null}));
 const candidates=ps.map((p,i)=>({package:p,phase:seed>=5?'relearning':'retaining',dueAt:100+i,relearning:seed>=5?{cycleId:`persisted-${i}`,packageId:p.packageId,senseId:p.senseId,retentionTargetId:p.retentionTargetId,repairTarget:{kind:'capability',capability:seed===6?'boundary_discrimination':'meaning_to_form_recall'},failedReviewOutcomeKey:`prior-outcome-${i}`,failedReviewActionKey:'prior-action',stage:seed===5?'repair_pending':'retest_pending',repairCount:2,lastActionOrdinal:10}:null,diagnosticFacts:{preferredCapabilities:[['contextual_recognition','meaning_to_form_recall','novel_context_transfer'][i%3]]}}));
 let emitted:any[]=[];const deps={onEffect:(e:any)=>emitted.push(effect(e,ps))};let q=new ReviewQueue(candidates as any,deps,{minGap});
 const trace:any[]=[{ok:view(q,ps),effects:[]}],events:any[]=[];
 const apply=(e:any)=>{events.push(e);emitted=[];const before=view(q,ps);try{invoke(q,e);trace.push({ok:view(q,ps),effects:emitted});}catch(error){trace.push({error:(error as Error).message,state:view(q,ps)});}
  for(const e of emitted){coverage.add(e.type==='retention_outcome'?e.result.correct?'due_pass':'due_fail':e.event);if(e.type==='relearning_progress')assert.equal(q.getCurrentSession().result?.memoryOutcome??null,null);}
  if(e.kind==='repair'&&emitted.length){assert.equal(q.getStats().totalAttempts,before.stats.totalAttempts);}
  const v=view(q,ps);q=ReviewQueue.restoreCheckpoint(q.exportCheckpoint(),deps);assert.deepEqual(view(q,ps),v);
 };
 for(let n=0;n<35;n++){
  const s=q.getCurrentSession();if(!s){if(q.isDone())break;apply({kind:'next'});break;}
  if(seed===4&&n===0){apply({kind:'exclude'});apply({kind:'undo'});coverage.add('exclude_undo');}
  if(s.action.intent==='repair'){
   apply({kind:'settle',result:result(s,true,n)}); // must reject without mutation
   apply({kind:'repair'});
  }else{
   const correct=seed===0||n>10||(seed===1?n%3===2:seed===2?n%2===1:false);
   const r=result(s,correct,n);apply({kind:'settle',result:r});
   if(seed===3){apply({kind:'undo'});apply({kind:'settle',result:{...r,correct:!correct}});coverage.add('changed_answer_replay');}
   apply({kind:'settle',result:result(s,!correct,n+100)});
  }
  apply({kind:'next'});
 }
 const order=ps.map(p=>p.retentionTargetId).sort((a,b)=>a.localeCompare(b));
 cases.push({candidates:candidates.map(c=>({packageId:c.package.packageId,senseId:c.package.senseId,retentionTargetId:c.package.retentionTargetId,outcomeKey:reviewOutcomeKey(c as any,{} as any),inventory:{requiredCapabilities:c.package.requiredCapabilities,actions:c.package.actions,reviewActions:c.package.reviewActions,repairActions:c.package.repairActions??[]},phase:c.phase,relearning:c.relearning,diagnosticFacts:c.diagnosticFacts})),order,minGap,startTime:now,events});expected.push(trace);sources.push({snapshot:q.exportCheckpoint(),ps});
}
Date.now=oldNow;
const run=(input:any[])=>{const r=spawnSync('cargo',['run','--quiet','--locked','-p','sensa-core','--example','assurance_review_runner'],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:256*1024*1024});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
const actual=run(cases);let states=0;
for(let i=0;i<cases.length;i++){assert.deepEqual(actual[i].trace??actual[i],expected[i],`Review lifecycle trace ${i}`);states+=expected[i].length;}
const continued=run(actual.map(a=>({snapshot:a.snapshot,events:[{kind:'undo'},{kind:'next'}]})));
for(let i=0;i<cases.length;i++){let effects:any[]=[];const q=ReviewQueue.restoreCheckpoint(sources[i].snapshot,{onEffect:e=>effects.push(effect(e,sources[i].ps))});const tail=[{ok:view(q,sources[i].ps),effects:[]}];for(const e of [{kind:'undo'},{kind:'next'}]){effects=[];invoke(q,e);tail.push({ok:view(q,sources[i].ps),effects});}assert.deepEqual(continued[i].trace,tail,`Restore continuation ${i}`);}
for(const key of ['due_pass','due_fail','repair_completed','retest_failed','retest_passed','exclude_undo','changed_answer_replay'])assert.ok(coverage.has(key),`Missing ${key}`);
const bad=actual.slice(-8).map((a,i)=>{const s=JSON.parse(a.snapshot);if(i%2)s.version=99;else s.frame.attempts+=1;return {snapshot:JSON.stringify(s),events:[]};});for(const r of run(bad))assert.equal(typeof r.error,'string');
console.log(`Native assurance review lifecycle: ${cases.length} traces, ${states} exact TS/Rust states and effects; ${continued.length} cross-process restores; ${bad.length} invalid snapshots rejected`);
