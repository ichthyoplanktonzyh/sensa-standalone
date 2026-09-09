// Subprocess-level checks of the runner's public failure/selection contract.
// Synthetic npm fails before any browser, Cargo, model or real package command runs.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const invoke = (args, env = process.env) => spawnSync(process.execPath,
  ['scripts/sensaAcceptance.mjs', ...args], {cwd, env, encoding: 'utf8'});
const plan = invoke(['plan', 'native-intake', 'popup']);
assert.equal(plan.status, 0, plan.stderr);
assert.match(plan.stdout, /PackFileReader/);
assert(!plan.stdout.includes('Logs and evidence:'));
for (const args of [['run', 'unknown'], ['run', 'popup', 'popup'], ['run', 'popup', 'native-vault']]) {
  const result = invoke(args);
  assert.equal(result.status, 1);
  assert(!result.stdout.includes('Logs and evidence:'), 'invalid selection must not run a partial suite');
}

if (process.platform === 'win32') {
  throw Error('Failure injection smoke uses a POSIX executable; run it on macOS/Linux. Not a Windows pass.');
}
const fixture = mkdtempSync(join(tmpdir(), 'sensa-runner-negative-'));
let directory;
try {
  writeFileSync(join(fixture, 'npm'), '#!/bin/sh\necho synthetic-build-failure\nexit 23\n', {mode: 0o700});
  const failure = invoke(['run', 'popup', 'reading'], {...process.env, PATH: `${fixture}:${process.env.PATH}`});
  assert.equal(failure.status, 1);
  directory = failure.stdout.match(/Logs and evidence: (.+)/)?.[1];
  assert(directory, failure.stderr);
  const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.requestedIds, ['popup', 'reading']);
  assert.equal(report.cases.length, 1);
  assert.equal(report.cases[0].status, 'failed');
  assert.equal(report.cases[0].steps.length, 1);
  assert.equal(report.cases[0].steps[0].code, 23);
  assert.match(report.revision, /^[a-f0-9]{40,64}$/);
  assert(report.cases[0].fixtures && report.cases[0].excludes);
  assert.match(readFileSync(join(directory, 'popup-1.log'), 'utf8'), /synthetic-build-failure/);
  assert.deepEqual(readdirSync(directory).sort(), ['popup-1.log', 'report.json']);
  console.log('PASS: plans are read-only; invalid/manual selections execute nothing; failure logs retain code and scope, stop before later steps/suites.');
} finally {
  rmSync(fixture, {recursive: true});
  if (directory) rmSync(directory, {recursive: true});
}
