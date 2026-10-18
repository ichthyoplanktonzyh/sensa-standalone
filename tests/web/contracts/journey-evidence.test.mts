import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {test} from 'vitest';
import {webTestCatalog} from '../catalog.mts';
import {journeyTestIds,validateJourneyMapping,scenarioEvidenceContributions,currentJourneyScenarios,auditedScenarios,scenarioLongJourneyIds,longJourneyMappings} from '../journeyMapping.mts';

test('journey selection includes user-facing evidence and shared performance guards',()=>{
 validateJourneyMapping(webTestCatalog);
 const selected=journeyTestIds('LJ-01');
 for(const id of ['package-center-journey','book-installation-journey','package-learning','web-bundle-budget','web-bootstrap-budget','sqlite-opfs-benchmark'])assert(selected.includes(id),id);
 assert.equal(new Set(selected).size,selected.length);
 const portable=journeyTestIds('LJ-02');
 for(const id of ['portable-package-journey','portable-package-loop','portable-lightweight-package','package-cache-projection','book-center-projection','personal-learning','personal-portable-export','portable-media-cache','sqlite-sahpool-preservation','sqlite-sahpool-recovery','library-transaction-and-replay','workspace-source-aliases','web-bundle-budget'])assert(portable.includes(id),id);
 assert.throws(()=>journeyTestIds('LJ-unknown'),/Unknown Journey/u);
 const personal=journeyTestIds('LJ-03');
 for(const id of ['semantic-teacher-flow','semantic-teacher-contract','semantic-session-persistence','semantic-session-persistence-browser','web-intake','agent-mcp','intake-delivery','model-turn'])assert(personal.includes(id),id);
 assert.equal(new Set(personal).size,personal.length);
 assert.throws(()=>validateJourneyMapping(webTestCatalog.filter(test=>test.id!=='web-bootstrap-budget')),/supporting Test/u);
});

test('current Listening requirements select their own evidence without rewriting historical verdicts',()=>{
 const listening=journeyTestIds('LJ-15');
 for(const id of ['practice-scope','practice-source-loading','youglish-caption','youglish-lifecycle','reference-practice-journey','web-bundle-budget','web-bootstrap-budget','sqlite-opfs-benchmark'])assert(listening.includes(id),id);
 for(const scenario of currentJourneyScenarios){
  assert(!auditedScenarios.some(legacy=>legacy.id===scenario.id),'current requirements cannot replace historical audit rows');
  assert(!('baselineVerdict'in scenario),'a current requirement is not a passing result');
  assert.deepEqual(scenarioLongJourneyIds(scenario.id),scenario.journeyIds);
 }
 assert.throws(()=>scenarioLongJourneyIds('SCN-unknown'),/Unknown Scenario/u);
 validateJourneyMapping(webTestCatalog);
});

test('every current learner, supporting and operator journey explicitly selects registered evidence',()=>{
 validateJourneyMapping(webTestCatalog);
 assert.equal(longJourneyMappings.length,30);
 for(const journey of longJourneyMappings){
  const selected=journeyTestIds(journey.journeyId);
  assert(selected.length>0,`${journey.journeyId}: no executable evidence selection`);
  assert.equal(new Set(selected).size,selected.length);
  for(const id of selected)assert(webTestCatalog.some(entry=>entry.id===id),`${journey.journeyId}: ${id}`);
  if(!/^(SJ|OJ)-/u.test(journey.journeyId))continue;
  const requirements=currentJourneyScenarios.filter(item=>item.journeyIds.includes(journey.journeyId));
  assert(requirements.length>0,`${journey.journeyId}: needs current requirements, not only legacy capability membership`);
  assert(scenarioEvidenceContributions.some(item=>item.journeyIds.includes(journey.journeyId)&&requirements.some(scenario=>scenario.id===item.scenarioId)),`${journey.journeyId}: needs named assertion evidence`);
 }
 // A link records assertion scope, not a run result or journey completion.
 for(const contribution of scenarioEvidenceContributions.filter(item=>item.journeyIds.some(id=>/^(SJ|OJ)-/u.test(id)))){
  assert(!('verdict'in contribution));
  if(contribution.coverage==='partial')assert(contribution.remainingGaps.length>0);
 }
 assert(journeyTestIds('OJ-04').includes('system-release'));
 assert(!journeyTestIds('OJ-04').includes('package-center-journey'),'capability crosswalk alone must not widen executable selection');
});

test('every named scenario contribution points to an executable literal test declaration',async()=>{
 const sources=new Map<string,string>();
 for(const contribution of scenarioEvidenceContributions){
  const entry=webTestCatalog.find(item=>item.id===contribution.testId)!;
  if(!sources.has(entry.file)){
   const source=await readFile(entry.file,'utf8');
   // Strip comments and types before checking declarations, not mere mentions.
   sources.set(entry.file,(await transform(source,{loader:'ts',minifyWhitespace:true,legalComments:'none'})).code);
  }
  const code=sources.get(entry.file)!;
  const quoted=[JSON.stringify(contribution.testCase),`'${contribution.testCase.replaceAll('\\','\\\\').replaceAll("'","\\'")}'`];
  assert(quoted.some(title=>code.includes(`test(${title},`)),`${contribution.scenarioId}: missing executable test ${contribution.testId}/${contribution.testCase}`);
 }
});
