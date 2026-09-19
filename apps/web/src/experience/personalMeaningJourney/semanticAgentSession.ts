import { previewStorage } from '../services/previewStorage';
/**
 * Local persistence for the active clarification thread.
 *
 * A thread is conversation state, not a domain fact: the transcript only
 * becomes authoritative when the learner confirms, at which point the gateway
 * records it as Sense Construction turns. Losing this store therefore loses a
 * draft conversation, never a confirmed Focus, Sense or Binding.
 */

import { emptyWorkingSet, type SemanticAgentSession } from './semanticAgent';

const KEY = 'sensa_semantic_agent_sessions_v2';

type SessionMap = Record<string, SemanticAgentSession>;

const readAll = (): SessionMap => {
  if (typeof window === 'undefined') return {};
  const raw = previewStorage.getItem(KEY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as SessionMap)
      : {};
  } catch {
    return {};
  }
};

export const newSemanticAgentSession = (
  personalMeaningId: string,
  threadId: string,
): SemanticAgentSession => ({
  personalMeaningId,
  threadId,
  languageContext:null,
  messages: [],
  workingSet: emptyWorkingSet(),
  learnerEditedTracks: [],
  focusLocked: false,
  readyToConfirm: false,
  provenance: null,
  steps: [],
  outcome: null,
});

export const loadSemanticAgentSession = (
  personalMeaningId: string,
  newThreadId: () => string,
): SemanticAgentSession => {
  const found = readAll()[personalMeaningId];
  if (!found) return newSemanticAgentSession(personalMeaningId, newThreadId());
  return found;
};

export const saveSemanticAgentSession = (session: SemanticAgentSession): void => {
  if (typeof window === 'undefined') return;
  const sessions = readAll();
  sessions[session.personalMeaningId] = session;
  try {
    previewStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    // A full store must not take down an in-flight conversation; the thread
    // keeps running in memory and simply will not survive a reload.
  }
};
