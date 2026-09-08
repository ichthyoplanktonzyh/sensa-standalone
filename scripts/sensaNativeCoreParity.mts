import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {decideConsumerSettlement} from '../packages/learning-kernel/src/runtime/consumerSettlement.ts';
const current=[];
for(const date of ['2026-09-08T08:00:00.000Z','2024-02-28T23:59:59.999Z','2026-12-31T23:59:59.000Z']) {
  for(const rating of ['hard','good'] as const) {
    current.push({occurredAt:date,rating,...decideConsumerSettlement({purpose:'initial_learning',protocolVersion:'consumer-initial-v1',retentionTargetId:'fixture-target',rating,occurredAt:new Date(date)})});
  }
}
const fixed=JSON.parse(await readFile(new URL('../crates/sensa-core/tests/fixtures/ts-initial-v1.json',import.meta.url),'utf8'));
assert.deepEqual(JSON.parse(JSON.stringify(current)),fixed,'TS behavior changed: review the pinned Rust migration vectors');
const parity=spawnSync(process.execPath,['--import','tsx','scripts/sensaNativeSchedulingParity.mts'],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
if(parity.error)throw parity.error;
if(parity.status!==0)process.exit(parity.status??1);
const progression=spawnSync(process.execPath,['--import','tsx','scripts/sensaNativeProgressionParity.mts'],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
if(progression.error)throw progression.error;
if(progression.status!==0)process.exit(progression.status??1);
const planning=spawnSync(process.execPath,['--import','tsx','scripts/sensaNativePlanningParity.mts'],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
if(planning.error)throw planning.error;
if(planning.status!==0)process.exit(planning.status??1);
const fourStage=spawnSync(process.execPath,['--import','tsx','scripts/sensaNativeFourStageParity.mts'],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
if(fourStage.error)throw fourStage.error;
if(fourStage.status!==0)process.exit(fourStage.status??1);
const assurance=spawnSync(process.execPath,['--import','tsx','scripts/sensaNativeAssuranceParity.mts'],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
if(assurance.error)throw assurance.error;
if(assurance.status!==0)process.exit(assurance.status??1);
const assuranceQueue=spawnSync(process.execPath,['--import','tsx','scripts/sensaNativeAssuranceQueueParity.mts'],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
if(assuranceQueue.error)throw assuranceQueue.error;
if(assuranceQueue.status!==0)process.exit(assuranceQueue.status??1);
const assuranceReview=spawnSync(process.execPath,['--import','tsx','scripts/sensaNativeAssuranceReviewParity.mts'],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
if(assuranceReview.error)throw assuranceReview.error;
if(assuranceReview.status!==0)process.exit(assuranceReview.status??1);
for(const script of ['sensaNativeAssuranceMaterialParity.mts','sensaNativeReleaseParity.mts']) {
 const check=spawnSync(process.execPath,['--import','tsx',`scripts/${script}`],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
 if(check.error)throw check.error;
 if(check.status!==0)process.exit(check.status??1);
}
const result=spawnSync('cargo',['test','--workspace','--locked','--features','sensa-library/acceptance-fixture'],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
