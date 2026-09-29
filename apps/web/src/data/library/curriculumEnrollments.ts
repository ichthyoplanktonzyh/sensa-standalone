import {
  sensaFormalPinnedLanguageContextSchema,
  type SensaFormalPinnedLanguageContext,
} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {z} from 'zod';

const timestamp=z.string().datetime({offset:true});
const bookSourceSchema=z.object({
 kind:z.literal('published_book'),
 publisherNamespace:z.string().min(1).max(200),
 bookId:z.string().uuid(),
 bookVersionId:z.string().uuid(),
 bookVersionNumber:z.number().int().positive(),
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

export const curriculumEnrollmentSchema=z.object({
 format:z.literal('sensa-curriculum-enrollment-v1'),
 id:z.string().uuid(),
 revision:z.number().int().positive(),
 learnerUserId:z.string().uuid(),
 languageContext:sensaFormalPinnedLanguageContextSchema,
 source:z.discriminatedUnion('kind',[bookSourceSchema,packageSourceSchema]),
 status:z.enum(['active','superseded']),
 createdByOperationId:z.string().uuid(),
 createdAt:timestamp,
 updatedAt:timestamp,
}).strict().superRefine((value,context)=>{
 const sourceIdentity=value.source.kind==='published_book'
  ?`published_book:${value.source.publisherNamespace}:${value.source.bookId}`
  :`portable_package:${value.source.packageId}`;
 const expected=stableUuid(`local-curriculum-enrollment:${value.learnerUserId}:${value.languageContext.languageRouteId}:${sourceIdentity}`);
 if(value.id!==expected)context.addIssue({code:'custom',path:['id'],message:'Curriculum Enrollment identity is inconsistent'});
 if(Date.parse(value.updatedAt)<Date.parse(value.createdAt))context.addIssue({code:'custom',path:['updatedAt'],message:'Curriculum Enrollment time moved backwards'});
});

export type LocalCurriculumEnrollment=z.infer<typeof curriculumEnrollmentSchema>;
export type CurriculumEnrollmentSource=LocalCurriculumEnrollment['source'];

export const curriculumEnrollmentId=(
 learnerUserId:string,
 languageRouteId:string,
 source:CurriculumEnrollmentSource,
):string=>stableUuid(`local-curriculum-enrollment:${learnerUserId}:${languageRouteId}:${source.kind==='published_book'
 ?`published_book:${source.publisherNamespace}:${source.bookId}`
 :`portable_package:${source.packageId}`}`);

export const enrollmentMatchesContext=(
 enrollment:LocalCurriculumEnrollment,
 context:SensaFormalPinnedLanguageContext,
):boolean=>enrollment.status==='active'
 &&enrollment.languageContext.languageRouteId===context.languageRouteId
 &&enrollment.languageContext.targetLanguageTag===context.targetLanguageTag
 &&enrollment.languageContext.supportLanguageTag===context.supportLanguageTag;
