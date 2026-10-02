import type {SqliteRecordAdapter} from './sqliteAdapter';
import type {HomeLearningStorageProjection,PortableMediaBlob,PortableMediaStorageDiagnostics,SqliteLibraryTable,SqliteMutation,SqliteRecordChange,SqliteSyncBaseEntry,SqliteStorageDiagnostics} from './sqliteProtocol';
import {sqliteLibrarySchemaVersion} from './sqliteProtocol';
import {decodeBackupValue} from './backupCodec';
import type {PackageCacheProjectionQuery,PackageCacheProjectionResult} from './packageCacheProjection';
import {createHomeLearningStorageProjection} from './homeLearningRecords';
import type {LocalLearningRun,LocalLearningTarget} from '../../learning/runtime/localProtocol';

/** Test/non-browser Adapter. Production never selects this path. */
export class MemoryRecordAdapter implements SqliteRecordAdapter {
  async existingRecordKeys(table:SqliteLibraryTable,keys:readonly string[]):Promise<string[]>{
    return [...new Set(keys)].filter(key=>this.records.has(`${table}\u0000${key}`)).sort();
  }
  async packageCacheProjection<Query extends PackageCacheProjectionQuery>(query:Query):Promise<PackageCacheProjectionResult<Query>>{
    const {createPackageCacheSummary,isPackageCacheProjectionSource}=await import('./packageCacheProjection');
    const values=(await this.entries('packageCache')).map(row=>
      decodeBackupValue(JSON.parse(row.encodedValue))).filter(isPackageCacheProjectionSource);
    if(query.kind==='route_counts'){
      const counts=new Map<string,{targetLanguage:string;supportLanguage:string;packageCount:number}>();
      for(const {content} of values){
        const key=JSON.stringify([content.targetLanguage,content.supportLanguage]);
        const row=counts.get(key)??{targetLanguage:content.targetLanguage,supportLanguage:content.supportLanguage,packageCount:0};
        row.packageCount++;counts.set(key,row);
      }
      return [...counts.values()].sort((left,right)=>left.targetLanguage.localeCompare(right.targetLanguage)||left.supportLanguage.localeCompare(right.supportLanguage)) as PackageCacheProjectionResult<Query>;
    }
    return (query.kind==='identities'
      ?values.map(value=>({key:value.key,digest:value.digest}))
      :values.filter(value=>query.packageId===undefined||value.portableOrigin.manifest.metadata.packageId===query.packageId).map(createPackageCacheSummary)) as PackageCacheProjectionResult<Query>;
  }
  private records = new Map<string, string>();
  private changes = new Map<string, SqliteRecordChange>();
  private syncBase = new Map<string, SqliteSyncBaseEntry>();
  private portableMediaBlobs=new Map<string,PortableMediaBlob>();
  private portableMediaReferences=new Map<string,string>();

  async get(table: SqliteLibraryTable, key: string): Promise<string | null> {
    return this.records.get(`${table}\u0000${key}`) ?? null;
  }

  async entries(table: SqliteLibraryTable) {
    const prefix = `${table}\u0000`;
    return [...this.records]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, encodedValue]) => ({ key: key.slice(prefix.length), encodedValue }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async changesSince(contentRevision: number, tables: readonly SqliteLibraryTable[]): Promise<SqliteRecordChange[]> {
    const selected = new Set(tables);
    return [...this.changes.values()]
      .filter((change) => change.contentRevision > contentRevision && selected.has(change.table))
      .sort((left, right) => left.contentRevision - right.contentRevision
        || left.table.localeCompare(right.table)
        || left.key.localeCompare(right.key))
      .map((change) => ({ ...change }));
  }

  async syncBaseEntries(keys?: readonly { table: SqliteLibraryTable; key: string }[]): Promise<SqliteSyncBaseEntry[]> {
    const selected = keys ? new Set(keys.map(({ table, key }) => `${table}\u0000${key}`)) : undefined;
    return [...this.syncBase]
      .filter(([id]) => !selected || selected.has(id))
      .map(([, entry]) => ({ ...entry, blockRefs: [...entry.blockRefs] }))
      .sort((left, right) => left.table.localeCompare(right.table) || left.key.localeCompare(right.key));
  }

  async count(table: SqliteLibraryTable): Promise<number> {
    const prefix = `${table}\u0000`;
    let count = 0;
    for (const key of this.records.keys()) if (key.startsWith(prefix)) count++;
    return count;
  }

  async estimateRecordBytes(tables: readonly SqliteLibraryTable[]): Promise<number> {
    const selected=new Set(tables);
    const encoder=new TextEncoder();
    let bytes=0;
    for(const [id,encodedValue] of this.records){
      const separator=id.indexOf('\u0000');
      if(separator<0||!selected.has(id.slice(0,separator) as SqliteLibraryTable))continue;
      bytes+=encoder.encode(id.slice(separator+1)).byteLength+encoder.encode(encodedValue).byteLength+16;
    }
    return bytes;
  }

  async homeLearningProjection(languageRouteId: string): Promise<HomeLearningStorageProjection> {
    const decode = <T>(encoded: string | undefined): T | undefined => encoded === undefined
      ? undefined
      : decodeBackupValue(JSON.parse(encoded)) as T;
    const targets = (await this.entries('learningTargets'))
      .map((row) => decode<LocalLearningTarget>(row.encodedValue)!);
    const availablePackageKeys = (await this.entries('packageCache')).map((row) => row.key);
    const activeId = decode<string>(this.records.get('meta\u0000learning-active'));
    return createHomeLearningStorageProjection({
      targets,
      availablePackageKeys,
      activeRun: activeId
        ? decode<LocalLearningRun>(this.records.get(`learningRuns\u0000${activeId}`)) ?? null
        : null,
      studyPlans: decode(this.records.get('settings\u0000language-route-study-plans')) ?? {},
      languageRouteId,
    });
  }

  async learningRunIdsForTarget(targetId: string, openOnly: boolean): Promise<string[]> {
    return (await this.entries('learningRuns'))
      .map((row) => ({ key: row.key, run: decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningRun }))
      .filter(({ run }) => run.targetIds.includes(targetId) && (!openOnly || !run.completedAt))
      .map(({ key }) => key)
      .sort();
  }

  async countIntroducedLearningTargets(
    languageRouteId: string,
    startedAfter: string,
    startedBefore: string,
  ): Promise<number> {
    return (await this.entries('learningTargets'))
      .map((row) => decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningTarget)
      .filter((target) => target.introducedLanguageRouteId === languageRouteId
        && target.startedAt !== null
        && target.startedAt >= startedAfter
        && target.startedAt < startedBefore)
      .length;
  }

  async openLearningRunTargets(): Promise<Array<{ runId: string; targetId: string }>> {
    return (await this.entries('learningRuns'))
      .map((row) => ({ key: row.key, run: decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningRun }))
      .filter(({ run }) => !run.completedAt)
      .flatMap(({ key, run }) => run.targetIds.map((targetId) => ({ runId: key, targetId })))
      .sort((left, right) => left.targetId.localeCompare(right.targetId) || left.runId.localeCompare(right.runId));
  }

  async countContentAttemptsSince(taskId: string, createdAfter: string): Promise<number> {
    return (await this.entries('contentAttempts'))
      .map((row) => decodeBackupValue(JSON.parse(row.encodedValue)) as { taskId: string; createdAt: string })
      .filter((attempt) => attempt.taskId === taskId && attempt.createdAt > createdAfter)
      .length;
  }

  async learningTargetIdsForBookUpgrade(
    languageRouteId: string,
    targetLanguageTag: string,
    supportLanguageTag: string,
    bookId: string,
    nextBookVersionId: string,
  ): Promise<string[]> {
    return (await this.entries('learningTargets'))
      .map((row) => ({ key: row.key, target: decodeBackupValue(JSON.parse(row.encodedValue)) as LocalLearningTarget }))
      .filter(({ target }) => target.curriculumMemberships.some((membership) => (
        membership.status !== 'superseded'
        && membership.sourceKind === 'sense_learning_package'
        && membership.languageContext.languageRouteId === languageRouteId
        && membership.languageContext.targetLanguageTag === targetLanguageTag
        && membership.languageContext.supportLanguageTag === supportLanguageTag
        && membership.provenance.bookId === bookId
        && membership.provenance.bookVersionId !== nextBookVersionId
      )))
      .map(({ key }) => key)
      .sort();
  }

  async isMediaReferenced(mediaId: string): Promise<boolean> {
    const meanings = await this.entries('semanticMeanings');
    if (meanings.some((row) => (
      decodeBackupValue(JSON.parse(row.encodedValue)) as {
        personalSemanticAnchorRevisions?: Array<{ personalMediaObjectId?: string | null }>;
      }
    ).personalSemanticAnchorRevisions?.some((revision) => revision.personalMediaObjectId === mediaId))) return true;
    const inbox = await this.entries('semanticInbox');
    return inbox.some((row) => (
      decodeBackupValue(JSON.parse(row.encodedValue)) as {
        payload?: { context?: { mediaReferenceIds?: string[] } | null };
      }
    ).payload?.context?.mediaReferenceIds?.includes(mediaId));
  }

  async portableMedia(sha256:string):Promise<PortableMediaBlob|null>{
    const blob=this.portableMediaBlobs.get(sha256);
    return blob?{...blob,bytes:new Uint8Array(blob.bytes)}:null;
  }

  async portableMediaDiagnostics():Promise<PortableMediaStorageDiagnostics>{
    return {
      blobCount:this.portableMediaBlobs.size,
      totalBytes:[...this.portableMediaBlobs.values()].reduce((total,blob)=>total+blob.sizeBytes,0),
      referenceCount:this.portableMediaReferences.size,
    };
  }

  async commit(mutation: SqliteMutation): Promise<void> {
    const next = new Map(this.records);
    const nextChanges = new Map(this.changes);
    const nextSyncBase = mutation.syncBaseReplacement === undefined
      ? new Map(this.syncBase)
      : new Map(mutation.syncBaseReplacement.map((entry) => [
        `${entry.table}\u0000${entry.key}`,
        { ...entry, blockRefs: [...entry.blockRefs] },
      ]));
    const nextPortableMedia=new Map([...this.portableMediaBlobs].map(([digest,blob])=>[
      digest,{...blob,bytes:new Uint8Array(blob.bytes)},
    ]));
    const nextPortableReferences=new Map(this.portableMediaReferences);
    const remember = (table: SqliteLibraryTable, key: string, encodedValue: string | null) => {
      if (mutation.contentRevision === undefined) return;
      nextChanges.set(`${table}\u0000${key}`, {
        table,
        key,
        encodedValue,
        contentRevision: mutation.contentRevision,
      });
    };
    for (const table of mutation.clears) {
      const prefix = `${table}\u0000`;
      for (const key of [...next.keys()]) if (key.startsWith(prefix)) {
        next.delete(key);
        remember(table, key.slice(prefix.length), null);
      }
      if(table==='packageCache')nextPortableReferences.clear();
    }
    for (const item of mutation.deletes) {
      next.delete(`${item.table}\u0000${item.key}`);
      remember(item.table, item.key, null);
      if(item.table==='packageCache'){
        const prefix=`${item.key}\u0000`;
        for(const key of nextPortableReferences.keys())if(key.startsWith(prefix))nextPortableReferences.delete(key);
      }
    }
    for(const portable of mutation.portablePackages??[]){
      const prefix=`${portable.packageKey}\u0000`;
      for(const key of nextPortableReferences.keys())if(key.startsWith(prefix))nextPortableReferences.delete(key);
      for(const media of portable.media){
        const existing=nextPortableMedia.get(media.sha256);
        if(existing&&existing.sizeBytes!==media.sizeBytes)throw new Error('portable_media_digest_collision');
        nextPortableMedia.set(media.sha256,{
          sha256:media.sha256,
          sizeBytes:media.sizeBytes,
          bytes:new Uint8Array(media.bytes),
        });
        nextPortableReferences.set(`${portable.packageKey}\u0000${media.mediaId}`,media.sha256);
      }
    }
    for (const item of mutation.puts) {
      next.set(`${item.table}\u0000${item.key}`, item.encodedValue);
      remember(item.table, item.key, item.encodedValue);
    }
    this.records = next;
    this.changes = nextChanges;
    this.syncBase = nextSyncBase;
    const referenced=new Set(nextPortableReferences.values());
    for(const digest of nextPortableMedia.keys())if(!referenced.has(digest))nextPortableMedia.delete(digest);
    this.portableMediaBlobs=nextPortableMedia;
    this.portableMediaReferences=nextPortableReferences;
  }

  async diagnostics(): Promise<SqliteStorageDiagnostics> {
    return {
      engine: "memory-adapter",
      persistence: "memory",
      sqliteVersion: "not-applicable",
      schemaVersion: sqliteLibrarySchemaVersion,
      journalMode: "not-applicable",
      synchronous: null,
      lockingMode: "not-applicable",
    };
  }
}
