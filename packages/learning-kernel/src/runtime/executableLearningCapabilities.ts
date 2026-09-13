import {
  sensaExecutableLearningCapabilityResolverVersion,
  type SensaExecutableLearningCapabilityResolverVersion,
} from "./executableLearningCapabilityVocabulary.js";

export type SensaAcquisitionPrimitive =
  | "visual_grounding"
  | "motion_grounding"
  | "spatial_relation"
  | "causal_sequence"
  | "temporal_sequence"
  | "social_micro_scenario"
  | "introspective_scenario"
  | "contrast_pair"
  | "counterexample"
  | "contextual_variation"
  | "production_cue";

export const sensaExecutableLearningCapabilityCodes = Object.freeze([
  "grounding_experience",
  "boundary_contrast",
  "meaning_to_form_cue",
  "cloze_context",
  "retrieval_repair_support",
] as const);

export type SensaExecutableLearningCapabilityCode =
  typeof sensaExecutableLearningCapabilityCodes[number];

export type SensaCapabilityResolutionIssueCode =
  | "profile_primitive_unknown"
  | "required_asset_capability_unknown"
  | "required_asset_capability_not_executable"
  | "baseline_experience_missing"
  | "baseline_experience_ambiguous"
  | "baseline_l1_bridge_missing"
  | "baseline_l1_bridge_ambiguous"
  | "baseline_study_examples_missing"
  | "baseline_study_examples_ambiguous"
  | "baseline_pronunciation_missing"
  | "baseline_study_audio_missing"
  | "baseline_study_audio_ambiguous"
  | "required_boundary_target_missing"
  | "required_boundary_asset_missing"
  | "required_counterexample_missing"
  | "required_cloze_context_missing";

export type SensaCapabilityResolutionIssue = Readonly<{
  code: SensaCapabilityResolutionIssueCode;
  severity: "incomplete" | "invalid";
}>;

export type SensaCapabilityAssetSnapshot = Readonly<{
  assetId: string;
  kind: string;
  text: string | null;
  exampleOrdinal: number | null;
  exampleRole: string | null;
  exampleText: string | null;
  exampleTargetStart: number | null;
  exampleTargetEnd: number | null;
  boundaryRelationId: string | null;
  positiveText: string | null;
  negativeText: string | null;
  sourceExampleAssetId: string | null;
}>;

export type SensaLearningPackageCapabilitySnapshot = Readonly<{
  profile: Readonly<{
    acquisitionNeeds: readonly string[];
    preferredPrimitives: readonly string[];
    fallbackPrimitives: readonly string[];
    requiredAssetCapabilities: readonly string[];
    optionalAssetCapabilities: readonly string[];
  }>;
  boundaryTargets: ReadonlyArray<{
    relationId: string;
    ordinal: number;
    required: boolean;
  }>;
  assets: readonly SensaCapabilityAssetSnapshot[];
}>;

export type SensaGroundingPrimitiveResolution =
  | "profile_preferred"
  | "profile_fallback"
  | "runtime_baseline_fallback";

export type SensaBoundaryCapabilityCandidate = Readonly<{
  assetId: string;
  primitive: "contrast_pair" | "counterexample";
  relationId: string;
  targetOrdinal: number;
}>;

export type SensaExecutableLearningCapabilityInventory = Readonly<{
  availableCapabilityCodes: readonly SensaExecutableLearningCapabilityCode[];
  groundingExperience: Readonly<{
    capabilityCode: "grounding_experience";
    primitive: SensaAcquisitionPrimitive;
    primitiveResolution: SensaGroundingPrimitiveResolution;
    experienceSketchAssetId: string;
    l1BridgeAssetId: string;
    studyExampleAssetIds: readonly [string, string, string];
    pronunciationAssetId: string;
    studyAudioAssetIds: readonly [string, string, string];
  }>;
  boundaryContrast: Readonly<{
    capabilityCode: "boundary_contrast";
    primitives: readonly ("contrast_pair" | "counterexample")[];
    candidates: readonly SensaBoundaryCapabilityCandidate[];
  }> | null;
  meaningToFormCue: Readonly<{
    capabilityCode: "meaning_to_form_cue";
    experienceSketchAssetId: string;
  }>;
  clozeContext: Readonly<{
    capabilityCode: "cloze_context";
    quizExampleAssetIds: readonly string[];
  }> | null;
  retrievalRepairSupport: Readonly<{
    capabilityCode: "retrieval_repair_support";
    experienceSketchAssetId: string;
    l1BridgeAssetId: string;
    studyExampleAssetId: string;
    studyAudioAssetId: string;
  }>;
  contentOnlyRequiredCapabilities: readonly string[];
}>;

export type SensaCapabilityResolutionResult =
  | Readonly<{
      status: "executable";
      resolverVersion: SensaExecutableLearningCapabilityResolverVersion;
      inventory: SensaExecutableLearningCapabilityInventory;
      issues: readonly [];
    }>
  | Readonly<{
      status: "unavailable";
      resolverVersion: SensaExecutableLearningCapabilityResolverVersion;
      inventory: null;
      issues: readonly SensaCapabilityResolutionIssue[];
    }>;

export interface SensaExecutableLearningCapabilityModule {
  readonly version: SensaExecutableLearningCapabilityResolverVersion;
  resolve(
    snapshot: SensaLearningPackageCapabilitySnapshot,
  ): SensaCapabilityResolutionResult;
}

const acquisitionPrimitives = new Set<SensaAcquisitionPrimitive>([
  "visual_grounding",
  "motion_grounding",
  "spatial_relation",
  "causal_sequence",
  "temporal_sequence",
  "social_micro_scenario",
  "introspective_scenario",
  "contrast_pair",
  "counterexample",
  "contextual_variation",
  "production_cue",
]);

const knownAssetCapabilities = new Set([
  "meaning_grounding",
  "l1_mediation",
  "usage_pattern",
  "contextual_variation",
  "pronunciation",
  "study_example_audio",
  "boundary_contrast",
  "counterexample",
  "visual_grounding",
  "spatial_grounding",
  "causal_grounding",
  "temporal_grounding",
  "extended_audio",
]);

const contentOnlyCapabilities = new Set(["usage_pattern"]);
const executableRequiredCapabilities = new Set([
  "meaning_grounding",
  "l1_mediation",
  "contextual_variation",
  "pronunciation",
  "study_example_audio",
  "boundary_contrast",
  "counterexample",
]);

function nonEmpty(value: string | null): value is string {
  return value !== null && value.trim() !== "";
}

function validExample(asset: SensaCapabilityAssetSnapshot): boolean {
  return asset.kind === "example"
    && Number.isSafeInteger(asset.exampleOrdinal)
    && (asset.exampleOrdinal ?? 0) > 0
    && nonEmpty(asset.exampleText)
    && Number.isSafeInteger(asset.exampleTargetStart)
    && Number.isSafeInteger(asset.exampleTargetEnd)
    && (asset.exampleTargetStart ?? -1) >= 0
    && (asset.exampleTargetEnd ?? 0) > (asset.exampleTargetStart ?? -1)
    && (asset.exampleTargetEnd ?? Number.MAX_SAFE_INTEGER) <= asset.exampleText.length;
}

function compareAssets(
  left: SensaCapabilityAssetSnapshot,
  right: SensaCapabilityAssetSnapshot,
): number {
  return (left.exampleOrdinal ?? Number.MAX_SAFE_INTEGER)
      - (right.exampleOrdinal ?? Number.MAX_SAFE_INTEGER)
    || left.assetId.localeCompare(right.assetId);
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function issue(
  code: SensaCapabilityResolutionIssueCode,
  severity: SensaCapabilityResolutionIssue["severity"],
): SensaCapabilityResolutionIssue {
  return { code, severity };
}

function resolveGroundingPrimitive(
  preferred: readonly SensaAcquisitionPrimitive[],
  fallback: readonly SensaAcquisitionPrimitive[],
): Readonly<{
  primitive: SensaAcquisitionPrimitive;
  resolution: SensaGroundingPrimitiveResolution;
}> {
  // The current Action contract can execute the baseline Experience/L1/Example
  // bundle only. Advanced media assets remain content until an Action role and
  // renderer capability can actually carry them end to end.
  if (preferred.includes("production_cue")) {
    return { primitive: "production_cue", resolution: "profile_preferred" };
  }
  if (fallback.includes("production_cue")) {
    return { primitive: "production_cue", resolution: "profile_fallback" };
  }
  return { primitive: "production_cue", resolution: "runtime_baseline_fallback" };
}

export function resolveSensaExecutableLearningCapabilities(
  snapshot: SensaLearningPackageCapabilitySnapshot,
): SensaCapabilityResolutionResult {
  const issues: SensaCapabilityResolutionIssue[] = [];
  const addIssue = (
    code: SensaCapabilityResolutionIssueCode,
    severity: SensaCapabilityResolutionIssue["severity"],
  ): void => {
    if (!issues.some((candidate) => candidate.code === code)) {
      issues.push(issue(code, severity));
    }
  };

  const primitiveValues = [
    ...snapshot.profile.preferredPrimitives,
    ...snapshot.profile.fallbackPrimitives,
  ];
  for (const value of primitiveValues) {
    if (!acquisitionPrimitives.has(value as SensaAcquisitionPrimitive)) {
      addIssue("profile_primitive_unknown", "invalid");
    }
  }
  const preferred = snapshot.profile.preferredPrimitives.filter(
    (value): value is SensaAcquisitionPrimitive =>
      acquisitionPrimitives.has(value as SensaAcquisitionPrimitive),
  );
  const fallback = snapshot.profile.fallbackPrimitives.filter(
    (value): value is SensaAcquisitionPrimitive =>
      acquisitionPrimitives.has(value as SensaAcquisitionPrimitive),
  );

  const requiredCapabilities = unique(snapshot.profile.requiredAssetCapabilities);
  for (const capability of requiredCapabilities) {
    if (!knownAssetCapabilities.has(capability)) {
      addIssue("required_asset_capability_unknown", "invalid");
    } else if (
      !contentOnlyCapabilities.has(capability)
      && !executableRequiredCapabilities.has(capability)
    ) {
      addIssue("required_asset_capability_not_executable", "invalid");
    }
  }

  const experiences = snapshot.assets
    .filter((asset) => asset.kind === "experience_sketch" && nonEmpty(asset.text))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const bridges = snapshot.assets
    .filter((asset) => asset.kind === "l1_bridge" && nonEmpty(asset.text))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  if (experiences.length === 0) addIssue("baseline_experience_missing", "incomplete");
  if (experiences.length > 1) addIssue("baseline_experience_ambiguous", "invalid");
  if (bridges.length === 0) addIssue("baseline_l1_bridge_missing", "incomplete");
  if (bridges.length > 1) addIssue("baseline_l1_bridge_ambiguous", "invalid");

  const studyExamples = snapshot.assets
    .filter((asset) => validExample(asset) && asset.exampleRole === "study")
    .sort(compareAssets);
  if (studyExamples.length < 3) addIssue("baseline_study_examples_missing", "incomplete");
  if (studyExamples.length > 3) addIssue("baseline_study_examples_ambiguous", "invalid");

  const pronunciations = snapshot.assets
    .filter((asset) => asset.kind === "pronunciation_audio")
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  if (pronunciations.length === 0) addIssue("baseline_pronunciation_missing", "incomplete");

  const studyAudios: SensaCapabilityAssetSnapshot[] = [];
  for (const example of studyExamples.slice(0, 3)) {
    const matches = snapshot.assets
      .filter((asset) =>
        asset.kind === "study_example_audio"
        && asset.sourceExampleAssetId === example.assetId,
      )
      .sort((left, right) => left.assetId.localeCompare(right.assetId));
    if (matches.length === 0) addIssue("baseline_study_audio_missing", "incomplete");
    if (matches.length > 1) addIssue("baseline_study_audio_ambiguous", "invalid");
    if (matches[0] !== undefined) studyAudios.push(matches[0]);
  }

  const requiredTargets = snapshot.boundaryTargets
    .filter((target) => target.required)
    .sort((left, right) => left.ordinal - right.ordinal
      || left.relationId.localeCompare(right.relationId));
  const boundaryRequired = snapshot.profile.acquisitionNeeds.includes("boundary_formation")
    || requiredCapabilities.includes("boundary_contrast")
    || requiredCapabilities.includes("counterexample")
    || requiredTargets.length > 0;
  if (boundaryRequired && requiredTargets.length === 0) {
    addIssue("required_boundary_target_missing", "invalid");
  }

  const boundaryPrimitiveOrder = unique([
    ...preferred.filter((primitive) =>
      primitive === "contrast_pair" || primitive === "counterexample"),
    ...fallback.filter((primitive) =>
      primitive === "contrast_pair" || primitive === "counterexample"),
    "contrast_pair" as const,
    "counterexample" as const,
  ]) as readonly ("contrast_pair" | "counterexample")[];
  const boundaryPrimitiveRank = new Map(
    boundaryPrimitiveOrder.map((primitive, index) => [primitive, index]),
  );
  const targetByRelation = new Map(
    requiredTargets.map((target) => [target.relationId, target]),
  );
  const boundaryCandidates = snapshot.assets
    .filter((asset) =>
      (asset.kind === "contrast_pair" || asset.kind === "counterexample")
      && nonEmpty(asset.boundaryRelationId)
      && targetByRelation.has(asset.boundaryRelationId)
      && nonEmpty(asset.positiveText)
      && nonEmpty(asset.negativeText),
    )
    .map((asset): SensaBoundaryCapabilityCandidate => ({
      assetId: asset.assetId,
      primitive: asset.kind as "contrast_pair" | "counterexample",
      relationId: asset.boundaryRelationId!,
      targetOrdinal: targetByRelation.get(asset.boundaryRelationId!)!.ordinal,
    }))
    .sort((left, right) =>
      (boundaryPrimitiveRank.get(left.primitive) ?? Number.MAX_SAFE_INTEGER)
        - (boundaryPrimitiveRank.get(right.primitive) ?? Number.MAX_SAFE_INTEGER)
      || left.targetOrdinal - right.targetOrdinal
      || left.assetId.localeCompare(right.assetId));
  if (
    boundaryRequired
    && requiredTargets.some((target) =>
      !boundaryCandidates.some((candidate) => candidate.relationId === target.relationId))
  ) {
    addIssue("required_boundary_asset_missing", "incomplete");
  }
  if (
    requiredCapabilities.includes("counterexample")
    && !boundaryCandidates.some((candidate) => candidate.primitive === "counterexample")
  ) {
    addIssue("required_counterexample_missing", "incomplete");
  }

  const quizExamples = snapshot.assets
    .filter((asset) => validExample(asset) && asset.exampleRole === "quiz")
    .sort(compareAssets);
  if (
    requiredCapabilities.includes("contextual_variation")
    && quizExamples.length === 0
  ) {
    addIssue("required_cloze_context_missing", "incomplete");
  }

  if (issues.length > 0) {
    return {
      status: "unavailable",
      resolverVersion: sensaExecutableLearningCapabilityResolverVersion,
      inventory: null,
      issues: issues.sort((left, right) =>
        left.severity.localeCompare(right.severity) || left.code.localeCompare(right.code)),
    };
  }

  const experience = experiences[0]!;
  const bridge = bridges[0]!;
  const studies = studyExamples as [
    SensaCapabilityAssetSnapshot,
    SensaCapabilityAssetSnapshot,
    SensaCapabilityAssetSnapshot,
  ];
  const audios = studyAudios as [
    SensaCapabilityAssetSnapshot,
    SensaCapabilityAssetSnapshot,
    SensaCapabilityAssetSnapshot,
  ];
  const groundingPrimitive = resolveGroundingPrimitive(preferred, fallback);
  const boundaryPrimitives = unique(
    boundaryCandidates.map((candidate) => candidate.primitive),
  ) as readonly ("contrast_pair" | "counterexample")[];
  const availableCapabilityCodes: SensaExecutableLearningCapabilityCode[] = [
    "grounding_experience",
    "meaning_to_form_cue",
    "retrieval_repair_support",
  ];
  if (boundaryCandidates.length > 0) {
    availableCapabilityCodes.push("boundary_contrast");
  }
  if (quizExamples.length > 0) {
    availableCapabilityCodes.push("cloze_context");
  }

  return {
    status: "executable",
    resolverVersion: sensaExecutableLearningCapabilityResolverVersion,
    issues: [],
    inventory: {
      availableCapabilityCodes,
      groundingExperience: {
        capabilityCode: "grounding_experience",
        primitive: groundingPrimitive.primitive,
        primitiveResolution: groundingPrimitive.resolution,
        experienceSketchAssetId: experience.assetId,
        l1BridgeAssetId: bridge.assetId,
        studyExampleAssetIds: [studies[0].assetId, studies[1].assetId, studies[2].assetId],
        pronunciationAssetId: pronunciations[0]!.assetId,
        studyAudioAssetIds: [audios[0].assetId, audios[1].assetId, audios[2].assetId],
      },
      boundaryContrast: boundaryCandidates.length === 0
        ? null
        : {
            capabilityCode: "boundary_contrast",
            primitives: boundaryPrimitives,
            candidates: boundaryCandidates,
          },
      meaningToFormCue: {
        capabilityCode: "meaning_to_form_cue",
        experienceSketchAssetId: experience.assetId,
      },
      clozeContext: quizExamples.length === 0
        ? null
        : {
            capabilityCode: "cloze_context",
            quizExampleAssetIds: quizExamples.map((asset) => asset.assetId),
          },
      retrievalRepairSupport: {
        capabilityCode: "retrieval_repair_support",
        experienceSketchAssetId: experience.assetId,
        l1BridgeAssetId: bridge.assetId,
        studyExampleAssetId: studies[0].assetId,
        studyAudioAssetId: audios[0].assetId,
      },
      contentOnlyRequiredCapabilities: requiredCapabilities
        .filter((capability) => contentOnlyCapabilities.has(capability))
        .sort((left, right) => left.localeCompare(right)),
    },
  };
}

export const sensaExecutableLearningCapabilityModule:
SensaExecutableLearningCapabilityModule = Object.freeze({
  version: sensaExecutableLearningCapabilityResolverVersion,
  resolve: resolveSensaExecutableLearningCapabilities,
});
