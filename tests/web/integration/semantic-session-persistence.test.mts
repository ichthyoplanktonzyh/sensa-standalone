import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {afterEach, test, vi} from 'vitest';

class FixtureStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('fixture quota full', 'QuotaExceededError');
    this.values.set(key, value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('a rejected durable session write remains visible in this tab and truthful after reload', async () => {
  const localStorage = new FixtureStorage();
  const sessionStorage = new FixtureStorage();
  vi.stubGlobal('window', {localStorage, sessionStorage});

  const firstModule = await import(
    '../../../apps/web/src/experience/personalMeaningJourney/semanticAgentSession.ts'
  );
  const personalMeaningId = crypto.randomUUID();
  const session = firstModule.newSemanticAgentSession(personalMeaningId, crypto.randomUUID());
  session.messages = [{
    messageId: crypto.randomUUID(),
    role: 'learner',
    body: 'This input must remain visible.',
    occurredAt: new Date().toISOString(),
  }];

  localStorage.failWrites = true;
  const rejected = await firstModule.saveSemanticAgentSession(session);
  assert.equal(rejected.saved, false);
  assert.equal(rejected.saved ? null : rejected.reason, 'storage');
  assert.equal(
    firstModule.loadSemanticAgentSession(personalMeaningId, crypto.randomUUID).persistence,
    'tab-only',
  );
  assert.equal(sessionStorage.length, 1, 'a reload-safe tab fallback was not recorded');

  vi.resetModules();
  const reloadedModule = await import(
    '../../../apps/web/src/experience/personalMeaningJourney/semanticAgentSession.ts'
  );
  const afterReload = reloadedModule.loadSemanticAgentSession(personalMeaningId, crypto.randomUUID);
  assert.equal(afterReload.persistence, 'tab-only');
  assert.equal(afterReload.session.messages[0]?.body, 'This input must remain visible.');

  localStorage.failWrites = false;
  assert.equal((await reloadedModule.saveSemanticAgentSession(afterReload.session)).saved, true);
  assert.equal(sessionStorage.length, 0, 'successful retry did not remove the tab-only warning state');

  vi.resetModules();
  const finalModule = await import(
    '../../../apps/web/src/experience/personalMeaningJourney/semanticAgentSession.ts'
  );
  const durable = finalModule.loadSemanticAgentSession(personalMeaningId, crypto.randomUUID);
  assert.equal(durable.persistence, 'saved');
  assert.equal(durable.session.messages[0]?.body, 'This input must remain visible.');

  const screen = await readFile(
    'apps/web/src/experience/components/PersonalMeaningDetailScreen.tsx',
    'utf8',
  );
  assert(
    screen.includes("loaded.persistence === 'conflict'"),
    'the product screen does not expose a stale-tab session as conflicted',
  );
  assert(
    screen.includes("loaded.persistence === 'tab-only'"),
    'the product screen does not expose a restored tab-only session as unsaved',
  );
  assert(
    screen.includes('<SemanticAgentSessionPersistenceNotice'),
    'the product screen does not render the persistence warning and retry action',
  );
});

test('a stale tab keeps its input and cannot overwrite a newer session revision', async () => {
  const localStorage = new FixtureStorage();
  const sessionStorage = new FixtureStorage();
  vi.stubGlobal('window', {localStorage, sessionStorage});

  const firstTab = await import(
    '../../../apps/web/src/experience/personalMeaningJourney/semanticAgentSession.ts'
  );
  const personalMeaningId = crypto.randomUUID();
  const initial = firstTab.newSemanticAgentSession(personalMeaningId, crypto.randomUUID());
  initial.messages = [{
    messageId: crypto.randomUUID(),
    role: 'assistant',
    body: 'Initial shared state.',
    occurredAt: new Date().toISOString(),
  }];
  assert.equal((await firstTab.saveSemanticAgentSession(initial)).saved, true);
  const firstLoaded = firstTab.loadSemanticAgentSession(personalMeaningId, crypto.randomUUID);

  vi.resetModules();
  const secondTab = await import(
    '../../../apps/web/src/experience/personalMeaningJourney/semanticAgentSession.ts'
  );
  const secondLoaded = secondTab.loadSemanticAgentSession(personalMeaningId, crypto.randomUUID);
  assert.equal(secondLoaded.persistence, 'saved');

  firstLoaded.session.messages.push({
    messageId: crypto.randomUUID(),
    role: 'learner',
    body: 'Saved by the first tab.',
    occurredAt: new Date().toISOString(),
  });
  assert.equal((await firstTab.saveSemanticAgentSession(firstLoaded.session)).saved, true);

  secondLoaded.session.messages.push({
    messageId: crypto.randomUUID(),
    role: 'learner',
    body: 'Protected input from the stale tab.',
    occurredAt: new Date().toISOString(),
  });
  const conflict = await secondTab.saveSemanticAgentSession(secondLoaded.session);
  assert.deepEqual(conflict, {saved: false, reason: 'conflict'});
  const protectedLocal = secondTab.loadSemanticAgentSession(personalMeaningId, crypto.randomUUID);
  assert.equal(protectedLocal.persistence, 'conflict');
  assert(protectedLocal.session.messages.some(({body}) => body === 'Protected input from the stale tab.'));

  const latest = secondTab.loadLatestSemanticAgentSession(personalMeaningId, crypto.randomUUID);
  assert.equal(latest.persistence, 'saved');
  assert(latest.session.messages.some(({body}) => body === 'Saved by the first tab.'));
  assert(!latest.session.messages.some(({body}) => body === 'Protected input from the stale tab.'));
});

test('legacy durable sessions and tab fallbacks migrate without discarding draft content', async () => {
  const localStorage = new FixtureStorage();
  const sessionStorage = new FixtureStorage();
  vi.stubGlobal('window', {localStorage, sessionStorage});

  const module = await import(
    '../../../apps/web/src/experience/personalMeaningJourney/semanticAgentSession.ts'
  );
  const personalMeaningId = crypto.randomUUID();
  const legacy = module.newSemanticAgentSession(personalMeaningId, crypto.randomUUID());
  legacy.messages = [{
    messageId: crypto.randomUUID(),
    role: 'assistant',
    body: 'Legacy durable message.',
    occurredAt: new Date().toISOString(),
  }];
  localStorage.setItem(
    'sensa:web-ui:v1:sensa_semantic_agent_sessions_v2',
    JSON.stringify({[personalMeaningId]: legacy}),
  );
  const fallback = structuredClone(legacy);
  fallback.messages.push({
    messageId: crypto.randomUUID(),
    role: 'learner',
    body: 'Legacy tab-only input.',
    occurredAt: new Date().toISOString(),
  });
  sessionStorage.setItem(
    'sensa:web-ui:v1:sensa_semantic_agent_sessions_tab_fallback_v1',
    JSON.stringify({[personalMeaningId]: fallback}),
  );

  const loaded = module.loadSemanticAgentSession(personalMeaningId, crypto.randomUUID);
  assert.equal(loaded.persistence, 'tab-only');
  assert(loaded.session.messages.some(({body}) => body === 'Legacy tab-only input.'));
  assert.equal((await module.saveSemanticAgentSession(loaded.session)).saved, true);
  assert.equal(
    localStorage.getItem('sensa:web-ui:v1:sensa_semantic_agent_sessions_v2') !== null,
    true,
    'legacy durable data was destructively removed',
  );
  assert.equal(sessionStorage.length, 0, 'legacy tab fallback was not reconciled after migration');

  vi.resetModules();
  const reloadedModule = await import(
    '../../../apps/web/src/experience/personalMeaningJourney/semanticAgentSession.ts'
  );
  const migrated = reloadedModule.loadSemanticAgentSession(personalMeaningId, crypto.randomUUID);
  assert.equal(migrated.persistence, 'saved');
  assert(migrated.session.messages.some(({body}) => body === 'Legacy tab-only input.'));
});
