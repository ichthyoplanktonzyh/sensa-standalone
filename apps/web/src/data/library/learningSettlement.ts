import {
  fsrsHandoffInitializerVersion,
  fsrsSchedulerAdapterVersion,
  initializeRetentionMemory,
  scheduleMemoryOutcome,
  stableUuid,
  type ReviewSchedule,
} from '@sensa/learning-kernel';
import {
  sensaInitialLearningCompletionSchema,
  sensaLearningConnectionContractVersion,
  sensaMemoryOutcomeSnapshotSchema,
  sensaRelearningCompletionSchema,
  sensaSchedulingDecisionSchema,
  sensaSchedulingHandoffSchema,
  type SensaInitialLearningCompletion,
  type SensaMemoryOutcomeSnapshot,
  type SensaRelearningCompletion,
  type SensaSchedulingDecision,
  type SensaSchedulingHandoff,
} from '@sensa/contracts/sensa';
import type {
  LocalProtocolTransition,
  LocalProtocolAuditEffect,
  LocalLearningRun,
  LocalLearningTarget,
} from '../../learning/runtime/localProtocol';
import { initialCompletionContractOf, orchestrationRegistry } from '../../learning/runtime/orchestrations';

export type LocalRetentionSettlement =
  | Readonly<{
      kind: 'initial_learning_completion';
      completion: SensaInitialLearningCompletion;
      handoff: SensaSchedulingHandoff;
      resultingMemoryRevision: number;
      nextDueAt: string;
    }>
  | Readonly<{
      kind: 'memory_outcome';
      outcome: SensaMemoryOutcomeSnapshot;
      schedulingDecision: SensaSchedulingDecision;
      nextEligibleAt: string | null;
    }>
  | Readonly<{
      kind: 'relearning_progress';
      nextEligibleAt: string;
    }>
  | Readonly<{
      kind: 'relearning_completion';
      completion: SensaRelearningCompletion;
    }>;

export type LocalLearningTransitionRecord = Readonly<{
  protocolEffects: readonly LocalProtocolAuditEffect[];
  retention: LocalRetentionSettlement | null;
}>;

const requireDate = (value: string): Date => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('localFlow.clockChanged');
  return parsed;
};

const withCardIdentity = (
  target: LocalLearningTarget,
): ReviewSchedule & { cardId: string } => {
  if (!target.memory) throw new Error('localFlow.stepChanged');
  return { ...target.memory, cardId: target.retentionId };
};

/**
 * The one local seam allowed to create formal retention facts or write Memory
 * State. Protocol adapters return intents; this module validates them, invokes
 * the scheduler and returns the immutable records committed with the action.
 */
export function applyLocalProtocolTransition(input: Readonly<{
  operationId: string;
  stepId: string;
  at: string;
  target: LocalLearningTarget;
  run: LocalLearningRun;
  transition: LocalProtocolTransition;
}>): Readonly<{
  target: LocalLearningTarget;
  record: LocalLearningTransitionRecord;
}> {
  const { operationId, stepId, run, transition } = input;
  const at = requireDate(input.at);
  const target = structuredClone(input.target);
  const participant = run.participants[target.id];
  if (
    !run.targetIds.includes(target.id)
    || !participant
    || participant.material.snapshot.learningTargetId !== target.id
  ) throw new Error('localFlow.stepChanged');
  const completionMarker=run.targetCompletions[target.id];
  const invalidPlan=[
    participant.protocolRunId.trim().length===0&&'protocol_run',
    participant.resolvedPlan.learningTargetId!==target.id&&'target',
    participant.resolvedPlan.retentionTargetId!==target.retentionId&&'retention',
    participant.resolvedPlan.purpose!==run.purpose&&'purpose',
    participant.resolvedPlan.profileId!==participant.policyCommitment.profileId&&'profile',
    participant.resolvedPlan.profileVersion!==participant.policyCommitment.profileVersion&&'profile_version',
    participant.resolvedPlan.protocolBinding.protocolId!==run.protocolBinding.protocolId&&'protocol',
    participant.resolvedPlan.protocolBinding.protocolVersion!==run.protocolBinding.protocolVersion&&'protocol_version',
    participant.resolvedPlan.protocolBinding.localProtocolVersion!==run.protocolBinding.localProtocolVersion&&'local_protocol_version',
    !participant.resolvedPlan.learningMaterializationIds.includes(participant.material.snapshot.learningMaterializationId)&&'materialization',
  ].filter(Boolean);
  if(invalidPlan.length)throw new Error(`Invalid resolved Learning Plan: ${invalidPlan.join(',')}`);
  const learnerUserId = participant.material.snapshot.learnerUserId;
  const intent = transition.settlement;
  if (!intent) {
    return {
      target,
      record: { protocolEffects: transition.protocolEffects, retention: null },
    };
  }

  let retention: LocalRetentionSettlement;
  switch (intent.kind) {
    case 'initial_learning_completion': {
      const expectedCompletion = initialCompletionContractOf(
        orchestrationRegistry.get(run.protocolBinding.orchestrationId),
      );
      if (
        run.purpose !== 'initial_learning'
        || target.completedAt
        || target.memory
        || target.memoryRevision !== 0
        || intent.completion.completionKind !== expectedCompletion.completionKind
        || intent.completion.protocolOutcome !== expectedCompletion.protocolOutcome
        || intent.completion.handoffBasis !== expectedCompletion.handoffBasis
        || intent.completion.evidenceLevel !== expectedCompletion.evidenceLevel
        || completionMarker?.at!==input.at
        || completionMarker.kind!==intent.completion.completionKind
      ) throw new Error('localFlow.stepChanged');
      const completion = sensaInitialLearningCompletionSchema.parse({
        contractVersion: sensaLearningConnectionContractVersion,
        initialLearningCompletionId: stableUuid(
          `local-initial-learning-completion:${participant.protocolRunId}:${target.retentionId}`,
        ),
        learnerUserId,
        learningTargetId: target.id,
        retentionTargetId: target.retentionId,
        protocolRunId: participant.protocolRunId,
        completionKind: intent.completion.completionKind,
        protocolOutcome: intent.completion.protocolOutcome,
        completedAt: input.at,
      });
      const handoff = sensaSchedulingHandoffSchema.parse({
        contractVersion: sensaLearningConnectionContractVersion,
        schedulingHandoffId: stableUuid(`local-scheduling-handoff:${target.retentionId}`),
        learnerUserId,
        learningTargetId: target.id,
        retentionTargetId: target.retentionId,
        initialLearningCompletionId: completion.initialLearningCompletionId,
        profileId: participant.policyCommitment.profileId,
        profileVersion: participant.policyCommitment.profileVersion,
        protocolId: run.protocolBinding.protocolId,
        protocolVersion: run.protocolBinding.protocolVersion,
        learningMaterializationIds: [...participant.resolvedPlan.learningMaterializationIds],
        initializationBasis: intent.completion.handoffBasis,
        evidenceLevel: intent.completion.evidenceLevel,
        evidenceIds: [...intent.evidenceIds],
        schedulerPolicyVersion: run.schedulingPolicyId,
        initializerVersion: fsrsHandoffInitializerVersion,
        learnerVisibleClaimBoundary: run.learnerVisibleClaimBoundary,
        createdAt: input.at,
      });
      const scheduled = initializeRetentionMemory(
        target.retentionId,
        run.schedulingPolicy,
        at,
      );
      if(intent.relearning&&requireDate(intent.relearning.nextEligibleAt)<at)throw new Error('localFlow.clockChanged');
      target.completedAt = input.at;
      target.memory = scheduled.schedule;
      target.memoryRevision = scheduled.resultingMemoryRevision;
      target.relearnAt = intent.relearning?.nextEligibleAt ?? null;
      target.relearningState = intent.relearning?.state ?? null;
      retention = {
        kind: 'initial_learning_completion',
        completion,
        handoff,
        resultingMemoryRevision: scheduled.resultingMemoryRevision,
        nextDueAt: scheduled.schedule.dueAt.toISOString(),
      };
      break;
    }
    case 'memory_outcome': {
      const trigger = participant;
      const dueReview=run.purpose==='retention_review'&&intent.schedulerEligibility==='due_review';
      const independentRelearning=run.purpose==='relearning'&&intent.schedulerEligibility==='independent_relearning_evaluation';
      if (
        (!dueReview&&!independentRelearning)
        || run.protocolBinding.memoryOutcomePolicyId === null
        || !target.memory
        || dueReview&&trigger.dueAt === null
        || dueReview&&completionMarker?.at!==input.at
      ) throw new Error('localFlow.stepChanged');
      const dueReviewKey = stableUuid(
        dueReview
          ?`local-due-review:${target.retentionId}:${trigger.memoryRevision}:${trigger.dueAt}`
          :`local-relearning-evaluation:${target.retentionId}:${trigger.memoryRevision}:${intent.evaluationId}`,
      );
      const outcome = sensaMemoryOutcomeSnapshotSchema.parse({
        contractVersion: sensaLearningConnectionContractVersion,
        memoryOutcomeId: stableUuid(
          `local-memory-outcome:${dueReviewKey}:${participant.protocolRunId}:${intent.evaluationId}`,
        ),
        learnerUserId,
        retentionTargetId: target.retentionId,
        protocolRunId: participant.protocolRunId,
        protocolStepId: stepId,
        evaluationId: intent.evaluationId,
        dueReviewKey,
        origin: run.purpose,
        basis: intent.outcome.basis,
        evidenceLevel: intent.outcome.evidenceLevel,
        evidenceIds: [...intent.outcome.evidenceIds],
        grade: intent.outcome.grade,
        priorMemoryRevision: trigger.memoryRevision,
        idempotencyKey: operationId,
        occurredAt: input.at,
      });
      const scheduled = scheduleMemoryOutcome({
        memory: {
          retentionTargetId: target.retentionId,
          revision: target.memoryRevision,
          dueAt: target.memory.dueAt,
          schedule: withCardIdentity(target),
        },
        trigger: {
          ...(dueReview
            ?{kind:'due_review' as const,dueAt:requireDate(trigger.dueAt!)}
            :{kind:'independent_relearning_evaluation' as const,evaluationId:intent.evaluationId}),
          memoryRevision: trigger.memoryRevision,
        },
        outcome: intent.outcome,
        occurredAt: at,
      }, run.schedulingPolicy);
      const schedulingDecision = sensaSchedulingDecisionSchema.parse({
        contractVersion: sensaLearningConnectionContractVersion,
        schedulingDecisionId: stableUuid(
          `local-scheduling-decision:${outcome.memoryOutcomeId}`,
        ),
        retentionTargetId: target.retentionId,
        memoryOutcomeId: outcome.memoryOutcomeId,
        schedulerPolicyVersion: run.schedulingPolicyId,
        fsrsAdapterVersion: fsrsSchedulerAdapterVersion,
        grade: outcome.grade,
        priorMemoryRevision: scheduled.priorMemoryRevision,
        resultingMemoryRevision: scheduled.resultingMemoryRevision,
        nextDueAt: scheduled.schedule.dueAt.toISOString(),
        decidedAt: input.at,
      });
      target.memory = scheduled.schedule;
      target.memoryRevision = scheduled.resultingMemoryRevision;
      if(dueReview){
        target.relearnAt = intent.relearning?.nextEligibleAt ?? null;
        target.relearningState = intent.relearning?.state ?? null;
      }else if(intent.relearning){
        target.relearnAt=intent.relearning.nextEligibleAt;
        target.relearningState=intent.relearning.state;
      }
      retention = {
        kind: 'memory_outcome',
        outcome,
        schedulingDecision,
        nextEligibleAt: target.relearnAt,
      };
      break;
    }
    case 'relearning_progress': {
      if (run.purpose !== 'relearning' || !target.memory || !target.relearnAt) {
        throw new Error('localFlow.stepChanged');
      }
      if (requireDate(intent.nextEligibleAt) < at) throw new Error('localFlow.clockChanged');
      target.relearnAt = intent.nextEligibleAt;
      target.relearningState = intent.state;
      retention = {
        kind: 'relearning_progress',
        nextEligibleAt: intent.nextEligibleAt,
      };
      break;
    }
    case 'relearning_completion': {
      if (run.purpose !== 'relearning' || !target.memory || !target.relearnAt || completionMarker?.at!==input.at) {
        throw new Error('localFlow.stepChanged');
      }
      const completion = sensaRelearningCompletionSchema.parse({
        contractVersion: sensaLearningConnectionContractVersion,
        relearningCompletionId: stableUuid(
          `local-relearning-completion:${participant.protocolRunId}:${target.retentionId}`,
        ),
        learnerUserId,
        learningTargetId: target.id,
        retentionTargetId: target.retentionId,
        protocolRunId: participant.protocolRunId,
        protocolOutcome: intent.protocolOutcome,
        evidenceLevel: intent.evidenceLevel,
        evidenceIds: [...intent.evidenceIds],
        completedAt: input.at,
      });
      target.relearnAt = null;
      target.relearningState = null;
      retention = { kind: 'relearning_completion', completion };
      break;
    }
  }
  return {
    target,
    record: { protocolEffects: transition.protocolEffects, retention },
  };
}
