/** Deterministic G1 branch vectors; no production database or provider calls. */
import assert from 'node:assert/strict';
import {reconcileLearning,type LearningBranch} from './models/learningReconciliation.js';
const libraryId='test-library',target={learnerId:'learner',senseId:'sense',bindingId:'binding',scope:'primary'};
const base=(id:string,parents:string[]=[])=>({id,libraryId,operationId:`op-${id}`,deviceId:'web',parents,target,occurredAt:'2026-09-10T00:00:00Z',policyVersion:'lightweight-v1',evaluatorVersion:'self-rating-v1'});
const initial:LearningBranch={...base('initial'),kind:'initial',basis:null,runId:'initial-run'};
const initial2:LearningBranch={...base('initial2'),kind:'initial',basis:null,runId:'initial2-run',policyVersion:'different-policy'};
const left:LearningBranch={...base('left',[initial.id]),kind:'review',runId:'left-run',basis:initial.id,grade:'again',schedulerEligible:true};
const right:LearningBranch={...base('right',[initial.id]),kind:'review',runId:'right-run',basis:initial.id,grade:'easy',schedulerEligible:true,evaluatorVersion:'different-grader'};
const decision:LearningBranch={...base('decision',[left.id,right.id]),kind:'reconciliation',basis:initial.id,candidates:[left.id,right.id],selected:right.id};
const next:LearningBranch={...base('next',[decision.id]),kind:'review',runId:'next-run',basis:decision.id,grade:'good',schedulerEligible:true};
const inspect=(...facts:LearningBranch[])=>reconcileLearning(libraryId,facts);
const opportunity=(result:ReturnType<typeof inspect>,id:string)=>result.opportunities.find(o=>o.records.includes(id))!;
assert.equal(opportunity(inspect(initial,left),left.id).selected,left.id);
assert.equal(opportunity(inspect(initial,left,right),left.id).status,'requires_reconciliation');
assert.equal(opportunity(inspect(initial,left,right),left.id).contribution,null);
const settled=inspect(initial,left,right,decision,next);
assert.equal(opportunity(settled,left.id).selected,right.id);
assert.equal(opportunity(settled,left.id).contribution,decision.id);
assert.equal(opportunity(settled,next.id).selected,next.id);
// All orderings and duplicate deliveries converge, including reverse causal delivery.
function* permutations<T>(xs:T[]):Generator<T[]>{if(!xs.length){yield [];return;}for(let i=0;i<xs.length;i++)for(const tail of permutations(xs.filter((_,j)=>i!==j)))yield [xs[i]!,...tail];}
let orders=0;
for(const order of permutations([initial,left,right,decision,next])){assert.deepEqual(inspect(...order,...order),settled);orders++;}
const late:LearningBranch={...right,...base('late',[initial.id]),kind:'review',runId:'late-run'};
const reopened=inspect(initial,left,right,decision,next,late);
assert.equal(opportunity(reopened,left.id).status,'requires_reconciliation');
assert.equal(opportunity(reopened,next.id).status,'blocked_by_basis');
const conflicting:LearningBranch={...decision,...base('conflicting',[left.id,right.id]),selected:left.id};
assert.equal(opportunity(inspect(initial,left,right,decision,conflicting),left.id).status,'requires_reconciliation');
const resolved:LearningBranch={...decision,...base('resolved',[decision.id,conflicting.id])};
assert.equal(opportunity(inspect(initial,left,right,decision,conflicting,resolved),left.id).contribution,resolved.id);
// A historical correction does not overwrite its original grade or produce another event.
const correction:LearningBranch={...base('correction',[left.id]),kind:'correction',replaces:left.id,grade:'good'};
const corrected=inspect(initial,left,correction);
assert.deepEqual(opportunity(corrected,left.id).records,['correction','left']);
assert.equal(opportunity(corrected,left.id).selected,correction.id);
const secondCorrection:LearningBranch={...correction,...base('second-correction',[left.id]),grade:'easy'};
assert.equal(opportunity(inspect(initial,left,correction,secondCorrection),left.id).status,'requires_reconciliation');
assert.equal(opportunity(inspect(initial,left,right,decision,correction,next),next.id).status,'blocked_by_basis');
// Concurrent initial completion is a single identity, regardless of policy or material version.
const competing=inspect(initial,initial2,left);
assert.equal(opportunity(competing,initial.id).status,'requires_reconciliation');
assert.equal(opportunity(competing,left.id).status,'blocked_by_basis');
const initialDecision:LearningBranch={...base('initial-decision',[initial.id,initial2.id]),kind:'reconciliation',basis:null,candidates:[initial.id,initial2.id],selected:initial.id};
assert.equal(opportunity(inspect(initial,initial2,initialDecision),initial.id).contribution,initialDecision.id);
// Ordinary relearning is history only; explicitly eligible outcomes use their own opportunity.
const relearning:LearningBranch={...base('relearning',[left.id]),kind:'relearning',runId:'relearning-run',basis:left.id,grade:'good',schedulerEligible:false};
assert(!inspect(initial,left,relearning).opportunities.some(o=>o.records.includes(relearning.id)));
assert.equal(opportunity(inspect(initial,left,{...relearning,schedulerEligible:true}),relearning.id).selected,relearning.id);
assert.equal(opportunity(inspect(initial,left,right,{...relearning,schedulerEligible:true}),relearning.id).status,'blocked_by_basis');
const descendant:LearningBranch={...next,...base('descendant',[relearning.id]),basis:relearning.id};
assert(inspect(initial,left,relearning,descendant).invalid.includes(descendant.id));
assert.deepEqual(inspect(initial,{...left,schedulerEligible:false}).invalid,['left']);
const staleSelection:LearningBranch={...decision,...base('stale-selection',[left.id,correction.id]),candidates:[left.id,correction.id],selected:left.id};
assert.equal(opportunity(inspect(initial,left,correction,staleSelection),left.id).status,'requires_reconciliation');
// Duplicate logical output/run under a new fact ID is quarantined rather than double-counted.
const duplicate={...left,id:'different-fact-id'};
assert.deepEqual(inspect(initial,left,duplicate).duplicateOperations,['different-fact-id','left']);
assert.deepEqual(inspect(initial,left,{...duplicate,operationId:'another-op'}).duplicateRuns,['different-fact-id','left']);
assert.deepEqual(inspect(initial,left,{...left,grade:'easy'}).collisions,['left']);
assert.deepEqual(inspect(initial,{...left,target:{...target,bindingId:'other'}}).invalid,['left']);
assert.deepEqual(inspect(initial,left,right,{...decision,candidates:[initial.id,left.id]}).invalid,['decision']);
assert.deepEqual(inspect(left,right,decision).pending,['decision','left','right']);
assert.deepEqual(inspect(initial,left,{...right,libraryId:'foreign'}),inspect(initial,left));
assert.deepEqual(inspect(...[initial,left,right,decision,next].map(f=>({...f,occurredAt:f.id==='left'?'2099-01-01T00:00:00Z':'2001-01-01T00:00:00Z'}))),settled);
const noContribution={...decision,selected:null};
assert.equal(opportunity(inspect(initial,left,right,noContribution),left.id).selected,null);
assert.equal(opportunity(inspect(initial,left,right,noContribution),left.id).status,'reconciled');
console.log(`PASS: ${orders} reordered/duplicate branch deliveries; initial contention, explicit reconciliation, late/concurrent decisions, corrections, policy/grader variation, successor fencing, eligible relearning, operation/run collision and clock skew.`);
console.log('LIMIT: G1 prerequisite reference vectors only; production Rust/TS import, FSRS replay, device authorization, E2EE and product UI remain separate acceptance gates.');
