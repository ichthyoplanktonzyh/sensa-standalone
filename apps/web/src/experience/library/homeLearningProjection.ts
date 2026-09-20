import type {
 HomeLearningStorageProjection,
 HomeLearningTargetRecord,
} from '../../data/library/homeLearningRecords';
import {readHomeLearningRecords} from '../../data/library/store';

export interface HomeLearningProjection{
 readonly targets:readonly HomeLearningTargetRecord[];
 readonly availablePackageKeys:ReadonlySet<string>;
 readonly activeRun:HomeLearningStorageProjection['activeRun'];
 readonly dailyLimit:number|undefined;
}

/**
 * The home seam reads only the facts needed to present today's queue. Package
 * catalogs, history, personal preparation and learning events stay behind the
 * full workspace controller until the learner opens one of those surfaces.
 */
export const readHomeLearningProjection=async(languageRouteId:string):Promise<HomeLearningProjection>=>{
 const stored=await readHomeLearningRecords(languageRouteId);
 return {
  targets:stored.targets,
  availablePackageKeys:new Set(stored.availablePackageKeys),
  activeRun:stored.activeRun,
  dailyLimit:stored.dailyLimit,
 };
};
