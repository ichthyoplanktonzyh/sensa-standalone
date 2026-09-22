import assert from 'node:assert/strict';
import {effectiveHomeLearningPolicy,homeLearningReadiness} from '../apps/web/src/learning/system/learningProjection.ts';

const target=(profileId:'lightweight'|'high_assurance'|'interleaved_four_stage',committed?:typeof profileId)=>({
 policyAssignment:{profileId},
 committedPolicy:committed?{profileId:committed}:null,
}) as any;
const membership=(validationStatus:'validated'|'rejected',assurancePackageKey?:string)=>({
 assurancePackageKey,
 packageKey:assurancePackageKey?'fixture-package':null,
 material:{snapshot:{validationStatus}},
}) as any;

assert.equal(homeLearningReadiness(target('lightweight'),undefined,new Set()),'blocked');
assert.equal(homeLearningReadiness(target('lightweight'),membership('rejected'),new Set()),'blocked');
assert.equal(homeLearningReadiness(target('lightweight'),membership('validated'),new Set()),'ready');
assert.equal(homeLearningReadiness(target('high_assurance'),membership('validated','assurance'),new Set()),'blocked');
assert.equal(homeLearningReadiness(target('high_assurance'),membership('validated','assurance'),new Set(['fixture-package'])),'ready');
assert.equal(effectiveHomeLearningPolicy(target('lightweight','interleaved_four_stage')),'interleaved_four_stage');

console.log('PASS: Home uses persisted installation readiness without loading the runtime validator.');
