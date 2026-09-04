import type { ContentCapabilitySet } from './contentCapabilities';

/**
 * 一项需要独立长期保持的能力。身份对扩展开放，闭合由 Registry 负责。
 *
 * Scope 不是题型、Card 或一次 Protocol 内的 Gate。只有满足独立提示/响应合同、
 * 可持续分离的表现，以及有实际价值的独立调度时，才允许创建额外 Retention Target。
 */
export type RetentionScopeId = string & {};

export interface IndependentScopeAdmission {
  readonly learnerSelectable: true;
  readonly stableInteractionContract: true;
  readonly separablePerformance: true;
  readonly independentSchedulingValue: true;
}

export interface RetentionScopeDefinition {
  readonly scopeId: RetentionScopeId;
  /** definition 可升级；升级不改变既有 Retention Target identity。 */
  readonly scopeVersion: string;
  readonly kind: 'default' | 'independent';
  readonly label: string;
  readonly targetCapability: string;
  readonly promptChannel: string;
  readonly responseChannel: string;
  readonly contentRequirement: ContentCapabilitySet;
  /** 独立 scope 至多依赖一层，且 prerequisite 自己不能再有 prerequisite。 */
  readonly prerequisite?: RetentionScopeId;
  /** default scope 不需要准入证明；independent scope 四项缺一不可。 */
  readonly admission?: IndependentScopeAdmission;
}

export interface ResolvedRetentionTarget<LearningTargetId extends string = string> {
  readonly retentionTargetId: string;
  readonly learningTargetId: LearningTargetId;
  readonly retentionScopeId: RetentionScopeId;
  readonly retentionScopeVersion: string;
  readonly prerequisiteRetentionTargetId: string | null;
}

export const DEFAULT_RETENTION_SCOPE: RetentionScopeDefinition = {
  scopeId: 'semantic_connection',
  scopeVersion: 'v1',
  kind: 'default',
  label: '语义连接',
  targetCapability: 'sense_expression_connection',
  promptChannel: 'mixed_semantic_cue',
  responseChannel: 'recognition_or_recall',
  contentRequirement: ['compact_learning_material'],
};

const assertNonEmpty = (value: string, field: string): void => {
  if (value.trim().length === 0) throw new Error(`${field} must not be empty.`);
};

/**
 * 稳定身份只含 Learning Target 与 scope identity，不含 definition version、
 * Materialization 或 Protocol version；普通内容/协议升级不能重置记忆。
 */
export const retentionTargetIdFor = (
  learningTargetId: string,
  scopeId: RetentionScopeId,
): string => `retention-target:${encodeURIComponent(learningTargetId)}:${encodeURIComponent(scopeId)}`;

export class RetentionScopeRegistry {
  readonly #definitions: readonly RetentionScopeDefinition[];
  readonly #byId: ReadonlyMap<RetentionScopeId, RetentionScopeDefinition>;
  readonly #defaultScope: RetentionScopeDefinition;

  public constructor(definitions: readonly RetentionScopeDefinition[]) {
    if (definitions.length === 0) throw new Error('Retention Scope Registry must not be empty.');

    const byId = new Map<RetentionScopeId, RetentionScopeDefinition>();
    for (const definition of definitions) {
      assertNonEmpty(definition.scopeId, 'Retention Scope identity');
      assertNonEmpty(definition.scopeVersion, `Retention Scope ${definition.scopeId} version`);
      assertNonEmpty(definition.label, `Retention Scope ${definition.scopeId} label`);
      assertNonEmpty(definition.targetCapability, `Retention Scope ${definition.scopeId} target capability`);
      assertNonEmpty(definition.promptChannel, `Retention Scope ${definition.scopeId} prompt channel`);
      assertNonEmpty(definition.responseChannel, `Retention Scope ${definition.scopeId} response channel`);
      if (definition.contentRequirement.length === 0) {
        throw new Error(`Retention Scope ${definition.scopeId} requires at least one content capability.`);
      }
      definition.contentRequirement.forEach((capabilityId) =>
        assertNonEmpty(capabilityId, `Retention Scope ${definition.scopeId} content capability`));
      if (byId.has(definition.scopeId)) {
        throw new Error(`Duplicate Retention Scope identity: ${definition.scopeId}`);
      }
      if (
        definition.kind === 'independent'
        && (!definition.admission
          || Object.values(definition.admission).some((admitted) => admitted !== true))
      ) {
        throw new Error(`Independent Retention Scope ${definition.scopeId} lacks admission evidence.`);
      }
      if (definition.kind === 'default' && definition.prerequisite) {
        throw new Error(`Default Retention Scope ${definition.scopeId} cannot have a prerequisite.`);
      }
      const contentRequirement = Object.freeze([
        definition.contentRequirement[0],
        ...definition.contentRequirement.slice(1),
      ]) as ContentCapabilitySet;
      const snapshot: RetentionScopeDefinition = Object.freeze({
        ...definition,
        contentRequirement,
        admission: definition.admission
          ? Object.freeze({ ...definition.admission })
          : undefined,
      });
      byId.set(snapshot.scopeId, snapshot);
    }

    const snapshots = [...byId.values()];
    const defaults = snapshots.filter((definition) => definition.kind === 'default');
    if (defaults.length !== 1) {
      throw new Error(`Retention Scope Registry requires exactly one default; received ${defaults.length}.`);
    }

    for (const definition of snapshots) {
      if (!definition.prerequisite) continue;
      const prerequisite = byId.get(definition.prerequisite);
      if (!prerequisite) {
        throw new Error(
          `Retention Scope ${definition.scopeId} has unknown prerequisite ${definition.prerequisite}.`,
        );
      }
      if (prerequisite.prerequisite) {
        throw new Error(
          `Retention Scope ${definition.scopeId} exceeds the one-level prerequisite limit.`,
        );
      }
    }

    this.#definitions = Object.freeze(snapshots);
    this.#byId = byId;
    this.#defaultScope = defaults[0]!;
  }

  public list(): readonly RetentionScopeDefinition[] {
    return this.#definitions;
  }

  public get(scopeId: RetentionScopeId): RetentionScopeDefinition {
    const definition = this.#byId.get(scopeId);
    if (!definition) throw new Error(`Unknown Retention Scope: ${scopeId}`);
    return definition;
  }

  public defaultScope(): RetentionScopeDefinition {
    return this.#defaultScope;
  }

  /**
   * 每条 Learning Target 总有 default Retention Target；独立 scope 只在 learner
   * 显式选择后加入。prerequisite 是运行准入关系，不会隐式创建 learner intent。
   */
  public resolveTargets<LearningTargetId extends string>(
    learningTargetId: LearningTargetId,
    selectedIndependentScopes: readonly RetentionScopeId[] = [],
  ): readonly ResolvedRetentionTarget<LearningTargetId>[] {
    const selected = [...new Set(selectedIndependentScopes)];
    const independentDefinitions = selected.map((scopeId) => {
      const definition = this.get(scopeId);
      if (definition.kind !== 'independent') {
        throw new Error(`Default Retention Scope ${scopeId} must not be selected explicitly.`);
      }
      return definition;
    });
    const selectedIds = new Set<RetentionScopeId>([
      this.#defaultScope.scopeId,
      ...selected,
    ]);
    for (const definition of independentDefinitions) {
      if (definition.prerequisite && !selectedIds.has(definition.prerequisite)) {
        throw new Error(
          `Retention Scope ${definition.scopeId} requires unselected prerequisite ${definition.prerequisite}.`,
        );
      }
    }
    // The registry limits prerequisites to one level, so this stable partition is
    // sufficient to guarantee prerequisite-before-dependent execution order.
    const definitions = [
      this.#defaultScope,
      ...independentDefinitions.filter((definition) =>
        !definition.prerequisite || definition.prerequisite === this.#defaultScope.scopeId),
      ...independentDefinitions.filter((definition) =>
        definition.prerequisite && definition.prerequisite !== this.#defaultScope.scopeId),
    ];

    return definitions.map((definition) => ({
      retentionTargetId: retentionTargetIdFor(learningTargetId, definition.scopeId),
      learningTargetId,
      retentionScopeId: definition.scopeId,
      retentionScopeVersion: definition.scopeVersion,
      prerequisiteRetentionTargetId: definition.prerequisite
        ? retentionTargetIdFor(learningTargetId, definition.prerequisite)
        : null,
    }));
  }
}

export const retentionScopeRegistry = new RetentionScopeRegistry([
  DEFAULT_RETENTION_SCOPE,
]);
