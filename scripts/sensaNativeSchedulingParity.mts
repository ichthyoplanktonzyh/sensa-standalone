import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {rebuildCardScheduleState, computeReviewSchedule, createEmptyReviewableCardScheduleState, type ReviewableCardScheduleState} from '../packages/learning-kernel/src/runtime/scheduling.ts';
import {defaultWorkspaceSchedulerConfig, type WorkspaceSchedulerConfig} from '../packages/learning-kernel/src/runtime/workspaceConfig.ts';
import {transitionConsumerRun} from '../packages/learning-kernel/src/runtime/consumerInitial.ts';
import {decideConsumerSettlement, type ConsumerSettlementInput} from '../packages/learning-kernel/src/runtime/consumerSettlement.ts';

const inputs: unknown[]=[];
const expected: unknown[]=[];
function add(input: unknown, result: unknown) { inputs.push(input); expected.push({ok:result}); }
const configs: WorkspaceSchedulerConfig[] = [
  defaultWorkspaceSchedulerConfig,
  {...defaultWorkspaceSchedulerConfig,learningStepsMinutes:[],relearningStepsMinutes:[],enableFuzz:false},
  {...defaultWorkspaceSchedulerConfig,desiredRetention:0.95,learningStepsMinutes:[2],relearningStepsMinutes:[3,15,60]},
  {...defaultWorkspaceSchedulerConfig,desiredRetention:0.8,maximumIntervalDays:30,learningStepsMinutes:[1,5,20,60],relearningStepsMinutes:[5,30]},
  {...defaultWorkspaceSchedulerConfig,maximumIntervalDays:1},
];
// Histories include each rating, same-day/UTC-midnight, overdue, leap/year
// boundaries, short-term steps, graduation, lapses and deterministic fuzz.
for (const config of configs) for (const start of ['2024-02-28T23:59:59.999Z','2026-12-31T23:50:00.000Z']) {
  let card=createEmptyReviewableCardScheduleState('parity-target');
  let at=new Date(start);
  for (let i=0;i<180;i++) {
    for (const rating of [0,1,2,3] as const) {
      const schedule=computeReviewSchedule(card,config,rating,at);
      add({kind:'schedule',card,config,rating,at},schedule);
    }
    const rating=([2,0,1,3,2,2,0,3,1] as const)[i%9]!;
    const next=computeReviewSchedule(card,config,rating,at);
    // dueAt belongs to a trigger, not the scheduler state contract.
    card={cardId:card.cardId,reps:next.reps,lapses:next.lapses,fsrsCardState:next.fsrsCardState,fsrsStepIndex:next.fsrsStepIndex,fsrsStability:next.fsrsStability,fsrsDifficulty:next.fsrsDifficulty,fsrsLastReviewedAt:next.fsrsLastReviewedAt,fsrsScheduledDays:next.fsrsScheduledDays};
    at=new Date(i%3===0?at.getTime()+60_000:next.dueAt.getTime()+(i%7)*86_400_000);
  }
}
for(const config of configs) for(const count of [0,1,20]) {
  const events=Array.from({length:count},(_,i)=>({rating:([2,0,1,3] as const)[i%4]!,reviewedAt:new Date(Date.UTC(2026,0,1+i))}));
  add({kind:'rebuild',targetId:'rebuild-target',config,events},rebuildCardScheduleState('rebuild-target',config,events));
}
for(const protocol of ['consumer-initial-v1','consumer-review-v1','consumer-relearning-v1','unknown-v1']) {
  for(const phase of ['recall','reveal','waiting','completed'] as const) for(const action of ['reveal','again','hard','good'] as const) {
    const input={kind:'transition',protocol,phase,action};
    if(protocol==='unknown-v1') { inputs.push(input); expected.push({error:'unsupported_protocol'}); continue; }
    try {
      const result=transitionConsumerRun(protocol,phase as 'recall'|'reveal',action==='reveal'?{kind:'reveal'}:{kind:'rate',rating:action});
      add(input,result);
    } catch { inputs.push(input); expected.push({error:'stale_step'}); }
  }
}
const initialAt=new Date('2026-09-08T08:00:00.000Z');
const config=configs[1]!;
const initial=computeReviewSchedule(createEmptyReviewableCardScheduleState('parity-target'),config,2,initialAt);
const memory={revision:'memory-v1',dueAt:initial.dueAt,schedule:{...createEmptyReviewableCardScheduleState('parity-target'),...initial} as ReviewableCardScheduleState};
// Ensure the explicit schedule wire doesn't accidentally include dueAt.
delete (memory.schedule as unknown as Record<string,unknown>).dueAt;
for(const purpose of ['initial_learning','retention_review','relearning'] as const) for(const rating of ['again','hard','good'] as const) {
  const protocolVersion=purpose==='initial_learning'?'consumer-initial-v1':purpose==='retention_review'?'consumer-review-v1':'consumer-relearning-v1';
  const input: ConsumerSettlementInput=purpose==='retention_review'
    ?{purpose,protocolVersion,retentionTargetId:'parity-target',rating,occurredAt:initial.dueAt,memory,trigger:{memoryRevision:memory.revision,dueAt:memory.dueAt}}
    :{purpose,protocolVersion,retentionTargetId:'parity-target',rating,occurredAt:initialAt};
  const context=purpose==='retention_review'?{purpose,memory,trigger:{memoryRevision:memory.revision,dueAt:memory.dueAt}}:{purpose};
  add({kind:'settlement',targetId:input.retentionTargetId,protocol:protocolVersion,action:rating,at:input.occurredAt,context},decideConsumerSettlement(input));
}
const review={purpose:'retention_review' as const,protocolVersion:'consumer-review-v1',retentionTargetId:'parity-target',rating:'again' as const,occurredAt:initial.dueAt,memory,trigger:{memoryRevision:memory.revision,dueAt:memory.dueAt}};
for(const input of [
  {...review,trigger:{...review.trigger,memoryRevision:'stale'}},
  {...review,trigger:{...review.trigger,dueAt:new Date(0)}},
  {...review,retentionTargetId:'another-target'},
  {...review,occurredAt:initialAt},
  {...review,protocolVersion:'consumer-initial-v1'},
]) {
  let code: string|undefined;
  try { decideConsumerSettlement(input); } catch(e) { code=(e as {code:string}).code; }
  assert.ok(code);
  inputs.push({kind:'settlement',targetId:input.retentionTargetId,protocol:input.protocolVersion,action:input.rating,at:input.occurredAt,context:{purpose:input.purpose,memory:input.memory,trigger:input.trigger}});
  expected.push({error:code});
}
// Standalone scheduler rejects malformed inputs before they can produce facts.
for(const [overrides,error] of [
  [{algorithm:'unknown'},'unsupported_scheduler'],[{desiredRetention:1},'invalid_scheduler_config'],
  [{maximumIntervalDays:0},'invalid_scheduler_config'],[{learningStepsMinutes:[-1]},'invalid_scheduler_config'],
] as const) {
  inputs.push({kind:'schedule',card:createEmptyReviewableCardScheduleState('target'),config:{...config,...overrides},rating:2,at:initialAt}); expected.push({error});
}
const result=spawnSync('cargo',['run','--quiet','--locked','-p','sensa-core','--example','parity_runner'],{cwd:new URL('..',import.meta.url),input:JSON.stringify(inputs),encoding:'utf8',maxBuffer:24*1024*1024});
if(result.status!==0) throw new Error(result.stderr || String(result.error));
const actual=JSON.parse(result.stdout) as unknown[];
assert.equal(actual.length,expected.length);
function normalize(value: unknown): unknown {
  if(typeof value==='string' && /^\d{4}-\d\d-\d\dT/.test(value))return new Date(value).toISOString();
  if(Array.isArray(value))return value.map(normalize);
  if(value!==null && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v)]));
  return value;
}
const normalized=JSON.parse(JSON.stringify(expected));
for(let i=0;i<actual.length;i++)assert.deepEqual(normalize(actual[i]),normalized[i],`Rust/TS divergence at ${i}: ${JSON.stringify(inputs[i])}`);
console.log(`Native scheduling/protocol/settlement parity: ${actual.length} cases passed (no network or model calls)`);
