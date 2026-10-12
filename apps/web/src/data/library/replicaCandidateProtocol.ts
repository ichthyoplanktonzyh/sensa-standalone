import type {LibraryIdentity} from './store';
import type {SqliteLibraryTable} from './sqliteProtocol';
import type {LibrarySyncHead} from '@sensa/contracts/sensa';

/** Count, body/proof bytes and reference work bound the same private batch.
 * Count every reference occurrence, not only distinct hashes. Two maximum-
 * reference rows still fit; denser manifests are split, never truncated. */
export const replicaCandidateAppendRecordLimit=512;
export const replicaCandidateAppendReferenceLimit=4096;

export type ReplicaCandidateFence={owner:{subject:string;accountId:string};incarnation:string;localRevision:number;identity:LibraryIdentity};
export type ReplicaCandidateBlock={hash:string;data:string};
export type ReplicaCandidateExpected={head:LibrarySyncHead;manifestBlocks:ReplicaCandidateBlock[]};
export type ReplicaCandidateRecord={table:SqliteLibraryTable;key:string;valueJson:string;blockRefs:string[]};
export type ReplicaCandidateValidation={id:string;identity:LibraryIdentity;head:LibrarySyncHead;tables:SqliteLibraryTable[];records:number;logicalBytes:number;storedBytes:number};
/** Prepared against one unchanged, validated local checkpoint. No fact bodies
 * cross the Worker seam; the Worker owns and rechecks the actual mutation. */
export type ReplicaCandidateUpdate={id:string;baseRevision:number;localRevision:number;contentChanged:boolean;tables:SqliteLibraryTable[];records:Array<{table:SqliteLibraryTable;key:string}>};
export type ReplicaCandidateRequest=
 |{kind:'begin';fence:ReplicaCandidateFence;expected:ReplicaCandidateExpected}
 |{kind:'append';id:string;records:ReplicaCandidateRecord[];blocks:ReplicaCandidateBlock[]}
 |{kind:'prove';id:string;record:Pick<ReplicaCandidateRecord,'table'|'key'>;blocks:ReplicaCandidateBlock[]}
 |{kind:'reuse';id:string;baseRevision:number;keys:Array<Pick<ReplicaCandidateRecord,'table'|'key'>>}
 |{kind:'validate';id:string}
 |{kind:'prepareUpdate';id:string;baseRevision:number}
 |{kind:'discard';id:string};
export type ReplicaCandidateResponse={kind:'begun';id:string}|{kind:'appended'|'proved'}|{kind:'reused';keys:Array<Pick<ReplicaCandidateRecord,'table'|'key'>>}|{kind:'validated';candidate:ReplicaCandidateValidation}|{kind:'updatePrepared';update:ReplicaCandidateUpdate|null}|{kind:'discarded'};

/** Large private bodies use ordinary rowid storage, with the same unique key
 * and parent ownership. The cache is disposable across physical connections. */
export const replicaCandidateRecordSchema=`
CREATE TABLE IF NOT EXISTS sensa_replica_candidate_records_v1(
 candidate_id TEXT NOT NULL,
 table_name TEXT NOT NULL,
 record_key TEXT NOT NULL CHECK(length(record_key) BETWEEN 1 AND 2000),
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 refs_json TEXT NOT NULL CHECK(json_valid(refs_json)),
 representation TEXT NOT NULL DEFAULT 'packed' CHECK(representation IN ('packed','opaque','shared')),
 wire_digest TEXT CHECK(wire_digest IS NULL OR length(wire_digest)=64),
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
CREATE TABLE IF NOT EXISTS sensa_replica_candidate_bodies_v1(
 candidate_id TEXT NOT NULL,digest TEXT NOT NULL CHECK(length(digest)=64),value_json TEXT NOT NULL,
 PRIMARY KEY(candidate_id,digest),
 FOREIGN KEY(candidate_id) REFERENCES sensa_replica_candidates_v1(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_replica_candidate_owners_v1(
 candidate_id TEXT NOT NULL,table_name TEXT NOT NULL,record_key TEXT NOT NULL,digest TEXT NOT NULL,
 PRIMARY KEY(candidate_id,table_name,record_key,digest),
 FOREIGN KEY(candidate_id,table_name,record_key) REFERENCES sensa_replica_candidate_records_v1(candidate_id,table_name,record_key) ON DELETE CASCADE,
 FOREIGN KEY(candidate_id,digest) REFERENCES sensa_replica_candidate_bodies_v1(candidate_id,digest) ON DELETE CASCADE
) WITHOUT ROWID;
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
`;
