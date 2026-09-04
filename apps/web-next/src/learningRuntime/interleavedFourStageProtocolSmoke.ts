import {
  INTERLEAVED_FOUR_STAGE_CHECKPOINTS,
  InterleavedFourStageQueue,
  InterleavedFourStageReviewQueue,
} from './interleavedFourStageProtocol';

const failures: string[] = [];
let checks = 0;

const check = (label: string, condition: boolean): void => {
  checks += 1;
  if (!condition) failures.push(label);
};

const plannedCohort = ['alpha', 'bravo', 'charlie', 'delta', 'echo'] as const;
const queue = new InterleavedFourStageQueue(plannedCohort, { minGap: 2 });
check('protocol consumes the complete Planner-owned cohort',
  queue.getProjection().targetCount === plannedCohort.length);

const encounters: Array<{ targetId: string; ordinal: number; checkpointId: string }> = [];
while (!queue.isDone()) {
  const session = queue.getCurrentSession();
  if (!session) throw new Error('Four-stage queue stopped before graduation.');
  encounters.push({
    targetId: session.targetId,
    ordinal: session.sessionOrdinal,
    checkpointId: session.checkpointId,
  });
  queue.settle(true);
  queue.completeFeedback();
}
check('every Target crosses four protocol-local Checkpoints',
  encounters.length === plannedCohort.length * INTERLEAVED_FOUR_STAGE_CHECKPOINTS.length);
check('low-pass Targets interleave before any Target advances',
  encounters.slice(0, plannedCohort.length).map((item) => item.targetId).join('|')
    === plannedCohort.join('|'));
check('the configured encounter gap is respected while the cohort can satisfy it',
  plannedCohort.every((targetId) => {
    const ordinals = encounters
      .filter((item) => item.targetId === targetId)
      .map((item) => item.ordinal);
    return ordinals.slice(1).every((ordinal, index) => ordinal - ordinals[index]! > 2);
  }));
check('graduation is derived from current-epoch Checkpoint credit',
  queue.getProjection().graduatedTargetIds.join('|') === plannedCohort.join('|'));

const resetQueue = new InterleavedFourStageQueue(['reset-me']);
resetQueue.settle(true);
resetQueue.completeFeedback();
const failedCheckpoint = resetQueue.getCurrentSession()!.checkpointId;
resetQueue.settle(false);
const afterFailure = resetQueue.getProjection().targets[0]!;
check('one failure advances the Target progress epoch', afterFailure.progress.progressEpoch === 1);
check('one failure invalidates earlier Checkpoint credit',
  afterFailure.progress.checkpointCredits['four-stage:meaning-choice']?.status === 'unresolved');
check('the failed Checkpoint remains attached to repair feedback',
  afterFailure.progress.checkpointCredits[failedCheckpoint]?.status === 'failed');
resetQueue.completeFeedback();
check('detail feedback does not grant credit',
  resetQueue.getProjection().targets[0]!.progress.checkpointCredits[failedCheckpoint]?.status
    === 'unresolved');
check('after any failure the next assessment restarts at stage one',
  resetQueue.getCurrentSession()?.checkpointId === 'four-stage:meaning-choice');

const review = new InterleavedFourStageReviewQueue(['known', 'vague', 'forgotten']);
review.settle('known');
review.completeFeedback();
review.settle('vague');
review.completeFeedback();
review.settle('forgotten');
review.completeFeedback();
check('three-way Review preserves Good/Hard/Again grades',
  review.getMemoryOutcomes().get('known')?.grade === 'good'
    && review.getMemoryOutcomes().get('vague')?.grade === 'hard'
    && review.getMemoryOutcomes().get('forgotten')?.grade === 'again');
check('a forgotten Target returns as Relearning rather than a second due Review',
  review.getCurrentSession()?.targetId === 'forgotten'
    && review.getCurrentSession()?.mode === 'relearning');
review.settle('known');
check('Relearning completion emits no second Memory Outcome',
  review.getCurrentSession()?.memoryOutcome === null
    && review.getMemoryOutcomes().size === 3);
review.completeFeedback();
check('the Review/Relearning queue terminates after repair succeeds', review.isDone());

if (failures.length > 0) {
  console.error(`interleaved-four-stage protocol smoke FAILED (${failures.length}/${checks})`);
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(`interleaved-four-stage protocol smoke OK (${checks} checks)`);
