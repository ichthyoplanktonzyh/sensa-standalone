/** Stateless, metered model transport. Tools and personal session state execute on the device. */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { ConsumerError } from '../access/auth.js';
import { semanticDigest } from '../personal/nativeSemantic.js';
import type { ReadingCompletion } from '../reading/service.js';
const part = z.union([z.object({
  type: z.literal('text'),
  text: z.string().max(300000)
}).strict(), z.object({
  type: z.literal('image_url'),
  image_url: z.object({
    url: z.string().max(9 * 1024 * 1024).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u)
  }).strict()
}).strict()]);
const message = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string().max(300000), z.array(part).max(31), z.null()]),
  tool_call_id: z.string().max(100).optional(),
  tool_calls: z.array(z.object({
    id: z.string().max(100),
    type: z.literal('function'),
    function: z.object({
      name: z.string().max(100),
      arguments: z.string().max(32000)
    }).strict()
  }).strict()).max(4).optional()
}).strict();
const tool = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.enum(['lookup_meanings', 'ask_learner', 'propose_meaning', 'read_demand', 'lookup_reference_facts', 'submit_candidate']),
    description: z.string().max(1000),
    parameters: z.record(z.string(), z.unknown())
  }).strict()
}).strict();
const inputSchema = z.object({
  id: z.string().uuid(),
  purpose: z.enum(['teacher', 'content', 'review']),
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  body: z.object({
    model: z.string().max(100),
    messages: z.array(message).min(2).max(100),
    tools: z.array(tool).max(3).optional(),
    max_tokens: z.number().int().min(1).max(3000),
    stream: z.literal(false),
    response_format: z.object({
      type: z.literal('json_object')
    }).strict().optional()
  }).strict()
}).strict();
type Input = z.infer<typeof inputSchema>;
export type AgentCompletion = (connection: Parameters<ReadingCompletion>[0], body: Input['body'], signal: AbortSignal) => Promise<unknown>;
export const completeAgent: AgentCompletion = async (connection, body, signal) => {
  const base = new URL(connection.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new ConsumerError(503, 'provider_unavailable');
  const response = await fetch(connection.baseUrl.replace(/\/+$/u, '') + '/chat/completions', {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      Authorization: `Bearer ${connection.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...body,
      model: connection.model,
      ...(base.hostname === 'api.deepseek.com' ? {
        thinking: {
          type: 'disabled'
        }
      } : {})
    })
  });
  if (!response.ok || !response.body) throw new ConsumerError(503, 'provider_unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const {
        done,
        value
      } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 256 * 1024) throw new ConsumerError(503, 'response_too_large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
};
export function createNativeAgentRoutes(options: {
  authorize: (r: Request) => Promise<Parameters<ReadingCompletion>[0]>;
  reserve: (r: Request, input: {
    id: string;
    inputDigest: string;
  }) => Promise<void>;
  complete?: AgentCompletion;
}) {
  const app = new Hono();
  app.use('*', bodyLimit({
    maxSize: 12 * 1024 * 1024,
    onError: c => c.json({
      code: 'body_too_large'
    }, 413)
  }));
  app.onError((e, c) => c.json({
    code: e instanceof ConsumerError ? e.code : e instanceof z.ZodError || e instanceof SyntaxError ? 'invalid_request' : 'provider_unavailable'
  }, e instanceof ConsumerError ? e.status : e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 503));
  app.post('/turn', async c => {
    c.header('Cache-Control', 'no-store');
    const connection = await options.authorize(c.req.raw);
    const input = inputSchema.parse(await c.req.json());
    const {
      inputDigest,
      ...payload
    } = input;
    if ((await semanticDigest(payload)) !== inputDigest) throw new ConsumerError(400, 'input_digest_mismatch');
    const textBody=JSON.stringify({...input.body,messages:input.body.messages.map(m=>({...m,content:Array.isArray(m.content)?m.content.map(p=>p.type==='image_url'?{type:'image_url'}:p):m.content}))});
    if(new TextEncoder().encode(textBody).length>256*1024)throw new ConsumerError(413,'model_input_too_large');
    const names = input.body.tools?.map(t => t.function.name) ?? [];
    const allowed = input.purpose === 'teacher' ? ['lookup_meanings', 'ask_learner', 'propose_meaning'] : input.purpose === 'content' ? ['read_demand', 'lookup_reference_facts', 'submit_candidate'] : [];
    if (names.some(n => !allowed.includes(n)) || new Set(names).size !== names.length) throw new ConsumerError(400, 'unapproved_tool');
    await options.reserve(c.req.raw, input);
    const controller = new AbortController();
    const abort = () => controller.abort();
    c.req.raw.signal.addEventListener('abort', abort);
    if (c.req.raw.signal.aborted) abort();
    const timer = setTimeout(abort, 45000);
    try {
      if (controller.signal.aborted) throw new ConsumerError(503, 'provider_timeout');
      const response = await (options.complete ?? completeAgent)(connection, input.body, controller.signal);
      if (controller.signal.aborted) throw new ConsumerError(503, 'provider_timeout');
      await options.authorize(c.req.raw);
      return c.json({
        id: input.id,
        inputDigest,
        response
      });
    } finally {
      clearTimeout(timer);
      c.req.raw.signal.removeEventListener('abort', abort);
    }
  });
  return app;
}
