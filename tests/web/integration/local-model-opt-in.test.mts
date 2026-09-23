/** Pure local-preview model opt-in boundary checks. No files, network, or model calls. */
import assert from 'node:assert/strict';
import {
  LOCAL_MODEL_ENV_KEYS,
  resolveLocalModelEnvironment,
} from '../../../scripts/local/sensaLocalModelEnvironment.mjs';

assert.deepEqual(
  resolveLocalModelEnvironment({ enabled: false, sources: [{ DEEPSEEK_API_KEY: 'must-not-pass' }] }),
  { SENSA_MANAGED_MODELS_PAUSED: '1' },
);

const enabled = resolveLocalModelEnvironment({
  enabled: true,
  sources: [{
    DEEPSEEK_API_KEY: 'fixture-key',
    SENSA_SEMANTIC_MODEL: 'fixture-model',
    SUPABASE_SERVICE_ROLE_KEY: 'must-not-pass',
    VITE_SECRET: 'must-not-pass',
    DATABASE_URL: 'must-not-pass',
  }],
});
assert.equal(enabled.SENSA_MANAGED_MODELS_PAUSED, '0');
assert.equal(enabled.SENSA_SEMANTIC_PROVIDER, 'deepseek');
assert.equal(enabled.DEEPSEEK_API_KEY, 'fixture-key');
assert.equal(enabled.SENSA_SEMANTIC_MODEL, 'fixture-model');
assert(!('SUPABASE_SERVICE_ROLE_KEY' in enabled));
assert(!('VITE_SECRET' in enabled));
assert(!('DATABASE_URL' in enabled));
assert(LOCAL_MODEL_ENV_KEYS.every((key) => key === 'DEEPSEEK_API_KEY' || key.startsWith('SENSA_')));

assert.throws(
  () => resolveLocalModelEnvironment({ enabled: true, sources: [] }),
  /DEEPSEEK_API_KEY/u,
);
assert.throws(
  () => resolveLocalModelEnvironment({
    enabled: true,
    sources: [{ DEEPSEEK_API_KEY: 'fixture-key', SENSA_SEMANTIC_PROVIDER: 'other' }],
  }),
  /only supports/u,
);

console.log('PASS: local model calls stay disabled by default; explicit opt-in forwards only allowlisted server-side model configuration. No files/network/model calls.');
