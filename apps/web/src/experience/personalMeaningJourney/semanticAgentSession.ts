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

const LEGACY_KEY = 'sensa_semantic_agent_sessions_v2';
const SESSION_KEY_PREFIX = 'sensa_semantic_agent_session_v3:';
const SESSION_LOCK_PREFIX = 'sensa-semantic-agent-session:';
const TAB_FALLBACK_KEY = 'sensa:web-ui:v1:sensa_semantic_agent_sessions_tab_fallback_v2';
const LEGACY_TAB_FALLBACK_KEY = 'sensa:web-ui:v1:sensa_semantic_agent_sessions_tab_fallback_v1';

type SessionMap = Record<string, SemanticAgentSession>;
export type SemanticAgentSessionPersistenceIssue = 'storage' | 'conflict';

interface StoredSessionEnvelope {
  schemaVersion: 1;
  revision: string;
  session: SemanticAgentSession;
}

interface TabFallbackEntry {
  session: SemanticAgentSession;
  issue: SemanticAgentSessionPersistenceIssue;
  expectedRevision: string | null;
}

type TabFallbackMap = Record<string, TabFallbackEntry>;

type DurableRead =
  | Readonly<{ok: true; session: SemanticAgentSession | null; revision: string | null}>
  | Readonly<{ok: false; cause: unknown}>;

export type SemanticAgentSessionPersistence = 'saved' | 'tab-only' | 'conflict' | 'new';

export interface LoadedSemanticAgentSession {
  session: SemanticAgentSession;
  persistence: SemanticAgentSessionPersistence;
}

export type SemanticAgentSessionSaveResult =
  | Readonly<{saved: true}>
  | Readonly<{saved: false; reason: 'storage'; cause: unknown}>
  | Readonly<{saved: false; reason: 'conflict'}>;

const volatileSessions = new Map<string, TabFallbackEntry>();
const expectedRevisions = new Map<string, string | null>();

const sessionKey = (personalMeaningId: string): string => (
  `${SESSION_KEY_PREFIX}${personalMeaningId}`
);

const isSession = (value: unknown): value is SemanticAgentSession => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && typeof (value as {personalMeaningId?: unknown}).personalMeaningId === 'string'
  && typeof (value as {threadId?: unknown}).threadId === 'string',
);

const hashText = (text: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const legacyRevision = (session: SemanticAgentSession): string => (
  `legacy-v2:${hashText(JSON.stringify(session))}`
);

const readLegacyAll = (): Readonly<{ok: true; sessions: SessionMap}> | Readonly<{ok: false; cause: unknown}> => {
  if (typeof window === 'undefined') return {ok: true, sessions: {}};
  try {
    const raw = previewStorage.getItem(LEGACY_KEY);
    if (!raw) return {ok: true, sessions: {}};
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid legacy semantic session store.');
    }
    return {ok: true, sessions: value as SessionMap};
  } catch (cause) {
    return {ok: false, cause};
  }
};

const readDurableSession = (personalMeaningId: string): DurableRead => {
  if (typeof window === 'undefined') return {ok: true, session: null, revision: null};
  try {
    const raw = previewStorage.getItem(sessionKey(personalMeaningId));
    if (raw) {
      const value = JSON.parse(raw) as Partial<StoredSessionEnvelope>;
      if (
        value.schemaVersion !== 1
        || typeof value.revision !== 'string'
        || !isSession(value.session)
        || value.session.personalMeaningId !== personalMeaningId
      ) {
        throw new Error('Invalid semantic session record.');
      }
      return {ok: true, session: value.session, revision: value.revision};
    }
    const legacy = readLegacyAll();
    if (!legacy.ok) return legacy;
    const session = legacy.sessions[personalMeaningId];
    if (!session) return {ok: true, session: null, revision: null};
    if (!isSession(session) || session.personalMeaningId !== personalMeaningId) {
      throw new Error('Invalid legacy semantic session record.');
    }
    return {ok: true, session, revision: legacyRevision(session)};
  } catch (cause) {
    return {ok: false, cause};
  }
};

const normalizeFallback = (
  personalMeaningId: string,
  value: unknown,
): TabFallbackEntry | null => {
  if (isSession(value) && value.personalMeaningId === personalMeaningId) {
    return {session: value, issue: 'storage', expectedRevision: null};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<TabFallbackEntry>;
  if (
    !isSession(candidate.session)
    || candidate.session.personalMeaningId !== personalMeaningId
    || (candidate.issue !== 'storage' && candidate.issue !== 'conflict')
    || (candidate.expectedRevision !== null && typeof candidate.expectedRevision !== 'string')
  ) return null;
  return candidate as TabFallbackEntry;
};

const readTabFallbackKey = (key: string): TabFallbackMap => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return {};
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: TabFallbackMap = {};
    for (const [personalMeaningId, entry] of Object.entries(value)) {
      const normalized = normalizeFallback(personalMeaningId, entry);
      if (normalized) result[personalMeaningId] = normalized;
    }
    return result;
  } catch {
    return {};
  }
};

const readTabFallbacks = (): TabFallbackMap => ({
  ...readTabFallbackKey(LEGACY_TAB_FALLBACK_KEY),
  ...readTabFallbackKey(TAB_FALLBACK_KEY),
});

const saveTabFallback = (entry: TabFallbackEntry): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(TAB_FALLBACK_KEY, JSON.stringify({
      ...readTabFallbacks(),
      [entry.session.personalMeaningId]: entry,
    }));
  } catch {
    // The live module cache still protects the current screen. If both browser
    // stores reject writes, the visible warning must remain until this tab is closed.
  }
};

const removeTabFallback = (personalMeaningId: string): void => {
  if (typeof window === 'undefined') return;
  for (const key of [LEGACY_TAB_FALLBACK_KEY, TAB_FALLBACK_KEY]) {
    try {
      const sessions = readTabFallbackKey(key);
      if (!sessions[personalMeaningId]) continue;
      delete sessions[personalMeaningId];
      if (Object.keys(sessions).length === 0) {
        window.sessionStorage.removeItem(key);
      } else {
        window.sessionStorage.setItem(key, JSON.stringify(sessions));
      }
    } catch {
      // A stale fallback is reconciled against the durable value on the next load.
    }
  }
};

const persistenceForIssue = (
  issue: SemanticAgentSessionPersistenceIssue,
): SemanticAgentSessionPersistence => issue === 'conflict' ? 'conflict' : 'tab-only';

const withSessionWriteLock = async <T>(
  personalMeaningId: string,
  task: () => Promise<T> | T,
): Promise<T> => {
  if (typeof navigator === 'undefined' || !navigator.locks) return task();
  return navigator.locks.request(
    `${SESSION_LOCK_PREFIX}${personalMeaningId}`,
    {mode: 'exclusive'},
    () => task(),
  );
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
): LoadedSemanticAgentSession => {
  const volatile = volatileSessions.get(personalMeaningId);
  if (volatile) {
    expectedRevisions.set(personalMeaningId, volatile.expectedRevision);
    return {
      session: structuredClone(volatile.session),
      persistence: persistenceForIssue(volatile.issue),
    };
  }

  const fallback = readTabFallbacks()[personalMeaningId];
  const durable = readDurableSession(personalMeaningId);
  if (fallback) {
    if (durable.ok && durable.session
      && JSON.stringify(durable.session) === JSON.stringify(fallback.session)) {
      expectedRevisions.set(personalMeaningId, durable.revision);
      removeTabFallback(personalMeaningId);
      return {session: durable.session, persistence: 'saved'};
    }
    const expectedRevision = fallback.expectedRevision ?? (durable.ok ? durable.revision : null);
    const issue = durable.ok
      && fallback.issue === 'storage'
      && durable.revision !== expectedRevision
      ? 'conflict'
      : fallback.issue;
    const entry = {...fallback, expectedRevision, issue};
    volatileSessions.set(personalMeaningId, structuredClone(entry));
    expectedRevisions.set(personalMeaningId, expectedRevision);
    return {session: fallback.session, persistence: persistenceForIssue(issue)};
  }
  if (!durable.ok) {
    const session = newSemanticAgentSession(personalMeaningId, newThreadId());
    const entry: TabFallbackEntry = {session, issue: 'storage', expectedRevision: null};
    volatileSessions.set(personalMeaningId, structuredClone(entry));
    expectedRevisions.set(personalMeaningId, null);
    return {session, persistence: 'tab-only'};
  }
  expectedRevisions.set(personalMeaningId, durable.revision);
  if (durable.session) return {session: durable.session, persistence: 'saved'};
  return {
    session: newSemanticAgentSession(personalMeaningId, newThreadId()),
    persistence: 'new',
  };
};

export const loadLatestSemanticAgentSession = (
  personalMeaningId: string,
  newThreadId: () => string,
): LoadedSemanticAgentSession => {
  volatileSessions.delete(personalMeaningId);
  removeTabFallback(personalMeaningId);
  const durable = readDurableSession(personalMeaningId);
  if (!durable.ok) {
    const session = newSemanticAgentSession(personalMeaningId, newThreadId());
    const entry: TabFallbackEntry = {session, issue: 'storage', expectedRevision: null};
    volatileSessions.set(personalMeaningId, structuredClone(entry));
    expectedRevisions.set(personalMeaningId, null);
    return {session, persistence: 'tab-only'};
  }
  expectedRevisions.set(personalMeaningId, durable.revision);
  if (durable.session) return {session: durable.session, persistence: 'saved'};
  return {
    session: newSemanticAgentSession(personalMeaningId, newThreadId()),
    persistence: 'new',
  };
};

export const saveSemanticAgentSession = async (
  session: SemanticAgentSession,
): Promise<SemanticAgentSessionSaveResult> => {
  if (typeof window === 'undefined') return {saved: true};
  const personalMeaningId = session.personalMeaningId;
  return withSessionWriteLock<SemanticAgentSessionSaveResult>(personalMeaningId, () => {
    // Resolve the expected revision only after this tab owns the write lock.
    // That serializes rapid saves from one tab without hiding a revision written
    // by another tab while this tab was idle.
    const expectedRevision = expectedRevisions.get(personalMeaningId) ?? null;
    const pending: TabFallbackEntry = {
      session: structuredClone(session),
      issue: 'storage',
      expectedRevision,
    };
    volatileSessions.set(personalMeaningId, pending);
    const current = readDurableSession(personalMeaningId);
    if (!current.ok) {
      saveTabFallback(pending);
      return {saved: false, reason: 'storage', cause: current.cause};
    }
    if (current.revision !== expectedRevision) {
      const conflict: TabFallbackEntry = {...pending, issue: 'conflict'};
      volatileSessions.set(personalMeaningId, conflict);
      saveTabFallback(conflict);
      return {saved: false, reason: 'conflict'};
    }

    const revision = crypto.randomUUID();
    const envelope: StoredSessionEnvelope = {
      schemaVersion: 1,
      revision,
      session,
    };
    try {
      previewStorage.setItem(sessionKey(personalMeaningId), JSON.stringify(envelope));
      const verified = readDurableSession(personalMeaningId);
      if (!verified.ok) throw verified.cause;
      if (verified.revision !== revision) {
        const conflict: TabFallbackEntry = {...pending, issue: 'conflict'};
        volatileSessions.set(personalMeaningId, conflict);
        saveTabFallback(conflict);
        return {saved: false, reason: 'conflict'};
      }
      expectedRevisions.set(personalMeaningId, revision);
      volatileSessions.delete(personalMeaningId);
      removeTabFallback(personalMeaningId);
      return {saved: true};
    } catch (cause) {
      saveTabFallback(pending);
      return {saved: false, reason: 'storage', cause};
    }
  });
};
