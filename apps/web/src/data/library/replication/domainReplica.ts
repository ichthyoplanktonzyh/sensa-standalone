import type {LibraryIdentity} from '../store';
import type {librarySyncTables} from '@sensa/contracts/sensa';

export type ReplicaEntry={table:typeof librarySyncTables[number];key:string;value:unknown;blocks?:string[]};
export type ReplicaMergeInput={
 base:ReplicaEntry[];
 local:ReplicaEntry[];
 remote:ReplicaEntry[];
};
export type ReplicaMergeResult={entries:ReplicaEntry[];conflicts:string[]};

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
 merge?(input:ReplicaMergeInput,ordinary:(input:ReplicaMergeInput)=>ReplicaMergeResult):ReplicaMergeResult;
 assertDelete?(entry:ReplicaEntry):void;
};
