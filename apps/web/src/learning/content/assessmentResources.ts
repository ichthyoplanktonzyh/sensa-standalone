import type {
  SensaRuntimeLearningRelease,
  SensaRuntimeLearningPackage,
  SensaRuntimeSenseRelation,
} from '@sensa/contracts/sensa';
import type { LearningCapability } from '../engine/types';
import type {
  RuntimeLearningContent,
  LearningExample,
  MeaningToFormRecallCardSpec,
  RecognitionOption,
  TransferScenarioSpec,
} from './learningCatalog';
import type { ReviewAssessmentKind } from '../review/types';

/** The closed assessment vocabulary exposed by the installed Learning Package. */
export type AssessmentResourceKind = ReviewAssessmentKind;

export interface AssessmentPackageIdentity {
  packageKey: string;
  senseKey: string;
}

export interface AssessmentResourceRequest {
  /** Identity from the runtime Package selected by the current Action. */
  packageIdentity: AssessmentPackageIdentity;
  /** Presentation projection for the same Package; identity is checked against it. */
  content: RuntimeLearningContent;
  /** The immutable Assessment Task selected by the current Action. */
  taskKey: string | null | undefined;
  kind: AssessmentResourceKind;
  /** Optional scheduler capability; when supplied it must agree with kind. */
  capability?: LearningCapability;
}

interface AssessmentResourceBase {
  packageKey: string;
  senseKey: string;
  taskKey: string;
}

export interface RecognitionAssessmentResource extends AssessmentResourceBase {
  kind: 'context_recognition';
  example: LearningExample;
  contextLabelL1: string;
  instructionL1: string;
  questionL1: string;
  options: RecognitionOption[];
  successTitleL1: string;
  successBodyL1: string;
  featureLabelsL1: string[];
}

export type MeaningToFormRecallAssessmentResource =
  AssessmentResourceBase
  & { kind: 'meaning_to_form_recall' }
  & { instructionL1: string }
  & Omit<MeaningToFormRecallCardSpec, 'packageKey'>;

export interface NovelTransferAssessmentResource extends AssessmentResourceBase {
  kind: 'novel_context_transfer';
  instructionL1: string;
  scenario: TransferScenarioSpec & {
    revealExample: LearningExample;
  };
}

export interface BoundaryContrastAssessmentResource extends AssessmentResourceBase {
  kind: 'boundary_contrast';
  instructionL1: string;
  relationKey: string;
  contrastSenseL1: string;
  relationLabelL1: string;
  example: LearningExample;
  questionL1: string;
  options: RecognitionOption[];
}

export type AssessmentResource =
  | RecognitionAssessmentResource
  | MeaningToFormRecallAssessmentResource
  | NovelTransferAssessmentResource
  | BoundaryContrastAssessmentResource;

export function assessmentKindForCapability(
  capability: LearningCapability,
): AssessmentResourceKind {
  switch (capability) {
    case 'contextual_recognition': return 'context_recognition';
    case 'meaning_to_form_recall': return 'meaning_to_form_recall';
    case 'novel_context_transfer': return 'novel_context_transfer';
    case 'boundary_discrimination': return 'boundary_contrast';
  }
}

function assertTaskKey(taskKey: string | null | undefined): asserts taskKey is string {
  if (!taskKey) {
    throw new Error('An assessment Action must carry a non-null taskKey.');
  }
}

function requireInstalledPackage(
  request: AssessmentResourceRequest,
  installedRelease: SensaRuntimeLearningRelease,
): SensaRuntimeLearningPackage {
  const { packageIdentity, content } = request;
  if (
    content.packageKey !== packageIdentity.packageKey
    || content.senseKey !== packageIdentity.senseKey
  ) {
    throw new Error(
      `Assessment Package identity mismatch: ${packageIdentity.packageKey}/${packageIdentity.senseKey}`,
    );
  }
  const pkg = installedRelease.packages.find((candidate) =>
    candidate.identity.packageKey === packageIdentity.packageKey
    && candidate.identity.senseKey === packageIdentity.senseKey,
  );
  if (!pkg) {
    throw new Error(
      `Installed Learning Catalog has no Package ${packageIdentity.packageKey}/${packageIdentity.senseKey}.`,
    );
  }
  return pkg;
}

function mediaUrl(mediaKey: string | null | undefined, installedRelease: SensaRuntimeLearningRelease): string | null {
  if (!mediaKey) return null;
  const media = installedRelease.media.find((candidate) => candidate.mediaKey === mediaKey);
  if (!media || media.kind !== 'audio') return null;
  const digest = media.uri.startsWith('content://sha256/')
    ? media.uri.slice('content://sha256/'.length)
    : null;
  return digest ? `/golden-audio/${digest}.mp3` : null;
}

function projectExample(
  pkg: SensaRuntimeLearningPackage,
  exampleKey: string,
  installedRelease: SensaRuntimeLearningRelease,
): LearningExample {
  const example = pkg.examples.find((candidate) => candidate.exampleKey === exampleKey);
  if (!example) {
    throw new Error(`Package ${pkg.identity.packageKey} has no Example ${exampleKey}.`);
  }
  const audioRender = example.renders.find((render) => render.kind === 'static_audio');
  return {
    exampleKey: example.exampleKey,
    textL2: example.textL2,
    textL1: example.textL1,
    targetSurface: example.target.surface,
    targetStart: example.target.start,
    targetEnd: example.target.end,
    audioUrl: audioRender?.kind === 'static_audio'
      ? mediaUrl(audioRender.mediaKey, installedRelease)
      : null,
  };
}

function recognitionOptions(
  task: SensaRuntimeLearningPackage['assessmentInventory']['contextualRecognition'][number],
): RecognitionOption[] {
  return task.options.map((option) => ({
    id: option.optionKey,
    textL1: option.labelL1,
    detailL1: option.detailL1,
    isCorrect: option.isCorrect,
    feedbackTitleL1: option.feedbackTitleL1,
    feedbackBodyL1: option.feedbackBodyL1,
  }));
}

function taskOptions(
  task: SensaRuntimeLearningPackage['assessmentInventory']['novelContextTransfer'][number],
): NovelTransferAssessmentResource['scenario']['options'] {
  return task.options.map((option) => ({
    id: option.optionKey,
    labelL1: option.labelL1,
    detailL1: option.detailL1,
    isCorrect: option.isCorrect,
    feedbackTitleL1: option.feedbackTitleL1,
    feedbackBodyL1: option.feedbackBodyL1,
  }));
}

function requireRelatedBoundarySense(
  pkg: SensaRuntimeLearningPackage,
  relationKey: string,
  content: RuntimeLearningContent,
  installedRelease: SensaRuntimeLearningRelease,
): { relation: SensaRuntimeSenseRelation; relatedPackage: SensaRuntimeLearningPackage } {
  const relation = installedRelease.relations.find((candidate) => candidate.relationKey === relationKey);
  if (!relation) {
    throw new Error(`Boundary task in ${pkg.identity.packageKey} has no Relation ${relationKey}.`);
  }
  if (relation.sourceSenseKey !== content.senseKey && relation.targetSenseKey !== content.senseKey) {
    throw new Error(`Boundary Relation ${relationKey} does not include Sense ${content.senseKey}.`);
  }
  const relatedSenseKey = relation.sourceSenseKey === content.senseKey
    ? relation.targetSenseKey
    : relation.sourceSenseKey;
  const relatedPackage = installedRelease.packages.find((candidate) =>
    candidate.identity.senseKey === relatedSenseKey,
  );
  if (!relatedPackage) {
    throw new Error(`Boundary Relation ${relationKey} has no related Package ${relatedSenseKey}.`);
  }
  return { relation, relatedPackage };
}

/**
 * Resolve one concrete immutable Assessment Task from the installed Package.
 *
 * This is deliberately fail-closed: a missing task key, stale Package
 * projection, or capability/task kind mismatch is an implementation error, not
 * a reason to choose the first or last task in an inventory.
 */
export function materializeAssessmentResource(
  request: AssessmentResourceRequest,
  installedRelease: SensaRuntimeLearningRelease,
): AssessmentResource {
  assertTaskKey(request.taskKey);
  if (request.capability) {
    assertAssessmentCapabilityMatchesKind(request.capability, request.kind);
  }
  const pkg = requireInstalledPackage(request, installedRelease);
  const { content, kind } = request;
  const packageKey = request.packageIdentity.packageKey;

  if (kind === 'context_recognition') {
    const task = pkg.assessmentInventory.contextualRecognition.find(
      (candidate) => candidate.taskKey === request.taskKey,
    );
    if (!task || task.kind !== 'contextual_recognition') {
      throw new Error(
        `Action task ${request.taskKey} is not a contextual Recognition resource in ${packageKey}.`,
      );
    }
    return {
      kind,
      packageKey,
      senseKey: request.packageIdentity.senseKey,
      taskKey: task.taskKey,
      example: projectExample(pkg, task.exampleKey, installedRelease),
      contextLabelL1: '新语境',
      instructionL1: task.promptL1,
      questionL1: task.questionL1,
      options: recognitionOptions(task),
      successTitleL1: task.options.find((option) => option.isCorrect)?.feedbackTitleL1
        ?? (() => { throw new Error(`Recognition task ${task.taskKey} has no correct option.`); })(),
      successBodyL1: task.options.find((option) => option.isCorrect)?.feedbackBodyL1
        ?? (() => { throw new Error(`Recognition task ${task.taskKey} has no correct option.`); })(),
      featureLabelsL1: task.featureLabelsL1,
    };
  }

  if (kind === 'meaning_to_form_recall') {
    const task = pkg.assessmentInventory.meaningToFormRecall.find(
      (candidate) => candidate.taskKey === request.taskKey,
    );
    if (!task || task.kind !== 'meaning_to_form_recall') {
      throw new Error(
        `Action task ${request.taskKey} is not a Meaning-to-form Recall resource in ${packageKey}.`,
      );
    }
    const lexeme = installedRelease.lexemes.find((candidate) =>
      candidate.lexemeKey === pkg.identity.lexemeKey
      && candidate.version === pkg.identity.lexemeVersion,
    );
    if (!lexeme) {
      throw new Error(`Package ${packageKey} has no pinned Lexeme resource.`);
    }
    return {
      kind,
      packageKey,
      senseKey: request.packageIdentity.senseKey,
      taskKey: task.taskKey,
      instructionL1: task.promptL1,
      cueL1: task.cue.bodyL1,
      cueFeatureLabelsL1: task.cue.featureLabelsL1,
      primaryForm: lexeme.lemma,
      acceptedForms: lexeme.forms,
      choiceOptions: task.supportInventory.formChoices.map((choice) => ({
        id: choice.optionKey,
        textL2: choice.formL2,
        isTarget: choice.isTargetLexeme,
      })),
      independentSuccessTitleL1: task.feedback.independentSuccessTitleL1,
      independentSuccessBodyL1: task.feedback.independentSuccessBodyL1,
      supportedSuccessTitleL1: task.feedback.supportedSuccessTitleL1,
      supportedSuccessBodyL1: task.feedback.supportedSuccessBodyL1,
      choiceSuccessTitleL1: task.feedback.choiceSuccessTitleL1,
      choiceSuccessBodyL1: task.feedback.choiceSuccessBodyL1,
      repairTitleL1: task.feedback.repairTitleL1,
      repairBodyL1: task.feedback.repairBodyL1,
    };
  }

  if (kind === 'novel_context_transfer') {
    const task = pkg.assessmentInventory.novelContextTransfer.find(
      (candidate) => candidate.taskKey === request.taskKey,
    );
    if (!task || task.kind !== 'novel_context_transfer') {
      throw new Error(
        `Action task ${request.taskKey} is not a novel Transfer resource in ${packageKey}.`,
      );
    }
    return {
      kind,
      packageKey,
      senseKey: request.packageIdentity.senseKey,
      taskKey: task.taskKey,
      instructionL1: task.promptL1,
      scenario: {
        id: task.taskKey,
        exampleKey: task.exampleKey,
        sceneLabelL1: task.scene.sceneLabelL1,
        setupL2: task.scene.setupL2,
        setupL1: task.scene.setupL1,
        visualKind: task.scene.visualKind,
        visualAltL1: task.scene.visualAltL1,
        questionL1: task.questionL1,
        options: taskOptions(task),
        successTitleL1: task.successTitleL1,
        successBodyL1: task.successBodyL1,
        sourceObjectL1: task.connectionSummary.fromLabelL1,
        targetObjectL1: task.connectionSummary.toLabelL1,
        invariantLabelsL1: task.connectionSummary.invariantLabelsL1,
        revealExample: projectExample(pkg, task.exampleKey, installedRelease),
      },
    };
  }

  const task = pkg.assessmentInventory.boundaryContrast.find(
    (candidate) => candidate.taskKey === request.taskKey,
  );
  if (!task || task.kind !== 'boundary_contrast') {
    throw new Error(
      `Action task ${request.taskKey} is not a Boundary resource in ${packageKey}.`,
    );
  }
  const { relation, relatedPackage } = requireRelatedBoundarySense(pkg, task.relationKey, content, installedRelease);
  const relatedLexeme = installedRelease.lexemes.find((candidate) =>
    candidate.lexemeKey === relatedPackage.identity.lexemeKey
    && candidate.version === relatedPackage.identity.lexemeVersion,
  );
  if (!relatedLexeme) {
    throw new Error(`Boundary Relation ${task.relationKey} has no related Lexeme resource.`);
  }
  return {
    kind,
    packageKey,
    senseKey: request.packageIdentity.senseKey,
    taskKey: task.taskKey,
    instructionL1: task.promptL1,
    relationKey: task.relationKey,
    contrastSenseL1: `${relatedLexeme.lemma} · ${relatedPackage.sense.guideLabelL1}`,
    relationLabelL1: relation.relationType === 'viewpoint_contrast'
      ? '同一临时转移 · 不同动作视角'
      : '真实混淆边界',
    example: projectExample(pkg, task.exampleKey, installedRelease),
    questionL1: task.questionL1,
    options: task.options.map((option) => ({
      id: option.optionKey,
      textL1: option.labelL1,
      detailL1: option.detailL1,
      isCorrect: option.isCorrect,
      feedbackTitleL1: option.feedbackTitleL1,
      feedbackBodyL1: option.feedbackBodyL1,
    })),
  };
}

/** Keep the compiler honest when a caller stores a capability next to a kind. */
export function assertAssessmentCapabilityMatchesKind(
  capability: LearningCapability,
  kind: AssessmentResourceKind,
): void {
  if (assessmentKindForCapability(capability) !== kind) {
    throw new Error(`Assessment capability ${capability} does not match ${kind}.`);
  }
}
