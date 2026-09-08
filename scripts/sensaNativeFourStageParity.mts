import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { InterleavedFourStageQueue, InterleavedFourStageReviewQueue } from '../apps/web/src/experience/learningRuntime/interleavedFourStageProtocol.ts';
const cases: any[] = [], expected: any[] = [];
const capture = (run: () => any, view: () => any) => {
  try { run(); return { ok: view() }; } catch (e) { return { error: (e as Error).message, state: view() }; }
};
function add(c: any) {
  cases.push(c);
  try {
    if (c.mode === 'initial') {
      const q = new InterleavedFourStageQueue(c.ids, { minGap: c.minGap, protocolRunId: c.run });
      const view = () => JSON.parse(JSON.stringify({ projection: q.getProjection(), done: q.isDone() }));
      expected.push([{ ok: view() }, ...c.operations.map((op: any) => capture(() => {
        if (op.kind === 'next') q.next();
        else if (op.kind === 'feedback') q.completeFeedback();
        else q.settle(op.satisfied);
      }, view))]);
    } else {
      const q = new InterleavedFourStageReviewQueue(c.candidates);
      const view = () => JSON.parse(JSON.stringify({ current: q.getCurrentSession(), outcomes: Object.fromEntries(q.getMemoryOutcomes()), done: q.isDone() }));
      expected.push([{ ok: view() }, ...c.operations.map((op: any) => capture(() => {
        if (op.kind === 'next') q.next();
        else if (op.kind === 'feedback') q.completeFeedback();
        else q.settle(op.answer);
      }, view))]);
    }
  } catch (e) { expected.push({ error: (e as Error).message }); }
}
// Includes deterministic ties, scarce-cohort gap fallback, resets at every stage,
// pending feedback, duplicate actions, empty cohorts and encoded target identities.
for (const ids of [[], ['one'], ['a', 'b'], ['a', 'b', 'c', 'd'], ['中文 /?#', "!~*'()", '🙂'], ['x', 'x'], [' ']]) {
  for (const minGap of [0, 1, 2, 5]) {
    for (let seed = 0; seed < 6; seed++) {
      const operations: any[] = [{ kind: 'feedback' }, { kind: 'next' }];
      for (let i = 0; i < 26; i++) {
        operations.push({ kind: 'settle', satisfied: seed === 0 || i % (seed + 2) !== 1 });
        if (i % 5 === 0) operations.push({ kind: 'next' }, { kind: 'settle', satisfied: false });
        operations.push({ kind: 'feedback' });
      }
      add({ mode: 'initial', ids, run: 'run:/例', minGap, operations });
    }
  }
}
for (const candidates of [[], [{ targetId: 'a', mode: 'review' }], [{ targetId: 'a', mode: 'relearning' }], [{ targetId: 'a', mode: 'review' }, { targetId: 'b', mode: 'relearning' }], [{ targetId: 'a', mode: 'review' }, { targetId: 'a', mode: 'review' }]]) {
  for (let seed = 0; seed < 9; seed++) {
    const operations: any[] = [{ kind: 'feedback' }];
    for (let i = 0; i < 10; i++) {
      operations.push({ kind: 'review', answer: ['known', 'vague', 'forgotten'][(seed + i) % 3] });
      operations.push({ kind: 'next' }, { kind: 'review', answer: 'forgotten' }, { kind: 'feedback' });
    }
    add({ mode: 'review', candidates, operations });
  }
}
const run = (input: any[]) => {
  const result = spawnSync('cargo', ['run', '--quiet', '--locked', '-p', 'sensa-core', '--example', 'four_stage_runner'], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
};
const actual = run(cases); let steps = 0;
for (let i = 0; i < cases.length; i++) {
  assert.deepEqual(actual[i].trace ?? actual[i], expected[i], `Four-stage case ${i}`);
  steps += actual[i].trace?.length ?? 1;
}
// Separate runner process restores snapshots produced by the first process.
const saved = actual.flatMap((a: any, i: number) => a.snapshot ? [{ mode: cases[i].mode, snapshot: a.snapshot, operations: [] }] : []);
const restored = run(saved);
let cursor = 0;
for (const a of actual) if (a.snapshot) assert.deepEqual(restored[cursor++].snapshot, a.snapshot);
// A saved state cannot claim unearned progress or hide a pending feedback action.
const corruptions: any[] = [];
for (const c of saved.slice(0, 8)) {
  const value = JSON.parse(c.snapshot); value.formatVersion = 999;
  corruptions.push({ ...c, snapshot: JSON.stringify(value) });
}
for (const c of saved.filter((c: any) => JSON.parse(c.snapshot).targets?.length).slice(0, 8)) {
  const value = JSON.parse(c.snapshot); value.targets[0].attempts += 1;
  corruptions.push({ ...c, snapshot: JSON.stringify(value) });
}
for (const c of saved.filter((c: any) => c.mode === 'review').slice(0, 8)) {
  const value = JSON.parse(c.snapshot); value.ordinal += 1;
  corruptions.push({ ...c, snapshot: JSON.stringify(value) });
}
for (const result of run(corruptions)) assert.equal(typeof result.error, 'string');
console.log(`Native four-stage orchestration parity: ${cases.length} traces, ${steps} exact TS/Rust states; ${saved.length} cross-process restores and ${corruptions.length} corrupt snapshots rejected`);
