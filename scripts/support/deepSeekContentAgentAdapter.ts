import type {
  ContentAgentConversationMessage,
  ContentAgentModelAdapter,
  ContentAgentModelTurn,
} from "../../apps/web-next/src/learningRuntime/contentAgentProvisioning.js";

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown, label: string): JsonObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`DeepSeek ${label} is not an object.`);
  }
  return value as JsonObject;
};

const optionalTokenCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

const apiMessages = (messages: readonly ContentAgentConversationMessage[]): readonly JsonObject[] =>
  messages.map((message): JsonObject => {
    if (message.role === "system" || message.role === "user") {
      return { role: message.role, content: message.content };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        tool_call_id: message.toolCallId,
      };
    }
    return {
      role: "assistant",
      content: message.content,
      ...(message.reasoningContent === null
        ? {}
        : { reasoning_content: message.reasoningContent }),
      ...(message.toolCalls.length === 0
        ? {}
        : {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.toolCallId,
              type: "function",
              function: {
                name: call.toolKey,
                arguments: call.argumentsJson,
              },
            })),
          }),
    };
  });

const parseTurn = (payload: unknown): ContentAgentModelTurn => {
  const envelope = asObject(payload, "response");
  if (!Array.isArray(envelope.choices) || envelope.choices.length === 0) {
    throw new Error("DeepSeek response did not contain a completion choice.");
  }
  const choice = asObject(envelope.choices[0], "choice");
  const message = asObject(choice.message, "message");
  const rawToolCalls = message.tool_calls === undefined ? [] : message.tool_calls;
  if (!Array.isArray(rawToolCalls)) throw new Error("DeepSeek tool_calls is not an array.");
  const toolCalls = rawToolCalls.map((rawCall, index) => {
    const call = asObject(rawCall, `tool call ${index + 1}`);
    const fn = asObject(call.function, `tool call ${index + 1} function`);
    if (
      typeof call.id !== "string"
      || call.id.trim().length === 0
      || typeof fn.name !== "string"
      || fn.name.trim().length === 0
      || typeof fn.arguments !== "string"
    ) {
      throw new Error(`DeepSeek tool call ${index + 1} is malformed.`);
    }
    return Object.freeze({
      toolCallId: call.id,
      toolKey: fn.name,
      argumentsJson: fn.arguments,
    });
  });
  const usage = envelope.usage === undefined
    ? null
    : asObject(envelope.usage, "usage");
  return Object.freeze({
    content: typeof message.content === "string" ? message.content : null,
    reasoningContent: typeof message.reasoning_content === "string"
      ? message.reasoning_content
      : null,
    toolCalls: Object.freeze(toolCalls),
    inputTokens: optionalTokenCount(usage?.prompt_tokens),
    outputTokens: optionalTokenCount(usage?.completion_tokens),
  });
};

const upstreamError = (payload: unknown, status: number): string => {
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const envelope = payload as JsonObject;
    if (envelope.error !== null && typeof envelope.error === "object") {
      const error = envelope.error as JsonObject;
      if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
    }
  }
  return `DeepSeek request failed with HTTP ${status}.`;
};

/** Server-only Chat Completions adapter. The key never enters Agent messages or provenance. */
export const createDeepSeekContentAgentModelAdapter = (input: Readonly<{
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "high" | "max";
  thinking?: "enabled" | "disabled";
  fetchImpl?: typeof fetch;
}>): ContentAgentModelAdapter => {
  if (!input.apiKey.trim()) throw new Error("DEEPSEEK_API_KEY is required.");
  const baseUrl = (input.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/u, "");
  const model = input.model ?? "deepseek-v4-flash";
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxOutputTokens = input.maxOutputTokens ?? 4_096;
  const thinking = input.thinking ?? "enabled";
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("DeepSeek maxOutputTokens must be a positive integer.");
  }
  let provider = baseUrl;
  try {
    provider = new URL(baseUrl).host;
  } catch {
    throw new Error("DeepSeek baseUrl must be an absolute URL.");
  }
  return Object.freeze({
    provider,
    model,
    complete: async ({ messages, tools, signal }) => {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "sensa-content-agent-live-smoke/0.1",
        },
        body: JSON.stringify({
          model,
          messages: apiMessages(messages),
          tools: tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.toolKey,
              description: tool.description,
              parameters: tool.inputJsonSchema,
            },
          })),
          // DeepSeek thinking mode rejects `required`; the provisioning kernel
          // independently enforces required lookups and candidate submission.
          tool_choice: thinking === "enabled" ? "auto" : "required",
          thinking: { type: thinking },
          reasoning_effort: input.reasoningEffort ?? "high",
          max_tokens: maxOutputTokens,
          stream: false,
        }),
        signal,
      });
      const body = await response.text();
      let payload: unknown = null;
      if (body.trim()) {
        try {
          payload = JSON.parse(body) as unknown;
        } catch {
          if (!response.ok) throw new Error(`DeepSeek request failed with HTTP ${response.status}.`);
          throw new Error("DeepSeek returned a non-JSON response.");
        }
      }
      if (!response.ok) throw new Error(upstreamError(payload, response.status));
      return parseTurn(payload);
    },
  });
};
