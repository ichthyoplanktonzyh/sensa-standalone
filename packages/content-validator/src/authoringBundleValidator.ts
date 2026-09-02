import {
  sensaGoldenContentBundleSchema,
  type SensaAuthoringAcquisitionProfile,
  type SensaAuthoringAssetProvenance,
  type SensaAuthoringExperienceRender,
  type SensaAuthoringExperienceRenderPlan,
  type SensaAuthoringLearningExample,
  type SensaAuthoringReview,
  type SensaAuthoringSensePackage,
  type SensaGoldenContentBundle,
} from "@sensa/contracts/sensa";

export const sensaGoldenContentValidatorVersion =
  "sensa-golden-content-validator-v1" as const;

export type SensaGoldenContentValidationStatus =
  | "invalid"
  | "incomplete"
  | "satisfied";

export type SensaGoldenContentValidationIssue = Readonly<{
  severity: "invalid" | "incomplete";
  code: string;
  path: string;
  message: string;
}>;

export type SensaGoldenContentValidationResult = Readonly<{
  status: SensaGoldenContentValidationStatus;
  previewable: boolean;
  validatorVersion: typeof sensaGoldenContentValidatorVersion;
  bundle: SensaGoldenContentBundle | null;
  issues: readonly SensaGoldenContentValidationIssue[];
}>;

class Issues {
  readonly #values: SensaGoldenContentValidationIssue[] = [];

  add(
    severity: SensaGoldenContentValidationIssue["severity"],
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

  get hasInvalid(): boolean {
    return this.#values.some((issue) => issue.severity === "invalid");
  }

  result(): readonly SensaGoldenContentValidationIssue[] {
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

function validateReview(issues: Issues, review: SensaAuthoringReview, path: string): void {
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
  provenance: SensaAuthoringAssetProvenance,
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

function validateAcquisitionProfile(
  issues: Issues,
  profile: SensaAuthoringAcquisitionProfile,
  item: SensaAuthoringSensePackage,
  bundle: SensaGoldenContentBundle,
  path: string,
): void {
  validateUnique(issues, profile.acquisitionNeeds, `${path}.acquisitionNeeds`);
  validateUnique(issues, profile.preferredPrimitives, `${path}.preferredPrimitives`);
  validateUnique(issues, profile.fallbackPrimitives, `${path}.fallbackPrimitives`);
  validateDisjoint(
    issues,
    profile.preferredPrimitives,
    profile.fallbackPrimitives,
    `${path}.fallbackPrimitives`,
    "profile.primitive_overlap",
    "Preferred and fallback Primitive sets must be disjoint",
  );

  const requirementKinds = profile.requiredCapabilities.map((requirement) => requirement.kind);
  validateUnique(issues, requirementKinds, `${path}.requiredCapabilities`);
  validateUnique(issues, profile.optionalCapabilities, `${path}.optionalCapabilities`);
  validateDisjoint(
    issues,
    requirementKinds,
    profile.optionalCapabilities,
    `${path}.optionalCapabilities`,
    "profile.capability_overlap",
    "Required and optional Acquisition Capability sets must be disjoint",
  );
  for (const required of [
    "contextual_recognition",
    "meaning_to_form_recall",
    "novel_context_transfer",
  ] as const) {
    if (!requirementKinds.includes(required)) {
      issues.add("incomplete", "capability.baseline_missing", `${path}.requiredCapabilities`, `Missing baseline capability: ${required}`);
    }
  }

  validateUnique(issues, profile.requiredAssetCapabilities, `${path}.requiredAssetCapabilities`);
  validateUnique(issues, profile.optionalAssetCapabilities, `${path}.optionalAssetCapabilities`);
  validateDisjoint(
    issues,
    profile.requiredAssetCapabilities,
    profile.optionalAssetCapabilities,
    `${path}.optionalAssetCapabilities`,
    "profile.asset_capability_overlap",
    "Required and optional Asset Capability sets must be disjoint",
  );

  if (profile.domainBound && profile.domainConstraints.length === 0) {
    issues.add("invalid", "profile.domain_constraints_missing", `${path}.domainConstraints`, "A domain-bound Profile requires at least one domain constraint.");
  }
  if (!profile.domainBound && profile.domainConstraints.length > 0) {
    issues.add("invalid", "profile.domain_constraints_unscoped", `${path}.domainConstraints`, "Domain constraints require domainBound=true.");
  }

  validateUnique(issues, profile.boundaryTargets.map((target) => target.relationKey), `${path}.boundaryTargets`);
  const relationByKey = new Map(bundle.relations.map((relation) => [relation.relationKey, relation]));
  const requiredBoundaryRelations = new Set(
    profile.requiredCapabilities
      .filter((requirement) => requirement.kind === "boundary_discrimination")
      .map((requirement) => requirement.relationKey),
  );
  const declaredRequiredTargets = new Set(
    profile.boundaryTargets.filter((target) => target.isRequired).map((target) => target.relationKey),
  );

  profile.boundaryTargets.forEach((target, targetIndex) => {
    const relation = relationByKey.get(target.relationKey);
    if (relation === undefined) {
      issues.add("invalid", "reference.relation_missing", `${path}.boundaryTargets.${targetIndex}.relationKey`, `Unknown relation: ${target.relationKey}`);
    } else if (relation.sourceSenseKey !== item.identity.senseKey && relation.targetSenseKey !== item.identity.senseKey) {
      issues.add("invalid", "reference.relation_target_mismatch", `${path}.boundaryTargets.${targetIndex}.relationKey`, "Boundary relation must involve the Package Sense.");
    }
    if (target.isRequired && !requiredBoundaryRelations.has(target.relationKey)) {
      issues.add("invalid", "profile.boundary_requirement_missing", `${path}.boundaryTargets.${targetIndex}`, "A required Boundary target must have a matching required Acquisition Capability.");
    }
  });

  profile.requiredCapabilities.forEach((requirement, requirementIndex) => {
    if (requirement.kind !== "boundary_discrimination") return;
    if (!declaredRequiredTargets.has(requirement.relationKey)) {
      issues.add("invalid", "profile.boundary_target_missing", `${path}.requiredCapabilities.${requirementIndex}.relationKey`, "Boundary discrimination requires a matching required Boundary target.");
    }
  });

  const needsBoundary = profile.acquisitionNeeds.includes("boundary_formation")
    || profile.requiredAssetCapabilities.some((capability) =>
      capability === "boundary_contrast" || capability === "counterexample");
  if (needsBoundary && declaredRequiredTargets.size === 0) {
    issues.add("invalid", "profile.boundary_target_missing", `${path}.boundaryTargets`, "Boundary acquisition requires at least one reviewed required target.");
  }
}

function validateExperienceRenderPlan(
  issues: Issues,
  profile: SensaAuthoringAcquisitionProfile,
  renders: readonly SensaAuthoringExperienceRender[],
  plan: SensaAuthoringExperienceRenderPlan,
  deliveryProfileVersion: string,
  path: string,
): void {
  const renderByKey = new Map(renders.map((render) => [render.renderKey, render]));
  validateUnique(issues, plan.selections.map((selection) => selection.renderKey), `${path}.selections`);
  validateUnique(issues, plan.selections.map((selection) => `${selection.role}:${selection.rank}`), `${path}.selections.rank`);

  const authorizedPrimitives = new Set([
    ...profile.preferredPrimitives,
    ...profile.fallbackPrimitives,
  ]);
  renders.forEach((render, renderIndex) => {
    validateUnique(issues, render.supportedDeliveryProfiles, `${path.replace(/\.renderPlan$/u, ".renders")}.${renderIndex}.supportedDeliveryProfiles`);
    if (!authorizedPrimitives.has(render.primitive)) {
      issues.add("invalid", "render.primitive_unauthorized", `${path.replace(/\.renderPlan$/u, ".renders")}.${renderIndex}.primitive`, `Render Primitive is not declared by its Acquisition Profile: ${render.primitive}`);
    }
  });

  plan.selections.forEach((selection, selectionIndex) => {
    const render = renderByKey.get(selection.renderKey);
    if (render === undefined) {
      issues.add("invalid", "reference.render_missing", `${path}.selections.${selectionIndex}.renderKey`, `Unknown Experience Render: ${selection.renderKey}`);
      return;
    }
    if (!render.supportedDeliveryProfiles.includes(deliveryProfileVersion)) {
      issues.add("invalid", "render.delivery_profile_unsupported", `${path}.selections.${selectionIndex}.renderKey`, `Render does not support delivery profile: ${deliveryProfileVersion}`);
    }
    if (selection.role === "preferred" && !profile.preferredPrimitives.includes(render.primitive)) {
      issues.add("invalid", "render.preferred_primitive_mismatch", `${path}.selections.${selectionIndex}.renderKey`, "A preferred Render must realize a preferred Acquisition Primitive.");
    }
  });

  renders.forEach((render, renderIndex) => {
    if (!plan.selections.some((selection) => selection.renderKey === render.renderKey)) {
      issues.add("invalid", "render.unclassified", `${path.replace(/\.renderPlan$/u, ".renders")}.${renderIndex}.renderKey`, "Every approved Experience Render must be classified by the Render Plan.");
    }
  });

  const preferredSelections = plan.selections.filter((selection) => selection.role === "preferred");
  if (preferredSelections.length !== 1) {
    issues.add("invalid", "render.preferred_count_invalid", `${path}.selections`, "An Experience Render Plan requires exactly one preferred path.");
  }
  const preferredRender = preferredSelections.length === 1
    ? renderByKey.get(preferredSelections[0]!.renderKey)
    : undefined;
  const fallbackSelections = plan.selections.filter((selection) => selection.role === "fallback");
  if (preferredRender !== undefined
    && preferredRender.kind !== "text"
    && !fallbackSelections.some((selection) => renderByKey.get(selection.renderKey)?.kind === "text")) {
    issues.add("invalid", "render.text_scene_fallback_missing", `${path}.selections`, "A non-text preferred Render requires an approved Text Experience Render fallback.");
  }
}

function validateExample(
  issues: Issues,
  example: SensaAuthoringLearningExample,
  mediaKinds: ReadonlyMap<string, "image" | "audio">,
  sourceKeys: ReadonlySet<string>,
  path: string,
): void {
  const { start, end, surface } = example.target;
  if (end > example.textL2.length || example.textL2.slice(start, end) !== surface) {
    issues.add(
      "invalid",
      "example.target_span_invalid",
      `${path}.target`,
      "Target start/end must select the exact declared surface form.",
    );
  }
  validateUnique(issues, example.roles, `${path}.roles`);
  validateUnique(issues, example.renders.map((render) => render.renderKey), `${path}.renders`);
  if (!example.renders.some((render) => render.kind === "text")) {
    issues.add("invalid", "example.text_render_missing", `${path}.renders`, "Every Example requires an approved text render path.");
  }

  const hasTransfer = example.roles.includes("transfer_assessment");
  if (hasTransfer && example.visibility !== "assessment_only") {
    issues.add("invalid", "example.transfer_not_protected", `${path}.visibility`, "Transfer assessment resources must be assessment-only.");
  }
  if (hasTransfer && example.roles.some((role) => role !== "transfer_assessment" && role !== "retention_assessment")) {
    issues.add("invalid", "example.transfer_role_conflict", `${path}.roles`, "Protected Transfer cannot also teach, repair, recognize, or enter Free Practice.");
  }
  if (example.visibility === "assessment_only" && example.roles.some((role) =>
    role === "study_binding" || role === "retrieval_repair" || role === "free_practice")) {
    issues.add("invalid", "example.visibility_role_conflict", `${path}.roles`, "Assessment-only resources cannot have teaching, repair, or Free Practice roles.");
  }

  example.renders.forEach((render, renderIndex) => {
    if (render.kind === "static_audio") {
      const mediaKind = mediaKinds.get(render.mediaKey);
      if (mediaKind === undefined) {
        issues.add("invalid", "reference.media_missing", `${path}.renders.${renderIndex}.mediaKey`, `Unknown media: ${render.mediaKey}`);
      } else if (mediaKind !== "audio") {
        issues.add("invalid", "reference.media_kind_mismatch", `${path}.renders.${renderIndex}.mediaKey`, "Static audio Render must reference audio media.");
      }
    }
  });
  validateProvenance(issues, example.provenance, sourceKeys, `${path}.provenance`);
}

function validateAssetCapabilityClaims(
  issues: Issues,
  item: SensaAuthoringSensePackage,
  lexeme: SensaGoldenContentBundle["lexemes"][number],
  mediaKinds: ReadonlyMap<string, "image" | "audio">,
  path: string,
): void {
  const provided = new Set<string>();
  if (item.experience.renders.length > 0) provided.add("meaning_grounding");
  provided.add("l1_mediation");
  if (item.usagePatterns.length > 0) provided.add("usage_pattern");
  if (new Set(item.examples.map((example) => example.scenarioFamily)).size >= 2) {
    provided.add("contextual_variation");
  }
  if (lexeme.pronunciations.some((pronunciation) =>
    pronunciation.mediaKey !== null && mediaKinds.get(pronunciation.mediaKey) === "audio")) {
    provided.add("pronunciation");
  }
  if (item.examples.some((example) =>
    example.roles.includes("study_binding")
    && example.renders.some((render) => render.kind === "static_audio"))) {
    provided.add("study_example_audio");
  }
  if (item.experience.renders.some((render) => render.primitive === "visual_grounding")) {
    provided.add("visual_grounding");
  }
  if (item.experience.renders.some((render) => render.primitive === "spatial_relation")) {
    provided.add("spatial_grounding");
  }
  if (item.experience.renders.some((render) => render.primitive === "causal_sequence")) {
    provided.add("causal_grounding");
  }
  if (item.experience.renders.some((render) => render.primitive === "temporal_sequence")) {
    provided.add("temporal_grounding");
  }

  item.acquisitionProfile.requiredAssetCapabilities.forEach((capability, capabilityIndex) => {
    if (!provided.has(capability)) {
      issues.add(
        "incomplete",
        "capability.required_asset_missing",
        `${path}.requiredAssetCapabilities.${capabilityIndex}`,
        `No authored resource currently resolves required Asset Capability: ${capability}`,
      );
    }
  });
}

function packageResourceKeys(item: SensaAuthoringSensePackage): ReadonlySet<string> {
  return new Set([
    item.experience.sketch.sketchKey,
    ...item.experience.renders.map((render) => render.renderKey),
    item.l1Bridge.assetKey,
    ...item.examples.map((example) => example.exampleKey),
    ...item.examples.flatMap((example) => example.renders.map((render) => render.renderKey)),
    ...item.usagePatterns.map((pattern) => pattern.patternKey),
  ]);
}

function validatePackage(
  issues: Issues,
  item: SensaAuthoringSensePackage,
  bundle: SensaGoldenContentBundle,
  index: number,
): void {
  const path = `packages.${index}`;
  const sourceKeys = new Set(bundle.sources.map((source) => source.sourceKey));
  const mediaKinds = new Map(bundle.media.map((media) => [media.mediaKey, media.kind]));
  const lexeme = bundle.lexemes.find((candidate) => candidate.lexemeKey === item.identity.lexemeKey);

  if (lexeme === undefined) {
    issues.add("invalid", "reference.lexeme_missing", `${path}.identity.lexemeKey`, `Unknown Lexeme: ${item.identity.lexemeKey}`);
    return;
  }
  if (lexeme.version !== item.identity.lexemeVersion) {
    issues.add("invalid", "reference.lexeme_version_mismatch", `${path}.identity.lexemeVersion`, "Package must pin the authored Lexeme version.");
  }
  if (item.identity.targetLanguage !== bundle.release.targetLanguage
    || item.identity.learnerLocale !== bundle.release.learnerLocale) {
    issues.add("invalid", "reference.locale_mismatch", `${path}.identity`, "Package locale must match its Content Bundle release.");
  }

  validateAcquisitionProfile(
    issues,
    item.acquisitionProfile,
    item,
    bundle,
    `${path}.acquisitionProfile`,
  );

  const sketchText = [
    item.experience.sketch.experienceGoal,
    ...item.experience.sketch.focalStructure,
    item.experience.sketch.learnerInference,
    ...item.experience.sketch.constraints.mustConvey,
    ...item.experience.sketch.constraints.mustAvoid,
    ...item.experience.renders.flatMap((render) => {
      if (render.kind === "text") return [render.sceneL1];
      if (render.kind === "image") return [render.altTextL1];
      if (render.kind === "sequence") return [
        ...render.steps.flatMap((step) => [step.label, step.description]),
      ];
      return [...collectStringLeaves(render.payload)];
    }),
  ].join(" ");
  if (containsTargetForm(sketchText, [lexeme.lemma, ...lexeme.forms])) {
    issues.add("invalid", "experience.target_form_leak", `${path}.experience`, "Experience Sketch and Renders must hide every target form.");
  }
  const experienceRenderKeys = item.experience.renders.map((render) => render.renderKey);
  validateUnique(issues, experienceRenderKeys, `${path}.experience.renders`);
  item.experience.renders.forEach((render, renderIndex) => {
    if (render.kind === "image") {
      const mediaKind = mediaKinds.get(render.mediaKey);
      if (mediaKind === undefined) {
        issues.add("invalid", "reference.media_missing", `${path}.experience.renders.${renderIndex}.mediaKey`, `Unknown media: ${render.mediaKey}`);
      } else if (mediaKind !== "image") {
        issues.add("invalid", "reference.media_kind_mismatch", `${path}.experience.renders.${renderIndex}.mediaKey`, "Image Render must reference image media.");
      }
    }
    validateProvenance(issues, render.provenance, sourceKeys, `${path}.experience.renders.${renderIndex}.provenance`);
  });
  validateExperienceRenderPlan(
    issues,
    item.acquisitionProfile,
    item.experience.renders,
    item.experience.renderPlan,
    bundle.release.deliveryProfileVersion,
    `${path}.experience.renderPlan`,
  );
  validateProvenance(issues, item.experience.sketch.provenance, sourceKeys, `${path}.experience.sketch.provenance`);
  validateProvenance(issues, item.l1Bridge.provenance, sourceKeys, `${path}.l1Bridge.provenance`);
  validateProvenance(issues, item.acquisitionProfile.provenance, sourceKeys, `${path}.acquisitionProfile.provenance`);
  validateProvenance(issues, item.provenance, sourceKeys, `${path}.provenance`);

  validateUnique(issues, item.examples.map((example) => example.exampleKey), `${path}.examples`);
  item.examples.forEach((example, exampleIndex) => {
    validateExample(issues, example, mediaKinds, sourceKeys, `${path}.examples.${exampleIndex}`);
  });

  const studyExamples = item.examples.filter((example) => example.roles.includes("study_binding"));
  const recognitionExamples = item.examples.filter((example) => example.roles.includes("recognition_assessment"));
  const transferExamples = item.examples.filter((example) => example.roles.includes("transfer_assessment"));
  if (studyExamples.length === 0) {
    issues.add("incomplete", "delivery.study_example_missing", `${path}.examples`, "At least one Study Binding Example is required.");
  }
  if (recognitionExamples.length === 0) {
    issues.add("incomplete", "delivery.recognition_example_missing", `${path}.examples`, "At least one Contextual Recognition Example is required.");
  }
  if (transferExamples.length < 5) {
    issues.add("incomplete", "delivery.transfer_pool_small", `${path}.examples`, "The prototype V1 profile requires at least five protected Transfer Examples.");
  }
  if (new Set(transferExamples.map((example) => example.scenarioFamily)).size < 3) {
    issues.add("incomplete", "delivery.transfer_variation_small", `${path}.examples`, "Protected Transfer must cover at least three scenario families.");
  }

  validateUnique(issues, item.usagePatterns.map((pattern) => pattern.patternKey), `${path}.usagePatterns`);
  item.usagePatterns.forEach((pattern, patternIndex) => {
    validateProvenance(issues, pattern.provenance, sourceKeys, `${path}.usagePatterns.${patternIndex}.provenance`);
  });
  validateAssetCapabilityClaims(
    issues,
    item,
    lexeme,
    mediaKinds,
    `${path}.acquisitionProfile`,
  );

  if (item.practiceManifest !== undefined) {
    const resourceKeys = packageResourceKeys(item);
    const examplesByKey = new Map(item.examples.map((example) => [example.exampleKey, example]));
    validateUnique(issues, item.practiceManifest.grants.map((grant) => grant.taskFamily), `${path}.practiceManifest.grants`);
    item.practiceManifest.grants.forEach((grant, grantIndex) => {
      grant.resourceKeys.forEach((resourceKey, resourceIndex) => {
        if (!resourceKeys.has(resourceKey)) {
          issues.add("invalid", "reference.practice_resource_missing", `${path}.practiceManifest.grants.${grantIndex}.resourceKeys.${resourceIndex}`, `Unknown Package resource: ${resourceKey}`);
        }
        const example = examplesByKey.get(resourceKey);
        if (example?.visibility === "assessment_only") {
          issues.add("invalid", "practice.assessment_resource_exposed", `${path}.practiceManifest.grants.${grantIndex}.resourceKeys.${resourceIndex}`, "Free Practice cannot expose assessment-only resources.");
        }
        if (example !== undefined && !example.roles.includes("free_practice")) {
          issues.add("invalid", "practice.example_role_missing", `${path}.practiceManifest.grants.${grantIndex}.resourceKeys.${resourceIndex}`, "Example requires an explicit Free Practice role.");
        }
      });
    });
  }
}

function validateBundle(bundle: SensaGoldenContentBundle, issues: Issues): void {
  validateUnique(issues, bundle.sources.map((item) => item.sourceKey), "sources");
  validateUnique(issues, bundle.media.map((item) => item.mediaKey), "media");
  validateUnique(issues, bundle.lexemes.map((item) => item.lexemeKey), "lexemes");
  validateUnique(issues, bundle.packages.map((item) => item.identity.packageKey), "packages.packageKey");
  validateUnique(issues, bundle.packages.map((item) => item.identity.senseKey), "packages.senseKey");
  validateUnique(issues, bundle.relations.map((item) => item.relationKey), "relations");

  const sourceKeys = new Set(bundle.sources.map((item) => item.sourceKey));
  const mediaKinds = new Map(bundle.media.map((item) => [item.mediaKey, item.kind]));
  const senseToLexeme = new Map(bundle.packages.map((item) => [item.identity.senseKey, item.identity.lexemeKey]));

  bundle.lexemes.forEach((lexeme, lexemeIndex) => {
    validateUnique(issues, lexeme.forms.map((form) => form.toLocaleLowerCase("und")), `lexemes.${lexemeIndex}.forms`);
    if (![lexeme.lemma, ...lexeme.forms].some((form) => form.toLocaleLowerCase("und") === lexeme.lemma.toLocaleLowerCase("und"))) {
      issues.add("invalid", "lexeme.lemma_form_missing", `lexemes.${lexemeIndex}.forms`, "Lexeme forms must include the canonical lemma.");
    }
    validateUnique(issues, lexeme.pronunciations.map((item) => item.pronunciationKey), `lexemes.${lexemeIndex}.pronunciations`);
    lexeme.pronunciations.forEach((pronunciation, pronunciationIndex) => {
      if (pronunciation.mediaKey !== null) {
        const mediaKind = mediaKinds.get(pronunciation.mediaKey);
        if (mediaKind === undefined) {
          issues.add("invalid", "reference.media_missing", `lexemes.${lexemeIndex}.pronunciations.${pronunciationIndex}.mediaKey`, `Unknown media: ${pronunciation.mediaKey}`);
        } else if (mediaKind !== "audio") {
          issues.add("invalid", "reference.media_kind_mismatch", `lexemes.${lexemeIndex}.pronunciations.${pronunciationIndex}.mediaKey`, "Pronunciation must reference audio media.");
        }
      }
    });
    validateProvenance(issues, lexeme.provenance, sourceKeys, `lexemes.${lexemeIndex}.provenance`);
  });

  bundle.media.forEach((media, mediaIndex) => {
    validateProvenance(issues, media.provenance, sourceKeys, `media.${mediaIndex}.provenance`);
  });

  bundle.relations.forEach((relation, relationIndex) => {
    const sourceLexeme = senseToLexeme.get(relation.sourceSenseKey);
    const targetLexeme = senseToLexeme.get(relation.targetSenseKey);
    if (sourceLexeme === undefined || targetLexeme === undefined) {
      issues.add("invalid", "reference.relation_sense_missing", `relations.${relationIndex}`, "Both relation Senses must exist in this Golden Bundle.");
    } else {
      const expectedScope = sourceLexeme === targetLexeme ? "intra_word" : "cross_word";
      if (relation.scope !== expectedScope) {
        issues.add("invalid", "relation.scope_mismatch", `relations.${relationIndex}.scope`, `Relation scope must be ${expectedScope}.`);
      }
    }
    validateProvenance(issues, relation.provenance, sourceKeys, `relations.${relationIndex}.provenance`);
  });

  bundle.packages.forEach((item, index) => validatePackage(issues, item, bundle, index));

  if (bundle.release.status === "approved") {
    const hasDraft = issues.result().some((issue) => issue.code === "review.pending");
    if (hasDraft) {
      issues.add("invalid", "release.contains_draft", "release.status", "An approved Bundle cannot contain draft resources.");
    }
  }
}

/**
 * The only interface needed by authoring previews and tests. It hides Zod
 * parsing, cross-reference checks, visibility isolation and delivery-profile
 * completeness behind one deterministic result.
 */
export function validateGoldenContentBundle(input: unknown): SensaGoldenContentValidationResult {
  const parsed = sensaGoldenContentBundleSchema.safeParse(input);
  if (!parsed.success) {
    const structuralIssues = parsed.error.issues.map((issue): SensaGoldenContentValidationIssue => ({
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
      validatorVersion: sensaGoldenContentValidatorVersion,
      bundle: null,
      issues: structuralIssues,
    };
  }

  const issues = new Issues();
  validateBundle(parsed.data, issues);
  const resultIssues = issues.result();
  const status: SensaGoldenContentValidationStatus = issues.hasInvalid
    ? "invalid"
    : resultIssues.some((issue) => issue.severity === "incomplete")
      ? "incomplete"
      : "satisfied";
  return {
    status,
    previewable: status !== "invalid",
    validatorVersion: sensaGoldenContentValidatorVersion,
    bundle: parsed.data,
    issues: resultIssues,
  };
}
