import { transitionConsumerRun } from './consumerInitial.js';
import {
  computeReviewSchedule,
  createEmptyReviewableCardScheduleState,
  type ReviewableCardScheduleState,
  type ReviewSchedule,
} from './scheduling.js';

export const consumerSchedulingPolicyVersion = 'sensa-lightweight-scheduling-v1';
const schedulingPolicy = Object.freeze({
  algorithm: 'fsrs-6' as const,
  desiredRetention: 0.9,
  maximumIntervalDays: 36500,
  learningStepsMinutes: Object.freeze([] as number[]),
  relearningStepsMinutes: Object.freeze([] as number[]),
  enableFuzz: false,
});

type Rating = 'again' | 'hard' | 'good';
type Common = Readonly<{
  retentionTargetId: string;
  protocolVersion: string;
  rating: Rating;
  occurredAt: Date;
}>;
export type ConsumerSettlementInput = Common & (
  | { purpose: 'initial_learning' }
  | {
      purpose: 'retention_review';
      memory: Readonly<{
        revision: string;
        dueAt: Date;
        schedule: ReviewableCardScheduleState;
      }>;
      trigger: Readonly<{ memoryRevision: string; dueAt: Date }>;
    }
  | { purpose: 'relearning' }
);

export type ConsumerSettlement =
  | { kind: 'continue_initial' }
  | {
      kind: 'study_completion';
      evidenceLevel: 'non_evidentiary';
      handoffBasis: 'protocol_completion';
      schedule: ReviewSchedule;
    }
  | {
      kind: 'review_completed';
      evidenceLevel: 'self_report';
      outcomeBasis: 'learner_rated';
      rating: Rating;
      schedule: ReviewSchedule;
      nextEligibleAt: Date | null;
    }
  | { kind: 'wait_relearning'; nextEligibleAt: Date }
  | { kind: 'relearning_completion'; evidenceLevel: 'non_evidentiary' };

export class ConsumerSettlementError extends Error {
  constructor(public readonly code: 'unsupported_protocol' | 'invalid_rating' | 'stale_due' | 'clock_untrusted' | 'memory_mismatch') {
    super(code);
  }
}

/**
 * Decide the effects of a validated Reveal rating, without storage, accounts or IO.
 * The caller checks the current step/material, owns the operation ledger and commits
 * the attempt, transition and these effects atomically. A decision alone is no fact.
 * Dates, identity and the due trigger are explicit so the same policy runs on-device.
 */
export function decideConsumerSettlement(input: ConsumerSettlementInput): ConsumerSettlement {
  const protocol = input.purpose === 'initial_learning' ? 'consumer-initial-v1'
    : input.purpose === 'retention_review' ? 'consumer-review-v1'
    : input.purpose === 'relearning' ? 'consumer-relearning-v1' : null;
  if (input.protocolVersion !== protocol || !protocol) throw new ConsumerSettlementError('unsupported_protocol');
  if (!['again', 'hard', 'good'].includes(input.rating)) throw new ConsumerSettlementError('invalid_rating');
  if (!Number.isFinite(input.occurredAt.getTime())) throw new ConsumerSettlementError('clock_untrusted');
  const next = transitionConsumerRun(protocol, 'reveal', { kind: 'rate', rating: input.rating });
  const retryAt = () => new Date(input.occurredAt.getTime() + 10 * 60 * 1000);

  if (input.purpose === 'initial_learning') {
    if (next !== 'completed') return { kind: 'continue_initial' };
    return {
      kind: 'study_completion', evidenceLevel: 'non_evidentiary', handoffBasis: 'protocol_completion',
      // Both hard and good complete initial study; neither is a due-review rating.
      schedule: computeReviewSchedule(createEmptyReviewableCardScheduleState(input.retentionTargetId), schedulingPolicy, 2, input.occurredAt),
    };
  }
  if (input.purpose === 'relearning') {
    return next === 'waiting' ? { kind: 'wait_relearning', nextEligibleAt: retryAt() }
      : { kind: 'relearning_completion', evidenceLevel: 'non_evidentiary' };
  }
  const { memory, trigger } = input;
  if (memory.revision !== trigger.memoryRevision || memory.dueAt.getTime() !== trigger.dueAt.getTime()) {
    throw new ConsumerSettlementError('stale_due');
  }
  if (memory.schedule.cardId !== input.retentionTargetId) throw new ConsumerSettlementError('memory_mismatch');
  if (!Number.isFinite(memory.dueAt.getTime()) || input.occurredAt < memory.dueAt
    || !memory.schedule.fsrsLastReviewedAt || !Number.isFinite(memory.schedule.fsrsLastReviewedAt.getTime())
    || input.occurredAt < memory.schedule.fsrsLastReviewedAt) throw new ConsumerSettlementError('clock_untrusted');
  return {
    kind: 'review_completed', evidenceLevel: 'self_report', outcomeBasis: 'learner_rated', rating: input.rating,
    schedule: computeReviewSchedule(memory.schedule, schedulingPolicy, input.rating === 'again' ? 0 : input.rating === 'hard' ? 1 : 2, input.occurredAt),
    nextEligibleAt: input.rating === 'again' ? retryAt() : null,
  };
}
