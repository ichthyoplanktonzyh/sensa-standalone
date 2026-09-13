import type { SensaRuntimeLearningPackage, SensaRuntimeLearningRelease } from '@sensa/contracts/sensa';
import type { LearningPackage } from '../engine/types';

export interface RecognitionOption {
  id: string;
  textL1: string;
  detailL1?: string;
  isCorrect: boolean;
  feedbackTitleL1: string;
  feedbackBodyL1: string;
}

export interface RecallChoiceOption {
  id: string;
  textL2: string;
  isTarget: boolean;
}

export interface MeaningToFormRecallCardSpec {
  packageKey: string;
  cueL1: string;
  cueFeatureLabelsL1: string[];
  primaryForm: string;
  acceptedForms: string[];
  choiceOptions: RecallChoiceOption[];
  independentSuccessTitleL1: string;
  independentSuccessBodyL1: string;
  supportedSuccessTitleL1: string;
  supportedSuccessBodyL1: string;
  choiceSuccessTitleL1: string;
  choiceSuccessBodyL1: string;
  repairTitleL1: string;
  repairBodyL1: string;
}

export interface TransferScenarioSpec {
  id: string;
  exampleKey: string;
  sceneLabelL1: string;
  setupL2: string;
  setupL1: string;
  visualKind: string;
  visualAltL1: string;
  questionL1: string;
  options: Array<{
    id: string;
    labelL1: string;
    detailL1: string;
    isCorrect: boolean;
    feedbackTitleL1: string;
    feedbackBodyL1: string;
  }>;
  successTitleL1: string;
  successBodyL1: string;
  sourceObjectL1: string;
  targetObjectL1: string;
  invariantLabelsL1: string[];
}

export type ExperienceRendererVariant =
  | 'physical_threshold'
  | 'continuation_timeline'
  | 'receiver_transfer'
  | 'provider_transfer';

export type ExperienceStageClassName = 'physical' | 'process' | 'borrow' | 'lend';

export interface InteractionState {
  value: number;
  state: string;
  labelL1: string;
  feedbackL1: string;
}

export interface LearningExample {
  exampleKey: string;
  textL2: string;
  textL1: string;
  targetSurface: string;
  targetStart: number;
  targetEnd: number;
  audioUrl: string | null;
}

export interface LearningPronunciation {
  pronunciationKey: string;
  accentLocale: string;
  ipa: string;
  audioUrl: string | null;
}

export interface BoundaryContrast {
  taskKey: string;
  relationKey: string;
  contrastSenseL1: string;
  relationLabelL1: string;
  example: LearningExample;
  questionL1: string;
  options: RecognitionOption[];
}

interface ExperienceBase {
  renderKey: string;
  stageCaptionL1: string;
}

export interface TextExperience extends ExperienceBase {
  kind: 'text';
  sceneL1: string;
}

export interface InteractionExperience extends ExperienceBase {
  kind: 'interaction';
  rendererKey: 'state_change_v1' | 'sequence_order_v1' | 'figure_ground_v1';
  rendererVariant: ExperienceRendererVariant;
  instructionL1: string;
  controlLabelL1: string;
  minimum: number;
  maximum: number;
  step: number;
  labelsL1: string[];
  states: InteractionState[];
  fallbackTextSceneL1: string | null;
  presentation: {
    controlLabelL1: string;
    stageClassName: ExperienceStageClassName;
    statusLabelsL1: string[];
    objectLabelL1: string | null;
    projectLabelL1: string | null;
    supportLabelsL1: string[];
    viewpointLabelL1: string | null;
    ownerLabelL1: string | null;
    userLabelL1: string | null;
  };
}

export type LearningExperience = TextExperience | InteractionExperience;

export interface RuntimeLearningContent {
  packageKey: string;
  senseKey: string;
  lemma: string;
  syllables: string | null;
  ipa: string;
  accentLocale: string;
  pronunciations: LearningPronunciation[];
  partOfSpeech: string;
  guideLabelL1: string;
  definitionL2: string;
  l1Bridge: string;
  experience: LearningExperience;
  experienceSketch: { labelsL1: string[]; bodyL1: string };
  studyExample: LearningExample;
  recognitionAssessment: LearningExample & {
    contextLabelL1: string;
    instructionL1: string;
    questionL1: string;
    options: RecognitionOption[];
    successTitleL1: string;
    successBodyL1: string;
    featureLabelsL1: string[];
  };
  meaningToFormRecall: Omit<MeaningToFormRecallCardSpec, 'packageKey'>;
  novelTransfer: {
    instructionL1: string;
    scenarios: Array<TransferScenarioSpec & { revealExample: LearningExample }>;
  };
  boundaryContrast: BoundaryContrast | null;
  learningExamples: LearningExample[];
  supportTabs: Array<{
    id: 'usage';
    label: '搭配';
    patterns: Array<{
      canonicalPattern: string;
      commonCollocations: Array<{ text: string; exampleIndex: number }>;
      registerLabel: string | null;
      domainLabel: string | null;
      usageRestriction: string | null;
    }>;
  }>;
  practiceManifest?: NonNullable<SensaRuntimeLearningPackage['practiceManifest']>;
}

export interface RuntimeLearningPackage extends LearningPackage<RuntimeLearningContent> {
  content: RuntimeLearningContent;
}

/** Parsed, indexed view of one immutable learning release. */
export interface LearningCatalog {
  readonly release: SensaRuntimeLearningRelease;
  readonly packages: readonly RuntimeLearningPackage[];
  getPackage(packageId: string): RuntimeLearningPackage | null;
  getPackageBySense(senseId: string): RuntimeLearningPackage | null;
  resolveMediaUrl(mediaKey: string | null | undefined): string | null;
  resolvePronunciationAudioUrl(lemma: string, accentLocale?: string): string | null;
  resolveExampleAudioUrl(textL2: string, accentLocale?: string): string | null;
}
