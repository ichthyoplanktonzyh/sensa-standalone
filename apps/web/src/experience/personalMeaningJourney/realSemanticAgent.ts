/**
 * HTTP adapter for the clarification agent.
 *
 * Every field the model returns is validated here rather than trusted. A
 * malformed turn surfaces as a readable Chinese error the screen can retry,
 * never as a half-filled result panel that looks like the model understood.
 *
 * The turn arrives as an SSE stream: `delta` events feed the onDelta callback
 * so the screen can type the reply out live, and the final `result` event
 * goes through the same validation as the old one-shot response. A plain JSON
 * response (streaming unsupported on either hop) still works unchanged.
 */

import type {
  SensaExpressionBindingRelation,
  SensaExpressionType,
  SensaSemanticCoverage,
} from '@sensa/contracts/sensa';
import type {
  ProposalDraftNeighborContrast,
  ProposalDraftScene,
  SemanticLlmProvenance,
} from './semanticLlm';
import type {
  AgentExpressionCandidate,
  AgentFocusCandidate,
  AgentSenseCandidate,
  SemanticAgentDeltaHandler,
  SemanticAgentPort,
  SemanticAgentTurnResult,
} from './semanticAgent';

const ENDPOINT = '/api/prototype/semantic-agent/turn';

const EXPRESSION_TYPES = new Set<SensaExpressionType>([
  'word', 'phrase', 'construction', 'sentence', 'utterance_strategy',
]);
const RELATIONS = new Set<SensaExpressionBindingRelation>([
  'realizes', 'approximates', 'evokes',
]);
const COVERAGES = new Set<SensaSemanticCoverage>([
  'exact', 'broader', 'narrower', 'overlapping',
]);

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown, label: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`模型返回的${label}格式不正确。`);
  }
  return value as JsonObject;
};

const asString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`模型返回的${label}为空。`);
  return value.trim();
};

const asOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const asStrings = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) throw new Error(`模型返回的${label}不是列表。`);
  return value.map((item, index) => asString(item, `${label} ${index + 1}`));
};

/**
 * A candidate the model filled with blank strings is no candidate. Treating it
 * as absent keeps an empty track honest instead of failing the whole turn.
 */
const blank = (value: unknown, ...keys: string[]): boolean => {
  const candidate = value as JsonObject;
  return keys.every((key) => typeof candidate[key] !== 'string' || !candidate[key].trim());
};

const asObjects = (value: unknown, label: string): JsonObject[] => {
  if (!Array.isArray(value)) throw new Error(`模型返回的${label}不是列表。`);
  return value.map((item, index) => asObject(item, `${label} ${index + 1}`));
};

const parseScene = (value: JsonObject, index: number): ProposalDraftScene => ({
  summary: asString(value.summary, `第 ${index + 1} 个原型场景`),
  participantRoles: asStrings(value.participantRoles, '参与者角色'),
  states: asStrings(value.states, '关键状态'),
  directionOrCausality: asOptionalString(value.directionOrCausality),
});

const parseContrast = (value: JsonObject): ProposalDraftNeighborContrast => ({
  label: asString(value.label, '相邻意思'),
  distinction: asString(value.distinction, '意思区别'),
});

const parseFocus = (value: unknown): AgentFocusCandidate | null => {
  if (value === null || value === undefined) return null;
  const focus = asObject(value, '表达侧面');
  if (blank(focus, 'statement')) return null;
  return {
    statement: asString(focus.statement, '表达侧面'),
    distinguishingNotes: asStrings(focus.distinguishingNotes, '侧面区分说明'),
    aspectLabel: asString(focus.aspectLabel, '侧面标签'),
    rationale: asString(focus.rationale, '侧面理由'),
  };
};

const parseSense = (value: unknown): AgentSenseCandidate | null => {
  if (value === null || value === undefined) return null;
  const sense = asObject(value, '稳定意思');
  if (blank(sense, 'coreMeaningFocus')) return null;
  if (!Array.isArray(sense.prototypeScenes) || sense.prototypeScenes.length === 0) return null;
  return {
    proposedSenseKey: asString(sense.proposedSenseKey, '语义键'),
    coreMeaningFocus: asString(sense.coreMeaningFocus, '稳定意思'),
    prototypeScenes: asObjects(sense.prototypeScenes, '原型场景').map(parseScene),
    includedCases: asStrings(sense.includedCases, '包含情况'),
    excludedCases: asStrings(sense.excludedCases, '排除情况'),
    neighborContrasts: asObjects(sense.neighborContrasts, '相邻意思').map(parseContrast),
    openQuestions: asStrings(sense.openQuestions, '开放问题'),
    unresolvedQuestions: asStrings(sense.unresolvedQuestions, '未决问题'),
    rationale: asString(sense.rationale, '意思理由'),
  };
};

const parseExpression = (value: unknown): AgentExpressionCandidate | null => {
  if (value === null || value === undefined) return null;
  const expression = asObject(value, '目标表达');
  if (blank(expression, 'surfaceForm')) return null;
  const expressionType = asString(expression.expressionType, '表达类型') as SensaExpressionType;
  if (!EXPRESSION_TYPES.has(expressionType)) throw new Error('模型返回了不支持的表达类型。');
  const relation = asString(expression.relation, '表达关系') as SensaExpressionBindingRelation;
  if (!RELATIONS.has(relation)) throw new Error('模型返回了不支持的表达关系。');
  const semanticCoverage = asString(expression.semanticCoverage, '语义覆盖') as SensaSemanticCoverage;
  if (!COVERAGES.has(semanticCoverage)) throw new Error('模型返回了不支持的语义覆盖范围。');
  return {
    surfaceForm: asString(expression.surfaceForm, '表达'),
    expressionType,
    languageTag: asString(expression.languageTag, '表达语言'),
    relation,
    semanticCoverage,
    rationale: asString(expression.rationale, '表达说明'),
  };
};

const parseEnvelope = (body: string, status: number): JsonObject => {
  if (!body.trim()) throw new Error(`AI 服务返回了空响应（${status}），请重试。`);
  try {
    return asObject(JSON.parse(body) as unknown, '服务响应');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('模型返回')) throw error;
    throw new Error(`AI 服务返回了无法解析的响应（${status}），请重试。`);
  }
};

const parseTurnResult = (envelope: JsonObject): SemanticAgentTurnResult => {
  const provenance = asObject(envelope.provenance, '来源') as unknown as SemanticLlmProvenance;
  const data = asObject(envelope.data, '对话结果');
  const workingSet = asObject(data.workingSet, '候选面板');
  const parsedExpressions: AgentExpressionCandidate[] = Array.isArray(workingSet.expressions)
    ? workingSet.expressions
        .map((item) => parseExpression(item))
        .filter((item): item is AgentExpressionCandidate => item !== null)
    : [];
  const singleExpression = parseExpression(workingSet.expression);
  if (singleExpression && !parsedExpressions.some((e) => e.surfaceForm === singleExpression.surfaceForm)) {
    parsedExpressions.unshift(singleExpression);
  }
  return {
    assistantMessage: asString(data.assistantMessage, '回复'),
    workingSet: {
      focus: parseFocus(workingSet.focus),
      sense: parseSense(workingSet.sense),
      expression: parsedExpressions[0] ?? singleExpression ?? null,
      expressions: parsedExpressions,
    },
    readyToConfirm: data.readyToConfirm === true,
    provenance,
  };
};

/** One frame of our SSE protocol → the parsed `data` object and its `event` name. */
const parseEventFrame = (frame: string): { event: string | null; data: JsonObject } => {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) throw new Error('AI 服务的流式响应损坏了，请重试。');
  try {
    return { event, data: asObject(JSON.parse(dataLines.join('\n')) as unknown, '流式响应') };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('模型返回')) throw error;
    throw new Error('AI 服务的流式响应损坏了，请重试。');
  }
};

/**
 * Read the SSE stream: every `delta` grows the live reply, `result` is the
 * authoritative turn, `error` throws. A stream that ends without `result`
 * means the connection dropped mid-turn.
 */
const readSseTurn = async (
  response: Response,
  onDelta?: SemanticAgentDeltaHandler,
): Promise<SemanticAgentTurnResult> => {
  if (!response.body) throw new Error('AI 服务没有返回流式响应，请重试。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: SemanticAgentTurnResult | null = null;

  const consume = (frame: string) => {
    const { event, data } = parseEventFrame(frame);
    if (event === 'delta') {
      if (typeof data.delta === 'string' && data.delta) onDelta?.(data.delta);
    } else if (event === 'result') {
      result = parseTurnResult(data);
    } else if (event === 'error') {
      throw new Error(typeof data.error === 'string' && data.error ? data.error : '语义模型暂时不可用。');
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary === -1) break;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        consume(frame);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } finally {
    if (!result) void reader.cancel().catch(() => undefined);
  }

  if (!result) throw new Error('AI 服务的连接中断了，请重试。');
  return result;
};

export const createRealSemanticAgent = (): SemanticAgentPort => ({
  async turn(input, onDelta): Promise<SemanticAgentTurnResult> {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        material: input.material,
        messages: input.messages.map((message) => ({
          role: message.role,
          content: message.body,
        })),
        workingSet: input.workingSet,
        learnerEditedTracks: input.learnerEditedTracks,
        focusLocked: input.focusLocked,
        mode: input.mode,
      }),
    });
    if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      return readSseTurn(response, onDelta);
    }
    const envelope = parseEnvelope(await response.text(), response.status);
    if (!response.ok) {
      throw new Error(typeof envelope.error === 'string' ? envelope.error : '语义模型暂时不可用。');
    }
    return parseTurnResult(envelope);
  },
});
