import {spawn, spawnSync} from 'node:child_process';
import {mkdtemp, open, readdir, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {catalog} from './acceptance/catalog.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const [mode = 'list', ...ids] = process.argv.slice(2);
const usage = 'Usage: node scripts/sensaAcceptance.mjs list | check | plan <id...> | run <id...>';

async function check() {
  const seen = new Set();
  const sources = new Set();
  for (const item of catalog) {
    if (!/^[a-z][a-z0-9-]*$/.test(item.id) || seen.has(item.id)) throw Error(`Invalid/duplicate ID: ${item.id}`);
    seen.add(item.id);
    for (const field of ['title', 'layer', 'real', 'fixtures', 'excludes']) {
      if (!item[field]?.trim()) throw Error(`${item.id}: missing ${field}`);
    }
    if (!item.sources.length || (!item.commands.length && !item.handoff)) throw Error(`${item.id}: missing execution reference`);
    for (const path of [...item.sources, ...(item.handoff ? [item.handoff] : [])]) {
      if (!(await stat(resolve(root, path))).isFile()) throw Error(`Missing source: ${path}`);
    }
    for (const path of item.sources) sources.add(path);
  }
  for (const file of await readdir(join(root, 'apps/sensa_native/integration_test'))) {
    if (file.endsWith('_test.dart') && !sources.has(`apps/sensa_native/integration_test/${file}`)) {
      throw Error(`Native test needs an evidence boundary: ${file}`);
    }
  }
}

function describe(item) {
  console.log(`\n${item.id} · ${item.title} [${item.layer}]`);
  console.log(`真实：${item.real}\n替身/前置：${item.fixtures}\n不证明：${item.excludes}`);
  for (const path of item.sources) console.log(`入口：${path}`);
  if (item.handoff) console.log(`准备与历史证据：${item.handoff}`);
  if (!item.commands.length) console.log('执行：按上述 handoff 选择设备、fixture 与变体；本入口不自动启动原生测试。');
  for (const command of item.commands) console.log(`命令：${command.join(' ')}`);
}

async function main() {
  if (!['list', 'check', 'plan', 'run'].includes(mode)) throw Error(usage);
  await check();
  if (mode === 'check' || mode === 'list') {
    if (ids.length) throw Error(usage);
    if (mode === 'list') for (const item of catalog) console.log(`${item.id.padEnd(25)} ${item.layer.padEnd(18)} ${item.title}`);
    else console.log(`PASS: ${catalog.length} evidence groups, source links and native test inventory checked. No product tests executed.`);
    return;
  }
  if (!ids.length || new Set(ids).size !== ids.length) throw Error(usage);
  const selected = ids.map((id) => {
    const item = catalog.find((candidate) => candidate.id === id);
    if (!item) throw Error(`Unknown acceptance ID: ${id}`);
    return item;
  });
  selected.forEach(describe);
  if (mode === 'plan') return;
  // Validate the whole selection before executing anything.
  const manual = selected.find((item) => !item.commands.length);
  if (manual) throw Error(`${manual.id} requires the device/fixture preparation in ${manual.handoff}; no commands executed.`);
  const directory = await mkdtemp(join(tmpdir(), 'sensa-acceptance-'));
  const git = (args) => {
    const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
    if (result.status !== 0) throw Error('Cannot record Git provenance');
    return result.stdout.trim();
  };
  const report = {schema: 'sensa-test-evidence-v1', revision: git(['rev-parse', 'HEAD']),
    dirtyFiles: git(['status', '--short']), platform: process.platform,
    requestedIds: ids, startedAt: new Date().toISOString(), status: 'running', cases: []};
  const save = () => writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), {mode: 0o600});
  console.log(`\nLogs and evidence: ${directory}`);
  await save();
  for (const item of selected) {
    const result = {id: item.id, real: item.real, fixtures: item.fixtures, excludes: item.excludes, status: 'running', steps: []};
    report.cases.push(result);
    await save();
    for (const [index, command] of item.commands.entries()) {
      const log = `${item.id}-${index + 1}.log`;
      const handle = await open(join(directory, log), 'wx', 0o600);
      const step = {command, log, startedAt: new Date().toISOString(), status: 'running'};
      result.steps.push(step);
      await save();
      console.log(`Running ${item.id} ${index + 1}/${item.commands.length} → ${log}`);
      try {
        const exit = await new Promise((resolveExit, reject) => {
          const processGroup = process.platform !== 'win32';
          const child = spawn(command[0] === 'node' ? process.execPath : command[0], command.slice(1), {
            cwd: root, shell: false, detached: processGroup, stdio: ['ignore', handle.fd, handle.fd],
          });
          let interrupted = false;
          const forward = (signal) => {
            interrupted = true;
            try {
              if (processGroup && child.pid) process.kill(-child.pid, signal);
              else child.kill(signal);
            } catch (error) {
              if (error.code !== 'ESRCH') console.error(`Cannot forward ${signal}: ${error.message}`);
            }
          };
          const interrupt = () => forward('SIGINT');
          const terminate = () => forward('SIGTERM');
          const cleanup = () => {
            process.off('SIGINT', interrupt);
            process.off('SIGTERM', terminate);
          };
          process.on('SIGINT', interrupt);
          process.on('SIGTERM', terminate);
          child.once('error', (error) => { cleanup(); reject(error); });
          child.once('exit', (code, signal) => { cleanup(); resolveExit({code, signal, interrupted}); });
        });
        Object.assign(step, exit, {status: exit.code === 0 && !exit.interrupted ? 'passed' : 'failed'});
      } catch (error) {
        Object.assign(step, {status: 'failed', error: error.message});
      } finally {
        await handle.close();
        step.finishedAt = new Date().toISOString();
      }
      if (step.status !== 'passed') {
        result.status = report.status = 'failed';
        report.finishedAt = new Date().toISOString();
        await save();
        throw Error(`Failed: ${item.id}; inspect ${join(directory, log)}. No automatic retry or remaining suite execution.`);
      }
      await save();
    }
    result.status = 'passed';
    await save();
    console.log(`PASS: ${item.id} (only the stated evidence boundary)`);
  }
  report.status = 'passed';
  report.finishedAt = new Date().toISOString();
  await save();
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
