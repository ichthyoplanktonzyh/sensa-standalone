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
import {assertClarificationSource,sourceWitnessFromState,sameClarificationSource,ClarificationSourceChangedError,type ClarificationSourceKind,type ClarificationSourceWitness} from './clarificationSource';
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
  type SenseRegistryState,
} from './store';
import {LibraryJourneyRepository,JourneyConflictError,type JourneyRepository,type JourneyReadCondition} from './repository';
import {markPreparedMediaCommitted,preparedMediaSnapshot} from './mediaStore';
import {
  buildDetailView,
  buildListItemView,
  buildWorldItemView,
} from './projection';
import { buildPersonalMeaningLearningSources } from './learningSource';
import {createMeaningLookup,createMeaningLookupCooperatively,type MeaningLookupResult} from './meaningLookup';
import {runCooperatively} from './cooperative';
import {validateMeaningQuery,confirmedLookupConnections} from './meaningLookupFacts';
import {indexRegistry,type IndexedRegistryRead} from './registryRead';
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
  /** Read lifecycle only; an unknown World must not be presented as empty. */
  loading?:boolean;
}

export interface PersonalMeaningJourneyGateway {
  subscribe(listener: () => void): () => void;
  getStatus(): JourneyGatewayStatus;
  reload(): void;
  getListItems(): JourneyListItemView[];
  getWorldItems(): JourneyWorldItemView[];
  /** Bounded, owner-local confirmed semantics; no Context, drafts or detail projection. */
  lookupMeanings(query: string): Promise<MeaningLookupResult>;
  getDetail(personalMeaningId: string): JourneyDetailView | null;
  getClarificationDraft(intakeId: string): ClarificationDraftView | null;
  /** Exact owner-local learner witness; no full gateway load in the Library adapter. */
  captureClarificationSource(kind:ClarificationSourceKind,id:string):Promise<ClarificationSourceWitness>;
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

const normalizedForm = (surfaceForm: string, languageTag: string): string =>
  surfaceForm.trim().toLocaleLowerCase(languageTag);

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

type ReplayIntent={operationId:string;command:string;requestDigest?:string;objectResult?:boolean};
type CommandTransaction={before:JourneyState;settled:boolean;preconditions:JourneyReadCondition[];replay?:ReplayIntent};
class JourneyGatewayImpl implements PersonalMeaningJourneyGateway, SemanticIntakeModule {
  private state: JourneyState | null = null;
  private committedState: JourneyState | null = null;
  private lookupState: JourneyState | null = null;
  private lookupIndex: ReturnType<typeof createMeaningLookup> | null = null;
  private readonly usedIds = new Set<string>();
  private status: JourneyGatewayStatus = { ok: true, error: null, errorKind: null };
  private readonly listeners = new Set<() => void>();
  private ready: Promise<void> = Promise.resolve();
  private loadStarted=false;
  private scopedCommitGeneration=0;
  private loading=false;
  private transaction:CommandTransaction|null=null;
  private stopRepositoryObservation:(()=>void)|undefined;
  private refreshScheduled=false;
  private registryReads=new WeakMap<SenseRegistryState,IndexedRegistryRead>();
  private meaningReads=new WeakMap<JourneyState['meanings'],Map<string,MeaningJourneyRecord>>();
  private sourceIncarnation=crypto.randomUUID();

  constructor(private readonly deps: JourneyGatewayDeps) {
    // A read-only teacher lookup must not also hydrate the entire World UI.
    // In-memory adapters retain their snapshot-based query implementation.
    if(!deps.repository.lookupMeanings)void this.ensureLoaded();
  }

  private ensureLoaded():Promise<void>{
    if(!this.loadStarted){this.loadStarted=true;this.ready=this.load();void this.ready.finally(()=>this.notify());}
    return this.ready;
  }

  private async load(): Promise<void> {
    this.loading=true;this.notify();
    const previous=this.committedState;
    try {
      let generation=this.scopedCommitGeneration;
      let state = await this.deps.repository.load();
      await this.rememberIdsCooperatively(state);
      // A bounded command may commit while an explicitly opened global view
      // is loading. Recheck that view without making the bounded command wait
      // on a reload queued behind its own gate.
      while(generation!==this.scopedCommitGeneration){
        generation=this.scopedCommitGeneration;
        state=this.deps.repository.refresh?await this.deps.repository.refresh(state,'frame'):await this.deps.repository.load();
        await this.rememberIdsCooperatively(state);
      }
      if(this.committedState!==previous)return;
      this.state = state;
      this.committedState = state;
      this.status = { ok: true, error: null, errorKind: null };
    } catch (cause) {
      if(this.committedState!==previous)return;
      this.state = null;
      this.committedState = null;
      this.status = errorStatus(cause);
    }finally{this.loading=false;}
  }

  reload(): void {
    this.loadStarted=true;
    const previousReady=this.ready;
    const loading=this.gate.then(()=>previousReady).then(()=>this.load());
    this.ready=loading;
    this.gate=loading.then(()=>undefined,()=>undefined);
    void loading.finally(() => this.notify());
  }

  getStatus(): JourneyGatewayStatus {
    return { ...this.status,loading:this.status.ok&&(this.loading||!this.loadStarted) };
  }

  subscribe(listener: () => void): () => void {
    void this.ensureLoaded();
    this.listeners.add(listener);
    if(this.listeners.size===1&&this.deps.repository.subscribe){
      this.stopRepositoryObservation=this.deps.repository.subscribe(()=>this.refreshObservedFrame());
      // A detached view may have missed changes while no listener existed.
      this.refreshObservedFrame();
    }
    return () => {
      this.listeners.delete(listener);
      if(!this.listeners.size){this.stopRepositoryObservation?.();this.stopRepositoryObservation=undefined;}
    };
  }

  private refreshObservedFrame():void{
    if(this.refreshScheduled)return;
    this.refreshScheduled=true;
    const ready=this.ensureLoaded();
    const refreshing=this.gate.then(async()=>{
      await ready;this.refreshScheduled=false;
      if(!this.listeners.size)return;
      const previous=this.committedState;
      try{
        const state=previous&&this.deps.repository.refresh
          ?await this.deps.repository.refresh(previous,'frame'):await this.deps.repository.load();
        if(state===previous)return;
        await this.rememberIdsCooperatively(state);
        this.state=state;this.committedState=state;this.status={ok:true,error:null,errorKind:null};
      }catch(cause){this.state=null;this.committedState=null;this.status=errorStatus(cause);}
      this.notify();
    });
    this.gate=refreshing.then(()=>undefined,()=>{this.refreshScheduled=false;});
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

  /** Reuse the same domain command in a purpose-specific repository frame.
   * Never publish that partial frame as the full gateway's World snapshot. */
  private isolatedCommand<T>(operationId:string,command:string,requestDigest:string,work:()=>Promise<T>):Promise<T>{
    const repository=this.deps.repository;
    const run=this.gate.then(async()=>{
      // Exact retries precede allocation/source reads, including after the
      // source has advanced, been discarded or otherwise disappeared.
      const receipt=this.matchReceipt(await repository.readReceipt?.(operationId)??undefined,command,requestDigest);
      if(receipt)return {...receipt.result,replayed:true} as unknown as T;
      const result=await work();
      this.scopedCommitGeneration++;
      // An explicit global view can start loading while this command runs.
      // Do not await a reload queued behind this command's own gate.
      if(this.loadStarted&&this.committedState&&repository.refresh){
        try{const state=await repository.refresh(this.committedState,'frame');await this.rememberIdsCooperatively(state);this.state=state;this.committedState=state;}
        catch(cause){this.state=null;this.committedState=null;this.status=errorStatus(cause);}
        this.notify();
      }
      return result;
    });
    this.gate=run.then(()=>undefined,()=>undefined);return run;
  }

  private exclusive<T>(work: () => Promise<T>,refreshFrame=false): Promise<T> {
    const ready=this.ensureLoaded();
    const run = this.gate.then(async () => {
      await ready;
      if(refreshFrame&&this.deps.repository.refresh&&this.committedState){
        const prior=this.committedState,current=await this.deps.repository.refresh(prior,'frame');
        if(current!==prior){await this.rememberIdsCooperatively(current);this.state=current;this.committedState=current;}
      }
      const before=this.requireState();
      const transaction:CommandTransaction={before,settled:false,preconditions:[]};
      this.transaction=transaction;
      this.state=createJourneyDraft(before);
      try{
        const result=await work();
        if(!transaction.settled)this.state=before;
        return result;
      }
      catch(cause){
        if(!transaction.settled)this.state=before;
        // A concurrent writer may have committed this exact operation after
        // both callers checked its receipt. The failed commit already reloaded
        // durable facts. Replay that receipt; never rerun the command/model.
        if(transaction.settled&&cause instanceof JourneyConflictError&&transaction.replay&&this.state){
          const intent=transaction.replay,found=this.state.commandReceipts.find(row=>row.operationId===intent.operationId);
          const receipt=this.matchReceipt(found,intent.command,intent.requestDigest);
          if(receipt)return (intent.objectResult?{...receipt.result,replayed:true}:undefined) as T;
        }
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

  async captureClarificationSource(kind:ClarificationSourceKind,id:string):Promise<ClarificationSourceWitness>{
    if(this.deps.repository.captureSource)return this.deps.repository.captureSource(kind,id);
    await this.ensureLoaded();
    return sourceWitnessFromState(this.requireState(),this.sourceIncarnation,kind,id);
  }

  private async requireClarificationSource(witness:ClarificationSourceWitness,kind:ClarificationSourceKind,id:string):Promise<void>{
    assertClarificationSource(witness,kind,id);
    const durable=await this.captureClarificationSource(kind,id),state=this.requireState();
    if(!sameClarificationSource(witness,durable)||!sameClarificationSource(witness,sourceWitnessFromState(state,durable.incarnation,kind,id)))throw new ClarificationSourceChangedError();
    // Validate again under the write lock, including an otherwise untouched
    // draft hint. A valid check before an async operation is not a commit guard.
    const preconditions=this.transaction!.preconditions;
    if(kind==='personal_meaning')preconditions.push({table:'semanticMeanings',key:id,expected:state.meanings.find(record=>record.personalMeaning.personalMeaningId===id)});
    else preconditions.push({table:'semanticInbox',key:id,expected:state.inboxItems.find(item=>item.intakeId===id)},
      {table:'semanticDrafts',key:id,expected:state.clarificationDrafts.find(draft=>draft.intakeId===id)});
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
        preconditions:transaction.preconditions,
      });
      markPreparedMediaCommitted(result.committedMediaIds);
      transaction.settled=true;
      this.state=result.state??state;
      this.committedState = this.state;
      if(result.state)await this.rememberIdsCooperatively(result.state);
      this.status = { ok: true, error: null, errorKind: null };
    } catch (cause) {
      transaction.settled=true;
      try{
        this.state=await this.deps.repository.load();
        this.committedState=this.state;
        await this.rememberIdsCooperatively(this.state);
        this.status={ok:true,error:null,errorKind:null};
      }catch(reloadCause){
        this.state=null;
        this.committedState=null;
        this.status=errorStatus(reloadCause);
      }
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

  private async rememberIdsCooperatively(state:JourneyState):Promise<void>{
    const started=performance.now();
    const ids=this.usedIds;
    function* fact(value:object):Generator<void>{
      // Identity reservation is not a recursive search of learner prose,
      // source payloads, semantic boundaries or other opaque content.
      for(const [field,valueId] of Object.entries(value))if(field.endsWith('Id')&&typeof valueId==='string'&&isUuid(valueId))ids.add(valueId);
      yield;
    }
    await runCooperatively((function*(){
      for(const rows of Object.values(state.registry))for(const row of rows)yield*fact(row);
      for(const meaning of state.meanings){
        yield*fact(meaning.personalMeaning);
        for(const rows of Object.values(meaning))if(Array.isArray(rows))for(const row of rows)yield*fact(row);
        for(const version of meaning.proposalVersions)for(const candidate of version.expressionCandidates)yield*fact(candidate);
      }
      for(const item of state.inboxItems){
        yield*fact(item);yield*fact(item.payload);
        for(const id of item.payload.context?.mediaReferenceIds??[])if(isUuid(id))ids.add(id);
      }
      for(const draft of state.clarificationDrafts)yield*fact(draft);
      for(const receipt of state.commandReceipts){yield*fact(receipt);yield*fact(receipt.result);}
    })());
    if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.journey.identities',{start:started,end:performance.now()});
  }

  private now(): string {
    return this.deps.clock.nowIso();
  }

  private matchReceipt(found:CommandReceipt|undefined,command:string,requestDigest?:string):CommandReceipt|null{
    if(found&&(found.command!==command||requestDigest!==undefined&&found.requestDigest!==requestDigest))throw new Error('这个 operationId 已用于另一个个人意义操作。');
    return found??null;
  }
  private async receipt(
    operationId: string,
    command: string,
    requestDigest?: string,
  ): Promise<CommandReceipt | null> {
    if(this.transaction)this.transaction.replay={operationId,command,requestDigest};
    const found = this.requireState().commandReceipts.find(
      (candidate) => candidate.operationId === operationId,
    );
    // Even a local cache hit must cross the durable incarnation check. A clear
    // or replacement can precede the cross-tab notification by one event turn.
    if(!this.deps.repository.readReceipt)return this.matchReceipt(found,command,requestDigest);
    let persisted:CommandReceipt|null;
    try{persisted=await this.deps.repository.readReceipt(operationId);}
    catch(cause){
      this.state=null;this.committedState=null;this.status=errorStatus(cause);
      if(this.transaction)this.transaction.settled=true;
      this.notify();throw cause;
    }
    if(found&&!persisted)throw new JourneyConflictError();
    if(!persisted)return null;
    this.matchReceipt(persisted,command,requestDigest);
    if(found)return persisted;
    try{
      const state=await this.deps.repository.load();await this.rememberIdsCooperatively(state);
      this.state=state;this.committedState=state;this.status={ok:true,error:null,errorKind:null};
    }catch(cause){this.state=null;this.committedState=null;this.status=errorStatus(cause);throw cause;}
    finally{if(this.transaction)this.transaction.settled=true;this.notify();}
    return persisted;
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

  private async replay<T>(operationId: string, command: string, requestDigest?: string): Promise<T | null> {
    const found = await this.receipt(operationId, command, requestDigest);
    if(this.transaction?.replay)this.transaction.replay.objectResult=true;
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

  private lookupFactsUnchanged(state:JourneyState):boolean{
    const previous=this.lookupState;
    return !!previous&&(previous===state||previous.meanings.length===state.meanings.length
      &&previous.meanings.every((row,index)=>row===state.meanings[index])
      &&(Object.keys(state.registry) as Array<keyof JourneyState['registry']>).every(kind=>
        previous.registry[kind].length===state.registry[kind].length
        &&previous.registry[kind].every((row,index)=>row===state.registry[kind][index])));
  }

  private confirmedMeaningLookup(state=this.committedState) {
    if (!state || !this.status.ok) throw new Error('semantic_world_unavailable');
    if (this.lookupState !== state || !this.lookupIndex) {
      if(!this.lookupFactsUnchanged(state)||!this.lookupIndex)this.lookupIndex = createMeaningLookup(state);
      this.lookupState = state;
    }
    return this.lookupIndex;
  }

  private lookupJobs=new WeakMap<JourneyState,Promise<ReturnType<typeof createMeaningLookup>>>();
  private async cooperativeLookup(state:JourneyState){
    if(!this.status.ok)throw new Error('semantic_world_unavailable');
    if(this.lookupIndex&&this.lookupFactsUnchanged(state)){this.lookupState=state;return this.lookupIndex;}
    let building=this.lookupJobs.get(state);
    if(!building){building=createMeaningLookupCooperatively(state);this.lookupJobs.set(state,building);}
    const index=await building;this.lookupState=state;this.lookupIndex=index;return index;
  }

  async lookupMeanings(query: string): Promise<MeaningLookupResult> {
      validateMeaningQuery(query);
      if(this.deps.repository.lookupMeanings){
        if(!this.status.ok)throw new Error('semantic_world_unavailable');
        try{return await this.deps.repository.lookupMeanings(query);}
        catch(cause){
          this.state=null;this.committedState=null;this.status=errorStatus(cause);
          if(this.transaction)this.transaction.settled=true;
          this.notify();throw cause;
        }
      }
      await this.ensureLoaded();
      const prior=this.committedState;
      if(!prior)throw new Error('semantic_world_unavailable');
      const state=await this.deps.repository.refresh?.(prior)??prior;
      if(state!==prior&&!this.transaction&&this.committedState===prior){
        await this.rememberIdsCooperatively(state);
        if(!this.transaction&&this.committedState===prior){this.state=state;this.committedState=state;this.notify();}
      }
      return (await this.cooperativeLookup(state)).query(query);
  }

  getListItems(): JourneyListItemView[] {
    const state=this.committedState;if (!state) return [];
    const registry=this.registryRead(state);
    const started=performance.now();
    const items=state.meanings
      .filter((record) => record.personalMeaning.status === 'active'
        && confirmedLookupConnections(record,registry).length > 0)
      .map((record) => buildListItemView(record,registry));
    if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.journey.listView',{start:started,end:performance.now()});
    return items;
  }

  getWorldItems(): JourneyWorldItemView[] {
    const state=this.committedState;if (!state) return [];
    const registry=this.registryRead(state);
    const started=performance.now();
    const items=state.meanings
      .filter((record) => record.personalMeaning.status === 'active'
        && confirmedLookupConnections(record,registry).length > 0)
      .map((record) => buildWorldItemView(record,registry));
    if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.journey.worldView',{start:started,end:performance.now()});
    return items;
  }

  private registryRead(state:JourneyState):IndexedRegistryRead{
    let read=this.registryReads.get(state.registry);if(!read){read=indexRegistry(state.registry);this.registryReads.set(state.registry,read);}return read;
  }
  private committedMeaning(state:JourneyState,id:string):MeaningJourneyRecord|undefined{
    let meanings=this.meaningReads.get(state.meanings);
    if(!meanings){meanings=new Map(state.meanings.map(record=>[record.personalMeaning.personalMeaningId,record]));this.meaningReads.set(state.meanings,meanings);}
    return meanings.get(id);
  }

  getDetail(personalMeaningId: string): JourneyDetailView | null {
    const state=this.committedState;if (!state) return null;
    const record = this.committedMeaning(state,personalMeaningId);
    return record ? buildDetailView(record,this.registryRead(state)) : null;
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
    const state=this.committedState;if (!state) return [];
    const record = this.committedMeaning(state,personalMeaningId);
    if (!record || record.personalMeaning.status !== 'active') return [];
    return buildPersonalMeaningLearningSources(
      record,
      this.registryRead(state),
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
      languageTag: isImage ? null : completedContext?.languageTag ?? null,
      bodyText: isImage ? null : bodyText,
      personalMediaObjectId: isImage ? block.personalMediaObjectId! : null,
      structuredPayload: intake ? {
        intake: {
          contractVersion: intake.contractVersion,
          operationId: intake.operationId,
          capturedAt: intake.capturedAt,
          contextSource: intake.context?.source ?? null,
          contextLanguageTag: intake.context?.languageTag ?? null,
          contextLanguageObservation:intake.context?.languageObservation??null,
          mediaReferenceIds: intake.context?.mediaReferenceIds ?? [],
          completedContextSource: completedContext?.source ?? null,
          completedContextLanguageTag: completedContext?.languageTag ?? null,
          completedContextLanguageObservation:completedContext?.languageObservation??null,
          expression: intake.expression,
          contextText: intake.context?.textSegment ?? null,
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
    if(!this.loadStarted&&this.deps.repository.withDraftCreation){
      return this.isolatedCommand(input.operationId,'CreateClarificationDraft',digestOf(input),()=>
        this.deps.repository.withDraftCreation!({operationId:input.operationId,reservedIds:(input.blocks??[]).flatMap(block=>block.personalMediaObjectId?[block.personalMediaObjectId]:[])},this.deps.ids,
          (repository,ids)=>new JourneyGatewayImpl({...this.deps,repository,ids}).createClarificationDraft(input)));
    }
    return this.exclusive(async () => {
      const replay = await this.replay<CreateClarificationDraftResult>(
        input.operationId,
        'CreateClarificationDraft',
        digestOf(input),
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
      const payload = sensaIntakePayloadSchema.parse({
        contractVersion: 'sensa-intake-v3',
        operationId: input.operationId,
        capturedAt: this.now(),
        context: text || mediaReferenceIds.length > 0 ? {
          modality: text ? mediaReferenceIds.length ? 'mixed' : 'text' : 'image',
          textSegment: text || null,
          mediaReferenceIds,
          languageTag: null,
          languageObservation:null,
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
          languageTag: null,
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
      this.recordReceipt(input.operationId, 'CreateClarificationDraft', result,digestOf(input));
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
      const requestDigest=digestOf({operationId,intakeId,block});
      if (await this.receipt(operationId, 'AddClarificationMaterial',requestDigest)) return;
      const state = this.requireState();
      const index = state.inboxItems.findIndex((candidate) => candidate.intakeId === intakeId);
      if (index < 0) throw new Error('找不到这条澄清草稿。');
      const item = state.inboxItems[index]!;
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
          languageTag: existing?.languageTag ?? null,
          languageObservation:existing?.languageObservation??null,
          source: existing?.source ?? null,
        },
      });
      state.inboxItems[index] = createInboxItem(payload, item.intakeId, item.createdAt);
      this.recordReceipt(operationId, 'AddClarificationMaterial', { intakeId },requestDigest);
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
      contextWordingSource?: 'learner_authored' | 'llm_suggested';
    } = {},
  ): Promise<CreatePersonalMeaningResult> {
    const { persist = true, receipt = true } = options;
    if (receipt) {
      const replay = await this.replay<CreatePersonalMeaningResult>(
        input.operationId,
        'CreatePersonalMeaning',
        digestOf(input),
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
        normalizedForm: normalizedForm(familiarSurface, languages.supportLanguageTag),
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
    const blockAnchors = blocks.map((block,index) => {
      const sourceText=index===0&&block.kind==='text'?options.intake?.context?.textSegment:null;
      const rewritten=Boolean(sourceText&&sourceText!==block.bodyText?.trim());
      const original=this.appendMaterialAnchor(record,input.operationId,
        rewritten?{...block,bodyText:sourceText!}:block,options.intake??null,
        rewritten?options.intake!.context:options.completedContext??options.intake?.context??null,
      );
      if(rewritten){
        const sourceRevision=record.personalSemanticAnchorRevisions.find(row=>row.personalSemanticAnchorRevisionId===original.anchorRevisionId)!;
        const anchor=record.personalSemanticAnchors.find(row=>row.personalSemanticAnchorId===original.anchorId)!;
        const now=this.now();
        // Preserve the captured version for occurrence locators. The accepted
        // clarified Context is a new revision, never a replacement of its source.
        record.personalSemanticAnchorRevisions.push({
          ...sourceRevision,personalSemanticAnchorRevisionId:this.id(),revision:2,
          bodyText:block.bodyText!.trim(),languageTag:options.completedContext?.languageTag??null,
          structuredPayload:{...sourceRevision.structuredPayload,intake:{
            ...(sourceRevision.structuredPayload.intake as Record<string,unknown>),
            completedContextSource:options.completedContext?.source??null,
            completedContextLanguageTag:options.completedContext?.languageTag??null,
            completedContextLanguageObservation:options.completedContext?.languageObservation??null,
          }},provenance:{...sourceRevision.provenance,
            kind:options.contextWordingSource??sourceRevision.provenance.kind,
            sourceReferenceIds:[sourceRevision.personalSemanticAnchorRevisionId],
          },createdAt:now,
        });
        anchor.currentRevision=2;anchor.updatedAt=now;
      }
      return original;
    });

    // A captured Expression belongs to the same Context even while its Sense
    // is unresolved. Preserve the exact occurrence as an unverified source
    // Anchor; learner confirmation later promotes this Anchor instead of
    // manufacturing a source-less duplicate.
    const capturedExpression = options.intake?.expression;
    const capturedLocator=capturedExpression?.occurrence?.locator;
    const capturedContextAnchor=capturedLocator?.kind==='media_region'
      ? blockAnchors[blocks.findIndex(block=>block.personalMediaObjectId===capturedLocator.mediaReferenceId)]
      : blockAnchors[0];
    let capturedExpressionAnchorId: string | null = null;
    if (
      capturedExpression?.occurrence
      && capturedExpression.languageTag
      && capturedContextAnchor
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
        normalizedForm: normalizedForm(capturedExpression.surfaceForm, capturedExpression.languageTag),
        contextAnchorRevisionId: capturedContextAnchor.anchorRevisionId,
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
    if (receipt) this.recordReceipt(input.operationId, 'CreatePersonalMeaning', result,digestOf(input));
    if (persist) await this.persist();
    return { ...result, replayed: false };
  }

  async addMaterialBlock(input: AddMaterialBlockInput): Promise<AddMaterialBlockResult> {
    return this.exclusive(() => this.writeMaterialBlock(input));
  }

  private async writeMaterialBlock(input: AddMaterialBlockInput): Promise<AddMaterialBlockResult> {

    const replay = await this.replay<AddMaterialBlockResult>(input.operationId, 'AddMaterialBlock',digestOf(input));
    if (replay) return replay;
    const record = this.requireRecord(input.personalMeaningId);
    const { anchorId } = this.appendMaterialAnchor(
      record,
      input.operationId,
      input.block,
    );
    this.appendMeaningRevision(record, input.operationId, [anchorId]);
    const result = { anchorId };
    this.recordReceipt(input.operationId, 'AddMaterialBlock', result,digestOf(input));
    await this.persist();
    return { ...result, replayed: false };
  }

  async reviseContext(input: ReviseContextInput): Promise<ReviseContextResult> {
    if(!this.loadStarted&&this.deps.repository.withMeaningCommand){
      return this.isolatedCommand(input.operationId,'ReviseContext',digestOf(input),()=>
        this.deps.repository.withMeaningCommand!({personalMeaningId:input.personalMeaningId,operationId:input.operationId,identityCount:input.blocks.length*2+1,reservedIds:input.blocks.flatMap(block=>block.personalMediaObjectId?[block.personalMediaObjectId]:[])},this.deps.ids,
          (repository,ids)=>new JourneyGatewayImpl({...this.deps,repository,ids}).reviseContext(input)));
    }
    return this.exclusive(() => this.withStateTransaction(async () => {
      const replay = await this.replay<ReviseContextResult>(input.operationId, 'ReviseContext',digestOf(input));
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
      this.recordReceipt(input.operationId, 'ReviseContext', result,digestOf(input));
      await this.persist();
      return { ...result, replayed: false };
    }));
  }

  // -- clarification confirmation ------------------------------------------

  async confirmClarification(
    input: ConfirmClarificationInput,
  ): Promise<ConfirmClarificationResult> {
    return this.exclusive(() => this.writeClarification(input),true);
  }

  private async writeClarification(
    input: ConfirmClarificationInput,
    options: { persist?: boolean; receipt?: boolean } = {},
  ): Promise<ConfirmClarificationResult> {
    const { persist = true, receipt = true } = options;
    if (receipt) {
      const replay = await this.replay<ConfirmClarificationResult>(
        input.operationId,
        'ConfirmClarification',
        digestOf(input),
      );
      if (replay) return replay;
      await this.requireClarificationSource(input.source,'personal_meaning',input.personalMeaningId);
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
    const semanticSpec = this.buildSemanticSpec(input.sense);
    const reused = input.sense.reuseSense
      ? this.confirmedMeaningLookup().resolve(input.sense.reuseSense) : null;
    if (input.sense.reuseSense && (!reused || reused.senseKey !== senseKey
      || digestOf(reused.semanticSpec) !== digestOf(semanticSpec))) {
      throw new Error('要复用的已确认意思已变化，或与当前审阅的语义不一致。请重新澄清。');
    }
    if(reused)this.transaction!.preconditions.push(...this.confirmedMeaningLookup().confirmationConditions(input.sense.reuseSense!));
    const existingSense = state.registry.senses.find((sense) => sense.senseKey === senseKey);
    if (!reused && existingSense) {
      throw new Error('这个语义 key 已存在；复用必须明确选择已确认的 Sense Version，不能只按 key 自动匹配。请重新澄清。');
    }
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
    let senseId: string;
    let senseVersionId: string;
    let resolution: 'create_new' | 'reuse_existing';
    if (reused) {
      senseId = reused.senseId;
      senseVersionId = reused.senseVersionId;
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
    if (receipt) this.recordReceipt(input.operationId, 'ConfirmClarification', result,digestOf(input));
    if (persist) await this.persist();
    return { ...result, replayed: false };
  }

  async completeClarificationDraft(
    input: CompleteClarificationDraftInput,
  ): Promise<CompleteClarificationDraftResult> {
    if(!this.loadStarted&&this.deps.repository.withClarificationCommand){
      return this.isolatedCommand(input.operationId,'CompleteClarificationDraft',digestOf(input),()=>
        this.deps.repository.withClarificationCommand!(input,this.deps.ids,(repository,ids)=>new JourneyGatewayImpl({...this.deps,repository,ids}).completeClarificationDraft(input)));
    }
    return this.exclusive(async () => {
      const replay = await this.replay<CompleteClarificationDraftResult>(
        input.operationId,
        'CompleteClarificationDraft',
        digestOf(input),
      );
      if (replay) return replay;
      await this.requireClarificationSource(input.source,'intake',input.intakeId);
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
          contextWordingSource:input.contextWordingSource,
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
        this.recordReceipt(input.operationId, 'CompleteClarificationDraft', result,digestOf(input));
        await this.persist();
        return result;
      });
    },true);
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
    const form = normalizedForm(input.surfaceForm, input.languageTag);
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
    return this.exclusive(()=>this.writeExpressionBinding(input),true);
  }

  private async writeExpressionBinding(
    input: ConfirmExpressionBindingInput,
  ): Promise<ConfirmExpressionBindingResult> {
    const replay = await this.replay<ConfirmExpressionBindingResult>(
      input.operationId,
      'ConfirmExpressionBinding',
      digestOf(input),
    );
    if (replay) return replay;
    await this.requireClarificationSource(input.source,'personal_meaning',input.personalMeaningId);
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
    this.recordReceipt(input.operationId, 'ConfirmExpressionBinding', result,digestOf(input));
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
      normalizedForm: normalizedForm(target.expression, target.targetLanguageTag),
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
      const replay = await this.replay<PublishedLearningSceneAcceptanceResult>(
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
    const replay = await this.replay<SemanticIntakeResult>(operationId, 'Ingest', requestDigest);
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

    const requestDigest=digestOf({operationId,intakeId,resolution});
    const replay = await this.replay<SemanticIntakeResult>(operationId, 'ResolveInboxItem',requestDigest);
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
    this.recordReceipt(operationId, 'ResolveInboxItem', result,requestDigest);
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
    const requestDigest=digestOf({operationId,intakeId});
    const found = await this.receipt(operationId, 'DismissInboxItem',requestDigest);
    if (found) return;
    const state = this.requireState();
    // Pure removal; throws when the item is unknown, before any write.
    this.state = dismissInboxItem(state, intakeId);
    this.requireState().clarificationDrafts = this.requireState().clarificationDrafts.filter(
      (candidate) => candidate.intakeId !== intakeId,
    );
    this.recordReceipt(operationId, 'DismissInboxItem', { intakeId },requestDigest);
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
