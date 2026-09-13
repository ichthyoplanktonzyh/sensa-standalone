import type {
  LearningPolicyId,
  LearningReadinessView,
} from '../../learning/runtime/policyProfiles';

export type LearningSourceKind='book'|'direct'|'personal_semantic_world';

/** UI projection supplied by a real Learning Target; never a fixture lookup. */
export interface LearningTargetPresentation {
  targetId:string;
  expression:string;
  expressionTypeLabel:string;
  partOfSpeech:string;
  meaning:string;
  targetLanguageTag:string;
  familiarLanguageTag:string;
  example:string;
  sourceKind:LearningSourceKind;
  sourceLabel:string;
  runtimeSenseId:string|null;
  personalExperienceGrounding:Readonly<{
    scene:string;
    focus:string;
    featureLabels:readonly string[];
  }>|null;
  policy:LearningPolicyId;
  lightweightReadiness:LearningReadinessView;
}
