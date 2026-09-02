import {
  sensaRuntimeLearningReleaseSchema,
  type SensaRuntimeExperiencePresentation,
  type SensaRuntimeLearningPackage,
  type SensaRuntimeLearningRelease,
} from "@sensa/contracts/sensa";

export const sensaRuntimeLearningReleaseValidatorVersion =
  "sensa-runtime-learning-release-validator-v1" as const;

const expectedDeliveryProfile = "sensa-web-prototype-acquisition-v1";
const expectedCapabilityResolver =
  "sensa-executable-learning-capability-resolver-v1";

export type SensaRuntimeLearningReleaseValidationIssue = Readonly<{
  code: string;
  path: string;
  message: string;
}>;

export type SensaRuntimeLearningReleaseValidationResult = Readonly<{
  status: "invalid" | "satisfied";
  validatorVersion: typeof sensaRuntimeLearningReleaseValidatorVersion;
  release: SensaRuntimeLearningRelease | null;
  issues: readonly SensaRuntimeLearningReleaseValidationIssue[];
}>;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

class Issues {
  readonly #values: SensaRuntimeLearningReleaseValidationIssue[] = [];

  add(code: string, path: string, message: string): void {
    if (!this.#values.some((issue) =>
      issue.code === code && issue.path === path && issue.message === message)) {
      this.#values.push({ code, path, message });
    }
  }

  result(): readonly SensaRuntimeLearningReleaseValidationIssue[] {
    return [...this.#values].sort((left, right) =>
      compare(left.code, right.code)
      || compare(left.path, right.path)
      || compare(left.message, right.message));
  }
}

function unique(
  issues: Issues,
  values: readonly string[],
  path: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      issues.add(
        "identity.duplicate",
        `${path}.${index}`,
        `Duplicate identity: ${value}`,
      );
    }
    seen.add(value);
  });
}

function uniqueBy<T>(
  issues: Issues,
  values: readonly T[],
  path: string,
  identity: (value: T) => string,
): void {
  unique(issues, values.map(identity), path);
}

function hasTargetForm(text: string, forms: readonly string[]): boolean {
  return forms.some((form) => {
    const escaped = form.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return escaped.length > 0
      && new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "iu").test(text);
  });
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join(" ");
  if (value !== null && typeof value === "object") {
    return Object.values(value).map(flattenText).join(" ");
  }
  return "";
}

function optionKeys(
  issues: Issues,
  options: readonly { optionKey: string }[],
  path: string,
): void {
  uniqueBy(issues, options, path, (option) => option.optionKey);
}

function correctOptionCount(
  issues: Issues,
  options: readonly { isCorrect: boolean }[],
  path: string,
): void {
  if (options.filter((option) => option.isCorrect).length !== 1) {
    issues.add(
      "assessment.correct_option_count",
      path,
      "An executable assessment must have exactly one correct option.",
    );
  }
}

function mediaUriDigest(uri: string): string | null {
  const match = /^content:\/\/sha256\/([0-9a-f]{64})$/u.exec(uri);
  return match === null ? null : `sha256:${match[1]}`;
}

function taskEntries(item: SensaRuntimeLearningPackage): Array<{
  task: SensaRuntimeLearningPackage["assessmentInventory"][keyof SensaRuntimeLearningPackage["assessmentInventory"]][number];
  family: "contextualRecognition" | "meaningToFormRecall" | "novelContextTransfer" | "boundaryContrast";
  index: number;
}> {
  return [
    ...item.assessmentInventory.contextualRecognition.map((task) => ({
      task,
      family: "contextualRecognition" as const,
      index: item.assessmentInventory.contextualRecognition.indexOf(task),
    })),
    ...item.assessmentInventory.meaningToFormRecall.map((task) => ({
      task,
      family: "meaningToFormRecall" as const,
      index: item.assessmentInventory.meaningToFormRecall.indexOf(task),
    })),
    ...item.assessmentInventory.novelContextTransfer.map((task) => ({
      task,
      family: "novelContextTransfer" as const,
      index: item.assessmentInventory.novelContextTransfer.indexOf(task),
    })),
    ...item.assessmentInventory.boundaryContrast.map((task) => ({
      task,
      family: "boundaryContrast" as const,
      index: item.assessmentInventory.boundaryContrast.indexOf(task),
    })),
  ];
}

function validateMedia(
  issues: Issues,
  release: SensaRuntimeLearningRelease,
): Map<string, SensaRuntimeLearningRelease["media"][number]> {
  uniqueBy(issues, release.media, "media", (media) => media.mediaKey);
  const mediaByKey = new Map<string, SensaRuntimeLearningRelease["media"][number]>();
  release.media.forEach((media, index) => {
    mediaByKey.set(media.mediaKey, media);
    const path = `media.${index}`;
    const digest = mediaUriDigest(media.uri);
    if (digest === null) {
      issues.add(
        "media.uri_not_packaged",
        `${path}.uri`,
        "Runtime media must use a content://sha256 URI.",
      );
    } else if (media.sha256 !== digest) {
      issues.add(
        "media.digest_mismatch",
        `${path}.sha256`,
        "Media URI digest must match the declared SHA-256 digest.",
      );
    }
    const expectedMimePrefix = media.kind === "audio" ? "audio/" : "image/";
    if (!media.mimeType.toLowerCase().startsWith(expectedMimePrefix)) {
      issues.add(
        "media.mime_kind_mismatch",
        `${path}.mimeType`,
        `Media kind ${media.kind} must use a ${expectedMimePrefix} MIME type.`,
      );
    }
    if (media.kind === "audio" && media.sourceTextDigest === null) {
      issues.add(
        "media.source_text_digest_missing",
        `${path}.sourceTextDigest`,
        "Packaged audio must declare the digest of its source text.",
      );
    }
  });
  return mediaByKey;
}

function validateLexemes(
  issues: Issues,
  release: SensaRuntimeLearningRelease,
  mediaByKey: ReadonlyMap<string, SensaRuntimeLearningRelease["media"][number]>,
): Map<string, SensaRuntimeLearningRelease["lexemes"][number]> {
  uniqueBy(issues, release.lexemes, "lexemes", (lexeme) => lexeme.lexemeKey);
  uniqueBy(
    issues,
    release.lexemes,
    "lexemes.versions",
    (lexeme) => `${lexeme.lexemeKey}@${lexeme.version}`,
  );
  const lexemesByVersion = new Map<string, SensaRuntimeLearningRelease["lexemes"][number]>();
  release.lexemes.forEach((lexeme, index) => {
    lexemesByVersion.set(`${lexeme.lexemeKey}@${lexeme.version}`, lexeme);
    uniqueBy(issues, lexeme.forms, `lexemes.${index}.forms`, (form) => form.toLocaleLowerCase("und"));
    uniqueBy(issues, lexeme.pronunciations, `lexemes.${index}.pronunciations`, (pronunciation) => pronunciation.pronunciationKey);
    lexeme.pronunciations.forEach((pronunciation, pronunciationIndex) => {
      if (pronunciation.mediaKey === null) return;
      const media = mediaByKey.get(pronunciation.mediaKey);
      if (media === undefined) {
        issues.add(
          "reference.media_missing",
          `lexemes.${index}.pronunciations.${pronunciationIndex}.mediaKey`,
          `Unknown pronunciation media: ${pronunciation.mediaKey}`,
        );
      } else if (media.kind !== "audio") {
        issues.add(
          "reference.media_kind_mismatch",
          `lexemes.${index}.pronunciations.${pronunciationIndex}.mediaKey`,
          "Pronunciation must reference audio media.",
        );
      }
    });
  });
  return lexemesByVersion;
}

function validatePresentation(
  issues: Issues,
  presentation: SensaRuntimeExperiencePresentation,
  path: string,
): void {
  const expectedStage: Record<string, string> = {
    physical_threshold: "physical",
    continuation_timeline: "process",
    receiver_transfer: "borrow",
    provider_transfer: "lend",
  };
  if (presentation.stageClassName !== expectedStage[presentation.variant]) {
    issues.add(
      "render.runtime_stage_class_invalid",
      `${path}.runtimePresentation.stageClassName`,
      "Runtime presentation stage class must match its closed renderer variant.",
    );
  }
}

function validateExperienceRenders(
  issues: Issues,
  item: SensaRuntimeLearningPackage,
  mediaByKey: ReadonlyMap<string, SensaRuntimeLearningRelease["media"][number]>,
  release: SensaRuntimeLearningRelease,
  packagePath: string,
  forms: readonly string[],
): Set<string> {
  const renders = item.experience.renders;
  uniqueBy(issues, renders, `${packagePath}.experience.renders`, (render) => render.renderKey);
  const renderKeys = new Set<string>();
  renders.forEach((render, renderIndex) => {
    const path = `${packagePath}.experience.renders.${renderIndex}`;
    renderKeys.add(render.renderKey);
    if (!render.supportedDeliveryProfiles.includes(release.release.deliveryProfileVersion)) {
      issues.add(
        "render.delivery_profile_missing",
        `${path}.supportedDeliveryProfiles`,
        "Executable render must support the release delivery profile.",
      );
    }
    if (render.kind === "image") {
      const media = mediaByKey.get(render.mediaKey);
      if (media === undefined) {
        issues.add("reference.media_missing", `${path}.mediaKey`, `Unknown media: ${render.mediaKey}`);
      } else if (media.kind !== "image") {
        issues.add("reference.media_kind_mismatch", `${path}.mediaKey`, "Image Render must reference image media.");
      }
    } else if (render.kind === "interaction") {
      validatePresentation(issues, render.payload.runtimePresentation, `${path}.payload`);
      if (render.rendererKey !== "state_change_v1") {
        issues.add("render.renderer_unsupported", `${path}.rendererKey`, "Renderer key is not executable by this delivery profile.");
      }
    }
    const interactionContentText = render.kind === "interaction"
      ? Object.entries(render.payload)
        .filter(([key]) => key !== "runtimePresentation")
        .map(([, value]) => flattenText(value))
        .join(" ")
      : "";
    const renderText = render.kind === "text"
      ? render.sceneL1
      : render.kind === "image"
      ? render.altTextL1
      : render.kind === "sequence"
      ? render.steps.map((step) => `${step.label} ${step.description}`).join(" ")
      : interactionContentText;
    if (hasTargetForm(renderText, forms)) {
      issues.add("experience.target_form_leak", path, "Experience render must hide pinned target forms.");
    }
  });

  const selections = item.experience.renderPlan.selections;
  uniqueBy(issues, selections, `${packagePath}.experience.renderPlan.selections`, (selection) => selection.renderKey);
  selections.forEach((selection, selectionIndex) => {
    if (!renderKeys.has(selection.renderKey)) {
      issues.add(
        "reference.render_missing",
        `${packagePath}.experience.renderPlan.selections.${selectionIndex}.renderKey`,
        `Unknown Experience Render: ${selection.renderKey}`,
      );
    }
  });
  const preferredSelections = selections.filter((selection) => selection.role === "preferred");
  if (preferredSelections.length !== 1) {
    issues.add(
      "render.preferred_count_invalid",
      `${packagePath}.experience.renderPlan`,
      "Every Package requires exactly one preferred Experience Render.",
    );
  }
  const renderByKey = new Map(renders.map((render) => [render.renderKey, render] as const));
  const preferredRender = preferredSelections.length === 1
    ? renderByKey.get(preferredSelections[0]!.renderKey)
    : undefined;
  const hasTextFallback = selections.some((selection) =>
    selection.role === "fallback" && renderByKey.get(selection.renderKey)?.kind === "text");
  if (preferredRender !== undefined && preferredRender.kind !== "text" && !hasTextFallback) {
    issues.add(
      "render.text_scene_fallback_missing",
      `${packagePath}.experience.renderPlan`,
      "A non-text preferred Render requires an approved Text Experience Render fallback.",
    );
  }
  return renderKeys;
}

function validateExamples(
  issues: Issues,
  item: SensaRuntimeLearningPackage,
  lexeme: SensaRuntimeLearningRelease["lexemes"][number],
  mediaByKey: ReadonlyMap<string, SensaRuntimeLearningRelease["media"][number]>,
  packagePath: string,
): Map<string, SensaRuntimeLearningPackage["examples"][number]> {
  uniqueBy(issues, item.examples, `${packagePath}.examples`, (example) => example.exampleKey);
  const examplesByKey = new Map<string, SensaRuntimeLearningPackage["examples"][number]>();
  item.examples.forEach((example, exampleIndex) => {
    examplesByKey.set(example.exampleKey, example);
    const path = `${packagePath}.examples.${exampleIndex}`;
    uniqueBy(issues, example.roles, `${path}.roles`, (role) => role);
    if (!lexeme.forms.some((form) => form.toLocaleLowerCase("und") === example.target.surface.toLocaleLowerCase("und"))) {
      issues.add("example.target_form_unknown", `${path}.target.surface`, "Example target must be a pinned Lexeme form.");
    }
    if (
      example.target.end > example.textL2.length
      || example.target.start >= example.target.end
      || example.textL2.slice(example.target.start, example.target.end) !== example.target.surface
    ) {
      issues.add("example.target_span_invalid", `${path}.target`, "Target span must select the exact target surface.");
    }
    const assessmentOnlyRoles = new Set([
      "recognition_assessment",
      "retention_assessment",
      "transfer_assessment",
    ]);
    const teachingRoles = new Set([
      "study_binding",
      "retrieval_repair",
      "usage_illustration",
      "free_practice",
    ]);
    if (example.visibility === "assessment_only" && example.roles.some((role) => teachingRoles.has(role))) {
      issues.add("example.visibility_role_conflict", `${path}.roles`, "Assessment-only Example cannot be used as teaching or practice content.");
    }
    if (example.visibility === "learning_only" && example.roles.some((role) => assessmentOnlyRoles.has(role))) {
      issues.add("example.visibility_role_conflict", `${path}.roles`, "Learning-only Example cannot be used as assessment content.");
    }
    if (example.roles.includes("transfer_assessment") && example.visibility !== "assessment_only") {
      issues.add("example.transfer_not_protected", `${path}.visibility`, "Transfer Examples must remain assessment-only.");
    }
    if (example.roles.includes("study_binding") && example.visibility !== "learning_only") {
      issues.add("example.study_not_learning_only", `${path}.visibility`, "Study Binding Examples must be learning-only.");
    }
    if (example.roles.includes("usage_illustration") && example.visibility !== "learning_only") {
      issues.add("example.usage_not_learning_only", `${path}.visibility`, "Usage Examples must be learning-only.");
    }
    uniqueBy(issues, example.renders, `${path}.renders`, (render) => render.renderKey);
    example.renders.forEach((render, renderIndex) => {
      if (render.kind !== "static_audio") return;
      const media = mediaByKey.get(render.mediaKey);
      if (media === undefined) {
        issues.add("reference.media_missing", `${path}.renders.${renderIndex}.mediaKey`, `Unknown media: ${render.mediaKey}`);
      } else if (media.kind !== "audio") {
        issues.add("reference.media_kind_mismatch", `${path}.renders.${renderIndex}.mediaKey`, "Static audio must reference audio media.");
      } else if (media.sourceTextDigest !== null && media.sourceTextDigest !== render.sourceTextDigest) {
        issues.add("media.source_text_digest_mismatch", `${path}.renders.${renderIndex}.sourceTextDigest`, "Static audio source digest must match its packaged media.");
      }
    });
  });
  return examplesByKey;
}

function validateTask(
  issues: Issues,
  entry: ReturnType<typeof taskEntries>[number],
  examplesByKey: ReadonlyMap<string, SensaRuntimeLearningPackage["examples"][number]>,
  relationByKey: ReadonlyMap<string, SensaRuntimeLearningRelease["relations"][number]>,
  packageSenseKey: string,
  forms: readonly string[],
  packagePath: string,
): void {
  const { task, family } = entry;
  const path = `${packagePath}.assessmentInventory.${family}.${entry.index}`;
  uniqueBy(issues, task.eligiblePurposes, `${path}.eligiblePurposes`, (purpose) => purpose);
  if ("exampleKey" in task) {
    const example = examplesByKey.get(task.exampleKey);
    if (example === undefined) {
      issues.add("reference.example_missing", `${path}.exampleKey`, `Unknown Example: ${task.exampleKey}`);
    } else if (task.kind === "novel_context_transfer") {
      if (example.visibility !== "assessment_only" || !example.roles.includes("transfer_assessment")) {
        issues.add("assessment.transfer_example_invalid", `${path}.exampleKey`, "Transfer tasks must use a protected Transfer Example.");
      }
    } else if (task.kind === "contextual_recognition") {
      if (!example.roles.some((role) => role === "recognition_assessment" || role === "retention_assessment")) {
        issues.add("assessment.recognition_example_invalid", `${path}.exampleKey`, "Recognition tasks must use a recognition or retention Example.");
      }
    } else if (task.kind === "boundary_contrast") {
      if (example.visibility !== "assessment_only" || !example.roles.some((role) =>
        role === "recognition_assessment" || role === "retention_assessment" || role === "transfer_assessment")) {
        issues.add("assessment.boundary_example_invalid", `${path}.exampleKey`, "Boundary tasks must use a protected assessment Example.");
      }
    }
  }
  if (task.kind === "contextual_recognition") {
    optionKeys(issues, task.options, `${path}.options`);
    correctOptionCount(issues, task.options, `${path}.options`);
  } else if (task.kind === "meaning_to_form_recall") {
    const cue = `${task.promptL1} ${task.cue.bodyL1} ${task.cue.featureLabelsL1.join(" ")}`;
    if (hasTargetForm(cue, forms)) {
      issues.add("assessment.recall_target_form_leak", `${path}.cue`, "Recall cue must hide target forms.");
    }
    optionKeys(issues, task.supportInventory.formChoices, `${path}.supportInventory.formChoices`);
    if (task.supportInventory.formChoices.filter((choice) => choice.isTargetLexeme).length !== 1) {
      issues.add("assessment.recall_target_count", `${path}.supportInventory.formChoices`, "Recall support choices must contain exactly one target Lexeme.");
    }
    if (task.supportInventory.formChoices.some((choice) =>
      choice.isTargetLexeme && !forms.some((form) => form.toLocaleLowerCase("und") === choice.formL2.toLocaleLowerCase("und")))) {
      issues.add("assessment.recall_target_form_unknown", `${path}.supportInventory.formChoices`, "Recall target choice must be a pinned Lexeme form.");
    }
  } else if (task.kind === "novel_context_transfer") {
    optionKeys(issues, task.options, `${path}.options`);
    correctOptionCount(issues, task.options, `${path}.options`);
    const scene = `${task.scene.sceneLabelL1} ${task.scene.setupL2} ${task.scene.setupL1} ${task.scene.visualAltL1} ${task.questionL1} ${task.options.map((option) => `${option.labelL1} ${option.detailL1}`).join(" ")}`;
    if (hasTargetForm(scene, forms)) {
      issues.add("assessment.transfer_target_form_leak", `${path}.scene`, "Transfer pre-submit scene must hide target forms.");
    }
  } else {
    optionKeys(issues, task.options, `${path}.options`);
    correctOptionCount(issues, task.options, `${path}.options`);
    const relation = relationByKey.get(task.relationKey);
    if (relation === undefined) {
      issues.add("reference.relation_missing", `${path}.relationKey`, `Unknown Relation: ${task.relationKey}`);
    } else if (relation.sourceSenseKey !== packageSenseKey && relation.targetSenseKey !== packageSenseKey) {
      issues.add("reference.relation_target_mismatch", `${path}.relationKey`, "Boundary Relation must involve the Package Sense.");
    }
  }
}

function validateTasks(
  issues: Issues,
  item: SensaRuntimeLearningPackage,
  examplesByKey: ReadonlyMap<string, SensaRuntimeLearningPackage["examples"][number]>,
  relationByKey: ReadonlyMap<string, SensaRuntimeLearningRelease["relations"][number]>,
  packagePath: string,
  forms: readonly string[],
): void {
  const entries = taskEntries(item);
  uniqueBy(issues, entries, `${packagePath}.assessmentInventory.tasks`, (entry) => entry.task.taskKey);
  entries.forEach((entry) => validateTask(
    issues,
    entry,
    examplesByKey,
    relationByKey,
    item.identity.senseKey,
    forms,
    packagePath,
  ));

  const acquisitionTransfers = item.assessmentInventory.novelContextTransfer.filter((task) =>
    task.eligiblePurposes.includes("acquisition_gate"));
  if (acquisitionTransfers.length < 5) {
    issues.add(
      "delivery.transfer_inventory_insufficient",
      `${packagePath}.assessmentInventory.novelContextTransfer`,
      "A standard runtime Package requires at least five acquisition Transfer opportunities.",
    );
  }
  const transferFamilies = new Set(acquisitionTransfers.flatMap((task) => {
    const example = examplesByKey.get(task.exampleKey);
    return example === undefined ? [] : [example.scenarioFamily];
  }));
  if (transferFamilies.size < 3) {
    issues.add(
      "delivery.transfer_diversity_insufficient",
      `${packagePath}.assessmentInventory.novelContextTransfer`,
      "Acquisition Transfer opportunities must cover at least three scenario families.",
    );
  }
  for (const example of examplesByKey.values()) {
    if (!example.roles.includes("transfer_assessment")) continue;
    if (!acquisitionTransfers.some((task) => task.exampleKey === example.exampleKey)) {
      issues.add(
        "assessment.transfer_task_missing",
        `${packagePath}.assessmentInventory.novelContextTransfer`,
        `Transfer Example has no acquisition-eligible task: ${example.exampleKey}`,
      );
    }
  }
}

function validateUsagePatterns(
  issues: Issues,
  item: SensaRuntimeLearningPackage,
  examplesByKey: ReadonlyMap<string, SensaRuntimeLearningPackage["examples"][number]>,
  packagePath: string,
): void {
  uniqueBy(issues, item.usagePatterns, `${packagePath}.usagePatterns`, (pattern) => pattern.patternKey);
  item.usagePatterns.forEach((pattern, patternIndex) => {
    const path = `${packagePath}.usagePatterns.${patternIndex}`;
    uniqueBy(issues, pattern.collocations, `${path}.collocations`, (collocation) => collocation.collocationKey);
    pattern.collocations.forEach((collocation, collocationIndex) => {
      const collocationPath = `${path}.collocations.${collocationIndex}`;
      uniqueBy(issues, collocation.exampleBindings, `${collocationPath}.exampleBindings`, (binding) => binding.bindingKey);
      if (!collocation.exampleBindings.some((binding) => binding.role === "primary")) {
        issues.add("usage.primary_binding_missing", `${collocationPath}.exampleBindings`, "Every collocation needs a primary Example binding.");
      }
      collocation.exampleBindings.forEach((binding, bindingIndex) => {
        const bindingPath = `${collocationPath}.exampleBindings.${bindingIndex}`;
        const example = examplesByKey.get(binding.exampleKey);
        if (example === undefined) {
          issues.add("reference.example_missing", `${bindingPath}.exampleKey`, `Unknown Example: ${binding.exampleKey}`);
        } else if (
          example.visibility !== "learning_only"
          || !example.roles.includes("usage_illustration")
          || example.textL2.slice(binding.start, binding.end) !== collocation.displayTextL2
        ) {
          issues.add("usage.span_invalid", bindingPath, "Usage binding must select exact text in a learning-only usage Example.");
        }
      });
    });
  });
}

function validateRepairBindings(
  issues: Issues,
  item: SensaRuntimeLearningPackage,
  renderKeys: ReadonlySet<string>,
  examplesByKey: ReadonlyMap<string, SensaRuntimeLearningPackage["examples"][number]>,
  relationByKey: ReadonlyMap<string, SensaRuntimeLearningRelease["relations"][number]>,
  packagePath: string,
): void {
  uniqueBy(issues, item.repairBindings, `${packagePath}.repairBindings`, (binding) => binding.bindingKey);
  item.repairBindings.forEach((binding, bindingIndex) => {
    const path = `${packagePath}.repairBindings.${bindingIndex}`;
    binding.resourceRefs.forEach((resource, resourceIndex) => {
      const resourcePath = `${path}.resourceRefs.${resourceIndex}`;
      switch (resource.kind) {
        case "experience_recap":
          if (resource.recapKey !== item.experience.recap.recapKey) {
            issues.add("reference.recap_missing", `${resourcePath}.recapKey`, `Unknown Experience Recap: ${resource.recapKey}`);
          }
          break;
        case "experience_render":
          if (!renderKeys.has(resource.renderKey)) {
            issues.add("reference.render_missing", `${resourcePath}.renderKey`, `Unknown Experience Render: ${resource.renderKey}`);
          }
          break;
        case "l1_bridge":
          if (resource.assetKey !== item.l1Bridge.assetKey) {
            issues.add("reference.l1_bridge_missing", `${resourcePath}.assetKey`, `Unknown L1 Bridge: ${resource.assetKey}`);
          }
          break;
        case "learning_example": {
          const example = examplesByKey.get(resource.exampleKey);
          if (example === undefined) {
            issues.add("reference.example_missing", `${resourcePath}.exampleKey`, `Unknown Example: ${resource.exampleKey}`);
          } else if (example.visibility !== "learning_only" || !example.roles.includes("retrieval_repair")) {
            issues.add("repair.example_invalid", `${resourcePath}.exampleKey`, "Repair Example must be a learning-only retrieval repair resource.");
          }
          break;
        }
        case "sense_relation": {
          const relation = relationByKey.get(resource.relationKey);
          if (relation === undefined) {
            issues.add("reference.relation_missing", `${resourcePath}.relationKey`, `Unknown Relation: ${resource.relationKey}`);
          } else if (relation.sourceSenseKey !== item.identity.senseKey && relation.targetSenseKey !== item.identity.senseKey) {
            issues.add("reference.relation_target_mismatch", `${resourcePath}.relationKey`, "Repair Relation must involve the Package Sense.");
          }
          break;
        }
        case "sense_features":
        case "lexeme_forms":
          break;
      }
    });
  });
}

function validatePracticeManifest(
  issues: Issues,
  item: SensaRuntimeLearningPackage,
  renderKeys: ReadonlySet<string>,
  examplesByKey: ReadonlyMap<string, SensaRuntimeLearningPackage["examples"][number]>,
  packagePath: string,
): void {
  if (item.practiceManifest === undefined) return;
  uniqueBy(issues, item.practiceManifest.grants, `${packagePath}.practiceManifest.grants`, (grant) => grant.taskFamily);
  const assetKeys = new Set<string>([
    ...renderKeys,
    ...examplesByKey.keys(),
    item.l1Bridge.assetKey,
  ]);
  item.practiceManifest.grants.forEach((grant, grantIndex) => {
    uniqueBy(issues, grant.resourceKeys, `${packagePath}.practiceManifest.grants.${grantIndex}.resourceKeys`, (resourceKey) => resourceKey);
    grant.resourceKeys.forEach((resourceKey, resourceIndex) => {
      const path = `${packagePath}.practiceManifest.grants.${grantIndex}.resourceKeys.${resourceIndex}`;
      if (!assetKeys.has(resourceKey)) {
        issues.add("reference.practice_resource_missing", path, `Unknown practice resource: ${resourceKey}`);
        return;
      }
      const example = examplesByKey.get(resourceKey);
      if (example !== undefined && example.visibility === "assessment_only") {
        issues.add("practice.assessment_resource_exposed", path, "Free Practice cannot expose assessment-only resources.");
      }
    });
  });
}

function validatePackage(
  issues: Issues,
  item: SensaRuntimeLearningPackage,
  release: SensaRuntimeLearningRelease,
  packageIndex: number,
  lexemesByVersion: ReadonlyMap<string, SensaRuntimeLearningRelease["lexemes"][number]>,
  mediaByKey: ReadonlyMap<string, SensaRuntimeLearningRelease["media"][number]>,
  relationByKey: ReadonlyMap<string, SensaRuntimeLearningRelease["relations"][number]>,
): void {
  const path = `packages.${packageIndex}`;
  const identity = item.identity;
  if (identity.targetLanguage !== release.release.targetLanguage) {
    issues.add("identity.language_mismatch", `${path}.identity.targetLanguage`, "Package target language must match the runtime release.");
  }
  if (identity.learnerLocale !== release.release.learnerLocale) {
    issues.add("identity.locale_mismatch", `${path}.identity.learnerLocale`, "Package learner locale must match the runtime release.");
  }
  const lexeme = lexemesByVersion.get(`${identity.lexemeKey}@${identity.lexemeVersion}`);
  if (lexeme === undefined) {
    issues.add("reference.lexeme_missing", `${path}.identity.lexemeKey`, `Unknown pinned Lexeme: ${identity.lexemeKey}@${identity.lexemeVersion}`);
    return;
  }
  if (lexeme.languageTag !== identity.targetLanguage || lexeme.languageTag !== release.release.targetLanguage) {
    issues.add(
      "identity.language_mismatch",
      `${path}.identity.targetLanguage`,
      "Package target language must match its pinned Lexeme and runtime release.",
    );
  }
  const renderKeys = validateExperienceRenders(issues, item, mediaByKey, release, path, lexeme.forms);
  const examplesByKey = validateExamples(issues, item, lexeme, mediaByKey, path);
  validateTasks(issues, item, examplesByKey, relationByKey, path, lexeme.forms);
  validateUsagePatterns(issues, item, examplesByKey, path);
  validateRepairBindings(issues, item, renderKeys, examplesByKey, relationByKey, path);
  validatePracticeManifest(issues, item, renderKeys, examplesByKey, path);

  const requiredCapabilities = item.acquisitionProfile.requiredCapabilities;
  uniqueBy(issues, requiredCapabilities, `${path}.acquisitionProfile.requiredCapabilities`, (capability) =>
    capability.kind === "boundary_discrimination" ? `${capability.kind}:${capability.relationKey}` : capability.kind);
  uniqueBy(issues, item.acquisitionProfile.requiredAssetCapabilities, `${path}.acquisitionProfile.requiredAssetCapabilities`, (capability) => capability);
  uniqueBy(issues, item.acquisitionProfile.optionalAssetCapabilities, `${path}.acquisitionProfile.optionalAssetCapabilities`, (capability) => capability);
  const optionalAssets = new Set(item.acquisitionProfile.optionalAssetCapabilities);
  item.acquisitionProfile.requiredAssetCapabilities.forEach((capability) => {
    if (optionalAssets.has(capability)) {
      issues.add("capability.required_optional_overlap", `${path}.acquisitionProfile.optionalAssetCapabilities`, `Asset capability appears in both required and optional sets: ${capability}`);
    }
  });
  const requiredKinds = new Set<string>(requiredCapabilities.map((capability) => capability.kind));
  for (const baseline of ["contextual_recognition", "meaning_to_form_recall", "novel_context_transfer"] as const) {
    if (!requiredKinds.has(baseline)) {
      issues.add("capability.baseline_missing", `${path}.acquisitionProfile.requiredCapabilities`, `Missing baseline capability: ${baseline}`);
    }
  }
  const optionalKinds = new Set(item.acquisitionProfile.optionalCapabilities);
  for (const optional of optionalKinds) {
    if (requiredKinds.has(optional)) {
      issues.add("capability.required_optional_overlap", `${path}.acquisitionProfile.optionalCapabilities`, `Capability appears in both required and optional sets: ${optional}`);
    }
  }
  const acquisitionTasks = taskEntries(item).filter((entry) => entry.task.eligiblePurposes.includes("acquisition_gate"));
  for (const capability of requiredCapabilities) {
    const hasTask = capability.kind === "boundary_discrimination"
      ? acquisitionTasks.some((entry) => entry.task.kind === "boundary_contrast" && entry.task.relationKey === capability.relationKey)
      : acquisitionTasks.some((entry) => entry.task.kind === capability.kind);
    if (!hasTask) {
      issues.add("capability.task_missing", `${path}.assessmentInventory`, `No acquisition-eligible task for required capability: ${capability.kind}`);
    }
  }
  item.acquisitionProfile.boundaryTargets.forEach((target, targetIndex) => {
    const relation = relationByKey.get(target.relationKey);
    if (relation === undefined) {
      issues.add("reference.relation_missing", `${path}.acquisitionProfile.boundaryTargets.${targetIndex}.relationKey`, `Unknown Relation: ${target.relationKey}`);
    } else if (relation.sourceSenseKey !== identity.senseKey && relation.targetSenseKey !== identity.senseKey) {
      issues.add("reference.relation_target_mismatch", `${path}.acquisitionProfile.boundaryTargets.${targetIndex}.relationKey`, "Boundary Target Relation must involve the Package Sense.");
    }
  });
  const requiredBoundaryRelations = new Set(
    requiredCapabilities
      .filter((capability) => capability.kind === "boundary_discrimination")
      .map((capability) => capability.relationKey),
  );
  const declaredBoundaryRelations = new Set(
    item.acquisitionProfile.boundaryTargets
      .filter((target) => target.isRequired)
      .map((target) => target.relationKey),
  );
  for (const relationKey of requiredBoundaryRelations) {
    if (!declaredBoundaryRelations.has(relationKey)) {
      issues.add(
        "capability.boundary_target_missing",
        `${path}.acquisitionProfile.boundaryTargets`,
        `Required Boundary capability is missing its boundary target: ${relationKey}`,
      );
    }
  }
  for (const relationKey of declaredBoundaryRelations) {
    if (!requiredBoundaryRelations.has(relationKey)) {
      issues.add(
        "capability.boundary_capability_missing",
        `${path}.acquisitionProfile.boundaryTargets`,
        `Required boundary target has no required Boundary capability: ${relationKey}`,
      );
    }
  }

  const hasCapabilityAsset = (capability: string): boolean => {
    switch (capability) {
      case "meaning_grounding":
        return item.experience.renders.length > 0;
      case "l1_mediation":
        return item.l1Bridge.bodyL1.trim().length > 0;
      case "usage_pattern":
        return item.usagePatterns.length > 0;
      case "contextual_variation":
        return item.assessmentInventory.novelContextTransfer.some((task) => task.eligiblePurposes.includes("acquisition_gate"));
      case "pronunciation":
        return lexeme.pronunciations.some((pronunciation) => pronunciation.mediaKey !== null && mediaByKey.get(pronunciation.mediaKey)?.kind === "audio");
      case "study_example_audio": {
        const study = [...examplesByKey.values()].find((example) => example.roles.includes("study_binding"));
        return study?.renders.some((render) => render.kind === "static_audio") ?? false;
      }
      case "boundary_contrast":
        return item.assessmentInventory.boundaryContrast.some((task) => task.eligiblePurposes.includes("acquisition_gate"));
      case "visual_grounding":
        return item.experience.renders.some((render) => render.kind === "image");
      case "causal_grounding":
        return item.experience.renders.some((render) => render.primitive === "causal_sequence");
      case "temporal_grounding":
        return item.experience.renders.some((render) => render.primitive === "temporal_sequence");
      case "spatial_grounding":
        return item.experience.renders.some((render) => render.primitive === "spatial_relation");
      case "counterexample":
      case "extended_audio":
        return false;
      default:
        return true;
    }
  };
  item.acquisitionProfile.requiredAssetCapabilities.forEach((capability) => {
    if (!hasCapabilityAsset(capability)) {
      issues.add("capability.asset_missing", `${path}.acquisitionProfile.requiredAssetCapabilities`, `No executable asset for required capability: ${capability}`);
    }
  });
}

/**
 * Validate an immutable runtime release at the install boundary.  This
 * function is pure: it does not read learner state, storage, network, or
 * media bytes.  The publishing pipeline performs the deeper authoring and
 * governance checks before producing this artifact.
 */
export function validateRuntimeLearningRelease(
  input: unknown,
): SensaRuntimeLearningReleaseValidationResult {
  const parsed = sensaRuntimeLearningReleaseSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      code: `schema.${issue.code}`,
      path: issue.path.join("."),
      message: issue.message,
    })).sort((left, right) =>
      compare(left.code, right.code)
      || compare(left.path, right.path)
      || compare(left.message, right.message));
    return {
      status: "invalid",
      validatorVersion: sensaRuntimeLearningReleaseValidatorVersion,
      release: null,
      issues,
    };
  }

  const issues = new Issues();
  const release = parsed.data;
  if (release.release.deliveryProfileVersion !== expectedDeliveryProfile) {
    issues.add("release.delivery_profile_unsupported", "release.deliveryProfileVersion", `Expected ${expectedDeliveryProfile}.`);
  }
  if (release.release.validatorVersion !== sensaRuntimeLearningReleaseValidatorVersion) {
    issues.add("release.validator_version_mismatch", "release.validatorVersion", "Runtime release was produced by a different validator version.");
  }
  if (release.release.capabilityResolverVersion !== expectedCapabilityResolver) {
    issues.add("release.capability_resolver_unsupported", "release.capabilityResolverVersion", `Expected ${expectedCapabilityResolver}.`);
  }

  const mediaByKey = validateMedia(issues, release);
  const lexemesByVersion = validateLexemes(issues, release, mediaByKey);
  uniqueBy(issues, release.relations, "relations", (relation) => relation.relationKey);
  const relationByKey = new Map<string, SensaRuntimeLearningRelease["relations"][number]>();
  release.relations.forEach((relation, index) => {
    relationByKey.set(relation.relationKey, relation);
    if (relation.sourceSenseKey === relation.targetSenseKey) {
      issues.add("relation.self_reference", `relations.${index}`, "A Relation cannot connect a Sense to itself.");
    }
  });

  uniqueBy(issues, release.packages, "packages", (item) => item.identity.packageKey);
  uniqueBy(issues, release.packages, "packages.senseKey", (item) => item.identity.senseKey);
  uniqueBy(issues, release.packages, "packages.versions", (item) => `${item.identity.packageKey}@${item.identity.packageVersion}`);
  const packageBySense = new Map(release.packages.map((item) => [item.identity.senseKey, item] as const));
  release.relations.forEach((relation, index) => {
    const source = packageBySense.get(relation.sourceSenseKey);
    const target = packageBySense.get(relation.targetSenseKey);
    if (source === undefined || target === undefined) {
      issues.add("reference.relation_sense_missing", `relations.${index}`, "Both Relation Senses must exist in the runtime release.");
    } else if (relation.scope === "intra_word" && source.identity.lexemeKey !== target.identity.lexemeKey) {
      issues.add("relation.scope_mismatch", `relations.${index}.scope`, "Intra-word Relation must connect Senses of one Lexeme.");
    } else if (relation.scope === "cross_word" && source.identity.lexemeKey === target.identity.lexemeKey) {
      issues.add("relation.scope_mismatch", `relations.${index}.scope`, "Cross-word Relation must connect different Lexemes.");
    }
  });

  release.packages.forEach((item, index) => validatePackage(
    issues,
    item,
    release,
    index,
    lexemesByVersion,
    mediaByKey,
    relationByKey,
  ));
  const resultIssues = issues.result();
  return {
    status: resultIssues.length === 0 ? "satisfied" : "invalid",
    validatorVersion: sensaRuntimeLearningReleaseValidatorVersion,
    release,
    issues: resultIssues,
  };
}
