import assert from 'node:assert/strict';
import {homeTargetPolicy,homeTargetReadiness} from '../apps/web/src/experience/library/homeTargetReadiness.ts';

const target=(profileId:'lightweight'|'high_assurance'|'interleaved_four_stage',committed?:typeof profileId)=>({
 policyAssignment:{profileId},
 committedPolicy:committed?{profileId:committed}:null,
}) as any;
const membership=(validationStatus:'validated'|'rejected',assurancePackageKey?:string)=>({
 assurancePackageKey,
 material:{snapshot:{validationStatus}},
}) as any;
const installed={} as any;

assert.equal(homeTargetReadiness(target('lightweight'),undefined,undefined),'blocked');
assert.equal(homeTargetReadiness(target('lightweight'),membership('rejected'),undefined),'blocked');
assert.equal(homeTargetReadiness(target('lightweight'),membership('validated'),undefined),'ready');
assert.equal(homeTargetReadiness(target('high_assurance'),membership('validated','assurance'),undefined),'blocked');
assert.equal(homeTargetReadiness(target('high_assurance'),membership('validated','assurance'),installed),'ready');
assert.equal(homeTargetPolicy(target('lightweight','interleaved_four_stage')),'interleaved_four_stage');

console.log('PASS: Home uses persisted installation readiness without loading the runtime validator.');
