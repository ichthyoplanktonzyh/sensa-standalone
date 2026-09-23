import {describe, expect, it} from 'vitest';
import {effectiveHomeLearningPolicy, homeLearningReadiness} from '../../../apps/web/src/learning/system/learningProjection.ts';

const target = (profileId: 'lightweight' | 'high_assurance' | 'interleaved_four_stage', committed?: typeof profileId) => ({
  policyAssignment: {profileId},
  committedPolicy: committed ? {profileId: committed} : null,
}) as any;

const membership = (validationStatus: 'validated' | 'rejected', assurancePackageKey?: string) => ({
  assurancePackageKey,
  packageKey: assurancePackageKey ? 'fixture-package' : null,
  material: {snapshot: {validationStatus}},
}) as any;

describe('Home learning readiness from persisted installation state', () => {
  it('blocks a missing membership', () => {
    expect(homeLearningReadiness(target('lightweight'), undefined, new Set())).toBe('blocked');
  });

  it('blocks rejected material', () => {
    expect(homeLearningReadiness(target('lightweight'), membership('rejected'), new Set())).toBe('blocked');
  });

  it('allows validated lightweight material without a package', () => {
    expect(homeLearningReadiness(target('lightweight'), membership('validated'), new Set())).toBe('ready');
  });

  it('blocks high assurance material when its package is unavailable', () => {
    expect(homeLearningReadiness(target('high_assurance'), membership('validated', 'assurance'), new Set())).toBe('blocked');
  });

  it('allows high assurance material when its package is available', () => {
    expect(homeLearningReadiness(target('high_assurance'), membership('validated', 'assurance'), new Set(['fixture-package']))).toBe('ready');
  });

  it('prefers the committed learning policy', () => {
    expect(effectiveHomeLearningPolicy(target('lightweight', 'interleaved_four_stage'))).toBe('interleaved_four_stage');
  });
});
