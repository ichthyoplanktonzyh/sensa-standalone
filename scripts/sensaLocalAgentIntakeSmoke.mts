/** The installed local Agent adapter, from CLI enqueue through Web acknowledgement. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  sensaIntakePayloadSchema,
  sensaLocalAgentIntakeDeliverySchema,
  sensaLocalAgentIntakeReceiptSchema,
} from '@sensa/contracts/sensa';
import {
  detectLocalAgentEnvironment,
  localAgentSetupCommand,
} from '../apps/web/src/experience/account/localAgentSetup.ts';

const source = resolve('integrations/codex/sensa-intake/sensa-intake.mjs');
const temporary = mkdtempSync(join(tmpdir(), 'sensa-agent-intake-'));
const connectionDirectory = join(temporary, 'connection');
const manifestDirectory = join(temporary, 'native-hosts');
const skillDirectory = join(temporary, 'codex-skill');
const extensionId = 'a'.repeat(32);
const libraryId = '00000000-0000-4000-8000-000000000001';
const operationId = '00000000-0000-4000-8000-000000000003';

const jsonCall = (executable: string, args: string[], input?: unknown) => {
  const result = spawnSync(executable, args, {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: 'utf8',
  });
  const output = JSON.parse(result.stdout) as { value?: any; error?: string };
  return { ...result, output };
};

const nativeCall = (executable: string, input: unknown) => {
  const body = Buffer.from(JSON.stringify(input));
  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32LE(body.length);
  body.copy(frame, 4);
  const result = spawnSync(executable, [`chrome-extension://${extensionId}/`], { input: frame });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.ok(result.stdout.length >= 4, 'the native host answers with a framed value');
  const length = result.stdout.readUInt32LE();
  assert.equal(result.stdout.length, length + 4, 'the native answer has exactly one complete frame');
  return JSON.parse(result.stdout.subarray(4).toString('utf8')) as { value?: any; error?: string };
};

try {
  const setup = jsonCall(process.execPath, [
    source,
    '--setup',
    '--library-id', libraryId,
    '--label', 'Codex',
    '--directory', connectionDirectory,
    '--extension', extensionId,
    '--manifest-dir', manifestDirectory,
    '--codex-skill-source', resolve('integrations/codex/sensa-intake/SKILL.md'),
    '--codex-example-source', resolve('integrations/codex/sensa-intake/request-example.json'),
    '--codex-skill-dir', skillDirectory,
  ]);
  assert.equal(setup.status, 0, setup.stderr);
  assert.equal(setup.output.value.libraryId, libraryId);
  const configPath = setup.output.value.connection as string;
  const executable = join(connectionDirectory, 'sensa-intake.mjs');
  const manifest = JSON.parse(readFileSync(join(manifestDirectory, 'app.sensa.intake.json'), 'utf8'));
  assert.equal(manifest.path, executable);
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${extensionId}/`]);
  const installedSkill = readFileSync(join(skillDirectory, 'SKILL.md'), 'utf8');
  assert.ok(installedSkill.includes(JSON.stringify(executable)));
  assert.ok(installedSkill.includes(JSON.stringify(configPath)));
  assert.deepEqual(
    JSON.parse(readFileSync(join(skillDirectory, 'request-example.json'), 'utf8')),
    JSON.parse(readFileSync(resolve('integrations/codex/sensa-intake/request-example.json'), 'utf8')),
  );

  const repeatedSetup = jsonCall(process.execPath, [
    source,
    '--setup',
    '--library-id', libraryId,
    '--label', 'Codex',
    '--directory', connectionDirectory,
    '--extension', extensionId,
    '--manifest-dir', manifestDirectory,
    '--codex-skill-source', resolve('integrations/codex/sensa-intake/SKILL.md'),
    '--codex-example-source', resolve('integrations/codex/sensa-intake/request-example.json'),
    '--codex-skill-dir', skillDirectory,
  ]);
  assert.equal(repeatedSetup.status, 0, repeatedSetup.stderr);
  assert.equal(repeatedSetup.output.value.clientId, setup.output.value.clientId, 'setup retries preserve the Agent identity and queue');

  const hello = jsonCall(executable, ['--config', configPath], { kind: 'hello' });
  assert.equal(hello.status, 0, hello.stderr);
  assert.equal(hello.output.value.intakeContractVersion, 'sensa-intake-v3');
  assert.equal(hello.output.value.libraryId, libraryId);

  const intake = {
    contractVersion: 'sensa-intake-v3',
    operationId,
    capturedAt: '2026-09-14T08:00:00.000Z',
    context: {
      modality: 'text',
      textSegment: 'I backed out.',
      mediaReferenceIds: [],
      languageTag: 'en',
      source: {
        client: 'codex',
        url: null,
        title: 'GPT Live conversation',
        sourceReferenceId: 'conversation-1',
        domSelector: null,
        paragraphContext: null,
      },
    },
    expression: {
      surfaceForm: 'back out',
      languageTag: 'en',
      occurrence: {
        surfaceForm: 'backed out',
        locator: { kind: 'text_span', start: 2, end: 12 },
      },
      expressionTypeHint: 'phrase',
    },
    sense: {
      senseKey: null,
      semanticSpec: {
        schemaVersion: 'sensa-sense-semantic-spec-v1',
        coreMeaningFocus: '原本准备做某事，后来决定退出或取消',
        prototypeScenes: [{
          summary: 'I backed out.',
          participantRoles: [],
          states: [],
          directionOrCausality: null,
        }],
        includedCases: ['I backed out.'],
        excludedCases: [],
        neighborContrasts: [],
        openQuestions: [],
      },
      wordingSource: 'llm_suggested',
    },
    acceptance: {
      mode: 'delegated_agent',
      actorId: 'codex',
      basis: 'explicit_user_request',
      authorizationReference: null,
    },
  };
  sensaIntakePayloadSchema.parse(intake);
  const wireExample = JSON.parse(readFileSync(
    resolve('integrations/codex/sensa-intake/request-example.json'),
    'utf8',
  ));
  assert.deepEqual(wireExample, { kind: 'submit', intake }, 'the skill example is the exercised v3 wire request');

  const refused = jsonCall(executable, ['--config', configPath], { kind: 'submit', intake });
  assert.equal(refused.status, 1);
  assert.equal(refused.output.error, 'explicit_acceptance_required');

  const submitted = jsonCall(executable, ['--config', configPath, '--allow-accept'], { kind: 'submit', intake });
  assert.equal(submitted.status, 0, submitted.stderr);
  assert.equal(submitted.output.value.deliveryState, 'queued');
  assert.equal(submitted.output.value.operationId, operationId);
  assert.match(submitted.output.value.requestDigest, /^[0-9a-f]{64}$/u);

  const replay = jsonCall(executable, ['--config', configPath, '--allow-accept'], { kind: 'submit', intake });
  assert.equal(replay.status, 0, replay.stderr);
  assert.deepEqual(replay.output.value, submitted.output.value, 'the same operation is an idempotent retry');
  const conflict = jsonCall(executable, ['--config', configPath, '--allow-accept'], {
    kind: 'submit',
    intake: { ...intake, capturedAt: '2026-09-14T08:00:01.000Z' },
  });
  assert.equal(conflict.status, 1);
  assert.equal(conflict.output.error, 'operation_conflict');

  const queued = jsonCall(executable, ['--config', configPath], { kind: 'receipt', operationId });
  assert.equal(queued.output.value.deliveryState, 'queued');
  const pulled = nativeCall(executable, { kind: 'pull', libraryId, limit: 10 });
  assert.equal(pulled.value.length, 1);
  sensaLocalAgentIntakeDeliverySchema.parse(pulled.value[0]);
  assert.equal(pulled.value[0].intake.operationId, operationId);
  assert.equal(pulled.value[0].requestDigest, submitted.output.value.requestDigest);

  const receipt = {
    contractVersion: 'sensa-local-agent-intake-v1',
    libraryId,
    clientId: hello.output.value.clientId,
    operationId,
    requestDigest: submitted.output.value.requestDigest,
    result: { route: 'fast_track', personalMeaningId: '00000000-0000-4000-8000-000000000004' },
    appliedAt: '2026-09-14T08:00:02.000Z',
  };
  sensaLocalAgentIntakeReceiptSchema.parse(receipt);
  assert.deepEqual(nativeCall(executable, { kind: 'ack', receipt }).value, { acknowledged: true });
  assert.deepEqual(nativeCall(executable, { kind: 'pull', libraryId, limit: 10 }).value, []);
  const applied = jsonCall(executable, ['--config', configPath], { kind: 'receipt', operationId });
  assert.equal(applied.output.value.deliveryState, 'applied');
  assert.deepEqual(applied.output.value.receipt, receipt);

  const macChrome = detectLocalAgentEnvironment('Mozilla/5.0 (Macintosh) Chrome/140.0 Safari/537.36');
  const linuxEdge = detectLocalAgentEnvironment('Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Edg/140.0');
  assert.deepEqual(macChrome, { platform: 'macos', browser: 'chrome' });
  assert.deepEqual(linuxEdge, { platform: 'linux', browser: 'edge' });
  assert.equal(detectLocalAgentEnvironment('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0'), null);
  assert.equal(detectLocalAgentEnvironment('Mozilla/5.0 (Macintosh) Firefox/142.0'), null);
  const command = localAgentSetupCommand({
    origin: 'https://sensa.example.com',
    libraryId,
    extensionId,
    environment: macChrome!,
  });
  assert.match(command, /https:\/\/sensa\.example\.com\/integrations\/sensa-intake\.mjs/u);
  assert.match(command, /--assets-base-url/u);
  assert.match(command, /--browser' 'chrome'/u);

  console.log('PASS: one copied setup command installs the managed Codex skill and an idempotent local connection; the CLI durably queues one accepted v3 Intake, and only the committed Web receipt marks it applied.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
