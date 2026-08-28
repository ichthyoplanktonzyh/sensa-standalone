import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../database/index.js";
import {
  canonicalJsonDigest,
  canonicalLearningActionDigestV3,
  isSensaSemanticPolicyDecisionCode,
  parseLearningActionPayload,
  semanticPolicyDecisionMatchesActionKind,
  sensaExecutableLearningCapabilityModule,
  sensaLearningActionSchemaVersion,
  stableUuid,
} from "@sensa/learning-kernel";
import type {
  LearningAction,
  LearningAssetReference,
  NextLearningAction,
  SensaBoundaryCapabilityCandidate,
  SensaExecutableLearningCapabilityInventory,
  SensaLearningActionPayload,
  SensaSemanticPolicyDecision,
  SensaSemanticPolicyDecisionCode,
} from "@sensa/learning-kernel";
import {
  encounterError as error,
  encounterQuery as query,
  jsonObject,
  toDate,
  toInteger,
} from "./support.js";

type Row = QueryResultRow & Record<string, unknown>;

export type ActionMaterializationEncounter = Readonly<{
  sense_encounter_id: string;
  workspace_id: string;
  learner_user_id: string;
  sense_id: string;
  sense_version_id: string;
  content_release_id: string;
  evidence_rule_version: string;
}>;

export type ActionRow = Readonly<{
  learning_action_id: string;
  workspace_id: string;
  learner_user_id: string;
  sense_encounter_id: string;
  ordinal: number | string;
  target_dimension: string;
  primitive: string;
  scaffold_level: string;
  renderer_kind: string;
  semantic_policy_decision_code: string;
  action_schema_version: string;
  evidence_rule_version: string;
  action_payload: unknown;
  action_digest: string;
  created_at: Date | string;
}>;

export type ActionAssetRow = Readonly<{
  learning_action_id: string;
  ordinal: number | string;
  learning_asset_id: string;
  asset_role: string;
}>;

export type AssetRow = Readonly<{
  learning_asset_id: string;
  asset_kind: string;
  sense_version_id: string | null;
  lexeme_version_id: string | null;
  text_body: string | null;
  example_ordinal: number | null;
  example_text_l2: string | null;
  example_target_form: string | null;
  example_target_start: number | null;
  example_target_end: number | null;
  example_role: string | null;
  example_scene_domain: string | null;
  contrast_relation_id: string | null;
  positive_text_l2: string | null;
  negative_text_l2: string | null;
  audio_source_example_asset_id: string | null;
}>;

type BoundaryTarget = Readonly<{
  sense_relation_id: string;
  ordinal: number;
  is_required: boolean;
}>;

export type ContentSnapshot = Readonly<{
  senseId: string;
  senseVersionId: string;
  lexemeId: string;
  lexemeVersionId: string;
  lemma: string;
  forms: readonly string[];
  minimumSufficientExperience: string;
  acquisitionNeeds: readonly string[];
  requiredCapabilities: readonly string[];
  optionalCapabilities: readonly string[];
  preferredPrimitives: readonly string[];
  fallbackPrimitives: readonly string[];
  assets: readonly AssetRow[];
  boundaryTargets: readonly BoundaryTarget[];
}>;

export type ActionContext = Readonly<{
  row: ActionRow;
  payload: SensaLearningActionPayload;
  assets: readonly ActionAssetRow[];
}>;

export async function loadContentSnapshot(
  executor: DatabaseExecutor,
  encounter: ActionMaterializationEncounter,
): Promise<ContentSnapshot> {
  const senseRows = await query<Row>(executor, `
    SELECT stable_senses.sense_id::TEXT AS sense_id,
           versions.sense_version_id::TEXT AS sense_version_id,
           stable_senses.lexeme_id::TEXT AS lexeme_id,
           lexemes.lemma,
           lexeme_versions.lexeme_version_id::TEXT AS lexeme_version_id,
           lexeme_versions.forms,
           profiles.minimum_sufficient_experience,
           profiles.acquisition_needs::TEXT[] AS acquisition_needs,
           profiles.required_asset_capabilities::TEXT[] AS required_asset_capabilities,
           profiles.optional_asset_capabilities::TEXT[] AS optional_asset_capabilities,
           profiles.preferred_primitives::TEXT[] AS preferred_primitives,
           profiles.fallback_primitives::TEXT[] AS fallback_primitives
      FROM sensa.sense_versions AS versions
      JOIN sensa.senses AS stable_senses ON stable_senses.sense_id = versions.sense_id
      JOIN sensa.lexemes AS lexemes ON lexemes.lexeme_id = stable_senses.lexeme_id
      JOIN sensa.lexeme_versions AS lexeme_versions
        ON lexeme_versions.content_release_id = versions.content_release_id
       AND lexeme_versions.lexeme_id = stable_senses.lexeme_id
      JOIN sensa.acquisition_profiles AS profiles
        ON profiles.sense_version_id = versions.sense_version_id
       AND profiles.content_release_id = versions.content_release_id
       AND profiles.learner_locale = (SELECT learner_locale FROM sensa.content_releases WHERE content_release_id = $2)
       AND profiles.review_status = 'approved'
      JOIN sensa.required_asset_manifests AS manifests
        ON manifests.sense_version_id = versions.sense_version_id
       AND manifests.content_release_id = versions.content_release_id
       AND manifests.acquisition_profile_id = profiles.acquisition_profile_id
       AND manifests.validator_version IN ('sensa-package-validator-v1', 'sensa-package-validator-v2', 'sensa-package-validator-v3')
       AND manifests.capability_resolver_version = 'sensa-executable-learning-capability-resolver-v1'
       AND manifests.status = 'satisfied'
     WHERE versions.sense_version_id = $1
       AND versions.content_release_id = $2
       AND versions.review_status = 'approved'
     LIMIT 1
  `, [encounter.sense_version_id, encounter.content_release_id]);
  const sense = senseRows[0];
  if (sense === undefined) throw error("content_unavailable", "The pinned Sense Learning Package is not available for this Encounter.", 409);
  const assets = await query<AssetRow>(executor, `
    SELECT assets.learning_asset_id::TEXT AS learning_asset_id,
           assets.asset_kind::TEXT AS asset_kind,
           assets.sense_version_id::TEXT AS sense_version_id,
           assets.lexeme_version_id::TEXT AS lexeme_version_id,
           texts.body AS text_body,
           examples.ordinal AS example_ordinal,
           examples.text_l2 AS example_text_l2,
           examples.target_form AS example_target_form,
           examples.target_start AS example_target_start,
           examples.target_end AS example_target_end,
           examples.role::TEXT AS example_role,
           examples.scene_domain::TEXT AS example_scene_domain,
           contrasts.sense_relation_id::TEXT AS contrast_relation_id,
           contrasts.positive_text_l2,
           contrasts.negative_text_l2,
           audios.source_example_asset_id::TEXT AS audio_source_example_asset_id
      FROM sensa.learning_assets AS assets
      LEFT JOIN sensa.text_assets AS texts ON texts.learning_asset_id = assets.learning_asset_id
      LEFT JOIN sensa.example_assets AS examples ON examples.learning_asset_id = assets.learning_asset_id
      LEFT JOIN sensa.contrast_case_assets AS contrasts ON contrasts.learning_asset_id = assets.learning_asset_id
      LEFT JOIN sensa.audio_assets AS audios ON audios.learning_asset_id = assets.learning_asset_id
     WHERE assets.content_release_id = $1
       AND assets.review_status = 'approved'
       AND (assets.sense_version_id = $2 OR assets.lexeme_version_id = $3)
     ORDER BY assets.asset_kind ASC, assets.learning_asset_id ASC
  `, [encounter.content_release_id, encounter.sense_version_id, sense.lexeme_version_id]);
  const boundaryTargets = await query<BoundaryTarget>(executor, `
    SELECT targets.sense_relation_id::TEXT AS sense_relation_id,
           targets.ordinal,
           targets.is_required
      FROM sensa.profile_boundary_targets AS targets
      JOIN sensa.acquisition_profiles AS profiles ON profiles.acquisition_profile_id = targets.acquisition_profile_id
     WHERE profiles.sense_version_id = $1
       AND profiles.content_release_id = $2
       AND profiles.review_status = 'approved'
     ORDER BY targets.ordinal ASC, targets.sense_relation_id ASC
  `, [encounter.sense_version_id, encounter.content_release_id]);
  const forms = Array.isArray(sense.forms) ? sense.forms.filter((value): value is string => typeof value === "string" && value.trim() !== "") : [];
  if (forms.length === 0 || typeof sense.lemma !== "string") throw error("content_unavailable", "The pinned Lexeme forms are unavailable for this Encounter.", 409);
  return {
    senseId: String(sense.sense_id),
    senseVersionId: String(sense.sense_version_id),
    lexemeId: String(sense.lexeme_id),
    lexemeVersionId: String(sense.lexeme_version_id),
    lemma: sense.lemma,
    forms,
    minimumSufficientExperience: typeof sense.minimum_sufficient_experience === "string" ? sense.minimum_sufficient_experience : "",
    acquisitionNeeds: Array.isArray(sense.acquisition_needs) ? sense.acquisition_needs.filter((value): value is string => typeof value === "string") : [],
    requiredCapabilities: Array.isArray(sense.required_asset_capabilities) ? sense.required_asset_capabilities.filter((value): value is string => typeof value === "string") : [],
    optionalCapabilities: Array.isArray(sense.optional_asset_capabilities) ? sense.optional_asset_capabilities.filter((value): value is string => typeof value === "string") : [],
    preferredPrimitives: Array.isArray(sense.preferred_primitives) ? sense.preferred_primitives.filter((value): value is string => typeof value === "string") : [],
    fallbackPrimitives: Array.isArray(sense.fallback_primitives) ? sense.fallback_primitives.filter((value): value is string => typeof value === "string") : [],
    assets,
    boundaryTargets,
  };
}

export function resolveContentCapabilities(
  content: ContentSnapshot,
): SensaExecutableLearningCapabilityInventory {
  const result = sensaExecutableLearningCapabilityModule.resolve({
    profile: {
      acquisitionNeeds: content.acquisitionNeeds,
      preferredPrimitives: content.preferredPrimitives,
      fallbackPrimitives: content.fallbackPrimitives,
      requiredAssetCapabilities: content.requiredCapabilities,
      optionalAssetCapabilities: content.optionalCapabilities,
    },
    boundaryTargets: content.boundaryTargets.map((target) => ({
      relationId: target.sense_relation_id,
      ordinal: target.ordinal,
      required: target.is_required,
    })),
    assets: content.assets.map((asset) => ({
      assetId: asset.learning_asset_id,
      kind: asset.asset_kind,
      text: asset.text_body,
      exampleOrdinal: asset.example_ordinal,
      exampleRole: asset.example_role,
      exampleText: asset.example_text_l2,
      exampleTargetStart: asset.example_target_start,
      exampleTargetEnd: asset.example_target_end,
      boundaryRelationId: asset.contrast_relation_id,
      positiveText: asset.positive_text_l2,
      negativeText: asset.negative_text_l2,
      sourceExampleAssetId: asset.audio_source_example_asset_id,
    })),
  });
  if (result.status === "unavailable") {
    throw error(
      "content_unavailable",
      `The pinned Sense Learning Package is not executable: ${result.issues.map((candidate) => candidate.code).join(", ")}.`,
      409,
    );
  }
  return result.inventory;
}

function requireCapabilityAsset(
  content: ContentSnapshot,
  assetId: string,
  capabilityCode: string,
): AssetRow {
  const asset = content.assets.find((candidate) => candidate.learning_asset_id === assetId);
  if (asset === undefined) {
    throw error(
      "content_unavailable",
      `Executable capability ${capabilityCode} references an unavailable Learning Asset.`,
      409,
    );
  }
  return asset;
}

function requireCapabilityAssets(
  content: ContentSnapshot,
  assetIds: readonly string[],
  capabilityCode: string,
): readonly AssetRow[] {
  return assetIds.map((assetId) => requireCapabilityAsset(content, assetId, capabilityCode));
}

function actionAssets(rows: readonly AssetRow[], roles: readonly string[]): ReadonlyArray<{ learningAssetId: string; ordinal: number; role: string }> {
  return rows.map((asset, index) => ({ learningAssetId: asset.learning_asset_id, ordinal: index + 1, role: roles[index] ?? "support" }));
}

function maskExample(example: AssetRow): string {
  if (example.example_text_l2 === null || example.example_target_start === null || example.example_target_end === null) throw error("content_unavailable", "The selected Example has no valid target span.", 409);
  if (example.example_target_start < 0 || example.example_target_end <= example.example_target_start || example.example_target_end > example.example_text_l2.length) throw error("content_unavailable", "The selected Example target span is invalid.", 409);
  return `${example.example_text_l2.slice(0, example.example_target_start)}____${example.example_text_l2.slice(example.example_target_end)}`;
}

/**
 * Deterministic seed for Boundary choice order.  This is a runtime-derived
 * presentation detail, not the Action identity digest, so it stays local to
 * this module and never crosses the client contract.
 */
function boundaryChoiceOrderDigest(
  encounterId: string,
  ordinal: number,
  assetId: string,
): string {
  return canonicalJsonDigest({
    encounterId,
    ordinal,
    payload: assetId,
    assetReferences: [assetId],
  });
}

export function assertActionContextIntegrity(
  context: ActionContext,
  content: ContentSnapshot,
): void {
  if (
    !isSensaSemanticPolicyDecisionCode(
      context.row.semantic_policy_decision_code,
    ) ||
    !semanticPolicyDecisionMatchesActionKind(
      context.row.semantic_policy_decision_code,
      context.payload.kind,
    )
  ) {
    throw error(
      "state_corrupt",
      `Learning Action ${context.row.learning_action_id} has an invalid Semantic Policy decision code.`,
      500,
    );
  }
  const ordinal = toInteger(context.row.ordinal, "Action ordinal", 1);
  let expectedDigest: string;
  try {
    expectedDigest = canonicalLearningActionDigestV3(
      context.row.sense_encounter_id,
      ordinal,
      context.row.semantic_policy_decision_code as SensaSemanticPolicyDecisionCode,
      context.payload,
      context.assets.map((asset) => ({
        learningAssetId: asset.learning_asset_id,
        ordinal: toInteger(asset.ordinal, "Action asset ordinal", 1),
        role: asset.asset_role as LearningAssetReference["role"],
      })),
    );
  } catch {
    throw error("state_corrupt", `Learning Action ${context.row.learning_action_id} has a non-canonical digest input.`, 500);
  }
  if (context.row.action_digest !== expectedDigest) {
    throw error("state_corrupt", `Learning Action ${context.row.learning_action_id} has a mismatched canonical digest.`, 500);
  }

  const assetsById = new Map(content.assets.map((asset) => [asset.learning_asset_id, asset]));
  if (context.assets.length === 0) {
    throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} has no approved asset references.`, 409);
  }
  if (context.assets.some((reference, index) => toInteger(reference.ordinal, "Action asset ordinal", 1) !== index + 1)) {
    throw error("state_corrupt", `Learning Action ${context.row.learning_action_id} has non-contiguous asset ordinals.`, 500);
  }
  if (new Set(context.assets.map((reference) => reference.learning_asset_id)).size !== context.assets.length) {
    throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} repeats a Learning Asset reference.`, 409);
  }
  for (const reference of context.assets) {
    const asset = assetsById.get(reference.learning_asset_id);
    if (asset === undefined) {
      throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} references an unavailable Learning Asset.`, 409);
    }
    const roleMatches = reference.asset_role === "experience_sketch" && asset.asset_kind === "experience_sketch"
      || reference.asset_role === "l1_bridge" && asset.asset_kind === "l1_bridge"
      || reference.asset_role === "study_example" && asset.asset_kind === "example" && asset.example_role === "study"
      || reference.asset_role === "quiz_example" && asset.asset_kind === "example" && asset.example_role === "quiz"
      || reference.asset_role === "boundary" && (asset.asset_kind === "contrast_pair" || asset.asset_kind === "counterexample")
      || reference.asset_role === "pronunciation" && asset.asset_kind === "pronunciation_audio"
      || reference.asset_role === "study_example_audio" && asset.asset_kind === "study_example_audio"
      || reference.asset_role === "extended_audio" && asset.asset_kind === "extended_audio";
    if (!roleMatches) {
      throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} has an asset role/kind mismatch.`, 409);
    }
  }
  const payload = context.payload;
  switch (payload.kind) {
    case "grounding_bind":
      if (context.row.target_dimension !== "grounding" || context.row.renderer_kind !== "content" || context.row.scaffold_level !== "full") {
        throw error("state_corrupt", `Learning Action ${context.row.learning_action_id} has invalid grounding metadata.`, 500);
      }
      {
        const expectedRoles = [
          "experience_sketch",
          "l1_bridge",
          "study_example",
          "study_example",
          "study_example",
          "pronunciation",
          "study_example_audio",
          "study_example_audio",
          "study_example_audio",
        ];
        if (context.assets.length !== expectedRoles.length || context.assets.some((reference, index) => reference.asset_role !== expectedRoles[index])) {
          throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} must reference three ordered study Examples and matching audio.`, 409);
        }
        const examples = context.assets.slice(2, 5).map((reference) => assetsById.get(reference.learning_asset_id));
        const audios = context.assets.slice(6, 9).map((reference) => assetsById.get(reference.learning_asset_id));
        if (examples.some((asset) => asset?.asset_kind !== "example" || asset.example_role !== "study") || audios.some((asset) => asset?.asset_kind !== "study_example_audio")) {
          throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} contains an invalid study Example/audio sequence.`, 409);
        }
        for (let index = 0; index < 3; index += 1) {
          if (audios[index]?.audio_source_example_asset_id !== examples[index]?.learning_asset_id) {
            throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} has a study audio pairing mismatch.`, 409);
          }
        }
      }
      break;
    case "boundary_discrimination": {
      if (context.row.target_dimension !== "boundary" || context.row.renderer_kind !== "single_choice" || context.row.scaffold_level !== "none") {
        throw error("state_corrupt", `Learning Action ${context.row.learning_action_id} has invalid boundary metadata.`, 500);
      }
      if (!context.assets.some((reference) => {
        const asset = assetsById.get(reference.learning_asset_id);
        return asset?.asset_kind === "contrast_pair" || asset?.asset_kind === "counterexample";
      })) {
        throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} has no executable Boundary Asset.`, 409);
      }
      break;
    }
    case "meaning_to_form_recall":
      if (context.row.target_dimension !== "retrieval" || context.row.renderer_kind !== "text_input" || !["none", "reduced"].includes(context.row.scaffold_level)) {
        throw error("state_corrupt", `Learning Action ${context.row.learning_action_id} has invalid meaning-to-form metadata.`, 500);
      }
      if (context.assets.length !== 1 || !context.assets.some((reference) => reference.asset_role === "experience_sketch" && assetsById.get(reference.learning_asset_id)?.asset_kind === "experience_sketch")) {
        throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} must reference exactly one approved Experience Sketch.`, 409);
      }
      if (context.assets.some((reference) => assetsById.get(reference.learning_asset_id)?.asset_kind === "pronunciation_audio")) {
        throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} exposes a target-revealing pronunciation asset.`, 409);
      }
      break;
    case "cloze_recall":
      if (context.row.target_dimension !== "retrieval" || context.row.renderer_kind !== "text_input" || !["none", "reduced"].includes(context.row.scaffold_level) || !context.assets.some((reference) => reference.learning_asset_id === payload.exampleAssetId)) {
        throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} has an invalid Cloze Example reference.`, 409);
      }
      break;
    case "retrieval_repair":
      if (context.row.target_dimension !== "retrieval" || context.row.renderer_kind !== "content" || context.row.scaffold_level !== "full") {
        throw error("state_corrupt", `Learning Action ${context.row.learning_action_id} has invalid repair metadata.`, 500);
      }
      if (context.assets.length !== 4 || context.assets.map((reference) => reference.asset_role).join(",") !== "experience_sketch,l1_bridge,study_example,study_example_audio") {
        throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} has an invalid repair asset sequence.`, 409);
      }
      {
        const example = assetsById.get(context.assets[2]!.learning_asset_id);
        const audio = assetsById.get(context.assets[3]!.learning_asset_id);
        if (example?.asset_kind !== "example" || example.example_role !== "study" || audio?.asset_kind !== "study_example_audio" || audio.audio_source_example_asset_id !== example.learning_asset_id) {
          throw error("content_unavailable", `Learning Action ${context.row.learning_action_id} has a repair Example/audio pairing mismatch.`, 409);
        }
      }
      break;
  }
}

async function createAction(
  executor: DatabaseExecutor,
  encounter: ActionMaterializationEncounter,
  content: ContentSnapshot,
  specification: Readonly<{
    decisionCode: SensaSemanticPolicyDecisionCode;
    targetDimension: LearningAction["targetDimension"];
    primitive: LearningAction["primitive"];
    scaffoldLevel: "full" | "reduced" | "minimal" | "none";
    rendererKind: "content" | "single_choice" | "text_input";
    payload: SensaLearningActionPayload;
    assetRows: readonly AssetRow[];
    assetRoles: readonly string[];
  }>,
): Promise<NextLearningAction> {
  const ordinalRows = await query<Row>(executor, `
    SELECT COALESCE(MAX(ordinal), 0)::INTEGER + 1 AS next_ordinal
      FROM sensa.learning_actions
     WHERE sense_encounter_id = $1
  `, [encounter.sense_encounter_id]);
  const ordinal = toInteger(ordinalRows[0]?.next_ordinal ?? 0, "Action ordinal", 1);
  const refs = actionAssets(specification.assetRows, specification.assetRoles);
  const digest = canonicalLearningActionDigestV3(
    encounter.sense_encounter_id,
    ordinal,
    specification.decisionCode,
    specification.payload,
    refs,
  );
  // Action identity is a deterministic function of the immutable runtime
  // choice.  Re-opening or progressing the same Encounter therefore cannot
  // emit a second Action row for the same ordinal/payload.
  const actionId = stableUuid(`sensa-learning-action-v3:${encounter.sense_encounter_id}:${ordinal}:${sensaLearningActionSchemaVersion}:${digest}`);
  const actionRows = await query<ActionRow>(executor, `
    INSERT INTO sensa.learning_actions (
      learning_action_id, workspace_id, learner_user_id, sense_encounter_id,
      ordinal, target_dimension, primitive, scaffold_level, renderer_kind,
      semantic_policy_decision_code, action_schema_version, evidence_rule_version,
      action_payload, action_digest
    ) VALUES ($1, $2, $3, $4, $5, $6::sensa.mastery_dimension, $7::sensa.acquisition_primitive,
              $8::sensa.scaffold_level, $9::sensa.renderer_kind, $10, $11, $12, $13::JSONB, $14)
    RETURNING learning_action_id::TEXT AS learning_action_id,
              workspace_id::TEXT AS workspace_id,
              learner_user_id,
              sense_encounter_id::TEXT AS sense_encounter_id,
              ordinal,
              target_dimension::TEXT AS target_dimension,
              primitive::TEXT AS primitive,
              scaffold_level::TEXT AS scaffold_level,
              renderer_kind::TEXT AS renderer_kind,
              semantic_policy_decision_code,
              action_schema_version,
              evidence_rule_version,
              action_payload,
              action_digest,
              created_at
  `, [
    actionId,
    encounter.workspace_id,
    encounter.learner_user_id,
    encounter.sense_encounter_id,
    ordinal,
    specification.targetDimension,
    specification.primitive,
    specification.scaffoldLevel,
    specification.rendererKind,
    specification.decisionCode,
    sensaLearningActionSchemaVersion,
    encounter.evidence_rule_version,
    JSON.stringify(specification.payload),
    digest,
  ]);
  const row = actionRows[0];
  if (row === undefined) throw error("state_corrupt", "Learning Action was not returned after insertion.", 500);
  for (const ref of refs) {
    await executor.query(
      `INSERT INTO sensa.learning_action_assets (workspace_id, learner_user_id, learning_action_id, ordinal, learning_asset_id, asset_role) VALUES ($1, $2, $3, $4, $5, $6)`,
      [encounter.workspace_id, encounter.learner_user_id, actionId, ref.ordinal, ref.learningAssetId, ref.role],
    );
  }
  const payload = parseLearningActionPayload(row.action_payload);
  if (payload === null) throw error("state_corrupt", "Inserted Learning Action payload failed its closed validator.", 500);
  return {
    kind: "next_action",
    encounterId: encounter.sense_encounter_id,
    action: {
      learningActionId: row.learning_action_id,
      ordinal,
      targetDimension: specification.targetDimension as LearningAction["targetDimension"],
      primitive: specification.primitive as LearningAction["primitive"],
      scaffoldLevel: specification.scaffoldLevel,
      rendererKind: specification.rendererKind,
      semanticPolicyDecisionCode: specification.decisionCode,
      actionSchemaVersion: sensaLearningActionSchemaVersion,
      evidenceRuleVersion: row.evidence_rule_version,
      actionPayload: { object: payload, digest: canonicalJsonDigest(payload) },
      actionDigest: digest,
      assets: refs,
    },
  };
}

async function chooseBoundaryAsset(
  executor: DatabaseExecutor,
  encounter: ActionMaterializationEncounter,
  content: ContentSnapshot,
  candidates: readonly SensaBoundaryCapabilityCandidate[],
  primitive: "contrast_pair" | "counterexample",
): Promise<AssetRow> {
  const usedRows = await query<Row>(executor, `
    SELECT DISTINCT ON (action_assets.learning_asset_id)
           action_assets.learning_asset_id::TEXT AS learning_asset_id,
           actions.created_at AS last_emitted_at,
           actions.learning_action_id::TEXT AS last_emitted_action_id
      FROM sensa.learning_action_assets AS action_assets
      JOIN sensa.learning_actions AS actions ON actions.learning_action_id = action_assets.learning_action_id
      JOIN sensa.sense_encounters AS encounters ON encounters.sense_encounter_id = actions.sense_encounter_id
     WHERE encounters.workspace_id = $1
       AND encounters.learner_user_id = $2
       AND encounters.sense_id = $3
       AND action_assets.asset_role = 'boundary'
     ORDER BY action_assets.learning_asset_id, actions.created_at DESC, actions.learning_action_id DESC
  `, [encounter.workspace_id, encounter.learner_user_id, encounter.sense_id]);
  const used = new Map(usedRows.map((row) => [String(row.learning_asset_id), {
    lastEmittedAt: toDate(row.last_emitted_at as Date | string, "Boundary Action emitted time")!,
    lastEmittedActionId: String(row.last_emitted_action_id),
  }]));
  const orderedIds = candidates
    .filter((candidate) => candidate.primitive === primitive)
    .map((candidate) => candidate.assetId);
  const orderedCandidates = requireCapabilityAssets(
    content,
    orderedIds,
    "boundary_contrast",
  );
  if (orderedCandidates.length === 0) {
    throw error("content_unavailable", "The selected Boundary capability has no executable Asset.", 409);
  }
  const rank = new Map(orderedIds.map((assetId, index) => [assetId, index]));
  const stableOrder = (left: AssetRow, right: AssetRow): number =>
    (rank.get(left.learning_asset_id) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(right.learning_asset_id) ?? Number.MAX_SAFE_INTEGER);
  return orderedCandidates.find((asset) => !used.has(asset.learning_asset_id))
    ?? [...orderedCandidates].sort((left, right) => (
      (used.get(left.learning_asset_id)?.lastEmittedAt.getTime() ?? Number.MIN_SAFE_INTEGER)
        - (used.get(right.learning_asset_id)?.lastEmittedAt.getTime() ?? Number.MIN_SAFE_INTEGER)
      || (used.get(left.learning_asset_id)?.lastEmittedActionId ?? "").localeCompare(used.get(right.learning_asset_id)?.lastEmittedActionId ?? "")
        || stableOrder(left, right)
    ))[0];
}

async function chooseQuizExample(
  executor: DatabaseExecutor,
  encounter: ActionMaterializationEncounter,
  content: ContentSnapshot,
  candidateAssetIds: readonly string[],
): Promise<Readonly<{ asset: AssetRow; novelty: "familiar" | "novel" }>> {
  const examples = requireCapabilityAssets(
    content,
    candidateAssetIds,
    "cloze_context",
  );
  if (examples.length === 0) throw error("content_unavailable", "The pinned Content Release has no approved quiz Example.", 409);
  const usedRows = await query<Row>(executor, `
    SELECT DISTINCT ON (action_assets.learning_asset_id)
           action_assets.learning_asset_id::TEXT AS learning_asset_id,
           actions.created_at AS last_emitted_at,
           actions.learning_action_id::TEXT AS last_emitted_action_id
      FROM sensa.learning_action_assets AS action_assets
      JOIN sensa.learning_actions AS actions ON actions.learning_action_id = action_assets.learning_action_id
      JOIN sensa.sense_encounters AS encounters ON encounters.sense_encounter_id = actions.sense_encounter_id
     WHERE encounters.workspace_id = $1
       AND encounters.learner_user_id = $2
       AND encounters.sense_id = $3
       AND action_assets.asset_role = 'quiz_example'
     ORDER BY action_assets.learning_asset_id, actions.created_at DESC, actions.learning_action_id DESC
  `, [encounter.workspace_id, encounter.learner_user_id, encounter.sense_id]);
  const used = new Map(usedRows.map((row) => [String(row.learning_asset_id), {
    lastEmittedAt: toDate(row.last_emitted_at as Date | string, "Quiz Action emitted time")!,
    lastEmittedActionId: String(row.last_emitted_action_id),
  }]));
  const rank = new Map(candidateAssetIds.map((assetId, index) => [assetId, index]));
  const stableOrder = (left: AssetRow, right: AssetRow): number =>
    (rank.get(left.learning_asset_id) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(right.learning_asset_id) ?? Number.MAX_SAFE_INTEGER);
  const orderedExamples = [...examples].sort(stableOrder);
  const asset = orderedExamples.find((candidate) => !used.has(candidate.learning_asset_id))
    ?? [...orderedExamples].sort((left, right) => (
      (used.get(left.learning_asset_id)?.lastEmittedAt.getTime() ?? Number.MIN_SAFE_INTEGER)
        - (used.get(right.learning_asset_id)?.lastEmittedAt.getTime() ?? Number.MIN_SAFE_INTEGER)
      || (used.get(left.learning_asset_id)?.lastEmittedActionId ?? "").localeCompare(used.get(right.learning_asset_id)?.lastEmittedActionId ?? "")
      || stableOrder(left, right)
    ))[0];
  if (asset === undefined) throw error("content_unavailable", "The pinned Content Release has no selectable quiz Example.", 409);
  return { asset, novelty: used.has(asset.learning_asset_id) ? "familiar" : "novel" };
}

export async function createActionFromPolicyDecision(
  executor: DatabaseExecutor,
  encounter: ActionMaterializationEncounter,
  content: ContentSnapshot,
  capabilities: SensaExecutableLearningCapabilityInventory,
  decision: SensaSemanticPolicyDecision,
  nextActionOrdinal: number,
): Promise<NextLearningAction> {
  const common = {
    decisionCode: decision.decisionCode,
    targetDimension: decision.targetDimension,
    primitive: decision.primitive,
    scaffoldLevel: decision.scaffoldLevel,
    rendererKind: decision.rendererKind,
  } as const;

  switch (decision.actionKind) {
    case "grounding_bind": {
      if (decision.capabilityCode !== "grounding_experience") {
        throw error("state_corrupt", "Grounding Policy decision has an invalid capability requirement.", 500);
      }
      const grounding = capabilities.groundingExperience;
      const assets = requireCapabilityAssets(content, [
        grounding.experienceSketchAssetId,
        grounding.l1BridgeAssetId,
        ...grounding.studyExampleAssetIds,
        grounding.pronunciationAssetId,
        ...grounding.studyAudioAssetIds,
      ], grounding.capabilityCode);
      return createAction(executor, encounter, content, {
        ...common,
        payload: { kind: "grounding_bind", schemaVersion: sensaLearningActionSchemaVersion },
        assetRows: assets,
        assetRoles: [
          "experience_sketch",
          "l1_bridge",
          "study_example",
          "study_example",
          "study_example",
          "pronunciation",
          "study_example_audio",
          "study_example_audio",
          "study_example_audio",
        ],
      });
    }
    case "boundary_discrimination": {
      if (
        decision.capabilityCode !== "boundary_contrast" ||
        capabilities.boundaryContrast === null ||
        (decision.primitive !== "contrast_pair" && decision.primitive !== "counterexample")
      ) {
        throw error("content_unavailable", "Boundary Policy decision cannot be materialized from the pinned Package.", 409);
      }
      const selectedBoundaryAsset = await chooseBoundaryAsset(
        executor,
        encounter,
        content,
        capabilities.boundaryContrast.candidates,
        decision.primitive,
      );
      const positiveFirst = Number.parseInt(
        boundaryChoiceOrderDigest(
          encounter.sense_encounter_id,
          nextActionOrdinal,
          selectedBoundaryAsset.learning_asset_id,
        ).slice(0, 2),
        16,
      ) % 2 === 0;
      const choices = positiveFirst
        ? [
            { choiceId: "choice_a" as const, text: selectedBoundaryAsset.positive_text_l2 ?? "" },
            { choiceId: "choice_b" as const, text: selectedBoundaryAsset.negative_text_l2 ?? "" },
          ]
        : [
            { choiceId: "choice_a" as const, text: selectedBoundaryAsset.negative_text_l2 ?? "" },
            { choiceId: "choice_b" as const, text: selectedBoundaryAsset.positive_text_l2 ?? "" },
          ];
      return createAction(executor, encounter, content, {
        ...common,
        payload: { kind: "boundary_discrimination", schemaVersion: sensaLearningActionSchemaVersion, choices: [choices[0]!, choices[1]!] },
        assetRows: [selectedBoundaryAsset],
        assetRoles: ["boundary"],
      });
    }
    case "retrieval_repair": {
      if (decision.capabilityCode !== "retrieval_repair_support") {
        throw error("state_corrupt", "Repair Policy decision has an invalid capability requirement.", 500);
      }
      const repair = capabilities.retrievalRepairSupport;
      const assets = requireCapabilityAssets(content, [
        repair.experienceSketchAssetId,
        repair.l1BridgeAssetId,
        repair.studyExampleAssetId,
        repair.studyAudioAssetId,
      ], repair.capabilityCode);
      return createAction(executor, encounter, content, {
        ...common,
        payload: { kind: "retrieval_repair", schemaVersion: sensaLearningActionSchemaVersion },
        assetRows: assets,
        assetRoles: ["experience_sketch", "l1_bridge", "study_example", "study_example_audio"],
      });
    }
    case "meaning_to_form_recall": {
      if (decision.capabilityCode !== "meaning_to_form_cue") {
        throw error("state_corrupt", "Meaning-to-form Policy decision has an invalid capability requirement.", 500);
      }
      const cue = capabilities.meaningToFormCue;
      const experience = requireCapabilityAsset(
        content,
        cue.experienceSketchAssetId,
        cue.capabilityCode,
      );
      return createAction(executor, encounter, content, {
        ...common,
        payload: { kind: "meaning_to_form_recall", schemaVersion: sensaLearningActionSchemaVersion, prompt: "Recover the target language form from its meaning." },
        assetRows: [experience],
        assetRoles: ["experience_sketch"],
      });
    }
    case "cloze_recall": {
      if (decision.capabilityCode !== "cloze_context" || capabilities.clozeContext === null) {
        throw error("state_corrupt", "Cloze Policy decision has an invalid capability requirement.", 500);
      }
      const selected = await chooseQuizExample(
        executor,
        encounter,
        content,
        capabilities.clozeContext.quizExampleAssetIds,
      );
      const contextNovelty = decision.contextNoveltyStrategy === "force_familiar"
        ? "familiar"
        : selected.novelty;
      return createAction(executor, encounter, content, {
        ...common,
        payload: { kind: "cloze_recall", schemaVersion: sensaLearningActionSchemaVersion, exampleAssetId: selected.asset.learning_asset_id, maskedText: maskExample(selected.asset), contextNovelty },
        assetRows: [selected.asset],
        assetRoles: ["quiz_example"],
      });
    }
  }
}

