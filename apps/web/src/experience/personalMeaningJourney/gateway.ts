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
  SensaIntakeAcceptance,
  SensaIntakeContext,
  SensaIntakeItem,
  SensaIntakePayload,
  SensaSemanticAcceptanceAuthority,
} from '@sensa/contracts/sensa';
import { sensaIntakeContextSchema, sensaIntakePayloadSchema, sensaIntakeSenseSchema } from '@sensa/contracts/sensa';
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
import {appendMaterialAnchor,createPersonalMeaningFacts} from './materialFacts';
import {applyClarificationFacts} from './clarificationFacts';
import {isAlignmentActive} from './alignmentLifecycle';
import {meaningCorrectionContext,meaningCorrectionPayload,meaningCorrectionBinding,correctionReason} from './meaningCorrection';
import {installPublishedLearningFacts,learningSceneAnchorRevision} from './publishedSceneFacts';
import {settleExpressionBinding} from './expressionBindingFacts';
import {appendMeaningRevision,latestMeaningRevision} from './meaningRecords';
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
  CorrectPersonalMeaningInput,
  CorrectPersonalMeaningResult,
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
  ChangeMeaningLifecycleInput,
  ChangeMeaningLifecycleResult,
} from './types';

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
  changeMeaningLifecycle(input:ChangeMeaningLifecycleInput):Promise<ChangeMeaningLifecycleResult>;
  correctPersonalMeaning(input:CorrectPersonalMeaningInput):Promise<CorrectPersonalMeaningResult>;

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

  private requireRecord(personalMeaningId: string,allowDeleted=false): MeaningJourneyRecord {
    const state=this.requireState();
    const index=state.meanings.findIndex(
      record=>record.personalMeaning.personalMeaningId===personalMeaningId,
    );
    const record=index<0?null:state.meanings[index]!;
    if (!record) throw new Error('找不到这条个人意义。');
    if(!allowDeleted&&record.personalMeaning.status!=='active')throw new Error('localFlow.meaningChanged');
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

  /** Save unconfirmed material in the Inbox; this does not accept a Meaning. */
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
    const languages=options.languageContext??await this.deps.languages.read();
    const result=createPersonalMeaningFacts(this.requireState(),this.enginePorts(),input,languages,options);
    if(receipt)this.recordReceipt(input.operationId,'CreatePersonalMeaning',result,digestOf(input));
    if(persist)await this.persist();
    return {...result,replayed:false};
  }

  async addMaterialBlock(input: AddMaterialBlockInput): Promise<AddMaterialBlockResult> {
    if(!this.loadStarted&&this.deps.repository.withMeaningCommand){
      return this.isolatedCommand(input.operationId,'AddMaterialBlock',digestOf(input),()=>
        this.deps.repository.withMeaningCommand!({personalMeaningId:input.personalMeaningId,operationId:input.operationId,identityCount:3,reservedIds:input.block.personalMediaObjectId?[input.block.personalMediaObjectId]:[]},this.deps.ids,
          (repository,ids)=>new JourneyGatewayImpl({...this.deps,repository,ids}).addMaterialBlock(input)));
    }
    return this.exclusive(() => this.writeMaterialBlock(input));
  }

  private async writeMaterialBlock(input: AddMaterialBlockInput): Promise<AddMaterialBlockResult> {

    const replay = await this.replay<AddMaterialBlockResult>(input.operationId, 'AddMaterialBlock',digestOf(input));
    if (replay) return replay;
    const record = this.requireRecord(input.personalMeaningId);
    const { anchorId } = appendMaterialAnchor(this.enginePorts(),
      record,
      input.operationId,
      input.block,
    );
    appendMeaningRevision(this.enginePorts(),record, input.operationId, [anchorId]);
    const result = { anchorId };
    this.recordReceipt(input.operationId, 'AddMaterialBlock', result,digestOf(input));
    await this.persist();
    return { ...result, replayed: false };
  }

  async changeMeaningLifecycle(input:ChangeMeaningLifecycleInput):Promise<ChangeMeaningLifecycleResult>{
    if(!['delete','restore'].includes(input.action)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)throw new Error('localFlow.meaningChanged');
    if(!this.loadStarted&&this.deps.repository.withMeaningCommand){
      return this.isolatedCommand(input.operationId,'ChangeMeaningLifecycle',digestOf(input),()=>
        this.deps.repository.withMeaningCommand!({personalMeaningId:input.personalMeaningId,operationId:input.operationId,identityCount:1},this.deps.ids,
          (repository,ids)=>new JourneyGatewayImpl({...this.deps,repository,ids}).changeMeaningLifecycle(input)));
    }
    return this.exclusive(()=>this.withStateTransaction(async()=>{
      const replay=await this.replay<ChangeMeaningLifecycleResult>(input.operationId,'ChangeMeaningLifecycle',digestOf(input));if(replay)return replay;
      const record=this.requireRecord(input.personalMeaningId,true),head=record.personalMeaning;
      if(head.currentRevision!==input.expectedRevision||head.status!==(input.action==='delete'?'active':'deleted'))throw new Error('localFlow.meaningChanged');
      const previous=latestMeaningRevision(record)! ,at=this.now();
      head.lifecycleRevision++;head.status=input.action==='delete'?'deleted':'active';
      head.deletedAt=head.status==='deleted'?at:null;head.deletedByOperationId=head.status==='deleted'?input.operationId:null;
      const revisionId=appendMeaningRevision({...this.enginePorts(),nowIso:()=>at},record,input.operationId,[input.personalMeaningId]);
      const revision=latestMeaningRevision(record)!;
      revision.displayLabel=previous.displayLabel;revision.learnerIntentNote=previous.learnerIntentNote;
      revision.lifecycle={kind:input.action,revision:head.lifecycleRevision};
      const result={personalMeaningId:input.personalMeaningId,personalMeaningRevisionId:revisionId,revision:head.currentRevision,lifecycleRevision:head.lifecycleRevision,status:head.status};
      this.recordReceipt(input.operationId,'ChangeMeaningLifecycle',result,digestOf(input));await this.persist();
      return {...result,replayed:false};
    }));
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
      const anchorIds = input.blocks.map((block) => appendMaterialAnchor(this.enginePorts(),
        record,
        input.operationId,
        block,
      ).anchorId);
      const personalMeaningRevisionId = appendMeaningRevision(this.enginePorts(),
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

  async correctPersonalMeaning(input:CorrectPersonalMeaningInput):Promise<CorrectPersonalMeaningResult>{
    const request=structuredClone(input),payload=sensaIntakePayloadSchema.parse(request.payload);request.payload=payload;
    if(payload.operationId!==request.operationId||evaluateIntakeRoute(payload).route!=='fast_track'||payload.acceptance?.mode!=='learner_direct')throw Error('localFlow.annotationInvalid');
    if(!this.loadStarted&&this.deps.repository.withCorrectionCommand)return this.isolatedCommand(request.operationId,'CorrectPersonalMeaning',digestOf(request),()=>
      this.deps.repository.withCorrectionCommand!(request,this.deps.ids,(repository,ids)=>new JourneyGatewayImpl({...this.deps,repository,ids}).correctPersonalMeaning(request)));
    return this.exclusive(async()=>{
      const replay=await this.replay<CorrectPersonalMeaningResult>(request.operationId,'CorrectPersonalMeaning',digestOf(request));if(replay)return replay;
      await this.requireClarificationSource(request.source,'personal_meaning',request.personalMeaningId);
      const record=this.requireRecord(request.personalMeaningId),alignment=record.alignments.find(row=>row.personalMeaningAlignmentId===request.personalMeaningAlignmentId&&isAlignmentActive(record,row));
      const occurrence=payload.expression!.occurrence!,locator=occurrence.locator;
      if(!alignment||locator.kind!=='personal_meaning'||locator.personalMeaningId!==request.personalMeaningId||payload.expression!.surfaceForm!==occurrence.surfaceForm)throw Error('localFlow.meaningChanged');
      if(digestOf(payload.context)!==digestOf(meaningCorrectionContext(record,locator.personalSemanticAnchorRevisionIds)))throw Error('localFlow.meaningChanged');
      const prior=meaningCorrectionPayload(record,indexRegistry(this.requireState().registry),alignment.personalMeaningAlignmentId).expression!;
      const sameExpression=payload.expression!.surfaceForm===prior.surfaceForm&&payload.expression!.languageTag===prior.languageTag&&payload.expression!.expressionTypeHint===prior.expressionTypeHint;
      const priorBinding=meaningCorrectionBinding(record,alignment);
      const originalAnchor=record.personalExpressionAnchorRevisions.find(row=>row.personalExpressionAnchorRevisionId===priorBinding?.personalExpressionAnchorRevisionId);
      const outcome=executeFastTrack(this.requireState(),{payload,operationId:request.operationId,authority:this.deps.semanticAcceptanceAuthority.verify(payload.acceptance!),pinnedSense:request.reuseSense,expressionWordingSource:sameExpression?originalAnchor?.provenanceKind??'imported':'learner_authored',existingMeaning:{record,contextAnchorRevisionId:locator.personalSemanticAnchorRevisionIds[0]!}},this.enginePorts());
      this.state=outcome.nextState;
      settleExpressionBinding(this.requireState(),this.enginePorts(),outcome.record,outcome.alignment,outcome.bindingCandidate,{operationId:request.operationId,...outcome.bindingInput},null);
      outcome.record.alignmentEvents.push({contractVersion:'sensa-personal-semantic-world-v3',personalMeaningAlignmentEventId:this.id(),personalMeaningAlignmentId:alignment.personalMeaningAlignmentId,ordinal:Math.max(...record.alignmentEvents.filter(row=>row.personalMeaningAlignmentId===alignment.personalMeaningAlignmentId).map(row=>row.ordinal))+1,eventType:'withdrawn',operationId:request.operationId,reason:correctionReason,occurredAt:outcome.alignment.createdAt});
      const revision=outcome.record.personalMeaningRevisions.at(-1)!;
      const result={personalMeaningId:request.personalMeaningId,personalMeaningRevisionId:revision.personalMeaningRevisionId,revision:revision.revision,replacedAlignmentId:alignment.personalMeaningAlignmentId,personalMeaningAlignmentId:outcome.alignment.personalMeaningAlignmentId};
      this.recordReceipt(request.operationId,'CorrectPersonalMeaning',result,digestOf(request));await this.persist();return {...result,replayed:false};
    });
  }

  private async writeClarification(input:ConfirmClarificationInput,options:{persist?:boolean;receipt?:boolean}={}):Promise<ConfirmClarificationResult>{
    const {persist=true,receipt=true}=options;
    if(receipt){
      const replay=await this.replay<ConfirmClarificationResult>(input.operationId,'ConfirmClarification',digestOf(input));
      if(replay)return replay;
      await this.requireClarificationSource(input.source,'personal_meaning',input.personalMeaningId);
    }
    const state=this.requireState(),record=this.requireRecord(input.personalMeaningId);
    const lookup=input.sense.reuseSense?this.confirmedMeaningLookup():null;
    const reused=lookup?.resolve(input.sense.reuseSense!)??null;
    const result=applyClarificationFacts(state,record,input,this.enginePorts(),reused);
    if(reused)this.transaction!.preconditions.push(...lookup!.confirmationConditions(input.sense.reuseSense!));
    if(receipt)this.recordReceipt(input.operationId,'ConfirmClarification',result,digestOf(input));
    if(persist)await this.persist();
    return {...result,replayed:false};
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
        && isAlignmentActive(record,candidate),
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
    const result = settleExpressionBinding(this.requireState(),this.enginePorts(),
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
        installPublishedLearningFacts(this.requireState(),input);

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
          isAlignmentActive(record,candidate)
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
        const nextRevision = learningSceneAnchorRevision(this.enginePorts(),
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
          materializeContextMedia:false,
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
      const anchorRevision = learningSceneAnchorRevision(this.enginePorts(),
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
          sourceReferenceIds: [anchor.personalSemanticAnchorId, input.scene.revisionId, input.source.contentReleaseId],
          createdByOperationId: input.operationId,
        },
      };
      settleExpressionBinding(this.requireState(),this.enginePorts(),
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
    const parsed=sensaIntakePayloadSchema.parse(payload);
    if(!this.loadStarted&&this.deps.repository.withIntakeCommand&&evaluateIntakeRoute(parsed).route==='fast_track'){
      return this.isolatedCommand(parsed.operationId,'Ingest',digestOf(parsed),()=>
        this.deps.repository.withIntakeCommand!(parsed,this.deps.ids,(repository,ids)=>new JourneyGatewayImpl({...this.deps,repository,ids}).submit(parsed)));
    }
    if(!this.loadStarted&&this.deps.repository.withDraftCreation&&evaluateIntakeRoute(parsed).route==='inbox'){
      return this.isolatedCommand(parsed.operationId,'Ingest',digestOf(parsed),()=>
        this.deps.repository.withDraftCreation!({operationId:parsed.operationId,reservedIds:parsed.context?.mediaReferenceIds??[]},this.deps.ids,
          (repository,ids)=>new JourneyGatewayImpl({...this.deps,repository,ids}).submit(parsed)));
    }
    return this.exclusive(() => this.runIngest(parsed.operationId, parsed));
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
    settleExpressionBinding(this.requireState(),this.enginePorts(),
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
    if(!this.loadStarted&&this.deps.repository.withInboxCommand)return this.isolatedCommand(command.operationId,'ResolveInboxItem',digestOf(command),()=>
      this.deps.repository.withInboxCommand!(command,this.deps.ids,(repository,ids)=>new JourneyGatewayImpl({...this.deps,repository,ids}).resolve(command)));
    return this.exclusive(() => this.runInboxResolution(command));
  }

  private async runInboxResolution(command:ResolveSemanticIntakeCommand): Promise<SemanticIntakeResult> {
    const {operationId,intakeId,sense:resolution}=command;
    const requestDigest=digestOf(command);
    const replay = await this.replay<SemanticIntakeResult>(operationId, 'ResolveInboxItem',requestDigest);
    if (replay) return replay;
    this.requireReviewedInboxItem(command);
    const state = this.requireState();
    // Boundary validation for the learner-confirmed sense before any write.
    const sense = sensaIntakeSenseSchema.parse(resolution);
    const authority = this.deps.semanticAcceptanceAuthority.verify({
      mode: 'learner_direct',
    });
    const outcome = resolveInboxItemWithSense(
      state,
      {...command,sense,authority},
      this.enginePorts(),
    );
    this.state = outcome.nextState;
    this.requireState().clarificationDrafts = this.requireState().clarificationDrafts.filter(
      (candidate) => candidate.intakeId !== intakeId,
    );
    settleExpressionBinding(this.requireState(),this.enginePorts(),
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
    if(!this.loadStarted&&this.deps.repository.withInboxCommand){await this.isolatedCommand(command.operationId,'DismissInboxItem',digestOf(command),()=>
      this.deps.repository.withInboxCommand!(command,this.deps.ids,(repository,ids)=>new JourneyGatewayImpl({...this.deps,repository,ids}).dismiss(command)));return;}
    return this.exclusive(() => this.writeInboxDismissal(command));
  }

  private requireReviewedInboxItem(command:DismissSemanticIntakeCommand):void{
    const state=this.requireState(),item=state.inboxItems.find(item=>item.intakeId===command.intakeId);
    if(!item||digestOf(item)!==command.expectedItemDigest)throw new ClarificationSourceChangedError();
    this.transaction!.preconditions.push({table:'semanticInbox',key:command.intakeId,expected:item},{table:'semanticDrafts',key:command.intakeId,expected:state.clarificationDrafts.find(item=>item.intakeId===command.intakeId)});
  }
  private async writeInboxDismissal(command:DismissSemanticIntakeCommand): Promise<void> {
    const {operationId,intakeId}=command,requestDigest=digestOf(command);
    const found = await this.receipt(operationId, 'DismissInboxItem',requestDigest);
    if (found) return;
    this.requireReviewedInboxItem(command);
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
