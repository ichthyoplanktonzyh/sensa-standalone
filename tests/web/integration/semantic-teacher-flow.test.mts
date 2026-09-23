import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { SemanticAgentTurnInput } from '../../../apps/web/src/experience/personalMeaningJourney/semanticAgent.ts';

const fixture = vi.hoisted(() => ({
  responses: [] as unknown[],
  requests: [] as Array<{ messages: unknown[]; tools: unknown[] }>,
}));

vi.mock('../../../apps/web/src/data/library/providers.ts', () => ({
  selectedProvider: async () => ({ name: 'Fixture', model: 'fixture-teacher', kind: 'compatible' }),
}));
vi.mock('../../../apps/web/src/data/library/transport.ts', () => ({
  complete: async (_provider: unknown, _purpose: unknown, _id: unknown, messages: unknown[], tools: unknown[]) => {
    fixture.requests.push({ messages: structuredClone(messages), tools: structuredClone(tools) });
    const response = fixture.responses.shift();
    if (!response) throw new Error('fixture exhausted');
    return response;
  },
}));

import { createRealSemanticAgent } from '../../../apps/web/src/experience/personalMeaningJourney/realSemanticAgent.ts';

const toolCall = (name: string, args: unknown) => ({
  model: 'fixture-teacher',
  choices: [{ finish_reason: 'tool_calls', message: {
    content: null,
    tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  } }],
});
const input = (onAssistantText?: (text: string) => void): SemanticAgentTurnInput => ({
  material: { blocks: [{ blockId: crypto.randomUUID(), kind: 'text', bodyText: '我想表达给植物浇水。', mediaDataUrl: null, mediaMimeType: null }], familiarExpression: null, startingPoint: 'from_sense' },
  messages: [], workingSet: { context: null, focus: null, sense: null, expression: null, expressions: [] },
  readyToConfirm: false, learnerEditedTracks: [], focusLocked: false,
  languages: { targetLanguageTag: 'en', supportLanguageTag: 'zh-CN' },
  onAssistantText,
});
const answer = {
  context: '学习者想给植物浇水。', sense: '给植物供水的动作。', senseKey: 'give_plant_water',
  scene: '学习者给家里的植物浇水。', expression: 'water', expressionType: 'word',
  relation: 'realizes', coverage: 'exact', reason: 'water 可作动词表达这个动作。',
};

beforeEach(() => { fixture.responses.length = 0; fixture.requests.length = 0; });

test('the teacher can ask a natural question without staging or confirming a proposal', async () => {
  const visible: string[] = [];
  fixture.responses.push(toolCall('reply_to_learner', { text: '你说的是给植物浇水，还是把水倒掉？' }));
  const result = await createRealSemanticAgent().turn(input(text => visible.push(text)));
  assert.equal(result.assistantMessage, '你说的是给植物浇水，还是把水倒掉？');
  assert.equal(result.readyToConfirm, false);
  assert.equal(result.workingSet.sense, null);
  assert.deepEqual(visible, ['', result.assistantMessage]);
  assert.equal(fixture.requests.length, 1);
  assert.deepEqual((fixture.requests[0]!.tools as Array<{ function: { name: string } }>).map(item => item.function.name),
    ['organize_answer', 'reply_to_learner']);
});

test('the teacher stages a candidate, reads tool feedback, then replies for learner confirmation', async () => {
  const visible: string[] = [];
  fixture.responses.push(
    toolCall('organize_answer', answer),
    toolCall('reply_to_learner', { text: '这里可以用英语动词 water 表达给植物浇水。你看这个表达合适吗？' }),
  );
  const result = await createRealSemanticAgent().turn(input(text => visible.push(text)));
  assert.equal(result.readyToConfirm, true);
  assert.equal(result.workingSet.sense?.coreMeaningFocus, answer.sense);
  assert.equal(result.workingSet.expression?.surfaceForm, 'water');
  assert.deepEqual(visible, ['', result.assistantMessage]);
  assert.equal(fixture.requests.length, 2);
  const second = fixture.requests[1]!.messages as Array<{ role: string; content: string }>;
  assert.equal(second.at(-1)?.role, 'tool');
  assert.deepEqual(JSON.parse(second.at(-1)!.content), { ok: true, next: 'reply_to_learner' });
  assert.deepEqual(result.steps.map(step => step.tool), ['organize_answer', 'reply_to_learner']);
});

test('invalid tool output is returned to the same loop and never shown to the learner', async () => {
  const visible: string[] = [];
  fixture.responses.push(
    toolCall('organize_answer', { ...answer, expression: '' }),
    toolCall('organize_answer', answer),
    toolCall('reply_to_learner', { text: '可以说 water，意思是给植物浇水。' }),
  );
  const result = await createRealSemanticAgent().turn(input(text => visible.push(text)));
  assert.equal(result.readyToConfirm, true);
  assert.deepEqual(visible, ['', result.assistantMessage]);
  assert.equal(fixture.requests.length, 3);
  const second = fixture.requests[1]!.messages as Array<{ role: string; content: string }>;
  assert.deepEqual(JSON.parse(second.at(-1)!.content), { ok: false, error: 'invalid_tool_arguments' });
  assert.deepEqual(result.steps.map(step => step.status), ['failed', 'completed', 'completed']);
});

test('ordinary model text is not a learner reply', async () => {
  const visible: string[] = [];
  fixture.responses.push(
    { model: 'fixture-teacher', choices: [{ finish_reason: 'stop', message: { content: 'This text must stay private.' } }] },
    toolCall('reply_to_learner', { text: '你希望表达的是哪一种情况？' }),
  );
  const result = await createRealSemanticAgent().turn(input(text => visible.push(text)));
  assert.deepEqual(visible, ['', '你希望表达的是哪一种情况？']);
  assert.equal(result.readyToConfirm, false);
  const second = fixture.requests[1]!.messages as Array<{ role: string; content: string }>;
  assert.equal(second.at(-1)?.role, 'user');
  assert.match(second.at(-1)!.content, /Use exactly one/u);
});
