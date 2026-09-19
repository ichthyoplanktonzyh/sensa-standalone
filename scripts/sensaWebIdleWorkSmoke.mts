import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {nextLearningQueueChangeAt} from '../apps/web/src/experience/library/learningQueue.ts';
import {nextPersonalLearningLeaseExpiry} from '../apps/web/src/experience/library/preparationSchedule.ts';

const routeId='route-fixture';
const now=Date.parse('2026-09-19T04:00:00.000Z');
const target=(id:string,dueAt:number)=>({
 id,
 curriculumMemberships:[{status:'active',languageContext:{languageRouteId:routeId}}],
 planningOverrides:[],
 memory:{dueAt:new Date(dueAt)},
 relearnAt:null,
 startedAt:null,
 completedAt:'2026-09-18T04:00:00.000Z',
}) as any;
const first=target('first',now+5_000),second=target('second',now+12_000);
assert.equal(nextLearningQueueChangeAt({targets:[second,first],languageRouteId:routeId,readiness:{first:'ready',second:'ready'},clock:now,dailyLimit:20}),now+5_000,'the queue sleeps until the earliest due fact');
assert.equal(nextLearningQueueChangeAt({targets:[second,first],languageRouteId:routeId,readiness:{first:'ready',second:'ready'},clock:now+5_000,dailyLimit:20}),now+12_000,'after one boundary it schedules the next exact boundary');

const task=(status:string,leaseUntil:number)=>({status,leaseUntil});
assert.equal(nextPersonalLearningLeaseExpiry([task('ready',now+1_000),task('reviewing',now+8_000),task('generating',now+3_000)],now),now+3_000,'preparation sleeps until the earliest active lease expires');
assert.equal(nextPersonalLearningLeaseExpiry([task('failed',now+1_000),task('generating',now-1)],now),null,'inactive or expired preparation creates no timer');

const sources=await Promise.all([
 'apps/web/src/experience/library/usePackageLearning.ts',
 'apps/web/src/experience/library/usePersonalLearning.ts',
 'apps/web/src/experience/account/ExtensionIntake.tsx',
].map(async path=>[path,await readFile(path,'utf8')] as const));
for(const [path,source] of sources)assert(!source.includes('setInterval('),`${path} must not restore fixed idle polling`);
const app=await readFile('apps/web/src/experience/App.tsx','utf8');
assert(/lazy\(\(\)=>import\('\.\/library\/PackageLearningRuntime'\)/u.test(app),'formal learning Runtime must remain outside the startup graph');

console.log('PASS: queue and preparation wake at exact fact boundaries, extension intake has no fixed poll, and the formal Runtime remains deferred.');
