import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {DEFAULT_RETENTION_SCOPE,RetentionScopeRegistry} from '../apps/web/src/experience/learningRuntime/retentionScopes.ts';
const d=DEFAULT_RETENTION_SCOPE;
const independent=(scopeId:string,prerequisite?:string)=>({...d,scopeId,kind:'independent' as const,prerequisite,admission:{learnerSelectable:true as const,stableInteractionContract:true as const,separablePerformance:true as const,independentSchedulingValue:true as const}});
const defs=[d,independent('listen'),independent('speak','listen')];
const cases=[
 {definitions:[d],selected:[]},
 {definitions:defs,selected:['speak','listen','listen']},
 {definitions:defs,selected:['speak']},
 {definitions:defs,selected:['semantic_connection']},
 {definitions:defs,selected:['missing']},
 {definitions:[d,d],selected:[]},
 {definitions:[],selected:[]},
 {definitions:[d,independent('bad','missing')],selected:[]},
 {definitions:[d,independent('a','b'),independent('b','a')],selected:[]},
 {definitions:[d,{...independent('bad'),admission:undefined}],selected:[]},
 {definitions:[{...d,scopeVersion:'v2'},...defs.slice(1)],selected:['listen','speak']},
].map(c=>({...c,learningTargetId:"my:学习 / target!?中"}));
const expected=cases.map(c=>{try{return {ok:true,targets:new RetentionScopeRegistry(c.definitions).resolveTargets(c.learningTargetId,c.selected)}}catch{return {ok:false}}});
const built=spawnSync('cargo',['build','--quiet','-p','sensa-core','--example','retention_scope_driver'],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
const result=spawnSync('target/debug/examples/retention_scope_driver',[],{input:JSON.stringify(cases),encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),expected);
assert.equal(expected[10].targets?.[0].retentionTargetId,expected[0].targets?.[0].retentionTargetId);
console.log(`PASS: ${cases.length} live TS/Rust retention scope vectors; admission, dependency ordering, identity/version independence and invalid registries.`);
// TS's Object.values guard accepts a partial object at runtime. The canonical
// four-part admission contract takes precedence over that accidental leniency.
const malformed=[{definitions:[d,{...independent('partial'),admission:{learnerSelectable:true}}],selected:[],learningTargetId:'target'}];
const strict=spawnSync('target/debug/examples/retention_scope_driver',[],{input:JSON.stringify(malformed),encoding:'utf8'});
assert.equal(strict.status,0,strict.stderr);
assert.deepEqual(JSON.parse(strict.stdout),[{ok:false}]);
console.log('PASS: partial independent admission is rejected under the canonical four-field rule.');
