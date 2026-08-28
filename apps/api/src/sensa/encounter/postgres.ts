import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../../database/index.js";
import {
  createPostgresMemoryOutcomeModule,
} from "../runtime/postgresMemoryOutcomeModule.js";
import {
  canonicalJsonDigest,
  decideSensaEncounterCompletion,
  evaluateSensaAttempt,
  isRetrievalAction,
  parseLearningActionPayload,
  parseLearningResponsePayload,
  sensaExecutableLearningCapabilityResolverVersion,
  sensaEvidenceRuleV1Version,
  sensaEvidenceRuleVersion,
  sensaMemoryOutcomeVersion,
  sensaLearningActionSchemaVersion,
  sensaLearningResponseSchemaVersion,
  sensaSemanticPolicyModule,
  sensaSemanticPolicyVersion,
  sensaStateUpdaterVersion,
  sensaStopPolicyVersion,
} from "@sensa/learning-kernel";
import type {
  CompletedEncounter,
  EncounterStep,
  InterruptedEncounter,
  LearningAction,
  NextLearningAction,
  OpenEncounterInput,
  SubmitAttemptInput,
  SensaAttemptEvaluation,
  SensaAttemptEvaluationFacts,
  SensaEvidenceCandidate,
  SensaLearningActionPayload,
  SensaLearningResponsePayload,
  SensaSemanticStateSnapshot,
  SensaEncounterCompletionDecision,
  SensaStopPolicyCompletionDecisionCode,
  SensaSemanticPolicyDecisionCode,
} from "@sensa/learning-kernel";
import type { EncounterModule } from "@sensa/contracts/sensa";
import { SensaEncounterError } from "@sensa/contracts/sensa";
import {
  canonicalInputPayload,
  encounterError as error,
  encounterQuery as query,
  jsonObject,
  mapEncounterDatabaseError as mapDatabaseError,
  requireDate,
  requireInputString,
  requireUuid,
  toDate,
  toInteger,
  type EncounterQueryRow as Row,
} from "./support.js";
import {
  assertActionContextIntegrity,
  createActionFromPolicyDecision,
  loadContentSnapshot,
  resolveContentCapabilities,
  type ActionAssetRow,
  type ActionContext,
  type ActionRow,
  type AssetRow,
  type ContentSnapshot,
} from "./actionMaterialization.js";
import {
  loadEvidence,
  loadSemanticState,
  lockSemanticScope,
  persistSemanticEvidence,
} from "./semanticProjection.js";
import { loadCompletedSnapshot } from "./completedSnapshot.js";

type EncounterRow = Readonly<{
  sense_encounter_id: string;
  workspace_id: string;
  learner_user_id: string;
  learning_session_id: string;
  study_plan_id: string;
  sense_id: string;
  sense_version_id: string;
  content_release_id: string;
  book_version_id: string;
  session_ordinal: number | string;
  kind: string;
  status: string;
  revision: number | string;
  stop_policy_decision_code: string | null;
  capability_resolver_version: string;
  semantic_policy_version: string;
  stop_policy_version: string;
  evidence_rule_version: string;
  state_updater_version: string;
  outcome_mapping_version: string;
  semantic_state_revision_at_open: number | string;
  memory_state_revision_at_open: number | string;
  planned_at: Date | string;
  opened_at: Date | string | null;
  closed_at: Date | string | null;
}>; 

type AttemptRow = Readonly<{
  learning_attempt_id: string;
  workspace_id: string;
  learner_user_id: string;
  sense_encounter_id: string;
  learning_action_id: string;
  ordinal: number | string;
  source_replica_id: string;
  response_schema_version: string;
  response_payload: unknown;
  response_digest: string;
  duration_ms: number | null;
  validity: string;
  is_correct: boolean | null;
  evaluation_code: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
}>;

type Evaluation = SensaAttemptEvaluation;

const currentTuple = Object.freeze({
  capabilityResolverVersion: sensaExecutableLearningCapabilityResolverVersion,
  semanticPolicyVersion: sensaSemanticPolicyVersion,
  stopPolicyVersion: sensaStopPolicyVersion,
  evidenceRuleVersion: sensaEvidenceRuleVersion,
  stateUpdaterVersion: sensaStateUpdaterVersion,
  outcomeMappingVersion: sensaMemoryOutcomeVersion,
});

function assertSupportedEncounterTuple(row: EncounterRow): void {
  const matches = (
    row.capability_resolver_version === currentTuple.capabilityResolverVersion
    && row.semantic_policy_version === currentTuple.semanticPolicyVersion
    && row.stop_policy_version === currentTuple.stopPolicyVersion
    && row.evidence_rule_version === currentTuple.evidenceRuleVersion
    && row.state_updater_version === currentTuple.stateUpdaterVersion
    && row.outcome_mapping_version === currentTuple.outcomeMappingVersion
  );
  if (!matches) {
    throw error("runtime_version_unsupported", "This Encounter is pinned to an unsupported Runtime Rule Packet version.", 409);
  }
}

function assertScope(row: EncounterRow, input: Readonly<{ workspaceId: string; learnerUserId: string; encounterId?: string }>): void {
  if (row.workspace_id !== input.workspaceId || row.learner_user_id !== input.learnerUserId || (input.encounterId !== undefined && row.sense_encounter_id !== input.encounterId)) {
    throw error("scope_mismatch", "The Encounter does not belong to the authenticated learner and Workspace.", 404);
  }
}

async function loadEncounterForUpdate(
  executor: DatabaseExecutor,
  input: Readonly<{ workspaceId: string; learnerUserId: string; encounterId: string }>,
): Promise<EncounterRow> {
  const rows = await query<EncounterRow>(executor, `
    SELECT sense_encounter_id::TEXT AS sense_encounter_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           learning_session_id::TEXT AS learning_session_id,
           study_plan_id::TEXT AS study_plan_id,
           sense_id::TEXT AS sense_id,
           sense_version_id::TEXT AS sense_version_id,
           content_release_id::TEXT AS content_release_id,
           book_version_id::TEXT AS book_version_id,
           session_ordinal,
           kind::TEXT AS kind,
           status::TEXT AS status,
           revision,
           stop_policy_decision_code,
           capability_resolver_version,
           semantic_policy_version,
           stop_policy_version,
           evidence_rule_version,
           state_updater_version,
           outcome_mapping_version,
           semantic_state_revision_at_open,
           memory_state_revision_at_open,
           planned_at,
           opened_at,
           closed_at
      FROM sensa.sense_encounters
     WHERE sense_encounter_id = $1
     FOR UPDATE
  `, [input.encounterId]);
  const row = rows[0];
  if (row === undefined) throw error("not_found", "The requested Sensa Encounter was not found.", 404);
  assertScope(row, input);
  assertSupportedEncounterTuple(row);
  return row;
}

async function lockEncounterSense(
  executor: DatabaseExecutor,
  input: Readonly<{ workspaceId: string; learnerUserId: string; encounterId: string }>,
): Promise<string> {
  const rows = await query<Row>(executor, `
    SELECT sense_id::TEXT AS sense_id
      FROM sensa.sense_encounters
     WHERE sense_encounter_id = $1
       AND workspace_id = $2
       AND learner_user_id = $3
  `, [input.encounterId, input.workspaceId, input.learnerUserId]);
  const senseId = rows[0]?.sense_id;
  if (typeof senseId !== "string" || senseId.trim() === "") {
    throw error("not_found", "The requested Sensa Encounter was not found.", 404);
  }
  await lockSemanticScope(executor, {
    workspaceId: input.workspaceId,
    learnerUserId: input.learnerUserId,
    senseId,
  });
  return senseId;
}

async function isLearnerSenseMastered(
  executor: DatabaseExecutor,
  input: Readonly<{ workspaceId: string; learnerUserId: string; senseId: string }>,
): Promise<boolean> {
  const rows = await query<Row>(executor, `
    SELECT is_mastered
      FROM sensa.learner_declared_masteries
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND sense_id = $3
  `, [input.workspaceId, input.learnerUserId, input.senseId]);
  return rows[0]?.is_mastered === true;
}

async function loadActionContexts(
  executor: DatabaseExecutor,
  encounterId: string,
): Promise<readonly ActionContext[]> {
  const actions = await query<ActionRow>(executor, `
    SELECT learning_action_id::TEXT AS learning_action_id,
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
      FROM sensa.learning_actions
     WHERE sense_encounter_id = $1
     ORDER BY ordinal ASC, learning_action_id ASC
  `, [encounterId]);
  const assets = await query<ActionAssetRow>(executor, `
    SELECT learning_action_id::TEXT AS learning_action_id,
           ordinal,
           learning_asset_id::TEXT AS learning_asset_id,
           asset_role
      FROM sensa.learning_action_assets
     WHERE learning_action_id IN (
       SELECT learning_action_id FROM sensa.learning_actions WHERE sense_encounter_id = $1
     )
     ORDER BY learning_action_id ASC, ordinal ASC
  `, [encounterId]);
  const byAction = new Map<string, ActionAssetRow[]>();
  for (const asset of assets) {
    const list = byAction.get(asset.learning_action_id) ?? [];
    list.push(asset);
    byAction.set(asset.learning_action_id, list);
  }
  return actions.map((row) => {
    const payload = parseLearningActionPayload(row.action_payload);
    if (payload === null
      || row.action_schema_version !== sensaLearningActionSchemaVersion
      || ![sensaEvidenceRuleV1Version, sensaEvidenceRuleVersion].includes(
        row.evidence_rule_version as typeof sensaEvidenceRuleVersion,
      )) {
      throw error("state_corrupt", `Learning Action ${row.learning_action_id} has an unsupported closed payload.`, 500);
    }
    return { row, payload, assets: byAction.get(row.learning_action_id) ?? [] };
  });
}

/*
 * Neither loader locks rows: every writer in this module first takes the
 * per-Sense advisory lock through `lockEncounterSense`, which serializes the
 * whole Encounter transaction.  (Both queries used to carry a `forUpdate`
 * parameter that expanded to an empty string, so it never locked anything.)
 */
async function loadAttempts(
  executor: DatabaseExecutor,
  encounterId: string,
): Promise<readonly AttemptRow[]> {
  return query<AttemptRow>(executor, `
    SELECT learning_attempt_id::TEXT AS learning_attempt_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           sense_encounter_id::TEXT AS sense_encounter_id,
           learning_action_id::TEXT AS learning_action_id,
           ordinal,
           source_replica_id::TEXT AS source_replica_id,
           response_schema_version,
           response_payload,
           response_digest,
           duration_ms,
           validity::TEXT AS validity,
           is_correct,
           evaluation_code,
           occurred_at,
           recorded_at
      FROM sensa.learning_attempts
     WHERE sense_encounter_id = $1
     ORDER BY occurred_at ASC, learning_attempt_id ASC
  `, [encounterId]);
}

async function loadAttemptById(
  executor: DatabaseExecutor,
  attemptId: string,
): Promise<AttemptRow | undefined> {
  const rows = await query<AttemptRow>(executor, `
    SELECT learning_attempt_id::TEXT AS learning_attempt_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           sense_encounter_id::TEXT AS sense_encounter_id,
           learning_action_id::TEXT AS learning_action_id,
           ordinal,
           source_replica_id::TEXT AS source_replica_id,
           response_schema_version,
           response_payload,
           response_digest,
           duration_ms,
           validity::TEXT AS validity,
           is_correct,
           evaluation_code,
           occurred_at,
           recorded_at
      FROM sensa.learning_attempts
     WHERE learning_attempt_id = $1

  `, [attemptId]);
  return rows[0];
}

async function buildNextAction(
  executor: DatabaseExecutor,
  encounter: EncounterRow,
  content: ContentSnapshot,
): Promise<EncounterStep> {
  const contexts = await loadActionContexts(executor, encounter.sense_encounter_id);
  const attempts = await loadAttempts(executor, encounter.sense_encounter_id);
  const validAttemptActionIds = new Set(attempts.filter((attempt) => attempt.validity === "valid").map((attempt) => attempt.learning_action_id));
  const pending = contexts.find((context) => !validAttemptActionIds.has(context.row.learning_action_id));
  if (pending !== undefined) {
    assertActionContextIntegrity(pending, content);
    return mapAction(pending);
  }

  /*
   * Stop Policy is a property of the accepted facts, not of the seam that
   * observes them.  Every emitted Action resolved and the accepted facts
   * already satisfying it means the Encounter is finished.  Emitting another
   * Action here would fabricate a parallel fact that the Stop Policy can never
   * close, stranding the Encounter in `active` forever -- which is exactly
   * what an introduction did on resume, by emitting a second `grounding_bind`
   * after its acknowledgement had already earned `introduced`.
   */
  const completionDecision = await acceptedCompletionDecision(
    executor,
    encounter,
    contexts,
    attempts,
  );
  if (completionDecision?.stopDecision.disposition === "complete") {
    return completeEncounterInExecutor(executor, {
      workspaceId: encounter.workspace_id,
      learnerUserId: encounter.learner_user_id,
      encounterId: encounter.sense_encounter_id,
    });
  }

  const semanticState = encounter.kind === "review"
    ? await loadSemanticState(executor, {
        workspaceId: encounter.workspace_id,
        learnerUserId: encounter.learner_user_id,
        senseId: encounter.sense_id,
      })
    : null;

  const capabilities = resolveContentCapabilities(content);

  const boundaryAction = contexts.find((context) => context.payload.kind === "boundary_discrimination");
  const boundaryWasAssessed = boundaryAction !== undefined && validAttemptActionIds.has(boundaryAction.row.learning_action_id);

  const retrievalContexts = contexts.filter((context) => isRetrievalAction(context.payload));
  const retrievalAttempts = attempts.filter((attempt) => {
    const context = contexts.find((candidate) => candidate.row.learning_action_id === attempt.learning_action_id);
    return attempt.validity === "valid" && context !== undefined && isRetrievalAction(context.payload);
  });
  const failures = retrievalAttempts.filter((attempt) => attempt.is_correct === false).length;
  const supportEmitted = contexts.some((context) => context.payload.kind === "grounding_bind" || context.payload.kind === "retrieval_repair");
  const firstRetrieval = retrievalContexts[0];
  const decision = sensaSemanticPolicyModule.decide({
    encounterKind: encounter.kind as "introduction" | "review",
    state: {
      groundingLevel: semanticState?.grounding.level ?? "unknown",
      boundaryLevel: semanticState?.boundary.level ?? "unknown",
    },
    capabilities: {
      availableCapabilityCodes: capabilities.availableCapabilityCodes,
      groundingPrimitive: capabilities.groundingExperience.primitive,
      boundaryPrimitives: capabilities.boundaryContrast?.primitives ?? [],
    },
    history: {
      boundaryAssessed: boundaryWasAssessed,
      firstRetrievalKind: firstRetrieval === undefined
        ? null
        : firstRetrieval.payload.kind as
          | "meaning_to_form_recall"
          | "cloze_recall",
      retrievalFailureCount: failures,
      strongSupportEmitted: supportEmitted,
      retrievalRepairEmitted: contexts.some((context) => context.payload.kind === "retrieval_repair"),
    },
  });
  return createActionFromPolicyDecision(
    executor,
    encounter,
    content,
    capabilities,
    decision,
    contexts.length + 1,
  );
}

function mapAction(context: ActionContext): NextLearningAction {
  return {
    kind: "next_action",
    encounterId: context.row.sense_encounter_id,
    action: {
      learningActionId: context.row.learning_action_id,
      ordinal: toInteger(context.row.ordinal, "Action ordinal", 1),
      targetDimension: context.row.target_dimension as LearningAction["targetDimension"],
      primitive: context.row.primitive as LearningAction["primitive"],
      scaffoldLevel: context.row.scaffold_level as LearningAction["scaffoldLevel"],
      rendererKind: context.row.renderer_kind as LearningAction["rendererKind"],
      semanticPolicyDecisionCode:
        context.row.semantic_policy_decision_code as SensaSemanticPolicyDecisionCode,
      actionSchemaVersion: context.row.action_schema_version,
      evidenceRuleVersion: context.row.evidence_rule_version,
      actionPayload: { object: context.payload, digest: canonicalJsonDigest(context.payload) },
      actionDigest: context.row.action_digest,
      assets: context.assets.map((asset) => ({ learningAssetId: asset.learning_asset_id, ordinal: toInteger(asset.ordinal, "Action asset ordinal", 1), role: asset.asset_role })),
    },
  };
}

function positiveBoundaryChoiceId(
  payload: Extract<SensaLearningActionPayload, { kind: "boundary_discrimination" }>,
  boundary: AssetRow,
): "choice_a" | "choice_b" {
  const positive = boundary.positive_text_l2;
  if (positive === null) throw error("content_unavailable", "Boundary Asset has no positive case.", 409);
  const matching = payload.choices.find((choice) => choice.text === positive);
  if (matching === undefined) throw error("state_corrupt", "Boundary Action choices do not match its immutable Asset.", 500);
  return matching.choiceId;
}

function buildAttemptEvaluationFacts(
  action: ActionContext,
  attempts: readonly AttemptRow[],
  contexts: readonly ActionContext[],
  content: ContentSnapshot,
  semanticStateAtEvaluation: SensaSemanticStateSnapshot,
): SensaAttemptEvaluationFacts {
  const payload = action.payload;
  const assetsById = new Map(content.assets.map((asset) => [asset.learning_asset_id, asset]));
  let boundaryPositiveChoiceId: "choice_a" | "choice_b" | null = null;
  if (payload.kind === "boundary_discrimination") {
    const boundary = action.assets
      .map((reference) => assetsById.get(reference.learning_asset_id))
      .find((asset) => asset?.asset_kind === "contrast_pair" || asset?.asset_kind === "counterexample");
    if (boundary === undefined) throw error("content_unavailable", "Boundary Action Asset is unavailable.", 409);
    boundaryPositiveChoiceId = positiveBoundaryChoiceId(payload, boundary);
  }

  let clozeTarget: string | null = null;
  if (payload.kind === "cloze_recall") {
    const example = assetsById.get(payload.exampleAssetId);
    if (example === undefined || example.asset_kind !== "example" || example.example_target_form === null) {
      throw error("content_unavailable", "Cloze Action Example is unavailable.", 409);
    }
    clozeTarget = example.example_target_form;
  }

  const priorValidRetrievalCorrectness = attempts.flatMap((attempt) => {
    if (attempt.validity !== "valid") return [];
    const actionContext = contexts.find((candidate) => candidate.row.learning_action_id === attempt.learning_action_id);
    return actionContext !== undefined && isRetrievalAction(actionContext.payload)
      ? [attempt.is_correct]
      : [];
  });
  return {
    acceptedForms: [content.lemma, ...content.forms],
    clozeTarget,
    boundaryPositiveChoiceId,
    priorValidRetrievalCorrectness,
    strongSupportEmitted: hasStrongSupport(contexts),
    retrievalMasteryLevel: semanticStateAtEvaluation.retrieval.level,
  };
}

function evaluateAttempt(
  action: ActionContext,
  responseSchemaVersion: string,
  responseObject: Record<string, unknown>,
  attempts: readonly AttemptRow[],
  contexts: readonly ActionContext[],
  content: ContentSnapshot,
  semanticStateAtEvaluation: SensaSemanticStateSnapshot,
): Evaluation {
  const response = responseSchemaVersion === sensaLearningResponseSchemaVersion
    ? parseLearningResponsePayload(responseObject)
    : null;
  const needsContentFacts = response !== null
    && ((action.payload.kind === "boundary_discrimination" && response.kind === "single_choice")
      || ((action.payload.kind === "meaning_to_form_recall" || action.payload.kind === "cloze_recall")
        && response.kind === "text_input"));
  const facts = needsContentFacts
    ? buildAttemptEvaluationFacts(action, attempts, contexts, content, semanticStateAtEvaluation)
    : {
      acceptedForms: [],
      clozeTarget: null,
      boundaryPositiveChoiceId: null,
      priorValidRetrievalCorrectness: [],
      strongSupportEmitted: false,
      retrievalMasteryLevel: "unknown" as const,
    };
  return evaluateSensaAttempt({
    action: {
      payload: action.payload,
      scaffoldLevel: action.row.scaffold_level as "full" | "reduced" | "minimal" | "none",
    },
    responseSchemaVersion,
    responseObject,
    evidenceRuleVersion: action.row.evidence_rule_version === sensaEvidenceRuleV1Version
      ? sensaEvidenceRuleV1Version
      : sensaEvidenceRuleVersion,
    facts,
  });
}

async function verifyReplicaScope(
  executor: DatabaseExecutor,
  input: Readonly<{ replicaId: string; workspaceId: string; learnerUserId: string }>,
): Promise<void> {
  const rows = await query<Row>(executor, `
    SELECT workspace_id::TEXT AS workspace_id, user_id AS learner_user_id
      FROM sync.workspace_replicas
     WHERE replica_id = $1
     LIMIT 1
  `, [input.replicaId]);
  const row = rows[0];
  if (row === undefined || row.workspace_id !== input.workspaceId || row.learner_user_id !== input.learnerUserId) {
    throw error("replica_scope_mismatch", "replicaId must belong to the authenticated learner and Workspace.", 409);
  }
}

function sameAttemptFact(
  row: AttemptRow,
  input: SubmitAttemptInput,
  responseDigest: string,
): boolean {
  const occurred = toDate(row.occurred_at, "Attempt occurred time");
  return occurred !== null
    && row.workspace_id === input.workspaceId
    && row.learner_user_id === input.learnerUserId
    && row.sense_encounter_id === input.encounterId
    && row.learning_action_id === input.learningActionId
    && toInteger(row.ordinal, "Attempt ordinal", 1) === input.ordinal
    && row.source_replica_id === input.sourceReplicaId
    && row.response_schema_version === input.responseSchemaVersion
    && row.response_digest === responseDigest
    && row.duration_ms === input.durationMs
    && occurred.getTime() === input.occurredAt.getTime();
}

function hasStrongSupport(contexts: readonly ActionContext[]): boolean {
  return contexts.some((context) => context.payload.kind === "grounding_bind" || context.payload.kind === "retrieval_repair");
}

/**
 * The completion fact is the Attempt that resolved the Encounter's last Action.
 * Order by the Encounter's own causal sequence -- Action ordinal, then Attempt
 * ordinal -- and not by `occurredAt`: that instant is client-supplied, so two
 * Attempts landing in the same clock tick (or arriving from a skewed offline
 * replica) would otherwise have the completion fact chosen by comparing their
 * random UUIDs, which can name a Boundary Attempt as the retrieval result and
 * fail the Stop Policy replay outright.
 */
function latestValidAttempt(
  contexts: readonly ActionContext[],
  attempts: readonly AttemptRow[],
): AttemptRow | undefined {
  const actionOrdinal = new Map(contexts.map((context) => [
    context.row.learning_action_id,
    toInteger(context.row.ordinal, "Action ordinal", 1),
  ]));
  return attempts
    .filter((attempt) => attempt.validity === "valid")
    .sort((left, right) => (
      (actionOrdinal.get(left.learning_action_id) ?? 0) - (actionOrdinal.get(right.learning_action_id) ?? 0)
      || toInteger(left.ordinal, "Attempt ordinal", 1) - toInteger(right.ordinal, "Attempt ordinal", 1)
    ))
    .at(-1);
}

/**
 * Replay the Stop Policy against accepted facts alone.  `null` means the facts
 * do not close the Encounter yet.  Completion and resume must read the same
 * answer here, otherwise resume can emit an Action that completion would have
 * ruled out.
 */
async function acceptedCompletionDecision(
  executor: DatabaseExecutor,
  encounter: EncounterRow,
  contexts: readonly ActionContext[],
  attempts: readonly AttemptRow[],
): Promise<SensaEncounterCompletionDecision | null> {
  const lastValid = latestValidAttempt(contexts, attempts);
  if (lastValid === undefined) return null;
  const action = contexts.find((context) => context.row.learning_action_id === lastValid.learning_action_id);
  if (action === undefined) throw error("kernel_replay_failed", "The accepted Attempt references a missing Action.", 409);
  const evidence = await loadEvidence(executor, encounter.sense_encounter_id);
  const responsePayload = jsonObject(lastValid.response_payload, "Attempt response");
  return decideCompletion(
    encounter,
    action,
    {
      validity: "valid",
      isCorrect: lastValid.is_correct,
      evaluationCode: lastValid.evaluation_code,
      acceptedResponse: parseLearningResponsePayload(responsePayload),
      responsePayload,
      evidence: evidence
        .filter((item) => item.learning_attempt_id === lastValid.learning_attempt_id)
        .map((item) => ({
          dimension: item.dimension as SensaEvidenceCandidate["dimension"],
          polarity: item.polarity as "positive" | "negative",
          contextNovelty: item.context_novelty as "familiar" | "novel",
          basisCode: item.basis_code,
        })),
    },
    attempts,
    contexts,
    lastValid.learning_attempt_id,
  );
}

function decideCompletion(
  encounter: EncounterRow,
  action: ActionContext,
  evaluation: Evaluation,
  attempts: readonly AttemptRow[],
  contexts: readonly ActionContext[],
  currentAttemptId?: string,
): SensaEncounterCompletionDecision {
  const priorValidRetrievalCorrectness = attempts.flatMap((attempt) => {
    if (attempt.learning_attempt_id === currentAttemptId || attempt.validity !== "valid") return [];
    const previous = contexts.find((context) => context.row.learning_action_id === attempt.learning_action_id);
    return previous !== undefined && isRetrievalAction(previous.payload)
      ? [attempt.is_correct]
      : [];
  });
  return decideSensaEncounterCompletion({
    encounterKind: encounter.kind as "introduction" | "review",
    action: {
      payload: action.payload,
      scaffoldLevel: action.row.scaffold_level as "full" | "reduced" | "minimal" | "none",
    },
    evaluation,
    priorValidRetrievalCorrectness,
    strongSupportEmitted: hasStrongSupport(contexts),
  });
}

async function loadActionForAttempt(
  executor: DatabaseExecutor,
  encounterId: string,
  actionId: string,
): Promise<ActionContext> {
  const contexts = await loadActionContexts(executor, encounterId);
  const action = contexts.find((context) => context.row.learning_action_id === actionId);
  if (action === undefined) throw error("action_not_current", "The requested Learning Action is not part of this Encounter.", 409);
  return action;
}

async function updateEncounterStatus(
  executor: DatabaseExecutor,
  encounter: EncounterRow,
  status: "completed" | "interrupted" | "cancelled",
  closedAt: Date,
  stopDecisionCode: SensaStopPolicyCompletionDecisionCode | null,
): Promise<void> {
  const result = await executor.query(
    `UPDATE sensa.sense_encounters
        SET status = $1::sensa.encounter_status,
            closed_at = $2,
            stop_policy_decision_code = $3
      WHERE sense_encounter_id = $4
        AND status = $5::sensa.encounter_status
      RETURNING sense_encounter_id`,
    [status, closedAt, stopDecisionCode, encounter.sense_encounter_id, encounter.status],
  );
  if (result.rows[0] === undefined) throw error("terminal_state_conflict", "The Encounter changed before it could be closed.", 409);
}

async function dbNow(executor: DatabaseExecutor): Promise<Date> {
  const rows = await query<{ now: Date }>(executor, "SELECT statement_timestamp() AS now");
  const value = rows[0]?.now;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw error("state_corrupt", "Database clock returned an invalid timestamp.", 500);
  return value;
}

export async function openEncounterInExecutor(
  executor: DatabaseExecutor,
  input: OpenEncounterInput,
): Promise<EncounterStep> {
  const senseId = await lockEncounterSense(executor, input);
  const encounter = await loadEncounterForUpdate(executor, input);
  if (encounter.status === "completed") return loadCompletedSnapshot(executor, encounter);
  if (encounter.status === "interrupted" || encounter.status === "cancelled") throw error("not_openable", "A terminal interrupted or cancelled Encounter cannot be reopened.", 409);
  if (await isLearnerSenseMastered(executor, {
    workspaceId: encounter.workspace_id,
    learnerUserId: encounter.learner_user_id,
    senseId,
  })) {
    throw error("schedule_conflict", "This Sense has been marked as Learner-Declared Mastery and cannot be opened.", 409);
  }
  let activeEncounter = encounter;
  if (encounter.status === "planned") {
    const updated = await executor.query(
      "UPDATE sensa.sense_encounters SET status = 'active' WHERE sense_encounter_id = $1 AND status = 'planned' RETURNING sense_encounter_id",
      [encounter.sense_encounter_id],
    );
    if (updated.rows[0] === undefined) throw error("terminal_state_conflict", "The Encounter changed before it could open.", 409);
    activeEncounter = await loadEncounterForUpdate(executor, input);
  }
  const content = await loadContentSnapshot(executor, activeEncounter);
  return buildNextAction(executor, activeEncounter, content);
}

async function submitInExecutor(
  executor: DatabaseExecutor,
  input: SubmitAttemptInput,
): Promise<EncounterStep> {
  const recorded = await recordAttemptInExecutor(executor, input);
  const current = await loadEncounterForUpdate(executor, {
    workspaceId: input.workspaceId,
    learnerUserId: input.learnerUserId,
    encounterId: input.encounterId,
  });
  if (recorded.completionDecision?.stopDecision.disposition !== "complete") {
    if (current.status === "completed") return loadCompletedSnapshot(executor, current);
    const content = await loadContentSnapshot(executor, current);
    return buildNextAction(executor, current, content);
  }
  return completeEncounterInExecutor(executor, {
    workspaceId: input.workspaceId,
    learnerUserId: input.learnerUserId,
    encounterId: input.encounterId,
  });
}

/**
 * Sync needs the raw Attempt operation and the terminal Encounter operation to
 * have separate meanings.  Keep the same validation/evidence path as the
 * direct HTTP seam, but expose the record-only half to the Sync adapter.  The
 * adapter owns the surrounding transaction and therefore never calls an HTTP
 * route or nests a transaction here.
 */
export type RecordedAttemptInExecutorResult = Readonly<{
  attemptId: string;
  encounterId: string;
  completionDecision: SensaEncounterCompletionDecision | null;
  semanticState: SensaSemanticStateSnapshot;
}>;

export async function recordAttemptInExecutor(
  executor: DatabaseExecutor,
  input: SubmitAttemptInput,
): Promise<RecordedAttemptInExecutorResult> {
  const responseObject = canonicalInputPayload(input.responsePayload, "responsePayload");
  const responseDigest = canonicalJsonDigest(responseObject);
  if (input.responseSchemaVersion !== sensaLearningResponseSchemaVersion) {
    throw error("response_version_unsupported", "responseSchemaVersion must be sensa-learning-response-v1.", 409);
  }
  const senseId = await lockEncounterSense(executor, {
    workspaceId: input.workspaceId,
    learnerUserId: input.learnerUserId,
    encounterId: input.encounterId,
  });
  const encounter = await loadEncounterForUpdate(executor, {
    workspaceId: input.workspaceId,
    learnerUserId: input.learnerUserId,
    encounterId: input.encounterId,
  });
  await verifyReplicaScope(executor, {
    replicaId: input.sourceReplicaId,
    workspaceId: input.workspaceId,
    learnerUserId: input.learnerUserId,
  });
  if (encounter.status === "completed") {
    const existing = await loadAttemptById(executor, input.attemptId);
    if (existing === undefined || !sameAttemptFact(existing, input, responseDigest)) {
      throw error("terminal_state_conflict", "The Encounter is already completed; only an identical accepted Attempt may replay it.", 409);
    }
    return {
      attemptId: existing.learning_attempt_id,
      encounterId: encounter.sense_encounter_id,
      completionDecision: null,
      semanticState: await loadSemanticState(executor, {
        workspaceId: encounter.workspace_id,
        learnerUserId: encounter.learner_user_id,
        senseId: encounter.sense_id,
      }),
    };
  }
  if (encounter.status !== "active") {
    throw error("not_openable", "Only an active Encounter accepts Attempts.", 409);
  }
  if (await isLearnerSenseMastered(executor, {
    workspaceId: encounter.workspace_id,
    learnerUserId: encounter.learner_user_id,
    senseId,
  })) {
    throw error("schedule_conflict", "This Sense has been marked as Learner-Declared Mastery and cannot accept Attempts.", 409);
  }
  const existingAttempt = await loadAttemptById(executor, input.attemptId);
  if (existingAttempt !== undefined) {
    if (!sameAttemptFact(existingAttempt, input, responseDigest)) {
      throw error("attempt_identity_conflict", "attemptId is already used by a different immutable fact.", 409);
    }
    return {
      attemptId: existingAttempt.learning_attempt_id,
      encounterId: encounter.sense_encounter_id,
      completionDecision: null,
      semanticState: await loadSemanticState(executor, {
        workspaceId: encounter.workspace_id,
        learnerUserId: encounter.learner_user_id,
        senseId: encounter.sense_id,
      }),
    };
  }
  const action = await loadActionForAttempt(executor, input.encounterId, input.learningActionId);
  const contexts = await loadActionContexts(executor, input.encounterId);
  const attempts = await loadAttempts(executor, input.encounterId);
  const validAttemptIds = new Set(attempts.filter((attempt) => attempt.validity === "valid").map((attempt) => attempt.learning_action_id));
  if (validAttemptIds.has(action.row.learning_action_id)) {
    throw error("action_not_current", "The Learning Action has already been answered; resume the current Action.", 409);
  }
  const currentAction = contexts.find((context) => !validAttemptIds.has(context.row.learning_action_id));
  if (currentAction === undefined || currentAction.row.learning_action_id !== action.row.learning_action_id) {
    throw error("action_not_current", "The requested Learning Action is not the current unresolved Action.", 409);
  }
  const expectedOrdinal = attempts
    .filter((attempt) => attempt.learning_action_id === input.learningActionId)
    .reduce((maximum, attempt) => Math.max(maximum, toInteger(attempt.ordinal, "Attempt ordinal", 1)), 0) + 1;
  if (input.ordinal !== expectedOrdinal) {
    throw error("attempt_ordinal_conflict", `Attempt ordinal must be ${expectedOrdinal} for this Action.`, 409);
  }
  const content = await loadContentSnapshot(executor, encounter);
  assertActionContextIntegrity(action, content);
  const semanticState = await loadSemanticState(executor, {
    workspaceId: encounter.workspace_id,
    learnerUserId: encounter.learner_user_id,
    senseId: encounter.sense_id,
  });
  const evaluation = evaluateAttempt(
    action,
    input.responseSchemaVersion,
    responseObject,
    attempts,
    contexts,
    content,
    semanticState,
  );
  const insertedAttempt = await query<Row>(executor, `
    INSERT INTO sensa.learning_attempts (
      learning_attempt_id, workspace_id, learner_user_id, sense_encounter_id, learning_action_id,
      ordinal, source_replica_id, response_schema_version, response_payload, response_digest,
      duration_ms, validity, is_correct, evaluation_code, occurred_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::JSONB, $10, $11,
              $12::sensa.attempt_validity, $13, $14, $15)
    RETURNING learning_attempt_id::TEXT AS learning_attempt_id
  `, [
    input.attemptId,
    input.workspaceId,
    input.learnerUserId,
    input.encounterId,
    input.learningActionId,
    input.ordinal,
    input.sourceReplicaId,
    input.responseSchemaVersion,
    JSON.stringify(evaluation.responsePayload),
    responseDigest,
    input.durationMs,
    evaluation.validity,
    evaluation.isCorrect,
    evaluation.evaluationCode,
    input.occurredAt,
  ]);
  if (insertedAttempt[0] === undefined) {
    throw error("state_corrupt", "Learning Attempt was not returned after insertion.", 500);
  }
  const stateAfterEvidence = evaluation.validity === "invalid"
    ? semanticState
    : await persistSemanticEvidence(
      executor,
      encounter,
      input.attemptId,
      input.learningActionId,
      input.occurredAt,
      evaluation.evidence,
    );
  const completionDecision = decideCompletion(
    encounter,
    action,
    evaluation,
    attempts,
    contexts,
  );
  return {
    attemptId: input.attemptId,
    encounterId: input.encounterId,
    completionDecision,
    semanticState: stateAfterEvidence,
  };
}

/**
 * Finalize a previously recorded Encounter from server-owned facts.  Client
 * payloads are intentionally absent: Stop Policy and the Memory Outcome are
 * derived from accepted Actions, Attempts and Evidence only.
 */
export async function completeEncounterInExecutor(
  executor: DatabaseExecutor,
  input: Readonly<{
    workspaceId: string;
    learnerUserId: string;
    encounterId: string;
    expectedRevision?: number;
  }>,
): Promise<CompletedEncounter> {
  await lockEncounterSense(executor, input);
  const encounter = await loadEncounterForUpdate(executor, {
    workspaceId: input.workspaceId,
    learnerUserId: input.learnerUserId,
    encounterId: input.encounterId,
  });
  if (encounter.status === "completed") return loadCompletedSnapshot(executor, encounter);
  if (encounter.status !== "active") {
    throw error("terminal_state_conflict", "Only an active Encounter can complete.", 409);
  }
  if (await isLearnerSenseMastered(executor, {
    workspaceId: encounter.workspace_id,
    learnerUserId: encounter.learner_user_id,
    senseId: encounter.sense_id,
  })) {
    throw error("schedule_conflict", "This Sense has been marked as Learner-Declared Mastery and cannot complete an Encounter.", 409);
  }
  if (input.expectedRevision !== undefined
    && toInteger(encounter.revision, "Encounter revision", 1) !== input.expectedRevision) {
    throw error("revision_conflict", "The Encounter revision is stale; pull the authoritative Encounter snapshot before retrying.", 409);
  }
  assertSupportedEncounterTuple(encounter);
  const contexts = await loadActionContexts(executor, encounter.sense_encounter_id);
  const attempts = await loadAttempts(executor, encounter.sense_encounter_id);
  const lastValid = latestValidAttempt(contexts, attempts);
  if (lastValid === undefined) {
    throw error("kernel_replay_failed", "The Encounter has no accepted completion fact.", 409);
  }
  const completionDecision = await acceptedCompletionDecision(
    executor,
    encounter,
    contexts,
    attempts,
  );
  if (completionDecision === null
    || completionDecision.stopDecision.disposition !== "complete"
    || completionDecision.memoryOutcomeDecision === null) {
    throw error("kernel_replay_failed", "Accepted facts do not satisfy the frozen Stop Policy.", 409);
  }
  const completedAt = completionDecision.memoryOutcomeDecision.outcomeKind === "introduced"
    ? await dbNow(executor)
    : toDate(lastValid.occurred_at, "Attempt occurred time")!;
  try {
    await createPostgresMemoryOutcomeModule(executor).applyMemoryOutcome({
      workspaceId: encounter.workspace_id,
      learnerUserId: encounter.learner_user_id,
      senseEncounterId: encounter.sense_encounter_id,
      decision: completionDecision.memoryOutcomeDecision,
      observedCompletedAt: completedAt,
    });
  } catch (caught) {
    if (caught instanceof SensaEncounterError) throw caught;
    throw error("schedule_conflict", caught instanceof Error ? caught.message : "FSRS handoff failed; retry completion.", 409);
  }
  await updateEncounterStatus(
    executor,
    encounter,
    "completed",
    completedAt,
    completionDecision.stopDecision.decisionCode,
  );
  return loadCompletedSnapshot(executor, await loadEncounterForUpdate(executor, input));
}

async function interruptInExecutor(
  executor: DatabaseExecutor,
  input: Readonly<{
    workspaceId: string;
    learnerUserId: string;
    encounterId: string;
    status: "interrupted" | "cancelled";
  }>,
): Promise<InterruptedEncounter> {
  await lockEncounterSense(executor, input);
  const encounter = await loadEncounterForUpdate(executor, input);
  if (encounter.status === input.status) return { kind: "interrupted", encounterId: encounter.sense_encounter_id, status: input.status };
  if (encounter.status === "completed") throw error("terminal_state_conflict", "A completed Encounter cannot be interrupted or cancelled.", 409);
  if (encounter.status === "interrupted" || encounter.status === "cancelled") throw error("terminal_state_conflict", "The Encounter already has a different terminal state.", 409);
  if (encounter.status === "planned" && input.status === "interrupted") throw error("rule_violation", "A planned Encounter must be cancelled before it opens.", 409);
  await updateEncounterStatus(
    executor,
    encounter,
    input.status,
    await dbNow(executor),
    null,
  );
  return { kind: "interrupted", encounterId: encounter.sense_encounter_id, status: input.status };
}

export function createPostgresSensaEncounterModule(): EncounterModule {
  const run = <Result>(
    scope: Readonly<{ workspaceId: string; learnerUserId: string }>,
    callback: (executor: DatabaseExecutor) => Promise<Result>,
  ): Promise<Result> => transactionWithWorkspaceScope({ userId: scope.learnerUserId, workspaceId: scope.workspaceId }, callback);
  return Object.freeze({
    open(input: OpenEncounterInput): Promise<EncounterStep> {
      requireUuid(input.workspaceId, "workspaceId");
      requireInputString(input.learnerUserId, "learnerUserId");
      requireUuid(input.encounterId, "encounterId");
      return run(input, (executor) => openEncounterInExecutor(executor, input)).catch(mapDatabaseError);
    },
    submitAttempt(input: SubmitAttemptInput): Promise<EncounterStep> {
      requireUuid(input.workspaceId, "workspaceId");
      requireInputString(input.learnerUserId, "learnerUserId");
      requireUuid(input.encounterId, "encounterId");
      requireUuid(input.learningActionId, "learningActionId");
      requireUuid(input.attemptId, "attemptId");
      requireUuid(input.sourceReplicaId, "sourceReplicaId");
      if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 1) throw error("invalid_input", "ordinal must be a positive integer", 400);
      if (input.durationMs !== null && (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0)) throw error("invalid_input", "durationMs must be null or a non-negative integer", 400);
      requireDate(input.occurredAt, "occurredAt");
      return run(input, (executor) => submitInExecutor(executor, input)).catch(mapDatabaseError);
    },
    interrupt(input: { workspaceId: string; learnerUserId: string; encounterId: string; status: "interrupted" | "cancelled" }): Promise<InterruptedEncounter> {
      requireUuid(input.workspaceId, "workspaceId");
      requireInputString(input.learnerUserId, "learnerUserId");
      requireUuid(input.encounterId, "encounterId");
      return run(input, (executor) => interruptInExecutor(executor, input)).catch(mapDatabaseError);
    },
  });
}

export const postgresSensaEncounterModule = createPostgresSensaEncounterModule();
