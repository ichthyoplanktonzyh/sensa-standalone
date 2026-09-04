import {
  createCheckpointProgressionPolicy,
  createCompletionOnlyProgressionPolicy,
  type ProtocolCompletionPolicy,
  type ProtocolProgressionPolicy,
} from '@sensa/learning-kernel';

/** Open identities are closed again by ProtocolPolicyRegistry at composition time. */
export type EvaluationPolicyId = string & {};
export type ProgressionPolicyId = string & {};
export type CompletionPolicyId = string & {};
export type RepairPolicyId = string & {};
export type MemoryOutcomePolicyId = string & {};

export interface CompletionPolicyDefinition {
  readonly completionPolicyId: CompletionPolicyId;
  readonly policy: ProtocolCompletionPolicy;
}

export interface ProtocolPolicyInventory {
  readonly evaluationPolicyIds: readonly EvaluationPolicyId[];
  readonly progressionPolicies: readonly ProtocolProgressionPolicy[];
  readonly completionPolicies: readonly CompletionPolicyDefinition[];
  readonly repairPolicyIds: readonly RepairPolicyId[];
  readonly memoryOutcomePolicyIds: readonly MemoryOutcomePolicyId[];
}

const uniqueBy = <T>(
  values: readonly T[],
  identityOf: (value: T) => string,
  label: string,
): ReadonlyMap<string, T> => {
  const result = new Map<string, T>();
  for (const value of values) {
    const identity = identityOf(value);
    if (identity.trim().length === 0) throw new Error(`${label} identity must not be empty.`);
    if (result.has(identity)) throw new Error(`Duplicate ${label} identity: ${identity}`);
    result.set(identity, value);
  }
  return result;
};

/**
 * One composition-time registry for the orthogonal policy axes. Runtime code
 * asks for behavior by identity; it never branches on a Profile name.
 */
export class ProtocolPolicyRegistry {
  readonly #evaluationPolicies: ReadonlySet<string>;
  readonly #progressionPolicies: ReadonlyMap<string, ProtocolProgressionPolicy>;
  readonly #completionPolicies: ReadonlyMap<string, CompletionPolicyDefinition>;
  readonly #repairPolicies: ReadonlySet<string>;
  readonly #memoryOutcomePolicies: ReadonlySet<string>;

  public constructor(readonly inventory: ProtocolPolicyInventory) {
    this.#evaluationPolicies = new Set(uniqueBy(
      inventory.evaluationPolicyIds,
      (identity) => identity,
      'Evaluation Policy',
    ).keys());
    this.#progressionPolicies = uniqueBy(
      inventory.progressionPolicies,
      (policy) => policy.progressionPolicyId,
      'Progression Policy',
    );
    this.#completionPolicies = uniqueBy(
      inventory.completionPolicies,
      (definition) => definition.completionPolicyId,
      'Completion Policy',
    );
    this.#repairPolicies = new Set(uniqueBy(
      inventory.repairPolicyIds,
      (identity) => identity,
      'Repair Policy',
    ).keys());
    this.#memoryOutcomePolicies = new Set(uniqueBy(
      inventory.memoryOutcomePolicyIds,
      (identity) => identity,
      'Memory Outcome Policy',
    ).keys());
  }

  public hasEvaluation(identity: EvaluationPolicyId): boolean {
    return this.#evaluationPolicies.has(identity);
  }

  public getProgression(identity: string): ProtocolProgressionPolicy {
    const policy = this.#progressionPolicies.get(identity);
    if (!policy) throw new Error(`Unknown Progression Policy: ${identity}`);
    return policy;
  }

  public getCompletion(identity: CompletionPolicyId): ProtocolCompletionPolicy {
    const definition = this.#completionPolicies.get(identity);
    if (!definition) throw new Error(`Unknown Completion Policy: ${identity}`);
    return definition.policy;
  }

  public hasRepair(identity: RepairPolicyId): boolean {
    return this.#repairPolicies.has(identity);
  }

  public hasMemoryOutcome(identity: MemoryOutcomePolicyId): boolean {
    return this.#memoryOutcomePolicies.has(identity);
  }
}

const COMPLETION_POLICIES: readonly CompletionPolicyDefinition[] = Object.freeze([
  {
    completionPolicyId: 'study-completion-v1',
    policy: { kind: 'protocol_completion' },
  },
  {
    completionPolicyId: 'all-required-current-epoch-v1',
    policy: {
      kind: 'all_required_checkpoints',
      requireSameProgressEpoch: true,
    },
  },
  {
    completionPolicyId: 'one-review-one-outcome-v1',
    policy: { kind: 'protocol_completion' },
  },
  {
    completionPolicyId: 'relearning-completion-v1',
    policy: { kind: 'protocol_completion' },
  },
]);

export const PROTOCOL_POLICY_INVENTORY: ProtocolPolicyInventory = Object.freeze({
  evaluationPolicyIds: Object.freeze([
    'lightweight-practice-observation-v1',
    'learner-rating-v1',
    'structured-behavioral-v1',
    'four-stage-mixed-evaluation-v1',
  ]),
  progressionPolicies: Object.freeze([
    createCompletionOnlyProgressionPolicy('completion-only-v1'),
    createCheckpointProgressionPolicy({
      progressionPolicyId: 'structured-current-checkpoint-reset-v1',
      failureReset: 'current',
    }),
    // Registered before the third Profile exists: adding that Profile should
    // consume this policy, not require a kernel edit.
    createCheckpointProgressionPolicy({
      progressionPolicyId: 'run-reset-v1',
      failureReset: 'run',
    }),
  ]),
  completionPolicies: COMPLETION_POLICIES,
  repairPolicyIds: Object.freeze([
    'lightweight-retry-v1',
    'lightweight-rebinding-v1',
    'structured-targeted-repair-v1',
    'four-stage-detail-repair-v1',
    'four-stage-rebinding-v1',
  ]),
  memoryOutcomePolicyIds: Object.freeze([
    'learner-rated-graded-v1',
    'behavioral-binary-graded-v1',
  ]),
});

export const protocolPolicyRegistry = new ProtocolPolicyRegistry(PROTOCOL_POLICY_INVENTORY);
