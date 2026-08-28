#!/usr/bin/env tsx

/**
 * Restore the disposable first-user Study Plan over an already imported
 * local Sensa Book. This deliberately does not re-import or mutate content.
 */

import { createHash } from "node:crypto";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;
const defaultDatabaseUrl = "postgresql://localhost:5432/sensa_standalone_dev";
const defaultRunKey = "standalone-v2";
const defaultBookKey = `sensa-first-user-${defaultRunKey}-book`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type Options = Readonly<{
  databaseUrl: string;
  workspaceId: string;
  learnerUserId: string;
  replicaId: string;
  runKey: string;
  bookKey: string;
  dailyNewTarget: number;
}>;

function fail(message: string): never {
  throw new Error(message);
}

function stableUuid(namespace: string, value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(`${namespace}:${value}`, "utf8").digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (value === undefined || value === "") fail(`${key} is required`);
  return value;
}

function uuid(values: ReadonlyMap<string, string>, key: string): string {
  const value = required(values, key).toLowerCase();
  if (!uuidPattern.test(value)) fail(`${key} must be a UUID`);
  return value;
}

function loopbackDatabase(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("--database-url must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") fail("--database-url must use PostgreSQL");
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (host !== "localhost" && host !== "::1" && !/^127(?:\.[0-9]{1,3}){3}$/u.test(host)) {
    fail(`Refusing non-loopback database host ${parsed.hostname}`);
  }
}

function parseArgs(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-insecure-local-db") continue;
    if (argument === "--help") {
      console.log("Usage: npm run sensa:restore-first-user-plan -- --workspace-id UUID --learner-user-id ID --replica-id UUID [--run-key standalone-v2] [--book-key KEY] [--daily-new-target 10] [--database-url postgresql://localhost:5432/sensa_standalone_dev] --allow-insecure-local-db");
      process.exit(0);
    }
    if (argument === undefined || !argument.startsWith("--")) fail(`Unknown argument ${String(argument)}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`${argument} requires a value`);
    values.set(argument, value);
    index += 1;
  }
  if (!argv.includes("--allow-insecure-local-db")) fail("This local repair requires --allow-insecure-local-db");
  const runKey = values.get("--run-key")?.trim() || defaultRunKey;
  const databaseUrl = values.get("--database-url") ?? process.env.DATABASE_URL ?? defaultDatabaseUrl;
  loopbackDatabase(databaseUrl);
  const daily = Number(values.get("--daily-new-target") ?? "10");
  if (!Number.isSafeInteger(daily) || daily < 1 || daily > 100) fail("--daily-new-target must be an integer from 1 through 100");
  return {
    databaseUrl,
    workspaceId: uuid(values, "--workspace-id"),
    learnerUserId: required(values, "--learner-user-id"),
    replicaId: uuid(values, "--replica-id"),
    runKey,
    bookKey: values.get("--book-key")?.trim() || (runKey === defaultRunKey ? defaultBookKey : `sensa-first-user-${runKey}-book`),
    dailyNewTarget: daily,
  };
}

async function restore(options: Options): Promise<void> {
  const pool = new Pool({ connectionString: options.databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`sensa-restore-plan:${options.workspaceId}:${options.learnerUserId}`]);
    const actor = await client.query("SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user");
    const actorRow = actor.rows[0] as { current_user?: string; rolsuper?: boolean } | undefined;
    const member = await client.query(
      "SELECT 1 FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2 LIMIT 1",
      [options.workspaceId, options.learnerUserId],
    );
    if (member.rowCount !== 1) fail("The learner is not a member of the requested Workspace");
    const replica = await client.query(
      "SELECT 1 FROM sync.workspace_replicas WHERE replica_id = $1 AND workspace_id = $2 AND user_id = $3 AND actor_kind = 'client_installation' AND platform = 'web' LIMIT 1",
      [options.replicaId, options.workspaceId, options.learnerUserId],
    );
    if (replica.rowCount !== 1) fail("The replica is not a verified web replica for this learner and Workspace");
    const book = await client.query(
      `SELECT versions.book_version_id::TEXT AS book_version_id,
              versions.content_release_id::TEXT AS content_release_id,
              versions.status::TEXT AS book_status,
              releases.status::TEXT AS release_status,
              versions.sense_count,
              versions.lexeme_count
         FROM sensa.books
         JOIN sensa.book_versions AS versions ON versions.book_id = sensa.books.book_id
         JOIN sensa.content_releases AS releases ON releases.content_release_id = versions.content_release_id
        WHERE sensa.books.book_key = $1
          AND versions.status IN ('published', 'retired')
          AND releases.status IN ('published', 'superseded')
        ORDER BY versions.version_number DESC
        LIMIT 1`,
      [options.bookKey],
    );
    const bookRow = book.rows[0] as Record<string, unknown> | undefined;
    if (bookRow === undefined) fail(`No imported local Book Version is available for ${options.bookKey}`);
    const planId = stableUuid(`sensa:first-user:${options.runKey}:study-plan`, `${options.workspaceId}:${options.learnerUserId}`);
    const active = await client.query(
      "SELECT study_plan_id::TEXT AS study_plan_id, book_version_id::TEXT AS book_version_id, daily_new_sense_target FROM sensa.study_plans WHERE workspace_id = $1 AND learner_user_id = $2 AND status = 'active'",
      [options.workspaceId, options.learnerUserId],
    );
    const activeRow = active.rows[0] as Record<string, unknown> | undefined;
    if (activeRow !== undefined && (activeRow.study_plan_id !== planId || activeRow.book_version_id !== bookRow.book_version_id || Number(activeRow.daily_new_sense_target) !== options.dailyNewTarget)) {
      fail(`An incompatible active Study Plan already exists: ${String(activeRow.study_plan_id)}`);
    }
    if (activeRow === undefined) {
      const needsRetiredContentBridge = bookRow.book_status === "retired" && bookRow.release_status === "superseded";
      if (needsRetiredContentBridge) {
        if (actorRow?.rolsuper !== true) {
          fail(`Recreating a deleted local plan over retired content requires a local database owner; current role is ${String(actorRow?.current_user ?? "unknown")}`);
        }
        // The content is immutable in normal application transactions. This
        // owner-only bridge temporarily reopens the already imported local
        // tuple so the Study Plan lifecycle trigger can validate its insert;
        // it restores the retired/superseded state before commit.
        await client.query("SET LOCAL session_replication_role = 'replica'");
        await client.query("UPDATE sensa.book_versions SET status = 'published', retired_at = NULL WHERE book_version_id = $1", [bookRow.book_version_id]);
        await client.query("UPDATE sensa.content_releases SET status = 'published', superseded_at = NULL WHERE content_release_id = $1", [bookRow.content_release_id]);
        await client.query("SET LOCAL session_replication_role = 'origin'");
      } else if (bookRow.book_status !== "published" || bookRow.release_status !== "published") {
        fail("The imported Book Version and Content Release are not in a restorable local state");
      }
      await client.query(
        `INSERT INTO sensa.study_plans
          (study_plan_id, workspace_id, learner_user_id, book_version_id, status,
           daily_new_sense_target, revision, created_by_replica_id)
         VALUES ($1, $2, $3, $4, 'active', $5, 1, $6)`,
        [planId, options.workspaceId, options.learnerUserId, bookRow.book_version_id, options.dailyNewTarget, options.replicaId],
      );
      if (needsRetiredContentBridge) {
        await client.query("SET LOCAL session_replication_role = 'replica'");
        await client.query("UPDATE sensa.content_releases SET status = 'superseded', superseded_at = statement_timestamp() WHERE content_release_id = $1", [bookRow.content_release_id]);
        await client.query("UPDATE sensa.book_versions SET status = 'retired', retired_at = statement_timestamp() WHERE book_version_id = $1", [bookRow.book_version_id]);
        await client.query("SET LOCAL session_replication_role = 'origin'");
      }
    }
    await client.query(
      `INSERT INTO sensa.sync_replica_states
        (workspace_id, learner_user_id, replica_id, wire_version)
       VALUES ($1, $2, $3, 'sensa-sync-v2')
       ON CONFLICT (workspace_id, learner_user_id, replica_id) DO NOTHING`,
      [options.workspaceId, options.learnerUserId, options.replicaId],
    );
    await client.query("COMMIT");
    console.log(JSON.stringify({
      studyPlanId: planId,
      bookVersionId: bookRow.book_version_id,
      bookStatus: bookRow.book_status,
      releaseStatus: bookRow.release_status,
      senseCount: bookRow.sense_count,
      lexemeCount: bookRow.lexeme_count,
      replicaId: options.replicaId,
      created: activeRow === undefined,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  await restore(parseArgs(process.argv.slice(2)));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
