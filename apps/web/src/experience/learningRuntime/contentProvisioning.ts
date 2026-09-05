import type {
  ContentCapabilityId,
  ContentCapabilityReadiness,
  ContentCapabilityReadinessProvider,
  PrototypeLearningReadinessView,
} from './contentCapabilities';

export interface LearningMaterialization<TContent = unknown> {
  readonly materializationId: string;
  readonly capabilityId: ContentCapabilityId;
  readonly materializationVersion: string;
  readonly content: TContent;
}

export interface LearningMaterializationDraft<TContent = unknown> {
  readonly materializationId: string;
  readonly materializationVersion: string;
  readonly content: TContent;
}

/**
 * 一个内容能力的供给适配器。适配器找原料并校验；Registry 统一冻结并赋 capability。
 */
export interface ContentProvisioningAdapter<TTarget, TContent = unknown> {
  readonly capabilityId: ContentCapabilityId;
  readonly readinessFor: (target: TTarget) => PrototypeLearningReadinessView;
  readonly prepare: (target: TTarget) => LearningMaterializationDraft<TContent> | null;
  readonly validate: (target: TTarget, draft: LearningMaterializationDraft<TContent>) => void;
}

export interface ContentProvisioningResult<TContent = unknown>
  extends ContentCapabilityReadiness {
  readonly materialization: LearningMaterialization<TContent> | null;
}

const freezeMaterializationValue = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (value === null || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const child of Object.values(objectValue)) freezeMaterializationValue(child, seen);
  return Object.freeze(value);
};

export class ContentProvisioningRegistry<TTarget> {
  readonly #adapters: readonly ContentProvisioningAdapter<TTarget>[];
  readonly #byCapability: ReadonlyMap<ContentCapabilityId, ContentProvisioningAdapter<TTarget>>;

  public constructor(adapters: readonly ContentProvisioningAdapter<TTarget>[]) {
    const byCapability = new Map<ContentCapabilityId, ContentProvisioningAdapter<TTarget>>();
    for (const adapter of adapters) {
      if (adapter.capabilityId.trim().length === 0) {
        throw new Error('Content Provisioning capability identity must not be empty.');
      }
      if (byCapability.has(adapter.capabilityId)) {
        throw new Error(`Duplicate Content Provisioning capability: ${adapter.capabilityId}`);
      }
      const snapshot = Object.freeze({ ...adapter });
      byCapability.set(snapshot.capabilityId, snapshot);
    }
    this.#adapters = Object.freeze([...byCapability.values()]);
    this.#byCapability = byCapability;
  }

  public list(): readonly ContentProvisioningAdapter<TTarget>[] {
    return this.#adapters;
  }

  public get(capabilityId: ContentCapabilityId): ContentProvisioningAdapter<TTarget> {
    const adapter = this.#byCapability.get(capabilityId);
    if (!adapter) throw new Error(`Unknown Content Provisioning capability: ${capabilityId}`);
    return adapter;
  }

  /** Target + capability → prepare → validate → frozen Materialization。 */
  public resolve(
    target: TTarget,
    capabilityId: ContentCapabilityId,
  ): ContentProvisioningResult {
    const adapter = this.get(capabilityId);
    const draft = adapter.prepare(target);
    if (!draft) {
      return {
        view: adapter.readinessFor(target),
        provisioned: false,
        materializationId: null,
        materialization: null,
      };
    }

    adapter.validate(target, draft);
    if (draft.materializationId.trim().length === 0) {
      throw new Error(`Content capability ${capabilityId} produced an empty Materialization identity.`);
    }
    if (draft.materializationVersion.trim().length === 0) {
      throw new Error(`Content capability ${capabilityId} produced an empty Materialization version.`);
    }
    // Provisioners retain ownership of their draft. Clone before freezing so Runtime
    // immutability never mutates a catalog/cache object shared with another consumer.
    const content = structuredClone(draft.content);
    const materialization = freezeMaterializationValue({
      materializationId: draft.materializationId,
      capabilityId,
      materializationVersion: draft.materializationVersion,
      content: freezeMaterializationValue(content),
    });
    return {
      view: adapter.readinessFor(target),
      provisioned: true,
      materialization,
      materializationId: materialization.materializationId,
    };
  }

  public readinessProvider(target: TTarget): ContentCapabilityReadinessProvider {
    return (capabilityId) => this.resolve(target, capabilityId);
  }
}
