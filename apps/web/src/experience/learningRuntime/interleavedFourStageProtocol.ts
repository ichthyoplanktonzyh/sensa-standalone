import {encodeQueueSnapshot,decodeQueueSnapshot} from '../engine/queueSnapshot';
import {
  createProtocolProgressState,
  decideAndApplyProtocolTransition,
  type GradedMemoryOutcome,
  type ProtocolProgressDefinition,
  type ProtocolProgressState,
} from '@sensa/learning-kernel';
import { resolveLearnerRatedMemoryOutcome } from '../review/types';
import { protocolPolicyRegistry } from './protocolPolicies';

export const INTERLEAVED_FOUR_STAGE_CHECKPOINTS = [
  { checkpointId: 'four-stage:meaning-choice', presentation: 'meaning_choice' },
  { checkpointId: 'four-stage:context-recall', presentation: 'context_recall' },
  { checkpointId: 'four-stage:sound-choice', presentation: 'sound_choice' },
  { checkpointId: 'four-stage:final-recall', presentation: 'final_recall' },
] as const;

export type FourStageCheckpointId =
  (typeof INTERLEAVED_FOUR_STAGE_CHECKPOINTS)[number]['checkpointId'];
export type FourStagePresentation =
  (typeof INTERLEAVED_FOUR_STAGE_CHECKPOINTS)[number]['presentation'];

export const INTERLEAVED_FOUR_STAGE_PROTOCOL_DEFINITION: ProtocolProgressDefinition = Object.freeze({
  protocolId: 'interleaved-four-stage-acquisition',
  protocolVersion: 'v1',
  checkpoints: Object.freeze(INTERLEAVED_FOUR_STAGE_CHECKPOINTS.map(({ checkpointId }) => ({
    checkpointId,
    capabilityObjectiveIds: ['sense-expression-connection'],
    requiredForCompletion: true,
  }))),
  completionPolicy: protocolPolicyRegistry.getCompletion('all-required-current-epoch-v1'),
});

const runResetProgression = protocolPolicyRegistry.getProgression('run-reset-v1');

export interface FourStageTargetProgress<TargetId extends string> {
  readonly targetId: TargetId;
  readonly progress: ProtocolProgressState;
  readonly lastSessionOrdinal: number;
  readonly attempts: number;
  readonly mistakes: number;
}

export interface FourStageSession<TargetId extends string> {
  readonly sessionOrdinal: number;
  readonly targetId: TargetId;
  readonly checkpointId: FourStageCheckpointId;
  readonly presentation: FourStagePresentation;
  readonly phase: 'assessment' | 'feedback';
  readonly result: boolean | null;
}

export interface FourStageQueueProjection<TargetId extends string> {
  readonly targetCount: number;
  readonly graduatedTargetIds: readonly TargetId[];
  readonly targets: readonly FourStageTargetProgress<TargetId>[];
  readonly currentSession: FourStageSession<TargetId> | null;
}

const cloneTarget = <TargetId extends string>(
  target: FourStageTargetProgress<TargetId>,
): FourStageTargetProgress<TargetId> => ({ ...target });

const checkpointIndex = (checkpointId: FourStageCheckpointId): number =>
  INTERLEAVED_FOUR_STAGE_CHECKPOINTS.findIndex(
    (checkpoint) => checkpoint.checkpointId === checkpointId,
  );

const nextCheckpoint = <TargetId extends string>(
  target: FourStageTargetProgress<TargetId>,
): (typeof INTERLEAVED_FOUR_STAGE_CHECKPOINTS)[number] | null =>
  INTERLEAVED_FOUR_STAGE_CHECKPOINTS.find(({ checkpointId }) => {
    const credit = target.progress.checkpointCredits[checkpointId];
    return credit?.status !== 'credited'
      || credit.creditedInEpoch !== target.progress.progressEpoch;
  }) ?? null;

/**
 * Protocol-owned short-term queue. It consumes exactly the Target cohort
 * selected by the Study Plan; there is deliberately no batch/group-size
 * option here. `minGap` is an encounter-spacing rule, not a quantity rule.
 */
export class InterleavedFourStageQueue<TargetId extends string> {
  readonly #targetOrder: ReadonlyMap<TargetId, number>;
  readonly #minGap: number;
  #targets: FourStageTargetProgress<TargetId>[];
  #currentSession: FourStageSession<TargetId> | null = null;
  #sessionOrdinal = 0;

  public constructor(
    targetIds: readonly TargetId[],
    options: { readonly minGap?: number; readonly protocolRunId?: string } = {},
  ) {
    const uniqueTargetIds = [...new Set(targetIds)];
    if (uniqueTargetIds.length !== targetIds.length) {
      throw new Error('Interleaved four-stage run contains duplicate Target identities.');
    }
    uniqueTargetIds.forEach((targetId) => {
      if (targetId.trim().length === 0) throw new Error('Learning Target identity must not be empty.');
    });
    this.#targetOrder = new Map(uniqueTargetIds.map((targetId, index) => [targetId, index]));
    this.#minGap = Math.max(0, Math.floor(options.minGap ?? 2));
    const protocolRunId = options.protocolRunId
      ?? `four-stage-run:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    if (protocolRunId.trim().length === 0) throw new Error('Protocol Run identity must not be empty.');
    this.#targets = uniqueTargetIds.map((targetId) => ({
      targetId,
      progress: createProtocolProgressState(
        `${protocolRunId}:${encodeURIComponent(targetId)}`,
        INTERLEAVED_FOUR_STAGE_PROTOCOL_DEFINITION,
      ),
      lastSessionOrdinal: -1,
      attempts: 0,
      mistakes: 0,
    }));
    this.next();
  }

  public exportCheckpoint(): string {
    return encodeQueueSnapshot({targetOrder:this.#targetOrder,minGap:this.#minGap,targets:this.#targets,currentSession:this.#currentSession,sessionOrdinal:this.#sessionOrdinal});
  }

  public static restoreCheckpoint<TargetId extends string>(raw:string):InterleavedFourStageQueue<TargetId> {
    const saved=decodeQueueSnapshot<{targetOrder:Map<TargetId,number>;minGap:number;targets:FourStageTargetProgress<TargetId>[];currentSession:FourStageSession<TargetId>|null;sessionOrdinal:number}>(raw);
    const queue=new InterleavedFourStageQueue<TargetId>([...saved.targetOrder.keys()],{minGap:saved.minGap,protocolRunId:'restore'});
    queue.#targets=saved.targets;queue.#currentSession=saved.currentSession;queue.#sessionOrdinal=saved.sessionOrdinal;
    return queue;
  }

  public isDone(): boolean {
    return this.#targets.every((target) => target.progress.completed);
  }

  public getCurrentSession(): FourStageSession<TargetId> | null {
    return this.#currentSession ? { ...this.#currentSession } : null;
  }

  public getProjection(): FourStageQueueProjection<TargetId> {
    return {
      targetCount: this.#targets.length,
      graduatedTargetIds: this.#targets
        .filter((target) => target.progress.completed)
        .map((target) => target.targetId),
      targets: this.#targets.map(cloneTarget),
      currentSession: this.getCurrentSession(),
    };
  }

  public next(): FourStageSession<TargetId> | null {
    if (this.#currentSession?.phase === 'assessment') return this.getCurrentSession();
    if (this.#currentSession?.phase === 'feedback') {
      throw new Error('Feedback must be completed before the next Encounter.');
    }
    if (this.isDone()) {
      this.#currentSession = null;
      return null;
    }

    const nextOrdinal = this.#sessionOrdinal + 1;
    const pending = this.#targets.filter((target) => !target.progress.completed);
    let candidates = pending.filter((target) =>
      target.lastSessionOrdinal < 0
      || nextOrdinal - target.lastSessionOrdinal > this.#minGap);
    if (candidates.length === 0) candidates = [...pending];
    candidates.sort((left, right) => {
      const leftCheckpoint = nextCheckpoint(left)!;
      const rightCheckpoint = nextCheckpoint(right)!;
      return checkpointIndex(leftCheckpoint.checkpointId) - checkpointIndex(rightCheckpoint.checkpointId)
        || left.lastSessionOrdinal - right.lastSessionOrdinal
        || this.#targetOrder.get(left.targetId)! - this.#targetOrder.get(right.targetId)!;
    });

    const target = candidates[0]!;
    const checkpoint = nextCheckpoint(target)!;
    this.#sessionOrdinal = nextOrdinal;
    this.#currentSession = {
      sessionOrdinal: nextOrdinal,
      targetId: target.targetId,
      checkpointId: checkpoint.checkpointId,
      presentation: checkpoint.presentation,
      phase: 'assessment',
      result: null,
    };
    return this.getCurrentSession();
  }

  public settle(satisfied: boolean): FourStageSession<TargetId> | null {
    const session = this.#currentSession;
    if (!session || session.phase !== 'assessment') return this.getCurrentSession();
    const targetIndex = this.#targets.findIndex((target) => target.targetId === session.targetId);
    const target = this.#targets[targetIndex]!;
    const identity = `${target.progress.protocolRunId}:${session.sessionOrdinal}:${session.checkpointId}`;
    const result = decideAndApplyProtocolTransition({
      definition: INTERLEAVED_FOUR_STAGE_PROTOCOL_DEFINITION,
      policy: runResetProgression,
      state: target.progress,
      observation: {
        observationId: `${identity}:assessment`,
        attemptId: `${identity}:attempt`,
        actionId: `${identity}:action`,
        kind: satisfied ? 'checkpoint_satisfied' : 'checkpoint_not_satisfied',
        checkpointId: session.checkpointId,
        evidenceIds: satisfied ? [`${identity}:evidence`] : [],
      },
      decisionId: `${identity}:transition`,
    });
    this.#targets[targetIndex] = {
      ...target,
      progress: result.state,
      lastSessionOrdinal: session.sessionOrdinal,
      attempts: target.attempts + 1,
      mistakes: target.mistakes + (satisfied ? 0 : 1),
    };
    this.#currentSession = { ...session, phase: 'feedback', result: satisfied };
    return this.getCurrentSession();
  }

  /** Detail/feedback is repair instruction, never Checkpoint credit. */
  public completeFeedback(): FourStageSession<TargetId> | null {
    const session = this.#currentSession;
    if (!session || session.phase !== 'feedback') return this.getCurrentSession();
    if (session.result === false) {
      const targetIndex = this.#targets.findIndex((target) => target.targetId === session.targetId);
      const target = this.#targets[targetIndex]!;
      const identity = `${target.progress.protocolRunId}:${session.sessionOrdinal}:${session.checkpointId}`;
      const result = decideAndApplyProtocolTransition({
        definition: INTERLEAVED_FOUR_STAGE_PROTOCOL_DEFINITION,
        policy: runResetProgression,
        state: target.progress,
        observation: {
          observationId: `${identity}:repair`,
          attemptId: `${identity}:repair-attempt`,
          actionId: `${identity}:feedback-action`,
          kind: 'repair_completed',
          checkpointId: session.checkpointId,
          evidenceIds: [],
        },
        decisionId: `${identity}:repair-transition`,
      });
      this.#targets[targetIndex] = { ...target, progress: result.state };
    }
    this.#currentSession = null;
    return this.next();
  }
}

export type FourStageReviewAnswer = 'known' | 'vague' | 'forgotten';

export interface FourStageReviewSession<TargetId extends string> {
  readonly ordinal: number;
  readonly targetId: TargetId;
  readonly mode: 'review' | 'relearning';
  readonly phase: 'assessment' | 'feedback';
  readonly answer: FourStageReviewAnswer | null;
  readonly memoryOutcome: GradedMemoryOutcome | null;
}

export interface FourStageReviewCandidate<TargetId extends string> {
  readonly targetId: TargetId;
  readonly mode: 'review' | 'relearning';
}

/**
 * One due Review emits one graded Outcome. A forgotten Target is requeued as
 * Relearning; its later checks can complete repair but cannot emit a second
 * Outcome for the original due Review.
 */
export class InterleavedFourStageReviewQueue<TargetId extends string> {
  #pending: Array<{ targetId: TargetId; mode: 'review' | 'relearning' }>;
  #current: FourStageReviewSession<TargetId> | null = null;
  #ordinal = 0;
  readonly #outcomes = new Map<TargetId, GradedMemoryOutcome>();
  readonly #completed = new Set<TargetId>();

  public constructor(
    candidates: readonly (TargetId | FourStageReviewCandidate<TargetId>)[],
  ) {
    const normalized = candidates.map((candidate) => typeof candidate === 'string'
      ? { targetId: candidate, mode: 'review' as const }
      : candidate);
    if (new Set(normalized.map((candidate) => candidate.targetId)).size !== normalized.length) {
      throw new Error('Interleaved review contains duplicate Target identities.');
    }
    this.#pending = normalized.map((candidate) => ({ ...candidate }));
    this.next();
  }

  public exportCheckpoint():string {
    return encodeQueueSnapshot({pending:this.#pending,current:this.#current,ordinal:this.#ordinal,outcomes:this.#outcomes,completed:this.#completed});
  }

  public static restoreCheckpoint<TargetId extends string>(raw:string):InterleavedFourStageReviewQueue<TargetId> {
    const saved=decodeQueueSnapshot<{pending:Array<FourStageReviewCandidate<TargetId>>;current:FourStageReviewSession<TargetId>|null;ordinal:number;outcomes:Map<TargetId,GradedMemoryOutcome>;completed:Set<TargetId>}>(raw);
    const queue=new InterleavedFourStageReviewQueue<TargetId>([]);
    queue.#pending=saved.pending;queue.#current=saved.current;queue.#ordinal=saved.ordinal;
    for(const [key,value] of saved.outcomes)queue.#outcomes.set(key,value);
    for(const key of saved.completed)queue.#completed.add(key);
    return queue;
  }

  public getCurrentSession(): FourStageReviewSession<TargetId> | null {
    return this.#current ? { ...this.#current } : null;
  }

  public getMemoryOutcomes(): ReadonlyMap<TargetId, GradedMemoryOutcome> {
    return new Map(this.#outcomes);
  }

  public isDone(): boolean {
    return this.#pending.length === 0 && this.#current === null;
  }

  public next(): FourStageReviewSession<TargetId> | null {
    if (this.#current?.phase === 'assessment') return this.getCurrentSession();
    if (this.#current?.phase === 'feedback') {
      throw new Error('Review feedback must complete before advancing.');
    }
    const candidate = this.#pending.shift();
    if (!candidate) {
      this.#current = null;
      return null;
    }
    this.#ordinal += 1;
    this.#current = {
      ordinal: this.#ordinal,
      ...candidate,
      phase: 'assessment',
      answer: null,
      memoryOutcome: null,
    };
    return this.getCurrentSession();
  }

  public settle(answer: FourStageReviewAnswer): FourStageReviewSession<TargetId> | null {
    const session = this.#current;
    if (!session || session.phase !== 'assessment') return this.getCurrentSession();
    const grade = answer === 'known' ? 'good' : answer === 'vague' ? 'hard' : 'again';
    let memoryOutcome: GradedMemoryOutcome | null = null;
    if (session.mode === 'review') {
      memoryOutcome = resolveLearnerRatedMemoryOutcome(grade);
      if (this.#outcomes.has(session.targetId)) {
        throw new Error(`Due Review for ${session.targetId} already produced a Memory Outcome.`);
      }
      this.#outcomes.set(session.targetId, memoryOutcome);
    }
    if (answer === 'forgotten') {
      this.#pending.push({ targetId: session.targetId, mode: 'relearning' });
    } else {
      this.#completed.add(session.targetId);
    }
    this.#current = { ...session, phase: 'feedback', answer, memoryOutcome };
    return this.getCurrentSession();
  }

  public completeFeedback(): FourStageReviewSession<TargetId> | null {
    if (!this.#current || this.#current.phase !== 'feedback') return this.getCurrentSession();
    this.#current = null;
    return this.next();
  }
}
