import type {
  AssessmentResource,
  BoundaryContrastAssessmentResource,
  MeaningToFormRecallAssessmentResource,
  NovelTransferAssessmentResource,
  RecognitionAssessmentResource,
} from './assessmentResources';
import { materializeAssessmentResource } from './assessmentResources';
import type { PrototypeIntroductionPackage } from './learningCatalog';
import type {
  ReviewAssessmentKind,
  ReviewAssessmentSpec,
  ReviewBoundaryContrastSpec,
  ReviewContextRecognitionSpec,
  ReviewMeaningToFormSpec,
  ReviewNovelTransferSpec,
} from '../review/types';

function toRecognitionReviewSpec(
  resource: RecognitionAssessmentResource,
): ReviewContextRecognitionSpec {
  return {
    id: `${resource.taskKey}.action-assessment`,
    taskKey: resource.taskKey,
    kind: resource.kind,
    focusDimension: '语境辨义',
    kickerL1: '长期复习 · 语境判断',
    titleL1: '这个意思还在吗？',
    instructionL1: resource.instructionL1,
    evidenceEligible: true,
    example: resource.example,
    contextLabelL1: resource.contextLabelL1,
    questionL1: resource.questionL1,
    options: resource.options.map((option) => ({
      id: option.id,
      labelL1: option.textL1,
      detailL1: option.detailL1,
      isCorrect: option.isCorrect,
      feedbackTitleL1: option.feedbackTitleL1,
      feedbackBodyL1: option.feedbackBodyL1,
    })),
  };
}

function toRecallReviewSpec(
  resource: MeaningToFormRecallAssessmentResource,
): ReviewMeaningToFormSpec {
  return {
    id: `${resource.taskKey}.action-assessment`,
    taskKey: resource.taskKey,
    kind: resource.kind,
    focusDimension: '词形提取',
    kickerL1: '长期复习 · 意思到表达',
    titleL1: '从这个意思想起英文',
    instructionL1: resource.instructionL1,
    evidenceEligible: true,
    cueL1: resource.cueL1,
    cueFeatureLabelsL1: resource.cueFeatureLabelsL1,
    primaryForm: resource.primaryForm,
    acceptedForms: resource.acceptedForms,
  };
}

function toTransferReviewSpec(
  resource: NovelTransferAssessmentResource,
): ReviewNovelTransferSpec {
  return {
    id: `${resource.taskKey}.action-assessment`,
    taskKey: resource.taskKey,
    kind: resource.kind,
    focusDimension: '新语境迁移',
    kickerL1: '长期复习 · 新语境迁移',
    titleL1: '换个场景，还能用上这个意思吗？',
    instructionL1: resource.instructionL1,
    evidenceEligible: true,
    scenario: resource.scenario,
  };
}

function toBoundaryReviewSpec(
  resource: BoundaryContrastAssessmentResource,
  content: PrototypeIntroductionPackage,
): ReviewBoundaryContrastSpec {
  return {
    id: `${resource.taskKey}.action-assessment`,
    taskKey: resource.taskKey,
    kind: resource.kind,
    focusDimension: '义项边界',
    kickerL1: '长期复习 · 边界对比',
    titleL1: '动作是同一件，视角是否一样？',
    instructionL1: resource.instructionL1,
    evidenceEligible: false,
    previewLabelL1: '当前学习包声明的真实混淆边界',
    currentSenseL1: `${content.lemma} · ${content.guideLabelL1}`,
    contrastSenseL1: resource.contrastSenseL1,
    relationLabelL1: resource.relationLabelL1,
    example: resource.example,
    questionL1: resource.questionL1,
    options: resource.options.map((option) => ({
      id: option.id,
      labelL1: option.textL1,
      detailL1: option.detailL1,
      isCorrect: option.isCorrect,
      feedbackTitleL1: option.feedbackTitleL1,
      feedbackBodyL1: option.feedbackBodyL1,
    })),
  };
}

function toReviewSpec(
  resource: AssessmentResource,
  content: PrototypeIntroductionPackage,
): ReviewAssessmentSpec {
  switch (resource.kind) {
    case 'context_recognition': return toRecognitionReviewSpec(resource);
    case 'meaning_to_form_recall': return toRecallReviewSpec(resource);
    case 'novel_context_transfer': return toTransferReviewSpec(resource);
    case 'boundary_contrast': return toBoundaryReviewSpec(resource, content);
  }
}

/**
 * Compatibility adapter for the Review presentation model. The concrete
 * resource is resolved once by the shared catalog seam; this function only
 * projects it into the Review card contract.
 */
export function buildPrototypeReviewAssessment(
  content: PrototypeIntroductionPackage,
  kind: ReviewAssessmentKind,
  taskKey: string | null | undefined,
): ReviewAssessmentSpec {
  const resource = materializeAssessmentResource({
    packageIdentity: {
      packageKey: content.packageKey,
      senseKey: content.senseKey,
    },
    content,
    taskKey,
    kind,
  });
  return toReviewSpec(resource, content);
}
