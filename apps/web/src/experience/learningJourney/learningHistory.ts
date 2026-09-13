export type LearningRecordKind=
  | 'initial_learning'
  | 'retention_review'
  | 'relearning';

/** Learner-facing projection of an already committed local Runtime event. */
export interface LearningRecordView {
  readonly recordId:string;
  readonly targetId:string;
  readonly meaning?:string;
  readonly expression:string;
  readonly languageTag:string;
  readonly occurredAt:string;
  readonly kind:LearningRecordKind;
  readonly label:string;
  readonly detail:string;
}
