/**
 * Deep gateway for the Personal Meaning → confirmed Sense journey.
 *
 * The gateway is the sole local v2 fact owner for Personal Meaning identity,
 * material blocks, Anchors, and the learner confirmation facts that connect
 * them to the semantic registry. The AI clarification agent only proposes; it
 * never writes. Every mutation is an explicit learner intent — saving
 * material, appending a block, confirming a clarification thread, or settling
 * the last Expression Binding — and `confirmClarification` records the Focus
 * acceptance, Sense confirmation + Alignment, and optional Binding as
 * independent facts in one all-or-nothing step. UI callers see a small
 * intent/query interface; they never read storage, the agent session state,
 * or registry internals directly.
 */

import type {
  IngestResult,
  SensaConfirmExpressionBindingFact,
  SensaConfirmSenseProposalFact,
  SensaExpressionBindingRelation,
  SensaExpressionSnapshot,
  SensaExpressionType,
  SensaExpressionVersionSnapshot,
  SensaIntakeAcceptanceRequest,
  SensaIntakeItem,
  SensaIntakePayload,
  SensaMeaningFocusAcceptanceFact,
  SensaPersonalExpressionAnchorRevisionSnapshot,
  SensaPersonalExpressionAnchorSnapshot,
  SensaPersonalMeaningAlignmentEvent,
  SensaPersonalMeaningAlignmentSnapshot,
  SensaPersonalMeaningRevisionSnapshot,
  SensaSemanticAcceptanceAuthority,
  SensaSemanticCoverage,
  SensaSenseExpressionBindingSnapshot,
  SensaSenseExpressionBindingVersionSnapshot,
  SensaSenseProposalVersionSnapshot,
  SensaSenseSemanticSpec,
  SensaSenseVersionSnapshot,
} from '@sensa/contracts/sensa';
import { sensaCommandLanguages, sensaIntakePayloadSchema, sensaIntakeSenseSchema } from '@sensa/contracts/sensa';
import {
  createInboxItem,
  dismissInboxItem,
  evaluateIntakeRoute,
  executeFastTrack,
  resolveInboxItemWithSense,
  type IntakeEnginePorts,
} from './intakeEngine';
import { digestOf } from './digest';
import { cryptoRandomIdPort, isUuid, type RandomIdPort } from './ids';
import {
  LocalStoragePort,
  StorageUnavailableError,
  systemClock,
  type ClockPort,
  type CommandLanguages,
  type LearnerLanguagePort,
  type StoragePort,
} from './ports';
import { languageProfileSnapshot } from '../../data/library/language';
import {
  StoreCorruptedError,
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
  AddMaterialBlockInput,
  AddMaterialBlockResult,
  ConfirmClarificationInput,
  ConfirmClarificationResult,
  ConfirmExpressionBindingInput,
  ConfirmExpressionBindingResult,
  CreatePersonalMeaningInput,
  CreatePersonalMeaningResult,
  IngestCommandResult,
  InboxResolutionInput,
  JourneyDetailView,
  JourneyListItemView,
  JourneyWorldItemView,
  MaterialBlockInput,
} from './types';

const PSW = 'sensa-personal-semantic-world-v2' as const;
const REG = 'sensa-semantic-registry-v1' as const;
const SPEC_SCHEMA = 'sensa-sense-semantic-spec-v1' as const;
const LEARNER_USER_ID = 'sensa-local-learner';

/**
 * The learner's stored languages. A command reads this once, before it writes,
 * so a switch made in another tab cannot split one command's facts across two
 * target languages.
 */
const localLearnerLanguages: LearnerLanguagePort = {
  async read() {
    return (await languageProfileSnapshot()).profile;
  },
};

type PersonalProvenanceKind =
  SensaPersonalMeaningRevisionSnapshot['provenance']['kind'];
type PersonalExpressionVerificationStatus =
  SensaPersonalExpressionAnchorRevisionSnapshot['verificationStatus'];
type SemanticGeneratorProvenance = NonNullable<
  SensaSenseVersionSnapshot['provenance']['generator']
>;
type ProposalGeneratorProvenance = SensaSenseProposalVersionSnapshot['generatorProvenance'];

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
  getWorldItems(): JourneyWorldItemView[];
  getDetail(personalMeaningId: string): JourneyDetailView | null;

  createPersonalMeaning(
    input: CreatePersonalMeaningInput,
  ): Promise<CreatePersonalMeaningResult>;

  addMaterialBlock(input: AddMaterialBlockInput): Promise<AddMaterialBlockResult>;

  confirmClarification(
    input: ConfirmClarificationInput,
  ): Promise<ConfirmClarificationResult>;

  confirmExpressionBinding(
    input: ConfirmExpressionBindingInput,
  ): Promise<ConfirmExpressionBindingResult>;

  /** Ubiquitous intake: route one capture payload onto the fast track, the Inbox, or rejection. */
  ingest(
    operationId: string,
    payload: SensaIntakePayload,
  ): Promise<IngestCommandResult>;

  /** Slow-track draft materials waiting for learner confirmation. */
  getInboxItems(): SensaIntakeItem[];

  /** Promote one Inbox draft by confirming its sense (same materialization as the fast track). */
  resolveInboxItem(
    operationId: string,
    intakeId: string,
    resolution: InboxResolutionInput,
  ): Promise<IngestCommandResult>;

  /** Drop one Inbox draft. */
  dismissInboxItem(operationId: string, intakeId: string): Promise<void>;
}

export interface JourneyGatewayDeps {
  storage: StoragePort;
  clock: ClockPort;
  ids: RandomIdPort;
  semanticAcceptanceAuthority: SemanticAcceptanceAuthorityPort;
  languages: LearnerLanguagePort;
}

/**
 * Verifies that an intake acceptance request is backed by an authenticated
 * learner action or a real delegated grant. Payload data alone is never
 * authority to mutate the Personal Semantic World.
 */
export interface SemanticAcceptanceAuthorityPort {
  verify(request: SensaIntakeAcceptanceRequest): SensaSemanticAcceptanceAuthority;
}

const localSemanticAcceptanceAuthority: SemanticAcceptanceAuthorityPort = {
  verify(request) {
    if (request.mode === 'learner_direct') {
      return { mode: 'learner_direct', actorId: LEARNER_USER_ID };
    }
    throw new Error('当前本地端口没有可验证的 Agent 委托授权。');
  },
};

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
      this.state = state;
      this.status = { ok: true, error: null, errorKind: null };
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

  /**
   * Commands run one at a time.
   *
   * Every command reads the aggregate, awaits the learner's languages, then
   * publishes what it built. Two commands that both read before either
   * published would each drop the other's facts. Nothing awaited between
   * reading and writing before languages were resolved per command, so the
   * gateway was safe by accident; this gate makes it safe on purpose.
   */
  private gate: Promise<unknown> = Promise.resolve();

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.gate.then(work);
    this.gate = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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

  // -- material ------------------------------------------------------------

  /**
   * Append one material block as its own Semantic Anchor, so it can be
   * referenced independently of the other blocks.
   */
  private appendMaterialAnchor(
    record: MeaningJourneyRecord,
    operationId: string,
    block: MaterialBlockInput,
    familiarLanguageTag: string,
  ): string {
    const now = this.now();
    const anchorId = this.id();
    const isImage = block.kind === 'image';
    const bodyText = block.bodyText?.trim() ?? '';
    if (isImage) {
      if (!block.personalMediaObjectId) {
        throw new Error('图片材料块必须引用本地媒体对象。');
      }
    } else if (!bodyText) {
      throw new Error('文字材料块不能为空。');
    }
    record.personalSemanticAnchors.push({
      contractVersion: PSW,
      personalSemanticAnchorId: anchorId,
      personalMeaningId: record.personalMeaning.personalMeaningId,
      currentRevision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    record.personalSemanticAnchorRevisions.push({
      contractVersion: PSW,
      personalSemanticAnchorRevisionId: this.id(),
      personalSemanticAnchorId: anchorId,
      revision: 1,
      anchorKind: isImage ? 'image' : 'text',
      languageTag: isImage ? null : familiarLanguageTag,
      bodyText: isImage ? null : bodyText,
      personalMediaObjectId: isImage ? block.personalMediaObjectId! : null,
      structuredPayload: {},
      provenance: {
        kind: 'learner_authored',
        sourceReferenceIds: [anchorId],
        createdByOperationId: operationId,
      },
      createdAt: now,
    });
    return anchorId;
  }

  async createPersonalMeaning(
    input: CreatePersonalMeaningInput,
  ): Promise<CreatePersonalMeaningResult> {
    return this.exclusive(() => this.writePersonalMeaning(input));
  }

  private async writePersonalMeaning(
    input: CreatePersonalMeaningInput,
  ): Promise<CreatePersonalMeaningResult> {

    const replay = this.replay<CreatePersonalMeaningResult>(
      input.operationId,
      'CreatePersonalMeaning',
    );
    if (replay) return replay;
    const state = this.requireState();
    const familiarSurface = input.familiarExpression?.surfaceForm.trim() ?? '';
    if (input.familiarExpression && !familiarSurface) {
      throw new Error('熟悉表达不能为空。');
    }
    const blocks = input.blocks ?? [];
    if (blocks.length === 0 && !familiarSurface) {
      throw new Error('个人意义至少需要一个材料块或一个熟悉表达。');
    }

    // Read once, before any fact exists: the learner's own wording is written
    // in whatever language they think in, and that language cannot change
    // halfway through this command.
    const languages = sensaCommandLanguages(await this.deps.languages.read());
    const personalMeaningId = this.id();
    const personalMeaningRevisionId = this.id();
    const now = this.now();
    const familiarExpressionAnchorId = familiarSurface ? this.id() : null;
    const familiarExpressionAnchorRevisionId = familiarSurface ? this.id() : null;

    const firstText = blocks.find((block) => block.kind === 'text')?.bodyText?.trim() ?? '';
    const record: MeaningJourneyRecord = {
      personalMeaning: {
        contractVersion: PSW,
        personalMeaningId,
        learnerUserId: LEARNER_USER_ID,
        currentRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      personalMeaningRevisions: [],
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
      semanticAcceptances: [],
      alignments: [],
      alignmentEvents: [],
      bindingConfirmations: [],
      mockState: {
        focusAspectLabels: {},
        startingPoint: input.startingPoint ?? null,
      },
    };

    if (familiarSurface && familiarExpressionAnchorId && familiarExpressionAnchorRevisionId) {
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
        // Provisional classification: the composer deliberately does not ask
        // for one, and the model refines it during clarification.
        expressionType: 'phrase',
        languageTag: languages.familiarLanguageTag,
        learnerLanguageRole: 'familiar',
        surfaceForm: familiarSurface,
        normalizedForm: normalizedForm(familiarSurface),
        contextAnchorRevisionId: null,
        occurrence: null,
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
    const blockAnchorIds = blocks.map(
      (block) =>
        this.appendMaterialAnchor(
          record,
          input.operationId,
          block,
          languages.familiarLanguageTag,
        ),
    );

    record.personalMeaningRevisions.push({
      contractVersion: PSW,
      personalMeaningRevisionId,
      personalMeaningId,
      revision: 1,
      displayLabel: familiarSurface
        || (firstText.length > 24 ? `${firstText.slice(0, 24)}…` : firstText)
        || '我的个人意义',
      learnerIntentNote: null,
      provenance: {
        kind: 'learner_authored',
        sourceReferenceIds: [
          familiarExpressionAnchorId,
          ...blockAnchorIds,
        ].filter((id): id is string => id !== null),
        createdByOperationId: input.operationId,
      },
      createdAt: now,
    });

    state.meanings.push(record);
    const result = {
      personalMeaningId,
      personalMeaningRevisionId,
      familiarExpressionAnchorId,
    };
    this.recordReceipt(input.operationId, 'CreatePersonalMeaning', result);
    this.persist();
    return { ...result, replayed: false };
  }

  async addMaterialBlock(input: AddMaterialBlockInput): Promise<AddMaterialBlockResult> {
    return this.exclusive(() => this.writeMaterialBlock(input));
  }

  private async writeMaterialBlock(input: AddMaterialBlockInput): Promise<AddMaterialBlockResult> {

    const replay = this.replay<AddMaterialBlockResult>(input.operationId, 'AddMaterialBlock');
    if (replay) return replay;
    const record = this.requireRecord(input.personalMeaningId);
    const languages = sensaCommandLanguages(await this.deps.languages.read());
    const anchorId = this.appendMaterialAnchor(
      record,
      input.operationId,
      input.block,
      languages.familiarLanguageTag,
    );
    this.appendMeaningRevision(record, input.operationId, [anchorId]);
    const result = { anchorId };
    this.recordReceipt(input.operationId, 'AddMaterialBlock', result);
    this.persist();
    return { ...result, replayed: false };
  }

  // -- clarification confirmation ------------------------------------------

  async confirmClarification(
    input: ConfirmClarificationInput,
  ): Promise<ConfirmClarificationResult> {
    return this.exclusive(() => this.writeClarification(input));
  }

  private async writeClarification(
    input: ConfirmClarificationInput,
  ): Promise<ConfirmClarificationResult> {

    const replay = this.replay<ConfirmClarificationResult>(
      input.operationId,
      'ConfirmClarification',
    );
    if (replay) return replay;
    const state = this.requireState();
    const record = this.requireRecord(input.personalMeaningId);
    const languages = sensaCommandLanguages(await this.deps.languages.read());

    // Validate the whole intent before writing any fact: a rejected step must
    // leave the store exactly as it was.
    const statement = input.focus.statement.trim();
    if (!statement) throw new Error('表达侧面陈述不能为空。');
    const notes = cleanNotes(input.focus.distinguishingNotes);
    const aspectLabel = input.focus.aspectLabel.trim();
    const senseKey = input.sense.proposedSenseKey.trim();
    if (!senseKey) throw new Error('稳定意思缺少可复用的语义 key。');
    if (!input.sense.coreMeaningFocus.trim()) throw new Error('稳定意思不能为空。');
    if (input.sense.prototypeScenes.length === 0) {
      throw new Error('稳定意思至少需要一个原型场景。');
    }
    if (!input.semanticPolicyVersion.trim()) throw new Error('缺少语义策略版本。');
    const provenance = input.provenance;
    if (!provenance.provider.trim() || !provenance.model.trim() || !provenance.promptVersion.trim()) {
      throw new Error('缺少模型来源信息。');
    }
    const expressionInput = input.expression
      ? (() => {
          const surfaceForm = input.expression!.surfaceForm.trim();
          if (!surfaceForm) throw new Error('目标表达不能为空。');
          const languageTag = input.expression!.languageTag.trim();
          if (!languageTag) throw new Error('目标表达必须带语言标签。');
          if (input.confirmExpression) {
            if (!['realizes', 'approximates', 'evokes'].includes(input.expression!.relation)) {
              throw new Error('请明确选择目标表达与 Sense 的关系。');
            }
            if (!['exact', 'broader', 'narrower', 'overlapping'].includes(input.expression!.semanticCoverage)) {
              throw new Error('请明确选择目标表达的语义覆盖范围。');
            }
          }
          return {
            surfaceForm,
            languageTag,
            expressionType: input.expression!.expressionType,
            relation: input.expression!.relation,
            semanticCoverage: input.expression!.semanticCoverage,
          };
        })()
      : null;

    const now = this.now();
    const personalMeaningRevision = this.latestMeaningRevision(record);
    if (!personalMeaningRevision) throw new Error('个人意义修订不存在，无法确认。');

    // 1) Meaning Focus, born accepted: the learner confirmed this exact
    //    statement as the aspect they meant.
    const meaningFocusId = this.id();
    const meaningFocusRevisionId = this.id();
    record.focuses.push({
      contractVersion: PSW,
      meaningFocusId,
      personalMeaningId: input.personalMeaningId,
      splitFromMeaningFocusId: null,
      currentRevision: 1,
      acceptedRevision: 1,
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
        kind: 'learner_authored',
        sourceReferenceIds: [input.personalMeaningId],
        createdByOperationId: input.operationId,
      },
      createdAt: now,
    });
    const acceptance: SensaMeaningFocusAcceptanceFact = {
      contractVersion: PSW,
      meaningFocusAcceptanceId: this.id(),
      meaningFocusId,
      meaningFocusRevisionId,
      operationId: input.operationId,
      acceptedAt: now,
    };
    record.focusAcceptances.push(acceptance);
    if (aspectLabel) record.mockState.focusAspectLabels[meaningFocusId] = aspectLabel;

    // 2) The transcript becomes the authoritative Construction turns.
    const senseConstructionId = this.id();
    record.constructions.push({
      contractVersion: PSW,
      senseConstructionId,
      learnerUserId: LEARNER_USER_ID,
      personalMeaningId: input.personalMeaningId,
      personalMeaningRevisionId: personalMeaningRevision.personalMeaningRevisionId,
      meaningFocusId,
      meaningFocusRevisionId,
      familiarLanguageTag: languages.familiarLanguageTag,
      targetLanguageTag: languages.targetLanguageTag,
      semanticPolicyVersion: input.semanticPolicyVersion,
      status: 'completed',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    input.transcript.forEach((message, index) => {
      const modelProvenance = message.role === 'learner'
        ? null
        : {
            provider: provenance.provider,
            model: provenance.model,
            promptVersion: provenance.promptVersion,
          };
      record.constructionTurns.push({
        contractVersion: PSW,
        constructionTurnId: this.id(),
        senseConstructionId,
        ordinal: index + 1,
        actor: message.role === 'learner' ? 'learner' : 'semantic_llm',
        body: message.body,
        inputDigest: null,
        outputDigest: digestOf(message.body),
        modelProvenance,
        occurredAt: message.occurredAt,
      });
    });

    // 3) The proposal version carries the semantic spec and, when the panel
    //    had one, the expression candidate. Recording a candidate is
    //    provenance, never confirmation.
    const senseProposalId = this.id();
    const senseProposalVersionId = this.id();
    const generator: ProposalGeneratorProvenance = {
      provider: provenance.provider,
      model: provenance.model,
      promptVersion: provenance.promptVersion,
      inputDigest: digestOf({ focus: input.focus, transcript: input.transcript }),
      outputDigest: digestOf(input.sense),
    };
    const semanticSpec = this.buildSemanticSpec(input.sense);
    const candidatesList = (input.expressionCandidates && input.expressionCandidates.length > 0)
      ? input.expressionCandidates
      : expressionInput ? [expressionInput] : [];

    let chosenCandidateId: string | null = null;
    const proposalExpressionCandidates = candidatesList.map((item) => {
      const id = this.id();
      if (expressionInput && item.surfaceForm === expressionInput.surfaceForm && !chosenCandidateId) {
        chosenCandidateId = id;
      }
      return {
        candidateId: id,
        personalExpressionAnchorRevisionId: null,
        expressionType: item.expressionType,
        languageTag: item.languageTag,
        surfaceForm: item.surfaceForm,
        rationale: '由澄清对话提议的候选表达',
      };
    });

    const candidateId = chosenCandidateId ?? (expressionInput ? this.id() : null);
    record.proposals.push({
      contractVersion: PSW,
      senseProposalId,
      senseConstructionId,
      currentVersion: 1,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    });
    record.proposalVersions.push({
      contractVersion: PSW,
      senseProposalVersionId,
      senseProposalId,
      version: 1,
      meaningFocusRevisionId,
      semanticSpec,
      expressionCandidates: proposalExpressionCandidates,
      unresolvedQuestions: cleanNotes(input.sense.unresolvedQuestions),
      semanticPolicyVersion: input.semanticPolicyVersion,
      generatorProvenance: generator,
      createdAt: now,
    });

    // 4) Sense resolution: reuse an existing Sense with the same key, or
    //    register a new learner-confirmed one.
    const existingSense = state.registry.senses.find((sense) => sense.senseKey === senseKey);
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
      const senseGenerator: SemanticGeneratorProvenance = {
        provider: provenance.provider,
        model: provenance.model,
        promptVersion: provenance.promptVersion,
        policyVersion: input.semanticPolicyVersion,
        inputDigest: generator.inputDigest,
        outputDigest: generator.outputDigest,
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
        semanticPolicyVersion: input.semanticPolicyVersion,
        semanticSpec: cloneSpec(semanticSpec),
        provenance: {
          sourceKind: 'learner_confirmed',
          sourceReferenceIds: [senseProposalVersionId],
          generator: senseGenerator,
        },
        reviewStatus: 'learner_confirmed',
        contentReleaseId: null,
        createdAt: now,
      });
    }

    // 5) Sense confirmation + Alignment facts.
    const senseProposalConfirmationId = this.id();
    const senseConfirmation: SensaConfirmSenseProposalFact = {
      contractVersion: PSW,
      senseProposalConfirmationId,
      operationId: input.operationId,
      learnerUserId: LEARNER_USER_ID,
      senseProposalVersionId,
      meaningFocusRevisionId,
      resolution,
      senseId,
      senseVersionId,
      confirmedAt: now,
    };
    record.senseConfirmations.push(senseConfirmation);
    const personalMeaningAlignmentId = this.id();
    const alignment: SensaPersonalMeaningAlignmentSnapshot = {
      contractVersion: PSW,
      personalMeaningAlignmentId,
      learnerUserId: LEARNER_USER_ID,
      personalMeaningId: input.personalMeaningId,
      personalMeaningRevisionId: personalMeaningRevision.personalMeaningRevisionId,
      basis: {
        kind: 'sense_construction',
        meaningFocusId,
        meaningFocusRevisionId,
        senseProposalConfirmationId,
      },
      senseId,
      senseVersionId,
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

    // 6) The optional third fact, in the same intent.
    let expressionConfirmed = false;
    if (expressionInput && input.confirmExpression && candidateId) {
      this.settleExpressionBinding(
        record,
        alignment,
        {
          candidateId,
          expressionType: expressionInput.expressionType,
          languageTag: expressionInput.languageTag,
          surfaceForm: expressionInput.surfaceForm,
        },
        {
          operationId: input.operationId,
          senseVersionId,
          surfaceForm: expressionInput.surfaceForm,
          languageTag: expressionInput.languageTag,
          expressionType: expressionInput.expressionType,
          relation: expressionInput.relation,
          semanticCoverage: expressionInput.semanticCoverage,
        },
        senseProposalVersionId,
      );
      expressionConfirmed = true;
    }

    const result = {
      meaningFocusId,
      senseId,
      senseVersionId,
      personalMeaningAlignmentId,
      resolution,
      expressionConfirmed,
    };
    this.recordReceipt(input.operationId, 'ConfirmClarification', result);
    this.persist();
    return { ...result, replayed: false };
  }

  // -- expression binding ---------------------------------------------------

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

  /**
   * Shared binding core for `confirmClarification` and the standalone
   * `confirmExpressionBinding`. Caller owns validation, receipts and persist;
   * this only writes facts.
   */
  private settleExpressionBinding(
    record: MeaningJourneyRecord,
    alignment: SensaPersonalMeaningAlignmentSnapshot,
    candidate: {
      candidateId: string;
      expressionType: SensaExpressionType;
      languageTag: string;
      surfaceForm: string;
      provenanceKind?: PersonalProvenanceKind;
    },
    input: {
      operationId: string;
      senseVersionId: string;
      surfaceForm: string;
      languageTag: string;
      expressionType: SensaExpressionType;
      relation: SensaExpressionBindingRelation;
      semanticCoverage: SensaSemanticCoverage;
    },
    senseProposalVersionId: string | null,
  ): {
    expressionBindingConfirmationId: string;
    personalExpressionAnchorRevisionId: string;
    expressionId: string;
    expressionVersionId: string;
    senseExpressionBindingId: string;
    bindingVersionId: string;
  } {
    const state = this.requireState();
    const unchangedCandidate =
      input.languageTag === candidate.languageTag
      && input.expressionType === candidate.expressionType
      && input.surfaceForm === candidate.surfaceForm;
    const provenanceKind: PersonalProvenanceKind = unchangedCandidate
      ? candidate.provenanceKind ?? 'llm_suggested'
      : 'learner_authored';
    const form = normalizedForm(input.surfaceForm);
    const existingExpression = state.registry.expressions.find((expression) =>
      expression.expressionType === input.expressionType
      && expression.languageTag === input.languageTag
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
        languageTag: input.languageTag,
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
        surfaceForm: input.surfaceForm,
        normalizedForm: form,
        structure: {},
        provenance: {
          sourceKind: 'learner_confirmed',
          sourceReferenceIds: [candidate.candidateId],
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
            sourceReferenceIds: [candidate.candidateId],
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
          sourceReferenceIds: [candidate.candidateId],
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
      return {
        expressionBindingConfirmationId: existingConfirmation.expressionBindingConfirmationId,
        personalExpressionAnchorRevisionId: existingConfirmation.personalExpressionAnchorRevisionId,
        expressionId: expression.expressionId,
        expressionVersionId: expressionVersion.expressionVersionId,
        senseExpressionBindingId: binding.senseExpressionBindingId,
        bindingVersionId: bindingVersion.bindingVersionId,
      };
    }

    let anchorRevision: SensaPersonalExpressionAnchorRevisionSnapshot | null = null;
    let anchor: SensaPersonalExpressionAnchorSnapshot | undefined;
    let createdTargetAnchor = false;
    // The intake fast track pre-creates the captured expression anchor with
    // this candidate id in its provenance (either language role), so match
    // any active anchor before creating a duplicate.
    for (const candidateAnchor of this.activeExpressionAnchors(record)) {
      const current = this.expressionAnchorRevisionFor(
        record,
        candidateAnchor.personalExpressionAnchorId,
        candidateAnchor.currentRevision,
      );
      if (
        current
        && current.provenance.sourceReferenceIds.includes(candidate.candidateId)
        && current.languageTag === input.languageTag
        && current.expressionType === input.expressionType
        && current.surfaceForm === input.surfaceForm
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
        personalMeaningId: record.personalMeaning.personalMeaningId,
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
        languageTag: input.languageTag,
        learnerLanguageRole: 'target',
        surfaceForm: input.surfaceForm,
        normalizedForm: form,
        contextAnchorRevisionId: null,
        occurrence: null,
        provenanceKind,
        verificationStatus: 'learner_confirmed' as PersonalExpressionVerificationStatus,
        provenance: {
          kind: provenanceKind,
          sourceReferenceIds: [candidate.candidateId],
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
      senseProposalVersionId,
      personalExpressionAnchorRevisionId: anchorRevision.personalExpressionAnchorRevisionId,
      senseVersionId: input.senseVersionId,
      expressionVersionId: expressionVersion.expressionVersionId,
      bindingVersionId: bindingVersion.bindingVersionId,
      confirmedAt: now,
    };
    record.bindingConfirmations.push(confirmation);
    return {
      expressionBindingConfirmationId,
      personalExpressionAnchorRevisionId: anchorRevision.personalExpressionAnchorRevisionId,
      expressionId: expression.expressionId,
      expressionVersionId: expressionVersion.expressionVersionId,
      senseExpressionBindingId: binding.senseExpressionBindingId,
      bindingVersionId: bindingVersion.bindingVersionId,
    };
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
        candidate.basis.kind === 'sense_construction'
        && candidate.basis.meaningFocusId === input.meaningFocusId
        && candidate.status === 'active',
    );
    if (!alignment) throw new Error('需要先确认 Sense 才能确认表达。');
    if (input.senseVersionId !== alignment.senseVersionId) {
      throw new Error('表达绑定必须引用当前已确认的 Sense Version。');
    }
    const senseConfirmation = record.senseConfirmations.find(
      (candidate) => candidate.senseProposalConfirmationId === (
        alignment.basis.kind === 'sense_construction'
          ? alignment.basis.senseProposalConfirmationId
          : ''
      ),
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
    const result = this.settleExpressionBinding(
      record,
      alignment,
      candidate,
      {
        operationId: input.operationId,
        senseVersionId: input.senseVersionId,
        surfaceForm,
        languageTag,
        expressionType: input.expressionType,
        relation: input.relation,
        semanticCoverage: input.semanticCoverage,
      },
      senseConfirmation?.senseProposalVersionId ?? null,
    );
    this.recordReceipt(input.operationId, 'ConfirmExpressionBinding', result);
    this.persist();
    return { ...result, replayed: false };
  }

  // -- ubiquitous multimodal intake -----------------------------------------

  /** The engine never touches storage or receipts; ids, clock and languages
   * all come from the gateway, which is the only part that reads the profile. */
  private enginePorts(languages: CommandLanguages): IntakeEnginePorts {
    return { newId: () => this.id(), nowIso: () => this.now(), languages };
  }

  getInboxItems(): SensaIntakeItem[] {
    if (!this.state) return [];
    return [...this.state.inboxItems];
  }

  async ingest(
    operationId: string,
    payload: SensaIntakePayload,
  ): Promise<IngestCommandResult> {
    return this.exclusive(() => this.runIngest(operationId, payload));
  }

  private async runIngest(
    operationId: string,
    payload: SensaIntakePayload,
  ): Promise<IngestCommandResult> {

    const replay = this.replay<IngestCommandResult>(operationId, 'Ingest');
    if (replay) return replay;
    const state = this.requireState();
    // Boundary validation: the capture payload must satisfy the intake
    // contract before the engine sees it, and the transport idempotency key
    // must be the command's receipt key.
    const parsed = sensaIntakePayloadSchema.parse(payload);
    if (parsed.intakeOperationId !== operationId) {
      throw new Error('ingest 的 operationId 必须与载荷的 intakeOperationId 一致。');
    }
    // The pair is pinned once, before the route decision rather than only before
    // the write: whether the captured language sits on a side of the learner's
    // boundary IS that decision, so reading the profile afterwards would let one
    // operation route on one profile and write under another.
    const languages = sensaCommandLanguages(await this.deps.languages.read());
    const decision = evaluateIntakeRoute(parsed, languages);
    if (decision.route === 'rejected') {
      const result: IngestResult = { route: 'rejected', reason: decision.reason };
      this.recordReceipt(operationId, 'Ingest', result);
      this.persist();
      return { ...result, replayed: false };
    }
    if (decision.route === 'inbox') {
      const item = createInboxItem(parsed, this.id(), this.now(), languages);
      state.inboxItems.push(item);
      const result: IngestResult = { route: 'inbox', intakeId: item.intakeId };
      this.recordReceipt(operationId, 'Ingest', result);
      this.persist();
      return { ...result, replayed: false };
    }
    const authority = this.deps.semanticAcceptanceAuthority.verify(
      parsed.acceptanceRequest!,
    );
    // Fast track: the engine materializes the whole Personal Meaning record
    // atomically; the shared binding core then settles the registry
    // Expression/Binding and the confirmation fact in the same command.
    const outcome = executeFastTrack(
      state,
      { payload: parsed, operationId, authority: authority! },
      this.enginePorts(languages),
    );
    this.state = outcome.nextState;
    this.settleExpressionBinding(
      outcome.record,
      outcome.alignment,
      outcome.bindingCandidate,
      { operationId, ...outcome.bindingInput },
      null,
    );
    const result: IngestResult = {
      route: 'fast_track',
      personalMeaningId: outcome.personalMeaningId,
    };
    this.recordReceipt(operationId, 'Ingest', result);
    this.persist();
    return { ...result, replayed: false };
  }

  async resolveInboxItem(
    operationId: string,
    intakeId: string,
    resolution: InboxResolutionInput,
  ): Promise<IngestCommandResult> {
    return this.exclusive(() => this.runInboxResolution(operationId, intakeId, resolution));
  }

  private async runInboxResolution(
    operationId: string,
    intakeId: string,
    resolution: InboxResolutionInput,
  ): Promise<IngestCommandResult> {

    const replay = this.replay<IngestCommandResult>(operationId, 'ResolveInboxItem');
    if (replay) return replay;
    const state = this.requireState();
    // Boundary validation for the learner-confirmed sense before any write.
    const sense = sensaIntakeSenseSchema.parse(resolution.sense);
    const authority = this.deps.semanticAcceptanceAuthority.verify({
      mode: 'learner_direct',
    });
    const outcome = resolveInboxItemWithSense(
      state,
      { intakeId, sense, operationId, authority },
      this.enginePorts(sensaCommandLanguages(await this.deps.languages.read())),
    );
    this.state = outcome.nextState;
    this.settleExpressionBinding(
      outcome.record,
      outcome.alignment,
      outcome.bindingCandidate,
      { operationId, ...outcome.bindingInput },
      null,
    );
    const result: IngestResult = {
      route: 'fast_track',
      personalMeaningId: outcome.personalMeaningId,
    };
    this.recordReceipt(operationId, 'ResolveInboxItem', result);
    this.persist();
    return { ...result, replayed: false };
  }

  async dismissInboxItem(operationId: string, intakeId: string): Promise<void> {
    const found = this.receipt(operationId, 'DismissInboxItem');
    if (found) return;
    const state = this.requireState();
    // Pure removal; throws when the item is unknown, before any write.
    this.state = dismissInboxItem(state, intakeId);
    this.recordReceipt(operationId, 'DismissInboxItem', { intakeId });
    this.persist();
  }
}

export const createJourneyGateway = (
  deps: Partial<JourneyGatewayDeps> = {},
): PersonalMeaningJourneyGateway =>
  new JourneyGatewayImpl({
    storage: deps.storage ?? new LocalStoragePort(),
    clock: deps.clock ?? systemClock,
    ids: deps.ids ?? cryptoRandomIdPort,
    semanticAcceptanceAuthority:
      deps.semanticAcceptanceAuthority ?? localSemanticAcceptanceAuthority,
    languages: deps.languages ?? localLearnerLanguages,
  });

/** Shared browser gateway singleton. */
export const journeyGateway: PersonalMeaningJourneyGateway = createJourneyGateway();
