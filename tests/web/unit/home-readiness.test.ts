import {describe, expect, it} from 'vitest';
import {effectiveHomeLearningPolicy, homeLearningReadiness} from '../../../apps/web/src/learning/system/learningProjection.ts';
import {homeLearningState} from '../../../apps/web/src/experience/library/homeLearningState';
import type {LearningHomeProjection} from '../../../apps/web/src/learning/system';

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

it('Home distinguishes unknown, resumable, ready, future review, empty route and no learning intent',()=>{
 const summary={activeRunId:null,hasLibraryContent:false,routeTargetCount:0,nextReviewAt:null,mixedReadyCount:0,readyInitialCount:0} as LearningHomeProjection;
 expect(homeLearningState(summary,false)).toBe('loading');
 expect(homeLearningState(summary,true)).toBe('empty');
 expect(homeLearningState({...summary,hasLibraryContent:true},true)).toBe('route_empty');
 expect(homeLearningState({...summary,hasLibraryContent:true,routeTargetCount:2},true)).toBe('idle');
 expect(homeLearningState({...summary,hasLibraryContent:true,nextReviewAt:'2026-10-11T08:00:00Z'},true)).toBe('waiting');
 expect(homeLearningState({...summary,mixedReadyCount:1},true)).toBe('review');
 expect(homeLearningState({...summary,mixedReadyCount:1,readyInitialCount:1},true)).toBe('ready');
 expect(homeLearningState({...summary,activeRunId:'pinned-run',mixedReadyCount:4},true)).toBe('resume');
});
