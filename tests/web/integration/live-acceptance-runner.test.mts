import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {test} from 'vitest';
import {waitForInteractiveServices} from '../../../scripts/live/interactiveServiceLifecycle.mjs';

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

const service=()=>Object.assign(new EventEmitter(),{exitCode:null as number|null,signalCode:null as string|null});

test('interactive intentional shutdown does not overwrite stopped with a failure or pass',async()=>{
 const api=service(),web=service();let stopping=false,settled=false;
 const pending=waitForInteractiveServices([['API',api],['Web',web]],()=>stopping);
 pending.then(()=>{settled=true;},()=>{settled=true;});
 stopping=true;
 api.emit('exit',null,'SIGTERM');web.emit('exit',null,'SIGTERM');
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(settled,false,'cleanup belongs to the signal handler; service exits must not produce a new acceptance terminal');
});

test('interactive unexpected exit remains a failure',async()=>{
 const api=service();
 const pending=waitForInteractiveServices([['API',api]],()=>false);
 api.emit('exit',null,'SIGTERM');
 await assert.rejects(pending,/Interactive API exited \(SIGTERM\); acceptance is not complete/u);
});

test('interactive service already exited before observation is not treated as ready',async()=>{
 const web=service();web.exitCode=1;
 await assert.rejects(waitForInteractiveServices([['Web',web]],()=>false),/Interactive Web exited \(1\); acceptance is not complete/u);
});
