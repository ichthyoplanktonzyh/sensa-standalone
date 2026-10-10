import type {LearningHomeProjection} from '../../learning/system';

export type HomeLearningState='loading'|'resume'|'ready'|'review'|'empty'|'waiting'|'route_empty'|'idle';

export function homeLearningState(projection:LearningHomeProjection|null,ready:boolean):HomeLearningState{
 if(!ready||!projection)return 'loading';
 if(projection.activeRunId)return 'resume';
 if(projection.mixedReadyCount>0)return projection.readyInitialCount>0?'ready':'review';
 if(!projection.hasLibraryContent)return 'empty';
 if(projection.nextReviewAt)return 'waiting';
 return projection.routeTargetCount===0?'route_empty':'idle';
}
