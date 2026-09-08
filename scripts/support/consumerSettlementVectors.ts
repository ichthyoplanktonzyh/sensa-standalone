import { decideConsumerSettlement, ConsumerSettlementError } from '../../packages/learning-kernel/src/runtime/consumerSettlement.js';

/** Identical vectors run in Node and a network-disabled browser. */
export function runConsumerSettlementVectors() {
  const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
  const rejects = (call: () => unknown, code: string) => {
    try { call(); } catch (error) {
      check(error instanceof ConsumerSettlementError && error.code === code, `Expected ${code}`);
      return;
    }
    throw new Error(`Expected rejection: ${code}`);
  };
  const target = '11111111-1111-4111-8111-111111111111';
  const occurredAt = new Date('2026-09-08T08:00:00.000Z');
  const initial = { purpose: 'initial_learning' as const, protocolVersion: 'consumer-initial-v1', retentionTargetId: target, occurredAt };
  const again = decideConsumerSettlement({ ...initial, rating: 'again' });
  check(again.kind === 'continue_initial' && !('schedule' in again), 'Again cannot initialize FSRS');
  const hard = decideConsumerSettlement({ ...initial, rating: 'hard' });
  const good = decideConsumerSettlement({ ...initial, rating: 'good' });
  if (hard.kind !== 'study_completion' || good.kind !== 'study_completion') throw new Error('Initial completion missing');
  check(hard.evidenceLevel === 'non_evidentiary' && hard.handoffBasis === 'protocol_completion', 'Initial claim changed');
  check(JSON.stringify(hard.schedule) === JSON.stringify(good.schedule), 'Initial hard must not become a due-review hard');
  check(good.schedule.dueAt.toISOString() === '2026-09-10T08:00:00.000Z' && good.schedule.reps === 1, 'Initial scheduling vector changed');

  // Rehydrate the persisted representation; the policy must not depend on a DB driver.
  const stored = JSON.parse(JSON.stringify(good.schedule));
  const memory = { revision: '1', dueAt: new Date(stored.dueAt), schedule: { ...stored, cardId: target, fsrsLastReviewedAt: new Date(stored.fsrsLastReviewedAt) } };
  const before = JSON.stringify(memory);
  const review = { purpose: 'retention_review' as const, protocolVersion: 'consumer-review-v1', retentionTargetId: target, occurredAt: memory.dueAt, memory, trigger: { memoryRevision: '1', dueAt: memory.dueAt } };
  const reviews = (['again', 'hard', 'good'] as const).map(rating => decideConsumerSettlement({ ...review, rating }));
  for (const outcome of reviews) {
    if (outcome.kind !== 'review_completed') throw new Error('Review completion missing');
    check(outcome.schedule.reps === 2 && outcome.evidenceLevel === 'self_report' && outcome.outcomeBasis === 'learner_rated', 'Review must update once with self-report provenance');
    check((outcome.nextEligibleAt !== null) === (outcome.rating === 'again'), 'Only forgetting starts this protocol repair');
  }
  check(JSON.stringify(memory) === before, 'Decision mutated caller memory');
  check(JSON.stringify(decideConsumerSettlement({ ...review, rating: 'again' })) === JSON.stringify(reviews[0]), 'Decision must be deterministic');
  rejects(() => decideConsumerSettlement({ ...review, rating: 'good', trigger: { ...review.trigger, memoryRevision: '0' } }), 'stale_due');
  rejects(() => decideConsumerSettlement({ ...review, rating: 'good', trigger: { ...review.trigger, dueAt: occurredAt } }), 'stale_due');
  rejects(() => decideConsumerSettlement({ ...review, rating: 'good', occurredAt }), 'clock_untrusted');
  rejects(() => decideConsumerSettlement({ ...review, rating: 'good', retentionTargetId: 'another-target' }), 'memory_mismatch');
  rejects(() => decideConsumerSettlement({ ...initial, rating: 'good', protocolVersion: 'consumer-review-v1' }), 'unsupported_protocol');
  rejects(() => decideConsumerSettlement({ ...initial, rating: 'good', occurredAt: new Date(NaN) }), 'clock_untrusted');
  rejects(() => decideConsumerSettlement({ ...initial, rating: 'easy' as 'good' }), 'invalid_rating');

  const relearning = { purpose: 'relearning' as const, protocolVersion: 'consumer-relearning-v1', retentionTargetId: target, occurredAt: review.occurredAt };
  const repairs = (['again', 'hard', 'good'] as const).map(rating => decideConsumerSettlement({ ...relearning, rating }));
  check(repairs.every(x => !('schedule' in x)), 'Relearning must never re-rate or initialize FSRS');
  const wait = repairs[0];
  check(wait.kind === 'wait_relearning' && wait.nextEligibleAt.getTime() === review.occurredAt.getTime() + 600000, 'Repair wait changed');
  check(repairs.slice(1).every(x => x.kind === 'relearning_completion'), 'Repair completion missing');
  return JSON.parse(JSON.stringify({ again, hard, good, reviews, repairs }));
}
