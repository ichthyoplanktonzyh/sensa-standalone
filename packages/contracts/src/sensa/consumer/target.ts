import { z } from 'zod';
import { sensaLearningTargetSnapshotSchema, sensaRetentionTargetSnapshotSchema } from '../learningConnection.js';
const id=z.string().uuid();
const revision=z.string().regex(/^(0|[1-9][0-9]*)$/u);
export const catalogSourceSchema=z.object({kind:z.enum(['catalog','book','personal_alignment']),id:z.string().min(1),version:z.string().min(1)}).strict();
export const catalogTargetSchema=z.object({
  candidateId:id,senseId:id,senseVersionId:id,bindingId:id,bindingVersionId:id,
  expression:z.string().min(1),meaning:z.string().min(1),targetLanguageTag:z.string().min(1),
  familiarLanguageTag:z.string().min(1),learnerLocale:z.string().min(1),source:catalogSourceSchema,
  admission:z.enum(['available','reference_only','unsupported']),
}).strict();
export const targetViewSchema=z.object({
  candidate:catalogTargetSchema,
  learningTarget:sensaLearningTargetSnapshotSchema.nullable(),retentionTarget:sensaRetentionTargetSnapshotSchema.nullable(),
  membership:z.object({id,revision,status:z.literal('active'),provenances:z.array(catalogSourceSchema)}).strict().nullable(),
  declaredMastery:z.object({active:z.boolean(),revision}).strict(),
  plan:z.object({id,revision,purpose:z.literal('initial_learning'),readiness:z.enum(['preparing','ready','blocked']),
    reason:z.string().nullable(),retryAllowed:z.boolean(),materializationId:id.nullable(),policyId:z.literal('lightweight'),policyVersion:z.literal('v1')}).strict().nullable(),
  phase:z.enum(['new','acquiring','retaining','needs_relearning']),dueAt:z.string().datetime().nullable(),
}).strict();
const common={operationId:id,occurredAt:z.string().datetime({offset:true}),installationId:id,replicaId:id,dependsOn:z.array(id).max(50)};
export const targetOperationSchema=z.discriminatedUnion('kind',[
 z.object({...common,kind:z.literal('learning.cancel_preparation'),payload:z.object({learningTargetId:id,expectedPlanRevision:revision}).strict()}).strict(),
  z.object({...common,kind:z.literal('declared_mastery.set'),payload:z.object({retentionTargetId:id,expectedRevision:revision,active:z.boolean()}).strict()}).strict(),
  z.object({...common,kind:z.literal('curriculum.add_target'),payload:z.object({planId:id,expectedScopeRevision:revision,candidateId:id,source:catalogSourceSchema}).strict()}).strict(),
  z.object({...common,kind:z.literal('learning.retry_preparation'),payload:z.object({learningTargetId:id,expectedPlanRevision:revision}).strict()}).strict(),
]);
export type CatalogTarget=z.infer<typeof catalogTargetSchema>;
export type TargetView=z.infer<typeof targetViewSchema>;
export type TargetOperation=z.infer<typeof targetOperationSchema>;

export const personalLearningOperationSchema=z.object({...common,kind:z.literal('personal.add_to_learning'),payload:z.object({meaningId:id,expectedRevision:z.literal('1'),planId:id,expectedScopeRevision:revision}).strict()}).strict();
