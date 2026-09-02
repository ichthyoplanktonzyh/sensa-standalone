import {
  sensaGoldenContentDraftV2BundleSchema,
  type SensaAuthoringAssessmentTask,
  type SensaAuthoringBoundaryContrastTask,
  type SensaAuthoringContextualRecognitionTask,
  type SensaAuthoringLearningExampleV2,
  type SensaAuthoringMeaningToFormRecallTask,
  type SensaAuthoringNovelContextTransferTask,
  type SensaAuthoringRepairResourceRef,
  type SensaAuthoringSensePackageDraftV2,
  type SensaAuthoringUsagePatternV2,
  type SensaGoldenContentDraftV2Bundle,
} from "@sensa/contracts/sensa";
import {
  sensaAuthoringLearningExampleSchema,
  sensaAuthoringUsagePatternSchema,
  type SensaAuthoringLearningExample,
  type SensaGoldenContentBundle,
} from "@sensa/contracts/sensa";
import {
  validateGoldenContentBundle,
  type SensaGoldenContentValidationIssue,
} from "./authoringBundleValidator.js";

const sensaGoldenContentDraftV2ValidatorVersion =
  "sensa-golden-content-validator-v2-draft" as const;

export type SensaGoldenContentDraftV2ValidationStatus =
  | "invalid"
  | "incomplete"
  | "satisfied";

export type SensaGoldenContentDraftV2ValidationIssue = Readonly<{
  severity: "invalid" | "incomplete";
  code: string;
  path: string;
  message: string;
}>;

export type SensaGoldenContentDraftV2ValidationResult = Readonly<{
  status: SensaGoldenContentDraftV2ValidationStatus;
  previewable: boolean;
  validatorVersion: typeof sensaGoldenContentDraftV2ValidatorVersion;
  bundle: SensaGoldenContentDraftV2Bundle | null;
  issues: readonly SensaGoldenContentDraftV2ValidationIssue[];
}>;

class Issues {
  readonly #values: SensaGoldenContentDraftV2ValidationIssue[] = [];

  add(
    severity: SensaGoldenContentDraftV2ValidationIssue["severity"],
    code: string,
    path: string,
    message: string,
  ): void {
    if (!this.#values.some((issue) =>
      issue.severity === severity
      && issue.code === code
      && issue.path === path
      && issue.message === message)) {
      this.#values.push({ severity, code, path, message });
    }
  }

  addV1(issue: SensaGoldenContentValidationIssue): void {
    this.add(issue.severity, issue.code, issue.path, issue.message);
  }

  get hasInvalid(): boolean {
    return this.#values.some((issue) => issue.severity === "invalid");
  }

  result(): readonly SensaGoldenContentDraftV2ValidationIssue[] {
    return [...this.#values].sort((left, right) =>
      left.severity.localeCompare(right.severity)
      || left.code.localeCompare(right.code)
      || left.path.localeCompare(right.path)
      || left.message.localeCompare(right.message));
  }
}

function validateUnique(
  issues: Issues,
  entries: readonly string[],
  path: string,
): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry)) {
      issues.add("invalid", "identity.duplicate", `${path}.${index}`, `Duplicate identity: ${entry}`);
    }
    seen.add(entry);
  });
}

function validateDisjoint(
  issues: Issues,
  left: readonly string[],
  right: readonly string[],
  path: string,
  code: string,
  message: string,
): void {
  const overlap = [...new Set(left.filter((entry) => right.includes(entry)))].sort();
  if (overlap.length > 0) {
    issues.add("invalid", code, path, `${message}: ${overlap.join(", ")}`);
  }
}

function validateReview(
  issues: Issues,
  review: { status: "draft" | "approved" | "rejected"; reviewedBy: string | null; reviewedAt: string | null },
  path: string,
): void {
  if (review.status === "rejected") {
    issues.add("invalid", "review.rejected", path, "Rejected content cannot enter a preview bundle.");
    return;
  }
  if (review.status === "draft") {
    issues.add("incomplete", "review.pending", path, "Content still requires explicit human approval.");
    return;
  }
  if (review.reviewedBy === null || review.reviewedAt === null) {
    issues.add("invalid", "review.provenance_missing", path, "Approved content requires reviewer identity and timestamp.");
  }
}

function validateProvenance(
  issues: Issues,
  provenance: {
    sourceRefs: readonly string[];
    review: { status: "draft" | "approved" | "rejected"; reviewedBy: string | null; reviewedAt: string | null };
  },
  sourceKeys: ReadonlySet<string>,
  path: string,
): void {
  validateUnique(issues, provenance.sourceRefs, `${path}.sourceRefs`);
  provenance.sourceRefs.forEach((sourceRef, index) => {
    if (!sourceKeys.has(sourceRef)) {
      issues.add("invalid", "reference.source_missing", `${path}.sourceRefs.${index}`, `Unknown source: ${sourceRef}`);
    }
  });
  validateReview(issues, provenance.review, `${path}.review`);
}

function containsTargetForm(text: string, forms: readonly string[]): boolean {
  return forms.some((form) => {
    const escaped = form.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (escaped === "") return false;
    return new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "iu").test(text);
  });
}

function collectStringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringLeaves);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(collectStringLeaves);
  }
  return [];
}

function validateOptions(
  issues: Issues,
  options: readonly Readonly<{
    optionKey: string;
    isCorrect: boolean;
    labelL1: string;
    reasonCode: string;
    feedbackTitleL1: string;
    feedbackBodyL1: string;
  }>[],
  path: string,
): void {
  validateUnique(issues, options.map((option) => option.optionKey), `${path}.optionKey`);
  const correctCount = options.filter((option) => option.isCorrect).length;
  validateUnique(issues, options.map((option) => option.reasonCode), `${path}.reasonCode`);
  if (correctCount !== 1) {
    issues.add(
      "invalid",
      "assessment.correct_option_count",
      path,
      `Assessment options must contain exactly one correct option; received ${correctCount}.`,
    );
  }
  options.forEach((option, index) => {
    if (option.reasonCode.trim().length === 0) {
      issues.add("invalid", "assessment.reason_missing", `${path}.${index}.reasonCode`, "Every option requires a reason code.");
    }
  });
}

function validatePurposes(
  issues: Issues,
  purposes: readonly string[],
  path: string,
): void {
  validateUnique(issues, purposes, path);
}

function isLegacyExampleRole(role: string): role is Exclude<
  SensaAuthoringLearningExample["roles"][number],
  never
> {
  return role !== "usage_illustration";
}

function projectToV1(bundle: SensaGoldenContentDraftV2Bundle): SensaGoldenContentBundle {
  const projectRenders = (item: SensaAuthoringSensePackageDraftV2) => item.experience.renders.map((render) => ({
    ...render,
    supportedDeliveryProfiles: render.supportedDeliveryProfiles.map((profile) =>
      profile === bundle.release.deliveryProfileVersion
        ? "sensa-web-prototype-acquisition-v1"
        : profile),
  }));
  return {
    schemaVersion: "sensa-golden-content-bundle-v1",
    release: {
      releaseKey: bundle.release.releaseKey,
      version: bundle.release.version,
      targetLanguage: bundle.release.targetLanguage,
      learnerLocale: bundle.release.learnerLocale,
      deliveryProfileVersion: "sensa-web-prototype-acquisition-v1",
      status: bundle.release.status,
    },
    sources: bundle.sources,
    media: bundle.media,
    lexemes: bundle.lexemes,
    relations: bundle.relations,
    packages: bundle.packages.map((item) => ({
      schemaVersion: "sensa-sense-package-definition-v1",
      identity: item.identity,
      sense: item.sense,
      acquisitionProfile: item.acquisitionProfile,
      experience: {
        sketch: item.experience.sketch,
        renders: projectRenders(item),
        renderPlan: item.experience.renderPlan,
      },
      l1Bridge: item.l1Bridge,
      examples: item.examples.map((example) => {
        const roles = example.roles.filter(isLegacyExampleRole);
        return {
          ...example,
          roles: roles.length > 0 ? roles : ["retrieval_repair"],
        };
      }),
      usagePatterns: item.usagePatterns.map((pattern) => ({
        patternKey: pattern.patternKey,
        canonicalPattern: pattern.canonicalPattern,
        commonCollocations: pattern.collocations.map((collocation) => collocation.displayTextL2),
        registerLabel: pattern.registerLabel,
        domainLabel: pattern.domainLabel,
        usageRestriction: pattern.usageRestriction,
        provenance: pattern.provenance,
      })),
      practiceManifest: item.practiceManifest,
      provenance: item.provenance,
    })),
  };
}

function validateExampleV2(
  issues: Issues,
  example: SensaAuthoringLearningExampleV2,
  lexemeForms: readonly string[],
  path: string,
): void {
  validateUnique(issues, example.roles, `${path}.roles`);
  const formSet = new Set(lexemeForms.map((form) => form.toLocaleLowerCase("und")));
  if (!formSet.has(example.target.surface.toLocaleLowerCase("und"))) {
    issues.add(
      "invalid",
      "example.target_form_unknown",
      `${path}.target.surface`,
      "Example target surface must be one of the pinned Lexeme forms.",
    );
  }
  if (example.target.end > example.textL2.length
    || example.textL2.slice(example.target.start, example.target.end) !== example.target.surface) {
    issues.add(
      "invalid",
      "example.target_span_invalid",
      `${path}.target`,
      "Target start/end must select the exact declared surface form.",
    );
  }
  if (example.roles.includes("usage_illustration") && example.visibility !== "learning_only") {
    issues.add(
      "invalid",
      "example.usage_not_learning_visible",
      `${path}.visibility`,
      "Usage illustration Examples must remain learning-only.",
    );
  }
  if (example.roles.includes("transfer_assessment")) {
    if (example.visibility !== "assessment_only") {
      issues.add(
        "invalid",
        "example.transfer_not_protected",
        `${path}.visibility`,
        "Transfer assessment resources must be assessment-only.",
      );
    }
    if (example.roles.some((role) => role !== "transfer_assessment" && role !== "retention_assessment")) {
      issues.add(
        "invalid",
        "example.transfer_role_conflict",
        `${path}.roles`,
        "Protected Transfer cannot also serve teaching, usage, repair, recognition, or Free Practice.",
      );
    }
  }
}

function validateRecap(
  issues: Issues,
  item: SensaAuthoringSensePackageDraftV2,
  lexemeForms: readonly string[],
  sourceKeys: ReadonlySet<string>,
  path: string,
): void {
  validateProvenance(issues, item.experience.recap.provenance, sourceKeys, `${path}.provenance`);
  const recapText = [
    item.experience.recap.titleL1,
    item.experience.recap.bodyL1,
    ...item.experience.recap.steps.flatMap((step) => [step.labelL1, step.descriptionL1]),
  ].join(" ");
  if (containsTargetForm(recapText, lexemeForms)) {
    issues.add(
      "invalid",
      "experience.recap_target_form_leak",
      path,
      "Experience Recap must hide every target Lexeme form.",
    );
  }
}

function validateExperienceHiddenForms(
  issues: Issues,
  item: SensaAuthoringSensePackageDraftV2,
  lexemeForms: readonly string[],
  path: string,
): void {
  const sketchText = [
    item.experience.sketch.experienceGoal,
    ...item.experience.sketch.focalStructure,
    item.experience.sketch.learnerInference,
    ...item.experience.sketch.constraints.mustConvey,
    ...item.experience.sketch.constraints.mustAvoid,
    ...item.experience.renders.flatMap((render) => {
      if (render.kind === "text") return [render.sceneL1];
      if (render.kind === "image") return [render.altTextL1];
      if (render.kind === "sequence") {
        return [...render.steps.flatMap((step) => [step.label, step.description])];
      }
      return [...collectStringLeaves(render.payload)];
    }),
  ].join(" ");
  if (containsTargetForm(sketchText, lexemeForms)) {
    issues.add(
      "invalid",
      "experience.target_form_leak",
      path,
      "Experience Sketch and Renders must hide every target form.",
    );
  }
}

function validateUsagePattern(
  issues: Issues,
  pattern: SensaAuthoringUsagePatternV2,
  item: SensaAuthoringSensePackageDraftV2,
  exampleByKey: ReadonlyMap<string, SensaAuthoringLearningExampleV2>,
  sourceKeys: ReadonlySet<string>,
  path: string,
): void {
  validateProvenance(issues, pattern.provenance, sourceKeys, `${path}.provenance`);
  validateUnique(issues, pattern.collocations.map((collocation) => collocation.collocationKey), `${path}.collocations`);
  pattern.collocations.forEach((collocation, collocationIndex) => {
    const collocationPath = `${path}.collocations.${collocationIndex}`;
    const primaryBindings = collocation.exampleBindings.filter((binding) => binding.role === "primary");
    if (primaryBindings.length !== 1) {
      issues.add(
        "invalid",
        "usage.primary_count",
        `${collocationPath}.exampleBindings`,
        `Each displayed collocation requires exactly one primary Example binding; received ${primaryBindings.length}.`,
      );
    }
    validateUnique(
      issues,
      collocation.exampleBindings.map((binding) => binding.bindingKey),
      `${collocationPath}.exampleBindings`,
    );
    collocation.exampleBindings.forEach((binding, bindingIndex) => {
      const bindingPath = `${collocationPath}.exampleBindings.${bindingIndex}`;
      const example = exampleByKey.get(binding.exampleKey);
      if (example === undefined) {
        issues.add("invalid", "reference.example_missing", `${bindingPath}.exampleKey`, `Unknown Example: ${binding.exampleKey}`);
        return;
      }
      if (!example.roles.includes("usage_illustration")) {
        issues.add(
          "invalid",
          "usage.role_missing",
          `${bindingPath}.exampleKey`,
          "Usage Example Binding requires the usage_illustration Example role.",
        );
      }
      if (example.visibility !== "learning_only") {
        issues.add(
          "invalid",
          "usage.assessment_resource_exposed",
          `${bindingPath}.exampleKey`,
          "Usage Example Binding cannot target an assessment-only Example.",
        );
      }
      if (example.roles.includes("transfer_assessment")) {
        issues.add(
          "invalid",
          "usage.transfer_resource_exposed",
          `${bindingPath}.exampleKey`,
          "Usage Example Binding cannot target a protected Transfer Example.",
        );
      }
      if (binding.end > example.textL2.length
        || example.textL2.slice(binding.start, binding.end) !== collocation.displayTextL2) {
        issues.add(
          "invalid",
          "usage.span_invalid",
          bindingPath,
          "Usage binding start/end must select the exact displayed collocation text.",
        );
      }
    });
  });
  if (item.usagePatterns.length === 0) {
    issues.add("incomplete", "delivery.usage_pattern_missing", `${path}.usagePatterns`, "At least one Usage Pattern is required.");
  }
}

function validateRecognitionTask(
  issues: Issues,
  task: SensaAuthoringContextualRecognitionTask,
  exampleByKey: ReadonlyMap<string, SensaAuthoringLearningExampleV2>,
  path: string,
): void {
  validatePurposes(issues, task.eligiblePurposes, `${path}.eligiblePurposes`);
  validateOptions(issues, task.options, `${path}.options`);
  const example = exampleByKey.get(task.exampleKey);
  if (example === undefined) {
    issues.add("invalid", "reference.example_missing", `${path}.exampleKey`, `Unknown Example: ${task.exampleKey}`);
    return;
  }
  if (!example.roles.includes("recognition_assessment") && !example.roles.includes("retention_assessment")) {
    issues.add(
      "invalid",
      "assessment.recognition_role_missing",
      `${path}.exampleKey`,
      "Recognition task must reference an Example with recognition_assessment or retention_assessment role.",
    );
  }
  if (task.eligiblePurposes.includes("acquisition_gate") && example.roles.includes("transfer_assessment")) {
    issues.add("invalid", "assessment.transfer_reused_as_recognition", `${path}.exampleKey`, "Recognition cannot reuse a protected Transfer Example.");
  }
}

function validateRecallTask(
  issues: Issues,
  task: SensaAuthoringMeaningToFormRecallTask,
  lexemeForms: readonly string[],
  path: string,
): void {
  validatePurposes(issues, task.eligiblePurposes, `${path}.eligiblePurposes`);
  const cueText = [task.promptL1, task.cue.bodyL1, ...task.cue.featureLabelsL1].join(" ");
  if (containsTargetForm(cueText, lexemeForms)) {
    issues.add("invalid", "assessment.recall_target_form_leak", `${path}.cue`, "Recall cue and prompt must hide target forms.");
  }
  validateUnique(issues, task.supportInventory.formChoices.map((choice) => choice.optionKey), `${path}.supportInventory.formChoices`);
  const targetChoices = task.supportInventory.formChoices.filter((choice) => choice.isTargetLexeme);
  if (targetChoices.length !== 1) {
    issues.add(
      "invalid",
      "assessment.recall_target_choice_count",
      `${path}.supportInventory.formChoices`,
      `Recall form choices must contain exactly one target Lexeme; received ${targetChoices.length}.`,
    );
  }
  validateUnique(
    issues,
    task.supportInventory.formChoices.map((choice) => choice.formL2.toLocaleLowerCase("und")),
    `${path}.supportInventory.formChoices.formL2`,
  );
  const actualTargetChoices = task.supportInventory.formChoices.filter((choice) =>
    lexemeForms.some((form) => form.toLocaleLowerCase("und") === choice.formL2.toLocaleLowerCase("und")));
  if (actualTargetChoices.length !== 1) {
    issues.add(
      "invalid",
      "assessment.recall_actual_target_count",
      `${path}.supportInventory.formChoices`,
      `Recall form choices must contain exactly one choice matching a pinned Lexeme form; received ${actualTargetChoices.length}.`,
    );
  }
  task.supportInventory.formChoices.forEach((choice, choiceIndex) => {
    const isLexemeForm = lexemeForms.some((form) => form.toLocaleLowerCase("und") === choice.formL2.toLocaleLowerCase("und"));
    if (choice.isTargetLexeme && !isLexemeForm) {
      issues.add("invalid", "assessment.recall_form_unknown", `${path}.supportInventory.formChoices.${choiceIndex}.formL2`, "Target choice must be a pinned Lexeme form.");
    }
    if (isLexemeForm && !choice.isTargetLexeme) {
      issues.add("invalid", "assessment.recall_target_flag_mismatch", `${path}.supportInventory.formChoices.${choiceIndex}.isTargetLexeme`, "A pinned target form must be marked as the target Lexeme.");
    }
  });
}

function validateTransferTask(
  issues: Issues,
  task: SensaAuthoringNovelContextTransferTask,
  lexemeForms: readonly string[],
  exampleByKey: ReadonlyMap<string, SensaAuthoringLearningExampleV2>,
  path: string,
): void {
  validatePurposes(issues, task.eligiblePurposes, `${path}.eligiblePurposes`);
  validateOptions(issues, task.options, `${path}.options`);
  const preSubmitText = [
    task.promptL1,
    task.scene.sceneLabelL1,
    task.scene.setupL2,
    task.scene.setupL1,
    task.scene.visualAltL1,
    task.questionL1,
    ...task.options.flatMap((option) => [option.labelL1, option.detailL1]),
  ].join(" ");
  if (containsTargetForm(preSubmitText, lexemeForms)) {
    issues.add("invalid", "assessment.transfer_target_form_leak", `${path}.scene`, "Transfer pre-submit scene and options must hide target forms.");
  }
  const example = exampleByKey.get(task.exampleKey);
  if (example === undefined) {
    issues.add("invalid", "reference.example_missing", `${path}.exampleKey`, `Unknown Example: ${task.exampleKey}`);
    return;
  }
  if (!example.roles.includes("transfer_assessment") || example.visibility !== "assessment_only") {
    issues.add("invalid", "assessment.transfer_example_invalid", `${path}.exampleKey`, "Transfer task must reference a protected Transfer Example.");
  }
}

function validateBoundaryTask(
  issues: Issues,
  task: SensaAuthoringBoundaryContrastTask,
  packageSenseKey: string,
  relationByKey: ReadonlyMap<string, SensaGoldenContentDraftV2Bundle["relations"][number]>,
  exampleByKey: ReadonlyMap<string, SensaAuthoringLearningExampleV2>,
  path: string,
): void {
  validatePurposes(issues, task.eligiblePurposes, `${path}.eligiblePurposes`);
  validateOptions(issues, task.options, `${path}.options`);
  const relation = relationByKey.get(task.relationKey);
  if (relation === undefined) {
    issues.add("invalid", "reference.relation_missing", `${path}.relationKey`, `Unknown relation: ${task.relationKey}`);
  } else if (relation.sourceSenseKey !== packageSenseKey && relation.targetSenseKey !== packageSenseKey) {
    issues.add("invalid", "reference.relation_target_mismatch", `${path}.relationKey`, "Boundary relation must involve the Package Sense.");
  }
  const example = exampleByKey.get(task.exampleKey);
  if (example === undefined) {
    issues.add("invalid", "reference.example_missing", `${path}.exampleKey`, `Unknown Example: ${task.exampleKey}`);
    return;
  }
  if (example.visibility !== "assessment_only"
    || (!example.roles.includes("recognition_assessment") && !example.roles.includes("retention_assessment"))) {
    issues.add(
      "invalid",
      "assessment.boundary_example_invalid",
      `${path}.exampleKey`,
      "Boundary task must use an assessment-only Example with recognition_assessment or retention_assessment role.",
    );
  }
  if (example.roles.some((role) =>
    role === "study_binding"
    || role === "retrieval_repair"
    || role === "usage_illustration"
    || role === "free_practice")) {
    issues.add(
      "invalid",
      "assessment.boundary_example_role_conflict",
      `${path}.exampleKey`,
      "Boundary task cannot expose a teaching, usage, repair, or Free Practice Example.",
    );
  }
}

function validateRepairResourceRef(
  issues: Issues,
  ref: SensaAuthoringRepairResourceRef,
  item: SensaAuthoringSensePackageDraftV2,
  exampleByKey: ReadonlyMap<string, SensaAuthoringLearningExampleV2>,
  relationByKey: ReadonlyMap<string, SensaGoldenContentDraftV2Bundle["relations"][number]>,
  path: string,
): void {
  if (ref.kind === "experience_recap") {
    if (ref.recapKey !== item.experience.recap.recapKey) {
      issues.add("invalid", "reference.recap_missing", `${path}.recapKey`, `Unknown Experience Recap: ${ref.recapKey}`);
    }
    return;
  }
  if (ref.kind === "experience_render") {
    if (!item.experience.renders.some((render) => render.renderKey === ref.renderKey)) {
      issues.add("invalid", "reference.render_missing", `${path}.renderKey`, `Unknown Experience Render: ${ref.renderKey}`);
    }
    return;
  }
  if (ref.kind === "l1_bridge") {
    if (ref.assetKey !== item.l1Bridge.assetKey) {
      issues.add("invalid", "reference.l1_bridge_missing", `${path}.assetKey`, `Unknown L1 Bridge: ${ref.assetKey}`);
    }
    return;
  }
  if (ref.kind === "learning_example") {
    const example = exampleByKey.get(ref.exampleKey);
    if (example === undefined) {
      issues.add("invalid", "reference.example_missing", `${path}.exampleKey`, `Unknown Example: ${ref.exampleKey}`);
      return;
    }
    if (example.visibility !== "learning_only" || !example.roles.includes("retrieval_repair")) {
      issues.add("invalid", "repair.example_not_eligible", `${path}.exampleKey`, "Repair Example must be learning-only and carry retrieval_repair role.");
    }
    return;
  }
  if (ref.kind === "sense_relation" && !relationByKey.has(ref.relationKey)) {
    issues.add("invalid", "reference.relation_missing", `${path}.relationKey`, `Unknown relation: ${ref.relationKey}`);
  }
}

function validateRepairBindings(
  issues: Issues,
  item: SensaAuthoringSensePackageDraftV2,
  bundle: SensaGoldenContentDraftV2Bundle,
  exampleByKey: ReadonlyMap<string, SensaAuthoringLearningExampleV2>,
  sourceKeys: ReadonlySet<string>,
  path: string,
): void {
  const relationByKey = new Map(bundle.relations.map((relation) => [relation.relationKey, relation]));
  validateUnique(issues, item.repairBindings.map((binding) => binding.bindingKey), `${path}.bindingKey`);
  const refIdentity = (ref: SensaAuthoringRepairResourceRef): string => {
    switch (ref.kind) {
      case "experience_recap": return ref.recapKey;
      case "experience_render": return ref.renderKey;
      case "l1_bridge": return ref.assetKey;
      case "learning_example": return ref.exampleKey;
      case "sense_features": return "";
      case "lexeme_forms": return "";
      case "sense_relation": return ref.relationKey;
    }
  };
  item.repairBindings.forEach((binding, bindingIndex) => {
    const bindingPath = `${path}.${bindingIndex}`;
    validateProvenance(issues, binding.provenance, sourceKeys, `${bindingPath}.provenance`);
    validateUnique(issues, binding.reasonCodes, `${bindingPath}.reasonCodes`);
    validateUnique(issues, binding.resourceRefs.map((ref) => `${ref.kind}:${refIdentity(ref)}`), `${bindingPath}.resourceRefs`);
    binding.resourceRefs.forEach((ref, refIndex) => {
      validateRepairResourceRef(issues, ref, item, exampleByKey, relationByKey, `${bindingPath}.resourceRefs.${refIndex}`);
      if (ref.kind === "sense_relation") {
        const relation = relationByKey.get(ref.relationKey);
        if (relation !== undefined && relation.sourceSenseKey !== item.identity.senseKey && relation.targetSenseKey !== item.identity.senseKey) {
          issues.add("invalid", "reference.relation_target_mismatch", `${bindingPath}.resourceRefs.${refIndex}.relationKey`, "Repair relation must involve the Package Sense.");
        }
      }
    });
  });
}

function validateAssessmentInventory(
  issues: Issues,
  item: SensaAuthoringSensePackageDraftV2,
  bundle: SensaGoldenContentDraftV2Bundle,
  lexemeForms: readonly string[],
  sourceKeys: ReadonlySet<string>,
  path: string,
): void {
  const inventory = item.assessmentInventory;
  const tasks: readonly SensaAuthoringAssessmentTask[] = [
    ...inventory.contextualRecognition,
    ...inventory.meaningToFormRecall,
    ...inventory.novelContextTransfer,
    ...inventory.boundaryContrast,
  ];
  validateUnique(issues, tasks.map((task) => task.taskKey), `${path}.taskKey`);
  const exampleByKey = new Map(item.examples.map((example) => [example.exampleKey, example]));
  const relationByKey = new Map(bundle.relations.map((relation) => [relation.relationKey, relation]));
  tasks.forEach((task, taskIndex) => {
    validateProvenance(issues, task.provenance, sourceKeys, `${path}.task.${taskIndex}.provenance`);
    validatePurposes(issues, task.eligiblePurposes, `${path}.task.${taskIndex}.eligiblePurposes`);
  });
  inventory.contextualRecognition.forEach((task, index) =>
    validateRecognitionTask(issues, task, exampleByKey, `${path}.contextualRecognition.${index}`));
  if (inventory.contextualRecognition.filter((task) => task.eligiblePurposes.includes("acquisition_gate")).length === 0) {
    issues.add("incomplete", "capability.recognition_task_missing", `${path}.contextualRecognition`, "Required contextual_recognition has no acquisition-eligible task.");
  }

  inventory.meaningToFormRecall.forEach((task, index) =>
    validateRecallTask(issues, task, lexemeForms, `${path}.meaningToFormRecall.${index}`));
  if (!inventory.meaningToFormRecall.some((task) => task.eligiblePurposes.includes("acquisition_gate"))) {
    issues.add("incomplete", "capability.recall_task_missing", `${path}.meaningToFormRecall`, "Required meaning_to_form_recall has no acquisition-eligible task.");
  }

  const transferExamples = item.examples.filter((example) => example.roles.includes("transfer_assessment"));
  if (!item.examples.some((example) => example.roles.includes("study_binding"))) {
    issues.add("incomplete", "delivery.study_example_missing", `${path}.examples`, "At least one Study Binding Example is required.");
  }
  if (!item.examples.some((example) => example.roles.includes("usage_illustration") && example.visibility === "learning_only")) {
    issues.add("incomplete", "delivery.usage_example_missing", `${path}.examples`, "At least one learning-only usage illustration Example is required.");
  }
  if (!item.examples.some((example) => example.roles.includes("recognition_assessment"))) {
    issues.add("incomplete", "delivery.recognition_example_missing", `${path}.examples`, "At least one Recognition Example is required.");
  }
  const transferTasksByExample = new Map<string, number>();
  inventory.novelContextTransfer.forEach((task, index) => {
    transferTasksByExample.set(task.exampleKey, (transferTasksByExample.get(task.exampleKey) ?? 0) + 1);
    validateTransferTask(issues, task, lexemeForms, exampleByKey, `${path}.novelContextTransfer.${index}`);
  });
  transferExamples.forEach((example) => {
    if ((transferTasksByExample.get(example.exampleKey) ?? 0) === 0) {
      issues.add("invalid", "assessment.transfer_task_missing", `${path}.novelContextTransfer`, `Transfer Example has no corresponding task: ${example.exampleKey}`);
    }
  });
  if (transferExamples.length < 5) {
    issues.add("incomplete", "delivery.transfer_pool_small", `${path}.novelContextTransfer`, "Draft V2 requires at least five protected Transfer Examples.");
  }
  if (new Set(transferExamples.map((example) => example.scenarioFamily)).size < 3) {
    issues.add("incomplete", "delivery.transfer_variation_small", `${path}.novelContextTransfer`, "Protected Transfer must cover at least three scenario families.");
  }
  if (inventory.novelContextTransfer.filter((task) => task.eligiblePurposes.includes("acquisition_gate")).length === 0) {
    issues.add("incomplete", "capability.transfer_task_missing", `${path}.novelContextTransfer`, "Required novel_context_transfer has no acquisition-eligible task.");
  }
  const retentionEligible = [
    ...inventory.contextualRecognition,
    ...inventory.meaningToFormRecall,
    ...inventory.novelContextTransfer,
    ...inventory.boundaryContrast,
  ].filter((task) => task.eligiblePurposes.includes("retention_review") || task.eligiblePurposes.includes("relearning_gate"));
  if (retentionEligible.length === 0) {
    issues.add("incomplete", "assessment.retention_eligibility_missing", path, "Assessment inventory must expose at least one retention or relearning purpose.");
  }

  inventory.boundaryContrast.forEach((task, index) =>
    validateBoundaryTask(issues, task, item.identity.senseKey, relationByKey, exampleByKey, `${path}.boundaryContrast.${index}`));
  const requiredBoundaryRelations = item.acquisitionProfile.requiredCapabilities
    .filter((capability): capability is Extract<typeof capability, { kind: "boundary_discrimination" }> => capability.kind === "boundary_discrimination")
    .map((capability) => capability.relationKey);
  requiredBoundaryRelations.forEach((relationKey) => {
    if (!inventory.boundaryContrast.some((task) => task.relationKey === relationKey && task.eligiblePurposes.includes("acquisition_gate"))) {
      issues.add("invalid", "capability.boundary_task_missing", `${path}.boundaryContrast`, `Required Boundary relation has no acquisition-eligible task: ${relationKey}`);
    }
  });
}

function validatePackageV2(
  issues: Issues,
  item: SensaAuthoringSensePackageDraftV2,
  bundle: SensaGoldenContentDraftV2Bundle,
  index: number,
): void {
  const path = `packages.${index}`;
  const sourceKeys = new Set(bundle.sources.map((source) => source.sourceKey));
  const lexeme = bundle.lexemes.find((candidate) =>
    candidate.lexemeKey === item.identity.lexemeKey && candidate.version === item.identity.lexemeVersion);
  if (lexeme === undefined) {
    issues.add("invalid", "reference.lexeme_missing", `${path}.identity.lexemeKey`, `Unknown pinned Lexeme: ${item.identity.lexemeKey}@${item.identity.lexemeVersion}`);
    return;
  }
  const exampleByKey = new Map(item.examples.map((example) => [example.exampleKey, example]));
  validateExperienceHiddenForms(issues, item, lexeme.forms, `${path}.experience`);
  validateRecap(issues, item, lexeme.forms, sourceKeys, `${path}.experience.recap`);
  validateUnique(issues, item.examples.map((example) => example.exampleKey), `${path}.examples`);
  item.examples.forEach((example, exampleIndex) =>
    validateExampleV2(issues, example, lexeme.forms, `${path}.examples.${exampleIndex}`));
  validateUnique(
    issues,
    item.usagePatterns.flatMap((pattern) => pattern.collocations.map((collocation) => collocation.collocationKey)),
    `${path}.usagePatterns.collocationKey`,
  );
  validateUnique(
    issues,
    item.usagePatterns.flatMap((pattern) => pattern.collocations.flatMap((collocation) =>
      collocation.exampleBindings.map((binding) => binding.bindingKey))),
    `${path}.usagePatterns.exampleBindingKey`,
  );
  validateUsagePattern(
    issues,
    item.usagePatterns[0] ?? {
      patternKey: "missing.pattern",
      canonicalPattern: "missing",
      registerLabel: null,
      domainLabel: null,
      usageRestriction: null,
      collocations: [],
      provenance: item.provenance,
    },
    item,
    exampleByKey,
    sourceKeys,
    `${path}.usagePatterns.0`,
  );
  item.usagePatterns.slice(1).forEach((pattern, patternIndex) =>
    validateUsagePattern(issues, pattern, item, exampleByKey, sourceKeys, `${path}.usagePatterns.${patternIndex + 1}`));
  validateAssessmentInventory(issues, item, bundle, lexeme.forms, sourceKeys, `${path}.assessmentInventory`);
  validateRepairBindings(issues, item, bundle, exampleByKey, sourceKeys, `${path}.repairBindings`);
}

function validateBundleV2(bundle: SensaGoldenContentDraftV2Bundle, issues: Issues): void {
  validateUnique(issues, bundle.sources.map((source) => source.sourceKey), "sources");
  validateUnique(issues, bundle.media.map((media) => media.mediaKey), "media");
  validateUnique(issues, bundle.lexemes.map((lexeme) => lexeme.lexemeKey), "lexemes");
  validateUnique(issues, bundle.relations.map((relation) => relation.relationKey), "relations");
  validateUnique(issues, bundle.packages.map((item) => item.identity.packageKey), "packages.packageKey");
  validateUnique(issues, bundle.packages.map((item) => item.identity.senseKey), "packages.senseKey");
  const packageBySense = new Set(bundle.packages.map((item) => item.identity.senseKey));
  bundle.relations.forEach((relation, relationIndex) => {
    if (!packageBySense.has(relation.sourceSenseKey) || !packageBySense.has(relation.targetSenseKey)) {
      issues.add("invalid", "reference.relation_sense_missing", `relations.${relationIndex}`, "Both relation Senses must exist in this Golden Bundle.");
    }
    if (relation.scope === "cross_word") {
      const sourceLexeme = bundle.packages.find((item) => item.identity.senseKey === relation.sourceSenseKey)?.identity.lexemeKey;
      const targetLexeme = bundle.packages.find((item) => item.identity.senseKey === relation.targetSenseKey)?.identity.lexemeKey;
      if (sourceLexeme === undefined || targetLexeme === undefined || sourceLexeme === targetLexeme) {
        issues.add("invalid", "relation.scope_mismatch", `relations.${relationIndex}.scope`, "Cross-word Relation must connect different Lexemes.");
      }
    }
  });
  bundle.packages.forEach((item, index) => validatePackageV2(issues, item, bundle, index));
}

/**
 * The only public operation of the Draft V2 authoring module. It is a pure,
 * deterministic preview validator: no database, network, model, media or
 * runtime state is consulted.
 */
export function validateGoldenContentDraftV2(input: unknown): SensaGoldenContentDraftV2ValidationResult {
  const parsed = sensaGoldenContentDraftV2BundleSchema.safeParse(input);
  if (!parsed.success) {
    const structuralIssues = parsed.error.issues.map((issue): SensaGoldenContentDraftV2ValidationIssue => ({
      severity: "invalid",
      code: `schema.${issue.code}`,
      path: issue.path.join("."),
      message: issue.message,
    })).sort((left, right) =>
      left.code.localeCompare(right.code)
      || left.path.localeCompare(right.path)
      || left.message.localeCompare(right.message));
    return {
      status: "invalid",
      previewable: false,
      validatorVersion: sensaGoldenContentDraftV2ValidatorVersion,
      bundle: null,
      issues: structuralIssues,
    };
  }

  const issues = new Issues();
  const v1Result = validateGoldenContentBundle(projectToV1(parsed.data));
  v1Result.issues.forEach((issue) => issues.addV1(issue));
  validateBundleV2(parsed.data, issues);
  const resultIssues = issues.result();
  const status: SensaGoldenContentDraftV2ValidationStatus = issues.hasInvalid
    ? "invalid"
    : resultIssues.some((issue) => issue.severity === "incomplete")
      ? "incomplete"
      : "satisfied";
  return {
    status,
    previewable: status !== "invalid",
    validatorVersion: sensaGoldenContentDraftV2ValidatorVersion,
    bundle: parsed.data,
    issues: resultIssues,
  };
}
