import type {
  SensaContextImage,
  SensaExpressionType,
  SensaFormalPinnedLanguageContext,
  SensaSenseSemanticSpec,
} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {z} from 'zod';

/** Immutable Personal Semantic World reference pinned for one provisioning task. */
export interface PersonalMeaningLearningReference {
  personalMeaningId: string;
  personalMeaningRevisionId: string;
  personalMeaningAlignmentId: string;
  alignmentRevision: number;
  alignmentBasisReferenceId: string;
  meaningFocusId: string | null;
  senseId: string;
  senseVersionId: string;
  expressionId: string;
  expressionVersionId: string;
  bindingId: string;
  bindingVersionId: string;
}

/** Resolved, read-only handoff from Personal Semantic World to Content Supply. */
export interface PersonalMeaningLearningSource {
  sourceKind: 'personal_meaning_alignment';
  reference: PersonalMeaningLearningReference;
  targetLanguageTag: string;
  context: {
    text: string;
    images: SensaContextImage[];
    personalSemanticAnchorRevisionIds: string[];
  };
  expression: {
    spokenForm?: string;
    formParts?: { kind: 'fixed' | 'slot'; text: string; constraint?: string }[];
    surfaceForm: string;
    expressionType: SensaExpressionType;
    languageTag: string;
  };
  semanticSpec: SensaSenseSemanticSpec;
}

export const directProvisioningReferenceSchema=z.object({
  kind:z.literal('stable_sense'),enrollmentId:z.string().uuid(),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/u),
  senseId:z.string().uuid(),senseVersionId:z.string().uuid(),expressionId:z.string().uuid(),expressionVersionId:z.string().uuid(),bindingId:z.string().uuid(),bindingVersionId:z.string().uuid(),
}).strict();
export type DirectProvisioningReference=z.infer<typeof directProvisioningReferenceSchema>;
export type ContentProvisioningReference=PersonalMeaningLearningReference|DirectProvisioningReference;
export interface DirectProvisioningSource {
  sourceKind:'stable_sense';reference:DirectProvisioningReference;targetLanguageTag:string;
  expression:PersonalMeaningLearningSource['expression']&{acceptedForms?:string[]};semanticSpec:SensaSenseSemanticSpec;
}
export type ContentProvisioningSource=PersonalMeaningLearningSource|DirectProvisioningSource;
export const isDirectProvisioningReference=(reference:ContentProvisioningReference):reference is DirectProvisioningReference=>'kind'in reference&&reference.kind==='stable_sense';
export const provisioningTaskId=(reference:ContentProvisioningReference,routeId:string)=>isDirectProvisioningReference(reference)
  ?stableUuid(`sensa-direct-provisioning:${reference.enrollmentId}`)
  :stableUuid(`sensa-personal-learning:${personalLearningSourceKey(reference)}:${routeId}`);
export const provisioningMembershipId=(reference:ContentProvisioningReference,targetId:string,routeId:string)=>stableUuid(`local-curriculum-membership:${targetId}:${routeId}:${isDirectProvisioningReference(reference)?`stable_sense:${reference.enrollmentId}`:`personal_meaning_alignment:${reference.personalMeaningAlignmentId}`}`);

export type ContentProvisioningStatus =
  | 'waiting'
  | 'generating'
  | 'reviewing'
  | 'failed'
  | 'rejected'
  | 'stopped'
  | 'covered'
  | 'ready';

/** Learner-private Content Supply task. It is not a Curriculum or progress record. */
export interface ContentProvisioningTask<Reference extends ContentProvisioningReference=ContentProvisioningReference> {
  /** Read projection only, never persisted as Content Supply authority. */
  curriculumActive?:boolean;
  curriculumRevision?:number;
  replacing?: boolean;
  id: string;
  source: Reference;
  /** Another explicit entry already supplies this exact connection and Route. */
  coveredByMembershipId?:string;
  targetId: string;
  curriculumMembershipId: string;
  languageContext: SensaFormalPinnedLanguageContext;
  planRevision: string;
  useContext: boolean;
  /** Selected Context revisions; independent of the accepted semantic source. */
  contextPin?: string[];
  status: ContentProvisioningStatus;
  attemptId: string | null;
  leaseUntil: number;
  notice: string;
  createdAt: string;
}
export type PersonalContentProvisioningTask=ContentProvisioningTask<PersonalMeaningLearningReference>;
export const isPersonalProvisioningTask=(task:ContentProvisioningTask):task is PersonalContentProvisioningTask=>!isDirectProvisioningReference(task.source);
/** Coverage references an existing membership; it does not create the task's own. */
export const provisioningResultMembershipId=(task:ContentProvisioningTask):string=>task.status==='covered'&&task.coveredByMembershipId?task.coveredByMembershipId:task.curriculumMembershipId;
export const personalLearningContextMatches=(task:ContentProvisioningTask,source:PersonalMeaningLearningSource):boolean=>
  (task.contextPin??[]).join(':')===source.context.personalSemanticAnchorRevisionIds.join(':');

export const personalLearningSourceKey = (
  reference: PersonalMeaningLearningReference,
): string => `${reference.personalMeaningAlignmentId}:${reference.bindingVersionId}`;

export const personalLearningSourceRevision = (
  reference: PersonalMeaningLearningReference,
): string => [
  reference.personalMeaningRevisionId,
  reference.alignmentRevision,
  reference.senseVersionId,
  reference.bindingVersionId,
].join(':');
