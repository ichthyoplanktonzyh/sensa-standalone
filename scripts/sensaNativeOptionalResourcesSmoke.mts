// Real shared Web schemas against native admission; no model or owner data.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {lightweightInitialRolePayloadSchema} from '../packages/contracts/src/sensa/lightweightLearningContent.ts';
const build=spawnSync('cargo',['build','-p','sensa-library','--example','resources_driver'],{encoding:'utf8'});
assert.equal(build.status,0,build.stderr);
const cases:[string,unknown][]=[
 ['recall_support',{text:'想想如何照顾对方的感受。'}],
 ['recall_support',{text:''}], ['recall_support',{text:'提示',hidden:'answer'}],
 ['scene_bridge',{text:'联系刚才表达不同意见的场景。'}],
 ['scene_bridge',{text:4}],
 ['language_structure',{expressionKind:'word',expressionTypeLabel:'单词',partOfSpeech:'形容词'}],
 ['language_structure',{expressionKind:'utterance',expressionTypeLabel:null,partOfSpeech:null}],
 ['language_structure',{expressionKind:'unknown',expressionTypeLabel:null,partOfSpeech:null}],
 ['usage_guidance',{example:'She was tactful.'}], ['usage_guidance',{example:null}],
];
for(const [role,payload] of cases){
 const web=lightweightInitialRolePayloadSchema(role as any).safeParse(payload).success;
 const r=spawnSync('target/debug/examples/resources_driver',[],{input:JSON.stringify({resources:[{materialRoleKey:role,contentPayload:payload}]}),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout),web,role);
}
console.log('PASS: 10 actual Web-schema/native optional-resource cases; native bounds and disclosure checked by transactional tests.');
