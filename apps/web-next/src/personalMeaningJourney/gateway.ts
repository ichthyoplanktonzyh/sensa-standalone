/**
 * Deep gateway for the Personal Meaning → confirmed Sense journey.
 *
 * The gateway is the sole local v2 fact owner for Personal Meaning identity,
 * revisions, Anchors, Focuses, Construction and proposal lifecycle, and the
 * learner confirmation facts that connect them to the semantic registry. UI
 * callers see a small intent/query interface; they never read storage, the
 * old personal-content service, or mock adapter state directly.
 */

import type {
  SensaConfirmExpressionBindingFact,
  SensaConfirmSenseProposalFact,
  SensaExpressionSnapshot,
  SensaExpressionVersionSnapshot,
  SensaMeaningFocusAcceptanceFact,
  SensaMeaningFocusRevisionSnapshot,
  SensaPersonalExpressionAnchorRevisionSnapshot,
  SensaPersonalExpressionAnchorSnapshot,
  SensaPersonalMeaningAlignmentEvent,
  SensaPersonalMeaningAlignmentSnapshot,
  SensaPersonalMeaningRevisionSnapshot,
  SensaPersonalMeaningSnapshot,
  SensaSenseConstructionSnapshot,
  SensaSenseExpressionBindingSnapshot,
  SensaSenseExpressionBindingVersionSnapshot,
  SensaSenseProposalVersionSnapshot,
  SensaSenseSemanticSpec,
  SensaSenseVersionSnapshot,
} from '@sensa/contracts/sensa';
import { digestOf } from './digest';
import { cryptoRandomIdPort, isUuid, type RandomIdPort } from './ids';
import {
  LocalStoragePort,
  StorageUnavailableError,
  systemClock,
  type ClockPort,
  type StoragePort,
} from './ports';
import { createMockSemanticLlm } from './mockSemanticLlm';
import type {
  ConstructionTurnContext,
  SemanticLlmContext,
  SemanticLlmPort,
} from './semanticLlm';
import { getSeededSenseSpecs } from './scenarios';
import {
  StoreCorruptedError,
  emptyJourneyState,
  loadJourneyState,
  saveJourneyState,
  type CommandReceipt,
  type JourneyState,
  type MeaningJourneyRecord,
} from './store';
import {
  buildDetailView,
  buildListItemView,
  buildWorldItemView,
} from './projection';
import type {
  AcceptMeaningFocusRevisionInput,
  AddAnchorInput,
  AnswerConstructionInput,
  ConfirmExpressionBindingInput,
  ConfirmExpressionBindingResult,
  ConfirmSenseInput,
  CreateMeaningFocusInput,
  CreateMeaningFocusResult,
  CreatePersonalMeaningInput,
  CreatePersonalMeaningResult,
  EditAnchorInput,
  EditMeaningFocusInput,
  FocusRefInput,
  GenerateFocusSuggestionsInput,
  JourneyDetailView,
  JourneyListItemView,
  JourneyWorldItemView,
  RemoveAnchorInput,
  SplitMeaningFocusInput,
} from './types';

const PSW = 'sensa-personal-semantic-world-v1' as const;
const REG = 'sensa-semantic-registry-v1' as const;
const SPEC_SCHEMA = 'sensa-sense-semantic-spec-v1' as const;
const LEARNER_USER_ID = 'sensa-local-learner';
const FAMILIAR_LANG = 'zh-CN';
const TARGET_LANG = 'en';

type PersonalProvenanceKind =
  SensaPersonalMeaningRevisionSnapshot['provenance']['kind'];
type PersonalExpressionVerificationStatus =
  SensaPersonalExpressionAnchorRevisionSnapshot['verificationStatus'];
type SemanticGeneratorProvenance = NonNullable<
  SensaSenseVersionSnapshot['provenance']['generator']
>;
type ProposalGeneratorProvenance = SensaSenseProposalVersionSnapshot['generatorProvenance'];

export interface ConfirmSenseResult {
  senseId: string;
  senseVersionId: string;
  senseProposalVersionId: string;
  meaningFocusRevisionId: string;
  senseProposalConfirmationId: string;
  personalMeaningAlignmentId: string;
  resolution: 'create_new' | 'reuse_existing';
  replayed: boolean;
}

export interface JourneyGatewayStatus {
  ok: boolean;
  error: string | null;
  errorKind: 'corrupted' | 'unavailable' | null;
}

export interface PersonalMeaningJourneyGateway {
  subscribe(listener: () => void): () => void;
  getStatus(): JourneyGatewayStatus;
  reload(): void;
  getListItems(): JourneyListItemView[];
  /**
   * Return the compact and detail projections needed by the semantic world
   * from one v2 fact-store snapshot.
   */
  getWorldItems(): JourneyWorldItemView[];
  getDetail(personalMeaningId: string): JourneyDetailView | null;

  createPersonalMeaning(
    input: CreatePersonalMeaningInput,
  ): Promise<CreatePersonalMeaningResult>;

  addAnchor(input: AddAnchorInput): Promise<void>;
  editAnchor(input: EditAnchorInput): Promise<void>;
  removeAnchor(input: RemoveAnchorInput): Promise<void>;

  generateFocusSuggestions(input: GenerateFocusSuggestionsInput): Promise<void>;
  createMeaningFocus(input: CreateMeaningFocusInput): Promise<CreateMeaningFocusResult>;
  acceptMeaningFocusRevision(input: AcceptMeaningFocusRevisionInput): Promise<void>;
  editMeaningFocus(input: EditMeaningFocusInput): Promise<void>;
  splitMeaningFocus(input: SplitMeaningFocusInput): Promise<void>;

  startConstruction(input: {
    operationId: string;
    personalMeaningId: string;
    meaningFocusId: string;
    meaningFocusRevisionId: string;
  }): Promise<void>;
  answerConstruction(input: AnswerConstructionInput): Promise<void>;
  pauseConstruction(input: FocusRefInput): Promise<void>;
  resumeConstruction(input: FocusRefInput): Promise<void>;
  generateProposal(input: {
    operationId: string;
    personalMeaningId: string;
    meaningFocusId: string;
  }): Promise<void>;
  continueClarifying(input: {
    operationId: string;
    personalMeaningId: string;
    meaningFocusId: string;
  }): Promise<void>;
  rejectProposal(input: {
    operationId: string;
    personalMeaningId: string;
    meaningFocusId: string;
  }): Promise<void>;

  confirmSense(input: ConfirmSenseInput): Promise<ConfirmSenseResult>;
  confirmExpressionBinding(
    input: ConfirmExpressionBindingInput,
  ): Promise<ConfirmExpressionBindingResult>;
}

export interface JourneyGatewayDeps {
  storage: StoragePort;
  clock: ClockPort;
  ids: RandomIdPort;
  llm: SemanticLlmPort;
}

const last = <T>(items: T[]): T | undefined => items[items.length - 1];

const cloneJourneyState = (state: JourneyState): JourneyState =>
  JSON.parse(JSON.stringify(state)) as JourneyState;

const normalizedForm = (surfaceForm: string): string =>
  surfaceForm.trim().toLocaleLowerCase();

const cleanNotes = (notes: string[] | undefined): string[] =>
  (notes ?? []).map((note) => note.trim()).filter(Boolean);

const cloneSpec = (spec: SensaSenseSemanticSpec): SensaSenseSemanticSpec => ({
  schemaVersion: SPEC_SCHEMA,
  coreMeaningFocus: spec.coreMeaningFocus,
  prototypeScenes: spec.prototypeScenes.map((scene) => ({
    summary: scene.summary,
    participantRoles: [...scene.participantRoles],
    states: [...scene.states],
    directionOrCausality: scene.directionOrCausality,
  })),
  includedCases: [...spec.includedCases],
  excludedCases: [...spec.excludedCases],
  neighborContrasts: spec.neighborContrasts.map((contrast) => ({ ...contrast })),
  openQuestions: [...spec.openQuestions],
});

const errorStatus = (cause: unknown): JourneyGatewayStatus => {
  if (cause instanceof StorageUnavailableError) {
    return { ok: false, error: cause.message, errorKind: 'unavailable' };
  }
  if (cause instanceof StoreCorruptedError) {
    return { ok: false, error: cause.message, errorKind: 'corrupted' };
  }
  return {
    ok: false,
    error: cause instanceof Error ? cause.message : '本机个人意义数据不可用。',
    errorKind: 'unavailable',
  };
};

class JourneyGatewayImpl implements PersonalMeaningJourneyGateway {
  private state: JourneyState | null = null;
  private lastPersistedState: JourneyState | null = null;
  private readonly usedIds = new Set<string>();
  private status: JourneyGatewayStatus = { ok: true, error: null, errorKind: null };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: JourneyGatewayDeps) {
    this.load();
  }

  private load(): void {
    try {
      const state = loadJourneyState(this.deps.storage);
      this.rememberIds(state);
      const seeded = this.seedRegistry(state);
      this.state = state;
      this.status = { ok: true, error: null, errorKind: null };
      if (seeded) {
        saveJourneyState(this.deps.storage, state);
      }
      this.lastPersistedState = cloneJourneyState(state);
    } catch (cause) {
      this.state = null;
      this.lastPersistedState = null;
      this.status = errorStatus(cause);
    }
  }

  reload(): void {
    this.load();
    this.notify();
  }

  getStatus(): JourneyGatewayStatus {
    return { ...this.status };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  private requireState(): JourneyState {
    if (!this.state) {
      throw new Error(this.status.error ?? '本机个人意义数据不可用。');
    }
    return this.state;
  }

  private persist(): void {
    const state = this.requireState();
    try {
      saveJourneyState(this.deps.storage, state);
      this.lastPersistedState = cloneJourneyState(state);
      this.status = { ok: true, error: null, errorKind: null };
    } catch (cause) {
      if (this.lastPersistedState) {
        this.state = cloneJourneyState(this.lastPersistedState);
      }
      this.status = errorStatus(cause);
      this.notify();
      throw cause;
    }
    this.notify();
  }

  private id(): string {
    for (;;) {
      const candidate = this.deps.ids.next();
      if (!isUuid(candidate)) {
        throw new Error('本机 ID 生成器返回了无效 UUID。');
      }
      if (this.usedIds.has(candidate)) continue;
      this.usedIds.add(candidate);
      return candidate;
    }
  }

  private rememberIds(value: unknown): void {
    if (typeof value === 'string') {
      if (isUuid(value)) this.usedIds.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => this.rememberIds(item));
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach((item) => this.rememberIds(item));
    }
  }

  private now(): string {
    return this.deps.clock.nowIso();
  }

  private receipt(operationId: string, command: string): CommandReceipt | null {
    const found = this.requireState().commandReceipts.find(
      (candidate) => candidate.operationId === operationId,
    );
    if (found && found.command !== command) {
      throw new Error('这个 operationId 已用于另一个个人意义操作。');
    }
    return found ?? null;
  }

  private recordReceipt(
    operationId: string,
    command: string,
    result: Record<string, string | number | boolean | null>,
  ): void {
    this.requireState().commandReceipts.push({ operationId, command, result });
  }

  private replay<T>(operationId: string, command: string): T | null {
    const found = this.receipt(operationId, command);
    return found ? ({ ...found.result, replayed: true } as T) : null;
  }

  // -- registry ------------------------------------------------------------

  private seedRegistry(state: JourneyState): boolean {
    let seededAny = false;
    for (const seed of getSeededSenseSpecs()) {
      if (state.registry.senses.some((sense) => sense.senseKey === seed.senseKey)) {
        continue;
      }
      seededAny = true;
      const senseId = this.id();
      const senseVersionId = this.id();
      const createdAt = this.now();
      const generator: SemanticGeneratorProvenance = {
        provider: 'editorial',
        model: 'sensa-seed',
        promptVersion: 'seed-v1',
        policyVersion: 'sensa-semantic-policy-seed-v1',
        inputDigest: digestOf(seed.senseKey),
        outputDigest: digestOf(seed.proposal),
      };
      state.registry.senses.push({
        contractVersion: REG,
        senseId,
        senseKey: seed.senseKey,
        currentSenseVersionId: senseVersionId,
        currentVersionNumber: 1,
        createdAt,
      });
      state.registry.senseVersions.push({
        contractVersion: REG,
        senseVersionId,
        senseId,
        versionNumber: 1,
        origin: 'editorial',
        semanticPolicyVersion: 'sensa-semantic-policy-seed-v1',
        semanticSpec: this.buildSemanticSpec(seed.proposal),
        provenance: {
          sourceKind: 'editorial',
          sourceReferenceIds: [seed.senseKey],
          generator,
        },
        reviewStatus: 'reviewed',
        contentReleaseId: null,
        createdAt,
      });
    }
    return seededAny;
  }

  private buildSemanticSpec(proposal: {
    coreMeaningFocus: string;
    prototypeScenes: SensaSenseSemanticSpec['prototypeScenes'];
    includedCases: string[];
    excludedCases: string[];
    neighborContrasts: SensaSenseSemanticSpec['neighborContrasts'];
    openQuestions: string[];
  }): SensaSenseSemanticSpec {
    return cloneSpec({
      schemaVersion: SPEC_SCHEMA,
      coreMeaningFocus: proposal.coreMeaningFocus,
      prototypeScenes: proposal.prototypeScenes,
      includedCases: proposal.includedCases,
      excludedCases: proposal.excludedCases,
      neighborContrasts: proposal.neighborContrasts,
      openQuestions: proposal.openQuestions,
    });
  }

  // -- Personal Meaning record helpers ------------------------------------

  private findRecord(personalMeaningId: string): MeaningJourneyRecord | null {
    return this.requireState().meanings.find(
      (record) => record.personalMeaning.personalMeaningId === personalMeaningId,
    ) ?? null;
  }

  private requireRecord(personalMeaningId: string): MeaningJourneyRecord {
    const record = this.findRecord(personalMeaningId);
    if (!record) throw new Error('找不到这条个人意义。');
    return record;
  }

  private activeExpressionAnchors(record: MeaningJourneyRecord) {
    return record.personalExpressionAnchors.filter((anchor) => anchor.status === 'active');
  }

  private currentExpressionAnchorRevision(
    record: MeaningJourneyRecord,
    anchor: SensaPersonalExpressionAnchorSnapshot,
  ): SensaPersonalExpressionAnchorRevisionSnapshot | null {
    return record.personalExpressionAnchorRevisions.find(
      (revision) =>
        revision.personalExpressionAnchorId === anchor.personalExpressionAnchorId
        && revision.revision === anchor.currentRevision,
    ) ?? null;
  }

  private activeFamiliarAnchors(record: MeaningJourneyRecord) {
    return this.activeExpressionAnchors(record).filter((anchor) =>
      this.currentExpressionAnchorRevision(record, anchor)?.learnerLanguageRole === 'familiar',
    );
  }

  private activeTargetExpressionAnchors(record: MeaningJourneyRecord) {
    return this.activeExpressionAnchors(record).filter((anchor) =>
      this.currentExpressionAnchorRevision(record, anchor)?.learnerLanguageRole === 'target',
    );
  }

  private activeExperienceAnchors(record: MeaningJourneyRecord) {
    return record.personalSemanticAnchors.filter((anchor) => anchor.status === 'active');
  }

  private displayLabel(record: MeaningJourneyRecord): string | null {
    const familiar = this.activeFamiliarAnchors(record)
      .map((anchor) => record.personalExpressionAnchorRevisions.find(
        (revision) =>
          revision.personalExpressionAnchorId === anchor.personalExpressionAnchorId
          && revision.revision === anchor.currentRevision,
      )?.surfaceForm)
      .find(Boolean);
    if (familiar) return familiar;
    const experience = this.activeExperienceAnchors(record)
      .map((anchor) => record.personalSemanticAnchorRevisions.find(
        (revision) =>
          revision.personalSemanticAnchorId === anchor.personalSemanticAnchorId
          && revision.revision === anchor.currentRevision,
      )?.bodyText)
      .find(Boolean);
    if (!experience) return null;
    return experience.length > 24 ? `${experience.slice(0, 24)}…` : experience;
  }

  private latestMeaningRevision(record: MeaningJourneyRecord) {
    return record.personalMeaningRevisions.find(
      (revision) => revision.revision === record.personalMeaning.currentRevision,
    ) ?? last(record.personalMeaningRevisions);
  }

  private appendMeaningRevision(
    record: MeaningJourneyRecord,
    operationId: string,
    sourceReferenceIds: string[],
  ): string {
    const nextRevision = record.personalMeaning.currentRevision + 1;
    const revisionId = this.id();
    const now = this.now();
    record.personalMeaning.currentRevision = nextRevision;
    record.personalMeaning.updatedAt = now;
    record.personalMeaningRevisions.push({
      contractVersion: PSW,
      personalMeaningRevisionId: revisionId,
      personalMeaningId: record.personalMeaning.personalMeaningId,
      revision: nextRevision,
      displayLabel: this.displayLabel(record),
      learnerIntentNote: this.latestMeaningRevision(record)?.learnerIntentNote ?? null,
      provenance: {
        kind: 'learner_authored',
        sourceReferenceIds: sourceReferenceIds.length > 0
          ? sourceReferenceIds
          : [record.personalMeaning.personalMeaningId],
        createdByOperationId: operationId,
      },
      createdAt: now,
    });
    return revisionId;
  }

  private meaningContext(record: MeaningJourneyRecord): SemanticLlmContext {
    return {
      familiarExpressions: this.activeFamiliarAnchors(record).flatMap((anchor) => {
        const revision = record.personalExpressionAnchorRevisions.find(
          (candidate) =>
            candidate.personalExpressionAnchorId === anchor.personalExpressionAnchorId
            && candidate.revision === anchor.currentRevision,
        );
        return revision
          ? [{ surfaceForm: revision.surfaceForm, expressionType: revision.expressionType }]
          : [];
      }),
      experienceAnchors: this.activeExperienceAnchors(record).flatMap((anchor) => {
        const revision = record.personalSemanticAnchorRevisions.find(
          (candidate) =>
            candidate.personalSemanticAnchorId === anchor.personalSemanticAnchorId
            && candidate.revision === anchor.currentRevision,
        );
        return revision?.bodyText ? [{ bodyText: revision.bodyText }] : [];
      }),
      learnerIntentNote: this.latestMeaningRevision(record)?.learnerIntentNote ?? null,
    };
  }

  private meaningFocus(record: MeaningJourneyRecord, meaningFocusId: string) {
    return record.focuses.find((focus) => focus.meaningFocusId === meaningFocusId) ?? null;
  }

  private currentFocusRevision(
    record: MeaningJourneyRecord,
    meaningFocusId: string,
  ): SensaMeaningFocusRevisionSnapshot {
    const focus = this.meaningFocus(record, meaningFocusId);
    if (!focus) throw new Error('找不到这个 Meaning Focus。');
    const revision = record.focusRevisions.find(
      (candidate) =>
        candidate.meaningFocusId === meaningFocusId
        && candidate.revision === focus.currentRevision,
    );
    if (!revision) throw new Error('找不到 Focus 的当前修订。');
    return revision;
  }

  private acceptedCurrentFocusRevision(
    record: MeaningJourneyRecord,
    meaningFocusId: string,
    expectedRevisionId?: string,
  ): SensaMeaningFocusRevisionSnapshot {
    const focus = this.meaningFocus(record, meaningFocusId);
    if (!focus || focus.acceptedRevision === null || focus.acceptedRevision !== focus.currentRevision) {
      throw new Error('请先接受这个 Focus 的当前修订。');
    }
    const revision = this.currentFocusRevision(record, meaningFocusId);
    if (expectedRevisionId && revision.meaningFocusRevisionId !== expectedRevisionId) {
      throw new Error('Focus 已更新，请重新读取后再操作。');
    }
    return revision;
  }

  private latestConstruction(record: MeaningJourneyRecord, meaningFocusId: string) {
    return record.constructions
      .filter((construction) => construction.meaningFocusId === meaningFocusId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  }

  private currentConstruction(record: MeaningJourneyRecord, meaningFocusId: string) {
    const construction = this.latestConstruction(record, meaningFocusId);
    if (!construction) return null;
    const currentFocusRevision = this.currentFocusRevision(record, meaningFocusId);
    return construction.meaningFocusRevisionId === currentFocusRevision.meaningFocusRevisionId
      ? construction
      : null;
  }

  private constructionTurns(record: MeaningJourneyRecord, senseConstructionId: string) {
    return record.constructionTurns
      .filter((turn) => turn.senseConstructionId === senseConstructionId)
      .sort((left, right) => left.ordinal - right.ordinal);
  }

  private proposalForConstruction(
    record: MeaningJourneyRecord,
    senseConstructionId: string,
  ) {
    return record.proposals.find(
      (proposal) => proposal.senseConstructionId === senseConstructionId,
    ) ?? null;
  }

  private addTurn(
    record: MeaningJourneyRecord,
    senseConstructionId: string,
    actor: 'learner' | 'semantic_llm' | 'system',
    body: string,
    modelProvenance: { provider: string; model: string; promptVersion: string } | null,
    inputSeed: unknown,
  ): void {
    const ordinal = this.constructionTurns(record, senseConstructionId).length + 1;
    record.constructionTurns.push({
      contractVersion: PSW,
      constructionTurnId: this.id(),
      senseConstructionId,
      ordinal,
      actor,
      body,
      inputDigest: inputSeed === null ? null : digestOf(inputSeed),
      outputDigest: digestOf(body),
      modelProvenance,
      occurredAt: this.now(),
    });
  }

  private constructionContext(
    record: MeaningJourneyRecord,
    construction: SensaSenseConstructionSnapshot,
    extraTurns: ConstructionTurnContext['priorTurns'] = [],
  ): ConstructionTurnContext {
    const focusRevision = record.focusRevisions.find(
      (revision) => revision.meaningFocusRevisionId === construction.meaningFocusRevisionId,
    );
    if (!focusRevision) throw new Error('Construction 引用的 Focus 修订不存在。');
    return {
      ...this.meaningContext(record),
      focusStatement: focusRevision.statement,
      focusDistinguishingNotes: [...focusRevision.distinguishingNotes],
      priorTurns: [
        ...this.constructionTurns(record, construction.senseConstructionId).map((turn) => ({
          actor: turn.actor,
          body: turn.body,
        })),
        ...extraTurns,
      ],
    };
  }

  // -- queries -------------------------------------------------------------

  getListItems(): JourneyListItemView[] {
    if (!this.state) return [];
    return this.state.meanings
      .filter((record) => record.personalMeaning.status === 'active')
      .map((record) => buildListItemView(record, this.state!.registry));
  }

  getWorldItems(): JourneyWorldItemView[] {
    if (!this.state) return [];
    return this.state.meanings
      .filter((record) => record.personalMeaning.status === 'active')
      .map((record) => buildWorldItemView(record, this.state!.registry));
  }

  getDetail(personalMeaningId: string): JourneyDetailView | null {
    if (!this.state) return null;
    const record = this.findRecord(personalMeaningId);
    return record ? buildDetailView(record, this.state.registry) : null;
  }

  // -- Personal Meaning creation ------------------------------------------

  async createPersonalMeaning(
    input: CreatePersonalMeaningInput,
  ): Promise<CreatePersonalMeaningResult> {
    const replay = this.replay<CreatePersonalMeaningResult>(
      input.operationId,
      'CreatePersonalMeaning',
    );
    if (replay) return replay;
    const state = this.requireState();
    const familiarSurface = input.familiarExpression?.surfaceForm.trim() ?? '';
    const experience = input.experience?.trim() ?? '';
    if (!familiarSurface && !experience) {
      throw new Error('个人意义至少需要一个熟悉表达或一段具体经验。');
    }
    if (input.familiarExpression && !familiarSurface) {
      throw new Error('熟悉表达不能为空。');
    }
    if (input.familiarExpression?.languageTag && input.familiarExpression.languageTag !== FAMILIAR_LANG) {
      throw new Error('首版熟悉表达使用中文（zh-CN）。');
    }

    const personalMeaningId = this.id();
    const personalMeaningRevisionId = this.id();
    const now = this.now();
    const familiarExpressionAnchorId = familiarSurface ? this.id() : null;
    const familiarExpressionAnchorRevisionId = familiarSurface ? this.id() : null;
    const experienceAnchorId = experience ? this.id() : null;
    const experienceAnchorRevisionId = experience ? this.id() : null;
    const sourceReferenceIds = [
      familiarExpressionAnchorId,
      experienceAnchorId,
    ].filter((id): id is string => id !== null);

    const personalMeaning: SensaPersonalMeaningSnapshot = {
      contractVersion: PSW,
      personalMeaningId,
      learnerUserId: LEARNER_USER_ID,
      currentRevision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const record: MeaningJourneyRecord = {
      personalMeaning,
      personalMeaningRevisions: [{
        contractVersion: PSW,
        personalMeaningRevisionId,
        personalMeaningId,
        revision: 1,
        displayLabel: familiarSurface
          || (experience.length > 24 ? `${experience.slice(0, 24)}…` : experience),
        learnerIntentNote: null,
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds,
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      }],
      personalSemanticAnchors: [],
      personalSemanticAnchorRevisions: [],
      personalExpressionAnchors: [],
      personalExpressionAnchorRevisions: [],
      focuses: [],
      focusRevisions: [],
      focusAcceptances: [],
      constructions: [],
      constructionTurns: [],
      proposals: [],
      proposalVersions: [],
      senseConfirmations: [],
      alignments: [],
      alignmentEvents: [],
      bindingConfirmations: [],
      mockState: {
        focusSuggestions: null,
        constructionHints: {},
        proposalSenseKeys: {},
        focusAspectLabels: {},
      },
    };

    if (familiarSurface && familiarExpressionAnchorId && familiarExpressionAnchorRevisionId) {
      const expressionType = input.familiarExpression!.expressionType;
      record.personalExpressionAnchors.push({
        contractVersion: PSW,
        personalExpressionAnchorId: familiarExpressionAnchorId,
        personalMeaningId,
        currentRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      record.personalExpressionAnchorRevisions.push({
        contractVersion: PSW,
        personalExpressionAnchorRevisionId: familiarExpressionAnchorRevisionId,
        personalExpressionAnchorId: familiarExpressionAnchorId,
        revision: 1,
        expressionType,
        languageTag: FAMILIAR_LANG,
        learnerLanguageRole: 'familiar',
        surfaceForm: familiarSurface,
        normalizedForm: normalizedForm(familiarSurface),
        provenanceKind: 'learner_authored',
        verificationStatus: 'unverified',
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds: [familiarExpressionAnchorId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
    }
    if (experience && experienceAnchorId && experienceAnchorRevisionId) {
      record.personalSemanticAnchors.push({
        contractVersion: PSW,
        personalSemanticAnchorId: experienceAnchorId,
        personalMeaningId,
        currentRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      record.personalSemanticAnchorRevisions.push({
        contractVersion: PSW,
        personalSemanticAnchorRevisionId: experienceAnchorRevisionId,
        personalSemanticAnchorId: experienceAnchorId,
        revision: 1,
        anchorKind: 'scene',
        languageTag: FAMILIAR_LANG,
        bodyText: experience,
        personalMediaObjectId: null,
        structuredPayload: {},
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds: [experienceAnchorId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
    }

    state.meanings.push(record);
    const result = {
      personalMeaningId,
      personalMeaningRevisionId,
      familiarExpressionAnchorId,
      experienceAnchorId,
    };
    this.recordReceipt(input.operationId, 'CreatePersonalMeaning', result);
    this.persist();
    return { ...result, replayed: false };
  }

  // -- Anchor commands -----------------------------------------------------

  async addAnchor(input: AddAnchorInput): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'AddAnchor')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const surfaceForm = input.surfaceForm.trim();
    if (!surfaceForm) throw new Error('锚点内容不能为空。');
    const now = this.now();
    const anchorId = this.id();
    const revisionId = this.id();
    if (input.kind === 'familiar_expression') {
      if (!input.expressionType) throw new Error('熟悉表达锚点必须保留表达类型。');
      record.personalExpressionAnchors.push({
        contractVersion: PSW,
        personalExpressionAnchorId: anchorId,
        personalMeaningId: input.personalMeaningId,
        currentRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      record.personalExpressionAnchorRevisions.push({
        contractVersion: PSW,
        personalExpressionAnchorRevisionId: revisionId,
        personalExpressionAnchorId: anchorId,
        revision: 1,
        expressionType: input.expressionType,
        languageTag: FAMILIAR_LANG,
        learnerLanguageRole: 'familiar',
        surfaceForm,
        normalizedForm: normalizedForm(surfaceForm),
        provenanceKind: 'learner_authored',
        verificationStatus: 'unverified',
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds: [anchorId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
    } else {
      record.personalSemanticAnchors.push({
        contractVersion: PSW,
        personalSemanticAnchorId: anchorId,
        personalMeaningId: input.personalMeaningId,
        currentRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      record.personalSemanticAnchorRevisions.push({
        contractVersion: PSW,
        personalSemanticAnchorRevisionId: revisionId,
        personalSemanticAnchorId: anchorId,
        revision: 1,
        anchorKind: 'scene',
        languageTag: FAMILIAR_LANG,
        bodyText: surfaceForm,
        personalMediaObjectId: null,
        structuredPayload: {},
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds: [anchorId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
    }
    this.appendMeaningRevision(record, input.operationId, [anchorId]);
    this.recordReceipt(input.operationId, 'AddAnchor', { anchorId, revision: 1 });
    this.persist();
  }

  async editAnchor(input: EditAnchorInput): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'EditAnchor')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const surfaceForm = input.surfaceForm.trim();
    if (!surfaceForm) throw new Error('锚点内容不能为空。');
    const now = this.now();
    if (input.kind === 'familiar_expression') {
      const anchor = record.personalExpressionAnchors.find(
        (candidate) => candidate.personalExpressionAnchorId === input.anchorId,
      );
      if (!anchor || anchor.status !== 'active') throw new Error('找不到可编辑的熟悉表达锚点。');
      if (this.currentExpressionAnchorRevision(record, anchor)?.learnerLanguageRole !== 'familiar') {
        throw new Error('目标语言表达 Anchor 只能通过独立的 Binding 操作修改。');
      }
      if (!input.expressionType) throw new Error('熟悉表达锚点必须保留表达类型。');
      const previous = record.personalExpressionAnchorRevisions.find(
        (candidate) =>
          candidate.personalExpressionAnchorId === input.anchorId
          && candidate.revision === anchor.currentRevision,
      );
      if (!previous) throw new Error('找不到锚点的当前修订。');
      const nextRevision = anchor.currentRevision + 1;
      anchor.currentRevision = nextRevision;
      anchor.updatedAt = now;
      record.personalExpressionAnchorRevisions.push({
        ...previous,
        personalExpressionAnchorRevisionId: this.id(),
        revision: nextRevision,
        expressionType: input.expressionType,
        surfaceForm,
        normalizedForm: normalizedForm(surfaceForm),
        provenanceKind: 'learner_authored',
        verificationStatus: 'unverified',
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds: [input.anchorId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
    } else {
      const anchor = record.personalSemanticAnchors.find(
        (candidate) => candidate.personalSemanticAnchorId === input.anchorId,
      );
      if (!anchor || anchor.status !== 'active') throw new Error('找不到可编辑的经验锚点。');
      const previous = record.personalSemanticAnchorRevisions.find(
        (candidate) =>
          candidate.personalSemanticAnchorId === input.anchorId
          && candidate.revision === anchor.currentRevision,
      );
      if (!previous) throw new Error('找不到锚点的当前修订。');
      const nextRevision = anchor.currentRevision + 1;
      anchor.currentRevision = nextRevision;
      anchor.updatedAt = now;
      record.personalSemanticAnchorRevisions.push({
        ...previous,
        personalSemanticAnchorRevisionId: this.id(),
        revision: nextRevision,
        bodyText: surfaceForm,
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds: [input.anchorId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
    }
    this.appendMeaningRevision(record, input.operationId, [input.anchorId]);
    this.recordReceipt(input.operationId, 'EditAnchor', {
      anchorId: input.anchorId,
      revision: input.kind === 'familiar_expression'
        ? record.personalExpressionAnchors.find((anchor) => anchor.personalExpressionAnchorId === input.anchorId)!.currentRevision
        : record.personalSemanticAnchors.find((anchor) => anchor.personalSemanticAnchorId === input.anchorId)!.currentRevision,
    });
    this.persist();
  }

  async removeAnchor(input: RemoveAnchorInput): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'RemoveAnchor')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const now = this.now();
    if (input.kind === 'familiar_expression') {
      const anchor = record.personalExpressionAnchors.find(
        (candidate) => candidate.personalExpressionAnchorId === input.anchorId,
      );
      if (!anchor || anchor.status !== 'active') throw new Error('找不到可移除的熟悉表达锚点。');
      if (this.currentExpressionAnchorRevision(record, anchor)?.learnerLanguageRole !== 'familiar') {
        throw new Error('目标语言表达 Anchor 只能通过独立的 Binding 操作修改。');
      }
      const previous = record.personalExpressionAnchorRevisions.find(
        (candidate) =>
          candidate.personalExpressionAnchorId === input.anchorId
          && candidate.revision === anchor.currentRevision,
      );
      if (!previous) throw new Error('找不到锚点的当前修订。');
      const nextRevision = anchor.currentRevision + 1;
      anchor.currentRevision = nextRevision;
      anchor.status = 'deleted';
      anchor.deletedAt = now;
      anchor.updatedAt = now;
      record.personalExpressionAnchorRevisions.push({
        ...previous,
        personalExpressionAnchorRevisionId: this.id(),
        revision: nextRevision,
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds: [input.anchorId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
    } else {
      const anchor = record.personalSemanticAnchors.find(
        (candidate) => candidate.personalSemanticAnchorId === input.anchorId,
      );
      if (!anchor || anchor.status !== 'active') throw new Error('找不到可移除的经验锚点。');
      const previous = record.personalSemanticAnchorRevisions.find(
        (candidate) =>
          candidate.personalSemanticAnchorId === input.anchorId
          && candidate.revision === anchor.currentRevision,
      );
      if (!previous) throw new Error('找不到锚点的当前修订。');
      const nextRevision = anchor.currentRevision + 1;
      anchor.currentRevision = nextRevision;
      anchor.status = 'deleted';
      anchor.deletedAt = now;
      anchor.updatedAt = now;
      record.personalSemanticAnchorRevisions.push({
        ...previous,
        personalSemanticAnchorRevisionId: this.id(),
        revision: nextRevision,
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds: [input.anchorId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
    }
    this.appendMeaningRevision(record, input.operationId, [input.anchorId]);
    this.recordReceipt(input.operationId, 'RemoveAnchor', { anchorId: input.anchorId });
    this.persist();
  }

  // -- Focus commands ------------------------------------------------------

  async generateFocusSuggestions(input: GenerateFocusSuggestionsInput): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'GenerateFocusSuggestions')) return;
    const record = this.requireRecord(input.personalMeaningId);
    if (record.mockState.focusSuggestions) {
      this.recordReceipt(input.operationId, 'GenerateFocusSuggestions', {
        suggestionCount: record.mockState.focusSuggestions.items.length,
      });
      this.persist();
      return;
    }
    const result = await this.deps.llm.suggestMeaningFocuses(this.meaningContext(record));
    const items = result.focuses.map((focus) => ({
      suggestionId: this.id(),
      statement: focus.statement,
      distinguishingNotes: [...focus.distinguishingNotes],
      aspectLabel: focus.aspectLabel,
    }));
    record.mockState.focusSuggestions = {
      multipleAspects: result.multipleAspects,
      provenance: result.provenance,
      items,
    };
    this.recordReceipt(input.operationId, 'GenerateFocusSuggestions', {
      suggestionCount: items.length,
    });
    this.persist();
  }

  async createMeaningFocus(input: CreateMeaningFocusInput): Promise<CreateMeaningFocusResult> {
    const replay = this.replay<CreateMeaningFocusResult>(input.operationId, 'CreateMeaningFocus');
    if (replay) return replay;
    const record = this.requireRecord(input.personalMeaningId);
    const suggestion = input.suggestionId
      ? record.mockState.focusSuggestions?.items.find(
          (candidate) => candidate.suggestionId === input.suggestionId,
        )
      : undefined;
    if (input.suggestionId && !suggestion) throw new Error('找不到这个 Focus 建议。');
    const statement = (input.statement ?? suggestion?.statement ?? '').trim();
    if (!statement) throw new Error('Focus 陈述不能为空。');
    const notes = cleanNotes(input.distinguishingNotes ?? suggestion?.distinguishingNotes);
    const aspectLabel = (input.aspectLabel ?? suggestion?.aspectLabel ?? '').trim() || null;
    const unchangedSuggestion = Boolean(
      suggestion
      && statement === suggestion.statement
      && JSON.stringify(notes) === JSON.stringify(suggestion.distinguishingNotes)
      && (aspectLabel ?? '') === suggestion.aspectLabel,
    );
    const meaningFocusId = this.id();
    const meaningFocusRevisionId = this.id();
    const now = this.now();
    const provenanceKind: PersonalProvenanceKind = unchangedSuggestion
      ? 'llm_suggested'
      : 'learner_authored';
    record.focuses.push({
      contractVersion: PSW,
      meaningFocusId,
      personalMeaningId: input.personalMeaningId,
      splitFromMeaningFocusId: null,
      currentRevision: 1,
      acceptedRevision: null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    record.focusRevisions.push({
      contractVersion: PSW,
      meaningFocusRevisionId,
      meaningFocusId,
      revision: 1,
      statement,
      distinguishingNotes: notes,
      provenance: {
        kind: provenanceKind,
        sourceReferenceIds: input.suggestionId
          ? [input.suggestionId]
          : [input.personalMeaningId],
        createdByOperationId: input.operationId,
      },
      createdAt: now,
    });
    if (aspectLabel) record.mockState.focusAspectLabels[meaningFocusId] = aspectLabel;
    const result = { meaningFocusId, meaningFocusRevisionId };
    this.recordReceipt(input.operationId, 'CreateMeaningFocus', result);
    this.persist();
    return { ...result, replayed: false };
  }

  async acceptMeaningFocusRevision(
    input: AcceptMeaningFocusRevisionInput,
  ): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'AcceptMeaningFocusRevision')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const focus = this.meaningFocus(record, input.meaningFocusId);
    if (!focus) throw new Error('找不到这个 Meaning Focus。');
    const revision = this.currentFocusRevision(record, input.meaningFocusId);
    if (revision.meaningFocusRevisionId !== input.meaningFocusRevisionId) {
      throw new Error('Focus 已更新，请重新读取后再接受。');
    }
    const existing = record.focusAcceptances.find(
      (fact) =>
        fact.meaningFocusId === input.meaningFocusId
        && fact.meaningFocusRevisionId === input.meaningFocusRevisionId,
    );
    if (existing) {
      focus.acceptedRevision = focus.currentRevision;
      this.recordReceipt(input.operationId, 'AcceptMeaningFocusRevision', {
        meaningFocusAcceptanceId: existing.meaningFocusAcceptanceId,
      });
      this.persist();
      return;
    }
    const now = this.now();
    focus.acceptedRevision = focus.currentRevision;
    focus.updatedAt = now;
    const acceptance: SensaMeaningFocusAcceptanceFact = {
      contractVersion: PSW,
      meaningFocusAcceptanceId: this.id(),
      meaningFocusId: input.meaningFocusId,
      meaningFocusRevisionId: input.meaningFocusRevisionId,
      operationId: input.operationId,
      acceptedAt: now,
    };
    record.focusAcceptances.push(acceptance);
    this.recordReceipt(input.operationId, 'AcceptMeaningFocusRevision', {
      meaningFocusAcceptanceId: acceptance.meaningFocusAcceptanceId,
    });
    this.persist();
  }

  async editMeaningFocus(input: EditMeaningFocusInput): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'EditMeaningFocus')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const focus = this.meaningFocus(record, input.meaningFocusId);
    if (!focus) throw new Error('找不到这个 Meaning Focus。');
    if (record.alignments.some(
      (alignment) => alignment.meaningFocusId === input.meaningFocusId && alignment.status === 'active',
    )) {
      throw new Error('Sense 已确认，不能原位改写它的 Focus。');
    }
    const statement = input.statement.trim();
    if (!statement) throw new Error('Focus 陈述不能为空。');
    const now = this.now();
    const nextRevision = focus.currentRevision + 1;
    const revision: SensaMeaningFocusRevisionSnapshot = {
      contractVersion: PSW,
      meaningFocusRevisionId: this.id(),
      meaningFocusId: input.meaningFocusId,
      revision: nextRevision,
      statement,
      distinguishingNotes: cleanNotes(input.distinguishingNotes),
      provenance: {
        kind: 'learner_authored',
        sourceReferenceIds: [input.meaningFocusId],
        createdByOperationId: input.operationId,
      },
      createdAt: now,
    };
    record.focusRevisions.push(revision);
    focus.currentRevision = nextRevision;
    // If the old revision was accepted, it remains the acceptedRevision fact;
    // the current revision is pending until a separate acceptance command.
    focus.updatedAt = now;
    this.recordReceipt(input.operationId, 'EditMeaningFocus', {
      meaningFocusRevisionId: revision.meaningFocusRevisionId,
      revision: nextRevision,
    });
    this.persist();
  }

  async splitMeaningFocus(input: SplitMeaningFocusInput): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'SplitMeaningFocus')) return;
    const record = this.requireRecord(input.personalMeaningId);
    if (!this.meaningFocus(record, input.meaningFocusId)) {
      throw new Error('找不到要拆分来源的 Focus。');
    }
    const statement = input.statement.trim();
    if (!statement) throw new Error('拆分出的 Focus 陈述不能为空。');
    const now = this.now();
    const meaningFocusId = this.id();
    const meaningFocusRevisionId = this.id();
    record.focuses.push({
      contractVersion: PSW,
      meaningFocusId,
      personalMeaningId: input.personalMeaningId,
      splitFromMeaningFocusId: input.meaningFocusId,
      currentRevision: 1,
      acceptedRevision: null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    record.focusRevisions.push({
      contractVersion: PSW,
      meaningFocusRevisionId,
      meaningFocusId,
      revision: 1,
      statement,
      distinguishingNotes: cleanNotes(input.distinguishingNotes),
      provenance: {
        kind: 'learner_authored',
        sourceReferenceIds: [input.meaningFocusId],
        createdByOperationId: input.operationId,
      },
      createdAt: now,
    });
    const aspectLabel = input.aspectLabel?.trim();
    if (aspectLabel) record.mockState.focusAspectLabels[meaningFocusId] = aspectLabel;
    this.recordReceipt(input.operationId, 'SplitMeaningFocus', { meaningFocusId });
    this.persist();
  }

  // -- Construction / Proposal commands -----------------------------------

  async startConstruction(input: {
    operationId: string;
    personalMeaningId: string;
    meaningFocusId: string;
    meaningFocusRevisionId: string;
  }): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'StartSenseConstruction')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const focusRevision = this.acceptedCurrentFocusRevision(
      record,
      input.meaningFocusId,
      input.meaningFocusRevisionId,
    );
    let existing: SensaSenseConstructionSnapshot | null = this.latestConstruction(record, input.meaningFocusId);
    let staleExisting: SensaSenseConstructionSnapshot | null = null;
    if (existing && existing.meaningFocusRevisionId !== focusRevision.meaningFocusRevisionId) {
      // A Focus edit creates a new current revision. Never resume a
      // Construction that was fixed to an older accepted revision.
      staleExisting = existing;
      existing = null;
    }
    if (existing?.status === 'completed') {
      throw new Error('这个 Focus 的 Sense Construction 已完成。');
    }
    if (existing?.status === 'active') {
      this.recordReceipt(input.operationId, 'StartSenseConstruction', {
        senseConstructionId: existing.senseConstructionId,
      });
      this.persist();
      return;
    }
    if (existing?.status === 'paused') {
      existing.status = 'active';
      existing.revision += 1;
      existing.updatedAt = this.now();
      this.recordReceipt(input.operationId, 'StartSenseConstruction', {
        senseConstructionId: existing.senseConstructionId,
      });
      this.persist();
      return;
    }

    const staleUpdatedAt = staleExisting ? this.now() : null;
    const now = this.now();
    const senseConstructionId = this.id();
    const personalMeaningRevision = record.personalMeaningRevisions.find(
      (revision) => revision.revision === record.personalMeaning.currentRevision,
    );
    if (!personalMeaningRevision) throw new Error('个人意义当前修订不存在，无法开始澄清。');
    const construction: SensaSenseConstructionSnapshot = {
      contractVersion: PSW,
      senseConstructionId,
      learnerUserId: LEARNER_USER_ID,
      personalMeaningId: input.personalMeaningId,
      personalMeaningRevisionId: personalMeaningRevision.personalMeaningRevisionId,
      meaningFocusId: input.meaningFocusId,
      meaningFocusRevisionId: focusRevision.meaningFocusRevisionId,
      familiarLanguageTag: FAMILIAR_LANG,
      targetLanguageTag: TARGET_LANG,
      semanticPolicyVersion: 'sensa-semantic-policy-mock-v1',
      status: 'active',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const draft = await this.deps.llm.nextConstructionTurn({
      ...this.meaningContext(record),
      focusStatement: focusRevision.statement,
      focusDistinguishingNotes: [...focusRevision.distinguishingNotes],
      priorTurns: [],
    });
    if (staleExisting) {
      staleExisting.status = 'abandoned';
      staleExisting.revision += 1;
      staleExisting.updatedAt = staleUpdatedAt!;
    }
    record.constructions.push(construction);
    this.addTurn(
      record,
      senseConstructionId,
      'system',
      '开始澄清：我会先问一个能区分边界的问题，帮助确定这个意思的准确边界。',
      null,
      null,
    );
    this.addTurn(record, senseConstructionId, 'semantic_llm', draft.body, draft.provenance, {
      focus: focusRevision.statement,
    });
    record.mockState.constructionHints[senseConstructionId] = {
      boundaryOptions: [...draft.boundaryOptions],
    };
    this.recordReceipt(input.operationId, 'StartSenseConstruction', { senseConstructionId });
    this.persist();
  }

  async answerConstruction(input: AnswerConstructionInput): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'AnswerSenseConstruction')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const construction = this.currentConstruction(record, input.meaningFocusId);
    if (!construction || construction.status !== 'active') {
      throw new Error('没有正在进行的澄清可以回答。');
    }
    if (!record.mockState.constructionHints[construction.senseConstructionId]) {
      throw new Error('当前没有等待回答的边界问题。');
    }
    const answer = input.answer.trim();
    if (!answer) throw new Error('回答不能为空。');
    const context = this.constructionContext(record, construction, [
      { actor: 'learner', body: answer },
    ]);
    const draft = await this.deps.llm.nextConstructionTurn(context);
    this.addTurn(record, construction.senseConstructionId, 'learner', answer, null, null);
    this.addTurn(record, construction.senseConstructionId, 'semantic_llm', draft.body, draft.provenance, { answer });
    delete record.mockState.constructionHints[construction.senseConstructionId];
    construction.revision += 1;
    construction.updatedAt = this.now();
    this.recordReceipt(input.operationId, 'AnswerSenseConstruction', {
      senseConstructionId: construction.senseConstructionId,
    });
    this.persist();
  }

  async pauseConstruction(input: FocusRefInput): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'PauseSenseConstruction')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const construction = this.currentConstruction(record, input.meaningFocusId);
    if (!construction || (construction.status !== 'active' && construction.status !== 'paused')) {
      throw new Error('没有可以暂停的澄清过程。');
    }
    if (construction.status === 'active') {
      construction.status = 'paused';
      construction.revision += 1;
      construction.updatedAt = this.now();
    }
    this.recordReceipt(input.operationId, 'PauseSenseConstruction', {
      senseConstructionId: construction.senseConstructionId,
    });
    this.persist();
  }

  async resumeConstruction(input: FocusRefInput): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'ResumeSenseConstruction')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const construction = this.currentConstruction(record, input.meaningFocusId);
    if (!construction || (construction.status !== 'active' && construction.status !== 'paused')) {
      throw new Error('没有可以恢复的澄清过程。');
    }
    if (construction.status === 'paused') {
      construction.status = 'active';
      construction.revision += 1;
      construction.updatedAt = this.now();
    }
    this.recordReceipt(input.operationId, 'ResumeSenseConstruction', {
      senseConstructionId: construction.senseConstructionId,
    });
    this.persist();
  }

  async generateProposal(input: {
    operationId: string;
    personalMeaningId: string;
    meaningFocusId: string;
  }): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'GenerateSenseProposal')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const construction = this.currentConstruction(record, input.meaningFocusId);
    if (!construction || construction.status !== 'active') {
      throw new Error('没有正在进行的澄清可以生成提议。');
    }
    if (record.mockState.constructionHints[construction.senseConstructionId]) {
      throw new Error('请先回答当前边界问题。');
    }
    if (!this.constructionTurns(record, construction.senseConstructionId).some((turn) => turn.actor === 'learner')) {
      throw new Error('请先回答至少一个边界问题。');
    }
    const proposal = this.proposalForConstruction(record, construction.senseConstructionId);
    if (proposal?.status === 'open' || proposal?.status === 'confirmed') {
      throw new Error('当前已经有一个待处理的 Sense 提议。');
    }
    const context = this.constructionContext(record, construction);
    const draft = await this.deps.llm.generateSenseProposal(context);
    const version = (proposal?.currentVersion ?? 0) + 1;
    const proposalId = proposal?.senseProposalId ?? this.id();
    const proposalVersionId = this.id();
    const now = this.now();
    if (proposal) {
      proposal.currentVersion = version;
      proposal.status = 'open';
      proposal.updatedAt = now;
    } else {
      record.proposals.push({
        contractVersion: PSW,
        senseProposalId: proposalId,
        senseConstructionId: construction.senseConstructionId,
        currentVersion: version,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      });
    }
    const generator: ProposalGeneratorProvenance = {
      provider: draft.provenance.provider,
      model: draft.provenance.model,
      promptVersion: draft.provenance.promptVersion,
      inputDigest: digestOf(context),
      outputDigest: digestOf(draft),
    };
    record.proposalVersions.push({
      contractVersion: PSW,
      senseProposalVersionId: proposalVersionId,
      senseProposalId: proposalId,
      version,
      meaningFocusRevisionId: construction.meaningFocusRevisionId,
      semanticSpec: this.buildSemanticSpec(draft),
      expressionCandidates: draft.expressionCandidates.map((candidate) => ({
        candidateId: this.id(),
        personalExpressionAnchorRevisionId: null,
        expressionType: candidate.expressionType,
        languageTag: candidate.languageTag,
        surfaceForm: candidate.surfaceForm,
        rationale: candidate.rationale,
      })),
      unresolvedQuestions: [...draft.unresolvedQuestions],
      semanticPolicyVersion: draft.semanticPolicyVersion,
      generatorProvenance: generator,
      createdAt: now,
    });
    const createdVersion = last(record.proposalVersions)!;
    record.mockState.proposalSenseKeys[createdVersion.senseProposalVersionId] = draft.proposedSenseKey;
    construction.revision += 1;
    construction.updatedAt = now;
    this.recordReceipt(input.operationId, 'GenerateSenseProposal', {
      senseProposalId: proposalId,
      senseProposalVersionId: proposalVersionId,
      version,
    });
    this.persist();
  }

  async continueClarifying(input: {
    operationId: string;
    personalMeaningId: string;
    meaningFocusId: string;
  }): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'ContinueSenseClarification')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const construction = this.currentConstruction(record, input.meaningFocusId);
    if (!construction || construction.status === 'completed') {
      throw new Error('没有可继续的澄清过程。');
    }
    if (record.mockState.constructionHints[construction.senseConstructionId]) {
      throw new Error('请先回答当前边界问题。');
    }
    const context = this.constructionContext(record, construction, [
      { actor: 'system', body: '继续澄清' },
    ]);
    const draft = await this.deps.llm.nextConstructionTurn(context);
    const proposal = this.proposalForConstruction(record, construction.senseConstructionId);
    if (proposal?.status === 'open') {
      proposal.status = 'superseded';
      proposal.updatedAt = this.now();
    }
    construction.status = 'active';
    construction.revision += 1;
    construction.updatedAt = this.now();
    this.addTurn(record, construction.senseConstructionId, 'semantic_llm', draft.body, draft.provenance, { continue: true });
    record.mockState.constructionHints[construction.senseConstructionId] = {
      boundaryOptions: [...draft.boundaryOptions],
    };
    this.recordReceipt(input.operationId, 'ContinueSenseClarification', {
      senseConstructionId: construction.senseConstructionId,
    });
    this.persist();
  }

  async rejectProposal(input: {
    operationId: string;
    personalMeaningId: string;
    meaningFocusId: string;
  }): Promise<void> {
    if (this.replay<Record<string, string | number | boolean | null>>(input.operationId, 'RejectSenseProposal')) return;
    const record = this.requireRecord(input.personalMeaningId);
    const construction = this.currentConstruction(record, input.meaningFocusId);
    if (!construction) throw new Error('没有可拒绝的提议。');
    const proposal = this.proposalForConstruction(record, construction.senseConstructionId);
    if (!proposal || proposal.status !== 'open') {
      throw new Error('没有待决的提议可以拒绝。');
    }
    proposal.status = 'rejected';
    proposal.updatedAt = this.now();
    construction.status = 'active';
    construction.revision += 1;
    construction.updatedAt = this.now();
    this.recordReceipt(input.operationId, 'RejectSenseProposal', {
      senseProposalId: proposal.senseProposalId,
    });
    this.persist();
  }

  // -- Sense and Expression confirmation ----------------------------------

  async confirmSense(input: ConfirmSenseInput): Promise<ConfirmSenseResult> {
    const replay = this.replay<ConfirmSenseResult>(input.operationId, 'ConfirmSenseProposal');
    if (replay) return replay;
    const record = this.requireRecord(input.personalMeaningId);
    const proposalVersion = record.proposalVersions.find(
      (candidate) => candidate.senseProposalVersionId === input.senseProposalVersionId,
    );
    if (!proposalVersion) throw new Error('找不到要确认的 Sense 提议版本。');
    const proposal = record.proposals.find(
      (candidate) => candidate.senseProposalId === proposalVersion.senseProposalId,
    );
    if (!proposal || proposal.status !== 'open' || proposal.currentVersion !== proposalVersion.version) {
      throw new Error('这个提议版本已经不是待确认状态。');
    }
    const focus = this.meaningFocus(record, input.meaningFocusId);
    if (!focus || focus.acceptedRevision !== focus.currentRevision) {
      throw new Error('请先接受这个 Focus 的当前修订。');
    }
    const construction = this.latestConstruction(record, input.meaningFocusId);
    if (!construction || construction.senseConstructionId !== proposal.senseConstructionId) {
      throw new Error('提议没有对应的当前澄清过程。');
    }
    if (construction.meaningFocusRevisionId !== proposalVersion.meaningFocusRevisionId) {
      throw new Error('提议基于旧的 Focus 修订，请重新澄清。');
    }
    const currentFocusRevision = this.currentFocusRevision(record, input.meaningFocusId);
    if (construction.meaningFocusRevisionId !== currentFocusRevision.meaningFocusRevisionId) {
      throw new Error('提议基于旧的 Focus 修订，请重新开始澄清。');
    }
    const senseKey = record.mockState.proposalSenseKeys[input.senseProposalVersionId];
    if (!senseKey) throw new Error('当前模拟提议缺少可复用的语义 key，无法确认。');
    const state = this.requireState();
    const existingSense = state.registry.senses.find((sense) => sense.senseKey === senseKey);
    const now = this.now();
    let senseId: string;
    let senseVersionId: string;
    let resolution: 'create_new' | 'reuse_existing';
    if (existingSense) {
      senseId = existingSense.senseId;
      senseVersionId = existingSense.currentSenseVersionId;
      resolution = 'reuse_existing';
    } else {
      senseId = this.id();
      senseVersionId = this.id();
      resolution = 'create_new';
      const generator: SemanticGeneratorProvenance = {
        provider: proposalVersion.generatorProvenance.provider,
        model: proposalVersion.generatorProvenance.model,
        promptVersion: proposalVersion.generatorProvenance.promptVersion,
        policyVersion: proposalVersion.semanticPolicyVersion,
        inputDigest: proposalVersion.generatorProvenance.inputDigest,
        outputDigest: proposalVersion.generatorProvenance.outputDigest,
      };
      state.registry.senses.push({
        contractVersion: REG,
        senseId,
        senseKey,
        currentSenseVersionId: senseVersionId,
        currentVersionNumber: 1,
        createdAt: now,
      });
      state.registry.senseVersions.push({
        contractVersion: REG,
        senseVersionId,
        senseId,
        versionNumber: 1,
        origin: 'learner_confirmed',
        semanticPolicyVersion: proposalVersion.semanticPolicyVersion,
        semanticSpec: cloneSpec(proposalVersion.semanticSpec),
        provenance: {
          sourceKind: 'learner_confirmed',
          sourceReferenceIds: [input.senseProposalVersionId],
          generator,
        },
        reviewStatus: 'learner_confirmed',
        contentReleaseId: null,
        createdAt: now,
      });
    }

    const senseProposalConfirmationId = this.id();
    const confirmation: SensaConfirmSenseProposalFact = {
      contractVersion: PSW,
      senseProposalConfirmationId,
      operationId: input.operationId,
      learnerUserId: LEARNER_USER_ID,
      senseProposalVersionId: input.senseProposalVersionId,
      meaningFocusRevisionId: proposalVersion.meaningFocusRevisionId,
      resolution,
      senseId,
      senseVersionId,
      confirmedAt: now,
    };
    record.senseConfirmations.push(confirmation);
    proposal.status = 'confirmed';
    proposal.updatedAt = now;
    construction.status = 'completed';
    construction.revision += 1;
    construction.updatedAt = now;

    const personalMeaningAlignmentId = this.id();
    const alignment: SensaPersonalMeaningAlignmentSnapshot = {
      contractVersion: PSW,
      personalMeaningAlignmentId,
      learnerUserId: LEARNER_USER_ID,
      personalMeaningId: input.personalMeaningId,
      personalMeaningRevisionId: construction.personalMeaningRevisionId,
      meaningFocusId: input.meaningFocusId,
      meaningFocusRevisionId: proposalVersion.meaningFocusRevisionId,
      senseId,
      senseVersionId,
      senseProposalConfirmationId,
      status: 'active',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    record.alignments.push(alignment);
    const alignmentEvent: SensaPersonalMeaningAlignmentEvent = {
      contractVersion: PSW,
      personalMeaningAlignmentEventId: this.id(),
      personalMeaningAlignmentId,
      ordinal: 1,
      eventType: 'confirmed',
      operationId: input.operationId,
      reason: null,
      occurredAt: now,
    };
    record.alignmentEvents.push(alignmentEvent);
    const result = {
      senseId,
      senseVersionId,
      senseProposalVersionId: input.senseProposalVersionId,
      meaningFocusRevisionId: proposalVersion.meaningFocusRevisionId,
      senseProposalConfirmationId,
      personalMeaningAlignmentId,
      resolution,
    };
    this.recordReceipt(input.operationId, 'ConfirmSenseProposal', result);
    this.persist();
    return { ...result, replayed: false };
  }

  private expressionAnchorRevisionFor(
    record: MeaningJourneyRecord,
    anchorId: string,
    revision: number,
  ): SensaPersonalExpressionAnchorRevisionSnapshot | null {
    return record.personalExpressionAnchorRevisions.find(
      (candidate) =>
        candidate.personalExpressionAnchorId === anchorId
        && candidate.revision === revision,
    ) ?? null;
  }

  async confirmExpressionBinding(
    input: ConfirmExpressionBindingInput,
  ): Promise<ConfirmExpressionBindingResult> {
    const replay = this.replay<ConfirmExpressionBindingResult>(
      input.operationId,
      'ConfirmExpressionBinding',
    );
    if (replay) return replay;
    const record = this.requireRecord(input.personalMeaningId);
    const alignment = record.alignments.find(
      (candidate) =>
        candidate.meaningFocusId === input.meaningFocusId
        && candidate.status === 'active',
    );
    if (!alignment) throw new Error('需要先确认 Sense 才能确认表达。');
    if (input.senseVersionId !== alignment.senseVersionId) {
      throw new Error('表达绑定必须引用当前已确认的 Sense Version。');
    }
    const senseConfirmation = record.senseConfirmations.find(
      (candidate) => candidate.senseProposalConfirmationId === alignment.senseProposalConfirmationId,
    );
    const proposalVersion = senseConfirmation
      ? record.proposalVersions.find(
          (candidate) => candidate.senseProposalVersionId === senseConfirmation.senseProposalVersionId,
        )
      : undefined;
    const candidate = proposalVersion?.expressionCandidates.find(
      (item) => item.candidateId === input.candidateId,
    );
    if (!candidate) throw new Error('找不到要确认的目标表达候选。');
    const surfaceForm = input.surfaceForm.trim();
    if (!surfaceForm) throw new Error('目标表达不能为空。');
    const languageTag = input.languageTag.trim();
    if (!languageTag) throw new Error('目标表达必须带语言标签。');
    if (!['realizes', 'approximates', 'evokes'].includes(input.relation)) {
      throw new Error('请明确选择目标表达与 Sense 的关系。');
    }
    if (!['exact', 'broader', 'narrower', 'overlapping'].includes(input.semanticCoverage)) {
      throw new Error('请明确选择目标表达的语义覆盖范围。');
    }
    const unchangedCandidate =
      languageTag === candidate.languageTag
      && input.expressionType === candidate.expressionType
      && surfaceForm === candidate.surfaceForm;
    const provenanceKind: PersonalProvenanceKind = unchangedCandidate
      ? 'llm_suggested'
      : 'learner_authored';
    const state = this.requireState();
    const form = normalizedForm(surfaceForm);
    const existingExpression = state.registry.expressions.find((expression) =>
      expression.expressionType === input.expressionType
      && expression.languageTag === languageTag
      && state.registry.expressionVersions.some(
        (version) =>
          version.expressionId === expression.expressionId
          && version.normalizedForm === form,
      ),
    );
    let expression: SensaExpressionSnapshot;
    let expressionVersion: SensaExpressionVersionSnapshot;
    const now = this.now();
    if (existingExpression) {
      expression = existingExpression;
      expressionVersion = state.registry.expressionVersions.find(
        (version) =>
          version.expressionId === expression.expressionId
          && version.normalizedForm === form,
      )!;
    } else {
      const expressionId = this.id();
      const expressionVersionId = this.id();
      expression = {
        contractVersion: REG,
        expressionId,
        expressionType: input.expressionType,
        languageTag,
        lexemeId: null,
        currentExpressionVersionId: expressionVersionId,
        currentVersionNumber: 1,
        createdAt: now,
      };
      expressionVersion = {
        contractVersion: REG,
        expressionVersionId,
        expressionId,
        versionNumber: 1,
        surfaceForm,
        normalizedForm: form,
        structure: {},
        provenance: {
          sourceKind: 'learner_confirmed',
          sourceReferenceIds: [input.candidateId],
          generator: null,
        },
        createdAt: now,
      };
      state.registry.expressions.push(expression);
      state.registry.expressionVersions.push(expressionVersion);
    }

    const existingBinding = state.registry.bindings.find(
      (binding) =>
        binding.senseId === alignment.senseId
        && binding.expressionId === expression.expressionId
        && binding.relation === input.relation,
    );
    let binding: SensaSenseExpressionBindingSnapshot;
    let bindingVersion: SensaSenseExpressionBindingVersionSnapshot | undefined;
    if (existingBinding) {
      binding = existingBinding;
      bindingVersion = state.registry.bindingVersions.find(
        (version) =>
          version.senseExpressionBindingId === binding.senseExpressionBindingId
          && version.senseVersionId === input.senseVersionId
          && version.expressionVersionId === expressionVersion.expressionVersionId
          && version.semanticCoverage === input.semanticCoverage,
      );
      if (!bindingVersion) {
        const nextVersion = binding.currentVersionNumber + 1;
        const nextBindingVersionId = this.id();
        binding.currentVersionNumber = nextVersion;
        binding.currentBindingVersionId = nextBindingVersionId;
        bindingVersion = {
          contractVersion: REG,
          bindingVersionId: nextBindingVersionId,
          senseExpressionBindingId: binding.senseExpressionBindingId,
          versionNumber: nextVersion,
          senseVersionId: input.senseVersionId,
          expressionVersionId: expressionVersion.expressionVersionId,
          semanticCoverage: input.semanticCoverage,
          registerLabel: null,
          usageConstraints: [],
          provenance: {
            sourceKind: 'learner_confirmed',
            sourceReferenceIds: [input.candidateId],
            generator: null,
          },
          reviewStatus: 'learner_confirmed',
          createdAt: now,
        };
        state.registry.bindingVersions.push(bindingVersion);
      }
    } else {
      const senseExpressionBindingId = this.id();
      const bindingVersionId = this.id();
      binding = {
        contractVersion: REG,
        senseExpressionBindingId,
        senseId: alignment.senseId,
        expressionId: expression.expressionId,
        relation: input.relation,
        currentBindingVersionId: bindingVersionId,
        currentVersionNumber: 1,
        createdAt: now,
      };
      bindingVersion = {
        contractVersion: REG,
        bindingVersionId,
        senseExpressionBindingId,
        versionNumber: 1,
        senseVersionId: input.senseVersionId,
        expressionVersionId: expressionVersion.expressionVersionId,
        semanticCoverage: input.semanticCoverage,
        registerLabel: null,
        usageConstraints: [],
        provenance: {
          sourceKind: 'learner_confirmed',
          sourceReferenceIds: [input.candidateId],
          generator: null,
        },
        reviewStatus: 'learner_confirmed',
        createdAt: now,
      };
      state.registry.bindings.push(binding);
      state.registry.bindingVersions.push(bindingVersion);
    }

    const existingConfirmation = record.bindingConfirmations.find(
      (confirmation) =>
        confirmation.senseVersionId === input.senseVersionId
        && confirmation.expressionVersionId === expressionVersion.expressionVersionId
        && confirmation.bindingVersionId === bindingVersion!.bindingVersionId,
    );
    if (existingConfirmation) {
      const result = {
        expressionBindingConfirmationId: existingConfirmation.expressionBindingConfirmationId,
        personalExpressionAnchorRevisionId: existingConfirmation.personalExpressionAnchorRevisionId,
        expressionId: expression.expressionId,
        expressionVersionId: expressionVersion.expressionVersionId,
        senseExpressionBindingId: binding.senseExpressionBindingId,
        bindingVersionId: bindingVersion.bindingVersionId,
      };
      this.recordReceipt(input.operationId, 'ConfirmExpressionBinding', result);
      this.persist();
      return { ...result, replayed: false };
    }

    let anchorRevision: SensaPersonalExpressionAnchorRevisionSnapshot | null = null;
    let anchor: SensaPersonalExpressionAnchorSnapshot | undefined;
    let createdTargetAnchor = false;
    for (const candidateAnchor of this.activeTargetExpressionAnchors(record)) {
      const current = this.expressionAnchorRevisionFor(
        record,
        candidateAnchor.personalExpressionAnchorId,
        candidateAnchor.currentRevision,
      );
      if (
        current
        && current.provenance.sourceReferenceIds.includes(input.candidateId)
        && current.languageTag === languageTag
        && current.expressionType === input.expressionType
        && current.surfaceForm === surfaceForm
      ) {
        anchor = candidateAnchor;
        anchorRevision = current;
        break;
      }
    }
    if (!anchorRevision) {
      const anchorId = this.id();
      const anchorRevisionId = this.id();
      anchor = {
        contractVersion: PSW,
        personalExpressionAnchorId: anchorId,
        personalMeaningId: input.personalMeaningId,
        currentRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      anchorRevision = {
        contractVersion: PSW,
        personalExpressionAnchorRevisionId: anchorRevisionId,
        personalExpressionAnchorId: anchorId,
        revision: 1,
        expressionType: input.expressionType,
        languageTag,
        learnerLanguageRole: 'target',
        surfaceForm,
        normalizedForm: form,
        provenanceKind,
        verificationStatus: 'learner_confirmed' as PersonalExpressionVerificationStatus,
        provenance: {
          kind: provenanceKind,
          sourceReferenceIds: [input.candidateId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      };
      record.personalExpressionAnchors.push(anchor);
      record.personalExpressionAnchorRevisions.push(anchorRevision);
      createdTargetAnchor = true;
    }

    if (createdTargetAnchor) {
      this.appendMeaningRevision(record, input.operationId, [anchorRevision.personalExpressionAnchorId]);
    }

    const expressionBindingConfirmationId = this.id();
    const confirmation: SensaConfirmExpressionBindingFact = {
      contractVersion: PSW,
      expressionBindingConfirmationId,
      operationId: input.operationId,
      learnerUserId: LEARNER_USER_ID,
      senseProposalVersionId: senseConfirmation?.senseProposalVersionId ?? null,
      personalExpressionAnchorRevisionId: anchorRevision.personalExpressionAnchorRevisionId,
      senseVersionId: input.senseVersionId,
      expressionVersionId: expressionVersion.expressionVersionId,
      bindingVersionId: bindingVersion.bindingVersionId,
      confirmedAt: now,
    };
    record.bindingConfirmations.push(confirmation);
    const result = {
      expressionBindingConfirmationId,
      personalExpressionAnchorRevisionId: anchorRevision.personalExpressionAnchorRevisionId,
      expressionId: expression.expressionId,
      expressionVersionId: expressionVersion.expressionVersionId,
      senseExpressionBindingId: binding.senseExpressionBindingId,
      bindingVersionId: bindingVersion.bindingVersionId,
    };
    this.recordReceipt(input.operationId, 'ConfirmExpressionBinding', result);
    this.persist();
    return { ...result, replayed: false };
  }
}

export const createJourneyGateway = (
  deps: Partial<JourneyGatewayDeps> = {},
): PersonalMeaningJourneyGateway =>
  new JourneyGatewayImpl({
    storage: deps.storage ?? new LocalStoragePort(),
    clock: deps.clock ?? systemClock,
    ids: deps.ids ?? cryptoRandomIdPort,
    llm: deps.llm ?? createMockSemanticLlm(),
  });

/** Shared browser gateway singleton (offline mock Semantic LLM by default). */
export const journeyGateway: PersonalMeaningJourneyGateway = createJourneyGateway();

export { emptyJourneyState };
