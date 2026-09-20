import { modelTurnStreamEventSchema } from '@sensa/contracts/sensa';

const RESPONSE_LIMIT = 2 * 1024 * 1024;

export class ModelStreamError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ModelStreamError';
  }
}

async function* responseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > RESPONSE_LIMIT) throw new ModelStreamError('model_response_too_large');
      buffered += decoder.decode(value, { stream: true });
      for (;;) {
        const newline = buffered.indexOf('\n');
        if (newline < 0) break;
        const line = buffered.slice(0, newline).replace(/\r$/u, '');
        buffered = buffered.slice(newline + 1);
        yield line;
      }
    }
    buffered += decoder.decode();
    if (buffered) yield buffered.replace(/\r$/u, '');
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function readManagedModelStream(
  body: ReadableStream<Uint8Array>,
  onText: (delta: string) => void | Promise<void>,
): Promise<unknown> {
  let result: unknown;
  let terminal = false;
  for await (const line of responseLines(body)) {
    if (!line.trim()) continue;
    if (terminal) throw new ModelStreamError('model_stream_invalid');
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new ModelStreamError('model_stream_invalid');
    }
    const event = modelTurnStreamEventSchema.safeParse(parsed);
    if (!event.success) throw new ModelStreamError('model_stream_invalid');
    if (event.data.type === 'delta') {
      await onText(event.data.text);
    } else if (event.data.type === 'error') {
      terminal = true;
      throw new ModelStreamError(event.data.code);
    } else {
      terminal = true;
      result = event.data.value;
    }
  }
  if (!terminal || result === undefined) throw new ModelStreamError('model_stream_incomplete');
  return result;
}

type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

/** Reassembles the OpenAI-compatible SSE shape used by learner-owned providers. */
export async function readOpenAiModelStream(
  body: ReadableStream<Uint8Array>,
  fallbackModel: string,
  onText: (delta: string) => void | Promise<void>,
): Promise<unknown> {
  let content = '';
  let finishReason: unknown = null;
  let model = fallbackModel;
  let usage: unknown;
  let eventData: string[] = [];
  let done = false;
  const calls = new Map<number, ToolCall>();

  const consume = async (): Promise<void> => {
    if (eventData.length === 0) return;
    const data = eventData.join('\n');
    eventData = [];
    if (data === '[DONE]') {
      done = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new ModelStreamError('model_stream_invalid');
    }
    const chunk = record(parsed);
    if (!chunk) throw new ModelStreamError('model_stream_invalid');
    if (record(chunk.error)) throw new ModelStreamError('model_provider_failed');
    if (typeof chunk.model === 'string') model = chunk.model;
    if (chunk.usage !== undefined) usage = chunk.usage;
    const choice = Array.isArray(chunk.choices) ? record(chunk.choices[0]) : null;
    if (!choice) return;
    if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
      finishReason = choice.finish_reason;
    }
    const delta = record(choice.delta);
    if (!delta) return;
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      await onText(delta.content);
    }
    if (!Array.isArray(delta.tool_calls)) return;
    for (const raw of delta.tool_calls) {
      const part = record(raw);
      if (!part || !Number.isInteger(part.index)) throw new ModelStreamError('model_stream_invalid');
      const index = part.index as number;
      const current = calls.get(index) ?? {
        id: '',
        type: 'function' as const,
        function: { name: '', arguments: '' },
      };
      if (typeof part.id === 'string' && !current.id) current.id = part.id;
      const fn = record(part.function);
      if (typeof fn?.name === 'string') current.function.name += fn.name;
      if (typeof fn?.arguments === 'string') current.function.arguments += fn.arguments;
      calls.set(index, current);
    }
  };

  for await (const line of responseLines(body)) {
    if (done) {
      if (line.trim()) throw new ModelStreamError('model_stream_invalid');
      continue;
    }
    if (!line) {
      await consume();
      continue;
    }
    if (line.startsWith(':')) continue;
    if (line.startsWith('data:')) eventData.push(line.slice(5).replace(/^ /u, ''));
  }
  await consume();
  if (!done || finishReason === null) throw new ModelStreamError('model_stream_incomplete');
  const toolCalls = [...calls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call);
  return {
    model,
    choices: [{
      finish_reason: finishReason,
      message: {
        content: content || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
    }],
    ...(usage === undefined ? {} : { usage }),
  };
}

function jsonStringValueStart(source: string, field: string): number | null {
  let depth = 0;
  let stringStart = -1;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (stringStart >= 0) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        if (depth === 1) {
          let key: unknown;
          try {
            key = JSON.parse(source.slice(stringStart, index + 1));
          } catch {
            return null;
          }
          if (key === field) {
            let cursor = index + 1;
            while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
            if (source[cursor] !== ':') return null;
            cursor += 1;
            while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
            return source[cursor] === '"' ? cursor + 1 : null;
          }
        }
        stringStart = -1;
      }
      continue;
    }
    if (char === '"') stringStart = index;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
  }
  return null;
}

/**
 * Reads only a top-level JSON string field and returns its safely decoded
 * prefix. Incomplete escape sequences and surrogate pairs remain hidden until
 * the following chunk completes them.
 */
export function partialJsonStringField(source: string, field: string): string | null {
  const start = jsonStringValueStart(source, field);
  if (start === null) return null;
  let value = '';
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === '"') return value;
    if (char === '\\') {
      const escape = source[index + 1];
      if (!escape) return value;
      const simple: Record<string, string> = {
        '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
      };
      if (escape in simple) {
        value += simple[escape];
        index += 1;
        continue;
      }
      if (escape !== 'u') return value;
      const hex = source.slice(index + 2, index + 6);
      if (!/^[a-f0-9]{4}$/iu.test(hex)) return value;
      const first = Number.parseInt(hex, 16);
      if (first >= 0xd800 && first <= 0xdbff) {
        const secondEscape = source.slice(index + 6, index + 8);
        const secondHex = source.slice(index + 8, index + 12);
        if (secondEscape !== '\\u' || !/^[a-f0-9]{4}$/iu.test(secondHex)) return value;
        const second = Number.parseInt(secondHex, 16);
        if (second < 0xdc00 || second > 0xdfff) return value;
        value += String.fromCodePoint(0x10000 + ((first - 0xd800) << 10) + second - 0xdc00);
        index += 11;
      } else {
        value += String.fromCharCode(first);
        index += 5;
      }
      continue;
    }
    const code = char.charCodeAt(0);
    if (code < 0x20) return value;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = source.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return value;
      value += char + source[index + 1];
      index += 1;
      continue;
    }
    value += char;
  }
  return value;
}
