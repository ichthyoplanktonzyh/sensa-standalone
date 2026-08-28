import type {
  SensaPinnedSenseLearningPackageSnapshot,
} from "@sensa/contracts/sensa";
import {
  canonicalJsonDigest,
  canonicalLearningActionDigest,
  learningActionSchema,
  parseLearningActionPayload,
  sensaEvidenceRuleVersion,
  sensaLearningActionSchemaVersion,
  type LearningAction,
  type LearningAssetReference,
  type SensaLearningActionPayload,
} from "@sensa/learning-kernel";

export type StudyAsset = SensaPinnedSenseLearningPackageSnapshot["learningAssets"][number];
export type ResolvedStudyAsset = Readonly<{
  reference: LearningAssetReference;
  asset: StudyAsset;
}>;
export type StudyActionView = Readonly<{
  valid: true;
  payload: SensaLearningActionPayload;
  assets: readonly ResolvedStudyAsset[];
  orderedStudyExamples: readonly ResolvedStudyAsset[];
  pronunciation: ResolvedStudyAsset | null;
  studyExampleAudio: readonly ResolvedStudyAsset[];
}>;
export type InvalidStudyActionView = Readonly<{
  valid: false;
  reason: string;
}>;
export type ResolvedActionView = StudyActionView | InvalidStudyActionView;

function roleMatches(reference: LearningAssetReference, asset: StudyAsset): boolean {
  switch (reference.role) {
    case "experience_sketch": return asset.kind === "experience_sketch";
    case "l1_bridge": return asset.kind === "l1_bridge";
    case "study_example": return asset.kind === "example" && asset.role === "study";
    case "quiz_example": return asset.kind === "example" && asset.role === "quiz";
    case "boundary": return asset.kind === "contrast_pair" || asset.kind === "counterexample";
    case "pronunciation": return asset.kind === "pronunciation_audio";
    case "study_example_audio": return asset.kind === "study_example_audio";
    case "extended_audio": return asset.kind === "extended_audio";
    default: return false;
  }
}

function maskedText(asset: StudyAsset): string | null {
  if (asset.kind !== "example") return null;
  if (asset.targetStart < 0 || asset.targetEnd <= asset.targetStart || asset.targetEnd > asset.textL2.length) return null;
  return `${asset.textL2.slice(0, asset.targetStart)}____${asset.textL2.slice(asset.targetEnd)}`;
}

function invalid(reason: string): InvalidStudyActionView {
  return { valid: false, reason };
}

function exactRoleSequence(assets: readonly ResolvedStudyAsset[], roles: readonly string[]): boolean {
  return assets.length === roles.length && assets.every((entry, index) => entry.reference.role === roles[index]);
}

function targetFormIsBounded(asset: StudyAsset): boolean {
  if (asset.kind !== "example") return true;
  if (asset.targetStart < 0 || asset.targetEnd <= asset.targetStart || asset.targetEnd > asset.textL2.length) return false;
  return asset.textL2.slice(asset.targetStart, asset.targetEnd) === asset.targetForm;
}

function containsTargetForm(text: string, item: SensaPinnedSenseLearningPackageSnapshot): boolean {
  const normalized = text.toLocaleLowerCase("und");
  return [item.lexeme.lemma, ...item.lexeme.forms]
    .filter((value) => value.trim() !== "")
    .some((value) => normalized.includes(value.toLocaleLowerCase("und")));
}

/**
 * Resolves a server-owned Action into the only view model renderers may use.
 * There is intentionally no Package fallback: every visible asset must be
 * present in the Action's immutable ordered reference list.
 */
export function resolveActionView(
  action: LearningAction,
  item: SensaPinnedSenseLearningPackageSnapshot,
  encounterId?: string,
): ResolvedActionView {
  const parsedAction = learningActionSchema.safeParse(action);
  if (!parsedAction.success) return invalid("action_schema_invalid");
  const payload = parseLearningActionPayload(action.actionPayload.object);
  if (payload === null || action.actionSchemaVersion !== sensaLearningActionSchemaVersion || action.evidenceRuleVersion !== sensaEvidenceRuleVersion) return invalid("action_version_unsupported");
  if (canonicalJsonDigest(payload) !== action.actionPayload.digest) return invalid("action_payload_digest_mismatch");
  if (encounterId !== undefined && canonicalLearningActionDigest(encounterId, action.ordinal, payload, action.assets) !== action.actionDigest) return invalid("action_digest_mismatch");
  if (new Set(item.learningAssets.map((asset) => asset.learningAssetId)).size !== item.learningAssets.length) return invalid("package_asset_identity_invalid");
  const packageAssets = new Map(item.learningAssets.map((asset) => [asset.learningAssetId, asset]));
  const resolved: ResolvedStudyAsset[] = [];
  for (const reference of action.assets) {
    const asset = packageAssets.get(reference.learningAssetId);
    if (asset === undefined || !roleMatches(reference, asset)) return invalid("action_asset_reference_invalid");
    if (asset.contentReleaseId !== item.contentRelease.contentReleaseId) return invalid("action_asset_release_mismatch");
    if (asset.kind === "pronunciation_audio") {
      if (asset.lexemeVersionId !== item.lexeme.lexemeVersionId || asset.senseVersionId !== null) return invalid("action_asset_lexeme_mismatch");
    } else if (asset.senseVersionId !== item.sense.senseVersionId) {
      return invalid("action_asset_sense_mismatch");
    }
    if (!targetFormIsBounded(asset)) return invalid("action_example_target_invalid");
    resolved.push({ reference, asset });
  }
  if (resolved.some((entry, index) => entry.reference.ordinal !== index + 1) || new Set(resolved.map((entry) => entry.reference.learningAssetId)).size !== resolved.length) return invalid("action_asset_order_invalid");
  switch (payload.kind) {
    case "grounding_bind": {
      const roles = ["experience_sketch", "l1_bridge", "study_example", "study_example", "study_example", "pronunciation", "study_example_audio", "study_example_audio", "study_example_audio"];
      if (!exactRoleSequence(resolved, roles)) return invalid("grounding_asset_cardinality_invalid");
      const examples = resolved.slice(2, 5);
      const audio = resolved.slice(6, 9);
      if (examples.some((entry) => entry.asset.kind !== "example" || entry.asset.role !== "study") || audio.some((entry) => entry.asset.kind !== "study_example_audio")) return invalid("grounding_asset_kind_invalid");
      for (let index = 0; index < 3; index += 1) {
        const example = examples[index]?.asset;
        const audioAsset = audio[index]?.asset;
        if (example?.kind !== "example" || audioAsset?.kind !== "study_example_audio" || audioAsset.sourceExampleAssetId !== example.learningAssetId) return invalid("grounding_audio_pair_invalid");
      }
      const experience = resolved[0]?.asset;
      if (experience?.kind !== "experience_sketch" || containsTargetForm(experience.body, item)) return invalid("grounding_answer_leak");
      break;
    }
    case "retrieval_repair": {
      if (!exactRoleSequence(resolved, ["experience_sketch", "l1_bridge", "study_example", "study_example_audio"])) return invalid("repair_asset_cardinality_invalid");
      const example = resolved[2]?.asset;
      const audio = resolved[3]?.asset;
      if (example?.kind !== "example" || audio?.kind !== "study_example_audio" || audio.sourceExampleAssetId !== example.learningAssetId) return invalid("repair_audio_pair_invalid");
      break;
    }
    case "boundary_discrimination":
      if (resolved.length !== 1 || resolved[0]?.reference.role !== "boundary") return invalid("boundary_asset_cardinality_invalid");
      if (payload.choices[0]?.choiceId === payload.choices[1]?.choiceId) return invalid("boundary_choice_invalid");
      break;
    case "meaning_to_form_recall":
      if (!exactRoleSequence(resolved, ["experience_sketch"])) return invalid("meaning_asset_cardinality_invalid");
      if (resolved[0]?.asset.kind !== "experience_sketch" || containsTargetForm(resolved[0].asset.body, item)) return invalid("meaning_answer_leak");
      break;
    case "cloze_recall": {
      if (!exactRoleSequence(resolved, ["quiz_example"]) || resolved[0]?.reference.learningAssetId !== payload.exampleAssetId) return invalid("cloze_asset_reference_invalid");
      const example = resolved[0]?.asset;
      if (example?.kind !== "example"
        || maskedText(example) !== payload.maskedText
        || payload.maskedText === example.textL2
        || containsTargetForm(payload.maskedText, item)
        || payload.maskedText.toLocaleLowerCase("und").includes(example.targetForm.toLocaleLowerCase("und"))) return invalid("cloze_answer_leak");
      break;
    }
  }
  const orderedStudyExamples = resolved.filter((entry) => entry.reference.role === "study_example");
  const pronunciation = resolved.find((entry) => entry.reference.role === "pronunciation") ?? null;
  const studyExampleAudio = resolved.filter((entry) => entry.reference.role === "study_example_audio");
  return { valid: true, payload, assets: resolved, orderedStudyExamples, pronunciation, studyExampleAudio };
}
