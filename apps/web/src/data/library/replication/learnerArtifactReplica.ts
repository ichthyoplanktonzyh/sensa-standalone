import type {DomainReplicaModule} from './domainReplica';

/** Learner-owned media and annotations may be referenced by more than one product domain. */
export const learnerArtifactReplica:DomainReplicaModule={
 namespace:'learner-artifacts',
 owns:(table)=>table==='annotations'||table==='media',
};

