import assert from "node:assert/strict";
import {
  resolveSensaExecutableLearningCapabilities,
  sensaExecutableLearningCapabilityModule,
  sensaExecutableLearningCapabilityResolverVersion,
  type SensaCapabilityAssetSnapshot,
  type SensaLearningPackageCapabilitySnapshot,
} from "@sensa/learning-kernel";

function example(
  assetId: string,
  ordinal: number,
  role: "study" | "quiz",
): SensaCapabilityAssetSnapshot {
  return {
    assetId,
    kind: "example",
    text: null,
    exampleOrdinal: ordinal,
    exampleRole: role,
    exampleText: "Use target here.",
    exampleTargetStart: 4,
    exampleTargetEnd: 10,
    boundaryRelationId: null,
    positiveText: null,
    negativeText: null,
    sourceExampleAssetId: null,
  };
}

function asset(
  assetId: string,
  kind: string,
  overrides: Partial<SensaCapabilityAssetSnapshot> = {},
): SensaCapabilityAssetSnapshot {
  return {
    assetId,
    kind,
    text: null,
    exampleOrdinal: null,
    exampleRole: null,
    exampleText: null,
    exampleTargetStart: null,
    exampleTargetEnd: null,
    boundaryRelationId: null,
    positiveText: null,
    negativeText: null,
    sourceExampleAssetId: null,
    ...overrides,
  };
}

const assets: readonly SensaCapabilityAssetSnapshot[] = [
  asset("experience", "experience_sketch", { text: "A concrete experience." }),
  asset("bridge", "l1_bridge", { text: "自然中文衔接。" }),
  example("study-1", 1, "study"),
  example("study-2", 2, "study"),
  example("study-3", 3, "study"),
  example("quiz-1", 4, "quiz"),
  asset("pronunciation", "pronunciation_audio"),
  asset("audio-1", "study_example_audio", { sourceExampleAssetId: "study-1" }),
  asset("audio-2", "study_example_audio", { sourceExampleAssetId: "study-2" }),
  asset("audio-3", "study_example_audio", { sourceExampleAssetId: "study-3" }),
  asset("contrast", "contrast_pair", {
    boundaryRelationId: "relation-1",
    positiveText: "A valid positive case.",
    negativeText: "A valid negative case.",
  }),
  asset("counterexample", "counterexample", {
    boundaryRelationId: "relation-1",
    positiveText: "Another valid positive case.",
    negativeText: "Another valid negative case.",
  }),
  asset("visual", "visual_grounding"),
];

const snapshot: SensaLearningPackageCapabilitySnapshot = {
  profile: {
    acquisitionNeeds: ["boundary_formation"],
    preferredPrimitives: ["visual_grounding", "counterexample"],
    fallbackPrimitives: ["contrast_pair", "contextual_variation"],
    requiredAssetCapabilities: [
      "meaning_grounding",
      "l1_mediation",
      "boundary_contrast",
      "usage_pattern",
    ],
    optionalAssetCapabilities: ["visual_grounding"],
  },
  boundaryTargets: [{ relationId: "relation-1", ordinal: 1, required: true }],
  assets,
};

const executable = resolveSensaExecutableLearningCapabilities(snapshot);
assert.equal(
  sensaExecutableLearningCapabilityModule.version,
  sensaExecutableLearningCapabilityResolverVersion,
);
assert.equal(executable.resolverVersion, sensaExecutableLearningCapabilityResolverVersion);
assert.equal(executable.status, "executable");
if (executable.status === "executable") {
  assert.deepEqual(executable.inventory.availableCapabilityCodes, [
    "grounding_experience",
    "meaning_to_form_cue",
    "retrieval_repair_support",
    "boundary_contrast",
    "cloze_context",
  ]);
  assert.equal(executable.inventory.groundingExperience.primitive, "production_cue");
  assert.equal(
    executable.inventory.groundingExperience.primitiveResolution,
    "runtime_baseline_fallback",
  );
  assert.deepEqual(
    executable.inventory.boundaryContrast?.primitives,
    ["counterexample", "contrast_pair"],
  );
  assert.equal(
    executable.inventory.boundaryContrast?.candidates[0]?.assetId,
    "counterexample",
  );
  assert.deepEqual(
    executable.inventory.contentOnlyRequiredCapabilities,
    ["usage_pattern"],
  );
}

const unsupportedRequired = resolveSensaExecutableLearningCapabilities({
  ...snapshot,
  profile: {
    ...snapshot.profile,
    requiredAssetCapabilities: [
      ...snapshot.profile.requiredAssetCapabilities,
      "visual_grounding",
    ],
    optionalAssetCapabilities: [],
  },
});
assert.equal(unsupportedRequired.status, "unavailable");
assert.equal(unsupportedRequired.resolverVersion, sensaExecutableLearningCapabilityResolverVersion);
assert.ok(unsupportedRequired.issues.some(
  (candidate) => candidate.code === "required_asset_capability_not_executable",
));

const missingRequiredCloze = resolveSensaExecutableLearningCapabilities({
  ...snapshot,
  profile: {
    ...snapshot.profile,
    requiredAssetCapabilities: [
      ...snapshot.profile.requiredAssetCapabilities,
      "contextual_variation",
    ],
  },
  assets: assets.filter((candidate) => candidate.exampleRole !== "quiz"),
});
assert.equal(missingRequiredCloze.status, "unavailable");
assert.equal(missingRequiredCloze.resolverVersion, sensaExecutableLearningCapabilityResolverVersion);
assert.ok(missingRequiredCloze.issues.some(
  (candidate) => candidate.code === "required_cloze_context_missing",
));

console.log("Sensa executable learning capability smoke passed");
