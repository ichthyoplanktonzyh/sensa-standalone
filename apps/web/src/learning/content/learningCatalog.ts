import {
  sensaRuntimeLearningReleaseSchema,
  type SensaRuntimeExperiencePresentation,
  type SensaRuntimeInteractionPayload,
  type SensaRuntimeLearningPackage,
  type SensaRuntimeLearningRelease,
} from '@sensa/contracts/sensa';
import type {
  LearningCapability,
  RepairResourceReference,
  ScheduledActionDefinition,
} from '../engine/types';
import type {
  ExperienceRendererVariant,
  ExperienceStageClassName,
  InteractionExperience,
  LearningCatalog,
  LearningExample,
  LearningExperience,
  RuntimeLearningContent,
  RuntimeLearningPackage,
} from './learningContent';
export type {
  BoundaryContrast,
  ExperienceRendererVariant,
  ExperienceStageClassName,
  InteractionExperience,
  InteractionState,
  LearningCatalog,
  LearningExample,
  LearningExperience,
  LearningPronunciation,
  MeaningToFormRecallCardSpec,
  RecallChoiceOption,
  RecognitionOption,
  RuntimeLearningContent,
  RuntimeLearningPackage,
  TextExperience,
  TransferScenarioSpec,
} from './learningContent';

const stageClassForVariant: Record<ExperienceRendererVariant, ExperienceStageClassName> = {
  physical_threshold: 'physical',
  continuation_timeline: 'process',
  receiver_transfer: 'borrow',
  provider_transfer: 'lend',
};

const runtimeStageClassForVariant: Record<ExperienceRendererVariant, string> = {
  physical_threshold: 'physical',
  continuation_timeline: 'process',
  receiver_transfer: 'borrow',
  provider_transfer: 'lend',
};

function mediaUrl(
  release: SensaRuntimeLearningRelease,
  mediaKey: string | null | undefined,
): string | null {
  if (!mediaKey) return null;
  const media = release.media.find((candidate) => candidate.mediaKey === mediaKey);
  if (!media || media.kind !== 'audio') return null;
  const digest = media.uri.startsWith('content://sha256/')
    ? media.uri.slice('content://sha256/'.length)
    : null;
  return digest ? `/golden-audio/${digest}.mp3` : null;
}

function projectExample(
  release: SensaRuntimeLearningRelease,
  example: SensaRuntimeLearningPackage['examples'][number],
): LearningExample {
  const audioRender = example.renders.find((render) => render.kind === 'static_audio');
  return {
    exampleKey: example.exampleKey,
    textL2: example.textL2,
    textL1: example.textL1,
    targetSurface: example.target.surface,
    targetStart: example.target.start,
    targetEnd: example.target.end,
    audioUrl: audioRender?.kind === 'static_audio'
      ? mediaUrl(release, audioRender.mediaKey)
      : null,
  };
}

type RuntimePresentation = InteractionExperience['presentation'];

function runtimePresentation(value: SensaRuntimeExperiencePresentation): RuntimePresentation & {
  variant: ExperienceRendererVariant;
} {
  if (value.stageClassName !== runtimeStageClassForVariant[value.variant]) {
    throw new Error(`Runtime presentation stage class does not match ${value.variant}.`);
  }
  return {
    variant: value.variant,
    controlLabelL1: value.controlLabelL1,
    stageClassName: stageClassForVariant[value.variant],
    statusLabelsL1: value.statusLabelsL1,
    objectLabelL1: value.objectLabelL1,
    projectLabelL1: value.projectLabelL1,
    supportLabelsL1: value.supportLabelsL1,
    viewpointLabelL1: value.viewpointLabelL1,
    ownerLabelL1: value.ownerLabelL1,
    userLabelL1: value.userLabelL1,
  };
}

function projectExperience(
  pkg: SensaRuntimeLearningPackage,
): LearningExperience {
  const renderByKey = new Map(pkg.experience.renders.map((render) => [render.renderKey, render] as const));
  const rolePriority = { preferred: 0, alternative: 1, fallback: 2 } as const;
  const plannedRenders = pkg.experience.renderPlan.selections
    .slice()
    .sort((left, right) => rolePriority[left.role] - rolePriority[right.role] || left.rank - right.rank)
    .flatMap((selection) => {
      const render = renderByKey.get(selection.renderKey);
      return render ? [{ selection, render }] : [];
    });
  const selected = plannedRenders.find(({ render }) =>
    render.kind === 'text' || (render.kind === 'interaction' && render.rendererKey === 'state_change_v1'));
  if (!selected) {
    throw new Error(`Package ${pkg.identity.packageKey} has no executable Web Experience Render.`);
  }
  if (selected.render.kind === 'text') {
    return {
      kind: 'text',
      renderKey: selected.render.renderKey,
      stageCaptionL1: pkg.experience.recap.titleL1,
      sceneL1: selected.render.sceneL1,
    };
  }
  if (selected.render.kind !== 'interaction') {
    throw new Error(`Package ${pkg.identity.packageKey} selected an unsupported Web Experience Render.`);
  }
  const interaction = selected.render;
  const fallbackTextScene = plannedRenders.find(({ selection, render }) =>
    selection.role === 'fallback' && render.kind === 'text');
  const payload: SensaRuntimeInteractionPayload = interaction.payload;
  const runtime = runtimePresentation(payload.runtimePresentation);
  const rawStates = 'states' in payload ? payload.states : payload.timeline;
  const states = rawStates.map((payloadState, index) => {
    const stateName = 'state' in payloadState ? payloadState.state : payloadState.key;
    const labelL1 = payloadState.labelL1;
    const feedbackL1 = 'feedbackL1' in payloadState
      ? payloadState.feedbackL1
      : payloadState.labelL1;
    return {
      value: 'value' in payloadState && typeof payloadState.value === 'number'
        ? payloadState.value
        : index,
      state: stateName,
      labelL1,
      feedbackL1,
    };
  });
  const control = 'control' in payload ? payload.control : null;
  const minimum = control?.minimum ?? 0;
  const maximum = control?.maximum ?? states.length - 1;
  const step = control?.step ?? 1;
  const instruction = payload.instructionL1;
  return {
    kind: 'interaction',
    renderKey: interaction.renderKey,
    rendererKey: interaction.rendererKey,
    rendererVariant: runtime.variant,
    stageCaptionL1: pkg.experience.recap.titleL1,
    instructionL1: instruction,
    controlLabelL1: runtime.controlLabelL1,
    minimum,
    maximum,
    step,
    labelsL1: states.map((item) => item.labelL1),
    states,
    fallbackTextSceneL1: fallbackTextScene?.render.kind === 'text'
      ? fallbackTextScene.render.sceneL1
      : null,
    presentation: {
      controlLabelL1: runtime.controlLabelL1,
      stageClassName: runtime.stageClassName,
      statusLabelsL1: runtime.statusLabelsL1,
      objectLabelL1: runtime.objectLabelL1,
      projectLabelL1: runtime.projectLabelL1,
      supportLabelsL1: runtime.supportLabelsL1,
      viewpointLabelL1: runtime.viewpointLabelL1,
      ownerLabelL1: runtime.ownerLabelL1,
      userLabelL1: runtime.userLabelL1,
    },
  };
}

function projectPackage(
  release: SensaRuntimeLearningRelease,
  pkg: SensaRuntimeLearningPackage,
): RuntimeLearningContent {
  const lexeme = release.lexemes.find((candidate) =>
    candidate.lexemeKey === pkg.identity.lexemeKey && candidate.version === pkg.identity.lexemeVersion);
  if (!lexeme) throw new Error(`Package ${pkg.identity.packageKey} has no pinned Lexeme.`);
  const pronunciations = lexeme.pronunciations.map((pronunciation) => ({
    pronunciationKey: pronunciation.pronunciationKey,
    accentLocale: pronunciation.accentLocale,
    ipa: pronunciation.ipa,
    audioUrl: mediaUrl(release, pronunciation.mediaKey),
  }));
  const primaryPronunciation = pronunciations.find((item) => item.accentLocale === 'en-US') ?? pronunciations[0];
  if (!primaryPronunciation) throw new Error(`Package ${pkg.identity.packageKey} has no pronunciation.`);
  const learningExamples = pkg.examples
    .filter((example) => example.visibility === 'learning_only')
    .map((example) => projectExample(release, example));
  const studyExample = pkg.examples.find((example) => example.roles.includes('study_binding'));
  if (!studyExample) throw new Error(`Package ${pkg.identity.packageKey} has no study Example.`);
  const recognitionTask = pkg.assessmentInventory.contextualRecognition.find((task) =>
    task.eligiblePurposes.includes('acquisition_gate'));
  const recallTask = pkg.assessmentInventory.meaningToFormRecall.find((task) =>
    task.eligiblePurposes.includes('acquisition_gate'));
  if (!recognitionTask || !recallTask) throw new Error(`Package ${pkg.identity.packageKey} lacks required acquisition assessment tasks.`);
  const recognitionExample = pkg.examples.find((example) => example.exampleKey === recognitionTask.exampleKey);
  if (!recognitionExample) throw new Error(`Recognition task ${recognitionTask.taskKey} has no Example.`);
  const recognitionOptions = recognitionTask.options.map((option) => ({
    id: option.optionKey,
    textL1: option.labelL1,
    detailL1: option.detailL1,
    isCorrect: option.isCorrect,
    feedbackTitleL1: option.feedbackTitleL1,
    feedbackBodyL1: option.feedbackBodyL1,
  }));
  const recognitionSuccess = recognitionOptions.find((option) => option.isCorrect);
  if (!recognitionSuccess) throw new Error(`Recognition task ${recognitionTask.taskKey} has no correct option.`);
  const transferTasks = pkg.assessmentInventory.novelContextTransfer.filter((task) =>
    task.eligiblePurposes.includes('acquisition_gate'));
  const transferScenarios = transferTasks.flatMap((task) => {
    const example = pkg.examples.find((candidate) => candidate.exampleKey === task.exampleKey);
    if (!example) return [];
    return [{
      id: task.taskKey,
      exampleKey: task.exampleKey,
      sceneLabelL1: task.scene.sceneLabelL1,
      setupL2: task.scene.setupL2,
      setupL1: task.scene.setupL1,
      visualKind: task.scene.visualKind,
      visualAltL1: task.scene.visualAltL1,
      questionL1: task.questionL1,
      options: task.options.map((option) => ({
        id: option.optionKey,
        labelL1: option.labelL1,
        detailL1: option.detailL1,
        isCorrect: option.isCorrect,
        feedbackTitleL1: option.feedbackTitleL1,
        feedbackBodyL1: option.feedbackBodyL1,
      })),
      successTitleL1: task.successTitleL1,
      successBodyL1: task.successBodyL1,
      sourceObjectL1: task.connectionSummary.fromLabelL1,
      targetObjectL1: task.connectionSummary.toLabelL1,
      invariantLabelsL1: task.connectionSummary.invariantLabelsL1,
      revealExample: projectExample(release, example),
    }];
  });
  // The legacy package projection can expose one boundary preview only when
  // the Package declares exactly one. Formal Learn/Review never uses this
  // compatibility field; it resolves the selected task through the exact
  // Assessment Resource adapter instead of guessing an inventory position.
  const boundaryTask = pkg.assessmentInventory.boundaryContrast.length === 1
    ? pkg.assessmentInventory.boundaryContrast[0]
    : undefined;
  const boundaryExample = boundaryTask
    ? pkg.examples.find((example) => example.exampleKey === boundaryTask.exampleKey)
    : undefined;
  const boundaryRelation = boundaryTask
    ? release.relations.find((relation) => relation.relationKey === boundaryTask.relationKey)
    : undefined;
  const relatedSenseKey = boundaryRelation
    ? boundaryRelation.sourceSenseKey === pkg.identity.senseKey
      ? boundaryRelation.targetSenseKey
      : boundaryRelation.sourceSenseKey
    : undefined;
  const relatedPackage = release.packages.find((candidate) => candidate.identity.senseKey === relatedSenseKey);
  const relatedLexeme = release.lexemes.find((candidate) => candidate.lexemeKey === relatedPackage?.identity.lexemeKey);
  return {
    packageKey: pkg.identity.packageKey,
    senseKey: pkg.identity.senseKey,
    lemma: lexeme.lemma,
    syllables: lexeme.syllables,
    ipa: primaryPronunciation.ipa,
    accentLocale: primaryPronunciation.accentLocale,
    pronunciations,
    partOfSpeech: pkg.sense.partOfSpeech,
    guideLabelL1: pkg.sense.guideLabelL1,
    definitionL2: pkg.sense.definitionL2,
    l1Bridge: pkg.l1Bridge.bodyL1,
    experience: projectExperience(pkg),
    experienceSketch: {
      labelsL1: pkg.experience.recap.steps.map((step) => step.labelL1),
      bodyL1: pkg.experience.recap.bodyL1,
    },
    studyExample: projectExample(release, studyExample),
    recognitionAssessment: {
      ...projectExample(release, recognitionExample),
      contextLabelL1: '新语境',
      instructionL1: recognitionTask.promptL1,
      questionL1: recognitionTask.questionL1,
      options: recognitionOptions,
      successTitleL1: recognitionSuccess.feedbackTitleL1,
      successBodyL1: recognitionSuccess.feedbackBodyL1,
      featureLabelsL1: recognitionTask.featureLabelsL1,
    },
    meaningToFormRecall: {
      cueL1: recallTask.cue.bodyL1,
      cueFeatureLabelsL1: recallTask.cue.featureLabelsL1,
      primaryForm: lexeme.lemma,
      acceptedForms: lexeme.forms,
      choiceOptions: recallTask.supportInventory.formChoices.map((choice) => ({
        id: choice.optionKey,
        textL2: choice.formL2,
        isTarget: choice.isTargetLexeme,
      })),
      independentSuccessTitleL1: recallTask.feedback.independentSuccessTitleL1,
      independentSuccessBodyL1: recallTask.feedback.independentSuccessBodyL1,
      supportedSuccessTitleL1: recallTask.feedback.supportedSuccessTitleL1,
      supportedSuccessBodyL1: recallTask.feedback.supportedSuccessBodyL1,
      choiceSuccessTitleL1: recallTask.feedback.choiceSuccessTitleL1,
      choiceSuccessBodyL1: recallTask.feedback.choiceSuccessBodyL1,
      repairTitleL1: recallTask.feedback.repairTitleL1,
      repairBodyL1: recallTask.feedback.repairBodyL1,
    },
    novelTransfer: {
      instructionL1: transferTasks[0]?.promptL1 ?? '把已经建立的意思带到新语境。',
      scenarios: transferScenarios,
    },
    boundaryContrast: boundaryTask && boundaryExample
      ? {
          taskKey: boundaryTask.taskKey,
          relationKey: boundaryTask.relationKey,
          contrastSenseL1: relatedPackage && relatedLexeme
            ? `${relatedLexeme.lemma} · ${relatedPackage.sense.guideLabelL1}`
            : '相邻义项',
          relationLabelL1: boundaryRelation?.relationType === 'viewpoint_contrast'
            ? '同一临时转移 · 不同动作视角'
            : '真实混淆边界',
          example: projectExample(release, boundaryExample),
          questionL1: boundaryTask.questionL1,
          options: boundaryTask.options.map((option) => ({
            id: option.optionKey,
            textL1: option.labelL1,
            detailL1: option.detailL1,
            isCorrect: option.isCorrect,
            feedbackTitleL1: option.feedbackTitleL1,
            feedbackBodyL1: option.feedbackBodyL1,
          })),
        }
      : null,
    learningExamples,
    supportTabs: pkg.usagePatterns.length > 0
      ? [{
          id: 'usage' as const,
          label: '搭配' as const,
          patterns: pkg.usagePatterns.map((pattern) => ({
            canonicalPattern: pattern.canonicalPattern,
            commonCollocations: pattern.collocations.map((collocation) => {
              const primaryBinding = collocation.exampleBindings.find((binding) => binding.role === 'primary');
              return {
                text: collocation.displayTextL2,
                exampleIndex: primaryBinding
                  ? learningExamples.findIndex((example) => example.exampleKey === primaryBinding.exampleKey)
                  : -1,
              };
            }),
            registerLabel: pattern.registerLabel,
            domainLabel: pattern.domainLabel,
            usageRestriction: pattern.usageRestriction,
          })),
        }]
      : [],
    practiceManifest: pkg.practiceManifest,
  };
}

function capabilityForTaskKind(kind: string): LearningCapability | null {
  switch (kind) {
    case 'contextual_recognition': return 'contextual_recognition';
    case 'meaning_to_form_recall': return 'meaning_to_form_recall';
    case 'novel_context_transfer': return 'novel_context_transfer';
    case 'boundary_contrast': return 'boundary_discrimination';
    case 'boundary_discrimination': return 'boundary_discrimination';
    default: return null;
  }
}

function schedulingActions(pkg: SensaRuntimeLearningPackage): ScheduledActionDefinition[] {
  const actions: ScheduledActionDefinition[] = [{
    actionKey: `${pkg.identity.packageKey}.introduction`,
    // 讲解不练任何能力，所以没有 capability；它的含义由 intent 声明。
    capability: null,
    taskKey: null,
    kind: 'introduction',
    intent: 'instruction',
  }];
  const tasks = [
    ...pkg.assessmentInventory.contextualRecognition,
    ...pkg.assessmentInventory.meaningToFormRecall,
    ...pkg.assessmentInventory.novelContextTransfer,
    ...pkg.assessmentInventory.boundaryContrast,
  ];
  for (const task of tasks) {
    const capability = capabilityForTaskKind(task.kind);
    if (!capability) continue;
    if (!task.eligiblePurposes.includes('acquisition_gate')) continue;
    actions.push({ actionKey: task.taskKey, capability, taskKey: task.taskKey, kind: 'acquisition_gate' });
  }
  return actions;
}

function reviewActions(pkg: SensaRuntimeLearningPackage): ScheduledActionDefinition[] {
  const tasks = [
    ...pkg.assessmentInventory.contextualRecognition,
    ...pkg.assessmentInventory.meaningToFormRecall,
    ...pkg.assessmentInventory.novelContextTransfer,
    ...pkg.assessmentInventory.boundaryContrast,
  ];
  return tasks.flatMap((task) => {
    const capability = capabilityForTaskKind(task.kind);
    if (!capability || (!task.eligiblePurposes.includes('retention_review') && !task.eligiblePurposes.includes('relearning_gate'))) return [];
    const actions: ScheduledActionDefinition[] = [];
    if (task.eligiblePurposes.includes('retention_review')) {
      actions.push({ actionKey: `${task.taskKey}.retention`, capability, taskKey: task.taskKey, kind: 'retention_review' });
    }
    if (task.eligiblePurposes.includes('relearning_gate')) {
      actions.push({ actionKey: `${task.taskKey}.relearning`, capability, taskKey: task.taskKey, kind: 'relearning_gate' });
    }
    return actions;
  });
}

function repairResourceReference(
  pkg: SensaRuntimeLearningPackage,
  capability: LearningCapability,
): RepairResourceReference {
  const binding = pkg.repairBindings.find((candidate) => candidate.capability === capability);
  const declaredResource = binding?.resourceRefs.find((resource) => {
    switch (resource.kind) {
      case 'experience_recap':
      case 'l1_bridge':
      case 'learning_example':
      case 'sense_relation':
        return true;
      default:
        return false;
    }
  });

  if (declaredResource) {
    switch (declaredResource.kind) {
      case 'experience_recap':
        return {
          role: 'experience_recap',
          key: declaredResource.recapKey,
          source: 'package_declared',
        };
      case 'l1_bridge':
        return {
          role: 'l1_bridge',
          key: declaredResource.assetKey,
          source: 'package_declared',
        };
      case 'learning_example':
        return {
          role: 'learning_example',
          key: declaredResource.exampleKey,
          source: 'package_declared',
        };
      case 'sense_relation':
        // The current scheduler reference vocabulary has no separate relation
        // role. Preserve the reviewed relation identity as sense features so
        // the action remains package-declared and traceable.
        return {
          role: 'sense_features',
          key: declaredResource.relationKey,
          source: 'package_declared',
        };
    }
  }

  // Default repair deliberately reuses approved Package resources. It is not
  // a scheduler fallback: the Package is the source of the recap, bridge or
  // reviewed learning example used for the intervention.
  if (capability === 'meaning_to_form_recall') {
    return {
      role: 'l1_bridge',
      key: pkg.l1Bridge.assetKey,
      source: 'package_declared',
    };
  }
  if (capability === 'novel_context_transfer' || capability === 'boundary_discrimination') {
    const repairExample = pkg.examples.find((example) =>
      example.visibility === 'learning_only' && example.roles.includes('retrieval_repair'));
    if (repairExample) {
      return {
        role: 'learning_example',
        key: repairExample.exampleKey,
        source: 'package_declared',
      };
    }
  }
  return {
    role: 'experience_recap',
    key: pkg.experience.recap.recapKey,
    source: 'package_declared',
  };
}

function repairActions(
  pkg: SensaRuntimeLearningPackage,
  actions: readonly ScheduledActionDefinition[],
): ScheduledActionDefinition[] {
  const capabilities = pkg.acquisitionProfile.requiredCapabilities
    .map((requirement) => capabilityForTaskKind(requirement.kind))
    .filter((capability): capability is LearningCapability => capability !== null)
    .filter((capability, index, all) => all.indexOf(capability) === index);
  return capabilities.map((capability) => {
    const baseAction = actions.find((action) =>
      action.capability === capability && action.kind === 'acquisition_gate');
    return {
      actionKey: baseAction?.actionKey ?? `${pkg.identity.packageKey}.${capability}`,
      capability,
      taskKey: null,
      kind: 'acquisition_gate',
      intent: 'repair',
      repairForActionKey: baseAction?.actionKey,
      repairResourceRef: repairResourceReference(pkg, capability),
    };
  });
}

export function installLearningRelease(input: unknown): LearningCatalog {
  const release = sensaRuntimeLearningReleaseSchema.parse(input);
  const contents = release.packages.map((pkg) => projectPackage(release, pkg));
  const packages = release.packages.map((pkg, index) => {
    const actions = schedulingActions(pkg);
    return {
      packageId: pkg.identity.packageKey,
      senseId: pkg.identity.senseKey,
      content: contents[index]!,
      requiredCapabilities: pkg.acquisitionProfile.requiredCapabilities
        .map((capability) => capabilityForTaskKind(capability.kind))
        .filter((capability): capability is LearningCapability => capability !== null),
      actions,
      repairActions: repairActions(pkg, actions),
      reviewActions: reviewActions(pkg),
    } satisfies RuntimeLearningPackage;
  });
  const packageById = new Map(packages.map((pkg) => [pkg.packageId, pkg] as const));
  const packageBySense = new Map(packages.map((pkg) => [pkg.senseId, pkg] as const));
  const catalog: LearningCatalog = {
    release,
    packages,
    getPackage: (packageId: string) => packageById.get(packageId) ?? null,
    getPackageBySense: (senseId: string) => packageBySense.get(senseId) ?? null,
    resolveMediaUrl: (mediaKey: string | null | undefined) => mediaUrl(release, mediaKey),
    resolvePronunciationAudioUrl: (lemma: string, accentLocale = 'en-US') => {
      const normalizedLemma = lemma.trim().toLocaleLowerCase();
      const lexeme = release.lexemes.find((candidate) =>
        candidate.lemma.toLocaleLowerCase() === normalizedLemma);
      if (!lexeme) return null;
      const pronunciation = lexeme.pronunciations.find((candidate) =>
        candidate.accentLocale === accentLocale)
        ?? lexeme.pronunciations[0];
      return pronunciation ? mediaUrl(release, pronunciation.mediaKey) : null;
    },
    resolveExampleAudioUrl: (textL2: string, accentLocale = 'en-US') => {
      for (const pkg of release.packages) {
        const example = pkg.examples.find((candidate) => candidate.textL2 === textL2);
        if (!example) continue;
        const audioRenders = example.renders.filter((render) =>
          render.kind === 'static_audio' && render.accentLocale === accentLocale);
        const render = audioRenders[0]
          ?? example.renders.find((candidate) => candidate.kind === 'static_audio');
        return render?.kind === 'static_audio'
          ? mediaUrl(release, render.mediaKey)
          : null;
      }
      return null;
    },
  };
  return Object.freeze(catalog);
}
