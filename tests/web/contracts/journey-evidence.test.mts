import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {test} from 'vitest';
import {webTestCatalog} from '../catalog.mts';
import {journeyTestIds,validateJourneyMapping,scenarioEvidenceContributions} from '../journeyMapping.mts';

test('journey selection includes user-facing evidence and shared performance guards',()=>{
 validateJourneyMapping(webTestCatalog);
 const selected=journeyTestIds('LJ-01');
 for(const id of ['package-center-journey','book-installation-journey','package-learning','web-bundle-budget','web-bootstrap-budget','sqlite-opfs-benchmark'])assert(selected.includes(id),id);
 assert.equal(new Set(selected).size,selected.length);
 const portable=journeyTestIds('LJ-02');
 for(const id of ['portable-package-journey','portable-package-loop','portable-lightweight-package','package-cache-projection','book-center-projection','personal-learning','personal-portable-export','portable-media-cache','sqlite-sahpool-preservation','sqlite-sahpool-recovery','library-transaction-and-replay','workspace-source-aliases','web-bundle-budget'])assert(portable.includes(id),id);
 assert.throws(()=>journeyTestIds('LJ-unknown'),/Unknown Journey/u);
 assert.throws(()=>validateJourneyMapping(webTestCatalog.filter(test=>test.id!=='web-bootstrap-budget')),/supporting Test/u);
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
