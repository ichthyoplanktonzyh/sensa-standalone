/** Stateless, metered model transport. Tools and personal session state execute on the device. */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { ConsumerError } from '../access/auth.js';
import { semanticDigest } from '../personal/nativeSemantic.js';
import type { ReadingCompletion } from '../reading/service.js';
import {modelTurnInputSchema as inputSchema} from '@sensa/contracts/sensa';
import {executeModel} from '../models/executor.js';
type Input = z.infer<typeof inputSchema>;
export type AgentCompletion = (connection: Parameters<ReadingCompletion>[0], body: Input['body'], signal: AbortSignal,meta?:{id:string;purpose:Input['purpose']}) => Promise<unknown>;
export const completeAgent:AgentCompletion=(connection,body,signal,meta)=>{const purpose=meta?.purpose??'teacher';const model=connection.id==='00000000-0000-4000-8000-000000000001'?(purpose==='review'?process.env.SENSA_REVIEW_MODEL??process.env.SENSA_CONTENT_MODEL:purpose==='content'?process.env.SENSA_CONTENT_MODEL:process.env.SENSA_SEMANTIC_MODEL):undefined;return executeModel({...connection,model:model??connection.model},body,{signal,id:meta?.id,purpose});};
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
      const response = await (options.complete ?? completeAgent)(connection, input.body, controller.signal,{id:input.id,purpose:input.purpose});
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
