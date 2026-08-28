import type { QueryResultRow } from "pg";
import {
  transactionWithWorkspaceScopeReadOnly,
  type DatabaseExecutor,
} from "../../database/index.js";
import { HttpError } from "../../shared/errors.js";
import {
  isSensaAudioMimeType,
  sensaAudioMimeTypes,
  type SensaMediaDownloadInput,
  type SensaMediaDownloadSource,
  type SensaMediaModule,
  type SensaMediaModuleOptions,
} from "./contracts.js";

type Row = QueryResultRow & Record<string, unknown>;

const sha256Pattern = /^[0-9a-f]{64}$/u;

function notFound(): HttpError {
  // All scope, ownership, release, asset and MIME failures deliberately share
  // one response so this endpoint cannot be used to enumerate private facts.
  return new HttpError(
    404,
    "The requested Sensa audio is not available.",
    "SENSA_MEDIA_AUDIO_NOT_FOUND",
  );
}

function invalidSnapshot(): HttpError {
  return new HttpError(
    500,
    "The pinned Sensa audio snapshot is invalid.",
    "SENSA_MEDIA_AUDIO_SNAPSHOT_INVALID",
  );
}

function readString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw invalidSnapshot();
  }
  return value;
}

function readSizeBytes(row: Row): number {
  const value = row.size_bytes;
  const sizeBytes = typeof value === "number"
    ? value
    : typeof value === "string" && /^[0-9]+$/u.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw invalidSnapshot();
  }
  return sizeBytes;
}

async function loadDownloadSourceInExecutor(
  executor: DatabaseExecutor,
  input: SensaMediaDownloadInput,
): Promise<SensaMediaDownloadSource> {
  /*
   * This is intentionally one server-owned authorization/integrity query.
   * Every join is part of the proof: authenticated Workspace membership,
   * learner-scoped Session/Plan/Encounter, Action ownership, exact Action
   * asset reference, pinned release identity, semantic owner identity, and
   * the V1 audio MIME allowlist. No caller can turn an internal ID into a
   * direct media lookup by itself.
   */
  const rows = await executor.query<Row>(`
    SELECT blobs.media_blob_id::TEXT AS media_blob_id,
           blobs.sha256,
           blobs.mime_type,
           blobs.size_bytes,
           blobs.storage_key
      FROM org.workspace_memberships AS memberships
      JOIN sensa.sense_encounters AS encounters
        ON encounters.workspace_id = memberships.workspace_id
       AND encounters.learner_user_id = memberships.user_id
       AND encounters.sense_encounter_id = $3
      JOIN sensa.learning_sessions AS sessions
        ON sessions.learning_session_id = encounters.learning_session_id
       AND sessions.workspace_id = encounters.workspace_id
       AND sessions.learner_user_id = encounters.learner_user_id
       AND sessions.study_plan_id = encounters.study_plan_id
      JOIN sensa.study_plans AS plans
        ON plans.study_plan_id = encounters.study_plan_id
       AND plans.workspace_id = encounters.workspace_id
       AND plans.learner_user_id = encounters.learner_user_id
      JOIN sensa.learning_actions AS actions
        ON actions.learning_action_id = $4
       AND actions.sense_encounter_id = encounters.sense_encounter_id
       AND actions.workspace_id = encounters.workspace_id
       AND actions.learner_user_id = encounters.learner_user_id
       AND actions.action_schema_version = 'sensa-learning-action-v3'
      JOIN sensa.learning_action_assets AS action_assets
        ON action_assets.learning_action_id = actions.learning_action_id
       AND action_assets.learning_asset_id = $5
       AND action_assets.workspace_id = encounters.workspace_id
       AND action_assets.learner_user_id = encounters.learner_user_id
      JOIN sensa.learning_assets AS assets
        ON assets.learning_asset_id = action_assets.learning_asset_id
       AND assets.content_release_id = encounters.content_release_id
       AND assets.review_status = 'approved'
      JOIN sensa.audio_assets AS audios
        ON audios.learning_asset_id = assets.learning_asset_id
       AND audios.content_release_id = encounters.content_release_id
      JOIN sensa.sense_versions AS encounter_sense_versions
        ON encounter_sense_versions.sense_version_id = encounters.sense_version_id
       AND encounter_sense_versions.content_release_id = encounters.content_release_id
       AND encounter_sense_versions.sense_id = encounters.sense_id
      JOIN sensa.senses AS encounter_senses
        ON encounter_senses.sense_id = encounter_sense_versions.sense_id
      JOIN sensa.lexeme_versions AS encounter_lexeme_versions
        ON encounter_lexeme_versions.content_release_id = encounters.content_release_id
       AND encounter_lexeme_versions.lexeme_id = encounter_senses.lexeme_id
      JOIN content.media_blobs AS blobs
        ON blobs.media_blob_id = audios.media_blob_id
     WHERE memberships.user_id = $2
       AND memberships.workspace_id = $1
       AND encounters.workspace_id = $1
       AND encounters.learner_user_id = $2
       AND assets.asset_kind IN ('pronunciation_audio', 'study_example_audio', 'extended_audio')
       AND action_assets.asset_role IN ('pronunciation', 'study_example_audio', 'extended_audio')
       AND blobs.mime_type = ANY($6::text[])
       AND (
         (
           assets.asset_kind = 'pronunciation_audio'
           AND assets.sense_version_id IS NULL
           AND assets.lexeme_version_id = encounter_lexeme_versions.lexeme_version_id
         )
         OR (
           assets.asset_kind = 'study_example_audio'
           AND assets.lexeme_version_id IS NULL
           AND assets.sense_version_id = encounters.sense_version_id
           AND EXISTS (
             SELECT 1
               FROM sensa.learning_action_assets AS source_action_assets
              WHERE source_action_assets.learning_action_id = actions.learning_action_id
                AND source_action_assets.workspace_id = actions.workspace_id
                AND source_action_assets.learner_user_id = actions.learner_user_id
                AND source_action_assets.asset_role = 'study_example'
                AND source_action_assets.learning_asset_id = audios.source_example_asset_id
           )
         )
         OR (
           assets.asset_kind = 'extended_audio'
           AND assets.lexeme_version_id IS NULL
           AND assets.sense_version_id = encounters.sense_version_id
         )
       )
     LIMIT 1
  `, [
    input.workspaceId,
    input.learnerUserId,
    input.senseEncounterId,
    input.learningActionId,
    input.learningAssetId,
    sensaAudioMimeTypes,
  ]);
  const row = rows.rows[0];
  if (row === undefined) {
    throw notFound();
  }

  const sha256 = readString(row, "sha256");
  const mimeType = readString(row, "mime_type");
  const storageKey = readString(row, "storage_key");
  if (!isSensaAudioMimeType(mimeType) || !sha256Pattern.test(sha256)) {
    throw invalidSnapshot();
  }

  return {
    media: {
      mediaBlobId: readString(row, "media_blob_id"),
      sha256,
      mimeType,
      sizeBytes: readSizeBytes(row),
    },
    storageKey,
  };
}

export function createPostgresSensaMediaModule(
  options: SensaMediaModuleOptions = {},
): SensaMediaModule {
  const readOnly = <Result>(
    input: SensaMediaDownloadInput,
    callback: (executor: DatabaseExecutor) => Promise<Result>,
  ): Promise<Result> => options.executor === undefined
    ? transactionWithWorkspaceScopeReadOnly(
      { userId: input.learnerUserId, workspaceId: input.workspaceId },
      callback,
    )
    : callback(options.executor);

  return Object.freeze({
    loadDownloadSource(input: SensaMediaDownloadInput): Promise<SensaMediaDownloadSource> {
      return readOnly(input, (executor) => loadDownloadSourceInExecutor(executor, input));
    },
  });
}

export const postgresSensaMediaModule = createPostgresSensaMediaModule();
