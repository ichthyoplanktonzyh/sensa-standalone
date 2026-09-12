import type { GradedMemoryOutcome, MemoryOutcomeGrade } from './memoryOutcome.js';
import {
  computeReviewSchedule,
  createEmptyReviewableCardScheduleState,
  type ReviewSchedule,
  type ReviewableCardScheduleState,
} from './scheduling.js';
import type { WorkspaceSchedulerConfig } from './workspaceConfig.js';

export const fsrsSchedulerAdapterVersion = 'sensa-fsrs-6-v1';
export const fsrsHandoffInitializerVersion = 'sensa-fsrs-handoff-initializer-v1';

export type RetentionMemorySnapshot = Readonly<{
  retentionTargetId: string;
  revision: number;
  dueAt: Date;
  schedule: ReviewableCardScheduleState;
}>;

export type DueReviewTrigger = Readonly<{
  kind: 'due_review';
  memoryRevision: number;
  dueAt: Date;
}>;

export type IndependentRelearningEvaluationTrigger = Readonly<{
  kind: 'independent_relearning_evaluation';
  memoryRevision: number;
  evaluationId: string;
}>;

export type RetentionSchedulingTrigger =
  | DueReviewTrigger
  | IndependentRelearningEvaluationTrigger;

export type RetentionSchedulingResult = Readonly<{
  priorMemoryRevision: number;
  resultingMemoryRevision: number;
  schedule: ReviewSchedule;
}>;

export class RetentionSchedulingError extends Error {
  public constructor(public readonly code:
    | 'invalid_identity'
    | 'invalid_revision'
    | 'stale_due'
    | 'clock_untrusted'
    | 'memory_mismatch') {
    super(code);
  }
}

const requireDate = (value: Date): void => {
  if (!Number.isFinite(value.getTime())) throw new RetentionSchedulingError('clock_untrusted');
};

const fsrsRatingFor = (grade: MemoryOutcomeGrade): 0 | 1 | 2 | 3 => {
  switch (grade) {
    case 'again': return 0;
    case 'hard': return 1;
    case 'good': return 2;
    case 'easy': return 3;
  }
};

/**
 * The scheduler's only initialization interface. A successful Initial Learning
 * Completion must first produce a Scheduling Handoff; callers then use this
 * function exactly once for that Retention Target.
 */
export function initializeRetentionMemory(
  retentionTargetId: string,
  schedulingPolicy: WorkspaceSchedulerConfig,
  handedOffAt: Date,
): RetentionSchedulingResult {
  if (retentionTargetId.trim().length === 0) {
    throw new RetentionSchedulingError('invalid_identity');
  }
  requireDate(handedOffAt);
  return Object.freeze({
    priorMemoryRevision: 0,
    resultingMemoryRevision: 1,
    // A Handoff is not a learner Review rating. The initializer owns this
    // seed and its version is persisted on the Handoff.
    schedule: computeReviewSchedule(
      createEmptyReviewableCardScheduleState(retentionTargetId),
      schedulingPolicy,
      2,
      handedOffAt,
    ),
  });
}

/**
 * The scheduler's only update interface. It validates the due trigger and
 * advances one Memory State revision for one protocol-valid Memory Outcome.
 */
export function scheduleMemoryOutcome(
  input: Readonly<{
    memory: RetentionMemorySnapshot;
    trigger: RetentionSchedulingTrigger;
    outcome: Pick<GradedMemoryOutcome, 'grade'>;
    occurredAt: Date;
  }>,
  schedulingPolicy: WorkspaceSchedulerConfig,
): RetentionSchedulingResult {
  const { memory, trigger, outcome, occurredAt } = input;
  if (memory.retentionTargetId.trim().length === 0) {
    throw new RetentionSchedulingError('invalid_identity');
  }
  if (!Number.isInteger(memory.revision) || memory.revision < 1) {
    throw new RetentionSchedulingError('invalid_revision');
  }
  requireDate(memory.dueAt);
  requireDate(occurredAt);
  if (memory.revision !== trigger.memoryRevision) {
    throw new RetentionSchedulingError('stale_due');
  }
  if (trigger.kind === 'due_review') {
    requireDate(trigger.dueAt);
    if (memory.dueAt.getTime() !== trigger.dueAt.getTime()) {
      throw new RetentionSchedulingError('stale_due');
    }
  } else if (trigger.evaluationId.trim().length === 0) {
    throw new RetentionSchedulingError('invalid_identity');
  }
  if (memory.schedule.cardId !== memory.retentionTargetId) {
    throw new RetentionSchedulingError('memory_mismatch');
  }
  if (
    (trigger.kind === 'due_review' && occurredAt < memory.dueAt)
    || memory.schedule.fsrsLastReviewedAt === null
    || !Number.isFinite(memory.schedule.fsrsLastReviewedAt.getTime())
    || occurredAt < memory.schedule.fsrsLastReviewedAt
  ) {
    throw new RetentionSchedulingError('clock_untrusted');
  }
  return Object.freeze({
    priorMemoryRevision: memory.revision,
    resultingMemoryRevision: memory.revision + 1,
    schedule: computeReviewSchedule(
      memory.schedule,
      schedulingPolicy,
      fsrsRatingFor(outcome.grade),
      occurredAt,
    ),
  });
}
