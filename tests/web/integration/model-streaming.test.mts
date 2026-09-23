/** Pure streaming protocol checks. No browser, network, database, or model calls. */
import assert from 'node:assert/strict';
import {
  partialJsonStringField,
  readManagedModelStream,
  readOpenAiModelStream,
} from '../../../apps/web/src/data/library/modelStreaming.ts';

const byteStream=(chunks:string[])=>new ReadableStream<Uint8Array>({
  start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));controller.close();},
});

assert.equal(partialJsonStringField('{"rep','reply'),null);
assert.equal(partialJsonStringField('{"meta":{"reply":"private"},"reply":"你\\n好 \\uD83D','reply'),'你\n好 ');
assert.equal(partialJsonStringField('{"meta":{"reply":"private"},"reply":"你\\n好 \\uD83D\\uDE03\\"朋友','reply'),'你\n好 😃"朋友');

const id=crypto.randomUUID(),inputDigest='a'.repeat(64),managedDeltas:string[]=[];
const managedValue={id,inputDigest,response:{model:'fixture',choices:[{finish_reason:'stop',message:{content:'{"reply":"流式回复"}'}}]}};
const managed=await readManagedModelStream(byteStream([
  '{"type":"delta","text":"{\\"reply\\":\\"流"}\n{"type":"del',
  'ta","text":"式回复\\"}"}\n',
  JSON.stringify({type:'result',value:managedValue})+'\n',
]),delta=>{managedDeltas.push(delta);});
assert.deepEqual(managedDeltas,['{"reply":"流','式回复"}']);
assert.deepEqual(managed,managedValue);

const contentChunks=[
  {model:'fixture-stream',choices:[{index:0,delta:{role:'assistant',content:'{"reply":"你'},finish_reason:null}]},
  {model:'fixture-stream',choices:[{index:0,delta:{content:'好"}'},finish_reason:null}]},
  {model:'fixture-stream',choices:[{index:0,delta:{},finish_reason:'stop'}]},
  {model:'fixture-stream',choices:[],usage:{prompt_tokens:4,completion_tokens:3,total_tokens:7}},
];
const sse=contentChunks.map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n';
const directDeltas:string[]=[];
const direct=await readOpenAiModelStream(byteStream([sse.slice(0,47),sse.slice(47,121),sse.slice(121)]),'fallback',delta=>{directDeltas.push(delta);}) as any;
assert.deepEqual(directDeltas,['{"reply":"你','好"}']);
assert.equal(direct.model,'fixture-stream');assert.equal(direct.choices[0].finish_reason,'stop');assert.equal(direct.choices[0].message.content,'{"reply":"你好"}');assert.equal(direct.usage.completion_tokens,3);

const toolChunks=[
  {choices:[{index:0,delta:{tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'lookup_',arguments:'{"query":"'}}]},finish_reason:null}]},
  {choices:[{index:0,delta:{tool_calls:[{index:0,function:{name:'meanings',arguments:'hello"}'}}]},finish_reason:null}]},
  {choices:[{index:0,delta:{},finish_reason:'tool_calls'}]},
];
const toolSse=toolChunks.map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n';
const toolResult=await readOpenAiModelStream(byteStream([toolSse]),'fixture',()=>{}) as any;
assert.deepEqual(toolResult.choices[0].message.tool_calls,[{id:'call-1',type:'function',function:{name:'lookup_meanings',arguments:'{"query":"hello"}'}}]);

console.log('PASS: managed NDJSON and learner-owned OpenAI SSE streams reassemble bounded final responses, tool calls remain intact, and only a safely decoded top-level reply prefix reaches the UI. No network/model calls.');
