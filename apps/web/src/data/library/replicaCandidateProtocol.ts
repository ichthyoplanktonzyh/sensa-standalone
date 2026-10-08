import type {LibraryIdentity} from './store';
import type {SqliteLibraryTable} from './sqliteProtocol';
import type {LibrarySyncHead} from '@sensa/contracts/sensa';

export type ReplicaCandidateFence={owner:{subject:string;accountId:string};incarnation:string;localRevision:number;identity:LibraryIdentity};
export type ReplicaCandidateExpected={libraryId:string;learnerId:string;records:number;head:LibrarySyncHead};
export type ReplicaCandidateRecord={table:SqliteLibraryTable;key:string;valueJson:string;blockRefs:string[]};
export type ReplicaCandidateValidation={id:string;identity:LibraryIdentity;records:number;logicalBytes:number;storedBytes:number};
export type ReplicaCandidateRequest=
 |{kind:'begin';fence:ReplicaCandidateFence;expected:ReplicaCandidateExpected}
 |{kind:'append';id:string;records:ReplicaCandidateRecord[]}
 |{kind:'validate';id:string}
 |{kind:'discard';id:string};
export type ReplicaCandidateResponse={kind:'begun';id:string}|{kind:'appended'}|{kind:'validated';candidate:ReplicaCandidateValidation}|{kind:'discarded'};

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
CREATE TABLE IF NOT EXISTS sensa_replica_candidate_records_v1(
 candidate_id TEXT NOT NULL,
 table_name TEXT NOT NULL,
 record_key TEXT NOT NULL CHECK(length(record_key) BETWEEN 1 AND 2000),
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 refs_json TEXT NOT NULL CHECK(json_valid(refs_json)),
 PRIMARY KEY(candidate_id,table_name,record_key),
 FOREIGN KEY(candidate_id) REFERENCES sensa_replica_candidates_v1(id) ON DELETE CASCADE
) WITHOUT ROWID;
`;
