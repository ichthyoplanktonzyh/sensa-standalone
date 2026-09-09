/** No network, paid calls, owner data or production schema changes. */
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical, format, inspectFacts, retentionKey} from './models/personalLibraryFacts.js';
import type {Fact, Body} from './models/personalLibraryFacts.js';
const library = 'synthetic-library';
const target = {learnerId: 'learner', senseId: 'sense', bindingId: 'binding', scope: 'primary'};
function fact(id: string, body: Body, parents: string[] = [], deviceId = 'desktop'): Fact {
  return {format, libraryId: library, id, body, parents, deviceId, operationId: `operation-${id}`, occurredAt: '2026-09-09T00:00:00Z'};
}
const accepted = fact('accepted', {kind: 'meaning.accepted', meaningId: 'meaning', alignmentVersion: 'alignment-1'});
const left = fact('correct-left', {kind: 'meaning.corrected', meaningId: 'meaning', alignmentVersion: 'alignment-2', previous: accepted.id}, [accepted.id]);
const right = fact('correct-right', {kind: 'meaning.corrected', meaningId: 'meaning', alignmentVersion: 'alignment-3', previous: accepted.id}, [accepted.id], 'mobile');
const handoff = fact('handoff', {kind: 'scheduling.handoff', target});
const again = fact('review-desktop', {kind: 'review.completed', target, basis: handoff.id, runId: 'run-desktop', grade: 'again'}, [handoff.id]);
const good = fact('review-mobile', {kind: 'review.completed', target, basis: handoff.id, runId: 'run-mobile', grade: 'good'}, [handoff.id], 'mobile');
const all = [accepted, left, right, handoff, again, good];
const expected = inspectFacts(library, all);
assert.equal(expected.meanings[0]?.conflict, true);
assert.equal(expected.dueOpportunities.length, 1);
assert.equal(expected.dueOpportunities[0]?.status, 'requires_adjudication');
assert.deepEqual(expected.dueOpportunities[0]?.records, [again.id, good.id]);
function* permutations<T>(items: T[]): Generator<T[]> {
  if (!items.length) { yield []; return; }
  for (let i = 0; i < items.length; i++) {
    for (const rest of permutations(items.filter((_, j) => j !== i))) yield [items[i]!, ...rest];
  }
}
let orders = 0;
for (const order of permutations(all)) {
  assert.deepEqual(inspectFacts(library, order), expected);
  assert.deepEqual(inspectFacts(library, [...order, ...order]), expected);
  orders++;
}
const pending = inspectFacts(library, [left, good]);
assert.deepEqual(pending.pending, [left.id, good.id].sort());
assert.equal(pending.meanings.length, 0);
assert.equal(pending.dueOpportunities.length, 0);
assert.deepEqual(inspectFacts(library, [left, good, accepted, handoff]), inspectFacts(library, [accepted, handoff, good, left]));
const unknown = {...accepted, format: 'future-format'};
assert.deepEqual(inspectFacts(library, [unknown, left]).unknown, [accepted.id]);
assert.deepEqual(inspectFacts(library, [unknown, left]).pending, [left.id]);
const forged = {...accepted, body: {...accepted.body, alignmentVersion: 'different'}} as Fact;
for (const entries of [[accepted, forged, left], [left, forged, accepted]]) {
  const result = inspectFacts(library, entries);
  assert.deepEqual(result.collisions, [accepted.id]);
  assert.deepEqual(result.pending, [left.id]);
  assert.equal(result.meanings.length, 0);
}
const foreign = {...accepted, libraryId: 'another-library'};
assert.deepEqual(inspectFacts(library, [foreign, left]).records, [left.id]);
assert.deepEqual(inspectFacts(library, [foreign]).rejectedLibraries, ['another-library']);
const removal = fact('removed', {kind: 'meaning.removed', meaningId: 'meaning'}, [accepted.id]);
assert.equal(inspectFacts(library, [accepted, removal, left]).meanings[0]?.removed, true);
const restore = fact('restored', {kind: 'meaning.restored', meaningId: 'meaning', removal: removal.id}, [removal.id]);
assert.equal(inspectFacts(library, [accepted, removal, left, restore]).meanings[0]?.removed, false);
const blindRestore = {...restore, parents: [accepted.id]};
assert.deepEqual(inspectFacts(library, [accepted, removal, blindRestore]).invalid, [restore.id]);
const secondRemoval = fact('removed-mobile', {kind: 'meaning.removed', meaningId: 'meaning'}, [accepted.id], 'mobile');
assert.equal(inspectFacts(library, [accepted, removal, restore, secondRemoval]).meanings[0]?.removed, true);
const resolvedAlignment = fact('resolved', {kind: 'meaning.corrected', meaningId: 'meaning', alignmentVersion: 'alignment-resolved', previous: left.id}, [left.id, right.id]);
const resolved = inspectFacts(library, [...all, resolvedAlignment]);
assert.deepEqual(resolved.meanings[0]?.alignmentHeads, [resolvedAlignment.id]);
assert.equal(resolved.meanings[0]?.conflict, false);
assert.equal(resolved.records.length, 7); // No prior acceptance or learning record erased.
const clockSkew = all.map(f => ({...f, occurredAt: f.deviceId === 'mobile' ? '2099-01-01T00:00:00Z' : '2001-01-01T00:00:00Z'}));
assert.deepEqual(inspectFacts(library, clockSkew), expected);
assert.equal(retentionKey(target), retentionKey({...target}));
assert.notEqual(retentionKey(target), retentionKey({...target, bindingId: 'another-expression-binding'}));
assert.notEqual(retentionKey(target), retentionKey({...target, scope: 'explicit-independent-scope'}));
const wrongTarget = {...good, body: {...good.body, target: {...target, senseId: 'wrong-sense'}}} as Fact;
assert.deepEqual(inspectFacts(library, [handoff, wrongTarget]).invalid, [good.id]);
const cycleA = {...accepted, parents: [left.id]};
assert.deepEqual(inspectFacts(library, [cycleA, left]).pending, [accepted.id, left.id].sort());
// Persist separate model replicas, reopen, exchange partial batches, and reopen again.
// These are reference-model JSON records, not native SQLite or production browser replicas.
const root = await mkdtemp(join(tmpdir(), 'sensa-fact-model-'));
async function save(name: string, facts: Fact[]) {
  const path = join(root, name);
  await writeFile(`${path}.tmp`, canonical(facts));
  await rename(`${path}.tmp`, path);
}
async function reopen(name: string): Promise<Fact[]> { return JSON.parse(await readFile(join(root, name), 'utf8')); }
try {
  await save('desktop.json', [accepted, handoff, left, again]);
  await save('mobile.json', [accepted, handoff, right, good]);
  const desktop = await reopen('desktop.json'), mobile = await reopen('mobile.json');
  await save('desktop.json', [...desktop, good]); // Interrupted exchange: missing right alignment.
  assert.equal(inspectFacts(library, await reopen('desktop.json')).dueOpportunities[0]?.status, 'requires_adjudication');
  await save('desktop.json', [...await reopen('desktop.json'), ...mobile]);
  await save('mobile.json', [...mobile, ...desktop]);
  assert.deepEqual(inspectFacts(library, await reopen('desktop.json')), expected);
  assert.deepEqual(inspectFacts(library, await reopen('mobile.json')), expected);
} finally { await rm(root, {recursive: true, force: true}); }
console.log(`PASS: ${orders} delivery permutations and duplicate replays; causal gaps/recovery, unknown formats, identity collisions, cross-library isolation, semantic conflicts, remove/restore, due contention, clock skew and persisted model replicas.`);
console.log('LIMIT: design model only; no production import, FSRS adjudication, cryptography, SQLite/browser integration or cross-language parity claimed.');
