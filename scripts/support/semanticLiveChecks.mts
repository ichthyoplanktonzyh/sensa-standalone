import assert from 'node:assert/strict';
import {captureSnapshotSchema} from '@sensa/contracts/sensa';
import {resolveSemantic} from '../../apps/api/dist/sensa/personal/semanticResolver.js';

/** Opt-in quality probes only; the caller owns credentials and a persisted request ceiling. */
export async function runSemanticLiveChecks(baseline=false,only?:string){
  const cases=[
    {name:'clear-noun',sentence:"Let's get your news for Thursday, August 20th, starting with some unsettling news. We've already seen more foodborne illness outbreaks in the United States this summer than in any of the previous five summers. We are on pace for a record. Experts say there are several reasons why. Extreme summer heat can create conditions where some bacteria multiply faster, especially when food isn't kept at safe temperatures, and",expression:'bacteria',ready:true},
    {name:'clear-collocation',sentence:'She took her time.',expression:'took her time',ready:true},
    {name:'disambiguated-noun',sentence:'She deposited her salary at the bank.',expression:'bank',ready:true},
    {name:'ambiguous-noun',sentence:'He waited by the bank.',expression:'bank',ready:false},
  ];
  if(only&&!cases.some(sample=>sample.name===only))throw new Error('Unknown semantic quality case');
  const outcomes=[];
  for(const sample of only?cases.filter(sample=>sample.name===only):baseline?cases.slice(0,1):cases){
    const start=Array.from(sample.sentence.slice(0,sample.sentence.indexOf(sample.expression))).length;
    const snapshot=captureSnapshotSchema.parse({sentence:sample.sentence,language:'en',expression:{text:sample.expression,start,end:start+Array.from(sample.expression).length},source:{url:'https://example.org/semantic-quality',title:'Semantic quality probe',capturedAt:new Date().toISOString()}});
    const result=await resolveSemantic(snapshot,null);
    const ready=result.proposal!==null;
    outcomes.push({name:sample.name,ready,expected:sample.ready,policy:result.policyVersion,core:result.proposal?.semanticSpec.coreMeaningFocus??null});
    console.log(JSON.stringify(outcomes.at(-1)));
  }
  if(!baseline)assert.ok(outcomes.every(result=>result.ready===result.expected),'Live semantic routing differs from expected cases');
}
