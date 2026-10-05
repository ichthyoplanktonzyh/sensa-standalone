import type {ContentProvisioningSource,ContentProvisioningTask} from '../../contentSupply/provisioning/contracts';
import {localCurriculumMembershipForContext} from '../../learning/runtime/localCurriculum';
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
 if(target.id!==task.targetId||target.identity.senseId!==source.reference.senseId||target.identity.senseVersionId!==source.reference.senseVersionId
   ||target.identity.senseExpressionBindingId!==source.reference.bindingId||target.identity.bindingVersionId!==source.reference.bindingVersionId
   ||target.expression!==source.expression.surfaceForm||target.targetLanguageTag!==source.targetLanguageTag)throw new Error('localFlow.invalidTarget');
 return localCurriculumMembershipForContext(target,task.languageContext);
}

/** A saved coverage outcome is historical. Book updates can retire its member;
 * reads must then expose preparation, without rewriting history on a query. */
export async function projectProvisioningTask(tx:Pick<LibraryTransaction,'get'>,task:ContentProvisioningTask):Promise<ContentProvisioningTask>{
 if(task.status!=='covered')return task;
 const target=await tx.get<LocalLearningTarget>('learningTargets',task.targetId);
 const member=target&&localCurriculumMembershipForContext(target,task.languageContext);
 if(member)return {...task,coveredByMembershipId:member.id};
 const pending={...task,status:'waiting' as const,notice:''};delete pending.coveredByMembershipId;return pending;
}
