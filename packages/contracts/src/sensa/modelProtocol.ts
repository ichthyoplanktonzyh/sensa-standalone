import {SENSA_CONTENT_AGENT_TOOLS} from './contentAgent.js';
import {z} from 'zod';
export const SENSA_TEACHER_AGENT_TOOLS=['lookup_meanings'] as const;
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
    name: z.enum([...SENSA_TEACHER_AGENT_TOOLS, ...SENSA_CONTENT_AGENT_TOOLS]),
    description: z.string().max(1000),
    parameters: z.record(z.string(), z.unknown())
  }).strict()
}).strict();
export const modelTurnInputSchema = z.object({
  id: z.string().uuid(),
  purpose: z.enum(['teacher', 'content', 'review', 'reference']),
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  body: z.object({
    model: z.string().max(100),
    messages: z.array(message).min(2).max(100),
    tools: z.array(tool).max(4).optional(),
    max_tokens: z.number().int().min(1).max(3000),
    stream: z.literal(false),
    response_format: z.object({
      type: z.literal('json_object')
    }).strict().optional()
  }).strict()
}).strict();
export type ModelTurnInput=z.infer<typeof modelTurnInputSchema>;
export type ModelTurnBody=ModelTurnInput['body'];

/**
 * Server-to-browser events for a managed model turn. Provider text remains an
 * opaque delta here: the feature that owns the response schema decides which
 * part, if any, is safe to present before final validation.
 */
export const modelTurnStreamEventSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('delta'),text:z.string().max(32000)}).strict(),
  z.object({
    type:z.literal('result'),
    value:z.object({
      id:z.string().uuid(),
      inputDigest:z.string().regex(/^[a-f0-9]{64}$/u),
      response:z.unknown(),
    }).strict(),
  }).strict(),
  z.object({type:z.literal('error'),code:z.string().min(1).max(100)}).strict(),
]);
export type ModelTurnStreamEvent=z.infer<typeof modelTurnStreamEventSchema>;
