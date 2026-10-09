import type {LibraryIdentity} from '../store';
import type {librarySyncTables} from '@sensa/contracts/sensa';

export type ReplicaEntry={table:typeof librarySyncTables[number];key:string;value:unknown;blocks?:string[]};
export type ReplicaMergeInput={
 base:ReplicaEntry[];
 local:ReplicaEntry[];
 remote:ReplicaEntry[];
};
export type ReplicaMergeResult={entries:ReplicaEntry[];conflicts:string[]};
export type ReplicaMergeSteps=Generator<unknown,ReplicaMergeResult>;
export type ReplicaRecordReference=Pick<ReplicaEntry,'table'|'key'>;

/**
 * Internal seam used by Personal Library replication. A domain owns every
 * policy decision for the entries it claims; the checkpoint coordinator only
 * transports the resulting opaque records.
 */
export type DomainReplicaModule={
 readonly namespace:string;
 owns(table:ReplicaEntry['table'],key:string):boolean;
 normalize?(entry:ReplicaEntry,identity:LibraryIdentity):ReplicaEntry;
 restore?(entry:ReplicaEntry,value:unknown,identity:LibraryIdentity):unknown;
 mergeSteps?(input:ReplicaMergeInput,ordinary:(input:ReplicaMergeInput)=>ReplicaMergeSteps):ReplicaMergeSteps;
 /** Records that must remain on the same side when this record conflicts. */
 conflictDependencies?(entry:ReplicaEntry,decodedValue:unknown):readonly ReplicaRecordReference[];
 /** Preserve domain-owned audit records and uncontested additions after the
  * learner has explicitly selected a complete conflicting branch. */
 afterConflictChoice?(selected:ReplicaEntry[],merged:ReplicaEntry[],context:{base:ReplicaEntry[];conflicts:readonly string[];local:ReplicaEntry[];remote:ReplicaEntry[];decision:{id:string;createdAt:string}}):ReplicaEntry[];
 assertDelete?(entry:ReplicaEntry):void;
};
