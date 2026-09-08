import {explanationPreview} from '../apps/api/src/sensa/personal/explanationPreview.ts';
import assert from 'node:assert/strict';
import {providerStream} from '../apps/api/src/sensa/reading/providerStream.ts';
import {completeReading} from '../apps/api/src/sensa/reading/service.ts';
const encoder=new TextEncoder();
const frame=(content:string)=>'data: '+JSON.stringify({choices:[{delta:{content},finish_reason:null}]})+'\r\n\r\n';
const ending='data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
function response(text:string){const bytes=encoder.encode(text);return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}}));}
assert.equal(explanationPreview('{"proposal":{"explanation":"Hello\\nworld'), 'Hello\nworld');
assert.equal(explanationPreview('{"proposal":{"explanation":"Hello\\u4f'), 'Hello');
assert.equal(explanationPreview('{"proposal":{"semanticSpec":{"explanation":"wrong"},"explanation":"right'), 'right');
assert.equal(explanationPreview('{"proposal":null}'), null);
const chunks:string[]=[];
assert.equal(await providerStream(response(frame('你')+frame('好')+ending),async text=>{chunks.push(text);}), '你好');
assert.deepEqual(chunks,['你','你好']);
for(const input of [frame('truncated'),frame('limited')+ending.replace('stop','length'),frame('x'.repeat(24001))+ending,'data: {invalid}\n\n'])await assert.rejects(()=>providerStream(response(input),async()=>{}));
let delivered=0;await assert.rejects(()=>providerStream(response(frame('first')+frame('private')+ending),async()=>{if(++delivered===2)throw new Error('revoked');}),/revoked/u);
const originalFetch=globalThis.fetch;
try{
  globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://api.deepseek.com/chat/completions');const input=JSON.parse(String(init?.body));assert.equal(input.stream,true);const result=response(frame('provider text')+ending);result.headers.set('content-type','text/event-stream');return result;};
  const partials:string[]=[];
  assert.equal(await completeReading({id:crypto.randomUUID(),name:'Fixture',baseUrl:'https://api.deepseek.com',model:'fixture',enabled:true,apiKey:'fixture-only'},[{role:'user',content:'fixture'}],false,async text=>{partials.push(text);}), 'provider text');
  assert.deepEqual(partials,['provider text']);
}finally{globalThis.fetch=originalFetch;}
console.log('PASS: actual SSE incremental Unicode parsing, final stop/DONE requirement, truncation/length/malformed rejection, size bound and callback cancellation; no network/provider calls.');
