import type {LocalLearningRun,LocalLearningTarget} from '../../data/library/learning';
import type {InstalledPackage} from '../../data/library/packages';
import {readLibrary} from '../../data/library/store';
import {readStudyPlans} from '../../data/library/studyPlans';

export interface HomeLearningProjection{
 readonly targets:readonly LocalLearningTarget[];
 readonly packages:readonly InstalledPackage[];
 readonly activeRun:LocalLearningRun|null;
 readonly dailyLimit:number|undefined;
}

/**
 * The home seam reads only the facts needed to present today's queue. Package
 * catalogs, history, personal preparation and learning events stay behind the
 * full workspace controller until the learner opens one of those surfaces.
 */
export const readHomeLearningProjection=(languageRouteId:string):Promise<HomeLearningProjection>=>readLibrary(async tx=>{
 const activeId=await tx.get<string>('meta','learning-active');
 const studyPlans=await readStudyPlans(tx);
 return {
  targets:await tx.all<LocalLearningTarget>('learningTargets'),
  packages:await tx.all<InstalledPackage>('packages'),
  activeRun:activeId?await tx.get<LocalLearningRun>('learningRuns',activeId)??null:null,
  dailyLimit:studyPlans[languageRouteId]?.dailyNewSenseLimit,
 };
});
