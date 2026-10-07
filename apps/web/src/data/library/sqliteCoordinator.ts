import type {
  HomeLearningStorageProjection,
  PortableMediaBlob,
  PortableMediaStorageDiagnostics,
  SqliteLibraryTable,
  SqliteMutation,
  SqliteRecordChange,
  SqliteSyncBaseEntry,
  SqliteStorageDiagnostics,
  SqliteWorkerInput,
} from './sqliteProtocol';
import { sqliteCoordinatorProtocolVersion, sqliteLibrarySchemaVersion } from './sqliteProtocol';
import {observeSahPoolPageHide} from './sqlitePoolLifecycle';
import type {PackageCacheProjectionQuery,PackageCacheProjectionResult} from './packageCacheProjection';
import type {RuntimeLearningCandidateQuery,RuntimeLearningCandidates} from './runtimeLearningCandidates';
import type {LearningManagementSummaryQuery,LearningManagementStorageSummary} from './runtimeLearningCandidates';
import type {LearningHistoryRequest} from '../../learning/system/learningHistoryModel';
import type {StoredLearningHistoryPage} from './learningHistoryProjection';

// Keep the original ownership name so a page from the previous release cannot
// open a second OPFS connection while a newly deployed page is active.
const ownerLock = 'sensa-sqlite-owner-v1';
const channelName = 'sensa-sqlite-coordinator-v1';
const remoteTimeoutMs = 15_000;
const leaderWaitMs = 10_000;
const retryableOwnerReads=new Set<SqliteWorkerInput['kind']>([
  'initialize','get','entries','entriesPage','changesSince','diagnostics',
  'meaningLookup','registrySelection','worldBrowse','worldSceneMeaning','worldLearningChoices',
  'existingRecordKeys','existingJourneyIdentities','packageCacheProjection',
  'learningSemanticMemory','hasChangesSince','syncBaseEntries','count','estimateRecordBytes',
  'homeLearningProjection','learningHistoryPage','learningManagementSummary','runtimeLearningCandidates',
  'studyScopeMember','latestLearningActionAt','countIntroducedLearningTargets','learningRunIdsForTarget',
  'openLearningRunTargets','countContentAttemptsSince','learningTargetIdsForBookUpgrade',
  'isMediaReferenced','portableMedia','portableMediaDiagnostics',
]);

export interface CoordinatedSqliteBackend {
  learningSemanticMemory(targetId?:string):Promise<import('../../learning/system/learningReadModels').LearningSemanticMemoryProjection>;
  existingRecordKeys(table:SqliteLibraryTable,keys:readonly string[]):Promise<string[]>;
  packageCacheProjection<Query extends PackageCacheProjectionQuery>(query:Query):Promise<PackageCacheProjectionResult<Query>>;
  initialize(): Promise<SqliteStorageDiagnostics>;
  get(table: SqliteLibraryTable, key: string): Promise<string | null>;
  entries(table: SqliteLibraryTable): Promise<Array<{ key: string; encodedValue: string }>>;
  entriesPage(table:SqliteLibraryTable,afterKey:string|null,limit:number):Promise<Array<{key:string;encodedValue:string}>>;
  lookupMeanings(query:string):Promise<import('./sqliteProtocol').MeaningLookupResult>;
  worldBrowse(query:import('./sqliteProtocol').WorldBrowseQuery):Promise<import('./sqliteProtocol').WorldBrowsePage>;
  worldSceneMeaning(sceneId:string):Promise<string|null>;
  registrySelection(query:import('./sqliteProtocol').RegistrySelectionQuery):Promise<import('./sqliteProtocol').RegistrySelection>;
  worldLearningChoices(query:import('./sqliteProtocol').WorldLearningChoiceQuery):Promise<import('./sqliteProtocol').WorldLearningChoicePage>;
  existingJourneyIdentities(ids:readonly string[]):Promise<string[]>;
  changesSince(contentRevision: number, tables: readonly SqliteLibraryTable[]): Promise<SqliteRecordChange[]>;
  hasChangesSince(contentRevision:number,tables:readonly SqliteLibraryTable[]):Promise<boolean>;
  syncBaseEntries(keys?: readonly { table: SqliteLibraryTable; key: string }[]): Promise<SqliteSyncBaseEntry[]>;
  count(table: SqliteLibraryTable): Promise<number>;
  estimateRecordBytes(tables: readonly SqliteLibraryTable[]): Promise<number>;
  homeLearningProjection(languageRouteId: string,clock?:number): Promise<HomeLearningStorageProjection>;
  learningHistoryPage(query:LearningHistoryRequest):Promise<StoredLearningHistoryPage>;
  learningManagementSummary(query:LearningManagementSummaryQuery):Promise<LearningManagementStorageSummary>;
  runtimeLearningCandidates(query:RuntimeLearningCandidateQuery):Promise<RuntimeLearningCandidates>;
  studyScopeMember(scopeRevisionId:string,targetId:string):Promise<import('./studyScopes').LocalStudyScopeMember|null>;
  latestLearningActionAt(runId:string):Promise<string|null>;
  countIntroducedLearningTargets(languageRouteId: string, startedAfter: string, startedBefore: string): Promise<number>;
  learningRunIdsForTarget(targetId: string, openOnly: boolean): Promise<string[]>;
  openLearningRunTargets(): Promise<Array<{ runId: string; targetId: string }>>;
  countContentAttemptsSince(taskId: string, createdAfter: string): Promise<number>;
  learningTargetIdsForBookUpgrade(languageRouteId: string, targetLanguageTag: string, supportLanguageTag: string, bookId: string, nextBookVersionId: string): Promise<string[]>;
  isMediaReferenced(mediaId: string): Promise<boolean>;
  portableMedia(sha256:string):Promise<PortableMediaBlob|null>;
  portableMediaDiagnostics():Promise<PortableMediaStorageDiagnostics>;
  commit(mutation: SqliteMutation): Promise<void>;
  diagnostics(options?:Readonly<{verifyIntegrity?:boolean}>): Promise<SqliteStorageDiagnostics>;
  close():Promise<void>;
}

type CoordinatorEnvelope = { protocol: number; schemaVersion: number };
type CoordinatorPayload =
  | { kind: 'leader'; sender: string }
  | { kind: 'probe'; sender: string }
  | { kind: 'request'; sender: string; requestId: string; input: SqliteWorkerInput }
  | { kind: 'response'; recipient: string; requestId: string; ok: true; value: unknown }
  | { kind: 'response'; recipient: string; requestId: string; ok: false; error: string };
type CoordinatorMessage = CoordinatorEnvelope & CoordinatorPayload;

const errorMessage = (cause: unknown): string => cause instanceof Error
  ? cause.message
  : 'sqlite_coordination_failed';

/**
 * One tab owns the OPFS connection; every other tab speaks the same record
 * interface over BroadcastChannel. Web Locks elect a replacement if the owner
 * closes, while the caller-level transaction lock protects read/modify/write
 * sequences that span several record requests.
 */
export class CoordinatedSqliteAdapter implements CoordinatedSqliteBackend {
  private readonly id = crypto.randomUUID();
  private readonly channel = new BroadcastChannel(channelName);
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly leaderWaiters = new Set<{
    resolve: () => void;
    reject: (error: Error) => void;
  }>();
  private backend: CoordinatedSqliteBackend | null = null;
  private startupBackend:CoordinatedSqliteBackend|null=null;
  private connection: Promise<void> | null = null;
  private election: Promise<boolean> | null = null;
  private ownerLockRelease:(()=>void)|null=null;
  private closeInFlight:Promise<void>|null=null;
  private readonly activeRemoteRequests=new Set<Promise<void>>();
  private closing=false;
  private cleanupUnconfirmed=false;
  private lifecycleGeneration=0;
  private lastLeaderAt = 0;
  private leaderId:string|null=null;
  private incompatible = false;

  constructor(private readonly createBackend: () => CoordinatedSqliteBackend) {
    this.channel.addEventListener('message', (event: MessageEvent<CoordinatorMessage>) => {
      this.receive(event.data);
    });
    observeSahPoolPageHide(window,()=>this.close());
  }

  initialize(): Promise<SqliteStorageDiagnostics> {
    return this.call({ kind: 'initialize' }) as Promise<SqliteStorageDiagnostics>;
  }

  get(table: SqliteLibraryTable, key: string): Promise<string | null> {
    return this.call({ kind: 'get', table, key }) as Promise<string | null>;
  }

  entries(table: SqliteLibraryTable): Promise<Array<{ key: string; encodedValue: string }>> {
    return this.call({ kind: 'entries', table }) as Promise<Array<{ key: string; encodedValue: string }>>;
  }

  existingRecordKeys(table:SqliteLibraryTable,keys:readonly string[]):Promise<string[]>{
    return this.call({kind:'existingRecordKeys',table,keys:[...keys]}) as Promise<string[]>;
  }

  changesSince(contentRevision: number, tables: readonly SqliteLibraryTable[]): Promise<SqliteRecordChange[]> {
    return this.call({ kind: 'changesSince', contentRevision, tables: [...tables] }) as Promise<SqliteRecordChange[]>;
  }
  lookupMeanings(query:string):Promise<import('./sqliteProtocol').MeaningLookupResult>{return this.call({kind:'meaningLookup',query}) as Promise<import('./sqliteProtocol').MeaningLookupResult>;}
  learningSemanticMemory(targetId?:string):Promise<import('../../learning/system/learningReadModels').LearningSemanticMemoryProjection>{return this.call({kind:'learningSemanticMemory',targetId}) as Promise<import('../../learning/system/learningReadModels').LearningSemanticMemoryProjection>;}
  worldBrowse(query:import('./sqliteProtocol').WorldBrowseQuery):Promise<import('./sqliteProtocol').WorldBrowsePage>{return this.call({kind:'worldBrowse',query}) as Promise<import('./sqliteProtocol').WorldBrowsePage>;}
  worldSceneMeaning(sceneId:string):Promise<string|null>{return this.call({kind:'worldSceneMeaning',sceneId}) as Promise<string|null>;}
  registrySelection(query:import('./sqliteProtocol').RegistrySelectionQuery):Promise<import('./sqliteProtocol').RegistrySelection>{return this.call({kind:'registrySelection',query}) as Promise<import('./sqliteProtocol').RegistrySelection>;}
  worldLearningChoices(query:import('./sqliteProtocol').WorldLearningChoiceQuery):Promise<import('./sqliteProtocol').WorldLearningChoicePage>{return this.call({kind:'worldLearningChoices',query}) as Promise<import('./sqliteProtocol').WorldLearningChoicePage>;}
  existingJourneyIdentities(ids:readonly string[]):Promise<string[]>{return this.call({kind:'existingJourneyIdentities',ids:[...ids]}) as Promise<string[]>;}
  entriesPage(table:SqliteLibraryTable,afterKey:string|null,limit:number):Promise<Array<{key:string;encodedValue:string}>>{
    return this.call({kind:'entriesPage',table,afterKey,limit}) as Promise<Array<{key:string;encodedValue:string}>>;
  }

  hasChangesSince(contentRevision:number,tables:readonly SqliteLibraryTable[]):Promise<boolean>{
    return this.call({kind:'hasChangesSince',contentRevision,tables:[...tables]}) as Promise<boolean>;
  }

  syncBaseEntries(keys?: readonly { table: SqliteLibraryTable; key: string }[]): Promise<SqliteSyncBaseEntry[]> {
    const input: SqliteWorkerInput = keys
      ? { kind: 'syncBaseEntries', keys: [...keys] }
      : { kind: 'syncBaseEntries' };
    return this.call(input) as Promise<SqliteSyncBaseEntry[]>;
  }

  count(table: SqliteLibraryTable): Promise<number> {
    return this.call({ kind: 'count', table }) as Promise<number>;
  }

  estimateRecordBytes(tables: readonly SqliteLibraryTable[]): Promise<number> {
    return this.call({kind:'estimateRecordBytes',tables:[...tables]}) as Promise<number>;
  }

  homeLearningProjection(languageRouteId: string,clock=Date.now()): Promise<HomeLearningStorageProjection> {
    return this.call({ kind: 'homeLearningProjection', languageRouteId,clock }) as Promise<HomeLearningStorageProjection>;
  }
  runtimeLearningCandidates(query:RuntimeLearningCandidateQuery):Promise<RuntimeLearningCandidates>{return this.call({kind:'runtimeLearningCandidates',query}) as Promise<RuntimeLearningCandidates>;}
  studyScopeMember(scopeRevisionId:string,targetId:string):Promise<import('./studyScopes').LocalStudyScopeMember|null>{return this.call({kind:'studyScopeMember',scopeRevisionId,targetId}) as Promise<import('./studyScopes').LocalStudyScopeMember|null>;}
  latestLearningActionAt(runId:string):Promise<string|null>{return this.call({kind:'latestLearningActionAt',runId}) as Promise<string|null>;}
  learningHistoryPage(query:LearningHistoryRequest):Promise<StoredLearningHistoryPage>{return this.call({kind:'learningHistoryPage',query}) as Promise<StoredLearningHistoryPage>;}
  learningManagementSummary(query:LearningManagementSummaryQuery):Promise<LearningManagementStorageSummary>{return this.call({kind:'learningManagementSummary',query}) as Promise<LearningManagementStorageSummary>;}

  packageCacheProjection<Query extends PackageCacheProjectionQuery>(query:Query):Promise<PackageCacheProjectionResult<Query>>{
    return this.call({kind:'packageCacheProjection',query}) as Promise<PackageCacheProjectionResult<Query>>;
  }

  countIntroducedLearningTargets(languageRouteId: string, startedAfter: string, startedBefore: string): Promise<number> {
    return this.call({
      kind: 'countIntroducedLearningTargets', languageRouteId, startedAfter, startedBefore,
    }) as Promise<number>;
  }

  learningRunIdsForTarget(targetId: string, openOnly: boolean): Promise<string[]> {
    return this.call({ kind: 'learningRunIdsForTarget', targetId, openOnly }) as Promise<string[]>;
  }

  openLearningRunTargets(): Promise<Array<{ runId: string; targetId: string }>> {
    return this.call({ kind: 'openLearningRunTargets' }) as Promise<Array<{ runId: string; targetId: string }>>;
  }

  countContentAttemptsSince(taskId: string, createdAfter: string): Promise<number> {
    return this.call({ kind: 'countContentAttemptsSince', taskId, createdAfter }) as Promise<number>;
  }

  learningTargetIdsForBookUpgrade(
    languageRouteId: string,
    targetLanguageTag: string,
    supportLanguageTag: string,
    bookId: string,
    nextBookVersionId: string,
  ): Promise<string[]> {
    return this.call({
      kind: 'learningTargetIdsForBookUpgrade',
      languageRouteId,
      targetLanguageTag,
      supportLanguageTag,
      bookId,
      nextBookVersionId,
    }) as Promise<string[]>;
  }

  isMediaReferenced(mediaId: string): Promise<boolean> {
    return this.call({ kind: 'isMediaReferenced', mediaId }) as Promise<boolean>;
  }

  portableMedia(sha256:string):Promise<PortableMediaBlob|null>{
    return this.call({kind:'portableMedia',sha256}) as Promise<PortableMediaBlob|null>;
  }

  portableMediaDiagnostics():Promise<PortableMediaStorageDiagnostics>{
    return this.call({kind:'portableMediaDiagnostics'}) as Promise<PortableMediaStorageDiagnostics>;
  }

  async commit(mutation: SqliteMutation): Promise<void> {
    await this.call({ kind: 'commit', mutation });
  }

  diagnostics(options?:Readonly<{verifyIntegrity?:boolean}>): Promise<SqliteStorageDiagnostics> {
    return this.call({ kind: 'diagnostics',...options }) as Promise<SqliteStorageDiagnostics>;
  }

  /** Close the Worker-owned database before releasing the document owner lock. */
  close():Promise<void>{
    if(this.closeInFlight)return this.closeInFlight;
    const closing=(async()=>{
      this.closing=true;
      this.lifecycleGeneration++;
      this.connection=null;
      for(const waiter of [...this.leaderWaiters]){
        waiter.reject(new Error('sqlite_owner_lifecycle_closed'));
      }
      try{
        const election=this.election;
        if(election)await election.catch(()=>false);
        await Promise.all([...this.activeRemoteRequests]);
        const backend=this.backend??this.startupBackend;
        if(backend)await backend.close();
        if(this.backend===backend)this.backend=null;
        if(this.startupBackend===backend)this.startupBackend=null;
        const release=this.ownerLockRelease;
        this.ownerLockRelease=null;
        release?.();
        this.connection=null;
        this.lastLeaderAt=0;
        this.leaderId=null;
        this.cleanupUnconfirmed=false;
      }catch(cause){
        this.cleanupUnconfirmed=true;
        throw cause;
      }finally{
        this.closing=false;
      }
    })();
    this.closeInFlight=closing.finally(()=>{this.closeInFlight=null;});
    return this.closeInFlight;
  }

  private async call(input: SqliteWorkerInput): Promise<unknown> {
    if (this.incompatible) throw new Error('sqlite_owner_incompatible');
    if(this.closing||this.closeInFlight)throw new Error('sqlite_owner_closing');
    if(this.cleanupUnconfirmed)await this.close();
    if(this.closing||this.closeInFlight)throw new Error('sqlite_owner_closing');
    const generation=this.lifecycleGeneration;
    await this.connect(generation);
    this.assertLifecycleGeneration(generation);
    if (this.incompatible) throw new Error('sqlite_owner_incompatible');
    if (this.backend) return this.dispatch(this.backend, input);

    // A stale announcement is harmless: the lock decides whether this tab may
    // replace the old owner before the request is sent.
    if (await this.tryBecomeLeader()) {
      this.assertLifecycleGeneration(generation);
      return this.dispatch(this.backend!, input);
    }
    this.assertLifecycleGeneration(generation);
    try {
      return await this.remote(input);
    } catch (cause) {
      const message=errorMessage(cause);
      if(!['sqlite_coordination_timeout','sqlite_owner_changed','sqlite_owner_closing'].includes(message))throw cause;
      // A departed owner may already have committed a write. Let the owner
      // command's durable receipt settle that ambiguity; only reread safely.
      if(message!=='sqlite_coordination_timeout'&&!retryableOwnerReads.has(input.kind))throw cause;
      this.assertLifecycleGeneration(generation);
      this.lastLeaderAt = 0;
      if (await this.tryBecomeLeader()){
        this.assertLifecycleGeneration(generation);
        return this.dispatch(this.backend!, input);
      }
      await this.waitForLeader(generation);
      this.assertLifecycleGeneration(generation);
      return this.remote(input);
    }
  }

  private connect(generation:number): Promise<void> {
    this.assertLifecycleGeneration(generation);
    if(this.connection)return this.connection;
    const connection=(async()=>{
      if(await this.tryBecomeLeader()){
        this.assertLifecycleGeneration(generation);
        return;
      }
      this.assertLifecycleGeneration(generation);
      await this.waitForLeader(generation);
      this.assertLifecycleGeneration(generation);
    })();
    this.connection=connection;
    void connection.catch(()=>{
      if(this.connection===connection)this.connection=null;
    });
    return connection;
  }

  private tryBecomeLeader(): Promise<boolean> {
    if (this.incompatible) return Promise.reject(new Error('sqlite_owner_incompatible'));
    if (this.backend) return Promise.resolve(true);
    if (this.election) return this.election;
    const attempt = new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const succeed = (value: boolean) => {
        if (!settled) { settled = true; resolve(value); }
      };
      const fail = (cause: unknown) => {
        if (!settled) { settled = true; reject(cause); }
      };
      void navigator.locks.request(ownerLock, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) {
          succeed(false);
          return;
        }
        let releaseHold!:()=>void;
        const hold=new Promise<void>(resolve=>{
          releaseHold=resolve;
          this.ownerLockRelease=resolve;
        });
        let backend:CoordinatedSqliteBackend|undefined;
        try {
          backend=this.createBackend();
          this.startupBackend=backend;
          await backend.initialize();
          if(this.closing){
            await backend.close();
            this.startupBackend=null;
            if(this.ownerLockRelease===releaseHold)this.ownerLockRelease=null;
            succeed(false);
            return;
          }
          this.backend = backend;
          this.startupBackend=null;
          this.markLeader();
          succeed(true);
          await hold;
          if(this.backend===backend)this.backend=null;
          if(this.ownerLockRelease===releaseHold)this.ownerLockRelease=null;
        } catch (cause) {
          if(!backend){
            releaseHold();
            fail(cause);
            if(this.ownerLockRelease===releaseHold)this.ownerLockRelease=null;
            return;
          }
          try{
            await backend.close();
            this.startupBackend=null;
            if(this.ownerLockRelease===releaseHold)this.ownerLockRelease=null;
            releaseHold();
            fail(cause);
          }catch(cleanupCause){
            this.cleanupUnconfirmed=true;
            this.startupBackend=backend;
            fail(new AggregateError([cause,cleanupCause],'sqlite_worker_cleanup_unconfirmed'));
            // Keep the document lock while the Worker cannot prove that its
            // pool handles are closed. pagehide may retry cleanup; destruction
            // of this document is the final lease boundary.
            await hold;
            if(this.startupBackend===backend)this.startupBackend=null;
            if(this.ownerLockRelease===releaseHold)this.ownerLockRelease=null;
          }
        }
      }).catch(fail);
    });
    this.election = attempt.finally(() => { this.election = null; });
    return this.election;
  }

  private waitForLeader(generation:number): Promise<void> {
    this.assertLifecycleGeneration(generation);
    if (this.incompatible) return Promise.reject(new Error('sqlite_owner_incompatible'));
    if (this.lastLeaderAt) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled=false,retryTimer:ReturnType<typeof setTimeout>|undefined;
      const finish=()=>{
        settled=true;clearTimeout(timer);clearTimeout(retryTimer);
        this.leaderWaiters.delete(waiter);
      };
      const waiter = {
        resolve: () => {
          if(settled)return;
          finish();
          resolve();
        },
        reject: (error: Error) => {
          if(settled)return;
          finish();
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        waiter.reject(new Error('sqlite_coordination_timeout'));
      }, leaderWaitMs);
      const retryElection=async()=>{
        if(settled)return;
        try{
          this.assertLifecycleGeneration(generation);
          const owned=await this.tryBecomeLeader();
          this.assertLifecycleGeneration(generation);
          if(settled)return;
          if(owned){waiter.resolve();return;}
          this.post({kind:'probe',sender:this.id});
          retryTimer=setTimeout(retryElection,100);
        }catch(cause){waiter.reject(cause instanceof Error?cause:new Error(errorMessage(cause)));}
      };
      this.leaderWaiters.add(waiter);
      this.post({ kind: 'probe', sender: this.id });
      // A closing owner may release its lock after our first ifAvailable
      // attempt, with no backend left to answer the probe. Retry the same
      // authoritative lock within the existing bounded connection deadline.
      retryTimer=setTimeout(retryElection,100);
    });
  }

  private assertLifecycleGeneration(generation:number):void{
    if(this.closing||generation!==this.lifecycleGeneration){
      throw new Error('sqlite_owner_lifecycle_closed');
    }
  }

  private remote(input: SqliteWorkerInput): Promise<unknown> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('sqlite_coordination_timeout'));
      }, remoteTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.post({ kind: 'request', sender: this.id, requestId, input });
    });
  }

  private receive(message: CoordinatorMessage): void {
    if (!message || typeof message !== 'object') return;
    const sender = 'sender' in message ? message.sender : undefined;
    const incompatible = message.protocol !== sqliteCoordinatorProtocolVersion
      || message.schemaVersion !== sqliteLibrarySchemaVersion;
    if (sender !== this.id && incompatible) {
      // A current owner ignores stale callers. A current caller, however, must
      // stop before sending records to an older owner with a different schema.
      if (this.backend && (message.kind === 'probe' || message.kind === 'request')) return;
      this.failIncompatible();
      return;
    }
    if (message.kind === 'leader') {
      this.observeLeader(message.sender);
      return;
    }
    if (message.kind === 'probe') {
      if (this.backend&&!this.closing) this.markLeader();
      return;
    }
    if (message.kind === 'response') {
      if (message.recipient !== this.id) return;
      const waiting = this.pending.get(message.requestId);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      this.pending.delete(message.requestId);
      if (message.ok) waiting.resolve(message.value);
      else waiting.reject(new Error(message.error));
      return;
    }
    if (!this.backend || message.sender === this.id) return;
    if(this.closing){
      this.post({kind:'response',recipient:message.sender,requestId:message.requestId,ok:false,error:'sqlite_owner_closing'});
      return;
    }
    const request=this.dispatch(this.backend,message.input).then(
      (value) => this.post({ kind: 'response', recipient: message.sender, requestId: message.requestId, ok: true, value }),
      (cause) => this.post({
        kind: 'response',
        recipient: message.sender,
        requestId: message.requestId,
        ok: false,
        error: errorMessage(cause),
      }),
    );
    this.activeRemoteRequests.add(request);
    void request.then(()=>this.activeRemoteRequests.delete(request),()=>this.activeRemoteRequests.delete(request));
  }

  private failIncompatible(): void {
    if (this.incompatible) return;
    this.incompatible = true;
    this.lastLeaderAt = 0;
    const error = new Error('sqlite_owner_incompatible');
    for (const waiter of [...this.leaderWaiters]) waiter.reject(error);
    for (const [requestId, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
      this.pending.delete(requestId);
    }
    window.dispatchEvent(new CustomEvent('sensa-library-version-incompatible', {
      detail: {
        expectedProtocol: sqliteCoordinatorProtocolVersion,
        expectedSchemaVersion: sqliteLibrarySchemaVersion,
      },
    }));
    document.documentElement.dataset.libraryVersion = 'incompatible';
  }

  private markLeader(): void {
    this.observeLeader(this.id);
    this.post({ kind: 'leader', sender: this.id });
  }

  private observeLeader(id:string):void{
    if(this.leaderId&&this.leaderId!==id){
      for(const [requestId,waiting]of this.pending){
        clearTimeout(waiting.timer);this.pending.delete(requestId);
        waiting.reject(new Error('sqlite_owner_changed'));
      }
    }
    this.leaderId=id;this.lastLeaderAt=Date.now();
    for(const waiter of this.leaderWaiters)waiter.resolve();
  }

  private post(message: CoordinatorPayload): void {
    this.channel.postMessage({
      ...message,
      protocol: sqliteCoordinatorProtocolVersion,
      schemaVersion: sqliteLibrarySchemaVersion,
    } satisfies CoordinatorMessage);
  }

  private dispatch(backend: CoordinatedSqliteBackend, input: SqliteWorkerInput): Promise<unknown> {
    switch (input.kind) {
      case 'initialize': return backend.initialize();
      case 'get': return backend.get(input.table, input.key);
      case 'entries': return backend.entries(input.table);
      case 'entriesPage':return backend.entriesPage(input.table,input.afterKey,input.limit);
      case 'existingRecordKeys':return backend.existingRecordKeys(input.table,input.keys);
      case 'packageCacheProjection':return backend.packageCacheProjection(input.query);
      case 'meaningLookup':return backend.lookupMeanings(input.query);
      case 'worldBrowse':return backend.worldBrowse(input.query);
      case 'worldSceneMeaning':return backend.worldSceneMeaning(input.sceneId);
      case 'registrySelection':return backend.registrySelection(input.query);
      case 'learningSemanticMemory':return backend.learningSemanticMemory(input.targetId);
      case 'worldLearningChoices':return backend.worldLearningChoices(input.query);
      case 'existingJourneyIdentities':return backend.existingJourneyIdentities(input.ids);
      case 'changesSince': return backend.changesSince(input.contentRevision, input.tables);
      case 'hasChangesSince':return backend.hasChangesSince(input.contentRevision,input.tables);
      case 'syncBaseEntries': return backend.syncBaseEntries(input.keys);
      case 'count': return backend.count(input.table);
      case 'estimateRecordBytes': return backend.estimateRecordBytes(input.tables);
      case 'homeLearningProjection': return backend.homeLearningProjection(input.languageRouteId,input.clock);
      case 'runtimeLearningCandidates':return backend.runtimeLearningCandidates(input.query);
      case 'studyScopeMember':return backend.studyScopeMember(input.scopeRevisionId,input.targetId);
      case 'latestLearningActionAt':return backend.latestLearningActionAt(input.runId);
      case 'learningHistoryPage':return backend.learningHistoryPage(input.query);
      case 'learningManagementSummary':return backend.learningManagementSummary(input.query);
      case 'countIntroducedLearningTargets': return backend.countIntroducedLearningTargets(
        input.languageRouteId,
        input.startedAfter,
        input.startedBefore,
      );
      case 'learningRunIdsForTarget': return backend.learningRunIdsForTarget(input.targetId, input.openOnly);
      case 'openLearningRunTargets': return backend.openLearningRunTargets();
      case 'countContentAttemptsSince': return backend.countContentAttemptsSince(input.taskId, input.createdAfter);
      case 'learningTargetIdsForBookUpgrade': return backend.learningTargetIdsForBookUpgrade(
        input.languageRouteId,
        input.targetLanguageTag,
        input.supportLanguageTag,
        input.bookId,
        input.nextBookVersionId,
      );
      case 'isMediaReferenced': return backend.isMediaReferenced(input.mediaId);
      case 'portableMedia': return backend.portableMedia(input.sha256);
      case 'portableMediaDiagnostics': return backend.portableMediaDiagnostics();
      case 'commit': return backend.commit(input.mutation);
      case 'diagnostics': return backend.diagnostics({verifyIntegrity:input.verifyIntegrity});
    }
  }
}
