import assert from 'node:assert/strict';
import { planDailyInitialTargets, type DailyInitialCandidate } from './dailyInitialPlanner';

type TargetId = 'a' | 'b' | 'c' | 'd';
const now = '2026-09-04T10:00:00+08:00';

const candidate = (
  targetId: TargetId,
  initialPlannedAt: string | null = null,
  eligible = true,
): DailyInitialCandidate<TargetId> => ({ targetId, eligible, initialPlannedAt });

assert.deepEqual(
  planDailyInitialTargets([candidate('a'), candidate('b'), candidate('c')], 2, now),
  ['a', 'b'],
  'Study Plan daily-new count must be the only admission limit.',
);

assert.deepEqual(
  planDailyInitialTargets([
    candidate('a', '2026-09-04T08:00:00+08:00', false),
    candidate('b'),
    candidate('c'),
  ], 2, now),
  ['b'],
  'A Target already planned today must consume one slot instead of allowing replenishment.',
);

assert.deepEqual(
  planDailyInitialTargets([
    candidate('a', '2026-09-03T08:00:00+08:00', false),
    candidate('b'),
    candidate('c'),
  ], 2, now),
  ['b', 'c'],
  'Older ready Protocol work must not consume today\'s new-Introduction quota.',
);

assert.deepEqual(
  planDailyInitialTargets([candidate('a', null, false), candidate('b'), candidate('c')], 2, now),
  ['b', 'c'],
  'Ineligible Targets must not occupy a daily-new slot.',
);

assert.deepEqual(
  planDailyInitialTargets([candidate('a'), candidate('a'), candidate('b')], 2, now),
  ['a', 'b'],
  'A duplicated candidate must not consume the quota twice.',
);

assert.deepEqual(
  planDailyInitialTargets([candidate('a')], 0, now),
  [],
  'A zero limit must produce no new Target.',
);

console.log('daily-initial planner smoke OK (6 checks)');
