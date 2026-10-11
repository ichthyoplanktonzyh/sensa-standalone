import {storeMeaningContexts,hydrateMeaningContexts,collectMeaningContexts,meaningContextKeys,contextKey,contextRecordId,contextMediaReferences,assertContextLifecycleReceipt,readMeaningContexts,readMeaningContextRecords,type ContextRecord,type StoredMeaningRecord} from './contextRecords';
import {canonicalConsumerJson,type SensaIntakePayload} from '@sensa/contracts/sensa';
import {digestOf} from './digest';
import {learningScenePersonalMeaningId,learningSceneContextId} from '../../data/library/personalSceneIdentity';
import type {ResolveSemanticIntakeCommand,DismissSemanticIntakeCommand} from '../intake/semanticIntakeModule';
import {resolvedIntakePayload} from '../intake/resolvedIntake';
import {
  assertCurrentLibrary,
  readLibrary,
  observeLibrary,
  restoreLibraryTransaction,
  type Table,
  type LibraryTransaction,
} from '../../data/library/store';
import {parseStoredMedia,type StoredMedia} from '../../data/library/media';
import {assertPersonalSemanticWorldState,assertPersonalSemanticWorldStateCooperatively,assertPersonalSemanticWorldTransition,semanticWorldRecordTables} from './authority';
import {assertMeaningLifecycleReceipts,assertMeaningLifecycleOperationReceipt} from './meaningLifecycle';
import {assertMeaningCorrectionReceipts} from './meaningCorrection';
import {assertCurrentMeaningReceipt,meaningHistoryRecords} from './meaningHistoryRead';
import {StorageUnavailableError} from './ports';
import type {MeaningLookupResult} from './meaningLookup';
import {sourceWitnessFromState,type ClarificationSourceKind,type ClarificationSourceWitness} from './clarificationSource';
import {worldReadRepository,readWorldFrame,readMeaningRegistry,readRegistryRecords} from './worldRepository';
import type {CompleteClarificationDraftInput,CorrectPersonalMeaningInput,PublishedLearningSceneAcceptanceInput,ContextReference,ConfirmMeaningDraftInput} from './types';
import type {RegistrySelectionQuery,RegistrySelection} from '../../data/library/semanticRegistrySelection';
import {isUuid,type RandomIdPort} from './ids';
import {
  emptyJourneyState,
  JOURNEY_STORE_VERSION,
  parseJourneyState,
  StoreCorruptedError,
  type CommandReceipt,
  type JourneyState,
  type MeaningJourneyRecord,
  type SenseRegistryState,
} from './store';

export const semanticJourneyTables=semanticWorldRecordTables satisfies readonly Table[];
type SemanticTable=(typeof semanticJourneyTables)[number];
type Records=Record<SemanticTable,Map<string,unknown>>;
type SemanticRecordChange={
  table:Exclude<SemanticTable,'semanticState'>;
  key:string;
  before:unknown;
  after:unknown;
};

const emptyRecords=():Records=>Object.fromEntries(semanticJourneyTables.map(table=>[table,new Map()])) as Records;
const clone=<T,>(value:T):T=>structuredClone(value);
function assertSceneReceiptWitness(receipt:CommandReceipt,meaning:MeaningJourneyRecord|undefined){
  if(receipt.command!=='AcceptPublishedLearningScene')return;
  const result=receipt.result;
  if(!meaning||meaning.personalMeaning.personalMeaningId!==result.personalMeaningId||!meaning.personalSemanticAnchorRevisions.some(revision=>revision.personalSemanticAnchorId===result.personalSemanticAnchorId&&revision.personalSemanticAnchorRevisionId===result.personalSemanticAnchorRevisionId&&revision.provenance.createdByOperationId===(result.acceptedByOperationId??receipt.operationId)))throw new JourneyConflictError();
}

type RegistryKind=keyof SenseRegistryState;
const registryIds:{[K in RegistryKind]:(value:SenseRegistryState[K][number])=>string}={
  senses:value=>value.senseId,
  senseVersions:value=>value.senseVersionId,
  expressions:value=>value.expressionId,
  expressionVersions:value=>value.expressionVersionId,
  bindings:value=>value.senseExpressionBindingId,
  bindingVersions:value=>value.bindingVersionId,
};
type RegistryRow={kind:RegistryKind;ordinal:number;value:SenseRegistryState[RegistryKind][number]};

type IndexedValue={value:unknown;identity:unknown};
type IndexedRecords=Record<Exclude<SemanticTable,'semanticState'>,Map<string,IndexedValue>>;

/**
 * Build only a lightweight identity index. Commands preserve object identity for
 * untouched rows, so finding the records to commit never serializes the world.
 */
const storedMeaningCache=new WeakMap<MeaningJourneyRecord,StoredMeaningRecord>();
const storedMeaning=(record:MeaningJourneyRecord)=>{let stored=storedMeaningCache.get(record);if(!stored){stored=storeMeaningContexts(record);storedMeaningCache.set(record,stored);}return stored;};
const indexState=(state:JourneyState):IndexedRecords=>{
  const records={
    semanticMeanings:new Map<string,IndexedValue>(),
    semanticContexts:new Map<string,IndexedValue>(),
    semanticRegistry:new Map<string,IndexedValue>(),
    semanticInbox:new Map<string,IndexedValue>(),
    semanticDrafts:new Map<string,IndexedValue>(),
    semanticReceipts:new Map<string,IndexedValue>(),
  };
  for(const meaning of state.meanings)records.semanticMeanings.set(
    meaning.personalMeaning.personalMeaningId,
    {value:storedMeaning(meaning),identity:meaning},
  );
  for(const kind of ['anchors','anchorRevisions'] as const)for(const value of state.contexts[kind]){
    const row={kind,value,...(kind==='anchorRevisions'?{parentRevisionId:state.contexts.anchorRevisionParents[(value as JourneyState['contexts']['anchorRevisions'][number]).personalSemanticAnchorRevisionId]}:{})} as ContextRecord;records.semanticContexts.set(contextKey(kind,contextRecordId(row)),{value:row,identity:value});
  }
  for(const kind of Object.keys(registryIds) as RegistryKind[]){
    state.registry[kind].forEach((value,ordinal)=>{
      const id=(registryIds[kind] as (item:any)=>string)(value);
      records.semanticRegistry.set(`${kind}:${id}`,{
        value:{kind,ordinal,value} satisfies RegistryRow,
        identity:value,
      });
    });
  }
  for(const item of state.inboxItems)records.semanticInbox.set(
    item.intakeId,
    {value:item,identity:item},
  );
  for(const draft of state.clarificationDrafts)records.semanticDrafts.set(
    draft.intakeId,
    {value:draft,identity:draft},
  );
  for(const receipt of state.commandReceipts)records.semanticReceipts.set(
    receipt.operationId,
    {value:receipt,identity:receipt},
  );
  return records;
};

const recordChanges=(before:JourneyState,after:JourneyState):SemanticRecordChange[]=>{
  collectMeaningContexts(after,before);
  assertPersonalSemanticWorldTransition(before,after);
  const previous=indexState(before),next=indexState(after),changes:SemanticRecordChange[]=[];
  for(const table of Object.keys(previous) as Array<keyof IndexedRecords>){
    const keys=new Set([...previous[table].keys(),...next[table].keys()]);
    for(const key of keys){
      const old=previous[table].get(key),current=next[table].get(key);
      const unchanged=old&&current&&old.identity===current.identity
        && (table!=='semanticRegistry'
          || (old.value as RegistryRow).ordinal===(current.value as RegistryRow).ordinal);
      if(!unchanged)changes.push({table,key,before:old?.value,after:current?.value});
    }
  }
  return changes;
};

const referencedMediaIds=(changes:readonly SemanticRecordChange[]):string[]=>{
  const ids=new Set<string>();
  for(const change of changes){
    const before=new Set<string>();
    if(change.table==='semanticContexts'&&change.after)for(const id of contextMediaReferences(change.after))if(!contextMediaReferences(change.before).includes(id))ids.add(id);
    if(change.table==='semanticInbox'&&change.after){
      const item=change.after as JourneyState['inboxItems'][number];
      const previous=change.before as JourneyState['inboxItems'][number]|undefined;
      for(const id of previous?.payload.context?.mediaReferenceIds??[])before.add(id);
      for(const id of item.payload.context?.mediaReferenceIds??[])if(!before.has(id))ids.add(id);
    }
  }
  return [...ids];
};

const stateFromRecords=(records:Records,validate=true):JourneyState=>{
  const root=records.semanticState.get('root');
  const hasRows=semanticJourneyTables.some(table=>records[table].size>0);
  if(!root){
    if(hasRows)throw new StoreCorruptedError('本机的个人意义数据缺少版本记录。');
    return emptyJourneyState();
  }
  if(!root||typeof root!=='object'||(root as {version?:unknown}).version!==JOURNEY_STORE_VERSION){
    throw new StoreCorruptedError('本机的个人意义数据版本不匹配。');
  }
  const registry=Object.fromEntries((Object.keys(registryIds) as RegistryKind[]).map(kind=>[kind,[]])) as unknown as SenseRegistryState;
  const registryRows=[...records.semanticRegistry.values()] as RegistryRow[];
  for(const kind of Object.keys(registryIds) as RegistryKind[]){
    (registry[kind] as unknown[]).push(...registryRows.filter(row=>row.kind===kind).sort((a,b)=>a.ordinal-b.ordinal).map(row=>row.value));
  }
  const state=parseJourneyState({
    version:JOURNEY_STORE_VERSION,
    meanings:[...records.semanticMeanings.values()].map(value=>hydrateMeaningContexts(value,key=>records.semanticContexts.get(key))),
    contexts:{anchors:[...records.semanticContexts.values()].filter((row:any)=>row.kind==='anchors').map((row:any)=>row.value),anchorRevisions:[...records.semanticContexts.values()].filter((row:any)=>row.kind==='anchorRevisions').map((row:any)=>row.value),anchorRevisionParents:Object.fromEntries([...records.semanticContexts.values()].filter((row:any)=>row.kind==='anchorRevisions').map((row:any)=>[row.value.personalSemanticAnchorRevisionId,row.parentRevisionId]))},
    registry,
    inboxItems:[...records.semanticInbox.values()],
    clarificationDrafts:[...records.semanticDrafts.values()],
    commandReceipts:[...records.semanticReceipts.values()] as CommandReceipt[],
  });
  for(const [key,value] of records.semanticReceipts)if((value as CommandReceipt).operationId!==key)throw new StoreCorruptedError('操作凭据身份与存储记录不一致。');
  try{if(validate){assertPersonalSemanticWorldState(state);assertMeaningLifecycleReceipts(state.meanings,state.commandReceipts);}}catch(cause){
    throw new StoreCorruptedError('本机的个人意义数据违反领域不变量。',cause);
  }
  return state;
};

export interface JourneyCommit{
  /** Previous and next snapshots must share references for untouched records. */
  before:JourneyState;
  after:JourneyState;
  /** Prepared bytes are admitted only when a changed semantic row references them. */
  preparedMedia?:readonly StoredMedia[];
  /** Reused source facts must still match inside the same atomic write transaction. */
  preconditions?:readonly JourneyReadCondition[];
}

export interface JourneyReadCondition{
  table:'semanticMeanings'|'semanticContexts'|'semanticRegistry'|'semanticInbox'|'semanticDrafts';
  key:string;
  expected:unknown;
}

export interface JourneyCommitResult{committedMediaIds:string[];state?:JourneyState}

type JourneyCommandScope={operationId:string;allocatedIds:Set<string>}&(
  {kind:'meaning';personalMeaningId:string}|{kind:'published_scene';input:PublishedLearningSceneAcceptanceInput;matchedMeaningId:string|null}|{kind:'correction';input:CorrectPersonalMeaningInput}|{kind:'context_creation';contextReferences:ContextReference[]}|{kind:'meaning_confirmation';input:ConfirmMeaningDraftInput}|{kind:'draft_creation'}|{kind:'clarification';input:CompleteClarificationDraftInput}|{kind:'intake';input:SensaIntakePayload}|{kind:'inbox';input:ResolveSemanticIntakeCommand|DismissSemanticIntakeCommand}
);
type ScopedCommandExecutor<T>=(repository:JourneyRepository,ids:RandomIdPort)=>Promise<T>;
type RegistrySelectionCondition={query:RegistrySelectionQuery;expected:RegistrySelection};
type LibrarySnapshotStamp={revision:number;frameRevision:number;incarnation:string;dependencies?:JourneyReadCondition[];selections?:RegistrySelectionCondition[];sceneOwner?:{sceneId:string;meaningId:string|null}};

export interface JourneyRepository{
  load():Promise<JourneyState>;
  /** Check only semantic changes; unrelated Inbox/receipt writes retain the snapshot. */
  refresh?(state:JourneyState,scope?:'semantic'|'frame'):Promise<JourneyState>;
  /** Committed-frame invalidation hints, not data. Subscription lifetime belongs to the caller. */
  subscribe?(listener:()=>void):()=>void;
  /** Read committed bounded candidates without hydrating the UI's full snapshot. */
  lookupMeanings?(query:string):Promise<MeaningLookupResult>;
  readReceipt?(operationId:string):Promise<CommandReceipt|null>;
  captureSource?(kind:ClarificationSourceKind,id:string):Promise<ClarificationSourceWitness>;
  /** Isolated single-Meaning command frame. It cannot become a full World
   * snapshot or mutate registry facts, Inbox or other operation receipts. */
  withMeaningCommand?<T>(input:{personalMeaningId:string;operationId:string;identityCount:number;reservedIds?:readonly string[]},ids:RandomIdPort,execute:(repository:JourneyRepository,ids:RandomIdPort)=>Promise<T>):Promise<T>;
  /** One scene owner and its exact published registry closure, with the owner
   * lookup rechecked in the writer transaction even when its marker is absent. */
  withPublishedSceneCommand?<T>(input:PublishedLearningSceneAcceptanceInput,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>;
  /** Append only one new Inbox item, its draft hint and this operation's
   * receipt. It cannot read or mutate existing Meaning/registry facts. */
  withDraftCreation?<T>(input:{operationId:string;reservedIds?:readonly string[]},ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>;
  withContextCreation?<T>(input:{operationId:string;contextReferences:ContextReference[];reservedIds?:readonly string[]},ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>;
  withMeaningConfirmation?<T>(input:ConfirmMeaningDraftInput,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>;
  /** Confirm one witnessed Inbox tuple using exact registry selections and
   * pinned dependencies, without loading the learner's existing Meanings. */
  withClarificationCommand?<T>(input:CompleteClarificationDraftInput,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>;
  /** A complete accepted tuple reads only its natural-key registry dependencies. */
  withIntakeCommand?<T>(input:SensaIntakePayload,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>;
  withCorrectionCommand?<T>(input:CorrectPersonalMeaningInput,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>;
  withInboxCommand?<T>(input:ResolveSemanticIntakeCommand|DismissSemanticIntakeCommand,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>;
  commit(change:JourneyCommit):Promise<JourneyCommitResult>;
}

/** Test adapter for the same normalized repository seam used by production. */
export class MemoryJourneyRepository implements JourneyRepository{
  private incarnation=crypto.randomUUID();
  private records=emptyRecords();
  private semanticGeneration=0;
  private generation=0;
  private snapshots=new WeakMap<JourneyState,{semantic:number;frame:number}>();
  private listeners=new Set<()=>void>();
  writes=0;
  reads=0;
  async load():Promise<JourneyState>{const state=clone(stateFromRecords(this.records));this.snapshots.set(state,{semantic:this.semanticGeneration,frame:this.generation});return state;}
  async refresh(state:JourneyState,scope:'semantic'|'frame'='semantic'):Promise<JourneyState>{const prior=this.snapshots.get(state);return prior&&(scope==='frame'?prior.frame===this.generation:prior.semantic===this.semanticGeneration)?state:this.load();}
  subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  async readReceipt(operationId:string):Promise<CommandReceipt|null>{
    const receipt=clone(this.records.semanticReceipts.get(operationId) as CommandReceipt|undefined);
    if(receipt){const raw=this.records.semanticMeanings.get(String(receipt.result.personalMeaningId));const meaning=raw?hydrateMeaningContexts(raw,key=>this.records.semanticContexts.get(key)):undefined;assertSceneReceiptWitness(receipt,meaning);assertCurrentMeaningReceipt(meaning,receipt);}
    return receipt??null;
  }
  async captureSource(kind:ClarificationSourceKind,id:string):Promise<ClarificationSourceWitness>{return sourceWitnessFromState(await this.load(),this.incarnation,kind,id);}
  async commit(input:JourneyCommit):Promise<JourneyCommitResult>{
    const changes=recordChanges(input.before,input.after);
    const foreignChanges=this.snapshots.get(input.before)?.frame!==this.generation;
    this.writes=0;this.reads=1+changes.length;
    const root=this.records.semanticState.get('root');
    if(root&&(root as {version?:unknown}).version!==JOURNEY_STORE_VERSION){
      throw new StoreCorruptedError('本机的个人意义数据版本不匹配。');
    }
    for(const condition of input.preconditions??[])if(!matchesCondition(this.records[condition.table].get(condition.key),condition))throw new JourneyConflictError();
    for(const change of changes)if(!same(this.records[change.table].get(change.key),change.before))throw new JourneyConflictError();
    // Validate the complete merged frame before replacing anything. A foreign
    // writer can introduce a conflicting semantic key without touching our IDs.
    const next=Object.fromEntries(semanticJourneyTables.map(table=>[table,new Map(this.records[table])])) as Records;
    if(!root){next.semanticState.set('root',{version:JOURNEY_STORE_VERSION});this.writes++;}
    for(const change of changes){
      if(change.after===undefined)next[change.table].delete(change.key);
      else next[change.table].set(change.key,clone(change.after));
      this.writes++;
    }
    const mergedState=foreignChanges?clone(stateFromRecords(next)):undefined;
    this.records=next;
    if(changes.some(row=>row.table==='semanticMeanings'||row.table==='semanticContexts'||row.table==='semanticRegistry'))this.semanticGeneration++;
    this.generation++;
    if(!foreignChanges)this.snapshots.set(input.after,{semantic:this.semanticGeneration,frame:this.generation});
    else this.snapshots.delete(input.after);
    if(mergedState)this.snapshots.set(mergedState,{semantic:this.semanticGeneration,frame:this.generation});
    const prepared=new Set((input.preparedMedia??[]).map(item=>item.mediaId));
    if(changes.length)for(const listener of this.listeners){try{listener();}catch{/* A notification hint cannot undo a durable commit. */}}
    return {committedMediaIds:referencedMediaIds(changes).filter(id=>prepared.has(id)),...(mergedState?{state:mergedState}: {})};
  }
}

const translate=(cause:unknown,action:string):never=>{
  if(cause instanceof StoreCorruptedError||cause instanceof StorageUnavailableError||cause instanceof JourneyConflictError)throw cause;
  const detail=cause instanceof Error?cause.message:String(cause);
  throw new StorageUnavailableError(`${action}（${detail}）`);
};

const same=(left:unknown,right:unknown):boolean=>left===undefined||right===undefined
  ? left===right
  : canonicalConsumerJson(left)===canonicalConsumerJson(right);

const matchesCondition=(current:unknown,condition:JourneyReadCondition):boolean=>{
  if(condition.table!=='semanticRegistry')return same(current,condition.expected);
  if(condition.expected===undefined)return current===undefined;
  const actual=current as RegistryRow|undefined,expected=condition.expected as RegistryRow;
  // Row ordering is an adapter detail, not part of the fixed semantic contract.
  return actual?.kind===expected.kind&&same(actual.value,expected.value);
};

export class JourneyConflictError extends Error{
  constructor(){super('localFlow.meaningChanged');this.name='JourneyConflictError';}
}

/** SQLite adapter. A command reads and writes only its changed logical rows. */
export class LibraryJourneyRepository implements JourneyRepository{
  constructor(private commandScope:JourneyCommandScope|null=null){}
  captureSource(kind:ClarificationSourceKind,id:string):Promise<ClarificationSourceWitness>{return worldReadRepository.captureSource(kind,id);}
  private snapshots=new WeakMap<JourneyState,LibrarySnapshotStamp>();
  async withMeaningCommand<T>(input:{personalMeaningId:string;operationId:string;identityCount:number;reservedIds?:readonly string[]},ids:RandomIdPort,execute:(repository:JourneyRepository,ids:RandomIdPort)=>Promise<T>):Promise<T>{
    if(!isUuid(input.personalMeaningId))throw new Error('journey_command_scope_invalid');
    return this.withCommand({kind:'meaning',personalMeaningId:input.personalMeaningId,operationId:input.operationId,allocatedIds:new Set()},input.identityCount,[input.personalMeaningId,...(input.reservedIds??[])],ids,execute);
  }
  async withPublishedSceneCommand<T>(input:PublishedLearningSceneAcceptanceInput,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>{
    const reserved=[learningScenePersonalMeaningId(input.scene.sceneId),input.scene.sceneId,input.scene.revisionId,input.target.senseId,input.target.senseVersionId,input.semantic.expressionId,input.semantic.expressionVersionId,input.target.bindingId,input.target.bindingVersionId];
    return this.withCommand({kind:'published_scene',operationId:input.operationId,allocatedIds:new Set(),input,matchedMeaningId:null},64,reserved,ids,execute);
  }
  async withDraftCreation<T>(input:{operationId:string;reservedIds?:readonly string[]},ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>{
    return this.withCommand({kind:'draft_creation',operationId:input.operationId,allocatedIds:new Set()},1,input.reservedIds??[],ids,execute);
  }
  async withContextCreation<T>(input:{operationId:string;contextReferences:ContextReference[];reservedIds?:readonly string[]},ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>{
    if(input.contextReferences.some(ref=>!isUuid(ref.contextId)||!isUuid(ref.revisionId)))throw Error('journey_command_scope_invalid');
    return this.withCommand({kind:'context_creation',operationId:input.operationId,allocatedIds:new Set(),contextReferences:input.contextReferences},64,[...input.contextReferences.flatMap(ref=>[ref.contextId,ref.revisionId]),...(input.reservedIds??[])],ids,execute);
  }
  async withMeaningConfirmation<T>(input:ConfirmMeaningDraftInput,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>{
    if(!isUuid(input.personalMeaningId))throw Error('journey_command_scope_invalid');
    return this.withCommand({kind:'meaning_confirmation',operationId:input.operationId,allocatedIds:new Set(),input},64,[input.personalMeaningId],ids,execute);
  }
  async withClarificationCommand<T>(input:CompleteClarificationDraftInput,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>{
    if(!isUuid(input.intakeId))throw new Error('journey_command_scope_invalid');
    const mediaIds=input.context?.mediaReferenceIds??[],count=64+input.transcript.length+(input.expressionCandidates?.length??1)+2*(mediaIds.length+1);
    return this.withCommand({kind:'clarification',operationId:input.operationId,allocatedIds:new Set(),input},count,[input.intakeId,...mediaIds],ids,execute);
  }
  async withIntakeCommand<T>(input:SensaIntakePayload,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>{
    if(!input.context||!input.expression?.languageTag||!input.expression.occurrence||!input.sense||!input.acceptance)throw new Error('journey_command_scope_invalid');
    return this.withCommand({kind:'intake',operationId:input.operationId,allocatedIds:new Set(),input},64,input.context.mediaReferenceIds,ids,execute);
  }
  async withCorrectionCommand<T>(input:CorrectPersonalMeaningInput,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>{
    if(!isUuid(input.personalMeaningId)||!isUuid(input.personalMeaningAlignmentId))throw Error('journey_command_scope_invalid');
    return this.withCommand({kind:'correction',input,operationId:input.operationId,allocatedIds:new Set()},68,[input.personalMeaningId],ids,execute);
  }
  async withInboxCommand<T>(input:ResolveSemanticIntakeCommand|DismissSemanticIntakeCommand,ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>{
    if(!isUuid(input.intakeId)||!/^[a-f0-9]{64}$/u.test(input.expectedItemDigest))throw new Error('journey_command_scope_invalid');
    return this.withCommand({kind:'inbox',operationId:input.operationId,allocatedIds:new Set(),input},'sense'in input?64:1,[input.intakeId],ids,execute);
  }
  private async inboxRecords(tx:LibraryTransaction,input:ResolveSemanticIntakeCommand|DismissSemanticIntakeCommand,records:Records):Promise<{dependencies:JourneyReadCondition[];selections:RegistrySelectionCondition[]}>{
    const item=await tx.get<JourneyState['inboxItems'][number]>('semanticInbox',input.intakeId),metadata=await tx.get('semanticDrafts',input.intakeId);
    if(item)records.semanticInbox.set(input.intakeId,item);if(metadata)records.semanticDrafts.set(input.intakeId,metadata);
    const payload=item&&'sense'in input?resolvedIntakePayload(item,input):null;
    const registry=payload?.context&&payload.expression?.occurrence&&payload.expression.languageTag?await this.intakeRecords(tx,payload,records,'sense'in input?input.reuseSense:undefined):{dependencies:[],selections:[]};
    return {dependencies:[...registry.dependencies,{table:'semanticInbox',key:input.intakeId,expected:item},{table:'semanticDrafts',key:input.intakeId,expected:metadata}],selections:registry.selections};
  }
  private async intakeRecords(tx:LibraryTransaction,input:SensaIntakePayload,records:Records,pinnedSense?:{senseId:string;senseVersionId:string}):Promise<{dependencies:JourneyReadCondition[];selections:RegistrySelectionCondition[]}>{
    const selections:RegistrySelectionCondition[]=[],keys=new Set<string>();
    const select=async(query:RegistrySelectionQuery)=>{const expected=await tx.registrySelection(query);selections.push({query,expected});for(const key of expected.keys)keys.add(key);return expected.keys;};
    const sense=input.sense!,expression=input.expression!;
    pinnedSense ??= sense.reuseSense;
    const senseKeys=pinnedSense?[`senses:${pinnedSense.senseId}`]:await select({kind:'senseKey',senseKey:`personal-${input.operationId}`});
    if(pinnedSense){if(!isUuid(pinnedSense.senseId)||!isUuid(pinnedSense.senseVersionId))throw new Error('journey_command_scope_invalid');keys.add(`senses:${pinnedSense.senseId}`);keys.add(`senseVersions:${pinnedSense.senseVersionId}`);}
    const expressionKeys=expression?await select({kind:'expression',normalizedForm:expression.surfaceForm.trim().toLocaleLowerCase(expression.languageTag!),languageTag:expression.languageTag!,expressionType:expression.expressionTypeHint??'word'}):[];
    if(senseKeys.length&&expressionKeys.length){
      const senseId=pinnedSense?.senseId??senseKeys[0]!.slice('senses:'.length),expressionId=expressionKeys[0]!.slice('expressions:'.length);
      const selectedSense=await tx.get<RegistryRow>('semanticRegistry',senseKeys[0]!);
      if(!selectedSense||selectedSense.kind!=='senses')throw new StoreCorruptedError('语义索引与源事实不一致。');
      const senseVersionId=pinnedSense?.senseVersionId??(selectedSense.value as SenseRegistryState['senses'][number]).currentSenseVersionId;
      const bindings=await select({kind:'binding',senseId,expressionId,relation:null});
      if(bindings.length)await select({kind:'bindingVersion',bindingId:bindings[0]!.slice('bindings:'.length),senseVersionId,expressionVersionId:expressionKeys[1]!.slice('expressionVersions:'.length),coverage:null});
    }
    const closure=await readRegistryRecords(tx,[...keys]);
    const dependencies:JourneyReadCondition[]=[];
    for(const [key,value] of closure.records){records.semanticRegistry.set(key,value);dependencies.push({table:'semanticRegistry',key,expected:value});}
    return {dependencies,selections};
  }
  private async clarificationRecords(tx:LibraryTransaction,input:CompleteClarificationDraftInput,records:Records):Promise<{dependencies:JourneyReadCondition[];selections:RegistrySelectionCondition[]}>{
    const item=await tx.get('semanticInbox',input.intakeId),metadata=await tx.get('semanticDrafts',input.intakeId);
    if(item)records.semanticInbox.set(input.intakeId,item);if(metadata)records.semanticDrafts.set(input.intakeId,metadata);
    const selections:RegistrySelectionCondition[]=[],keys=new Set<string>();
    const select=async(query:RegistrySelectionQuery)=>{const expected=await tx.registrySelection(query);selections.push({query,expected});for(const key of expected.keys)keys.add(key);return expected.keys;};
    const senseKey=input.sense.proposedSenseKey.trim();if(senseKey)await select({kind:'senseKey',senseKey});
    const reuse=input.sense.reuseSense;
    if(reuse){keys.add(`senses:${reuse.senseId}`);keys.add(`senseVersions:${reuse.senseVersionId}`);}
    if(input.expression?.surfaceForm.trim()&&input.expression.languageTag.trim()){
      const expression=input.expression,form=expression.surfaceForm.trim().toLocaleLowerCase(expression.languageTag.trim());
      const selected=await select({kind:'expression',normalizedForm:form,languageTag:expression.languageTag.trim(),expressionType:expression.expressionType});
      if(reuse&&selected.length){
        const expressionId=selected[0]!.slice('expressions:'.length),expressionVersionId=selected[1]!.slice('expressionVersions:'.length);
        const bindings=await select({kind:'binding',senseId:reuse.senseId,expressionId,relation:expression.relation});
        if(bindings.length)await select({kind:'bindingVersion',bindingId:bindings[0]!.slice('bindings:'.length),senseVersionId:reuse.senseVersionId,expressionVersionId,coverage:expression.semanticCoverage});
      }
    }
    const closure=await readRegistryRecords(tx,[...keys]);
    for(const [key,value] of closure.records)records.semanticRegistry.set(key,value);
    const dependencies:JourneyReadCondition[]=[{table:'semanticInbox',key:input.intakeId,expected:item},{table:'semanticDrafts',key:input.intakeId,expected:metadata}];
    for(const [key,value] of closure.records)dependencies.push({table:'semanticRegistry',key,expected:value});
    return {dependencies,selections};
  }
  private async withCommand<T>(scope:JourneyCommandScope,identityCount:number,reservedIds:readonly string[],ids:RandomIdPort,execute:ScopedCommandExecutor<T>):Promise<T>{
    const allocationStarted=performance.now();
    if(!isUuid(scope.operationId)||!Number.isSafeInteger(identityCount)||identityCount<1)throw new Error('journey_command_scope_invalid');
    const scoped=new LibraryJourneyRepository(scope),available:string[]=[],proposed=new Set<string>(),reserved=new Set([scope.operationId,...reservedIds]);
    while(available.length<identityCount){
      const candidates:string[]=[];
      for(let index=0;index<Math.min(256,identityCount-available.length);index++){
        const id=ids.next();if(!isUuid(id))throw new Error('本机 ID 生成器返回了无效 UUID。');
        if(proposed.has(id))throw new Error('本机 ID 生成器重复返回相同 UUID。');
        proposed.add(id);if(!reserved.has(id))candidates.push(id);
      }
      const occupied=await readLibrary(async tx=>{await assertCurrentLibrary(tx);return tx.existingJourneyIdentities(candidates);});
      available.push(...candidates.filter(id=>!occupied.has(id)));
    }
    let cursor=0;
    if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.journey.scoped-allocation',{start:allocationStarted,end:performance.now()});
    // No subscription: this frame lives only for one command. Creating a
    // permanent observer per saved Meaning would leak both caches and listeners.
    const repository:JourneyRepository={load:()=>scoped.load(),refresh:(state,scope)=>scoped.refresh(state,scope),commit:change=>scoped.commit(change),readReceipt:id=>scoped.readReceipt(id),captureSource:(kind,id)=>scoped.captureSource(kind,id)};
    return execute(repository,{next:()=>{const id=available[cursor++];if(!id)throw new Error('journey_command_identity_budget_exceeded');scoped.commandScope!.allocatedIds.add(id);return id;}});
  }
  private async snapshot(previous?:JourneyState,scope:'semantic'|'frame'='semantic'):Promise<JourneyState>{
    return readLibrary(async tx=>{
      const {incarnation,revision}=await readWorldFrame(tx);
      const prior=previous&&this.snapshots.get(previous);
      const capturedRevision=scope==='frame'?prior?.frameRevision:prior?.revision;
      if(prior&&prior.incarnation===incarnation&&(capturedRevision===revision||!(await tx.hasChangesSince(capturedRevision!,scope==='frame'?semanticJourneyTables:['semanticState','semanticMeanings','semanticContexts','semanticRegistry'])))){
        // A semantic-only refresh may ignore an Inbox write. It cannot stamp
        // the entire frame current and hide that write from a later full read.
        this.snapshots.set(previous!,{...prior,revision,...(scope==='frame'?{frameRevision:revision}:{})});return previous!;
      }
      const recordsStarted=performance.now();
      const records=emptyRecords();
      let dependencies:JourneyReadCondition[]|undefined;
      let selections:RegistrySelectionCondition[]|undefined;
      let sceneOwner:LibrarySnapshotStamp['sceneOwner'];
      if(this.commandScope){
        const {operationId}=this.commandScope;
        const root=await tx.get('semanticState','root');if(root)records.semanticState.set('root',root);
        if(this.commandScope.kind==='published_scene'){
          const sceneId=this.commandScope.input.scene.sceneId,meaningId=await tx.worldSceneMeaning(sceneId);
          sceneOwner={sceneId,meaningId};this.commandScope.matchedMeaningId=this.commandScope.input.existingPersonalMeaningId??meaningId;
          if(!this.commandScope.matchedMeaningId){this.commandScope.allocatedIds.add(learningScenePersonalMeaningId(sceneId));this.commandScope.allocatedIds.add(learningSceneContextId(sceneId));}
        }
        if(this.commandScope.kind==='context_creation'){
          dependencies=[];const queue=this.commandScope.contextReferences.flatMap(ref=>[contextKey('anchors',ref.contextId),contextKey('anchorRevisions',ref.revisionId)]),seen=new Set<string>();
          for(let at=0;at<queue.length;at++){const key=queue[at]!;if(seen.has(key))continue;seen.add(key);const row=await tx.get<ContextRecord>('semanticContexts',key);dependencies.push({table:'semanticContexts',key,expected:row});if(!row)throw new StoreCorruptedError('引用的情境版本缺失。');records.semanticContexts.set(key,row);if(row.kind==='anchors')queue.push(...[row.value.currentRevisionId,...(row.value.conflictHistory?.branches.map(branch=>branch.revisionId)??[])].map(id=>contextKey('anchorRevisions',id)));else if(row.parentRevisionId)queue.push(contextKey('anchorRevisions',row.parentRevisionId));}
          // A reused Scene keeps its original acceptance owner and witnesses.
          // Read that bounded source closure; the new draft cannot modify it.
          const sceneOwners=new Set<string>();
          for(const row of records.semanticContexts.values() as Iterable<ContextRecord>)if(row.kind==='anchorRevisions'&&row.value.structuredPayload.learningScene){const receipt=await tx.get<CommandReceipt>('semanticReceipts',row.value.provenance.createdByOperationId);if(!receipt)throw Error('meaning_scene_receipt_invalid');records.semanticReceipts.set(receipt.operationId,receipt);sceneOwners.add(String(receipt.result.personalMeaningId));}
          for(const id of sceneOwners){
            const raw=await tx.get<StoredMeaningRecord>('semanticMeanings',id);if(!raw)throw Error('meaning_scene_receipt_invalid');records.semanticMeanings.set(id,raw);dependencies.push({table:'semanticMeanings',key:id,expected:raw});
            for(const [key,value] of await readMeaningContextRecords(tx,raw)){records.semanticContexts.set(key,value);dependencies.push({table:'semanticContexts',key,expected:value});}
            const meaning=hydrateMeaningContexts(raw,key=>records.semanticContexts.get(key));
            const operations=new Set(meaningHistoryRecords(meaning).flatMap(branch=>[...branch.personalMeaningRevisions.filter(row=>row.lifecycle).map(row=>row.provenance.createdByOperationId),...branch.alignmentEvents.filter(row=>row.ordinal>1).map(row=>row.operationId),...branch.personalSemanticAnchorRevisions.filter(row=>row.structuredPayload.learningScene).map(row=>row.provenance.createdByOperationId)]));
            for(const operation of operations){const receipt=await tx.get<CommandReceipt>('semanticReceipts',operation);if(!receipt)throw Error('meaning_scene_receipt_invalid');records.semanticReceipts.set(operation,receipt);}
            for(const [key,value] of (await readMeaningRegistry(tx,meaning)).records){records.semanticRegistry.set(key,value);dependencies.push({table:'semanticRegistry',key,expected:value});}
          }
        }
        if(this.commandScope.kind==='meaning'||this.commandScope.kind==='correction'||this.commandScope.kind==='published_scene'||this.commandScope.kind==='meaning_confirmation'){
          const personalMeaningId=this.commandScope.kind==='meaning'?this.commandScope.personalMeaningId:this.commandScope.kind==='correction'||this.commandScope.kind==='meaning_confirmation'?this.commandScope.input.personalMeaningId:this.commandScope.matchedMeaningId;
          const rawMeaning=personalMeaningId?await tx.get<StoredMeaningRecord>('semanticMeanings',personalMeaningId):undefined;
          if(rawMeaning)for(const [key,value] of await readMeaningContextRecords(tx,rawMeaning))if(value)records.semanticContexts.set(key,value);
          const meaning=rawMeaning?hydrateMeaningContexts(rawMeaning,key=>records.semanticContexts.get(key)):undefined;
          if(meaning){
            if(meaning.personalMeaning.personalMeaningId!==personalMeaningId)throw new StoreCorruptedError('个人意义身份与存储记录不一致。');
            records.semanticMeanings.set(personalMeaningId!,rawMeaning);
            // The aggregate's own lifecycle witnesses are exact dependencies,
            // not a reason to enumerate the World or all operation receipts.
            for(const stamp of meaningHistoryRecords(meaning).flatMap(branch=>branch.personalMeaningRevisions))if(stamp.lifecycle){
              const key=stamp.provenance.createdByOperationId,receipt=await tx.get('semanticReceipts',key);
              if(!receipt)throw new StoreCorruptedError('个人意义的生命周期操作凭据缺失。');
              records.semanticReceipts.set(key,receipt);
            }
            assertMeaningLifecycleReceipts([meaning],[...records.semanticReceipts.values()] as CommandReceipt[]);
            for(const event of meaningHistoryRecords(meaning).flatMap(branch=>branch.alignmentEvents))if(event.ordinal>1){const receipt=await tx.get('semanticReceipts',event.operationId);if(!receipt)throw Error('meaning_correction_invalid');records.semanticReceipts.set(event.operationId,receipt);}
            assertMeaningCorrectionReceipts(meaning,[...records.semanticReceipts.values()] as CommandReceipt[]);
            for(const revision of meaningHistoryRecords(meaning).flatMap(branch=>branch.personalSemanticAnchorRevisions))if(revision.structuredPayload.learningScene){const key=revision.provenance.createdByOperationId,receipt=await tx.get('semanticReceipts',key);if(!receipt)throw Error('meaning_scene_receipt_invalid');records.semanticReceipts.set(key,receipt);}
            const closure=await readMeaningRegistry(tx,meaning);dependencies=[...records.semanticContexts].map(([key,expected])=>({table:'semanticContexts' as const,key,expected}));
            for(const [key,value] of closure.records){records.semanticRegistry.set(key,value);dependencies.push({table:'semanticRegistry',key,expected:value});}
          }
        }
        if(this.commandScope.kind==='clarification')({dependencies,selections}=await this.clarificationRecords(tx,this.commandScope.input,records));
        if(this.commandScope.kind==='intake')({dependencies,selections}=await this.intakeRecords(tx,this.commandScope.input,records));
        if(this.commandScope.kind==='published_scene'){
          const {input}=this.commandScope;
          const query={kind:'senseKey' as const,senseKey:input.semantic.senseKey},expected=await tx.registrySelection(query);selections=[{query,expected}];
          const exact=[`senses:${input.target.senseId}`,`senseVersions:${input.target.senseVersionId}`,`expressions:${input.semantic.expressionId}`,`expressionVersions:${input.semantic.expressionVersionId}`,`bindings:${input.target.bindingId}`,`bindingVersions:${input.target.bindingVersionId}`];
          const present=await tx.existingRecordKeys('semanticRegistry',exact);
          const closure=await readRegistryRecords(tx,[...expected.keys,...present]);dependencies??=[];
          for(const key of new Set([...exact,...closure.records.keys()])){
            const value=closure.records.get(key);if(value)records.semanticRegistry.set(key,value);
            dependencies.push({table:'semanticRegistry',key,expected:value});
          }
        }
        if(this.commandScope.kind==='correction'){
          const selected=await this.intakeRecords(tx,this.commandScope.input.payload,records,this.commandScope.input.reuseSense);
          dependencies=[...(dependencies??[]),...selected.dependencies];selections=selected.selections;
        }
        if(this.commandScope.kind==='meaning_confirmation'){const selected=await this.intakeRecords(tx,this.commandScope.input.payload,records);dependencies=[...(dependencies??[]),...selected.dependencies];selections=selected.selections;}
        if(this.commandScope.kind==='inbox')({dependencies,selections}=await this.inboxRecords(tx,this.commandScope.input,records));
        for(const row of records.semanticContexts.values() as Iterable<ContextRecord>)if(row.kind==='anchorRevisions'&&row.value.lifecycle){const key=row.value.provenance.createdByOperationId,receipt=await tx.get('semanticReceipts',key);if(!receipt)throw Error('semantic_context_invalid');records.semanticReceipts.set(key,receipt);}
        const receipt=await tx.get('semanticReceipts',operationId);if(receipt)records.semanticReceipts.set(operationId,receipt);
      }else for(const table of semanticJourneyTables)for await(const batch of tx.entryBatches(table))for(const row of batch)records[table].set(row.key,row.value);
      const state=stateFromRecords(records,false);
      if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure(this.commandScope?'sensa.journey.scoped-records':'sensa.journey.records',{start:recordsStarted,end:performance.now()});
      const authorityStarted=performance.now();
      try{await assertPersonalSemanticWorldStateCooperatively(state);if(!this.commandScope)assertMeaningLifecycleReceipts(state.meanings,state.commandReceipts);}catch(cause){throw new StoreCorruptedError('本机的个人意义数据违反领域不变量。',cause);}
      finally{if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure(this.commandScope?'sensa.journey.scoped-authority':'sensa.journey.authority',{start:authorityStarted,end:performance.now()});}
      this.snapshots.set(state,{revision,frameRevision:revision,incarnation,dependencies,selections,sceneOwner});return state;
    });
  }
  async load():Promise<JourneyState>{
    try{
      return await this.snapshot();
    }catch(cause){return translate(cause,'无法读取本机的个人意义数据。');}
  }
  async refresh(state:JourneyState,scope:'semantic'|'frame'='semantic'):Promise<JourneyState>{
    try{return await this.snapshot(state,scope);}catch(cause){return translate(cause,'无法检查本机的个人意义数据。');}
  }
  subscribe(listener:()=>void):()=>void{return observeLibrary(listener,[...semanticJourneyTables,'meta']);}
  async lookupMeanings(query:string):Promise<MeaningLookupResult>{
    return readLibrary(async tx=>{
      await assertCurrentLibrary(tx);
      const root=await tx.get<{version:string}>('semanticState','root');
      if(root&&root.version!==JOURNEY_STORE_VERSION)throw new StoreCorruptedError('本机的个人意义数据版本不匹配。');
      return tx.lookupMeanings(query);
    });
  }
  async readReceipt(operationId:string):Promise<CommandReceipt|null>{
    return readLibrary(async tx=>{
      await assertCurrentLibrary(tx);const receipt=await tx.get<CommandReceipt>('semanticReceipts',operationId);
      if(receipt&&receipt.operationId!==operationId)throw new StoreCorruptedError('操作凭据身份与存储记录不一致。');
      if(receipt?.command==='AcceptPublishedLearningScene')assertSceneReceiptWitness(receipt,await readMeaningContexts(tx,String(receipt.result.personalMeaningId)));
      if(receipt?.command==='ChangeContextLifecycle'){
        const row=await tx.get<ContextRecord>('semanticContexts',contextKey('anchorRevisions',String(receipt.result.revisionId)));
        if(row?.kind!=='anchorRevisions'||row.value.personalSemanticAnchorId!==receipt.result.contextId||row.value.provenance.createdByOperationId!==operationId||!row.value.lifecycle)throw Error('semantic_context_invalid');
        assertContextLifecycleReceipt(row.value,id=>id===operationId?receipt:undefined);
      }
      if(receipt?.command==='ChangeMeaningLifecycle'){
        const key=receipt.result.personalMeaningId;
        const meaning=typeof key==='string'?await readMeaningContexts(tx,key):undefined;
        assertCurrentMeaningReceipt(meaning,receipt);assertMeaningLifecycleOperationReceipt(meaning,receipt);
      }
      if(receipt?.command==='CorrectPersonalMeaning'){
        const meaning=await readMeaningContexts(tx,String(receipt.result.personalMeaningId));if(!meaning)throw Error('meaning_correction_invalid');
        assertCurrentMeaningReceipt(meaning,receipt);
        const receipts=await Promise.all([...new Set(meaningHistoryRecords(meaning).flatMap(branch=>branch.alignmentEvents.filter(event=>event.ordinal>1).map(event=>event.operationId)))].map(id=>tx.get<CommandReceipt>('semanticReceipts',id)));
        if(receipts.some(row=>!row))throw Error('meaning_correction_invalid');assertMeaningCorrectionReceipts(meaning,receipts as CommandReceipt[]);
      }
      return receipt??null;
    });
  }
  async commit(input:JourneyCommit):Promise<JourneyCommitResult>{
    const commitStarted=performance.now();
    const changes=recordChanges(input.before,input.after);
    if(this.commandScope){
      const scope=this.commandScope;
      if(changes.some(change=>{
        if(change.table==='semanticContexts'){
          if(change.after===undefined)return true;
          const id=change.key.slice(change.key.indexOf(':')+1);
          if(change.before===undefined)return !scope.allocatedIds.has(id);
          return !input.before.contexts.anchors.some(head=>contextKey('anchors',head.personalSemanticAnchorId)===change.key);
        }
        if(change.table==='semanticReceipts')return change.key!==scope.operationId||change.before!==undefined||change.after===undefined;
        if(scope.kind==='meaning')return change.table!=='semanticMeanings'||change.key!==scope.personalMeaningId||change.before===undefined||change.after===undefined;
        if(scope.kind==='context_creation')return change.table!=='semanticMeanings'||!scope.allocatedIds.has(change.key)||change.before!==undefined||change.after===undefined;
        if(scope.kind==='meaning_confirmation'){
          if(change.table==='semanticMeanings')return change.key!==scope.input.personalMeaningId||change.before===undefined||change.after===undefined;
          if(change.table==='semanticRegistry')return change.after===undefined||(change.before!==undefined?(change.before as RegistryRow).kind!=='bindings':!scope.allocatedIds.has(change.key.slice(change.key.indexOf(':')+1)));
          return true;
        }
        if(scope.kind==='published_scene'){
          if(change.table==='semanticMeanings')return change.after===undefined||(scope.matchedMeaningId?change.key!==scope.matchedMeaningId||change.before===undefined:!scope.allocatedIds.has(change.key)||change.before!==undefined);
          if(change.table==='semanticRegistry'){
            const {input}=scope,keys=[`senses:${input.target.senseId}`,`senseVersions:${input.target.senseVersionId}`,`expressions:${input.semantic.expressionId}`,`expressionVersions:${input.semantic.expressionVersionId}`,`bindings:${input.target.bindingId}`,`bindingVersions:${input.target.bindingVersionId}`];
            return !keys.includes(change.key)||change.after===undefined;
          }
          return true;
        }
        if(scope.kind==='correction'){
          if(change.table==='semanticMeanings')return change.key!==scope.input.personalMeaningId||change.before===undefined||change.after===undefined;
          const senseId=input.before.meanings.find(row=>row.personalMeaning.personalMeaningId===scope.input.personalMeaningId)?.alignments.find(row=>row.personalMeaningAlignmentId===scope.input.personalMeaningAlignmentId)?.senseId;
          if(change.table==='semanticRegistry')return change.after===undefined||(change.before!==undefined?((change.before as RegistryRow).kind!=='bindings'&&!(scope.input.senseEdit==='wording'&&change.key===`senses:${senseId}`)):!scope.allocatedIds.has(change.key.slice(change.key.indexOf(':')+1)));
          return true;
        }
        if(scope.kind==='clarification'||scope.kind==='intake'||scope.kind==='inbox'){
          if(change.table==='semanticInbox'||change.table==='semanticDrafts')return scope.kind==='intake'||change.key!==scope.input.intakeId||change.before===undefined||change.after!==undefined;
          if(scope.kind==='inbox'&&!('sense'in scope.input))return true;
          if(change.table==='semanticMeanings')return !scope.allocatedIds.has(change.key)||change.before!==undefined||change.after===undefined;
          if(change.table==='semanticRegistry')return change.after===undefined||(change.before!==undefined?(change.before as RegistryRow).kind!=='bindings':!scope.allocatedIds.has(change.key.slice(change.key.indexOf(':')+1)));
          return true;
        }
        return !['semanticInbox','semanticDrafts'].includes(change.table)||!scope.allocatedIds.has(change.key)||change.before!==undefined||change.after===undefined;
      }))throw new Error('journey_command_scope_exceeded');
      if(scope.kind==='clarification'&&changes.length&&(changes.filter(change=>change.table==='semanticMeanings').length!==1||!changes.some(change=>change.table==='semanticInbox'&&change.after===undefined)||!changes.some(change=>change.table==='semanticReceipts')))throw new Error('journey_command_scope_exceeded');
      if(scope.kind==='intake'&&changes.length&&(changes.filter(change=>change.table==='semanticMeanings').length!==1||!changes.some(change=>change.table==='semanticReceipts')))throw new Error('journey_command_scope_exceeded');
      if(scope.kind==='published_scene'&&changes.length){
        const count=changes.filter(change=>change.table==='semanticMeanings').length;
        const confirmation=scope.matchedMeaningId&&input.after.commandReceipts.some(receipt=>receipt.operationId===scope.operationId&&typeof receipt.result.acceptedByOperationId==='string');
        if((count!==1&&!(count===0&&confirmation))||!changes.some(change=>change.table==='semanticReceipts'))throw new Error('journey_command_scope_exceeded');
      }
      if(scope.kind==='correction'&&changes.length&&(changes.filter(change=>change.table==='semanticMeanings').length!==1||!changes.some(change=>change.table==='semanticReceipts')))throw Error('journey_command_scope_exceeded');
      if(scope.kind==='inbox'&&changes.length&&(!changes.some(change=>change.table==='semanticInbox'&&change.after===undefined)||!changes.some(change=>change.table==='semanticReceipts')||changes.filter(change=>change.table==='semanticMeanings').length!==('sense'in scope.input?1:0)))throw new Error('journey_command_scope_exceeded');
    }
    const prepared=new Map((input.preparedMedia??[]).map(raw=>{
      const media=parseStoredMedia(raw);
      return [media.mediaId,media] as const;
    }));
    const mediaIds=referencedMediaIds(changes);
    const committedMediaIds:string[]=[];
    let committedSnapshot:LibrarySnapshotStamp|undefined;
    let mergedState:JourneyState|undefined;
    try{
      await restoreLibraryTransaction(async tx=>{
        const writerStarted=performance.now();
        if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.journey.writer-wait',{start:commitStarted,end:writerStarted});
        // Validate the root again under the writer lock. A root disappearing
        // after the read must not be manufactured over existing source facts.
        const {incarnation,revision}=await readWorldFrame(tx);
        const prior=this.snapshots.get(input.before);
        if(!prior||prior.incarnation!==incarnation)throw new JourneyConflictError();
        if(prior.sceneOwner&&(await tx.worldSceneMeaning(prior.sceneOwner.sceneId))!==prior.sceneOwner.meaningId)throw new JourneyConflictError();
        const foreignChanges=!this.commandScope&&prior.frameRevision!==revision&&await tx.hasChangesSince(prior.frameRevision,semanticJourneyTables);
        for(const condition of [...(prior.dependencies??[]),...(input.preconditions??[])]){
          const started=performance.now();
          if(!matchesCondition(await tx.get(condition.table,condition.key),condition))throw new JourneyConflictError();
          if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.journey.admit-dependency',{start:started,end:performance.now()});
        }
        for(const condition of prior.selections??[]){
          const started=performance.now();
          if(!same(await tx.registrySelection(condition.query),condition.expected))throw new JourneyConflictError();
          if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure(`sensa.journey.admit-query-${condition.query.kind}`,{start:started,end:performance.now()});
        }
        const registryConditions=new Map((prior.dependencies??[]).filter(condition=>condition.table==='semanticRegistry').map(condition=>[condition.key,condition.expected as RegistryRow]));
        const nextOrdinals=new Map<RegistryKind,number>();
        for(const change of changes)if(change.table==='semanticRegistry'){
          if(change.before!==undefined){const original=this.commandScope?registryConditions.get(change.key):await tx.get<RegistryRow>('semanticRegistry',change.key);if(!original||!matchesCondition(original,{table:'semanticRegistry',key:change.key,expected:change.before}))throw new JourneyConflictError();change.before=original;change.after={...(change.after as RegistryRow),ordinal:original.ordinal};}
          else{const kind=(change.after as RegistryRow).kind;if(!nextOrdinals.has(kind)){
            const started=performance.now();nextOrdinals.set(kind,(await tx.registrySelection({kind:'ordinal',registryKind:kind})).nextOrdinal!);
            if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure(`sensa.journey.admit-ordinal-${kind}`,{start:started,end:performance.now()});
          }const ordinal=nextOrdinals.get(kind)!;nextOrdinals.set(kind,ordinal+1);change.after={...(change.after as RegistryRow),ordinal};}
        }
        if(this.commandScope){
          const started=performance.now();
          const allocated=[...this.commandScope.allocatedIds];
          for(let offset=0;offset<allocated.length;offset+=256)if((await tx.existingJourneyIdentities(allocated.slice(offset,offset+256))).size)throw new JourneyConflictError();
          if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.journey.admit-identity',{start:started,end:performance.now()});
        }
        const root=await tx.get<{version?:unknown}>('semanticState','root');
        if(!root)tx.put('semanticState','root',{version:JOURNEY_STORE_VERSION});
        else if(root.version!==JOURNEY_STORE_VERSION){
          throw new StoreCorruptedError('本机的个人意义数据版本不匹配。');
        }
        const stagingStarted=performance.now();
        if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.journey.writer-admission',{start:writerStarted,end:stagingStarted});
        for(const mediaId of mediaIds){
          const current=await tx.get<StoredMedia>('media',mediaId);
          const candidate=prepared.get(mediaId);
          if(current){
            const stored=parseStoredMedia(current);
            if(candidate&&!same(stored,candidate))throw new JourneyConflictError();
          }else if(candidate){
            tx.put('media',mediaId,candidate);
            committedMediaIds.push(mediaId);
          }else{
            throw new StorageUnavailableError('图片材料尚未准备完成。');
          }
        }
        for(const change of changes){
          const current=await tx.get(change.table,change.key);
          if(!same(current,change.before))throw new JourneyConflictError();
          if(change.after===undefined)tx.delete(change.table,change.key);
          else tx.put(change.table,change.key,change.after);
        }
        // The transaction wrapper increments exactly once while holding this
        // writer lock. Never sample a later revision after releasing the lock.
        const committedRevision=revision+(tx.wrote?1:0);
        committedSnapshot={incarnation,revision:committedRevision,frameRevision:committedRevision,dependencies:prior.dependencies};
        if(foreignChanges){
          const records=emptyRecords();
          for(const table of semanticJourneyTables)for(const row of await tx.entries(table))records[table].set(row.key,row.value);
          mergedState=stateFromRecords(records);
        }
        if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.journey.writer-staging',{start:stagingStarted,end:performance.now()});
      });
    }catch(cause){translate(cause,'无法保存本机的个人意义数据。');}
    if(!mergedState)this.snapshots.set(input.after,committedSnapshot!);
    if(mergedState)this.snapshots.set(mergedState,committedSnapshot!);
    if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.journey.commit',{start:commitStarted,end:performance.now()});
    return {committedMediaIds,...(mergedState?{state:mergedState}: {})};
  }
}

export const loadJourneyStateFromLibrary=():Promise<JourneyState>=>new LibraryJourneyRepository().load();

/** Pure reconstruction used by full-library validation at the sync seam. */
export const journeyStateFromRows=(rows:Record<SemanticTable,Array<{key:string;value:unknown}>>):JourneyState=>{
  const records=emptyRecords();
  for(const table of semanticJourneyTables)for(const row of rows[table])records[table].set(row.key,row.value);
  return stateFromRecords(records);
};
