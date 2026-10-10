import {test, expect} from 'vitest';
import {applicationReleaseStatus, systemReleaseStatus} from '../../../scripts/release/releaseStatus.mjs';
const identity = {commit: 'a'.repeat(40), runId: '123', attempt: '2'};
const success = Object.fromEntries(['migrations', 'auth_config', 'service_config', 'api_deploy', 'web_version', 'web_preview', 'web_promote', 'domain_routes', 'public_smoke'].map(phase => [phase, {outcome: 'success'}]));

test('partial deployment and failed post-deployment smoke never imply untouched production or rollback', () => {
  expect(applicationReleaseStatus({...identity, steps: {}})).toMatchObject({status: 'not-deployed', productionMayHaveChanged: false});
  expect(applicationReleaseStatus({...identity, steps: {migrations: {outcome: 'failure'}}})).toMatchObject({status: 'partial-or-unverified', productionMayHaveChanged: true});
  expect(applicationReleaseStatus({...identity, steps: {...success, public_smoke: {outcome: 'failure'}}})).toMatchObject({status: 'partial-or-unverified', productionMayHaveChanged: true});
  expect(applicationReleaseStatus({...identity, steps: success}).status).toBe('verified');
  expect(applicationReleaseStatus({...identity, steps: {...success, private: {outcome: 'secret-value'}}})).not.toHaveProperty('private');
  expect(() => applicationReleaseStatus({...identity, steps: {api_deploy: {outcome: 'invented'}}})).toThrow();
});

test('waiting for authorization and incomplete jobs cannot be relabeled a completed release', () => {
  const plan = {releaseId: 'fixture', source: {commit: identity.commit}, authorization: {outcome: 'requires-approval'}, decision: {kind: 'awaiting-approval'}};
  expect(systemReleaseStatus(plan, {application: 'skipped', record: 'skipped'}).status).toBe('awaiting-approval');
  const ready = {...plan, authorization: {outcome: 'approved'}, decision: {kind: 'application-only', deployApplication: true, publishLearningContent: false}};
  expect(systemReleaseStatus(ready, {application: 'failure', record: 'skipped'}).status).toBe('incomplete');
  expect(systemReleaseStatus(ready, {application: 'failure', record: 'success'}).status).toBe('incomplete');
  expect(systemReleaseStatus(ready, {application: 'success', record: 'success'}).status).toBe('verified');
  expect(systemReleaseStatus({...ready, decision: {kind: 'no-op', deployApplication: false, publishLearningContent: false}}, {application: 'skipped', record: 'success'}).status).toBe('no-op');
});
