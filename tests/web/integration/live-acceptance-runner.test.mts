import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'vitest';

const run=(...args:string[])=>{
 const env={...process.env};delete env.SENSA_LIVE_ACCEPTANCE;
 return spawnSync(process.execPath,['scripts/live/runLanguageMatrix.mjs',...args],{encoding:'utf8',env,timeout:10_000});
};

test('interactive acceptance dry-run does not start automatic paid suites',()=>{
 const result=run('--interactive','--dry-run','--slot=7');
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/interactive isolated services; no automatic test suite/u);
 assert.match(result.stdout,/No services, models, or TTS were started/u);
});

test('interactive acceptance requires explicit live opt-in before starting services',()=>{
 const result=run('--interactive','--slot=7');
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Live paid services are disabled/u);
});

test('interactive acceptance cannot silently launch a matrix selector or preflight',()=>{
 for(const option of ['--preflight','--web-only','--extension-only','--case=en--zh-CN','--limit=1','--start=1']){
  const result=run('--interactive','--dry-run',option);
  assert.notEqual(result.status,0,option);
  assert.match(result.stderr,/interactive starts isolated services only/u);
 }
 assert.notEqual(run('--interactive','--dry-run','--slot=8').status,0);
});
