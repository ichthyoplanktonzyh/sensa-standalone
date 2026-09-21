import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {nextLearningQueueChangeAt} from '../apps/web/src/experience/library/learningQueue.ts';
import {nextPersonalLearningLeaseExpiry} from '../apps/web/src/experience/library/preparationSchedule.ts';
import {automaticCloudSyncRetryAt,blocksAutomaticCloudSync,cloudSyncFailurePolicy,cloudSyncRetryDelaysMs} from '../apps/web/src/data/library/cloudSyncPolicy.ts';

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

let failure=cloudSyncFailurePolicy('library_sync_network',true,0,now);
assert.equal(automaticCloudSyncRetryAt(failure),now+cloudSyncRetryDelaysMs[0],'network failure receives a bounded first retry');
failure=cloudSyncFailurePolicy('library_sync_network',true,cloudSyncRetryDelaysMs.length,now);
assert.equal(automaticCloudSyncRetryAt(failure),null,'transient failures stop after the bounded retry budget');
const incompatible=cloudSyncFailurePolicy('library_sync_incompatible_checkpoint',true,0,now);
assert.equal(incompatible.failureKind,'terminal');assert.equal(blocksAutomaticCloudSync(incompatible),true,'legacy Checkpoints must never enter the automatic retry loop');
assert.equal(blocksAutomaticCloudSync({status:'failed'}),false,'an unclassified failure from an older release receives one migration attempt');
assert.equal(cloudSyncFailurePolicy('library_sync_network',false,0,now).status,'offline','offline waits for the browser online event instead of a timer');

const sources=await Promise.all([
 'apps/web/src/experience/library/usePackageLearning.ts',
 'apps/web/src/experience/library/usePersonalLearning.ts',
 'apps/web/src/experience/account/ExtensionIntake.tsx',
].map(async path=>[path,await readFile(path,'utf8')] as const));
for(const [path,source] of sources)assert(!source.includes('setInterval('),`${path} must not restore fixed idle polling`);
const app=await readFile('apps/web/src/experience/App.tsx','utf8');
const home=await readFile('apps/web/src/experience/library/HomeLearningController.tsx','utf8');
const workspace=await readFile('apps/web/src/experience/library/LearningWorkspace.tsx','utf8');
const shell=await readFile('apps/web/src/experience/ui/WebShell.tsx','utf8');
const screenHost=await readFile('apps/web/src/experience/ui/ScreenHost.tsx','utf8');
assert(/lazy\(\(\)=>import\('\.\/library\/HomeLearningController'\)/u.test(app),'the lightweight Home controller must remain outside the shell chunk');
assert(/const LearningWorkspace=lazy\(async\(\)=>\{/u.test(app)&&app.includes("import('./library/LearningWorkspace')"),'full learning controllers must remain outside the Home shell');
assert(!app.includes('usePackageLearning')&&!app.includes('usePersonalLearning'),'App must not eagerly initialize full learning controllers');
assert(!home.includes('usePackageLearning')&&!home.includes('usePersonalLearning'),'Home must use its small read projection instead of full learning controllers');
assert(/lazy\(\(\)=>import\('\.\/PackageLearningRuntime'\)/u.test(workspace),'formal learning Runtime must remain outside the learning workspace graph');
assert(app.includes('<ScreenHost')&&workspace.includes('<ScreenHost'),'both shell levels must delegate screen ownership to ScreenHost');
assert(!shell.includes('MutationObserver'),'WebShell must not infer route ownership by observing DOM mutations');
assert(screenHost.includes('outgoing: ScreenEntry | null'),'ScreenHost must bound retained DOM to current plus one outgoing screen');

console.log('PASS: idle work is event-driven, Home is lightweight, heavy Runtime stays deferred, and ScreenHost owns a bounded route lifecycle without DOM observation.');
