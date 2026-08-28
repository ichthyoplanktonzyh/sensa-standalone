import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";

import {
  canonicalJsonDigest,
  sensaExecutableLearningCapabilityModule,
  sensaExecutableLearningCapabilityResolverVersion,
  sensaLearningActionSchemaVersion,
  sensaLearningResponseSchemaVersion,
  type SensaLearningPackageCapabilitySnapshot,
} from "@sensa/learning-kernel";
import type { DatabaseExecutor } from "../apps/api/src/database/index.js";
import {
  completeEncounterInExecutor,
  openEncounterInExecutor,
  recordAttemptInExecutor,
} from "../apps/api/src/sensa/encounter/postgres.js";
import { planNextInExecutor } from "../apps/api/src/sensa/planning/postgres.js";

type ProfileRow = Readonly<{
  acquisition_profile_id: string;
  validator_version: string;
  capability_resolver_version: string;
  acquisition_needs: string[];
  preferred_primitives: string[];
  fallback_primitives: string[];
  required_asset_capabilities: string[];
  optional_asset_capabilities: string[];
}>;

type BoundaryRow = Readonly<{
  acquisition_profile_id: string;
  sense_relation_id: string;
  ordinal: number;
  is_required: boolean;
}>;

type AssetRow = Readonly<{
  acquisition_profile_id: string;
  learning_asset_id: string;
  asset_kind: string;
  text_body: string | null;
  example_ordinal: number | null;
  example_role: string | null;
  example_text_l2: string | null;
  example_target_start: number | null;
  example_target_end: number | null;
  contrast_relation_id: string | null;
  positive_text_l2: string | null;
  negative_text_l2: string | null;
  audio_source_example_asset_id: string | null;
}>;

type ScopeRow = Readonly<{
  workspace_id: string;
  learner_user_id: string;
  study_plan_id: string;
  replica_id: string;
}>;

type BoundaryEncounterRow = Readonly<{
  sense_id: string;
  sense_version_id: string;
  content_release_id: string;
  book_version_id: string;
}>;

const databaseUrl = process.env.DATABASE_URL ?? process.env.SENSA_DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error("DATABASE_URL or SENSA_DATABASE_URL is required");
}

function valuesByProfile<Row extends Readonly<{ acquisition_profile_id: string }>>(
  rows: readonly Row[],
): ReadonlyMap<string, readonly Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const values = grouped.get(row.acquisition_profile_id) ?? [];
    values.push(row);
    grouped.set(row.acquisition_profile_id, values);
  }
  return grouped;
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const profiles = (await client.query<ProfileRow>(`
      SELECT DISTINCT ON (profiles.acquisition_profile_id)
             profiles.acquisition_profile_id::TEXT AS acquisition_profile_id,
             manifests.validator_version,
             manifests.capability_resolver_version,
             profiles.acquisition_needs::TEXT[] AS acquisition_needs,
             profiles.preferred_primitives::TEXT[] AS preferred_primitives,
             profiles.fallback_primitives::TEXT[] AS fallback_primitives,
             profiles.required_asset_capabilities::TEXT[] AS required_asset_capabilities,
             profiles.optional_asset_capabilities::TEXT[] AS optional_asset_capabilities
        FROM sensa.acquisition_profiles AS profiles
        JOIN sensa.book_version_senses AS members
          ON members.sense_version_id = profiles.sense_version_id
        JOIN sensa.study_plans AS plans
          ON plans.book_version_id = members.book_version_id
        JOIN sensa.required_asset_manifests AS manifests
          ON manifests.acquisition_profile_id = profiles.acquisition_profile_id
         AND manifests.sense_version_id = profiles.sense_version_id
         AND manifests.status = 'satisfied'
       WHERE profiles.review_status = 'approved'
         AND plans.status = 'active'
       ORDER BY profiles.acquisition_profile_id,
                (manifests.validator_version = 'sensa-package-validator-v3') DESC,
                manifests.validator_version DESC
    `)).rows;
    assert.ok(profiles.length > 0, "Published content must contain approved Acquisition Profiles");

    const boundaries = (await client.query<BoundaryRow>(`
      SELECT targets.acquisition_profile_id::TEXT AS acquisition_profile_id,
             targets.sense_relation_id::TEXT AS sense_relation_id,
             targets.ordinal,
             targets.is_required
        FROM sensa.profile_boundary_targets AS targets
        JOIN sensa.acquisition_profiles AS profiles
          ON profiles.acquisition_profile_id = targets.acquisition_profile_id
        JOIN sensa.book_version_senses AS members
          ON members.sense_version_id = profiles.sense_version_id
        JOIN sensa.study_plans AS plans
          ON plans.book_version_id = members.book_version_id
       WHERE profiles.review_status = 'approved'
         AND plans.status = 'active'
       ORDER BY targets.acquisition_profile_id, targets.ordinal, targets.sense_relation_id
    `)).rows;

    const assets = (await client.query<AssetRow>(`
      SELECT profiles.acquisition_profile_id::TEXT AS acquisition_profile_id,
             assets.learning_asset_id::TEXT AS learning_asset_id,
             assets.asset_kind::TEXT AS asset_kind,
             texts.body AS text_body,
             examples.ordinal AS example_ordinal,
             examples.role::TEXT AS example_role,
             examples.text_l2 AS example_text_l2,
             examples.target_start AS example_target_start,
             examples.target_end AS example_target_end,
             contrasts.sense_relation_id::TEXT AS contrast_relation_id,
             contrasts.positive_text_l2,
             contrasts.negative_text_l2,
             audios.source_example_asset_id::TEXT AS audio_source_example_asset_id
        FROM sensa.acquisition_profiles AS profiles
        JOIN sensa.sense_versions AS senses
          ON senses.sense_version_id = profiles.sense_version_id
        JOIN sensa.senses AS stable_senses
          ON stable_senses.sense_id = senses.sense_id
        JOIN sensa.lexeme_versions AS lexeme_versions
          ON lexeme_versions.content_release_id = profiles.content_release_id
         AND lexeme_versions.lexeme_id = stable_senses.lexeme_id
        JOIN sensa.book_version_senses AS members
          ON members.sense_version_id = profiles.sense_version_id
        JOIN sensa.study_plans AS plans
          ON plans.book_version_id = members.book_version_id
        JOIN sensa.learning_assets AS assets
          ON assets.content_release_id = profiles.content_release_id
         AND (
           assets.sense_version_id = profiles.sense_version_id
           OR assets.lexeme_version_id = lexeme_versions.lexeme_version_id
         )
         AND assets.review_status = 'approved'
        LEFT JOIN sensa.text_assets AS texts
          ON texts.learning_asset_id = assets.learning_asset_id
        LEFT JOIN sensa.example_assets AS examples
          ON examples.learning_asset_id = assets.learning_asset_id
        LEFT JOIN sensa.contrast_case_assets AS contrasts
          ON contrasts.learning_asset_id = assets.learning_asset_id
        LEFT JOIN sensa.audio_assets AS audios
          ON audios.learning_asset_id = assets.learning_asset_id
       WHERE profiles.review_status = 'approved'
         AND plans.status = 'active'
       ORDER BY profiles.acquisition_profile_id, assets.learning_asset_id
    `)).rows;

    const boundariesByProfile = valuesByProfile(boundaries);
    const assetsByProfile = valuesByProfile(assets);
    const currentUnavailable: string[] = [];
    const legacyUnavailable: string[] = [];
    let executablePackageCount = 0;
    for (const profile of profiles) {
      assert.equal(
        profile.capability_resolver_version,
        sensaExecutableLearningCapabilityResolverVersion,
      );
      const snapshot: SensaLearningPackageCapabilitySnapshot = {
        profile: {
          acquisitionNeeds: profile.acquisition_needs,
          preferredPrimitives: profile.preferred_primitives,
          fallbackPrimitives: profile.fallback_primitives,
          requiredAssetCapabilities: profile.required_asset_capabilities,
          optionalAssetCapabilities: profile.optional_asset_capabilities,
        },
        boundaryTargets: (boundariesByProfile.get(profile.acquisition_profile_id) ?? []).map((target) => ({
          relationId: target.sense_relation_id,
          ordinal: target.ordinal,
          required: target.is_required,
        })),
        assets: (assetsByProfile.get(profile.acquisition_profile_id) ?? []).map((asset) => ({
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
      };
      const result = sensaExecutableLearningCapabilityModule.resolve(snapshot);
      assert.equal(result.resolverVersion, profile.capability_resolver_version);
      if (result.status === "unavailable") {
        const description = `${profile.acquisition_profile_id}:${result.issues.map((issue) => issue.code).join(",")}`;
        if (profile.validator_version === "sensa-package-validator-v3") {
          currentUnavailable.push(description);
        } else {
          legacyUnavailable.push(description);
        }
      } else {
        executablePackageCount += 1;
      }
    }
    assert.deepEqual(
      currentUnavailable,
      [],
      `V3-validated Packages are not executable: ${currentUnavailable.join("; ")}`,
    );

    await client.query("BEGIN");
    try {
      const scope = (await client.query<ScopeRow>(`
        SELECT plans.workspace_id::TEXT AS workspace_id,
               plans.learner_user_id,
               plans.study_plan_id::TEXT AS study_plan_id,
               plans.created_by_replica_id::TEXT AS replica_id
          FROM sensa.study_plans AS plans
         WHERE plans.status = 'active'
         ORDER BY plans.activated_at, plans.study_plan_id
         LIMIT 1
      `)).rows[0];
      assert.ok(scope, "The database smoke requires one active Study Plan");
      await client.query(
        "SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)",
        [scope.learner_user_id, scope.workspace_id],
      );
      const learningSessionId = randomUUID();
      await client.query(`
        INSERT INTO sensa.learning_sessions (
          learning_session_id, workspace_id, learner_user_id, study_plan_id,
          created_by_replica_id, status, revision
        ) VALUES ($1, $2, $3, $4, $5, 'active', 1)
      `, [learningSessionId, scope.workspace_id, scope.learner_user_id, scope.study_plan_id, scope.replica_id]);
      const executor: DatabaseExecutor = {
        query: async <Row extends pg.QueryResultRow>(text: string, params = []) =>
          client.query<Row>(text, params as unknown[]),
      };
      const planned = await planNextInExecutor(executor, {
        workspaceId: scope.workspace_id,
        learnerUserId: scope.learner_user_id,
        learningSessionId,
        studyPlanId: scope.study_plan_id,
        selectionMode: "mixed",
        now: new Date(),
      });
      assert.equal(planned.kind, "planned_encounter");
      if (planned.kind !== "planned_encounter") throw new Error("Planning returned no executable candidate");
      const step = await openEncounterInExecutor(executor, {
        workspaceId: scope.workspace_id,
        learnerUserId: scope.learner_user_id,
        encounterId: planned.encounter.encounterId,
      });
      assert.equal(step.kind, "next_action");
      if (step.kind !== "next_action") throw new Error("Encounter did not materialize a Learning Action");
      assert.equal(step.action.actionSchemaVersion, sensaLearningActionSchemaVersion);
      assert.equal(planned.encounter.kind, "introduction");
      assert.equal(step.action.semanticPolicyDecisionCode, "introduction_grounding");
      assert.equal(step.action.primitive, "production_cue");
      const acknowledgement = { kind: "acknowledgement", acknowledged: true };
      const attempt = await recordAttemptInExecutor(executor, {
        workspaceId: scope.workspace_id,
        learnerUserId: scope.learner_user_id,
        encounterId: planned.encounter.encounterId,
        learningActionId: step.action.learningActionId,
        attemptId: randomUUID(),
        ordinal: 1,
        sourceReplicaId: scope.replica_id,
        responseSchemaVersion: sensaLearningResponseSchemaVersion,
        responsePayload: {
          object: acknowledgement,
          digest: canonicalJsonDigest(acknowledgement),
        },
        durationMs: 500,
        occurredAt: new Date(),
      });
      assert.equal(
        attempt.completionDecision?.stopDecision.decisionCode,
        "introduction_grounding_accepted",
      );
      assert.equal(
        attempt.completionDecision?.memoryOutcomeDecision?.decisionCode,
        "introduced_after_grounding",
      );
      const completed = await completeEncounterInExecutor(executor, {
        workspaceId: scope.workspace_id,
        learnerUserId: scope.learner_user_id,
        encounterId: planned.encounter.encounterId,
      });
      assert.equal(completed.stopDecisionCode, "introduction_grounding_accepted");
      assert.equal(completed.memoryOutcome.decisionCode, "introduced_after_grounding");
      const boundaryCandidate = (await client.query<BoundaryEncounterRow>(`
        SELECT versions.sense_id::TEXT AS sense_id,
               versions.sense_version_id::TEXT AS sense_version_id,
               versions.content_release_id::TEXT AS content_release_id,
               members.book_version_id::TEXT AS book_version_id
          FROM sensa.acquisition_profiles AS profiles
          JOIN sensa.sense_versions AS versions
            ON versions.sense_version_id = profiles.sense_version_id
          JOIN sensa.book_version_senses AS members
            ON members.sense_version_id = versions.sense_version_id
          JOIN sensa.profile_boundary_targets AS targets
            ON targets.acquisition_profile_id = profiles.acquisition_profile_id
           AND targets.is_required
          JOIN sensa.learning_assets AS assets
            ON assets.sense_version_id = profiles.sense_version_id
           AND assets.asset_kind IN ('contrast_pair', 'counterexample')
           AND assets.review_status = 'approved'
          JOIN sensa.contrast_case_assets AS contrasts
            ON contrasts.learning_asset_id = assets.learning_asset_id
           AND contrasts.sense_relation_id = targets.sense_relation_id
          LEFT JOIN sensa.learner_semantic_states AS semantic_states
            ON semantic_states.workspace_id = $1
           AND semantic_states.learner_user_id = $2
           AND semantic_states.sense_id = versions.sense_id
         WHERE members.book_version_id = (
                 SELECT book_version_id
                   FROM sensa.study_plans
                  WHERE study_plan_id = $3
               )
           AND COALESCE(semantic_states.boundary_level::TEXT, 'unknown') <> 'stable'
         ORDER BY members.ordinal, profiles.acquisition_profile_id
         LIMIT 1
      `, [scope.workspace_id, scope.learner_user_id, scope.study_plan_id])).rows[0];
      assert.ok(boundaryCandidate, "The database smoke requires one executable Boundary Package");
      const boundaryEncounterId = randomUUID();
      await client.query(`
        UPDATE sensa.sense_encounters
           SET status = 'cancelled', closed_at = statement_timestamp()
         WHERE sense_encounter_id = $1
           AND status = 'active'
      `, [planned.encounter.encounterId]);
      await client.query(`
        INSERT INTO sensa.sense_encounters (
          sense_encounter_id, workspace_id, learner_user_id, learning_session_id,
          study_plan_id, sense_id, sense_version_id, content_release_id,
          book_version_id, session_ordinal, kind, status, revision,
          capability_resolver_version, semantic_policy_version, stop_policy_version, evidence_rule_version,
          state_updater_version, outcome_mapping_version
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, 2, 'review', 'planned', 1,
          $10, $11, $12, $13, $14, $15
        )
      `, [
        boundaryEncounterId,
        scope.workspace_id,
        scope.learner_user_id,
        learningSessionId,
        scope.study_plan_id,
        boundaryCandidate.sense_id,
        boundaryCandidate.sense_version_id,
        boundaryCandidate.content_release_id,
        boundaryCandidate.book_version_id,
        planned.encounter.capabilityResolverVersion,
        planned.encounter.semanticPolicyVersion,
        planned.encounter.stopPolicyVersion,
        planned.encounter.evidenceRuleVersion,
        planned.encounter.stateUpdaterVersion,
        planned.encounter.outcomeMappingVersion,
      ]);
      const boundaryStep = await openEncounterInExecutor(executor, {
        workspaceId: scope.workspace_id,
        learnerUserId: scope.learner_user_id,
        encounterId: boundaryEncounterId,
      });
      assert.equal(boundaryStep.kind, "next_action");
      if (boundaryStep.kind !== "next_action") throw new Error("Boundary review did not materialize a Learning Action");
      assert.equal(boundaryStep.action.semanticPolicyDecisionCode, "boundary_gap");
      assert.ok(
        boundaryStep.action.primitive === "contrast_pair"
          || boundaryStep.action.primitive === "counterexample",
      );
      assert.equal(boundaryStep.action.assets.length, 1);
      assert.equal(boundaryStep.action.assets[0]?.role, "boundary");
      console.log(JSON.stringify({
        pinnedPackageCount: profiles.length,
        executablePackageCount,
        legacyUnavailablePackageCount: legacyUnavailable.length,
        plannedEncounterKind: planned.encounter.kind,
        decisionCode: step.action.semanticPolicyDecisionCode,
        primitive: step.action.primitive,
        stopDecisionCode: completed.stopDecisionCode,
        memoryOutcomeDecisionCode: completed.memoryOutcome.decisionCode,
        boundaryDecisionCode: boundaryStep.action.semanticPolicyDecisionCode,
        boundaryPrimitive: boundaryStep.action.primitive,
      }));
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
