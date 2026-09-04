import assert from "node:assert/strict";

import type {
  ContentAgentConversationMessage,
} from "../apps/web-next/src/learningRuntime/contentAgentProvisioning.ts";
import { createDeepSeekContentAgentModelAdapter } from "./support/deepSeekContentAgentAdapter.ts";

const requests: Array<Record<string, unknown>> = [];
const responses = [
  {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        reasoning_content: "private reasoning to replay, not persist",
        tool_calls: [{
          id: "lookup-call",
          type: "function",
          function: {
            name: "lookup_reference",
            arguments: '{"factKinds":["usage_example"]}',
          },
        }],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  },
  {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        reasoning_content: "done",
        tool_calls: [{
          id: "submit-call",
          type: "function",
          function: {
            name: "submit_material_candidate_bundle",
            arguments: '{"candidates":[],"omissions":[]}',
          },
        }],
      },
    }],
    usage: { prompt_tokens: 20, completion_tokens: 8 },
  },
];

const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  assert.ok(init?.body);
  requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
  const response = responses.shift();
  assert.ok(response);
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

const adapter = createDeepSeekContentAgentModelAdapter({
  apiKey: "smoke-key-never-sent-to-network",
  model: "deepseek-v4-flash",
  fetchImpl: fakeFetch,
});
const tools = [{
  toolKey: "lookup_reference",
  toolVersion: "v1",
  description: "Lookup one fact.",
  inputSchemaId: "smoke.lookup-input",
  inputSchemaVersion: "v1",
  inputJsonSchema: {
    type: "object",
    properties: { factKinds: { type: "array", items: { type: "string" } } },
  },
  outputContextKinds: ["reference_fact"],
  outputMaterialRoleKeys: [],
  maxCalls: 1,
}];
const firstMessages: readonly ContentAgentConversationMessage[] = [
  { role: "system", content: "system" },
  { role: "user", content: "task" },
];
const main = async (): Promise<void> => {
  const first = await adapter.complete({
    messages: firstMessages,
    tools,
    signal: new AbortController().signal,
  });
  assert.equal(first.toolCalls[0]?.toolKey, "lookup_reference");
  assert.equal(first.reasoningContent, "private reasoning to replay, not persist");
  assert.equal(first.inputTokens, 10);

  const secondMessages: readonly ContentAgentConversationMessage[] = [
    ...firstMessages,
    {
      role: "assistant",
      content: first.content,
      reasoningContent: first.reasoningContent,
      toolCalls: first.toolCalls,
    },
    {
      role: "tool",
      content: '{"facts":[]}',
      toolCallId: "lookup-call",
      toolKey: "lookup_reference",
    },
  ];
  const second = await adapter.complete({
    messages: secondMessages,
    tools,
    signal: new AbortController().signal,
  });
  assert.equal(second.toolCalls[0]?.toolKey, "submit_material_candidate_bundle");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.model, "deepseek-v4-flash");
  assert.equal(requests[0]?.tool_choice, "auto");
  assert.deepEqual(requests[0]?.thinking, { type: "enabled" });
  const replayedMessages = requests[1]?.messages as Array<Record<string, unknown>>;
  assert.equal(replayedMessages[2]?.reasoning_content, first.reasoningContent);
  assert.equal(replayedMessages[3]?.tool_call_id, "lookup-call");

  console.log("deepseek content-agent adapter smoke OK");
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
