import {stableUuid} from '@sensa/learning-kernel';
import {z} from 'zod';
import type {LocalCurriculumMembership,LocalLearningTarget,LocalLearningMaterialization} from '../../learning/runtime/localProtocol';
import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import type {LocalCurriculumEnrollment} from './curriculumEnrollments';
import type {PackageInstallation} from './packageRecords';

/** One Target can retain several independent Book or package admissions. */
export const publishedCurriculumSourceKey=(enrollmentId:string,packageKey:string,context:SensaFormalPinnedLanguageContext,bookArchiveSha256?:string)=>JSON.stringify([enrollmentId,packageKey,context.languageRouteRevision,...(bookArchiveSha256?[bookArchiveSha256]:[])]);
export const publishedCurriculumMembershipId=(targetId:string,context:SensaFormalPinnedLanguageContext,enrollmentId:string,packageKey:string,bookArchiveSha256?:string)=>
 stableUuid(`local-curriculum-membership:${targetId}:${context.languageRouteId}:sense_learning_package:${publishedCurriculumSourceKey(enrollmentId,packageKey,context,bookArchiveSha256)}`);

export function assertPublishedCurriculumSource(target:LocalLearningTarget,membership:LocalCurriculumMembership,enrollment:LocalCurriculumEnrollment,installation:PackageInstallation):void{
 const materialSource=membership.material.snapshot.provenance;
 if(typeof materialSource.curriculumMembershipId==='string'){
  const materializationOperationId=z.string().uuid().parse(materialSource.materializationOperationId);
  const supplement=materialSource.resourceSupplement as {operationId?:string}|undefined;
  const expectedMaterial=supplement?.operationId?stableUuid(`supplement-material:${z.string().uuid().parse(supplement.operationId)}`):stableUuid(`sensa-material:${target.identity.learnerUserId}:${installation.key}:${target.id}:${membership.id}:${materializationOperationId}`);
  if(materializationOperationId!==membership.createdByOperationId||materialSource.curriculumMembershipId!==membership.id||materialSource.curriculumEnrollmentId!==enrollment.id||materialSource.packageKey!==installation.key||materialSource.packageDigest!==installation.artifact.digest||materialSource.packageVersion!==String(installation.artifact.version)||materialSource.sourceReadyAt!==membership.createdAt||membership.material.snapshot.learningMaterializationId!==expectedMaterial)throw new Error('Published materialization has no matching source creation witness.');
 }
 if(membership.sourceKind!=='sense_learning_package')return;
 const source=membership.provenance;
 const expected=publishedCurriculumMembershipId(target.id,membership.languageContext,enrollment.id,installation.key,enrollment.source.kind==='published_book'?String(source.publicationArchiveSha256??''):undefined);
 // Existing witnesses are retained in place: adding another source must never
 // rewrite a previously pinned membership/Run just to rename its identifier.
 const witnessed=stableUuid(`local-curriculum-membership:${target.id}:${membership.languageContext.languageRouteId}:sense_learning_package:${installation.key}`);
 if(membership.id!==expected&&(membership.id!==witnessed||typeof materialSource.curriculumMembershipId==='string'))throw new Error('Published Curriculum membership identity is invalid.');
 if(membership.id===expected&&(materialSource.curriculumMembershipId!==membership.id||materialSource.curriculumEnrollmentId!==enrollment.id))throw new Error('Published Curriculum material has a different admitted source.');
 if(Date.parse(membership.createdAt)<Date.parse(enrollment.createdAt))throw new Error('Published Curriculum membership predates its source admission.');
 if(source.curriculumEnrollmentId!==enrollment.id||membership.packageKey!==installation.key||source.packageDigest!==installation.artifact.digest||source.packageVersion!==String(installation.artifact.version))throw new Error('Published Curriculum membership differs from its admitted artifact.');
 if(enrollment.source.kind==='portable_package'){
  if(enrollment.source.packageId!==installation.artifact.packageId)throw new Error('Published Curriculum package source is inconsistent.');
  return;
 }
 if(enrollment.source.kind!=='published_book'||source.kind!=='sense_learning_package'||source.bookId!==enrollment.source.bookId)throw new Error('Published Curriculum Book source is inconsistent.');
 if(membership.id===expected&&(materialSource.bookId!==source.bookId||materialSource.bookVersionId!==source.bookVersionId||materialSource.contentReleaseId!==source.contentReleaseId||materialSource.publicationArchiveSha256!==source.publicationArchiveSha256))throw new Error('Published Curriculum material differs from its Book source.');
 const reference=installation.artifact.bookMemberships?.find(member=>member.archiveSha256===source.publicationArchiveSha256);
 if(reference){
  if(reference.bookId!==source.bookId||reference.bookVersionId!==source.bookVersionId)throw new Error('Published Curriculum member has a different Book/version.');
 }else if(!source.publicationArchiveSha256||installation.artifact.bookArchiveSha256!==source.publicationArchiveSha256)throw new Error('Published Curriculum member is not in its admitted Book.');
}

/** Recover the exact admission witness, not the first source sharing its bytes. */
export function publishedMaterialMembership(target:LocalLearningTarget,material:LocalLearningMaterialization,context:SensaFormalPinnedLanguageContext):LocalCurriculumMembership|undefined{
 const provenance=material.snapshot.provenance;
 const member=target.curriculumMemberships.find(member=>member.packageKey===provenance.packageKey
  &&member.languageContext.languageRouteId===context.languageRouteId&&member.languageContext.targetLanguageTag===context.targetLanguageTag&&member.languageContext.supportLanguageTag===context.supportLanguageTag
  &&(typeof provenance.curriculumMembershipId==='string'?member.id===provenance.curriculumMembershipId:typeof member.material.snapshot.provenance.curriculumMembershipId!=='string'));
 if(!member)return undefined;
 if(typeof provenance.curriculumMembershipId==='string'){
  const fields=['curriculumMembershipId','curriculumEnrollmentId','packageKey','packageDigest','packageVersion','bookId','bookVersionId','contentReleaseId','publicationArchiveSha256','senseId','senseVersionId','expressionId','expressionVersionId','bindingId','bindingVersionId','materializationOperationId','sourceReadyAt'] as const;
  if(fields.some(field=>provenance[field]!==member.material.snapshot.provenance[field]))return undefined;
 }
 return member;
}
