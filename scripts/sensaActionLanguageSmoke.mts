/** What the learner is asked to learn, and what the daily limit is the limit of.
 *
 * Queue membership and the daily-new allowance belong to a Language Route;
 * learning and Retention progress still belong to the shared Target.
 */
import assert from 'node:assert/strict';
import {advanceInterleavedLearningRetries,resolveLearningQueue,selectInterleavedLearningTarget} from '../apps/web/src/learning/system/learningPlanning.ts';
import {resolvePracticeScopeCatalog, CURRENT_STUDY_SCOPE_ID, PERSONAL_SEMANTIC_WORLD_SCOPE_ID,type PracticeStudyTarget} from '../apps/web/src/experience/practiceScope.ts';
import type { LocalLearningTarget } from '../apps/web/src/data/library/learning.ts';
import type {PersonalMeaningLearningSource} from '../apps/web/src/contentSupply/provisioning/contracts.ts';

const at=(hours:number)=>new Date(2026,8,20,hours).toISOString();
const clock=new Date(2026,8,20,21).getTime();
const routes={en:'route-en',es:'route-es'} as const;

const target=(over:Partial<LocalLearningTarget>&{id:string}):LocalLearningTarget=>({
  retentionId:'retention-'+over.id,expression:'expression-'+over.id,meaning:'meaning-'+over.id,
  planningOverrides:[],
  curriculumMemberships:[{languageContext:{languageRouteId:routes[(over.targetLanguageTag??'en') as keyof typeof routes]}}] as never,
  introducedLanguageRouteId:over.startedAt?routes[(over.targetLanguageTag??'en') as keyof typeof routes]:null,
  createdAt:at(8),startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null,...over} as LocalLearningTarget);

const ready={} as Record<string,'ready'|'blocked'>;
const targets=[
  // English: two due for review, one already started today, one untouched.
  target({id:'en-due',targetLanguageTag:'en',memory:{dueAt:new Date(clock-3600_000)} as never,completedAt:at(8),startedAt:at(8)}),
  target({id:'en-due-2',targetLanguageTag:'en',memory:{dueAt:new Date(clock-7200_000)} as never,completedAt:at(8),startedAt:at(8)}),
  target({id:'en-new',targetLanguageTag:'en'}),
  // Spanish: one due, two untouched.
  target({id:'es-due',targetLanguageTag:'es',memory:{dueAt:new Date(clock-60_000)} as never,completedAt:at(8),startedAt:at(8)}),
  target({id:'es-new-1',targetLanguageTag:'es'}),
  target({id:'es-new-2',targetLanguageTag:'es'}),
];
for(const item of targets)ready[item.id]='ready';

// The language being learned now decides the queue.
const spanish=resolveLearningQueue({targets,languageRouteId:routes.es,readiness:ready,clock,dailyLimit:20});
assert.deepEqual(spanish.activeTargets.map(t=>t.id),['es-due','es-new-1','es-new-2'],'the queue holds the language being learned now');
assert.deepEqual(spanish.due.map(t=>t.id),['es-due'],'the review queue is that language only');
assert.deepEqual(spanish.initialReady.map(t=>t.id),['es-new-1','es-new-2'],'today\'s new items are that language only');
assert.ok(!spanish.due.some(t=>t.targetLanguageTag==='en'),'another language is never handed to the queue');

const english=resolveLearningQueue({targets,languageRouteId:routes.en,readiness:ready,clock,dailyLimit:20});
assert.deepEqual(english.activeTargets.map(t=>t.id),['en-due','en-due-2','en-new'],'the queue includes only explicitly matching targets');
assert.deepEqual(english.due.map(t=>t.id),['en-due','en-due-2']);

// Each Route owns its Study Plan allowance; another Route does not consume it.
const usedUp=resolveLearningQueue({targets,languageRouteId:routes.es,readiness:ready,clock,dailyLimit:2});
assert.equal(usedUp.startedToday,1,'only Targets introduced through this Route consume its allowance');
assert.equal(usedUp.remaining,1);
assert.deepEqual(usedUp.initialReady.map(t=>t.id),['es-new-1'],'the allowance left is what the active language may use');
const noneLeft=resolveLearningQueue({targets,languageRouteId:routes.es,readiness:ready,clock,dailyLimit:1});
assert.equal(noneLeft.remaining,0);
assert.deepEqual(noneLeft.initialReady.map(t=>t.id),[],'the active Route enforces its own new-item limit');
assert.deepEqual(noneLeft.due.map(t=>t.id),['es-due'],'review is not limited by the new-item allowance');

// A blocked or already-declared target is never queued.
const blocked={...ready,'es-due':'blocked','es-new-1':'blocked'} as Record<string,'ready'|'blocked'>;
const filtered=resolveLearningQueue({targets,languageRouteId:routes.es,readiness:blocked,clock,dailyLimit:20});
assert.deepEqual(filtered.due.map(t=>t.id),[],'a target whose material is not ready is not queued');
assert.deepEqual(filtered.initialReady.map(t=>t.id),['es-new-2']);
const declared=resolveLearningQueue({targets:targets.map(t=>t.id==='es-new-2'?{...t,planningOverrides:[{kind:'declared_mastery',source:'learner',operationId:'fixture',createdAt:at(9)}]}:t),languageRouteId:routes.es,readiness:ready,clock,dailyLimit:20});
assert.deepEqual(declared.initialReady.map(t=>t.id),['es-new-1'],'a meaning the learner says they already know is not queued');

// Missed meanings return after other work instead of forming a retry block at the end.
const queueTarget=(id:string)=>({id});
const retryA=queueTarget('retry-a'),retryB=queueTarget('retry-b'),newC=queueTarget('new-c'),newD=queueTarget('new-d');
let retries=advanceInterleavedLearningRetries([],'retry-a',true);
assert.equal(selectInterleavedLearningTarget({due:[retryA],initialReady:[newC,newD],currentRunTargetIds:['retry-a'],retries})?.id,'new-c');
retries=advanceInterleavedLearningRetries(retries,'retry-b',true);
assert.equal(selectInterleavedLearningTarget({due:[retryA,retryB],initialReady:[newC,newD],currentRunTargetIds:['retry-b'],retries})?.id,'new-c');
retries=advanceInterleavedLearningRetries(retries,'new-c',false);
assert.equal(selectInterleavedLearningTarget({due:[retryA,retryB],initialReady:[newD],currentRunTargetIds:['new-c'],retries})?.id,'retry-a','the first miss returns after two intervening completions');
retries=advanceInterleavedLearningRetries(retries,'retry-a',false);
assert.equal(selectInterleavedLearningTarget({due:[retryB],initialReady:[newD],currentRunTargetIds:['retry-a'],retries})?.id,'retry-b','multiple misses interleave instead of collecting at the tail');

// Free Practice offers the expressions of the language being learned now.
const meaning=(id:string,languageTag:string):PersonalMeaningLearningSource=>({
  sourceKind:'personal_meaning_alignment',
  reference:{personalMeaningId:id,personalMeaningRevisionId:'meaning-revision-'+id,personalMeaningAlignmentId:'alignment-'+id,alignmentRevision:1,alignmentBasisReferenceId:'basis-'+id,meaningFocusId:null,senseId:'sense-'+id,senseVersionId:'sense-version-'+id,bindingId:'binding-id-'+id,bindingVersionId:'binding-'+id},
  targetLanguageTag:languageTag,
  context:{text:'',images:[],personalSemanticAnchorRevisionIds:[]},
  expression:{expressionType:'word',surfaceForm:'expression-'+id,languageTag},
  semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'sense '+id,prototypeScenes:[{summary:'scene '+id,participantRoles:[],states:[],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]},
});
const personalMeaningSources=[meaning('es-1','es'),meaning('en-1','en')];
const personalOnly={sourceId:PERSONAL_SEMANTIC_WORLD_SCOPE_ID,targetIds:['personal:alignment-es-1:binding-es-1','personal:alignment-en-1:binding-en-1']} as never;
const spanishScope=resolvePracticeScopeCatalog({selection:personalOnly,personalMeaningSources,studyTargets:[],studyTitle:'Current learning',activeLanguageTag:'es'});
assert.deepEqual(spanishScope.currentScope.targets.map(t=>t.expression.languageTag),['es'],'practice offers the language being learned now');
assert.deepEqual(spanishScope.selection,{sourceId:PERSONAL_SEMANTIC_WORLD_SCOPE_ID,targetIds:['personal:alignment-es-1:binding-es-1']},'a selection that survives the language only keeps its own language');
const englishScope=resolvePracticeScopeCatalog({selection:personalOnly,personalMeaningSources,studyTargets:[],studyTitle:'Current learning',activeLanguageTag:'en'});
assert.deepEqual(englishScope.currentScope.targets.map(t=>t.expression.languageTag),['en']);
// The formal Learning Target projection follows the same active Route filter;
// it never falls back to a shipped catalogue.
const practiceStudyTarget:PracticeStudyTarget={target:{targetId:'learning-en',curriculumMembershipId:'membership-en',identity:{senseId:'sense-en',senseVersionId:'sense-version-en',bindingId:'binding-en',bindingVersionId:'binding-version-en'},presentation:{expression:'borrow',targetLanguageTag:'en'},material:{snapshot:{learningMaterializationId:'material-en',validationStatus:'validated'},content:{resources:[]}}}} as never;
const studyFor=(tag:string)=>resolvePracticeScopeCatalog({selection:{sourceId:CURRENT_STUDY_SCOPE_ID},personalMeaningSources:[],activeLanguageTag:tag,studyTargets:[practiceStudyTarget],studyTitle:'Current learning'});
assert.equal(studyFor('en').currentScope.targets.length,1,'an English learner keeps the real English Learning Target');
assert.equal(studyFor('es').currentScope.targets.length,0,'another language is not offered that English Learning Target');

console.log('PASS: the queue and Study Plan allowance follow the active Language Route, while Free Practice follows its Target Language and shared Target progress is preserved.');
