import type {LocalLearningTarget} from './localProtocol';

export const retentionReplayFields=['memory','memoryRevision','startedAt','completedAt','relearnAt','relearningState'] as const;
export type LocalRetentionBaseline=Pick<LocalLearningTarget,typeof retentionReplayFields[number]>;
/** Exact causal input for a Run, including same-revision Relearning changes. */
export function retentionBaseline(target:LocalLearningTarget):LocalRetentionBaseline{
 return structuredClone(Object.fromEntries(retentionReplayFields.map(field=>[field,target[field]]))) as LocalRetentionBaseline;
}
export const initialRetentionBaseline=():LocalRetentionBaseline=>({memory:null,memoryRevision:0,startedAt:null,completedAt:null,relearnAt:null,relearningState:null});
