import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import {
  transactionWithWorkspaceScopeReadOnly,
  type DatabaseExecutor,
  type SqlValue,
} from "../../database/index.js";
import { HttpError } from "../../shared/errors.js";
import {
  buildSensaCatalogPackages,
  type SensaCatalogBuildContentItem,
  type SensaCatalogBuildReleaseReference,
} from "./postgres.js";
import type {
  SensaCatalogCursor,
  SensaPublicBookManifestMember,
} from "@sensa/contracts/sensa";
import type {
  SensaPinnedBookSummary,
  SensaPinnedContentIdentity,
  SensaPinnedContentItemInput,
  SensaPinnedContentManifest,
  SensaPinnedContentManifestInput,
  SensaPinnedContentModule,
  SensaPinnedContentPage,
  SensaPinnedContentPageInput,
  SensaPinnedContentReleaseReference,
  SensaPinnedContentSingleItem,
} from "@sensa/contracts/sensa";

type Row = QueryResultRow & Record<string, unknown>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^[0-9a-f]{64}$/u;
const cursorMaximumLength = 2_048;

type PinnedCursorPayload = Readonly<{
  v: 1;
  endpoint: "pinned-content-items";
  studyPlanId: string;
  bookVersionId: string;
  contentReleaseId: string;
  manifestDigest: string;
  targetLanguage: string;
  learnerLocale: string;
  ordinal: number;
}>;

const pinnedCursorSchema = z.object({
  v: z.literal(1),
  endpoint: z.literal("pinned-content-items"),
  studyPlanId: z.string().regex(uuidPattern),
  bookVersionId: z.string().regex(uuidPattern),
  contentReleaseId: z.string().regex(uuidPattern),
  manifestDigest: z.string().regex(digestPattern),
  targetLanguage: z.string().min(1),
  learnerLocale: z.string().min(1),
  ordinal: z.number().int().positive(),
}).strict();

function pinnedContentError(statusCode: number, message: string, code: string): HttpError {
  return new HttpError(statusCode, message, code);
}

function notAvailable(): HttpError {
  // A missing plan, another learner's plan, a plan in another Workspace, and
  // a draft/invalid pinned tuple intentionally share one response.  Callers
  // must not be able to use this endpoint as an existence oracle.
  return pinnedContentError(
    404,
    "The requested pinned Sensa Study Plan content is not available.",
    "SENSA_PINNED_CONTENT_NOT_FOUND",
  );
}

function inconsistent(detail: string): HttpError {
  return pinnedContentError(
    409,
    `The pinned Sensa content snapshot is inconsistent and cannot be restored. ${detail}`,
    "SENSA_PINNED_CONTENT_SNAPSHOT_INCONSISTENT",
  );
}

function invalidCursor(): HttpError {
  return pinnedContentError(
    400,
    "cursor is invalid for this pinned Sensa Study Plan content endpoint.",
    "SENSA_PINNED_CONTENT_CURSOR_INVALID",
  );
}

function readString(row: Row, key: string, detail: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") throw inconsistent(`Invalid ${detail}.`);
  return value;
}

function readUuid(row: Row, key: string, detail: string): string {
  const value = readString(row, key, detail);
  if (!uuidPattern.test(value)) throw inconsistent(`Invalid ${detail}.`);
  return value.toLowerCase();
}

function readDigest(row: Row, key: string, detail: string): string {
  const value = readString(row, key, detail);
  if (!digestPattern.test(value)) throw inconsistent(`Invalid ${detail}.`);
  return value.toLowerCase();
}

function readInteger(row: Row, key: string, detail: string, minimum = 0): number {
  const raw = row[key];
  const value = typeof raw === "number"
    ? raw
    : typeof raw === "string" && /^-?[0-9]+$/u.test(raw)
      ? Number(raw)
      : Number.NaN;
  if (!Number.isSafeInteger(value) || value < minimum) throw inconsistent(`Invalid ${detail}.`);
  return value;
}

function readDate(row: Row, key: string, detail: string): string {
  const raw = row[key];
  const value = raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : null;
  if (value === null || Number.isNaN(value.getTime())) throw inconsistent(`Invalid ${detail}.`);
  return value.toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function computeManifestDigest(
  bookVersionId: string,
  contentReleaseId: string,
  members: ReadonlyArray<Readonly<{ ordinal: number; senseVersionId: string }>>,
): string {
  const ordered = [...members]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((member) => `${member.ordinal}:${member.senseVersionId}`)
    .join("\n");
  return sha256(`sensa-book-manifest-v1\n${bookVersionId}\n${contentReleaseId}\n${ordered}`);
}

function encodeCursor(payload: PinnedCursorPayload): SensaCatalogCursor {
  return Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64url") as SensaCatalogCursor;
}

function decodeCursor(cursor: SensaCatalogCursor | null): PinnedCursorPayload | null {
  if (cursor === null) return null;
  if (cursor.length === 0 || cursor.length > cursorMaximumLength) throw invalidCursor();
  let candidate: unknown;
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw invalidCursor();
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) throw invalidCursor();
    candidate = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  const parsed = pinnedCursorSchema.safeParse(candidate);
  if (!parsed.success) throw invalidCursor();
  return parsed.data;
}

async function query<RowType extends QueryResultRow>(
  executor: DatabaseExecutor,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<ReadonlyArray<RowType & Record<string, unknown>>> {
  return (await executor.query<RowType>(text, params)).rows as ReadonlyArray<RowType & Record<string, unknown>>;
}

type PinnedBookRow = Row;

async function loadPinnedBook(
  executor: DatabaseExecutor,
  input: SensaPinnedContentManifestInput,
): Promise<Readonly<{ row: PinnedBookRow; summary: SensaPinnedBookSummary; identity: SensaPinnedContentIdentity }>> {
  const rows = await query<Row>(executor, `
    SELECT plans.study_plan_id::TEXT AS study_plan_id,
           versions.book_version_id::TEXT AS book_version_id,
           versions.book_id::TEXT AS book_id,
           books.book_key,
           versions.version_number AS book_version_number,
           versions.content_release_id::TEXT AS content_release_id,
           versions.target_language AS book_target_language,
           versions.learner_locale AS book_learner_locale,
           versions.title AS book_title,
           versions.description AS book_description,
           versions.manifest_digest,
           versions.status::TEXT AS book_version_status,
           versions.published_at AS book_published_at,
           versions.retired_at AS book_retired_at,
           releases.release_key,
           releases.version_number AS release_version_number,
           releases.target_language AS release_target_language,
           releases.learner_locale AS release_learner_locale,
           releases.schema_version AS release_schema_version,
           releases.source_digest,
           releases.validator_version AS release_validator_version,
           releases.status::TEXT AS release_status,
           COUNT(members.ordinal)::INTEGER AS member_sense_count,
           COUNT(DISTINCT lexeme_versions.lexeme_id)::INTEGER AS member_lexeme_count
      FROM sensa.study_plans AS plans
      JOIN sensa.book_versions AS versions
        ON versions.book_version_id = plans.book_version_id
       AND versions.status IN ('published', 'retired')
      JOIN sensa.books AS books ON books.book_id = versions.book_id
      JOIN sensa.content_releases AS releases
        ON releases.content_release_id = versions.content_release_id
       AND releases.status IN ('published', 'superseded')
       AND releases.capability_resolver_version = 'sensa-executable-learning-capability-resolver-v1'
      LEFT JOIN sensa.book_version_senses AS members
        ON members.book_version_id = versions.book_version_id
      LEFT JOIN sensa.sense_versions AS senses
        ON senses.sense_version_id = members.sense_version_id
       AND senses.content_release_id = versions.content_release_id
       AND senses.review_status = 'approved'
      LEFT JOIN sensa.senses AS stable_senses ON stable_senses.sense_id = senses.sense_id
      LEFT JOIN sensa.lexeme_versions
        ON sensa.lexeme_versions.content_release_id = versions.content_release_id
       AND sensa.lexeme_versions.lexeme_id = stable_senses.lexeme_id
     WHERE plans.study_plan_id = $1
       AND plans.workspace_id = $2
       AND plans.learner_user_id = $3
     GROUP BY plans.study_plan_id, versions.book_version_id, versions.book_id, books.book_key,
              versions.version_number, versions.content_release_id, versions.target_language,
              versions.learner_locale, versions.title, versions.description, versions.manifest_digest,
              versions.status, versions.published_at, versions.retired_at, releases.release_key,
              releases.version_number, releases.target_language, releases.learner_locale,
              releases.schema_version, releases.source_digest, releases.validator_version, releases.status
  `, [input.studyPlanId, input.workspaceId, input.learnerUserId]);
  const row = rows[0];
  if (row === undefined) throw notAvailable();

  const bookStatus = readString(row, "book_version_status", "Book Version status");
  const releaseStatus = readString(row, "release_status", "Content Release status");
  if ((bookStatus !== "published" && bookStatus !== "retired")
    || (releaseStatus !== "published" && releaseStatus !== "superseded")) {
    throw notAvailable();
  }
  const bookVersionId = readUuid(row, "book_version_id", "Book Version identity");
  const contentReleaseId = readUuid(row, "content_release_id", "Content Release identity");
  const targetLanguage = readString(row, "book_target_language", "Book target language");
  const learnerLocale = readString(row, "book_learner_locale", "Book learner locale");
  if (targetLanguage !== readString(row, "release_target_language", "Release target language")
    || learnerLocale !== readString(row, "release_learner_locale", "Release learner locale")) {
    throw inconsistent("Book Version and Content Release language tuples do not match.");
  }
  const manifestDigest = readDigest(row, "manifest_digest", "Book manifest digest");
  const release: SensaPinnedContentReleaseReference = {
    contentReleaseId,
    releaseKey: readString(row, "release_key", "Content Release key"),
    versionNumber: readInteger(row, "release_version_number", "Content Release version", 1),
    targetLanguage,
    learnerLocale,
    schemaVersion: readString(row, "release_schema_version", "Content Release schema version"),
    sourceDigest: readDigest(row, "source_digest", "Content Release source digest"),
    validatorVersion: readString(row, "release_validator_version", "Content Release validator version"),
    status: releaseStatus,
  };
  const summary: SensaPinnedBookSummary = {
    bookId: readUuid(row, "book_id", "Book identity"),
    bookKey: readString(row, "book_key", "Book key"),
    bookVersionId,
    versionNumber: readInteger(row, "book_version_number", "Book Version number", 1),
    contentRelease: release,
    targetLanguage,
    learnerLocale,
    title: readString(row, "book_title", "Book title"),
    description: typeof row.book_description === "string" ? row.book_description : "",
    manifestDigest,
    senseCount: readInteger(row, "member_sense_count", "Book Sense count", 1),
    lexemeCount: readInteger(row, "member_lexeme_count", "Book Lexeme count", 1),
    status: bookStatus,
    publishedAt: readDate(row, "book_published_at", "Book publication timestamp"),
  };
  return {
    row,
    summary,
    identity: {
      studyPlanId: input.studyPlanId,
      bookVersionId,
      contentReleaseId,
      manifestDigest,
      targetLanguage,
      learnerLocale,
    },
  };
}

/**
 * How a caller narrows the immutable membership.  `page` walks it in ordinal
 * order; `sense` addresses one member directly, so a client holding the
 * manifest can fetch a single package without paging through its predecessors.
 */
type PinnedMemberSelector =
  | Readonly<{ kind: "page"; cursor: PinnedCursorPayload | null; limit: number }>
  | Readonly<{ kind: "sense"; senseId: string }>;

async function loadPinnedMembers(
  executor: DatabaseExecutor,
  bookVersionId: string,
  contentReleaseId: string,
  validatorVersion: string,
  selector: PinnedMemberSelector,
): Promise<ReadonlyArray<Row>> {
  const params: SqlValue[] = [bookVersionId, contentReleaseId, validatorVersion];
  let cursorClause = "";
  if (selector.kind === "sense") {
    params.push(selector.senseId);
    cursorClause = ` AND stable_senses.sense_id = $${params.length}`;
    params.push(2);
  } else {
    if (selector.cursor !== null) {
      params.push(selector.cursor.ordinal);
      cursorClause = ` AND members.ordinal > $${params.length}`;
    }
    params.push(selector.limit + 1);
  }
  return query<Row>(executor, `
    SELECT members.ordinal,
           senses.sense_version_id,
           stable_senses.sense_id,
           stable_senses.sense_key,
           lexeme_versions.lexeme_version_id,
           lexemes.lexeme_id,
           lexemes.language_tag,
           lexemes.lemma,
           lexeme_versions.forms,
           lexeme_versions.ipa_us,
           lexeme_versions.ipa_uk,
           lexeme_versions.syllables,
           senses.sense_rank,
           senses.part_of_speech,
           senses.guide_label_l1,
           senses.definition_l2,
           senses.teaching_priority::TEXT AS teaching_priority,
           manifests.package_digest
      FROM sensa.book_version_senses AS members
      JOIN sensa.book_versions AS versions
        ON versions.book_version_id = members.book_version_id
       AND versions.book_version_id = $1
       AND versions.content_release_id = $2
       AND versions.status IN ('published', 'retired')
      JOIN sensa.content_releases AS releases
        ON releases.content_release_id = versions.content_release_id
       AND releases.status IN ('published', 'superseded')
      JOIN sensa.sense_versions AS senses
        ON senses.sense_version_id = members.sense_version_id
       AND senses.content_release_id = $2
       AND senses.review_status = 'approved'
      JOIN sensa.senses AS stable_senses ON stable_senses.sense_id = senses.sense_id
      JOIN sensa.lexemes AS lexemes ON lexemes.lexeme_id = stable_senses.lexeme_id
      JOIN sensa.lexeme_versions AS lexeme_versions
        ON lexeme_versions.content_release_id = $2
       AND lexeme_versions.lexeme_id = stable_senses.lexeme_id
      LEFT JOIN LATERAL (
        SELECT manifests.package_digest
          FROM sensa.required_asset_manifests AS manifests
          JOIN sensa.acquisition_profiles AS profiles
            ON profiles.acquisition_profile_id = manifests.acquisition_profile_id
           AND profiles.content_release_id = $2
           AND profiles.sense_version_id = senses.sense_version_id
           AND profiles.learner_locale = releases.learner_locale
           AND profiles.review_status = 'approved'
         WHERE manifests.content_release_id = $2
           AND manifests.sense_version_id = senses.sense_version_id
           AND manifests.validator_version = $3
           AND manifests.capability_resolver_version = releases.capability_resolver_version
           AND manifests.status = 'satisfied'
           AND EXISTS (
             SELECT 1 FROM sensa.manifest_requirements AS requirements
              WHERE requirements.required_asset_manifest_id = manifests.required_asset_manifest_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM sensa.manifest_requirements AS requirements
              WHERE requirements.required_asset_manifest_id = manifests.required_asset_manifest_id
                AND (
                  requirements.status <> 'satisfied'
                  OR requirements.satisfied_count < requirements.required_count
                  OR requirements.satisfied_count <> (
                    SELECT COUNT(*)::INTEGER
                      FROM (
                        SELECT matches.learning_asset_id::TEXT AS matched_id
                          FROM sensa.manifest_requirement_asset_matches AS matches
                         WHERE matches.manifest_requirement_id = requirements.manifest_requirement_id
                           AND matches.content_release_id = $2
                        UNION ALL
                        SELECT matches.usage_pattern_id::TEXT AS matched_id
                          FROM sensa.manifest_requirement_usage_pattern_matches AS matches
                         WHERE matches.manifest_requirement_id = requirements.manifest_requirement_id
                           AND matches.content_release_id = $2
                      ) AS actual_matches
                  )
                )
           )
         ORDER BY manifests.validated_at DESC, manifests.required_asset_manifest_id ASC
         LIMIT 1
      ) AS manifests ON TRUE
     WHERE members.book_version_id = $1${cursorClause}
     ORDER BY members.ordinal ASC
     LIMIT $${params.length}
  `, params);
}

function mapMember(row: Row): SensaPublicBookManifestMember {
  const teachingPriority = readString(row, "teaching_priority", "Book member teaching priority");
  if (teachingPriority !== "core" && teachingPriority !== "extended" && teachingPriority !== "recognition") {
    throw inconsistent("Book member teaching priority is invalid.");
  }
  return {
    ordinal: readInteger(row, "ordinal", "Book member ordinal", 1),
    senseVersionId: readUuid(row, "sense_version_id", "Book member Sense Version"),
    senseId: readUuid(row, "sense_id", "Book member Sense"),
    senseKey: readString(row, "sense_key", "Book member Sense key"),
    lexemeVersionId: readUuid(row, "lexeme_version_id", "Book member Lexeme Version"),
    lexemeId: readUuid(row, "lexeme_id", "Book member Lexeme"),
    lemma: readString(row, "lemma", "Book member lemma"),
    partOfSpeech: readString(row, "part_of_speech", "Book member part of speech"),
    guideLabelL1: readString(row, "guide_label_l1", "Book member guide label"),
    teachingPriority,
    packageDigest: readDigest(row, "package_digest", "Book member package digest"),
  };
}

function asBuildReleaseReference(reference: SensaPinnedContentReleaseReference): SensaCatalogBuildReleaseReference {
  return reference;
}

function mapBuildItems(
  items: ReadonlyArray<SensaCatalogBuildContentItem>,
): ReadonlyArray<{ ordinal: number; package: SensaPinnedContentPage["items"][number]["package"] }> {
  return items.map((item) => ({
    ordinal: item.ordinal,
    package: item.package,
  }));
}

function assertMembers(
  summary: SensaPinnedBookSummary,
  rows: ReadonlyArray<Row>,
): ReadonlyArray<SensaPublicBookManifestMember> {
  if (rows.length !== summary.senseCount) throw inconsistent("Book member count does not match its immutable summary.");
  const members = rows.map(mapMember);
  for (const [index, member] of members.entries()) {
    if (member.ordinal !== index + 1) throw inconsistent("Book member ordinals are not contiguous.");
  }
  const digest = computeManifestDigest(summary.bookVersionId, summary.contentRelease.contentReleaseId, members);
  if (digest !== summary.manifestDigest) throw inconsistent("Book manifest digest does not match immutable membership.");
  return members;
}

function assertIdentityCursor(input: SensaPinnedContentPageInput, identity: SensaPinnedContentIdentity, cursor: PinnedCursorPayload | null): void {
  if (cursor === null) return;
  if (cursor.endpoint !== "pinned-content-items"
    || cursor.studyPlanId.toLowerCase() !== identity.studyPlanId.toLowerCase()
    || cursor.bookVersionId.toLowerCase() !== identity.bookVersionId.toLowerCase()
    || cursor.contentReleaseId.toLowerCase() !== identity.contentReleaseId.toLowerCase()
    || cursor.manifestDigest !== identity.manifestDigest
    || cursor.targetLanguage !== identity.targetLanguage
    || cursor.learnerLocale !== identity.learnerLocale
    || input.studyPlanId.toLowerCase() !== cursor.studyPlanId.toLowerCase()) {
    throw invalidCursor();
  }
}

async function buildManifest(
  executor: DatabaseExecutor,
  input: SensaPinnedContentManifestInput,
): Promise<SensaPinnedContentManifest> {
  const loaded = await loadPinnedBook(executor, input);
  const rows = await loadPinnedMembers(
    executor,
    loaded.identity.bookVersionId,
    loaded.identity.contentReleaseId,
    loaded.summary.contentRelease.validatorVersion,
    { kind: "page", cursor: null, limit: loaded.summary.senseCount },
  );
  const pageRows = rows.length > loaded.summary.senseCount ? rows.slice(0, loaded.summary.senseCount) : rows;
  const members = assertMembers(loaded.summary, pageRows);
  if (rows.length !== loaded.summary.senseCount) throw inconsistent("Book membership is incomplete.");
  // The full builder is deliberately invoked even for the manifest endpoint:
  // a manifest must not authorize restoring a package whose required assets
  // are no longer complete in the immutable Release.
  const packages = await buildSensaCatalogPackages(
    executor,
    loaded.identity.contentReleaseId,
    pageRows,
    asBuildReleaseReference(loaded.summary.contentRelease),
  );
  if (packages.length !== members.length || packages.some((item, index) => item.ordinal !== members[index]?.ordinal || item.package.packageDigest !== members[index]?.packageDigest)) {
    throw inconsistent("Book membership and complete package digests do not match.");
  }
  return {
    ...loaded.identity,
    book: loaded.summary,
    contentRelease: loaded.summary.contentRelease,
    members,
  };
}

export type SensaPinnedContentModuleOptions = Readonly<{
  executor?: DatabaseExecutor;
}>;

export function createPostgresSensaPinnedContentModule(
  options: SensaPinnedContentModuleOptions = {},
): SensaPinnedContentModule {
  const readOnly = <Result>(
    input: Readonly<{ workspaceId: string; learnerUserId: string }>,
    callback: (executor: DatabaseExecutor) => Promise<Result>,
  ): Promise<Result> => options.executor === undefined
    ? transactionWithWorkspaceScopeReadOnly({ userId: input.learnerUserId, workspaceId: input.workspaceId }, callback)
    : callback(options.executor);

  return {
    async getManifest(input): Promise<SensaPinnedContentManifest> {
      return readOnly(input, (executor) => buildManifest(executor, input));
    },

    async getItem(input: SensaPinnedContentItemInput): Promise<SensaPinnedContentSingleItem> {
      if (!uuidPattern.test(input.senseId)) throw notAvailable();
      return readOnly(input, async (executor) => {
        const loaded = await loadPinnedBook(executor, input);
        const rows = await loadPinnedMembers(
          executor,
          loaded.identity.bookVersionId,
          loaded.identity.contentReleaseId,
          loaded.summary.contentRelease.validatorVersion,
          { kind: "sense", senseId: input.senseId.toLowerCase() },
        );
        // A Sense that is not a member of the pinned Book Version and a Sense
        // whose package is no longer complete in the immutable Release share
        // the same answer, for the same reason `notAvailable` is shared above.
        if (rows.length === 0) throw notAvailable();
        if (rows.length > 1) throw inconsistent("A Sense appears more than once in the immutable membership.");
        const member = mapMember(rows[0]!);
        const packages = await buildSensaCatalogPackages(
          executor,
          loaded.identity.contentReleaseId,
          rows,
          asBuildReleaseReference(loaded.summary.contentRelease),
        );
        const built = packages[0];
        if (packages.length !== 1 || built === undefined
          || built.ordinal !== member.ordinal
          || built.package.packageDigest !== member.packageDigest) {
          throw inconsistent("A pinned Sense package does not match its immutable member digest.");
        }
        return {
          ...loaded.identity,
          book: loaded.summary,
          contentRelease: loaded.summary.contentRelease,
          item: { ordinal: built.ordinal, package: built.package },
        };
      });
    },

    async getPage(input): Promise<SensaPinnedContentPage> {
      const cursor = decodeCursor(input.cursor);
      return readOnly(input, async (executor) => {
        const loaded = await loadPinnedBook(executor, input);
        assertIdentityCursor(input, loaded.identity, cursor);
        const rows = await loadPinnedMembers(
          executor,
          loaded.identity.bookVersionId,
          loaded.identity.contentReleaseId,
          loaded.summary.contentRelease.validatorVersion,
          { kind: "page", cursor, limit: input.pageSize },
        );
        const hasMore = rows.length > input.pageSize;
        const pageRows = hasMore ? rows.slice(0, input.pageSize) : rows;
        if (pageRows.length === 0 && cursor !== null) throw invalidCursor();
        const packages = await buildSensaCatalogPackages(
          executor,
          loaded.identity.contentReleaseId,
          pageRows,
          asBuildReleaseReference(loaded.summary.contentRelease),
        );
        const members = pageRows.map(mapMember);
        if (packages.length !== pageRows.length || packages.some((item, index) => item.ordinal !== members[index]?.ordinal || item.package.packageDigest !== members[index]?.packageDigest)) {
          throw inconsistent("A pinned page package does not match its immutable member digest.");
        }
        const items = mapBuildItems(packages);
        const last = items.at(-1);
        return {
          ...loaded.identity,
          book: loaded.summary,
          contentRelease: loaded.summary.contentRelease,
          items,
          nextCursor: hasMore && last !== undefined
            ? encodeCursor({
              v: 1,
              endpoint: "pinned-content-items",
              ...loaded.identity,
              ordinal: last.ordinal,
            })
            : null,
          hasMore,
        };
      });
    },
  };
}

export const postgresSensaPinnedContentModule = createPostgresSensaPinnedContentModule();
