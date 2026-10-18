import type {ContentProvisioningSource,ContentProvisioningTask} from '../../contentSupply/provisioning/contracts';
import {currentPlanningMembership,type SupplementalMembershipState} from './supplementalMemberships';
import type {LocalLearningTarget} from '../../learning/runtime/localProtocol';
import type {LibraryTransaction} from './store';

export class PreparationCovered extends Error {
 constructor(readonly membershipId:string){super('preparation_covered');this.name='PreparationCovered';}
}

/** Existing compatible material wins over a new source's ordinary Add intent.
 * This exact-target lookup never scans the learner's collection. */
export async function provisioningCoverage(tx:Pick<LibraryTransaction,'get'>,task:Pick<ContentProvisioningTask,'targetId'|'languageContext'>,source:ContentProvisioningSource){
 const target=await tx.get<LocalLearningTarget>('learningTargets',task.targetId);
 if(!target)return undefined;
 if(target.id!==task.targetId||target.identity.senseId!==source.reference.senseId||target.identity.expressionId!==source.reference.expressionId||target.targetLanguageTag!==source.targetLanguageTag)throw new Error('localFlow.invalidTarget');
 return currentPlanningMembership(tx,target,task.languageContext);
}

/** A saved coverage outcome is historical. Book updates can retire its member;
 * reads must then expose preparation, without rewriting history on a query. */
export async function projectProvisioningTask(tx:Pick<LibraryTransaction,'get'>,task:ContentProvisioningTask):Promise<ContentProvisioningTask>{
 const state=await tx.get<SupplementalMembershipState>('supplementalMembershipStates',task.curriculumMembershipId);
 task={...task,curriculumActive:state?.status!=='removed',curriculumRevision:state?.revision??0};
 if(task.status!=='covered')return task;
 const target=await tx.get<LocalLearningTarget>('learningTargets',task.targetId);
 const member=target&&await currentPlanningMembership(tx,target,task.languageContext);
 if(member)return {...task,coveredByMembershipId:member.id};
 const pending={...task,status:'waiting' as const,notice:''};delete pending.coveredByMembershipId;return pending;
}
