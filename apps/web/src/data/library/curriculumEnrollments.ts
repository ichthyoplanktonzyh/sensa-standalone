import {
  sensaFormalPinnedLanguageContextSchema,
  type SensaFormalPinnedLanguageContext,
} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {z} from 'zod';
import {directLearningSourceSchema,resolveDirectLearningSourceSnapshot,type DirectLearningSource} from '../../learning/system/directLearningSource';
import {packageInstallationSchema} from './packageRecords';
import {bookPlanSchema} from './bookPlans';

const timestamp=z.string().datetime({offset:true});
const bookSourceSchema=z.object({
 kind:z.literal('published_book'),
 publisherNamespace:z.string().min(1).max(200),
 bookId:z.string().uuid(),
 bookVersionId:z.string().uuid(),
 bookVersionNumber:z.number().int().positive(),
 title:z.string().min(1).optional(),
 contentReleaseId:z.string().uuid(),
 publicationArchiveSha256:z.string().regex(/^[a-f0-9]{64}$/u),
 memberCount:z.number().int().positive(),
}).strict();
const packageSourceSchema=z.object({
 kind:z.literal('portable_package'),
 packageId:z.string().uuid(),
 packageVersion:z.number().int().positive(),
 packageKey:z.string().min(1).max(2000),
}).strict();
const directSourceSchema=z.object({kind:z.literal('stable_sense'),selection:directLearningSourceSchema}).strict();
const sourceIdentity=(source:z.infer<typeof bookSourceSchema>|z.infer<typeof packageSourceSchema>|z.infer<typeof directSourceSchema>)=>source.kind==='published_book'
 ?`published_book:${source.publisherNamespace}:${source.bookId}`
 :source.kind==='portable_package'?`portable_package:${source.packageId}`
 :`stable_sense:${source.selection.reference.senseVersionId}:${source.selection.reference.bindingVersionId}`;

export const curriculumEnrollmentSchema=z.object({
 format:z.literal('sensa-curriculum-enrollment-v1'),
 id:z.string().uuid(),
 revision:z.number().int().positive(),
 learnerUserId:z.string().uuid(),
 languageContext:sensaFormalPinnedLanguageContextSchema,
 source:z.discriminatedUnion('kind',[bookSourceSchema,packageSourceSchema,directSourceSchema]),
 status:z.enum(['active','superseded']),
 bookPlan:bookPlanSchema.optional(),
 createdByOperationId:z.string().uuid(),
 createdAt:timestamp,
 updatedAt:timestamp,
}).strict().superRefine((value,context)=>{
 const expected=stableUuid(`local-curriculum-enrollment:${value.learnerUserId}:${value.languageContext.languageRouteId}:${sourceIdentity(value.source)}`);
 if(value.id!==expected)context.addIssue({code:'custom',path:['id'],message:'Curriculum Enrollment identity is inconsistent'});
 if(Date.parse(value.updatedAt)<Date.parse(value.createdAt))context.addIssue({code:'custom',path:['updatedAt'],message:'Curriculum Enrollment time moved backwards'});
 if(value.bookPlan&&(value.source.kind!=='published_book'||value.bookPlan.range.bookId!==value.source.bookId||value.bookPlan.range.bookVersionId!==value.source.bookVersionId||value.bookPlan.range.archiveSha256!==value.source.publicationArchiveSha256||value.bookPlan.range.memberCount!==value.source.memberCount))context.addIssue({code:'custom',path:['bookPlan'],message:'Book Plan differs from its fixed source'});
});

export type LocalCurriculumEnrollment=z.infer<typeof curriculumEnrollmentSchema>;
export type CurriculumEnrollmentSource=LocalCurriculumEnrollment['source'];

export const curriculumEnrollmentId=(
 learnerUserId:string,
 languageRouteId:string,
 source:CurriculumEnrollmentSource,
):string=>stableUuid(`local-curriculum-enrollment:${learnerUserId}:${languageRouteId}:${sourceIdentity(source)}`);

export const enrollmentMatchesContext=(
 enrollment:LocalCurriculumEnrollment,
 context:SensaFormalPinnedLanguageContext,
):boolean=>enrollment.status==='active'
 &&enrollment.languageContext.languageRouteId===context.languageRouteId
 &&enrollment.languageContext.targetLanguageTag===context.targetLanguageTag
 &&enrollment.languageContext.supportLanguageTag===context.supportLanguageTag;

/** One active Book per Route; maintenance/paused sources retain their facts. */
export function* assertOneActiveBookSteps(enrollments:Iterable<LocalCurriculumEnrollment>):Generator<void,void>{
 const routes=new Set<string>();
 for(const enrollment of enrollments){
  if(enrollment.status==='active'&&enrollment.source.kind==='published_book'&&(enrollment.bookPlan?.mode??'active')==='active'){
   if(routes.has(enrollment.languageContext.languageRouteId))throw new Error('localFlow.resourceInvalid');
   routes.add(enrollment.languageContext.languageRouteId);
  }
  yield;
 }
}
export function assertOneActiveBook(enrollments:Iterable<LocalCurriculumEnrollment>):void{for(const _step of assertOneActiveBookSteps(enrollments)){/* synchronous live admission */}}

/** Public bytes are recoverable cache; the accepted source remains a learner fact. */
export function assertDirectEnrollmentSource(selection:DirectLearningSource,read:Parameters<typeof resolveDirectLearningSourceSnapshot>[0]):void{
 const source=directLearningSourceSchema.parse(selection),origin=source.reference.origin;
 if(origin.kind==='published_package'&&!read('packageCache',origin.packageKey)){
  const installation=packageInstallationSchema.parse(read('packageInstallations',origin.packageKey));
  if(installation.key!==origin.packageKey||installation.artifact.packageDigest!==origin.packageDigest
    ||installation.artifact.digest!==source.publishedContent!.archiveDigest||installation.artifact.targetLanguage!==source.targetLanguageTag
    ||installation.artifact.supportLanguage!==source.publishedContent!.supportLanguageTag)throw new Error('direct_learning_source_changed');
  return;
 }
 resolveDirectLearningSourceSnapshot(read,source.reference,source.sourceDigest);
}
