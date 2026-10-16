import type {LibraryIdentity} from './store';
import type {SqliteLibraryTable} from './sqliteProtocol';
import type {LibrarySyncHead,LibrarySyncPullResult,LibrarySyncSnapshotPageResult} from '@sensa/contracts/sensa';

/** Count, body/proof bytes and reference work bound the same private batch.
 * Count every reference occurrence, not only distinct hashes. Two maximum-
 * reference rows still fit; denser manifests are split, never truncated. */
export const replicaCandidateAppendRecordLimit=512;
export const replicaCandidateAppendReferenceLimit=4096;

/** Completed read work only; never a validation or publication receipt. */
export type ReplicaCandidateProgress={phase:'publication-validation'|'publication-preparation'|'candidate-validation'|'restore-installation';completed:number};
export const replicaCandidateProgressPhase=(kind:ReplicaCandidateRequest['kind'])=>kind==='admitOwnPublication'?'publication-validation' as const:kind==='preparePublication'?'publication-preparation' as const:kind==='validate'||kind==='prepareRebase'?'candidate-validation' as const:undefined;
export type ReplicaCandidateProgressObserver=(progress:ReplicaCandidateProgress)=>void;
export const isReplicaCandidateProgress=(value:unknown):value is ReplicaCandidateProgress=>{
 const p=value as ReplicaCandidateProgress|undefined;
 return !!p&&['publication-validation','publication-preparation','candidate-validation','restore-installation'].includes(p.phase)&&Number.isSafeInteger(p.completed)&&p.completed>0;
};

export type ReplicaCandidateFence={owner:{subject:string;accountId:string};incarnation:string;localRevision:number;identity:LibraryIdentity};
export type InitialPublicationStats={records:number;logicalBytes:number;uniqueBlockPlainBytes:number;uniqueBlockStoredBytes:number;storedPayloadBytes:number;blocks:number;maximumPageBytes:number};
export type InitialPublicationPage={kind:'publicationPage';rows:import('@sensa/contracts/sensa').LibrarySyncManifest['rows'];blocks:ReplicaCandidateBlock[];next:{table:SqliteLibraryTable;key:string}|null;done:boolean;stats:InitialPublicationStats};
export type ReplicaCandidateBlock={hash:string;data:string};
export type ReplicaCandidateExpected={head:LibrarySyncHead;manifestRefs:string[];manifestBlocks:ReplicaCandidateBlock[]};
export type ReplicaCandidateRecord={table:SqliteLibraryTable;key:string;valueJson:string;blockRefs:string[]};
export type ReplicaCandidateValidation={id:string;identity:LibraryIdentity;head:LibrarySyncHead;tables:SqliteLibraryTable[];records:number;logicalBytes:number;storedBytes:number;receive?:import('./learningDeltaAdmission').DeltaReceiveEvidence};
/** Prepared against one unchanged, validated local checkpoint. No fact bodies
 * cross the Worker seam; the Worker owns and rechecks the actual mutation. */
export type ReplicaCandidateUpdate={id:string;baseRevision:number;localRevision:number;contentChanged:boolean;tables:SqliteLibraryTable[];records:Array<{table:SqliteLibraryTable;key:string}>;receive?:import('./learningDeltaAdmission').DeltaReceiveEvidence};
export type ReplicaCandidateRebaseFence={baseRevision:number;baseLocalRevision:number;signoutEpoch?:unknown;resolution?:import('./cloudSync').CloudSyncState['resolution']};
/** The full remote remains in SQLite; only one bounded merge component crosses RPC. */
export type ReplicaCandidateRebase=ReplicaCandidateUpdate&{kind:'dirty-rebase';baseLocalRevision:number;remoteRevision:number;conflicts:string[];conflict?:import('./cloudSync').CloudSyncConflict;upload:{puts:import('./replication/libraryReplica').LibraryReplicaEntry[];deletes:Array<Pick<import('./replication/libraryReplica').LibraryReplicaEntry,'table'|'key'>>}};
export type ReplicaCandidateRequest=
 |{kind:'beginPublication';fence:ReplicaCandidateFence}
 |{kind:'publicationPage';id:string;after:{table:SqliteLibraryTable;key:string}|null}
 |{kind:'publicationIndexPage';id:string;after:{table:SqliteLibraryTable;key:string}|null}
 |{kind:'publicationBlocks';id:string;hashes:string[]}
 |{kind:'validatePublication';id:string;confirmed?:boolean}
 |{kind:'admitOwnPublication';id:string;confirmed?:boolean}
 |{kind:'preparePublication';id:string}
 |{kind:'cancelPublicationPreparation';id:string}
 |{kind:'retirePublication';id:string}
 |{kind:'discardPublication';id:string}
 |{kind:'begin';fence:ReplicaCandidateFence;expected:ReplicaCandidateExpected}
 |{kind:'beginIndex';fence:ReplicaCandidateFence;head:LibrarySyncHead;baseRevision?:number;rebase?:ReplicaCandidateRebaseFence}
 |{kind:'seed';id:string}
 |{kind:'indexPage';id:string;page:LibrarySyncPullResult|LibrarySyncSnapshotPageResult}
 |{kind:'append';id:string;records:ReplicaCandidateRecord[];blocks:ReplicaCandidateBlock[]}
 |{kind:'prove';id:string;record:Pick<ReplicaCandidateRecord,'table'|'key'>;blocks:ReplicaCandidateBlock[]}
 |{kind:'reuse';id:string;baseRevision:number;keys:Array<Pick<ReplicaCandidateRecord,'table'|'key'>>}
 |{kind:'validate';id:string}
 |{kind:'prepareUpdate';id:string;baseRevision:number}
 |{kind:'prepareRebase';id:string}
 |{kind:'discard';id:string};
export type ReplicaCandidateResponse={kind:'begun';id:string;needsSeed?:boolean}|{kind:'seeded';done:boolean}|InitialPublicationPage|{kind:'publicationIndexPage';rows:InitialPublicationPage['rows'];next:InitialPublicationPage['next'];done:boolean;stats:InitialPublicationStats}|{kind:'publicationBlocks';blocks:ReplicaCandidateBlock[];deferred:string[]}|{kind:'publicationValidated';stats:InitialPublicationStats}|{kind:'indexed';needed:Array<Pick<ReplicaCandidateRecord,'table'|'key'>>}|{kind:'appended'|'proved'}|{kind:'reused';keys:Array<Pick<ReplicaCandidateRecord,'table'|'key'>>}|{kind:'validated';candidate:ReplicaCandidateValidation}|{kind:'updatePrepared';update:ReplicaCandidateUpdate|null}|{kind:'rebasePrepared';rebase:ReplicaCandidateRebase}|{kind:'discarded'}|{kind:'publicationRetired';done:boolean};

/** Large private bodies use ordinary rowid storage, with the same unique key
 * and parent ownership. The cache is disposable across physical connections. */
export const replicaCandidateRecordSchema=`
CREATE TABLE IF NOT EXISTS sensa_replica_candidate_records_v1(
 candidate_id TEXT NOT NULL,
 table_name TEXT NOT NULL,
 record_key TEXT NOT NULL CHECK(length(record_key) BETWEEN 1 AND 2000),
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 refs_json TEXT NOT NULL CHECK(json_valid(refs_json)),
 representation TEXT NOT NULL DEFAULT 'packed' CHECK(representation IN ('packed','opaque')),
 stored_value_bytes INTEGER GENERATED ALWAYS AS(length(CAST(value_json AS BLOB))) STORED,
 PRIMARY KEY(candidate_id,table_name,record_key),
 FOREIGN KEY(candidate_id) REFERENCES sensa_replica_candidates_v1(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sensa_replica_candidate_page_v1
 ON sensa_replica_candidate_records_v1(candidate_id,table_name,record_key,stored_value_bytes);`;

/** Private versioned cache, never a logical Library table or checkpoint fact.
 * Creating it does not change or migrate the learner's record representation. */
export const replicaCandidateSchema=`
CREATE TABLE IF NOT EXISTS sensa_replica_candidates_v1(
 id TEXT PRIMARY KEY NOT NULL,
 fence_json TEXT NOT NULL CHECK(json_valid(fence_json)),
 expected_json TEXT NOT NULL CHECK(json_valid(expected_json)),
 state TEXT NOT NULL CHECK(state IN ('filling','sealed','validated')),
 records INTEGER NOT NULL DEFAULT 0 CHECK(records>=0),
 logical_bytes INTEGER NOT NULL DEFAULT 0 CHECK(logical_bytes>=0),
 stored_bytes INTEGER NOT NULL DEFAULT 0 CHECK(stored_bytes>=0),
 identity_json TEXT CHECK(identity_json IS NULL OR json_valid(identity_json))
) WITHOUT ROWID;
${replicaCandidateRecordSchema}
CREATE TABLE IF NOT EXISTS sensa_replica_candidate_manifest_v1(
 candidate_id TEXT NOT NULL,
 table_name TEXT NOT NULL,
 record_key TEXT NOT NULL,
 refs_json TEXT NOT NULL CHECK(json_valid(refs_json)),
 PRIMARY KEY(candidate_id,table_name,record_key),
 FOREIGN KEY(candidate_id) REFERENCES sensa_replica_candidates_v1(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_replica_candidate_proofs_v1(
 candidate_id TEXT NOT NULL,
 digest TEXT NOT NULL,
 plain_digest TEXT,
 plain_chars INTEGER,
 PRIMARY KEY(candidate_id,digest),
 FOREIGN KEY(candidate_id) REFERENCES sensa_replica_candidates_v1(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_replica_candidate_epochs_v1(
 candidate_id TEXT PRIMARY KEY NOT NULL,
 epoch INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(candidate_id) REFERENCES sensa_replica_candidates_v1(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TRIGGER IF NOT EXISTS sensa_replica_candidate_epoch_begin_v1 AFTER INSERT ON sensa_replica_candidates_v1
 BEGIN INSERT INTO sensa_replica_candidate_epochs_v1(candidate_id) VALUES(NEW.id); END;
${['records','manifest','proofs'].flatMap(table=>['INSERT','UPDATE','DELETE'].map(action=>`
CREATE TRIGGER IF NOT EXISTS sensa_replica_candidate_epoch_${table}_${action.toLowerCase()}_v1
 AFTER ${action} ON sensa_replica_candidate_${table}_v1
 WHEN (SELECT state FROM sensa_replica_candidates_v1 WHERE id=${action==='DELETE'?'OLD':'NEW'}.candidate_id)<>'filling'
 BEGIN UPDATE sensa_replica_candidate_epochs_v1 SET epoch=epoch+1 WHERE candidate_id=${action==='DELETE'?'OLD':'NEW'}.candidate_id; END;`)).join('')}
CREATE TABLE IF NOT EXISTS sensa_replica_candidate_encoded_v1(
 candidate_id TEXT NOT NULL,owner_kind TEXT NOT NULL CHECK(owner_kind IN ('record','sync')),
 table_name TEXT NOT NULL,record_key TEXT NOT NULL,
 encoded_json TEXT NOT NULL,value_json TEXT NOT NULL,digests_json TEXT NOT NULL,
 PRIMARY KEY(candidate_id,owner_kind,table_name,record_key),
 FOREIGN KEY(candidate_id) REFERENCES sensa_replica_candidates_v1(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_replica_candidate_encoded_bodies_v1(
 candidate_id TEXT NOT NULL,digest TEXT NOT NULL,stored_json TEXT NOT NULL,existing_json TEXT,
 PRIMARY KEY(candidate_id,digest),
 FOREIGN KEY(candidate_id) REFERENCES sensa_replica_candidates_v1(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_replica_candidate_merge_edges_v1(
 candidate_id TEXT NOT NULL,token TEXT NOT NULL,table_name TEXT NOT NULL,record_key TEXT NOT NULL,
 PRIMARY KEY(candidate_id,token,table_name,record_key),
 FOREIGN KEY(candidate_id) REFERENCES sensa_replica_candidates_v1(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_replica_candidate_merge_owner_v1 ON sensa_replica_candidate_merge_edges_v1(candidate_id,table_name,record_key,token);
${['encoded','encoded_bodies','merge_edges'].flatMap(table=>['INSERT','UPDATE','DELETE'].map(action=>`
CREATE TRIGGER IF NOT EXISTS sensa_replica_candidate_epoch_${table}_${action.toLowerCase()}_v1
 AFTER ${action} ON sensa_replica_candidate_${table}_v1
 WHEN (SELECT state FROM sensa_replica_candidates_v1 WHERE id=${action==='DELETE'?'OLD':'NEW'}.candidate_id)<>'filling'
 BEGIN UPDATE sensa_replica_candidate_epochs_v1 SET epoch=epoch+1 WHERE candidate_id=${action==='DELETE'?'OLD':'NEW'}.candidate_id; END;`)).join('')}
`;
