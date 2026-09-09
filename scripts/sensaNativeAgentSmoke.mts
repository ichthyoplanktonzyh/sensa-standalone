// No external network or paid models. --serve exposes deterministic OpenAI-compatible responses.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createNativeAgentRoutes } from '../apps/api/src/sensa/agent/native.ts';
import { semanticDigest } from '../apps/api/src/sensa/personal/nativeSemantic.ts';
import { ConsumerError } from '../apps/api/src/sensa/access/auth.ts';
const stats = {
  calls: 0,
  images: 0,
  questions: 0,
  proposals: 0,
  rejections: 0,
  acceptances: 0,
  observations: 0,
  contentImages: 0,
  reviewImages: 0,
  references: 0,
  models: {} as Record<string,number>
};
function proposal(borrow = false) {
  return {
    explanation: borrow ? '从别人那里暂时借来使用，可以说 borrow。' : '把东西暂时借给别人，可以说 lend。',
    expression: {
      surface: borrow ? 'borrow' : 'lend',
      type: 'word',
      language: 'en'
    },
    semanticSpec: {
      schemaVersion: 'sensa-sense-semantic-spec-v1',
      coreMeaningFocus: borrow ? '从别人那里暂时拿来使用，之后归还。' : '把东西暂时给别人使用，之后归还。',
      prototypeScenes: [{
        summary: borrow ? '一个人从朋友那里借来物品，使用后归还。' : '一个人把物品暂时给朋友使用，用完后归还。',
        participantRoles: ['提供者', '使用者'],
        states: [],
        directionOrCausality: null
      }],
      includedCases: [],
      excludedCases: [],
      neighborContrasts: [],
      openQuestions: []
    }
  };
}
function complete(body: any) {
  stats.calls++;
  stats.models[body.model]=(stats.models[body.model]??0)+1;
  const messages = body.messages;
  for (const m of messages) {
    if (Array.isArray(m.content)) for (const p of m.content) if (p.type === 'image_url') {
      assert.match(p.image_url.url, /^data:image\/png;base64,/);
      stats.images++;
    }
  }
  stats.observations += messages.filter((m: any) => m.role === 'tool').length;
  const respond = (message: any) => ({
    model: 'fixture-actual',
    choices: [{
      message
    }]
  });
  const call = (name: string, args: unknown) => respond({
    role: 'assistant',
    content: '我来根据你的场景继续整理。',
    tool_calls: [{
      id: randomUUID(),
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify(args)
      }
    }]
  });
  const tools = (body.tools ?? []).map((t: any) => t.function.name);
  const previous = messages.flatMap((m: any) => m.tool_calls ?? []).map((c: any) => c.function.name);
  if (tools.includes('ask_learner')) {
    assert.match(messages[0].content, /friendly language teacher/);
    const replies = messages.slice(2).filter((m: any) => m.role === 'user').map((m: any) => m.content).join(' ');
    if (!previous.includes('lookup_meanings')) return call('lookup_meanings', {
      query: 'lend'
    });
    if (!replies) {
      stats.questions++;
      return call('ask_learner', {
        question: '你是把东西给别人用，还是从别人那里借来？'
      });
    }
    stats.proposals++;
    return call('propose_meaning', proposal(replies.includes('更正')));
  }
  const first = messages[1].content;
  const input = JSON.parse(Array.isArray(first) ? first.find((p:any)=>p.type==='text').text : first);
  const origin = input.anchor ?? input.origin;
  if (JSON.stringify(messages).includes('PRIVATE')) assert.ok(origin?.grantId, 'Unapproved personal context');
  if (Array.isArray(first)) {
    const n=first.filter((p:any)=>p.type==='image_url').length;
    assert.equal(origin.material.blocks.filter((b:any)=>b.kind==='image').length,n);
    if(tools.includes('read_demand')) stats.contentImages+=n; else stats.reviewImages+=n;
  }
  if(input.reference) { assert.equal(input.reference.attribution,'Synthetic resource acceptance'); stats.references++; }

  if (tools.includes('read_demand')) {
    if (!previous.includes('read_demand')) return call('read_demand', {});
    if (!previous.includes('lookup_reference_facts')) return call('lookup_reference_facts', {});
    const corrected = messages.some((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('审核')) || previous.includes('submit_candidate');
    return call('submit_candidate', {
      scene: corrected ? '下雨时你从朋友那里借来一把雨伞，用完后再归还给朋友。' : '你从朋友那里借来一把雨伞，暂时使用以后会归还。',
      senseFocus: '暂时从别人那里借来使用',
      resources: [{materialRoleKey:'recall_support',contentPayload:{text:'想想物品从哪里来、之后要交还给谁。'}},{materialRoleKey:'scene_bridge',contentPayload:{text:'联系借来物品后归还的场景。'}}]
    });
  }
  assert.equal(messages.length, 2, 'Review must have a fresh isolated conversation');
  assert.deepEqual(tools, []);
  const data = input;
  const accepted = data.candidate.scene.startsWith('下雨时');
  if (accepted) stats.acceptances++;else stats.rejections++;
  return respond({
    role: 'assistant',
    content: JSON.stringify({
      accepted,
      reason: accepted ? '符合固定意思，没有泄露英文答案。' : '请让具体场景更清楚，然后重新审核。'
    })
  });
}
let invoked = 0;
const reserved = new Set<string>();
const app = createNativeAgentRoutes({
  authorize: async r => {
    if (r.headers.get('Authorization') !== 'Bearer fixture-access') throw new ConsumerError(401, 'access_required');
    return {
      id: 'fixture',
      name: 'fixture',
      baseUrl: 'https://example.invalid',
      model: 'fixture',
      enabled: true,
      apiKey: 'unused'
    };
  },
  reserve: async (_r, i) => {
    if (reserved.has(i.id)) throw new ConsumerError(409, 'native_request_consumed');
    reserved.add(i.id);
  },
  complete: async (_c, b) => {
    invoked++;
    return {
      model: 'fixture-actual',
      choices: [{
        message: {
          role: 'assistant',
          content: 'fixture'
        }
      }]
    };
  }
});
async function wire(body: any, purpose = 'teacher') {
  const payload = {
    id: randomUUID(),
    purpose,
    body
  };
  return {
    ...payload,
    inputDigest: await semanticDigest(payload)
  };
}
const body = {
  model: 'fixture',
  messages: [{
    role: 'system',
    content: 'teacher'
  }, {
    role: 'user',
    content: 'synthetic'
  }],
  stream: false,
  max_tokens: 100
};
const post = (v: unknown, key = 'fixture-access') => app.request('/turn', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(v)
});
const input = await wire(body);
assert.equal((await post(input, 'wrong')).status, 401);
assert.equal(invoked, 0);
assert.equal((await post({
  ...input,
  inputDigest: '0'.repeat(64)
})).status, 400);
const good = await post(input);
assert.equal(good.status, 200);
assert.equal(good.headers.get('Cache-Control'), 'no-store');
assert.equal(((await good.json()) as any).inputDigest, input.inputDigest);
assert.equal((await post(input)).status, 409);
assert.equal(invoked, 1);
assert.equal((await post(await wire({
  ...body,
  tools: [{
    type: 'function',
    function: {
      name: 'read_demand',
      description: 'bad teacher tool',
      parameters: {}
    }
  }]
}))).status, 400);
assert.equal((await post(await wire({
  ...body,
  messages: [body.messages[0], {
    role: 'user',
    content: [{
      type: 'image_url',
      image_url: {
        url: 'https://example.invalid/private.png'
      }
    }]
  }]
}))).status, 400);
assert.equal((await post(await wire({
  ...body,
  messages: [body.messages[0], {
    role: 'user',
    content: [{
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,YQ=='
      }
    }]
  }]
}))).status, 200);
assert.equal(invoked, 2);
console.log('PASS native agent Hono: auth, digest, replay fence, tool separation, inline images only; no paid requests.');
const serviceRequests=new Set<string>();
const fixtureSensa=createNativeAgentRoutes({
 authorize:async request=>{if(request.headers.get('Authorization')!=='Bearer fixture-access')throw new ConsumerError(401,'access_required');return {id:'fixture',name:'fixture',baseUrl:'https://example.invalid',model:'fixture',enabled:true,apiKey:'unused'};},
 reserve:async(_request,input)=>{if(serviceRequests.has(input.id))throw new ConsumerError(409,'native_request_consumed');serviceRequests.add(input.id);},
 complete:async(_connection,body)=>complete(body),
});
if (process.argv.includes('--serve')) createServer(async (req, res) => {
  try {
    if (req.url === '/stats') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(stats));
      return;
    }
    if (req.headers.authorization !== 'Bearer fixture-access') {
      res.statusCode = 401; res.end('invalid synthetic credential'); return;
    }
    const parts: Buffer[] = [];
    for await (const p of req) parts.push(p);
    const raw=Buffer.concat(parts).toString();
    if(req.url==='/sensa/native/agent/turn'){
      const result=await fixtureSensa.request('/turn',{method:'POST',headers:{Authorization:req.headers.authorization!,'Content-Type':'application/json'},body:raw});
      res.statusCode=result.status;res.setHeader('Content-Type','application/json');res.end(await result.text());return;
    }
    assert.equal(req.url, '/chat/completions');
    const b = JSON.parse(raw);
    const result = complete(b);
    if(b.stream){
      res.setHeader('Content-Type','text/event-stream');
      const msg=result.choices[0].message;
      const send=(delta:any,finish_reason:string|null=null)=>res.write(`data: ${JSON.stringify({model:result.model,choices:[{index:0,delta,finish_reason}]})}\n\n`);
      send({content:msg.content.slice(0,3)}); send({content:msg.content.slice(3)});
      for(const [index,call] of (msg.tool_calls??[]).entries()) {
        const args=call.function.arguments;
        send({tool_calls:[{index,id:call.id,type:'function',function:{name:call.function.name,arguments:args.slice(0,5)}}]});
        send({tool_calls:[{index,function:{arguments:args.slice(5)}}]});
      }
      send({},msg.tool_calls?.length?'tool_calls':'stop');
      res.end('data: [DONE]\n\n');
    }else{
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    }
  } catch (e) {
    console.error(String(e));
    res.statusCode = 400;
    res.end('fixture assertion failed');
  }
}).listen(4331, '127.0.0.1', () => console.log('No-cost agent fixture ready at 127.0.0.1:4331'));
