import {beforeEach,test,vi} from 'vitest';
import assert from 'node:assert/strict';
import type {SemanticAgentTurnInput} from '../../../apps/web/src/experience/personalMeaningJourney/semanticAgent.ts';

const fixture=vi.hoisted(()=>({responses:[] as unknown[],requests:[] as Array<{messages:unknown[];tools:unknown[];options:Record<string,unknown>}>,lookups:0}));
const reusedSenseId=crypto.randomUUID(),reusedVersionId=crypto.randomUUID();
const existingMeaning={senseId:reusedSenseId,senseVersionId:reusedVersionId,senseKey:'give_plant_water',semanticSpec:{
  schemaVersion:'sensa-sense-semantic-spec-v1' as const,coreMeaningFocus:'给植物供水的动作。',
  prototypeScenes:[{summary:'学习者给家里的植物浇水。',participantRoles:['浇水者','植物'],states:['植物需要水'],directionOrCausality:'提供水分'}],
  includedCases:['给盆栽浇水'],excludedCases:['把水倒掉'],neighborContrasts:[{label:'倒掉水',distinction:'不是给植物供水'}],openQuestions:[],
},expressions:[{expression:'water',languageTag:'en'}],expressionsTruncated:false};
vi.mock('../../../apps/web/src/data/library/providers.ts',()=>({selectedProvider:async()=>({name:'Fixture',model:'fixture-teacher',kind:'compatible'})}));
vi.mock('../../../apps/web/src/experience/personalMeaningJourney/gateway.ts',()=>({journeyGateway:{
  getStatus:()=>({ok:true}),
  getWorldItems:()=>{throw new Error('teacher must not build world detail projections');},
  lookupMeanings:()=>{fixture.lookups++;return {meanings:[existingMeaning],truncated:false};},
}}));
vi.mock('../../../apps/web/src/data/library/transport.ts',()=>({
  complete:async(_provider:unknown,_purpose:unknown,_id:unknown,messages:unknown[],tools:unknown[],_signal:unknown,options:{onText?:(delta:string)=>void})=>{
    fixture.requests.push({messages:structuredClone(messages),tools:structuredClone(tools),options:{...options}});
    const value=fixture.responses.shift();
    if(value instanceof Error)throw value;
    if(!value)throw new Error('fixture exhausted');
    const {deltas=[],failure,...response}=value as {deltas?:string[];failure?:Error;[key:string]:unknown};
    for(const delta of deltas)options.onText?.(delta);
    if(failure)throw failure;
    return response;
  },
}));
import {createRealSemanticAgent} from '../../../apps/web/src/experience/personalMeaningJourney/realSemanticAgent.ts';

const input=(onAssistantText?:(text:string)=>void):SemanticAgentTurnInput=>({
  material:{blocks:[{blockId:crypto.randomUUID(),kind:'text',bodyText:'我想表达给植物浇水。',mediaDataUrl:null,mediaMimeType:null}],familiarExpression:null,startingPoint:'from_sense'},
  messages:[],workingSet:{context:null,focus:null,sense:null,expression:null,expressions:[]},readyToConfirm:false,learnerEditedTracks:[],focusLocked:false,
  languages:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},onAssistantText,
});
const answer={context:'学习者想给植物浇水。',sense:'给植物供水的动作。',senseKey:'give_plant_water',scene:'学习者给家里的植物浇水。',expression:'water',expressionType:'word',relation:'realizes',coverage:'exact',reason:'water 可作动词表达这个动作。'};
const final=(reply:string,proposal:unknown=null,deltas:string[]=[])=>({model:'fixture-teacher',choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply,clarity:{context:proposal!==null,sense:proposal!==null,expression:proposal!==null},proposal})}}],deltas});
const call=(name:string,args:unknown)=>({model:'fixture-teacher',choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
beforeEach(()=>{fixture.responses=[];fixture.requests=[];fixture.lookups=0;});

test('a natural teacher question uses one final response and never manufactures a candidate',async()=>{
  const visible:string[]=[];
  fixture.responses.push(final('你说的是给植物浇水，还是把水倒掉？',null,['{"reply":"你说的是','给植物浇水，还是把水倒掉？","clarity":{"context":false},"proposal":null}']));
  const result=await createRealSemanticAgent().turn(input(text=>visible.push(text)));
  assert.equal(result.readyToConfirm,false);assert.equal(result.workingSet.sense,null);
  assert.equal(fixture.requests.length,1);assert.equal(fixture.lookups,0);
  assert.deepEqual((fixture.requests[0]!.tools as Array<{function:{name:string}}>).map(tool=>tool.function.name),['lookup_meanings']);
  assert.equal(fixture.requests[0]!.options.responseFormat,'json_object');
  assert(visible.includes('你说的是'));assert(!visible.some(text=>text.includes('clarity')));
});

test('one streamed final response yields the validated reply and complete candidate together',async()=>{
  const visible:string[]=[];
  fixture.responses.push(final('可以说 water，表示给植物浇水。',answer,['{"reply":"可以说 ','water，表示给植物浇水。","clarity":{"context":true},"proposal":{"private":"hidden"}}']));
  const result=await createRealSemanticAgent().turn(input(text=>visible.push(text)));
  assert.equal(result.readyToConfirm,true);assert.equal(result.workingSet.expression?.surfaceForm,'water');
  assert.equal(result.workingSet.sense?.coreMeaningFocus,answer.sense);
  assert.equal(fixture.requests.length,1);assert.deepEqual(result.steps,[]);
  assert(visible.includes('可以说 '));assert(!visible.some(text=>text.includes('private')));
});

test('invalid final metadata is retried in the same bounded loop, not published as a candidate',async()=>{
  fixture.responses.push(final('可以说 water。',{...answer,expression:''}),final('可以说 water。',answer));
  const result=await createRealSemanticAgent().turn(input());
  assert.equal(result.workingSet.expression?.surfaceForm,'water');assert.equal(fixture.requests.length,2);
  assert.match(JSON.stringify(fixture.requests[1]!.messages),/final JSON failed validation/u);
});

test('a misplaced changeReason is rejected with actionable field feedback, not accepted or retried blindly',async()=>{
  const malformed=final('可以说 water。',answer);
  const value=JSON.parse(malformed.choices[0]!.message.content);
  malformed.choices[0]!.message.content=JSON.stringify({...value,changeReason:'private diagnostic text'});
  fixture.responses.push(malformed,final('可以说 water。',answer));
  const result=await createRealSemanticAgent().turn(input());
  assert.equal(result.readyToConfirm,true);assert.equal(fixture.requests.length,2);
  const feedback=(fixture.requests[1]!.messages as Array<{content:string}>).at(-1)!.content;
  assert.match(feedback,/unrecognized_keys/u);assert.match(feedback,/changeReason/u);
  assert(!feedback.includes('private diagnostic text'),'field correction never echoes rejected payload values');
});

test('a terminal malformed provider response gets bounded format correction but incomplete streams do not',async()=>{
  fixture.responses.push(new Error('localFlow.modelResponseInvalid',{cause:{code:'model_invalid_response'}}),final('可以说 water。',answer));
  const result=await createRealSemanticAgent().turn(input());
  assert.equal(result.readyToConfirm,true);assert.equal(fixture.requests.length,2);
  assert.match(JSON.stringify(fixture.requests[1]!.messages),/previous response was not valid JSON/u);
  fixture.responses.push(new Error('localFlow.modelIncomplete'));
  await assert.rejects(createRealSemanticAgent().turn(input()),/modelIncomplete/u);
  assert.equal(fixture.requests.length,3,'a stream without a known final result is not automatically re-executed');
  fixture.responses.push(new Error('localFlow.modelResponseInvalid',{cause:{code:'model_stream_invalid'}}));
  await assert.rejects(createRealSemanticAgent().turn(input()),/modelResponseInvalid/u);
  assert.equal(fixture.requests.length,4,'malformed transport frames do not justify another provider execution');
});

test('non-final markers and mixed tool reply content cannot admit a candidate or execute a lookup',async()=>{
  const mismatch=final('可以说 water。',answer);
  mismatch.choices[0]!.finish_reason='tool_calls';
  const mixed=call('lookup_meanings',{query:'water'});
  mixed.choices[0]!.message.content=JSON.stringify({reply:'not a final reply'}) as never;
  fixture.responses.push(mismatch,mixed,final('你想表达怎样的真实场景？'));
  const result=await createRealSemanticAgent().turn(input());
  assert.equal(result.readyToConfirm,false);assert.equal(fixture.lookups,0);assert.equal(fixture.requests.length,3);
  assert.match(JSON.stringify(fixture.requests[1]!.messages),/completion marker must match/u);
  assert.match(JSON.stringify(fixture.requests[2]!.messages),/mixed_teacher_output/u);
});

test('the only teacher tool reads bounded existing semantics without private source material or writes',async()=>{
  fixture.responses.push(call('lookup_meanings',{query:'water'}),final('可以说 water。',answer));
  const result=await createRealSemanticAgent().turn(input());
  assert.equal(fixture.lookups,1);assert.deepEqual(result.steps.map(step=>step.tool),['lookup_meanings']);
  const feedback=(fixture.requests[1]!.messages as Array<{content:string}>).at(-1)!;
  const output=JSON.parse(feedback.content);
  assert.equal(output.ok,true);assert.equal(output.meanings.length,1);assert.equal(output.meanings[0].senseKey,'give_plant_water');
  assert(!feedback.content.includes('privateContext'));
});

test('reuse preserves the exact looked-up semantic version and boundaries, not a guessed key',async()=>{
  const {sense:_sense,senseKey:_key,scene:_scene,...newContextAndExpression}=answer;
  const selection={...newContextAndExpression,reuseSense:{senseId:reusedSenseId,senseVersionId:reusedVersionId}};
  fixture.responses.push(call('lookup_meanings',{query:'water'}),final('可以说 water。',selection));
  const result=await createRealSemanticAgent().turn(input());
  assert.deepEqual(result.workingSet.sense?.reuseSense,{senseId:reusedSenseId,senseVersionId:reusedVersionId});
  assert.deepEqual(result.workingSet.sense?.excludedCases,['把水倒掉']);
  assert.deepEqual(result.workingSet.sense?.prototypeScenes,existingMeaning.semanticSpec.prototypeScenes);
  fixture.responses.push(final('可以说 water。',selection),final('可以说 water。',answer));
  const notLookedUp=await createRealSemanticAgent().turn(input());
  assert.equal(notLookedUp.workingSet.sense?.reuseSense,undefined);
  assert.match(JSON.stringify(fixture.requests.at(-1)!.messages),/teacher_invalid_reuse_reference/u);
});

test('organizing or replying with an unapproved tool cannot stage a candidate',async()=>{
  fixture.responses.push(call('organize_answer',answer),final('需要先了解你的真实场景。'));
  const result=await createRealSemanticAgent().turn(input());
  assert.equal(result.readyToConfirm,false);assert.equal(result.workingSet.sense,null);assert.equal(fixture.lookups,0);
  assert.equal(result.steps[0]?.status,'failed');
  assert.match(JSON.stringify(fixture.requests[1]!.messages),/unapproved_teacher_tool/u);
});

test('a failed or aborted stream clears ephemeral text and leaves the caller state unchanged',async()=>{
  const visible:string[]=[],turn=input(text=>visible.push(text));const before=structuredClone(turn.workingSet);
  fixture.responses.push({...final('可以说 water。',answer,['{"reply":"尚未完整的回复']),failure:new Error('localFlow.modelIncomplete')});
  await assert.rejects(createRealSemanticAgent().turn(turn),/modelIncomplete/u);
  assert(visible.includes('尚未完整的回复'));assert.deepEqual(turn.workingSet,before);assert.equal(visible.at(-1),'');
  const controller=new AbortController();
  fixture.responses.push(final('可以说 water。',answer,['{"reply":"正在回复','更多文本"}']));
  await assert.rejects(createRealSemanticAgent().turn({...turn,signal:controller.signal,onAssistantText:text=>{visible.push(text);if(text==='正在回复')controller.abort();}}));
  assert.equal(fixture.requests.length,2);assert.equal(visible.at(-1),'');assert.deepEqual(turn.workingSet,before);
});

test('invalid final replies stop after six attempts without accepting partial results',async()=>{
  fixture.responses.push(...Array.from({length:6},()=>({model:'fixture',choices:[{finish_reason:'stop',message:{content:'not valid JSON'}}]})));
  await assert.rejects(createRealSemanticAgent().turn(input()),/modelResponseInvalid/u);
  assert.equal(fixture.requests.length,6);
});
