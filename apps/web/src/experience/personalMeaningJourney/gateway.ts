/**
 * Deep gateway for the Personal Meaning → confirmed Sense journey.
 *
 * The gateway is the local v3 command interface for Personal Meaning identity,
 * material blocks, Anchors, and the learner confirmation facts that connect
 * them to the semantic registry. The AI clarification agent only proposes; it
 * never writes. Every mutation is an explicit learner intent — saving
 * material, appending a block, confirming a clarification thread, or settling
 * the last Expression Binding — and `confirmClarification` records Sense
 * confirmation + Alignment, an optional Focus acceptance when disambiguation
 * required it, and an optional Binding as independent facts in one
 * all-or-nothing step. UI callers see a small
 * intent/query interface; they never read storage, the agent session state,
 * or registry internals directly. The Repository admits its proposed state
 * through the Personal Semantic World authority before any fact is committed.
 */

import type {
  IngestResult,
  SensaConfirmExpressionBindingFact,
  SensaConfirmSenseProposalFact,
  SensaExpressionBindingRelation,
  SensaExpressionSnapshot,
  SensaExpressionType,
  SensaExpressionVersionSnapshot,
  SensaIntakeAcceptance,
  SensaIntakeContext,
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
  SensaSenseSnapshot,
  SensaSenseVersionSnapshot,
} from '@sensa/contracts/sensa';
import { publishedLearningSemanticFactsSchema, sensaIntakeContextSchema, sensaIntakePayloadSchema, sensaIntakeSenseSchema, sensaPinnedLanguageContextSchema } from '@sensa/contracts/sensa';
import type {
  DismissSemanticIntakeCommand,
  ResolveSemanticIntakeCommand,
  SemanticIntakeModule,
  SemanticIntakeResult,
} from '../intake/semanticIntakeModule';
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
  StorageUnavailableError,
  systemClock,
  type ClockPort,
  type CommandLanguages,
  type LearnerLanguagePort,
} from './ports';
import { languageRoutesSnapshot } from '../../data/library/language';
import {
  StoreCorruptedError,
  type CommandReceipt,
  type JourneyState,
  type MeaningJourneyRecord,
} from './store';
import {LibraryJourneyRepository,type JourneyRepository} from './repository';
import {markPreparedMediaCommitted,preparedMediaSnapshot} from './mediaStore';
import {
  buildDetailView,
  buildListItemView,
  buildWorldItemView,
} from './projection';
import { buildPersonalMeaningLearningSources } from './learningSource';
import type { PersonalMeaningLearningSource } from '../../contentSupply/system';
import type {
  AddMaterialBlockInput,
  AddMaterialBlockResult,
  ConfirmClarificationInput,
  ConfirmClarificationResult,
  ConfirmExpressionBindingInput,
  ConfirmExpressionBindingResult,
  ClarificationDraftView,
  CompleteClarificationDraftInput,
  CompleteClarificationDraftResult,
  CreateClarificationDraftResult,
  CreatePersonalMeaningInput,
  CreatePersonalMeaningResult,
  JourneyDetailView,
  JourneyListItemView,
  JourneyWorldItemView,
  MaterialBlockInput,
  PublishedLearningSceneAcceptanceInput,
  PublishedLearningSceneAcceptanceResult,
  ReviseContextInput,
  ReviseContextResult,
} from './types';

const PSW = 'sensa-personal-semantic-world-v3' as const;
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
    return (await languageRoutesSnapshot()).context;
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
  getClarificationDraft(intakeId: string): ClarificationDraftView | null;
  /** Complete, learnable Alignment projections; incomplete meanings yield none. */
  getLearningSources(
    personalMeaningId: string,
    personalMeaningAlignmentId?: string,
  ): PersonalMeaningLearningSource[];

  /** Create an Inbox-owned clarification draft without creating Personal Meaning facts. */
  createClarificationDraft(
    input: CreatePersonalMeaningInput,
  ): Promise<CreateClarificationDraftResult>;

  addClarificationMaterial(
    operationId: string,
    intakeId: string,
    block: MaterialBlockInput,
  ): Promise<void>;

  /** Atomically materialize the complete clarified tuple and remove its Inbox draft. */
  completeClarificationDraft(
    input: CompleteClarificationDraftInput,
  ): Promise<CompleteClarificationDraftResult>;

  addMaterialBlock(input: AddMaterialBlockInput): Promise<AddMaterialBlockResult>;

  /** Revise learner-owned Context without changing the confirmed Sense or Binding. */
  reviseContext(input: ReviseContextInput): Promise<ReviseContextResult>;

  confirmClarification(
    input: ConfirmClarificationInput,
  ): Promise<ConfirmClarificationResult>;

  confirmExpressionBinding(
    input: ConfirmExpressionBindingInput,
  ): Promise<ConfirmExpressionBindingResult>;

  /** Direct acceptance of a learner scene against semantic facts pinned by a published target. */
  acceptPublishedLearningScene(
    input: PublishedLearningSceneAcceptanceInput,
  ): Promise<PublishedLearningSceneAcceptanceResult>;

}

export interface JourneyGatewayDeps {
  repository: JourneyRepository;
  clock: ClockPort;
  ids: RandomIdPort;
  semanticAcceptanceAuthority: SemanticAcceptanceAuthorityPort;
  languages: LearnerLanguagePort;
}

/**
 * Converts transport-authenticated acceptance provenance into the stored
 * authority fact. Transport adapters decide which connected caller may invoke
 * the command; this port does not repeat the learner's semantic decision.
 */
export interface SemanticAcceptanceAuthorityPort {
  verify(request: SensaIntakeAcceptance): SensaSemanticAcceptanceAuthority;
}

const localSemanticAcceptanceAuthority: SemanticAcceptanceAuthorityPort = {
  verify(request) {
    if (request.mode === 'learner_direct') {
      return { mode: 'learner_direct', actorId: LEARNER_USER_ID };
    }
    return {
      mode: 'delegated_agent',
      actorId: request.actorId,
      basis: request.basis,
      authorizationReference: request.authorizationReference,
    };
  },
};

const last = <T>(items: T[]): T | undefined => items[items.length - 1];

const createJourneyDraft = (state: JourneyState): JourneyState => ({
  ...state,
  meanings: [...state.meanings],
  registry: {
    senses: [...state.registry.senses],
    senseVersions: [...state.registry.senseVersions],
    expressions: [...state.registry.expressions],
    expressionVersions: [...state.registry.expressionVersions],
    bindings: [...state.registry.bindings],
    bindingVersions: [...state.registry.bindingVersions],
  },
  inboxItems: [...state.inboxItems],
  clarificationDrafts: [...state.clarificationDrafts],
  commandReceipts: [...state.commandReceipts],
});

const normalizedForm = (surfaceForm: string): string =>
  surfaceForm.trim().toLocaleLowerCase();

const contextProvenanceKind = (
  context: SensaIntakeContext | null | undefined,
): PersonalProvenanceKind => context?.source?.client === 'sensa-web' || !context?.source
  ? 'learner_authored'
  : 'imported';

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

class JourneyGatewayImpl implements PersonalMeaningJourneyGateway, SemanticIntakeModule {
  private state: JourneyState | null = null;
  private readonly usedIds = new Set<string>();
  private status: JourneyGatewayStatus = { ok: true, error: null, errorKind: null };
  private readonly listeners = new Set<() => void>();
  private ready: Promise<void>;
  private transaction: {before:JourneyState;settled:boolean}|null=null;

  constructor(private readonly deps: JourneyGatewayDeps) {
    this.ready = this.load();
    void this.ready.finally(() => this.notify());
  }

  private async load(): Promise<void> {
    try {
      const state = await this.deps.repository.load();
      this.rememberIds(state);
      this.state = state;
      this.status = { ok: true, error: null, errorKind: null };
    } catch (cause) {
      this.state = null;
      this.status = errorStatus(cause);
    }
  }

  reload(): void {
    this.ready = this.gate.then(() => this.load());
    void this.ready.finally(() => this.notify());
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
    const run = this.gate.then(async () => {
      await this.ready;
      const before=this.requireState();
      const transaction={before,settled:false};
      this.transaction=transaction;
      this.state=createJourneyDraft(before);
      try{
        const result=await work();
        if(!transaction.settled)this.state=before;
        return result;
      }
      catch(cause){
        if(!transaction.settled)this.state=before;
        throw cause;
      }finally{
        if(this.transaction===transaction)this.transaction=null;
      }
    });
    this.gate = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Stage compound cross-aggregate commands so validation failures cannot
   * leave unpublished registry facts visible in memory. */
  private async withStateTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }

  private requireState(): JourneyState {
    if (!this.state) {
      throw new Error(this.status.error ?? '本机个人意义数据不可用。');
    }
    return this.state;
  }

  private async persist(): Promise<void> {
    const state = this.requireState();
    const transaction=this.transaction;
    if(!transaction)throw new Error('个人意义写入必须在命令事务内执行。');
    try {
      const result=await this.deps.repository.commit({
        before:transaction.before,
        after:state,
        preparedMedia:preparedMediaSnapshot(),
      });
      markPreparedMediaCommitted(result.committedMediaIds);
      transaction.settled=true;
      this.status = { ok: true, error: null, errorKind: null };
    } catch (cause) {
      transaction.settled=true;
      try{this.state=await this.deps.repository.load();}
      catch{this.state=null;}
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

  private receipt(
    operationId: string,
    command: string,
    requestDigest?: string,
  ): CommandReceipt | null {
    const found = this.requireState().commandReceipts.find(
      (candidate) => candidate.operationId === operationId,
    );
    if (found && (
      found.command !== command
      || (requestDigest !== undefined
        && found.requestDigest !== undefined
        && found.requestDigest !== requestDigest)
    )) {
      throw new Error('这个 operationId 已用于另一个个人意义操作。');
    }
    return found ?? null;
  }

  private recordReceipt(
    operationId: string,
    command: string,
    result: Record<string, string | number | boolean | null>,
    requestDigest?: string,
  ): void {
    this.requireState().commandReceipts.push({
      operationId,
      command,
      result,
      ...(requestDigest === undefined ? {} : { requestDigest }),
    });
  }

  private replay<T>(operationId: string, command: string, requestDigest?: string): T | null {
    const found = this.receipt(operationId, command, requestDigest);
    return found ? ({ ...found.result, replayed: true } as T) : null;
  }

  // -- Personal Meaning record helpers ------------------------------------

  private findRecord(personalMeaningId: string): MeaningJourneyRecord | null {
    return this.requireState().meanings.find(
      (record) => record.personalMeaning.personalMeaningId === personalMeaningId,
    ) ?? null;
  }

  private requireRecord(personalMeaningId: string): MeaningJourneyRecord {
    const state=this.requireState();
    const index=state.meanings.findIndex(
      record=>record.personalMeaning.personalMeaningId===personalMeaningId,
    );
    const record=index<0?null:state.meanings[index]!;
    if (!record) throw new Error('找不到这条个人意义。');
    const original=this.transaction?.before.meanings.find(
      candidate=>candidate.personalMeaning.personalMeaningId===personalMeaningId,
    );
    if(original&&record===original){
      const draft=structuredClone(record);
      state.meanings[index]=draft;
      return draft;
    }
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

  private activeSourceExpressionAnchors(record: MeaningJourneyRecord) {
    const boundRevisions=new Set([
      ...record.bindingConfirmations.map(fact=>fact.personalExpressionAnchorRevisionId),
      ...record.semanticAcceptances.map(fact=>fact.personalExpressionAnchorRevisionId),
    ]);
    return this.activeExpressionAnchors(record).filter((anchor) => {
      const revision=this.currentExpressionAnchorRevision(record,anchor);
      return revision!==null&&!boundRevisions.has(revision.personalExpressionAnchorRevisionId);
    });
  }

  private activeExperienceAnchors(record: MeaningJourneyRecord) {
    return record.personalSemanticAnchors.filter((anchor) => anchor.status === 'active');
  }

  private displayLabel(record: MeaningJourneyRecord): string | null {
    const familiar = this.activeSourceExpressionAnchors(record)
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
      .filter((record) => record.personalMeaning.status === 'active'
        && buildPersonalMeaningLearningSources(record, this.state!.registry).length > 0)
      .map((record) => buildListItemView(record, this.state!.registry));
  }

  getWorldItems(): JourneyWorldItemView[] {
    if (!this.state) return [];
    return this.state.meanings
      .filter((record) => record.personalMeaning.status === 'active'
        && buildPersonalMeaningLearningSources(record, this.state!.registry).length > 0)
      .map((record) => buildWorldItemView(record, this.state!.registry));
  }

  getDetail(personalMeaningId: string): JourneyDetailView | null {
    if (!this.state) return null;
    const record = this.findRecord(personalMeaningId);
    return record ? buildDetailView(record, this.state.registry) : null;
  }

  getClarificationDraft(intakeId: string): ClarificationDraftView | null {
    if (!this.state) return null;
    const item = this.state.inboxItems.find((candidate) => candidate.intakeId === intakeId);
    if (!item) return null;
    const context = item.payload.context;
    const metadata = this.state.clarificationDrafts.find(
      (candidate) => candidate.intakeId === intakeId,
    );
    return {
      intakeId,
      context: context ? structuredClone(context) : null,
      materialBlocks: [
        ...(context?.textSegment ? [{ kind: 'text' as const, bodyText: context.textSegment }] : []),
        ...(context?.mediaReferenceIds.map((personalMediaObjectId) => ({
          kind: 'image' as const,
          personalMediaObjectId,
        })) ?? []),
      ],
      familiarExpression: item.payload.expression?.surfaceForm ?? null,
      startingPoint: metadata?.startingPoint
        ?? (item.status === 'pending_context'
          ? item.payload.expression ? 'from_expression' : 'from_experience'
          : item.status === 'pending_expression' ? 'from_experience' : 'from_expression'),
    };
  }

  getLearningSources(
    personalMeaningId: string,
    personalMeaningAlignmentId?: string,
  ): PersonalMeaningLearningSource[] {
    if (!this.state) return [];
    const record = this.findRecord(personalMeaningId);
    if (!record || record.personalMeaning.status !== 'active') return [];
    return buildPersonalMeaningLearningSources(
      record,
      this.state.registry,
      personalMeaningAlignmentId,
    );
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
    supportLanguageTag: string,
    intake: SensaIntakePayload | null = null,
    completedContext: SensaIntakeContext | null = intake?.context ?? null,
  ): { anchorId: string; anchorRevisionId: string } {
    const now = this.now();
    const anchorId = this.id();
    const anchorRevisionId = this.id();
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
      lifecycleRevision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedByOperationId: null,
    });
    record.personalSemanticAnchorRevisions.push({
      contractVersion: PSW,
      personalSemanticAnchorRevisionId: anchorRevisionId,
      personalSemanticAnchorId: anchorId,
      revision: 1,
      anchorKind: isImage ? 'image' : 'text',
      languageTag: isImage ? null : completedContext?.languageTag ?? supportLanguageTag,
      bodyText: isImage ? null : bodyText,
      personalMediaObjectId: isImage ? block.personalMediaObjectId! : null,
      structuredPayload: intake ? {
        intake: {
          contractVersion: intake.contractVersion,
          operationId: intake.operationId,
          capturedAt: intake.capturedAt,
          contextSource: intake.context?.source ?? null,
          contextLanguageTag: intake.context?.languageTag ?? null,
          mediaReferenceIds: intake.context?.mediaReferenceIds ?? [],
          completedContextSource: completedContext?.source ?? null,
          completedContextLanguageTag: completedContext?.languageTag ?? null,
          expression: intake.expression,
          senseCandidate: intake.sense,
          submittedAcceptance: intake.acceptance,
        },
      } : {},
      provenance: {
        kind: contextProvenanceKind(completedContext),
        sourceReferenceIds: intake
          ? [
              intake.operationId,
              intake.context?.source?.sourceReferenceId,
              completedContext?.source?.sourceReferenceId,
            ]
            .filter((value): value is string => Boolean(value))
          : [anchorId],
        createdByOperationId: operationId,
      },
      createdAt: now,
    });
    return { anchorId, anchorRevisionId };
  }

  async createClarificationDraft(
    input: CreatePersonalMeaningInput,
  ): Promise<CreateClarificationDraftResult> {
    return this.exclusive(async () => {
      const replay = this.replay<CreateClarificationDraftResult>(
        input.operationId,
        'CreateClarificationDraft',
      );
      if (replay) return replay;
      const blocks = input.blocks ?? [];
      const text = blocks
        .filter((block) => block.kind === 'text')
        .map((block) => block.bodyText?.trim() ?? '')
        .filter(Boolean)
        .join('\n\n');
      const mediaReferenceIds = blocks
        .filter((block) => block.kind === 'image')
        .map((block) => block.personalMediaObjectId)
        .filter((id): id is string => Boolean(id));
      const familiarExpression = input.familiarExpression?.surfaceForm.trim() ?? '';
      if (!text && mediaReferenceIds.length === 0 && !familiarExpression) {
        throw new Error('澄清草稿至少需要一段材料或一个熟悉表达。');
      }
      const languages = await this.deps.languages.read();
      const payload = sensaIntakePayloadSchema.parse({
        contractVersion: 'sensa-intake-v3',
        operationId: input.operationId,
        capturedAt: this.now(),
        context: text || mediaReferenceIds.length > 0 ? {
          modality: text ? mediaReferenceIds.length ? 'mixed' : 'text' : 'image',
          textSegment: text || null,
          mediaReferenceIds,
          languageTag: languages.supportLanguageTag,
          source: {
            client: 'sensa-web',
            url: null,
            title: 'Sensa Web',
            sourceReferenceId: null,
            domSelector: null,
            paragraphContext: null,
          },
        } : null,
        expression: familiarExpression ? {
          surfaceForm: familiarExpression,
          languageTag: languages.supportLanguageTag,
          occurrence: null,
          expressionTypeHint: null,
        } : null,
        sense: null,
        acceptance: null,
      });
      const item = createInboxItem(payload, this.id(), this.now());
      const state = this.requireState();
      state.inboxItems.push(item);
      state.clarificationDrafts.push({
        intakeId: item.intakeId,
        startingPoint: input.startingPoint ?? null,
      });
      const result = { intakeId: item.intakeId, status: item.status };
      this.recordReceipt(input.operationId, 'CreateClarificationDraft', result);
      await this.persist();
      return { ...result, replayed: false };
    });
  }

  async addClarificationMaterial(
    operationId: string,
    intakeId: string,
    block: MaterialBlockInput,
  ): Promise<void> {
    return this.exclusive(async () => {
      if (this.receipt(operationId, 'AddClarificationMaterial')) return;
      const state = this.requireState();
      const index = state.inboxItems.findIndex((candidate) => candidate.intakeId === intakeId);
      if (index < 0) throw new Error('找不到这条澄清草稿。');
      const item = state.inboxItems[index]!;
      const languages = await this.deps.languages.read();
      const existing = item.payload.context;
      const text = block.kind === 'text' ? block.bodyText?.trim() ?? '' : '';
      const mediaId = block.kind === 'image' ? block.personalMediaObjectId : null;
      if (block.kind === 'text' ? !text : !mediaId) throw new Error('新增材料不能为空。');
      const textSegment = [existing?.textSegment, text].filter(Boolean).join('\n\n') || null;
      const mediaReferenceIds = [
        ...(existing?.mediaReferenceIds ?? []),
        ...(mediaId ? [mediaId] : []),
      ];
      const payload = sensaIntakePayloadSchema.parse({
        ...item.payload,
        context: {
          modality: textSegment ? mediaReferenceIds.length ? 'mixed' : 'text' : 'image',
          textSegment,
          mediaReferenceIds,
          languageTag: existing?.languageTag ?? languages.supportLanguageTag,
          source: existing?.source ?? null,
        },
      });
      state.inboxItems[index] = createInboxItem(payload, item.intakeId, item.createdAt);
      this.recordReceipt(operationId, 'AddClarificationMaterial', { intakeId });
      await this.persist();
    });
  }

  private async writePersonalMeaning(
    input: CreatePersonalMeaningInput,
    options: {
      persist?: boolean;
      receipt?: boolean;
      languageContext?: CommandLanguages;
      intake?: SensaIntakePayload | null;
      completedContext?: SensaIntakeContext | null;
    } = {},
  ): Promise<CreatePersonalMeaningResult> {
    const { persist = true, receipt = true } = options;
    if (receipt) {
      const replay = this.replay<CreatePersonalMeaningResult>(
        input.operationId,
        'CreatePersonalMeaning',
      );
      if (replay) return replay;
    }
    const state = this.requireState();
    const familiarSurface = input.familiarExpression?.surfaceForm.trim() ?? '';
    if (input.familiarExpression && !familiarSurface) {
      throw new Error('熟悉表达不能为空。');
    }
    const blocks = input.blocks ?? [];
    if (blocks.length === 0 && !familiarSurface) {
      throw new Error('个人意义至少需要一个材料块或一个熟悉表达。');
    }

    // Read once, before any fact exists: this creation operation uses one
    // resolved language context throughout.
    const languages = options.languageContext ?? await this.deps.languages.read();
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
        lifecycleRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByOperationId: null,
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
        lifecycleRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByOperationId: null,
      });
      record.personalExpressionAnchorRevisions.push({
        contractVersion: PSW,
        personalExpressionAnchorRevisionId: familiarExpressionAnchorRevisionId,
        personalExpressionAnchorId: familiarExpressionAnchorId,
        revision: 1,
        // Provisional classification: the composer deliberately does not ask
        // for one, and the model refines it during clarification.
        expressionType: 'phrase',
        languageTag: languages.supportLanguageTag,
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
    const blockAnchors = blocks.map(
      (block, index) =>
        this.appendMaterialAnchor(
          record,
          input.operationId,
          block,
          languages.supportLanguageTag,
          index === 0 ? options.intake ?? null : null,
          index === 0 ? options.completedContext ?? options.intake?.context ?? null : null,
        ),
    );

    // A captured Expression belongs to the same Context even while its Sense
    // is unresolved. Preserve the exact occurrence as an unverified source
    // Anchor; learner confirmation later promotes this Anchor instead of
    // manufacturing a source-less duplicate.
    const capturedExpression = options.intake?.expression;
    let capturedExpressionAnchorId: string | null = null;
    if (
      capturedExpression?.occurrence
      && capturedExpression.languageTag
      && blockAnchors[0]
    ) {
      const anchorId = this.id();
      const anchorRevisionId = this.id();
      capturedExpressionAnchorId = anchorId;
      const sourceKind = contextProvenanceKind(
        options.completedContext ?? options.intake?.context,
      );
      record.personalExpressionAnchors.push({
        contractVersion: PSW,
        personalExpressionAnchorId: anchorId,
        personalMeaningId,
        currentRevision: 1,
        lifecycleRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByOperationId: null,
      });
      record.personalExpressionAnchorRevisions.push({
        contractVersion: PSW,
        personalExpressionAnchorRevisionId: anchorRevisionId,
        personalExpressionAnchorId: anchorId,
        revision: 1,
        expressionType: capturedExpression.expressionTypeHint ?? 'word',
        languageTag: capturedExpression.languageTag,
        surfaceForm: capturedExpression.surfaceForm,
        normalizedForm: normalizedForm(capturedExpression.surfaceForm),
        contextAnchorRevisionId: blockAnchors[0].anchorRevisionId,
        occurrence: capturedExpression.occurrence.locator,
        provenanceKind: sourceKind,
        verificationStatus: 'unverified',
        provenance: {
          kind: sourceKind,
          sourceReferenceIds: [options.intake!.operationId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
    }

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
          ...blockAnchors.map((anchor) => anchor.anchorId),
          capturedExpressionAnchorId,
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
    if (receipt) this.recordReceipt(input.operationId, 'CreatePersonalMeaning', result);
    if (persist) await this.persist();
    return { ...result, replayed: false };
  }

  async addMaterialBlock(input: AddMaterialBlockInput): Promise<AddMaterialBlockResult> {
    return this.exclusive(() => this.writeMaterialBlock(input));
  }

  private async writeMaterialBlock(input: AddMaterialBlockInput): Promise<AddMaterialBlockResult> {

    const replay = this.replay<AddMaterialBlockResult>(input.operationId, 'AddMaterialBlock');
    if (replay) return replay;
    const record = this.requireRecord(input.personalMeaningId);
    const languages = await this.deps.languages.read();
    const { anchorId } = this.appendMaterialAnchor(
      record,
      input.operationId,
      input.block,
      languages.supportLanguageTag,
    );
    this.appendMeaningRevision(record, input.operationId, [anchorId]);
    const result = { anchorId };
    this.recordReceipt(input.operationId, 'AddMaterialBlock', result);
    await this.persist();
    return { ...result, replayed: false };
  }

  async reviseContext(input: ReviseContextInput): Promise<ReviseContextResult> {
    return this.exclusive(() => this.withStateTransaction(async () => {
      const replay = this.replay<ReviseContextResult>(input.operationId, 'ReviseContext');
      if (replay) return replay;
      const record = this.requireRecord(input.personalMeaningId);
      if (record.personalMeaning.currentRevision !== input.expectedRevision) {
        throw new Error('localFlow.meaningChanged');
      }
      if (input.blocks.length === 0) throw new Error('localFlow.messageRequired');
      const imageCount = input.blocks.filter((block) => block.kind === 'image').length;
      if (imageCount > 3) throw new Error('localFlow.sceneImageRequirements');

      // Validate the full replacement before retiring any current anchor.
      for (const block of input.blocks) {
        if (block.kind === 'image') {
          if (!block.personalMediaObjectId || !isUuid(block.personalMediaObjectId)) {
            throw new Error('图片材料块必须引用本地媒体对象。');
          }
        } else if (!block.bodyText?.trim()) {
          throw new Error('文字材料块不能为空。');
        }
      }

      const languages = await this.deps.languages.read();
      const now = this.now();
      record.personalSemanticAnchors
        .filter((anchor) => anchor.status === 'active')
        .forEach((anchor) => {
          anchor.status = 'deleted';
          anchor.lifecycleRevision += 1;
          anchor.updatedAt = now;
          anchor.deletedAt = now;
          anchor.deletedByOperationId = input.operationId;
        });
      const anchorIds = input.blocks.map((block) => this.appendMaterialAnchor(
        record,
        input.operationId,
        block,
        languages.supportLanguageTag,
      ).anchorId);
      const personalMeaningRevisionId = this.appendMeaningRevision(
        record,
        input.operationId,
        anchorIds,
      );
      const result = {
        personalMeaningRevisionId,
        revision: record.personalMeaning.currentRevision,
      };
      this.recordReceipt(input.operationId, 'ReviseContext', result);
      await this.persist();
      return { ...result, replayed: false };
    }));
  }

  // -- clarification confirmation ------------------------------------------

  async confirmClarification(
    input: ConfirmClarificationInput,
  ): Promise<ConfirmClarificationResult> {
    return this.exclusive(() => this.writeClarification(input));
  }

  private async writeClarification(
    input: ConfirmClarificationInput,
    options: { persist?: boolean; receipt?: boolean } = {},
  ): Promise<ConfirmClarificationResult> {
    const { persist = true, receipt = true } = options;
    if (receipt) {
      const replay = this.replay<ConfirmClarificationResult>(
        input.operationId,
        'ConfirmClarification',
      );
      if (replay) return replay;
    }
    const state = this.requireState();
    const record = this.requireRecord(input.personalMeaningId);
    const languages = sensaPinnedLanguageContextSchema.parse(input.languageContext);

    // Validate the whole intent before writing any fact: a rejected step must
    // leave the store exactly as it was.
    const focusInput = input.focus ?? null;
    const statement = focusInput?.statement.trim() ?? '';
    if (focusInput && !statement) throw new Error('表达侧面陈述不能为空。');
    const notes = focusInput ? cleanNotes(focusInput.distinguishingNotes) : [];
    const aspectLabel = focusInput?.aspectLabel.trim() ?? '';
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
    if (!focusInput && (!expressionInput || !input.confirmExpression)) {
      throw new Error('无需 Focus 的语义条目必须同时确认 Context、Sense 与 Expression。');
    }

    const now = this.now();
    const personalMeaningRevision = this.latestMeaningRevision(record);
    if (!personalMeaningRevision) throw new Error('个人意义修订不存在，无法确认。');

    // 1) A Meaning Focus exists only when this Context needed an explicit
    //    aspect boundary. Clear contexts proceed directly to Sense construction.
    const meaningFocusId = focusInput ? this.id() : null;
    const meaningFocusRevisionId = focusInput ? this.id() : null;
    if (focusInput && meaningFocusId && meaningFocusRevisionId) {
      record.focuses.push({
        contractVersion: PSW,
        meaningFocusId,
        personalMeaningId: input.personalMeaningId,
        splitFromMeaningFocusId: null,
        currentRevision: 1,
        acceptedRevision: 1,
        lifecycleRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByOperationId: null,
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
    }

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
      languageContext:languages,
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
      inputDigest: digestOf({ focus: focusInput, transcript: input.transcript }),
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
      const capturedRevision = record.personalExpressionAnchorRevisions.find((revision) => (
        revision.verificationStatus === 'unverified'
        && revision.languageTag === item.languageTag
        && revision.expressionType === item.expressionType
        && revision.surfaceForm === item.surfaceForm
      ));
      return {
        candidateId: id,
        personalExpressionAnchorRevisionId:
          capturedRevision?.personalExpressionAnchorRevisionId ?? null,
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
          personalExpressionAnchorRevisionId: proposalExpressionCandidates.find(
            (candidate) => candidate.candidateId === candidateId,
          )?.personalExpressionAnchorRevisionId ?? null,
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
    if (receipt) this.recordReceipt(input.operationId, 'ConfirmClarification', result);
    if (persist) await this.persist();
    return { ...result, replayed: false };
  }

  async completeClarificationDraft(
    input: CompleteClarificationDraftInput,
  ): Promise<CompleteClarificationDraftResult> {
    return this.exclusive(async () => {
      const replay = this.replay<CompleteClarificationDraftResult>(
        input.operationId,
        'CompleteClarificationDraft',
      );
      if (replay) return replay;
      if (!input.expression || !input.confirmExpression) {
        throw new Error('进入我的语义世界前，需要同时确认 Context、Sense 与 Expression。');
      }
      return this.withStateTransaction(async () => {
        const state = this.requireState();
        const item = state.inboxItems.find((candidate) => candidate.intakeId === input.intakeId);
        if (!item) throw new Error('找不到这条澄清草稿。');
        const metadata = state.clarificationDrafts.find(
          (candidate) => candidate.intakeId === input.intakeId,
        );
        const context = sensaIntakeContextSchema.parse(input.context);
        const blocks: MaterialBlockInput[] = [
          ...(context?.textSegment
            ? [{ kind: 'text' as const, bodyText: context.textSegment }]
            : []),
          ...(context?.mediaReferenceIds.map((personalMediaObjectId) => ({
            kind: 'image' as const,
            personalMediaObjectId,
          })) ?? []),
        ];
        const created = await this.writePersonalMeaning({
          operationId: input.operationId,
          blocks,
          familiarExpression: item.payload.expression?.surfaceForm
            && !item.payload.expression.occurrence
            ? { surfaceForm: item.payload.expression.surfaceForm }
            : undefined,
          startingPoint: metadata?.startingPoint ?? null,
        }, {
          persist: false,
          receipt: false,
          languageContext: input.languageContext,
          intake: item.payload,
          completedContext: context,
        });
        const confirmed = await this.writeClarification({
          ...input,
          personalMeaningId: created.personalMeaningId,
        }, { persist: false, receipt: false });
        state.inboxItems = state.inboxItems.filter(
          (candidate) => candidate.intakeId !== input.intakeId,
        );
        state.clarificationDrafts = state.clarificationDrafts.filter(
          (candidate) => candidate.intakeId !== input.intakeId,
        );
        const result = {
          ...confirmed,
          personalMeaningId: created.personalMeaningId,
        };
        this.recordReceipt(input.operationId, 'CompleteClarificationDraft', result);
        await this.persist();
        return result;
      });
    });
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
      personalExpressionAnchorRevisionId?: string | null;
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
    pinned?: {
      expressionId: string;
      expressionVersionId: string;
      senseExpressionBindingId: string;
      bindingVersionId: string;
    },
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
    const existingExpression = pinned
      ? state.registry.expressions.find((expression) => expression.expressionId === pinned.expressionId)
      : state.registry.expressions.find((expression) =>
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
    if (pinned && !existingExpression) {
      throw new Error('固定的已发布 Expression 不存在。');
    }
    if (existingExpression) {
      expression = existingExpression;
      expressionVersion = state.registry.expressionVersions.find(
        (version) => pinned
          ? version.expressionVersionId === pinned.expressionVersionId
          : version.expressionId === expression.expressionId && version.normalizedForm === form,
      )!;
      if (!expressionVersion || expression.expressionType !== input.expressionType
        || expression.languageTag !== input.languageTag || expressionVersion.normalizedForm !== form) {
        throw new Error('固定的已发布 Expression Version 与学习目标不一致。');
      }
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

    const existingBinding = pinned
      ? state.registry.bindings.find((binding) => binding.senseExpressionBindingId === pinned.senseExpressionBindingId)
      : state.registry.bindings.find(
          (binding) =>
            binding.senseId === alignment.senseId
            && binding.expressionId === expression.expressionId
            && binding.relation === input.relation,
        );
    let binding: SensaSenseExpressionBindingSnapshot;
    let bindingVersion: SensaSenseExpressionBindingVersionSnapshot | undefined;
    if (pinned && !existingBinding) {
      throw new Error('固定的已发布 Binding 不存在。');
    }
    if (existingBinding) {
      binding = existingBinding;
      bindingVersion = state.registry.bindingVersions.find(
        (version) => pinned
          ? version.bindingVersionId === pinned.bindingVersionId
          : version.senseExpressionBindingId === binding.senseExpressionBindingId
            && version.senseVersionId === input.senseVersionId
            && version.expressionVersionId === expressionVersion.expressionVersionId
            && version.semanticCoverage === input.semanticCoverage,
      );
      if (pinned && (!bindingVersion || binding.senseId !== alignment.senseId
        || binding.expressionId !== expression.expressionId || binding.relation !== input.relation
        || bindingVersion.senseVersionId !== input.senseVersionId
        || bindingVersion.expressionVersionId !== expressionVersion.expressionVersionId
        || bindingVersion.semanticCoverage !== input.semanticCoverage)) {
        throw new Error('固定的已发布 Binding Version 与学习目标不一致。');
      }
      if (!bindingVersion) {
        const nextVersion = binding.currentVersionNumber + 1;
        const nextBindingVersionId = this.id();
        const updatedBinding={
          ...binding,
          currentVersionNumber:nextVersion,
          currentBindingVersionId:nextBindingVersionId,
        };
        state.registry.bindings[state.registry.bindings.indexOf(binding)]=updatedBinding;
        binding=updatedBinding;
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
    if (candidate.personalExpressionAnchorRevisionId) {
      const captured = record.personalExpressionAnchorRevisions.find(
        (revision) => revision.personalExpressionAnchorRevisionId
          === candidate.personalExpressionAnchorRevisionId,
      );
      const capturedAnchor = captured && record.personalExpressionAnchors.find(
        (item) => item.personalExpressionAnchorId === captured.personalExpressionAnchorId
          && item.status === 'active',
      );
      if (
        captured
        && capturedAnchor
        && captured.languageTag === input.languageTag
        && captured.expressionType === input.expressionType
        && captured.surfaceForm === input.surfaceForm
      ) {
        anchor = capturedAnchor;
        if (captured.verificationStatus === 'learner_confirmed') {
          anchorRevision = captured;
        } else {
          anchorRevision = {
            ...captured,
            personalExpressionAnchorRevisionId: this.id(),
            revision: capturedAnchor.currentRevision + 1,
            verificationStatus: 'learner_confirmed',
            provenance: {
              ...captured.provenance,
              sourceReferenceIds: [...new Set([
                ...captured.provenance.sourceReferenceIds,
                candidate.candidateId,
              ])],
              createdByOperationId: input.operationId,
            },
            createdAt: now,
          };
          capturedAnchor.currentRevision = anchorRevision.revision;
          capturedAnchor.updatedAt = now;
          record.personalExpressionAnchorRevisions.push(anchorRevision);
        }
      }
    }
    // The intake fast track pre-creates the captured expression anchor with
    // this candidate id in its provenance (either language role), so match
    // any active anchor before creating a duplicate.
    for (const candidateAnchor of anchorRevision ? [] : this.activeExpressionAnchors(record)) {
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
        lifecycleRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByOperationId: null,
      };
      anchorRevision = {
        contractVersion: PSW,
        personalExpressionAnchorRevisionId: anchorRevisionId,
        personalExpressionAnchorId: anchorId,
        revision: 1,
        expressionType: input.expressionType,
        languageTag: input.languageTag,
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
    return this.exclusive(()=>this.writeExpressionBinding(input));
  }

  private async writeExpressionBinding(
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
    await this.persist();
    return { ...result, replayed: false };
  }

  // -- published learning scene acceptance --------------------------------

  private installPublishedLearningFacts(input: PublishedLearningSceneAcceptanceInput): void {
    const state = this.requireState();
    const semantic = publishedLearningSemanticFactsSchema.parse(input.semantic);
    const { source, target } = input;
    for (const value of [
      source.bookId, source.bookVersionId, source.contentReleaseId,
      target.learningTargetId, target.curriculumMembershipId, target.senseId,
      target.senseVersionId, target.bindingId, target.bindingVersionId,
      semantic.expressionId, semantic.expressionVersionId,
    ]) if (!isUuid(value)) throw new Error('学习包语义身份无效。');
    if (!Number.isFinite(Date.parse(source.publishedAt)) || !target.expression.trim()
      || !target.targetLanguageTag.trim()) throw new Error('学习包语义来源无效。');

    const sourceReferenceIds = [source.contentReleaseId, source.bookVersionId, source.packageKey];
    const semanticProvenance = {
      sourceKind: 'published_release' as const,
      sourceReferenceIds,
      generator: null,
    };
    const senseVersion: SensaSenseVersionSnapshot = {
      contractVersion: REG,
      senseVersionId: target.senseVersionId,
      senseId: target.senseId,
      versionNumber: semantic.senseVersionNumber,
      origin: 'published_release',
      semanticPolicyVersion: semantic.semanticPolicyVersion,
      semanticSpec: structuredClone(semantic.semanticSpec),
      provenance: semanticProvenance,
      reviewStatus: 'reviewed',
      contentReleaseId: source.contentReleaseId,
      createdAt: source.publishedAt,
    };
    const expressionVersion: SensaExpressionVersionSnapshot = {
      contractVersion: REG,
      expressionVersionId: semantic.expressionVersionId,
      expressionId: semantic.expressionId,
      versionNumber: semantic.expressionVersionNumber,
      surfaceForm: target.expression.trim(),
      normalizedForm: normalizedForm(target.expression),
      structure: structuredClone(semantic.expressionStructure),
      provenance: semanticProvenance,
      createdAt: source.publishedAt,
    };
    const bindingVersion: SensaSenseExpressionBindingVersionSnapshot = {
      contractVersion: REG,
      bindingVersionId: target.bindingVersionId,
      senseExpressionBindingId: target.bindingId,
      versionNumber: semantic.bindingVersionNumber,
      senseVersionId: target.senseVersionId,
      expressionVersionId: semantic.expressionVersionId,
      semanticCoverage: semantic.semanticCoverage,
      registerLabel: semantic.registerLabel,
      usageConstraints: [...semantic.usageConstraints],
      provenance: semanticProvenance,
      reviewStatus: 'reviewed',
      createdAt: source.publishedAt,
    };

    const existingSenseByKey = state.registry.senses.find((fact) => fact.senseKey === semantic.senseKey);
    if (existingSenseByKey && existingSenseByKey.senseId !== target.senseId) {
      throw new Error('学习包 Sense key 与本机语义注册表冲突。');
    }
    const existingSense = state.registry.senses.find((fact) => fact.senseId === target.senseId);
    if (existingSense) {
      if (existingSense.senseKey !== semantic.senseKey) throw new Error('学习包 Sense identity 冲突。');
      if (semantic.senseVersionNumber > existingSense.currentVersionNumber) {
        state.registry.senses[state.registry.senses.indexOf(existingSense)]={
          ...existingSense,
          currentVersionNumber:semantic.senseVersionNumber,
          currentSenseVersionId:target.senseVersionId,
        };
      }
    } else {
      state.registry.senses.push({
        contractVersion: REG,
        senseId: target.senseId,
        senseKey: semantic.senseKey,
        currentSenseVersionId: target.senseVersionId,
        currentVersionNumber: semantic.senseVersionNumber,
        createdAt: source.publishedAt,
      } satisfies SensaSenseSnapshot);
    }
    const existingSenseVersion = state.registry.senseVersions.find((fact) => fact.senseVersionId === target.senseVersionId);
    if (existingSenseVersion) {
      if (digestOf({senseId:existingSenseVersion.senseId,versionNumber:existingSenseVersion.versionNumber,semanticPolicyVersion:existingSenseVersion.semanticPolicyVersion,semanticSpec:existingSenseVersion.semanticSpec,reviewStatus:existingSenseVersion.reviewStatus})
        !== digestOf({senseId:senseVersion.senseId,versionNumber:senseVersion.versionNumber,semanticPolicyVersion:senseVersion.semanticPolicyVersion,semanticSpec:senseVersion.semanticSpec,reviewStatus:senseVersion.reviewStatus})) throw new Error('学习包 Sense Version 冲突。');
    } else state.registry.senseVersions.push(senseVersion);

    const existingExpression = state.registry.expressions.find((fact) => fact.expressionId === semantic.expressionId);
    if (existingExpression) {
      if (existingExpression.expressionType !== semantic.expressionType
        || existingExpression.languageTag !== target.targetLanguageTag) throw new Error('学习包 Expression identity 冲突。');
      if (semantic.expressionVersionNumber > existingExpression.currentVersionNumber) {
        state.registry.expressions[state.registry.expressions.indexOf(existingExpression)]={
          ...existingExpression,
          currentVersionNumber:semantic.expressionVersionNumber,
          currentExpressionVersionId:semantic.expressionVersionId,
        };
      }
    } else {
      state.registry.expressions.push({
        contractVersion: REG,
        expressionId: semantic.expressionId,
        expressionType: semantic.expressionType,
        languageTag: target.targetLanguageTag,
        lexemeId: null,
        currentExpressionVersionId: semantic.expressionVersionId,
        currentVersionNumber: semantic.expressionVersionNumber,
        createdAt: source.publishedAt,
      });
    }
    const existingExpressionVersion = state.registry.expressionVersions.find((fact) => fact.expressionVersionId === semantic.expressionVersionId);
    if (existingExpressionVersion) {
      if (digestOf({expressionId:existingExpressionVersion.expressionId,versionNumber:existingExpressionVersion.versionNumber,surfaceForm:existingExpressionVersion.surfaceForm,normalizedForm:existingExpressionVersion.normalizedForm,structure:existingExpressionVersion.structure})
        !== digestOf({expressionId:expressionVersion.expressionId,versionNumber:expressionVersion.versionNumber,surfaceForm:expressionVersion.surfaceForm,normalizedForm:expressionVersion.normalizedForm,structure:expressionVersion.structure})) throw new Error('学习包 Expression Version 冲突。');
    } else state.registry.expressionVersions.push(expressionVersion);

    const existingBinding = state.registry.bindings.find((fact) => fact.senseExpressionBindingId === target.bindingId);
    if (existingBinding) {
      if (existingBinding.senseId !== target.senseId
        || existingBinding.expressionId !== semantic.expressionId
        || existingBinding.relation !== semantic.relation) throw new Error('学习包 Binding identity 冲突。');
      if (semantic.bindingVersionNumber > existingBinding.currentVersionNumber) {
        state.registry.bindings[state.registry.bindings.indexOf(existingBinding)]={
          ...existingBinding,
          currentVersionNumber:semantic.bindingVersionNumber,
          currentBindingVersionId:target.bindingVersionId,
        };
      }
    } else {
      state.registry.bindings.push({
        contractVersion: REG,
        senseExpressionBindingId: target.bindingId,
        senseId: target.senseId,
        expressionId: semantic.expressionId,
        relation: semantic.relation,
        currentBindingVersionId: target.bindingVersionId,
        currentVersionNumber: semantic.bindingVersionNumber,
        createdAt: source.publishedAt,
      });
    }
    const existingBindingVersion = state.registry.bindingVersions.find((fact) => fact.bindingVersionId === target.bindingVersionId);
    if (existingBindingVersion) {
      if (digestOf({senseExpressionBindingId:existingBindingVersion.senseExpressionBindingId,versionNumber:existingBindingVersion.versionNumber,senseVersionId:existingBindingVersion.senseVersionId,expressionVersionId:existingBindingVersion.expressionVersionId,semanticCoverage:existingBindingVersion.semanticCoverage,registerLabel:existingBindingVersion.registerLabel,usageConstraints:existingBindingVersion.usageConstraints,reviewStatus:existingBindingVersion.reviewStatus})
        !== digestOf({senseExpressionBindingId:bindingVersion.senseExpressionBindingId,versionNumber:bindingVersion.versionNumber,senseVersionId:bindingVersion.senseVersionId,expressionVersionId:bindingVersion.expressionVersionId,semanticCoverage:bindingVersion.semanticCoverage,registerLabel:bindingVersion.registerLabel,usageConstraints:bindingVersion.usageConstraints,reviewStatus:bindingVersion.reviewStatus})) throw new Error('学习包 Binding Version 冲突。');
    } else state.registry.bindingVersions.push(bindingVersion);
  }

  private learningSceneAnchorRevision(
    anchorId: string,
    revision: number,
    input: PublishedLearningSceneAcceptanceInput,
    revisionId = this.id(),
  ) {
    const now = this.now();
    return {
      contractVersion: PSW,
      personalSemanticAnchorRevisionId: revisionId,
      personalSemanticAnchorId: anchorId,
      revision,
      anchorKind: 'scene' as const,
      languageTag: null,
      bodyText: input.scene.body.trim() || null,
      personalMediaObjectId: null,
      structuredPayload: {
        learningScene: {
          sceneId: input.scene.sceneId,
          revisionId: input.scene.revisionId,
          revision: input.scene.revision,
          learningTargetId: input.target.learningTargetId,
          curriculumMembershipId: input.target.curriculumMembershipId,
        },
        media: structuredClone(input.scene.media),
        publishedSource: structuredClone(input.source),
      },
      provenance: {
        kind: 'learner_authored' as const,
        sourceReferenceIds: [input.scene.revisionId, input.source.contentReleaseId],
        createdByOperationId: input.operationId,
      },
      createdAt: now,
    };
  }

  async acceptPublishedLearningScene(
    input: PublishedLearningSceneAcceptanceInput,
  ): Promise<PublishedLearningSceneAcceptanceResult> {
    return this.exclusive(async () => {
      const requestDigest = digestOf(input);
      const replay = this.replay<PublishedLearningSceneAcceptanceResult>(
        input.operationId,
        'AcceptPublishedLearningScene',
        requestDigest,
      );
      if (replay) return replay;
      if (!isUuid(input.operationId) || !isUuid(input.scene.sceneId)
        || !isUuid(input.scene.revisionId) || input.scene.revision < 1
        || !Number.isFinite(input.scene.createdAt)
        || (!input.scene.body.trim() && input.scene.media.length === 0)) {
        throw new Error('个人场景版本无效。');
      }
      return this.withStateTransaction(async () => {
        this.installPublishedLearningFacts(input);

      const matchedRecord = input.existingPersonalMeaningId
        ? this.findRecord(input.existingPersonalMeaningId)
        : this.requireState().meanings.find((candidate) => (
            candidate.personalMeaning.status === 'active'
            && candidate.personalSemanticAnchorRevisions.some((revision) => (
              (revision.structuredPayload.learningScene as {sceneId?:string}|undefined)?.sceneId
              === input.scene.sceneId
            ))
          ));
      if(input.existingPersonalMeaningId&&!matchedRecord)throw new Error('找不到这条个人意义。');
      const recordForScene=matchedRecord
        ? this.requireRecord(matchedRecord.personalMeaning.personalMeaningId)
        : null;
      if (recordForScene) {
        const record = recordForScene;
        if (record.personalMeaning.status !== 'active') throw new Error('个人意义已不可更新。');
        const alignment = record.alignments.find((candidate) => (
          candidate.status === 'active'
          && candidate.senseId === input.target.senseId
          && candidate.senseVersionId === input.target.senseVersionId
        ));
        if (!alignment || !record.bindingConfirmations.some((confirmation) => (
          confirmation.senseVersionId === input.target.senseVersionId
          && confirmation.bindingVersionId === input.target.bindingVersionId
        ))) throw new Error('个人场景不能更新到另一个意思或表达。');
        const currentRevision = record.personalSemanticAnchorRevisions.find((candidate) => (
          (candidate.structuredPayload.learningScene as {sceneId?:string}|undefined)?.sceneId === input.scene.sceneId
        ));
        if (!currentRevision) throw new Error('找不到已接受的个人场景。');
        const anchor = record.personalSemanticAnchors.find((candidate) => (
          candidate.personalSemanticAnchorId === currentRevision.personalSemanticAnchorId
        ));
        if (!anchor) throw new Error('找不到已接受的个人场景。');
        const nextRevision = this.learningSceneAnchorRevision(
          anchor.personalSemanticAnchorId,
          anchor.currentRevision + 1,
          input,
        );
        anchor.currentRevision = nextRevision.revision;
        anchor.updatedAt = nextRevision.createdAt;
        record.personalSemanticAnchorRevisions.push(nextRevision);
        record.personalMeaning.updatedAt = nextRevision.createdAt;
        const result = {
          personalMeaningId: record.personalMeaning.personalMeaningId,
          personalSemanticAnchorId: anchor.personalSemanticAnchorId,
          personalSemanticAnchorRevisionId: nextRevision.personalSemanticAnchorRevisionId,
        };
        this.recordReceipt(input.operationId, 'AcceptPublishedLearningScene', result, requestDigest);
        await this.persist();
        return { ...result, replayed: false };
      }

      const payload = sensaIntakePayloadSchema.parse({
        contractVersion: 'sensa-intake-v3',
        operationId: input.operationId,
        capturedAt: new Date(input.scene.createdAt).toISOString(),
        context: {
          modality: input.scene.body.trim()
            ? input.scene.media.length ? 'mixed' : 'text'
            : 'image',
          textSegment: input.scene.body.trim() || null,
          mediaReferenceIds: input.scene.media.map((item) => item.mediaId),
          languageTag: null,
          source: {
            client: 'sensa-learning-runtime',
            url: null,
            title: input.source.title,
            sourceReferenceId: input.scene.revisionId,
            domSelector: null,
            paragraphContext: null,
          },
        },
        expression: {
          surfaceForm: input.target.expression,
          languageTag: input.target.targetLanguageTag,
          occurrence: {
            surfaceForm: input.target.expression,
            locator: {
              kind: 'learning_target',
              learningTargetId: input.target.learningTargetId,
              curriculumMembershipId: input.target.curriculumMembershipId,
            },
          },
          expressionTypeHint: input.semantic.expressionType,
        },
        sense: {
          senseKey: input.semantic.senseKey,
          semanticSpec: input.semantic.semanticSpec,
          wordingSource: 'reviewed',
          resolutionProvenance: {
            resolverKind: 'external_tool',
            provider: 'sensa-published-content',
            model: null,
            policyVersion: input.semantic.semanticPolicyVersion,
            sourceReferenceIds: [input.source.contentReleaseId, input.source.bookVersionId],
          },
        },
        acceptance: { mode: 'learner_direct' },
      });
      const state = this.requireState();
      const authority = this.deps.semanticAcceptanceAuthority.verify(payload.acceptance!);
      const outcome = executeFastTrack(
        state,
        {
          payload,
          operationId: input.operationId,
          authority,
          pinnedSense: {
            senseId: input.target.senseId,
            senseVersionId: input.target.senseVersionId,
          },
        },
        this.enginePorts(),
      );
      this.state = outcome.nextState;
      const anchor = outcome.record.personalSemanticAnchors[0]!;
      const originalAnchorRevisionId = outcome.record.personalSemanticAnchorRevisions[0]!.personalSemanticAnchorRevisionId;
      const anchorRevision = this.learningSceneAnchorRevision(
        anchor.personalSemanticAnchorId,
        1,
        input,
        originalAnchorRevisionId,
      );
      outcome.record.personalSemanticAnchorRevisions = [anchorRevision];
      outcome.record.personalMeaningRevisions[0] = {
        ...outcome.record.personalMeaningRevisions[0]!,
        displayLabel: input.target.expression,
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds: [input.scene.revisionId, input.source.contentReleaseId],
          createdByOperationId: input.operationId,
        },
      };
      this.settleExpressionBinding(
        outcome.record,
        outcome.alignment,
        outcome.bindingCandidate,
        { operationId: input.operationId, ...outcome.bindingInput },
        null,
        {
          expressionId: input.semantic.expressionId,
          expressionVersionId: input.semantic.expressionVersionId,
          senseExpressionBindingId: input.target.bindingId,
          bindingVersionId: input.target.bindingVersionId,
        },
      );
      const result = {
        personalMeaningId: outcome.personalMeaningId,
        personalSemanticAnchorId: anchor.personalSemanticAnchorId,
        personalSemanticAnchorRevisionId: anchorRevision.personalSemanticAnchorRevisionId,
      };
      this.recordReceipt(input.operationId, 'AcceptPublishedLearningScene', result, requestDigest);
      await this.persist();
      return { ...result, replayed: false };
      });
    });
  }

  // -- ubiquitous multimodal intake -----------------------------------------

  /** The engine never touches storage or receipts; ids and clock come from the gateway. */
  private enginePorts(): IntakeEnginePorts {
    return { newId: () => this.id(), nowIso: () => this.now() };
  }

  snapshot(): SensaIntakeItem[] {
    if (!this.state) return [];
    return structuredClone(this.state.inboxItems);
  }

  async submit(payload: SensaIntakePayload): Promise<SemanticIntakeResult> {
    return this.exclusive(() => this.runIngest(payload.operationId, payload));
  }

  private async runIngest(
    operationId: string,
    payload: SensaIntakePayload,
  ): Promise<SemanticIntakeResult> {
    // Boundary validation: the capture payload must satisfy the intake
    // contract before the engine sees it, and the transport idempotency key
    // must be the command's receipt key.
    const parsed = sensaIntakePayloadSchema.parse(payload);
    if (parsed.operationId !== operationId) {
      throw new Error('ingest 的 operationId 必须与载荷的 operationId 一致。');
    }
    const requestDigest = digestOf(parsed);
    const replay = this.replay<SemanticIntakeResult>(operationId, 'Ingest', requestDigest);
    if (replay) return replay;
    const state = this.requireState();
    const decision = evaluateIntakeRoute(parsed);
    if (decision.route === 'inbox') {
      const item = createInboxItem(parsed, this.id(), this.now());
      state.inboxItems.push(item);
      const result: IngestResult = { route: 'inbox', intakeId: item.intakeId, status: item.status };
      this.recordReceipt(operationId, 'Ingest', result, requestDigest);
      await this.persist();
      return { ...result, replayed: false };
    }
    const authority = this.deps.semanticAcceptanceAuthority.verify(
      parsed.acceptance!,
    );
    // Fast track: the engine materializes the whole Personal Meaning record
    // atomically; the shared binding core then settles the registry
    // Expression/Binding and the confirmation fact in the same command.
    const outcome = executeFastTrack(
      state,
      { payload: parsed, operationId, authority: authority! },
      this.enginePorts(),
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
    this.recordReceipt(operationId, 'Ingest', result, requestDigest);
    await this.persist();
    return { ...result, replayed: false };
  }

  async resolve(command: ResolveSemanticIntakeCommand): Promise<SemanticIntakeResult> {
    return this.exclusive(() => this.runInboxResolution(
      command.operationId,
      command.intakeId,
      command.sense,
    ));
  }

  private async runInboxResolution(
    operationId: string,
    intakeId: string,
    resolution: ResolveSemanticIntakeCommand['sense'],
  ): Promise<SemanticIntakeResult> {

    const replay = this.replay<SemanticIntakeResult>(operationId, 'ResolveInboxItem');
    if (replay) return replay;
    const state = this.requireState();
    // Boundary validation for the learner-confirmed sense before any write.
    const sense = sensaIntakeSenseSchema.parse(resolution);
    const authority = this.deps.semanticAcceptanceAuthority.verify({
      mode: 'learner_direct',
    });
    const outcome = resolveInboxItemWithSense(
      state,
      { intakeId, sense, operationId, authority },
      this.enginePorts(),
    );
    this.state = outcome.nextState;
    this.requireState().clarificationDrafts = this.requireState().clarificationDrafts.filter(
      (candidate) => candidate.intakeId !== intakeId,
    );
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
    await this.persist();
    return { ...result, replayed: false };
  }

  async dismiss(command: DismissSemanticIntakeCommand): Promise<void> {
    return this.exclusive(() => this.writeInboxDismissal(
      command.operationId,
      command.intakeId,
    ));
  }

  private async writeInboxDismissal(operationId: string, intakeId: string): Promise<void> {
    const found = this.receipt(operationId, 'DismissInboxItem');
    if (found) return;
    const state = this.requireState();
    // Pure removal; throws when the item is unknown, before any write.
    this.state = dismissInboxItem(state, intakeId);
    this.requireState().clarificationDrafts = this.requireState().clarificationDrafts.filter(
      (candidate) => candidate.intakeId !== intakeId,
    );
    this.recordReceipt(operationId, 'DismissInboxItem', { intakeId });
    await this.persist();
  }
}

const createJourneyImplementation = (
  deps: Partial<JourneyGatewayDeps> = {},
): JourneyGatewayImpl =>
  new JourneyGatewayImpl({
    repository: deps.repository ?? new LibraryJourneyRepository(),
    clock: deps.clock ?? systemClock,
    ids: deps.ids ?? cryptoRandomIdPort,
    semanticAcceptanceAuthority:
      deps.semanticAcceptanceAuthority ?? localSemanticAcceptanceAuthority,
    languages: deps.languages ?? localLearnerLanguages,
  });

export interface JourneyModules {
  personalMeaningJourney: PersonalMeaningJourneyGateway;
  semanticIntake: SemanticIntakeModule;
}

/** Create the two domain interfaces over one atomic local implementation. */
export const createJourneyModules = (
  deps: Partial<JourneyGatewayDeps> = {},
): JourneyModules => {
  const implementation = createJourneyImplementation(deps);
  return {
    personalMeaningJourney: implementation,
    semanticIntake: implementation,
  };
};

export const createJourneyGateway = (
  deps: Partial<JourneyGatewayDeps> = {},
): PersonalMeaningJourneyGateway => createJourneyModules(deps).personalMeaningJourney;

/** Shared browser modules use the same implementation and transaction queue. */
const browserJourneyModules = createJourneyModules();
export const journeyGateway = browserJourneyModules.personalMeaningJourney;
export const semanticIntakeModule = browserJourneyModules.semanticIntake;
