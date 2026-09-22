import type { SensaExpressionType } from '@sensa/contracts/sensa';
import type { PersonalMeaningLearningSource } from '../contentSupply/system';
import type { LocalLearningTarget } from '../learning/runtime/localProtocol';

export const PRACTICE_SCOPE_RESOLVER_VERSION = 'practice-scope-resolver-v2';
export const PRACTICE_SCOPE_SNAPSHOT_VERSION = 'practice-scope-snapshot-v1';
export const CURRENT_STUDY_SCOPE_ID = 'current_study';
export const PERSONAL_SEMANTIC_WORLD_SCOPE_ID = 'personal_semantic_world';

export type PracticeScopeSourceId =
  | typeof CURRENT_STUDY_SCOPE_ID
  | typeof PERSONAL_SEMANTIC_WORLD_SCOPE_ID;

export type PracticeScopeSelection =
  | {
      readonly sourceId: typeof CURRENT_STUDY_SCOPE_ID;
    }
  | {
      readonly sourceId: typeof PERSONAL_SEMANTIC_WORLD_SCOPE_ID;
      readonly targetIds: readonly string[];
    };

export type PracticeTargetIdentity =
  | {
      readonly kind: 'learning_target';
      readonly learningTargetId: string;
      readonly curriculumMembershipId: string;
      readonly senseId: string;
      readonly senseVersionId: string;
      readonly bindingId: string;
      readonly bindingVersionId: string;
      readonly learningMaterializationId: string;
    }
  | {
      readonly kind: 'personal_meaning_binding';
      readonly personalMeaningId: string;
      readonly personalMeaningRevisionId: string;
      readonly personalMeaningAlignmentId: string;
      readonly alignmentRevision: number;
      readonly alignmentBasisReferenceId: string;
      readonly senseId: string;
      readonly senseVersionId: string;
      readonly bindingId: string;
      readonly bindingVersionId: string;
    };

/** Capabilities describe what an Activity may resolve from this target. They
 * never imply that the Activity runtime itself has been delivered. */
export interface PracticeTargetCapabilities {
  readonly expressionForm: boolean;
  readonly semanticBinding: boolean;
  readonly context: boolean;
  readonly pronunciation: boolean;
  readonly validatedLearningMaterial: boolean;
}

/**
 * A source-neutral target available to Free Practice.
 *
 * It carries pinned semantic identity and resolvable capabilities, never a
 * formal learning status. Activity-specific resources are resolved later.
 */
export interface PracticeScopeTarget {
  readonly targetId: string;
  readonly identity: PracticeTargetIdentity;
  readonly expression: {
    readonly surfaceForm: string;
    readonly expressionType: SensaExpressionType | null;
    readonly languageTag: string;
    readonly pronunciationVariant: {
      readonly accentLabel: string | null;
      readonly phoneticNotation: string | null;
      readonly audioUrl: string | null;
    } | null;
  };
  readonly sense: {
    readonly senseId: string;
    readonly senseVersionId: string;
    readonly label: string;
  };
  readonly context: {
    readonly sourceKind: 'learning_material' | 'personal_meaning';
    readonly personalMeaningId: string | null;
    readonly preview: string;
    readonly personalSemanticAnchorRevisionIds: readonly string[];
  } | null;
  readonly capabilities: PracticeTargetCapabilities;
  readonly provenance: {
    readonly sourceId: PracticeScopeSourceId;
    readonly sourceLabel: string;
  };
}

export interface ResolvedPracticeScope {
  readonly resolverVersion: typeof PRACTICE_SCOPE_RESOLVER_VERSION;
  readonly sourceId: PracticeScopeSourceId;
  readonly sourceLabel: string;
  readonly title: string;
  readonly targets: readonly PracticeScopeTarget[];
}

export interface PracticeScopeSnapshot extends ResolvedPracticeScope {
  readonly snapshotVersion: typeof PRACTICE_SCOPE_SNAPSHOT_VERSION;
  readonly snapshotId: string;
  readonly capturedAt: string;
}

export interface PracticeScopeSourceOption {
  readonly sourceId: PracticeScopeSourceId;
  readonly title: string;
  readonly subtitle: string;
  readonly targets: readonly PracticeScopeTarget[];
  readonly selectedTargetCount: number;
  readonly selected: boolean;
}

export interface PracticeScopeCatalog {
  readonly selection: PracticeScopeSelection;
  readonly currentScope: ResolvedPracticeScope;
  readonly sources: readonly PracticeScopeSourceOption[];
}

export interface PracticeStudyTarget {
  readonly target: Readonly<{
    id: LocalLearningTarget['id'];
    identity: Pick<
      LocalLearningTarget['identity'],
      'senseId' | 'senseVersionId' | 'senseExpressionBindingId' | 'bindingVersionId'
    >;
    expression: LocalLearningTarget['expression'];
    targetLanguageTag: LocalLearningTarget['targetLanguageTag'];
  }>;
  readonly membership: Readonly<{
    id: string;
    material: Readonly<{
      snapshot: Readonly<{
        learningMaterializationId: string;
        validationStatus: string;
      }>;
      content: Readonly<{
        resources: readonly Readonly<{
          materialRoleKey: string;
          contentPayload: unknown;
        }>[];
      }>;
    }>;
  }>;
}

export interface PracticeScopeInput {
  readonly selection: PracticeScopeSelection;
  readonly personalMeaningSources: readonly PersonalMeaningLearningSource[];
  readonly studyTargets: readonly PracticeStudyTarget[];
  readonly studyTitle: string;
  /** Free Practice follows the active Language Route. */
  readonly activeLanguageTag: string;
}

export const DEFAULT_PRACTICE_SCOPE_SELECTION: PracticeScopeSelection = {
  sourceId: CURRENT_STUDY_SCOPE_ID,
};

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim();

const payloadFor = (
  membership: PracticeStudyTarget['membership'],
  role: string,
): Readonly<Record<string, unknown>> | null => {
  const payload = membership.material.content.resources.find(
    (resource) => resource.materialRoleKey === role,
  )?.contentPayload;
  return payload && typeof payload === 'object'
    ? payload as Readonly<Record<string, unknown>>
    : null;
};

const payloadString = (
  payload: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null => {
  const value = payload?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const expressionTypeFrom = (
  membership: PracticeStudyTarget['membership'],
): SensaExpressionType | null => {
  const kind = payloadString(payloadFor(membership, 'language_structure'), 'expressionKind');
  if (kind === 'word' || kind === 'phrase' || kind === 'construction') return kind;
  if (kind === 'utterance') return 'sentence';
  return null;
};

const targetsFromStudyScope = (
  inputs: readonly PracticeStudyTarget[],
): readonly PracticeScopeTarget[] => inputs.map(({ target, membership }) => {
  const expressionPayload = payloadFor(membership, 'target_expression');
  const sensePayload = payloadFor(membership, 'sense_confirmation');
  const pronunciationPayload = payloadFor(membership, 'pronunciation');
  const contextPayload = payloadFor(membership, 'experience_recall_cue');
  const expression = payloadString(expressionPayload, 'surface') ?? target.expression;
  const meaning = payloadString(sensePayload, 'meaning') ?? target.identity.senseId;
  const contextPreview = compact(
    payloadString(contextPayload, 'scene')
      ?? payloadString(contextPayload, 'senseFocus')
      ?? '',
  );
  const phoneticNotation = payloadString(pronunciationPayload, 'phoneticNotation');
  const accentLabel = payloadString(pronunciationPayload, 'accentLabel');
  const audioUrl = payloadString(pronunciationPayload, 'audioUrl');
  const hasPronunciation = Boolean(phoneticNotation || audioUrl);
  const validatedLearningMaterial = membership.material.snapshot.validationStatus === 'validated';

  return {
    targetId: `learning:${target.id}:${membership.id}`,
    identity: {
      kind: 'learning_target',
      learningTargetId: target.id,
      curriculumMembershipId: membership.id,
      senseId: target.identity.senseId,
      senseVersionId: target.identity.senseVersionId,
      bindingId: target.identity.senseExpressionBindingId,
      bindingVersionId: target.identity.bindingVersionId,
      learningMaterializationId: membership.material.snapshot.learningMaterializationId,
    },
    expression: {
      surfaceForm: expression,
      expressionType: expressionTypeFrom(membership),
      languageTag: target.targetLanguageTag,
      pronunciationVariant: hasPronunciation
        ? { accentLabel, phoneticNotation, audioUrl }
        : null,
    },
    sense: {
      senseId: target.identity.senseId,
      senseVersionId: target.identity.senseVersionId,
      label: meaning,
    },
    context: contextPayload
      ? {
          sourceKind: 'learning_material' as const,
          personalMeaningId: null,
          preview: contextPreview,
          personalSemanticAnchorRevisionIds: [],
        }
      : null,
    capabilities: {
      expressionForm: expression.length > 0,
      semanticBinding: true,
      context: contextPayload !== null,
      pronunciation: hasPronunciation,
      validatedLearningMaterial,
    },
    provenance: {
      sourceId: CURRENT_STUDY_SCOPE_ID,
      sourceLabel: '当前学习内容',
    },
  };
});

const targetsFromPersonalMeanings = (
  sources: readonly PersonalMeaningLearningSource[],
): readonly PracticeScopeTarget[] => {
  const seen = new Set<string>();
  const targets: PracticeScopeTarget[] = [];

  for (const source of sources) {
    const { reference } = source;
    const targetId = `personal:${reference.personalMeaningAlignmentId}:${reference.bindingVersionId}`;
    if (seen.has(targetId)) continue;
    seen.add(targetId);
    const contextPreview = compact(source.context.text);
    const hasContext = contextPreview.length > 0 || source.context.images.length > 0;
    targets.push({
      targetId,
      identity: {
        kind: 'personal_meaning_binding',
        personalMeaningId: reference.personalMeaningId,
        personalMeaningRevisionId: reference.personalMeaningRevisionId,
        personalMeaningAlignmentId: reference.personalMeaningAlignmentId,
        alignmentRevision: reference.alignmentRevision,
        alignmentBasisReferenceId: reference.alignmentBasisReferenceId,
        senseId: reference.senseId,
        senseVersionId: reference.senseVersionId,
        bindingId: reference.bindingId,
        bindingVersionId: reference.bindingVersionId,
      },
      expression: {
        surfaceForm: source.expression.surfaceForm,
        expressionType: source.expression.expressionType,
        languageTag: source.expression.languageTag,
        pronunciationVariant: null,
      },
      sense: {
        senseId: reference.senseId,
        senseVersionId: reference.senseVersionId,
        label: compact(source.semanticSpec.coreMeaningFocus),
      },
      context: hasContext
        ? {
            sourceKind: 'personal_meaning',
            personalMeaningId: reference.personalMeaningId,
            preview: contextPreview,
            personalSemanticAnchorRevisionIds: [
              ...source.context.personalSemanticAnchorRevisionIds,
            ],
          }
        : null,
      capabilities: {
        expressionForm: source.expression.surfaceForm.trim().length > 0,
        semanticBinding: true,
        context: hasContext,
        pronunciation: false,
        validatedLearningMaterial: false,
      },
      provenance: {
        sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
        sourceLabel: '我的语义世界',
      },
    });
  }

  return targets;
};

const uniqueTargetIds = (targetIds: readonly string[]): readonly string[] =>
  [...new Set(targetIds.filter((targetId) => targetId.trim().length > 0))];

/** Resolve every delivered source and the learner's current selection through
 * one interface. An empty Personal Meaning selection falls back to current
 * learning; callers never reproduce that rule. */
export const resolvePracticeScopeCatalog = ({
  selection,
  personalMeaningSources,
  studyTargets,
  studyTitle,
  activeLanguageTag,
}: PracticeScopeInput): PracticeScopeCatalog => {
  const inLanguage = (target: PracticeScopeTarget) =>
    target.expression.languageTag === activeLanguageTag;
  const learningTargets = targetsFromStudyScope(studyTargets).filter(inLanguage);
  const personalTargets = targetsFromPersonalMeanings(personalMeaningSources).filter(inLanguage);
  const personalById = new Map(personalTargets.map((target) => [target.targetId, target] as const));
  const selectedPersonalTargetIds = selection.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID
    ? uniqueTargetIds(selection.targetIds).filter((targetId) => personalById.has(targetId))
    : [];
  const usePersonalScope = selectedPersonalTargetIds.length > 0;
  const normalizedSelection: PracticeScopeSelection = usePersonalScope
    ? { sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID, targetIds: selectedPersonalTargetIds }
    : DEFAULT_PRACTICE_SCOPE_SELECTION;
  const selectedPersonalTargets = selectedPersonalTargetIds
    .map((targetId) => personalById.get(targetId))
    .filter((target): target is PracticeScopeTarget => target !== undefined);
  const currentScope: ResolvedPracticeScope = usePersonalScope
    ? {
        resolverVersion: PRACTICE_SCOPE_RESOLVER_VERSION,
        sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
        sourceLabel: '我的语义世界',
        title: '我的语义世界',
        targets: selectedPersonalTargets,
      }
    : {
        resolverVersion: PRACTICE_SCOPE_RESOLVER_VERSION,
        sourceId: CURRENT_STUDY_SCOPE_ID,
        sourceLabel: '当前学习内容',
        title: studyTitle,
        targets: learningTargets,
      };

  return {
    selection: normalizedSelection,
    currentScope,
    sources: [
      {
        sourceId: CURRENT_STUDY_SCOPE_ID,
        title: '当前学习内容',
        subtitle: studyTitle,
        targets: learningTargets,
        selectedTargetCount: normalizedSelection.sourceId === CURRENT_STUDY_SCOPE_ID
          ? learningTargets.length
          : 0,
        selected: normalizedSelection.sourceId === CURRENT_STUDY_SCOPE_ID,
      },
      {
        sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
        title: '我的语义世界',
        subtitle: '已确认的意思与表达',
        targets: personalTargets,
        selectedTargetCount: normalizedSelection.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID
          ? selectedPersonalTargets.length
          : 0,
        selected: normalizedSelection.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
      },
    ],
  };
};

/** A Practice Session reads a detached snapshot. Later curriculum or Personal
 * Meaning changes only affect the next Session. */
export const createPracticeScopeSnapshot = (
  scope: ResolvedPracticeScope,
  snapshotId: string,
  capturedAt: string,
): PracticeScopeSnapshot => ({
  ...structuredClone(scope),
  snapshotVersion: PRACTICE_SCOPE_SNAPSHOT_VERSION,
  snapshotId,
  capturedAt,
});
