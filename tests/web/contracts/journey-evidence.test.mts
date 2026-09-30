import assert from 'node:assert/strict';
import {test} from 'vitest';
import {webTestCatalog} from '../catalog.mts';
import {journeyTestIds,validateJourneyMapping} from '../journeyMapping.mts';

test('journey selection includes user-facing evidence and shared performance guards',()=>{
 validateJourneyMapping(webTestCatalog);
 const selected=journeyTestIds('LJ-01');
 for(const id of ['package-center-journey','book-installation-journey','package-learning','web-bundle-budget','web-bootstrap-budget','sqlite-opfs-benchmark'])assert(selected.includes(id),id);
 assert.equal(new Set(selected).size,selected.length);
 assert.throws(()=>journeyTestIds('LJ-unknown'),/Unknown Journey/u);
 assert.throws(()=>validateJourneyMapping(webTestCatalog.filter(test=>test.id!=='web-bootstrap-budget')),/supporting Test/u);
});
