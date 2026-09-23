/** Private, synthetic-only review packet derived from one business Trace. */
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const parseArguments = (value: unknown): Record<string, unknown> => {
  try { return object(JSON.parse(typeof value === 'string' ? value : 'null')); } catch { return {}; }
};

export function extractBusinessLanguageEvidence(caseKey: string, targetLanguageTag: string, supportLanguageTag: string,
  events: readonly {agent?: string; kind?: string; stage?: string; payload?: unknown}[]) {
  const clarification: {replies: string[]; organizedAnswers: Record<string, unknown>[]; finalCandidate: Record<string, unknown> | null} = {
    replies: [], organizedAnswers: [], finalCandidate: null,
  };
  const contentGeneration: {submittedResources: unknown[]; finalResources: unknown[]} = {submittedResources: [], finalResources: []};
  let dictionary: {entry: unknown; referenceResult: unknown} | null = null;
  const speechRequests: Record<string, unknown>[] = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const payload = object(event.payload);
    if (event.agent === 'clarification' && event.kind === 'tool_response' && object(payload.output).ok === true) {
      const args = parseArguments(payload.arguments);
      if (payload.name === 'reply_to_learner' && typeof args.text === 'string') clarification.replies.push(args.text);
      if (payload.name === 'organize_answer') clarification.organizedAnswers.push(args);
    }
    if (event.agent === 'clarification' && event.kind === 'agent_result') {
      const workingSet = object(payload.workingSet);
      if (typeof payload.assistantMessage === 'string' && !clarification.replies.includes(payload.assistantMessage)) {
        clarification.replies.push(payload.assistantMessage);
      }
      clarification.finalCandidate = {
        context: object(workingSet.context).summary ?? null,
        sense: object(workingSet.sense).coreMeaningFocus ?? null,
        expression: object(workingSet.expression).surfaceForm ?? null,
        expressionLanguageTag: object(workingSet.expression).languageTag ?? null,
        readyToConfirm: payload.readyToConfirm === true,
      };
    }
    if (event.agent === 'content_generation' && event.kind === 'tool_response' && payload.name === 'submit_resources') {
      const args = parseArguments(payload.arguments);
      if (Array.isArray(args.resources)) contentGeneration.submittedResources.push(...args.resources);
    }
    if (event.agent === 'content_generation' && event.kind === 'agent_result' && Array.isArray(payload.resources)) {
      contentGeneration.finalResources = payload.resources;
    }
    if (event.kind === 'business_result' && event.stage === 'dictionary_lookup') {
      dictionary = {entry: payload.entry ?? null, referenceResult: payload.referenceResult ?? null};
    }
    if (event.kind === 'speech_request') speechRequests.push(payload);
  }
  return {
    schemaVersion: 1, caseKey, targetLanguageTag, supportLanguageTag,
    clarification, contentGeneration, dictionary, speechRequests,
  };
}
