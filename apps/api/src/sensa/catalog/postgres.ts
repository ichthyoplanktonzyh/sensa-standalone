import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { unsafeRepeatableReadReadOnlyTransaction } from "../../database/core.js";
import type { DatabaseExecutor, SqlValue } from "../../database/index.js";
import { HttpError } from "../../shared/errors.js";
import { z } from "zod";
import {
  createPublicLaunchEligibleLexemeCount,
  type PublicLaunchEligibleLexemeCount,
  type SensaCatalogCursor,
  type SensaCatalogModule,
  type SensaPublicAcquisitionNeed,
  type SensaPublicAcquisitionPrimitive,
  type SensaPublicAssetCapability,
  type SensaPublicAssetProvenance,
  type SensaPublicAcquisitionProfileSnapshot,
  type SensaPublicBookListInput,
  type SensaPublicBookManifest,
  type SensaPublicBookManifestInput,
  type SensaPublicBookManifestMember,
  type SensaPublicBookSummary,
  type SensaPublicContentReleaseItem,
  type SensaPublicContentReleasePage,
  type SensaPublicContentReleasePageInput,
  type SensaPublicContentReleaseReference,
  type SensaPublicExampleAsset,
  type SensaPublicExampleAudioAsset,
  type SensaPublicExperienceSketchAsset,
  type SensaPublicL1BridgeAsset,
  type SensaPublicLearningAsset,
  type SensaPublicLexemeSnapshot,
  type SensaPublicManifestRequirement,
  type SensaPublicMediaReference,
  type SensaPublicProfileBoundaryTarget,
  type SensaPublicRequiredAssetManifest,
  type SensaPublicSenseLearningPackageSnapshot,
  type SensaPublicSenseRelationSnapshot,
  type SensaPublicSenseSnapshot,
  type SensaPublicSequenceAsset,
  type SensaPublicSequenceStep,
  type SensaPublicSpatialDiagramAsset,
  type SensaPublicUsagePatternSlot,
  type SensaPublicUsagePatternSnapshot,
} from "@sensa/contracts/sensa";

type Row = QueryResultRow & Record<string, unknown>;

/**
 * Internal package-builder shape shared by public discovery and the
 * workspace-scoped pinned runtime.  Public routes only ever pass `published`;
 * pinned routes may pass `superseded` after independently authorizing the
 * learner's Study Plan tuple.
 */
export type SensaCatalogBuildReleaseReference = Omit<
  SensaPublicContentReleaseReference,
  "status"
> & Readonly<{
  status: "published" | "superseded";
}>;

export type SensaCatalogBuildPackage = Omit<
  SensaPublicSenseLearningPackageSnapshot,
  "contentRelease"
> & Readonly<{
  contentRelease: SensaCatalogBuildReleaseReference;
}>;

export type SensaCatalogBuildContentItem = Readonly<{
  ordinal: number;
  package: SensaCatalogBuildPackage;
}>;

const cursorVersion = 1;
const cursorMaximumLength = 2_048;
const sha256Pattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const acquisitionNeeds = [
  "perceptual_grounding",
  "boundary_formation",
  "abstraction_invariant",
  "spatial_aspectual_tuning",
  "social_normative_calibration",
  "form_binding",
] as const satisfies ReadonlyArray<SensaPublicAcquisitionNeed>;

const acquisitionPrimitives = [
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
] as const satisfies ReadonlyArray<SensaPublicAcquisitionPrimitive>;

const assetCapabilities = [
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
] as const satisfies ReadonlyArray<SensaPublicAssetCapability>;

const enumSet = <T extends string>(values: ReadonlyArray<T>): ReadonlySet<string> => new Set(values);
const acquisitionNeedSet = enumSet(acquisitionNeeds);
const acquisitionPrimitiveSet = enumSet(acquisitionPrimitives);
const assetCapabilitySet = enumSet(assetCapabilities);

type ListCursorPayload = Readonly<{
  v: 1;
  endpoint: "books";
  targetLanguage: string | null;
  learnerLocale: string | null;
  bookKey: string;
  versionNumber: number;
  bookVersionId: string;
}>;

type ContentCursorPayload = Readonly<{
  v: 1;
  endpoint: "content-release-items";
  bookVersionId: string;
  contentReleaseId: string;
  ordinal: number;
}>;

type CursorPayload = ListCursorPayload | ContentCursorPayload;

const catalogCursorSchema = z.discriminatedUnion("endpoint", [
  z.object({
    v: z.literal(cursorVersion),
    endpoint: z.literal("books"),
    targetLanguage: z.string().nullable(),
    learnerLocale: z.string().nullable(),
    bookKey: z.string().trim().min(1),
    versionNumber: z.number().int().positive(),
    bookVersionId: z.string().regex(uuidPattern),
  }).strict(),
  z.object({
    v: z.literal(cursorVersion),
    endpoint: z.literal("content-release-items"),
    bookVersionId: z.string().regex(uuidPattern),
    contentReleaseId: z.string().regex(uuidPattern),
    ordinal: z.number().int().positive(),
  }).strict(),
]);

type BookRow = Row;

type MemberRow = Row;

type AssetRow = Row;

type PublicSenseAssetBase = Readonly<{
  learningAssetId: string;
  contentReleaseId: string;
  senseVersionId: string;
  learnerLocale: string;
  contentDigest: string;
  reviewStatus: "approved";
  provenance: SensaPublicAssetProvenance;
}>;

type PublicLexemeAssetBase = Readonly<{
  learningAssetId: string;
  contentReleaseId: string;
  lexemeVersionId: string;
  learnerLocale: string | null;
  contentDigest: string;
  reviewStatus: "approved";
  provenance: SensaPublicAssetProvenance;
}>;

function catalogError(
  statusCode: number,
  message: string,
  code: string,
): HttpError {
  return new HttpError(statusCode, message, code);
}

function notFound(code: "SENSA_CATALOG_BOOK_NOT_FOUND" | "SENSA_CATALOG_RELEASE_NOT_FOUND"): HttpError {
  return catalogError(
    404,
    code === "SENSA_CATALOG_BOOK_NOT_FOUND"
      ? "The requested Sensa Book is not available."
      : "The requested Sensa Content Release is not available.",
    code,
  );
}

function snapshotInconsistent(detail: string): HttpError {
  // Keep the detail actionable without including SQL, row data, or source
  // provenance.  It is suitable for operators and safe for public callers.
  return catalogError(
    409,
    `The published Sensa snapshot is inconsistent and cannot be delivered. ${detail}`,
    "SENSA_CATALOG_PUBLISHED_SNAPSHOT_INCONSISTENT",
  );
}

function invalidCursor(): HttpError {
  return catalogError(
    400,
    "cursor is invalid for this Sensa Catalog endpoint or filter.",
    "SENSA_CATALOG_CURSOR_INVALID",
  );
}

function assertPublicPageSize(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw catalogError(
      400,
      `pageSize must be an integer between 1 and ${maximum}.`,
      "SENSA_CATALOG_PAGE_SIZE_INVALID",
    );
  }
}

function assertUuidInput(value: string, fieldName: string): string {
  if (!uuidPattern.test(value)) {
    throw catalogError(400, `${fieldName} must be a UUID.`, "SENSA_CATALOG_PARAMETER_INVALID");
  }
  return value.toLowerCase();
}

function readString(row: Row, key: string, context: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw snapshotInconsistent(`Missing ${context}.`);
  }
  return value;
}

function readStringAllowEmpty(row: Row, key: string, context: string): string {
  const value = row[key];
  if (typeof value !== "string") throw snapshotInconsistent(`Invalid ${context}.`);
  return value;
}

function readNullableString(row: Row, key: string, context: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw snapshotInconsistent(`Invalid ${context}.`);
  }
  return value;
}

function readNullableUuid(row: Row, key: string, context: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw snapshotInconsistent(`Invalid ${context}.`);
  }
  return value;
}

function readUuid(row: Row, key: string, context: string): string {
  const value = readString(row, key, context);
  if (!uuidPattern.test(value)) throw snapshotInconsistent(`Invalid ${context}.`);
  return value;
}

function readSha256(row: Row, key: string, context: string): string {
  const value = readString(row, key, context);
  if (!sha256Pattern.test(value) || value !== value.toLowerCase()) {
    throw snapshotInconsistent(`Invalid ${context}.`);
  }
  return value;
}

function readInteger(
  row: Row,
  key: string,
  context: string,
  options: Readonly<{ minimum?: number; maximum?: number }> = {},
): number {
  const value = row[key];
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^-?[0-9]+$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (
    !Number.isSafeInteger(parsed)
    || (options.minimum !== undefined && parsed < options.minimum)
    || (options.maximum !== undefined && parsed > options.maximum)
  ) {
    throw snapshotInconsistent(`Invalid ${context}.`);
  }
  return parsed;
}

function readBoolean(row: Row, key: string, context: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") throw snapshotInconsistent(`Invalid ${context}.`);
  return value;
}

function readDate(row: Row, key: string, context: string): string {
  const value = row[key];
  const date = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw snapshotInconsistent(`Invalid ${context}.`);
  }
  return date.toISOString();
}

function readStringArray(row: Row, key: string, context: string): ReadonlyArray<string> {
  const value = row[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw snapshotInconsistent(`Invalid ${context}.`);
  }
  return value;
}

function readNonEmptyStringArray(row: Row, key: string, context: string): readonly [string, ...string[]] {
  const values = readStringArray(row, key, context);
  if (values.length === 0 || values.some((value) => value.trim() === "")) {
    throw snapshotInconsistent(`Missing ${context}.`);
  }
  return values as unknown as readonly [string, ...string[]];
}

function readEnum<T extends string>(
  row: Row,
  key: string,
  values: ReadonlySet<string>,
  context: string,
): T {
  const value = readString(row, key, context);
  if (!values.has(value)) throw snapshotInconsistent(`Invalid ${context}.`);
  return value as T;
}

function isPlaceholder(value: string | null): boolean {
  if (value === null || value.trim() === "") return true;
  const normalized = value.trim().toLowerCase();
  return normalized === "todo"
    || normalized === "tbd"
    || normalized === "placeholder"
    || normalized === "pending"
    || normalized === "n/a"
    || normalized === "na"
    || normalized === "null"
    || /^<[^>]+>$/.test(normalized);
}

function hasCompleteTuple(values: ReadonlyArray<string | null>): boolean {
  return values.every((value) => !isPlaceholder(value));
}

function hasAnyTupleValue(values: ReadonlyArray<string | null>): boolean {
  return values.some((value) => value !== null && value.trim() !== "");
}

function countValidatorWholeWord(text: string, needle: string): number {
  const trimmedNeedle = needle.trim();
  if (trimmedNeedle === "") return 0;
  const escaped = trimmedNeedle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "giu"))].length;
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function encodeCursor(payload: CursorPayload): SensaCatalogCursor {
  // Cursors are pagination state, not authorization capabilities.  The
  // endpoint-specific validation below binds this opaque value to the
  // request context without introducing an unconfigured signing secret.
  const cursor = base64UrlEncode(JSON.stringify(payload));
  if (cursor.length > cursorMaximumLength) throw snapshotInconsistent("Generated cursor is too large.");
  return cursor as SensaCatalogCursor;
}

function decodeCursor(cursor: SensaCatalogCursor | null): CursorPayload | null {
  if (cursor === null) return null;
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > cursorMaximumLength) {
    throw invalidCursor();
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw invalidCursor();
  let payload: unknown;
  try {
    const decoded = base64UrlDecode(cursor);
    if (base64UrlEncode(decoded) !== cursor) throw invalidCursor();
    payload = JSON.parse(decoded.toString("utf8")) as unknown;
  } catch {
    throw invalidCursor();
  }
  const parsed = catalogCursorSchema.safeParse(payload);
  if (!parsed.success) throw invalidCursor();
  return parsed.data;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function computeBookManifestDigest(
  bookVersionId: string,
  contentReleaseId: string,
  members: ReadonlyArray<Readonly<{ ordinal: number; senseVersionId: string }>>,
): string {
  const orderedMembers = [...members]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((member) => `${member.ordinal}:${member.senseVersionId}`)
    .join("\n");
  return sha256(`sensa-book-manifest-v1\n${bookVersionId}\n${contentReleaseId}\n${orderedMembers}`);
}

function query<RowType extends QueryResultRow>(
  executor: DatabaseExecutor,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<{ rows: Array<RowType> }> {
  return executor.query<RowType>(text, params);
}

function mapReleaseReference(row: BookRow): SensaPublicContentReleaseReference {
  return {
    contentReleaseId: readUuid(row, "content_release_id", "Content Release identity"),
    releaseKey: readString(row, "release_key", "Content Release key"),
    versionNumber: readInteger(row, "release_version_number", "Content Release version", { minimum: 1 }),
    targetLanguage: readString(row, "release_target_language", "Content Release target language"),
    learnerLocale: readString(row, "release_learner_locale", "Content Release learner locale"),
    schemaVersion: readString(row, "release_schema_version", "Content Release schema version"),
    sourceDigest: readSha256(row, "source_digest", "Content Release source digest"),
    validatorVersion: readString(row, "release_validator_version", "Content Release validator version"),
    status: "published",
  };
}

function mapBookSummary(row: BookRow): SensaPublicBookSummary {
  const release = mapReleaseReference(row);
  const senseCount = readInteger(row, "member_sense_count", "Book Sense count", { minimum: 1 });
  const lexemeCountNumber = readInteger(row, "member_lexeme_count", "Book distinct Lexeme count", { minimum: 1 });
  let lexemeCount: PublicLaunchEligibleLexemeCount;
  try {
    lexemeCount = createPublicLaunchEligibleLexemeCount(lexemeCountNumber);
  } catch {
    throw notFound("SENSA_CATALOG_BOOK_NOT_FOUND");
  }
  const status = readString(row, "book_version_status", "Book Version status");
  const releaseStatus = readString(row, "release_status", "Content Release status");
  if (status !== "published" || releaseStatus !== "published") {
    throw notFound("SENSA_CATALOG_BOOK_NOT_FOUND");
  }
  const targetLanguage = readString(row, "book_target_language", "Book target language");
  const learnerLocale = readString(row, "book_learner_locale", "Book learner locale");
  if (targetLanguage !== release.targetLanguage || learnerLocale !== release.learnerLocale) {
    throw snapshotInconsistent("Book Version language and Content Release language do not match.");
  }
  return {
    bookId: readUuid(row, "book_id", "Book identity"),
    bookKey: readString(row, "book_key", "Book key"),
    bookVersionId: readUuid(row, "book_version_id", "Book Version identity"),
    versionNumber: readInteger(row, "book_version_number", "Book Version number", { minimum: 1 }),
    contentRelease: release,
    targetLanguage,
    learnerLocale,
    title: readString(row, "book_title", "Book title"),
    description: readStringAllowEmpty(row, "book_description", "Book description"),
    manifestDigest: readSha256(row, "manifest_digest", "Book manifest digest"),
    senseCount,
    lexemeCount,
    status: "published",
    publishedAt: readDate(row, "book_published_at", "Book publication timestamp"),
  };
}

const publicBookCte = `
  WITH public_books AS (
    SELECT
      books.book_id,
      books.book_key,
      versions.book_version_id,
      versions.version_number AS book_version_number,
      versions.content_release_id,
      versions.target_language AS book_target_language,
      versions.learner_locale AS book_learner_locale,
      versions.title AS book_title,
      versions.description AS book_description,
      versions.manifest_digest,
      versions.status::TEXT AS book_version_status,
      versions.published_at AS book_published_at,
      releases.release_key,
      releases.version_number AS release_version_number,
      releases.target_language AS release_target_language,
      releases.learner_locale AS release_learner_locale,
      releases.schema_version AS release_schema_version,
      releases.source_digest,
      releases.validator_version AS release_validator_version,
      releases.status::TEXT AS release_status,
      COUNT(members.ordinal)::TEXT AS member_sense_count,
      MIN(members.ordinal)::TEXT AS member_min_ordinal,
      MAX(members.ordinal)::TEXT AS member_max_ordinal,
      COUNT(approved_senses.sense_version_id)::TEXT AS approved_sense_count,
      COUNT(DISTINCT approved_lexeme_versions.lexeme_id)::TEXT AS member_lexeme_count
    FROM sensa.books AS books
    JOIN sensa.book_versions AS versions
      ON versions.book_id = books.book_id
     AND versions.status = 'published'
    JOIN sensa.content_releases AS releases
      ON releases.content_release_id = versions.content_release_id
     AND releases.status = 'published'
     AND releases.capability_resolver_version = 'sensa-executable-learning-capability-resolver-v1'
    JOIN sensa.book_version_senses AS members
      ON members.book_version_id = versions.book_version_id
    LEFT JOIN sensa.sense_versions AS approved_senses
      ON approved_senses.sense_version_id = members.sense_version_id
     AND approved_senses.content_release_id = versions.content_release_id
     AND approved_senses.review_status = 'approved'
    LEFT JOIN sensa.senses AS approved_stable_senses
      ON approved_stable_senses.sense_id = approved_senses.sense_id
    LEFT JOIN sensa.lexemes AS approved_lexemes
      ON approved_lexemes.lexeme_id = approved_stable_senses.lexeme_id
    LEFT JOIN sensa.lexeme_versions AS approved_lexeme_versions
      ON approved_lexeme_versions.content_release_id = versions.content_release_id
     AND approved_lexeme_versions.lexeme_id = approved_lexemes.lexeme_id
    GROUP BY
      books.book_id, books.book_key, versions.book_version_id, versions.version_number,
      versions.content_release_id, versions.target_language, versions.learner_locale,
      versions.title, versions.description, versions.manifest_digest, versions.status,
      versions.published_at, releases.release_key, releases.version_number,
      releases.target_language, releases.learner_locale, releases.schema_version,
      releases.source_digest, releases.validator_version, releases.status
  )
`;

async function loadPublicBookRows(
  executor: DatabaseExecutor,
  input: Readonly<{
    bookVersionId?: string;
    targetLanguage?: string;
    learnerLocale?: string;
    cursor?: ListCursorPayload | null;
    pageSize?: number;
  }>,
): Promise<Array<BookRow>> {
  const params: SqlValue[] = [];
  const conditions = [
    "member_sense_count = approved_sense_count",
    "member_min_ordinal = '1'",
    "member_max_ordinal = member_sense_count",
    "member_lexeme_count::BIGINT >= 1000",
  ];
  if (input.bookVersionId !== undefined) {
    params.push(input.bookVersionId);
    conditions.push(`book_version_id = $${params.length}`);
  }
  if (input.targetLanguage !== undefined) {
    params.push(input.targetLanguage);
    conditions.push(`book_target_language = $${params.length}`);
  }
  if (input.learnerLocale !== undefined) {
    params.push(input.learnerLocale);
    conditions.push(`book_learner_locale = $${params.length}`);
  }
  if (input.cursor !== null && input.cursor !== undefined) {
    params.push(input.cursor.bookKey, input.cursor.versionNumber, input.cursor.bookVersionId);
    conditions.push(`(
      book_key, book_version_number, book_version_id
    ) > ($${params.length - 2}, $${params.length - 1}, $${params.length})`);
  }
  const limitClause = input.bookVersionId === undefined
    ? (() => {
      params.push((input.pageSize ?? 100) + 1);
      return `LIMIT $${params.length}`;
    })()
    : "LIMIT 1";
  return (await query<Row>(
    executor,
    `${publicBookCte}
     SELECT book_id, book_key, book_version_id, book_version_number,
            content_release_id, book_target_language, book_learner_locale,
            book_title, book_description, manifest_digest, book_version_status,
            book_published_at, release_key, release_version_number,
            release_target_language, release_learner_locale, release_schema_version,
            source_digest, release_validator_version, release_status,
            member_sense_count, member_min_ordinal, member_max_ordinal,
            approved_sense_count, member_lexeme_count
       FROM public_books
     WHERE ${conditions.join(" AND ")}
     ORDER BY book_key ASC, book_version_number ASC, book_version_id ASC
     ${limitClause}`,
    params,
  )).rows;
}

async function loadPublicBook(
  executor: DatabaseExecutor,
  bookVersionId: string,
): Promise<Readonly<{ row: BookRow; summary: SensaPublicBookSummary }>> {
  const rows = await loadPublicBookRows(executor, { bookVersionId });
  if (rows.length === 0) throw notFound("SENSA_CATALOG_BOOK_NOT_FOUND");
  const row = rows[0];
  if (row === undefined) throw notFound("SENSA_CATALOG_BOOK_NOT_FOUND");
  return { row, summary: mapBookSummary(row) };
}

function requireListCursor(
  cursor: SensaCatalogCursor | null,
  input: SensaPublicBookListInput,
): ListCursorPayload | null {
  const decoded = decodeCursor(cursor);
  if (decoded === null) return null;
  if (
    decoded.endpoint !== "books"
    || decoded.targetLanguage !== (input.targetLanguage ?? null)
    || decoded.learnerLocale !== (input.learnerLocale ?? null)
  ) throw invalidCursor();
  return decoded;
}

function requireContentCursor(
  cursor: SensaCatalogCursor | null,
  input: SensaPublicContentReleasePageInput,
): ContentCursorPayload | null {
  const decoded = decodeCursor(cursor);
  if (decoded === null) return null;
  if (
    decoded.endpoint !== "content-release-items"
    || decoded.bookVersionId.toLowerCase() !== input.bookVersionId.toLowerCase()
    || decoded.contentReleaseId.toLowerCase() !== input.contentReleaseId.toLowerCase()
  ) throw invalidCursor();
  return decoded;
}

async function verifyBookManifestDigest(
  executor: DatabaseExecutor,
  bookVersionId: string,
  contentReleaseId: string,
  storedDigest: string,
): Promise<void> {
  const rows = (await query<Row>(
    executor,
    `SELECT ordinal, sense_version_id
       FROM sensa.book_version_senses
      WHERE book_version_id = $1
      ORDER BY ordinal ASC`,
    [bookVersionId],
  )).rows;
  const members = rows.map((row) => ({
    ordinal: readInteger(row, "ordinal", "Book member ordinal", { minimum: 1 }),
    senseVersionId: readUuid(row, "sense_version_id", "Book member Sense Version"),
  }));
  if (members.length === 0 || members.some((member, index) => member.ordinal !== index + 1)) {
    throw snapshotInconsistent("Book member order is not contiguous.");
  }
  const computed = computeBookManifestDigest(bookVersionId, contentReleaseId, members);
  if (computed !== storedDigest) throw snapshotInconsistent("Book manifest digest does not match membership.");
}

function mapManifestMember(row: MemberRow): SensaPublicBookManifestMember {
  return {
    ordinal: readInteger(row, "ordinal", "manifest member ordinal", { minimum: 1 }),
    senseVersionId: readUuid(row, "sense_version_id", "manifest Sense Version"),
    senseId: readUuid(row, "sense_id", "manifest Sense"),
    senseKey: readString(row, "sense_key", "manifest Sense key"),
    lexemeVersionId: readUuid(row, "lexeme_version_id", "manifest Lexeme Version"),
    lexemeId: readUuid(row, "lexeme_id", "manifest Lexeme"),
    lemma: readString(row, "lemma", "manifest lemma"),
    partOfSpeech: readString(row, "part_of_speech", "manifest part of speech"),
    guideLabelL1: readString(row, "guide_label_l1", "manifest guide label"),
    teachingPriority: readEnum(row, "teaching_priority", new Set(["core", "extended", "recognition"]), "manifest teaching priority"),
    packageDigest: readSha256(row, "package_digest", "manifest package digest"),
  };
}

async function loadManifestMembers(
  executor: DatabaseExecutor,
  bookVersionId: string,
  contentReleaseId: string,
): Promise<Array<MemberRow>> {
  return (await query<Row>(
    executor,
    `SELECT
       members.ordinal,
       senses.sense_version_id,
       stable_senses.sense_id,
       stable_senses.sense_key,
       lexeme_versions.lexeme_version_id,
       lexemes.lexeme_id,
       lexemes.lemma,
       senses.part_of_speech,
       senses.guide_label_l1,
       senses.teaching_priority::TEXT AS teaching_priority,
       manifests.package_digest
     FROM sensa.book_version_senses AS members
     JOIN sensa.book_versions AS versions
       ON versions.book_version_id = members.book_version_id
      AND versions.status = 'published'
      AND versions.content_release_id = $2
     JOIN sensa.content_releases AS releases
       ON releases.content_release_id = versions.content_release_id
      AND releases.status = 'published'
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
         AND manifests.validator_version = releases.validator_version
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
     WHERE members.book_version_id = $1
     ORDER BY members.ordinal ASC`,
    [bookVersionId, contentReleaseId],
  )).rows;
}

function mapSenseAssetBase(row: AssetRow): PublicSenseAssetBase {
  const senseVersionId = readUuid(row, "sense_version_id", "Sense asset owner");
  return {
    learningAssetId: readUuid(row, "learning_asset_id", "Learning Asset identity"),
    contentReleaseId: readUuid(row, "content_release_id", "Learning Asset release"),
    senseVersionId,
    learnerLocale: readString(row, "learner_locale", "Sense asset learner locale"),
    contentDigest: readSha256(row, "content_digest", "Learning Asset digest"),
    reviewStatus: "approved",
    provenance: {
      sourceEvidenceRefs: readNonEmptyStringArray(row, "source_evidence_refs", "Learning Asset source evidence"),
      generatorProvider: readNullableString(row, "generator_provider", "Learning Asset generator provider"),
      generatorModel: readNullableString(row, "generator_model", "Learning Asset generator model"),
      promptVersion: readNullableString(row, "prompt_version", "Learning Asset prompt version"),
      sourceLicense: readNullableString(row, "source_license", "Learning Asset source license"),
      sourceAttribution: readNullableString(row, "source_attribution", "Learning Asset source attribution"),
    },
  };
}

function mapLexemeAssetBase(row: AssetRow): PublicLexemeAssetBase {
  return {
    learningAssetId: readUuid(row, "learning_asset_id", "Learning Asset identity"),
    contentReleaseId: readUuid(row, "content_release_id", "Learning Asset release"),
    lexemeVersionId: readUuid(row, "lexeme_version_id", "Lexeme asset owner"),
    learnerLocale: readNullableString(row, "learner_locale", "Lexeme asset learner locale"),
    contentDigest: readSha256(row, "content_digest", "Learning Asset digest"),
    reviewStatus: "approved",
    provenance: {
      sourceEvidenceRefs: readNonEmptyStringArray(row, "source_evidence_refs", "Learning Asset source evidence"),
      generatorProvider: readNullableString(row, "generator_provider", "Learning Asset generator provider"),
      generatorModel: readNullableString(row, "generator_model", "Learning Asset generator model"),
      promptVersion: readNullableString(row, "prompt_version", "Learning Asset prompt version"),
      sourceLicense: readNullableString(row, "source_license", "Learning Asset source license"),
      sourceAttribution: readNullableString(row, "source_attribution", "Learning Asset source attribution"),
    },
  };
}

function mapMedia(row: Row, mediaTypePrefix: "image" | "audio"): SensaPublicMediaReference {
  const mimeType = readString(row, "media_mime_type", "media MIME type");
  const mimePattern = mediaTypePrefix === "image"
    ? /^image\/[^\s;]+$/iu
    : /^audio\/[^\s;]+$/iu;
  if (!mimePattern.test(mimeType)) {
    throw snapshotInconsistent(`Published ${mediaTypePrefix} media has an invalid MIME type.`);
  }
  return {
    mediaBlobId: readUuid(row, "media_blob_id", "media blob identity"),
    sha256: readSha256(row, "media_sha256", "media blob digest"),
    mimeType,
    sizeBytes: readInteger(row, "media_size_bytes", "media byte size", { minimum: 1 }),
  };
}

function mapExperience(row: AssetRow, text: Row): SensaPublicExperienceSketchAsset {
  return { ...mapSenseAssetBase(row), kind: "experience_sketch", body: readString(text, "body", "Experience Sketch body") };
}

function mapBridge(row: AssetRow, text: Row): SensaPublicL1BridgeAsset {
  return { ...mapSenseAssetBase(row), kind: "l1_bridge", body: readString(text, "body", "L1 Bridge body") };
}

function mapUsagePattern(row: Row, slots: ReadonlyArray<Row>): SensaPublicUsagePatternSnapshot {
  return {
    contentReleaseId: readUuid(row, "content_release_id", "Usage Pattern release"),
    usagePatternId: readUuid(row, "usage_pattern_id", "Usage Pattern identity"),
    senseVersionId: readUuid(row, "sense_version_id", "Usage Pattern Sense owner"),
    ordinal: readInteger(row, "ordinal", "Usage Pattern ordinal", { minimum: 1 }),
    canonicalPattern: readString(row, "canonical_pattern", "Usage Pattern"),
    commonCollocations: readStringArray(row, "common_collocations", "Usage Pattern collocations"),
    registerLabel: readNullableString(row, "register_label", "Usage Pattern register"),
    domainLabel: readNullableString(row, "domain_label", "Usage Pattern domain"),
    usageRestriction: readNullableString(row, "usage_restriction", "Usage Pattern restriction"),
    sourceEvidenceRefs: readNonEmptyStringArray(row, "source_evidence_refs", "Usage Pattern source evidence"),
    slots: slots.map((slot) => ({
      ordinal: readInteger(slot, "ordinal", "Usage Pattern slot ordinal", { minimum: 1 }),
      slotName: readString(slot, "slot_name", "Usage Pattern slot name"),
      semanticRole: readString(slot, "semantic_role", "Usage Pattern slot role"),
      valueDescription: readString(slot, "value_description", "Usage Pattern slot description"),
      isOptional: readBoolean(slot, "is_optional", "Usage Pattern slot optional flag"),
    })),
    reviewStatus: "approved",
  };
}

function mapProfile(row: Row, targets: ReadonlyArray<Row>): SensaPublicAcquisitionProfileSnapshot {
  const needs = readNonEmptyStringArray(row, "acquisition_needs", "Acquisition Profile needs")
    .map((value) => {
      if (!acquisitionNeedSet.has(value)) throw snapshotInconsistent("Invalid Acquisition Profile need.");
      return value as SensaPublicAcquisitionNeed;
    }) as unknown as readonly [SensaPublicAcquisitionNeed, ...SensaPublicAcquisitionNeed[]];
  const primitives = readNonEmptyStringArray(row, "preferred_primitives", "Acquisition Profile primitives")
    .map((value) => {
      if (!acquisitionPrimitiveSet.has(value)) throw snapshotInconsistent("Invalid Acquisition Profile primitive.");
      return value as SensaPublicAcquisitionPrimitive;
    }) as unknown as readonly [SensaPublicAcquisitionPrimitive, ...SensaPublicAcquisitionPrimitive[]];
  const requiredCapabilities = readStringArray(row, "required_asset_capabilities", "Acquisition Profile required capabilities").map((value) => {
    if (!assetCapabilitySet.has(value)) throw snapshotInconsistent("Invalid Acquisition Profile capability.");
    return value as SensaPublicAssetCapability;
  });
  const optionalCapabilities = readStringArray(row, "optional_asset_capabilities", "Acquisition Profile optional capabilities").map((value) => {
    if (!assetCapabilitySet.has(value)) throw snapshotInconsistent("Invalid Acquisition Profile capability.");
    return value as SensaPublicAssetCapability;
  });
  return {
    contentReleaseId: readUuid(row, "content_release_id", "Acquisition Profile release"),
    acquisitionProfileId: readUuid(row, "acquisition_profile_id", "Acquisition Profile identity"),
    senseVersionId: readUuid(row, "sense_version_id", "Acquisition Profile Sense owner"),
    learnerLocale: readString(row, "learner_locale", "Acquisition Profile locale"),
    schemaVersion: readString(row, "schema_version", "Acquisition Profile schema version"),
    acquisitionNeeds: needs,
    minimumSufficientExperience: readString(row, "minimum_sufficient_experience", "Acquisition Profile experience"),
    distinguishingFeatures: readNonEmptyStringArray(row, "distinguishing_features", "Acquisition Profile distinguishing features"),
    preferredPrimitives: primitives,
    requiredAssetCapabilities: requiredCapabilities,
    optionalAssetCapabilities: optionalCapabilities,
    fallbackPrimitives: readNonEmptyStringArray(row, "fallback_primitives", "Acquisition Profile fallback primitives").map((value) => {
      if (!acquisitionPrimitiveSet.has(value)) throw snapshotInconsistent("Invalid Acquisition Profile fallback primitive.");
      return value as SensaPublicAcquisitionPrimitive;
    }),
    domainBound: readBoolean(row, "domain_bound", "Acquisition Profile domain bound"),
    domainConstraints: readStringArray(row, "domain_constraints", "Acquisition Profile domain constraints"),
    boundaryTargets: targets.map((target): SensaPublicProfileBoundaryTarget => ({
      senseRelationId: readUuid(target, "sense_relation_id", "Profile boundary relation"),
      ordinal: readInteger(target, "ordinal", "Profile boundary ordinal", { minimum: 1 }),
      isRequired: readBoolean(target, "is_required", "Profile boundary required flag"),
    })),
    sourceDigest: readString(row, "source_digest", "Acquisition Profile source digest"),
    profileProvenance: {
      generatorProvider: readNullableString(row, "generator_provider", "Acquisition Profile generator provider"),
      generatorModel: readNullableString(row, "generator_model", "Acquisition Profile generator model"),
      promptVersion: readNullableString(row, "prompt_version", "Acquisition Profile prompt version"),
    },
    reviewStatus: "approved",
  };
}

function mapRelation(row: Row): SensaPublicSenseRelationSnapshot {
  return {
    contentReleaseId: readUuid(row, "content_release_id", "Sense Relation release"),
    senseRelationId: readUuid(row, "sense_relation_id", "Sense Relation identity"),
    sourceSenseId: readUuid(row, "source_sense_id", "Sense Relation source"),
    targetSenseId: readUuid(row, "target_sense_id", "Sense Relation target"),
    sourceLexemeId: readUuid(row, "source_lexeme_id", "Sense Relation source Lexeme"),
    targetLexemeId: readUuid(row, "target_lexeme_id", "Sense Relation target Lexeme"),
    relationType: readString(row, "relation_type", "Sense Relation type"),
    scope: readEnum(row, "scope", new Set(["intra_word", "cross_word"]), "Sense Relation scope"),
    distinguishingFeature: readString(row, "distinguishing_feature", "Sense Relation feature"),
    sourceEvidenceRefs: readNonEmptyStringArray(row, "source_evidence_refs", "Sense Relation source evidence"),
    reviewStatus: "approved",
  };
}

function mapExample(row: AssetRow, detail: Row): SensaPublicExampleAsset {
  const base = mapSenseAssetBase(row);
  const construction = readString(detail, "construction", "Example construction");
  const sceneDomain = readString(detail, "scene_domain", "Example scene domain");
  const role = readString(detail, "role", "Example role");
  if (!new Set(["head_verb", "nonfinite_verb", "passive", "subject", "object", "prep_object", "predicative", "modifier", "adverbial"]).has(construction)) {
    throw snapshotInconsistent("Invalid Example construction.");
  }
  if (!new Set(["daily_life", "work_business", "study_school", "social_relations", "media_news", "travel_transport", "health_body", "tech_digital", "nature_environment", "arts_leisure"]).has(sceneDomain)) {
    throw snapshotInconsistent("Invalid Example scene domain.");
  }
  if (role !== "study" && role !== "quiz") throw snapshotInconsistent("Invalid Example role.");
  const textL2 = readString(detail, "text_l2", "Example L2 text");
  const targetStart = readInteger(detail, "target_start", "Example target start", { minimum: 0 });
  const targetEnd = readInteger(detail, "target_end", "Example target end", { minimum: targetStart + 1 });
  const targetForm = readString(detail, "target_form", "Example target form");
  // JavaScript string length/slice use UTF-16 code-unit offsets, which is the
  // frozen Example asset contract.  Validate the actual selected text as well
  // as the bounds so a published row cannot expose a misleading span.
  if (
    targetEnd > textL2.length
    || textL2.slice(targetStart, targetEnd).toLowerCase() !== targetForm.toLowerCase()
    || countValidatorWholeWord(textL2, targetForm) !== 1
  ) {
    throw snapshotInconsistent("Example target span does not select its target form.");
  }
  return {
    ...base,
    kind: "example",
    ordinal: readInteger(detail, "ordinal", "Example ordinal", { minimum: 1 }),
    textL2,
    textL1: readString(detail, "text_l1", "Example L1 text"),
    targetForm,
    targetStart,
    targetEnd,
    construction: construction as SensaPublicExampleAsset["construction"],
    sceneDomain: sceneDomain as SensaPublicExampleAsset["sceneDomain"],
    disambiguatingCue: readNullableString(detail, "disambiguating_cue", "Example disambiguating cue"),
    collocations: detail.collocations == null ? [] : readStringArray(detail, "collocations", "Example collocations"),
    variationNote: readNullableString(detail, "variation_note", "Example variation note"),
    role: role as "study" | "quiz",
    contextL2: readNullableString(detail, "context_l2", "Example L2 context"),
    contextL1: readNullableString(detail, "context_l1", "Example L1 context"),
  };
}

function mapAsset(
  row: AssetRow,
  details: Readonly<{
    text: Row | undefined;
    example: Row | undefined;
    contrast: Row | undefined;
    visual: Row | undefined;
    diagram: Row | undefined;
    sequence: Row | undefined;
    sequenceSteps: ReadonlyArray<Row>;
    audio: Row | undefined;
  }>,
): SensaPublicLearningAsset {
  const kind = readString(row, "asset_kind", "Learning Asset kind");
  switch (kind) {
    case "experience_sketch":
      if (details.text === undefined) throw snapshotInconsistent("Experience Sketch body is unavailable.");
      return mapExperience(row, details.text);
    case "l1_bridge":
      if (details.text === undefined) throw snapshotInconsistent("L1 Bridge body is unavailable.");
      return mapBridge(row, details.text);
    case "boundary_note": {
      if (details.text === undefined) throw snapshotInconsistent("Boundary Note body is unavailable.");
      const relationId = readUuid(details.text, "sense_relation_id", "Boundary Note relation");
      return { ...mapSenseAssetBase(row), kind, body: readString(details.text, "body", "Boundary Note body"), senseRelationId: relationId };
    }
    case "example":
      if (details.example === undefined) throw snapshotInconsistent("Example content is unavailable.");
      return mapExample(row, details.example);
    case "contrast_pair":
    case "counterexample": {
      if (details.contrast === undefined) throw snapshotInconsistent("Contrast Case content is unavailable.");
      return {
        ...mapSenseAssetBase(row),
        kind,
        senseRelationId: readUuid(details.contrast, "sense_relation_id", "Contrast Case relation"),
        positiveTextL2: readString(details.contrast, "positive_text_l2", "Contrast Case positive L2"),
        positiveTextL1: readString(details.contrast, "positive_text_l1", "Contrast Case positive L1"),
        negativeTextL2: readString(details.contrast, "negative_text_l2", "Contrast Case negative L2"),
        negativeTextL1: readString(details.contrast, "negative_text_l1", "Contrast Case negative L1"),
        distinguishingFeature: readString(details.contrast, "distinguishing_feature", "Contrast Case feature"),
      };
    }
    case "visual_grounding": {
      if (details.visual === undefined) throw snapshotInconsistent("Visual Grounding content is unavailable.");
      const base = mapSenseAssetBase(row);
      const sourceLicense = readString(details.visual, "source_license", "Visual Grounding source license");
      const sourceAttribution = readString(details.visual, "source_attribution", "Visual Grounding source attribution");
      if (isPlaceholder(sourceLicense) || isPlaceholder(sourceAttribution)) {
        throw snapshotInconsistent("Visual Grounding source provenance is incomplete.");
      }
      return {
        ...base,
        kind,
        provenance: {
          ...base.provenance,
          sourceLicense,
          sourceAttribution,
        },
        media: mapMedia(details.visual, "image"),
        altText: readString(details.visual, "alt_text", "Visual Grounding alt text"),
        distinguishingFeature: readString(details.visual, "distinguishing_feature", "Visual Grounding feature"),
      };
    }
    case "spatial_diagram": {
      if (details.diagram === undefined) throw snapshotInconsistent("Spatial Diagram content is unavailable.");
      return {
        ...mapSenseAssetBase(row),
        kind,
        figureLabel: readString(details.diagram, "figure_label", "Spatial Diagram figure"),
        groundLabel: readString(details.diagram, "ground_label", "Spatial Diagram ground"),
        pathDescription: readString(details.diagram, "path_description", "Spatial Diagram path"),
        topology: readString(details.diagram, "topology", "Spatial Diagram topology"),
        textFallback: readString(details.diagram, "text_fallback", "Spatial Diagram fallback"),
        startDescription: readNullableString(details.diagram, "start_description", "Spatial Diagram start"),
        endpointDescription: readNullableString(details.diagram, "endpoint_description", "Spatial Diagram endpoint"),
        contrastRelationId: details.diagram["contrast_relation_id"] === null
          ? null
          : readUuid(details.diagram, "contrast_relation_id", "Spatial Diagram contrast relation"),
      };
    }
    case "causal_sequence":
    case "temporal_sequence": {
      if (details.sequence === undefined || details.sequenceSteps.length < 2) {
        throw snapshotInconsistent("Sequence asset must contain at least two steps.");
      }
      const steps = details.sequenceSteps.map((step): SensaPublicSequenceStep => ({
        ordinal: readInteger(step, "ordinal", "Sequence step ordinal", { minimum: 1 }),
        label: readString(step, "label", "Sequence step label"),
        description: readString(step, "description", "Sequence step description"),
      }));
      const ordinals = steps.map((step) => step.ordinal).sort((left, right) => left - right);
      if (ordinals.some((ordinal, index) => ordinal !== index + 1)) {
        throw snapshotInconsistent("Sequence asset step order is not contiguous.");
      }
      return {
        ...mapSenseAssetBase(row),
        kind,
        textFallback: readString(details.sequence, "text_fallback", "Sequence fallback"),
        steps: steps as unknown as SensaPublicSequenceAsset["steps"],
      };
    }
    case "pronunciation_audio":
    case "study_example_audio":
    case "extended_audio": {
      if (details.audio === undefined) throw snapshotInconsistent("Audio asset content is unavailable.");
      const media = mapMedia(details.audio, "audio");
      const sourceExampleAssetId = details.audio["source_example_asset_id"] === null
        ? null
        : readUuid(details.audio, "source_example_asset_id", "Audio source Example");
      const sourceTextDigest = readSha256(details.audio, "source_text_digest", "Audio source text digest");
      const durationMs = readInteger(details.audio, "duration_ms", "Audio duration", { minimum: 1 });
      if (kind === "pronunciation_audio") {
        if (sourceExampleAssetId !== null) throw snapshotInconsistent("Pronunciation audio has an Example source.");
        return {
          ...mapLexemeAssetBase(row),
          kind,
          senseVersionId: null,
          media,
          sourceExampleAssetId: null,
          accentLocale: readNullableString(details.audio, "accent_locale", "Pronunciation accent"),
          provider: readNullableString(details.audio, "provider", "Pronunciation provider"),
          model: readNullableString(details.audio, "model", "Pronunciation model"),
          voice: readNullableString(details.audio, "voice", "Pronunciation voice"),
          sourceTextDigest,
          durationMs,
        };
      }
      return {
        ...mapSenseAssetBase(row),
        kind,
        media,
        sourceExampleAssetId,
        accentLocale: readString(details.audio, "accent_locale", "Study audio accent"),
        provider: readString(details.audio, "provider", "Study audio provider"),
        model: readString(details.audio, "model", "Study audio model"),
        voice: readString(details.audio, "voice", "Study audio voice"),
        sourceTextDigest,
        durationMs,
      } as SensaPublicExampleAudioAsset;
    }
    default:
      throw snapshotInconsistent("Published Learning Asset kind is unsupported.");
  }
}

function assertMappedAssetRelease(
  asset: SensaPublicLearningAsset,
  releaseReference: SensaCatalogBuildReleaseReference,
): void {
  if (asset.contentReleaseId !== releaseReference.contentReleaseId) {
    throw snapshotInconsistent("A published Learning Asset crosses the requested Content Release.");
  }
  if (asset.senseVersionId === null) {
    if (asset.learnerLocale !== null && asset.learnerLocale !== releaseReference.learnerLocale) {
      throw snapshotInconsistent("A Lexeme pronunciation asset has the wrong learner locale.");
    }
  } else if (asset.learnerLocale !== releaseReference.learnerLocale) {
    throw snapshotInconsistent("A Sense Learning Asset has the wrong learner locale.");
  }
}

function mappedAssetRelationId(asset: SensaPublicLearningAsset): string | null {
  if ("senseRelationId" in asset) return asset.senseRelationId;
  if ("contrastRelationId" in asset) return asset.contrastRelationId;
  return null;
}

function mapSenseSnapshot(row: MemberRow): Readonly<{
  lexeme: SensaPublicLexemeSnapshot;
  sense: SensaPublicSenseSnapshot;
}> {
  return {
    lexeme: {
      lexemeVersionId: readUuid(row, "lexeme_version_id", "Lexeme Version identity"),
      lexemeId: readUuid(row, "lexeme_id", "Lexeme identity"),
      languageTag: readString(row, "language_tag", "Lexeme language"),
      lemma: readString(row, "lemma", "Lexeme lemma"),
      forms: readNonEmptyStringArray(row, "forms", "Lexeme forms"),
      ipaUs: readNullableString(row, "ipa_us", "Lexeme US pronunciation"),
      ipaUk: readNullableString(row, "ipa_uk", "Lexeme UK pronunciation"),
      syllables: readNullableString(row, "syllables", "Lexeme syllables"),
    },
    sense: {
      senseVersionId: readUuid(row, "sense_version_id", "Sense Version identity"),
      senseId: readUuid(row, "sense_id", "Sense identity"),
      senseKey: readString(row, "sense_key", "Sense key"),
      senseRank: readInteger(row, "sense_rank", "Sense rank", { minimum: 1 }),
      partOfSpeech: readString(row, "part_of_speech", "Sense part of speech"),
      guideLabelL1: readString(row, "guide_label_l1", "Sense guide label"),
      definitionL2: readString(row, "definition_l2", "Sense definition"),
      teachingPriority: readEnum(row, "teaching_priority", new Set(["core", "extended", "recognition"]), "Sense teaching priority"),
      reviewStatus: "approved",
    },
  };
}

async function buildPackages(
  executor: DatabaseExecutor,
  contentReleaseId: string,
  memberRows: ReadonlyArray<MemberRow>,
  releaseReference: SensaCatalogBuildReleaseReference,
): Promise<ReadonlyArray<SensaCatalogBuildContentItem>> {
  const senseVersionIds = memberRows.map((row) => readUuid(row, "sense_version_id", "page Sense Version"));
  const lexemeVersionIds = memberRows.map((row) => readUuid(row, "lexeme_version_id", "page Lexeme Version"));
  const senseIds = memberRows.map((row) => readUuid(row, "sense_id", "page Sense"));
  const senseIdByVersion = new Map<string, string>();
  const lexemeVersionBySenseVersion = new Map<string, string>();
  const lexemeLemmaByVersion = new Map<string, string>();
  for (const row of memberRows) {
    const senseVersionId = readUuid(row, "sense_version_id", "page Sense Version");
    const senseId = readUuid(row, "sense_id", "page Sense");
    const lexemeVersionId = readUuid(row, "lexeme_version_id", "page Lexeme Version");
    const lemma = readString(row, "lemma", "page Lexeme lemma");
    senseIdByVersion.set(senseVersionId, senseId);
    lexemeVersionBySenseVersion.set(senseVersionId, lexemeVersionId);
    lexemeLemmaByVersion.set(lexemeVersionId, lemma);
  }
  const senseIdParams = [senseVersionIds, contentReleaseId] as SqlValue[];
  const lexemeIdParams = [lexemeVersionIds, contentReleaseId] as SqlValue[];

  const usageRows = (await query<Row>(executor, `
    SELECT usage_pattern_id, content_release_id, sense_version_id, ordinal, canonical_pattern,
           common_collocations, register_label, domain_label, usage_restriction,
           source_evidence_refs, review_status::TEXT AS review_status
      FROM sensa.usage_patterns
     WHERE content_release_id = $2
       AND sense_version_id = ANY($1::UUID[])
       AND review_status = 'approved'
     ORDER BY sense_version_id, ordinal, usage_pattern_id`, senseIdParams)).rows;
  const usageSenseById = new Map<string, string>();
  for (const row of usageRows) {
    usageSenseById.set(
      readUuid(row, "usage_pattern_id", "Usage Pattern identity"),
      readUuid(row, "sense_version_id", "Usage Pattern Sense owner"),
    );
  }
  const usageIds = usageRows.map((row) => readUuid(row, "usage_pattern_id", "Usage Pattern identity"));
  const slotRows = usageIds.length === 0
    ? []
    : (await query<Row>(executor, `
        SELECT usage_pattern_id, ordinal, slot_name, semantic_role, value_description, is_optional
          FROM sensa.usage_pattern_slots
         WHERE content_release_id = $2
           AND usage_pattern_id = ANY($1::UUID[])
         ORDER BY usage_pattern_id, ordinal`, [usageIds, contentReleaseId])).rows;
  const slotsByUsage = new Map<string, Row[]>();
  for (const row of slotRows) {
    const id = readUuid(row, "usage_pattern_id", "Usage Pattern slot owner");
    const existing = slotsByUsage.get(id) ?? [];
    existing.push(row);
    slotsByUsage.set(id, existing);
  }

  const profileRows = (await query<Row>(executor, `
    SELECT acquisition_profile_id, content_release_id, sense_version_id, learner_locale,
           schema_version, acquisition_needs::TEXT[] AS acquisition_needs,
           minimum_sufficient_experience, distinguishing_features,
           preferred_primitives::TEXT[] AS preferred_primitives,
           required_asset_capabilities::TEXT[] AS required_asset_capabilities,
           optional_asset_capabilities::TEXT[] AS optional_asset_capabilities,
           fallback_primitives::TEXT[] AS fallback_primitives,
           domain_bound, domain_constraints, source_digest,
           generator_provider, generator_model, prompt_version,
           review_status::TEXT AS review_status
      FROM sensa.acquisition_profiles
     WHERE content_release_id = $2
       AND sense_version_id = ANY($1::UUID[])
       AND learner_locale = $3
       AND review_status = 'approved'
     ORDER BY sense_version_id, acquisition_profile_id`, [senseVersionIds, contentReleaseId, releaseReference.learnerLocale])).rows;
  const profilesBySense = new Map<string, Row>();
  for (const row of profileRows) {
    const senseId = readUuid(row, "sense_version_id", "Acquisition Profile owner");
    if (profilesBySense.has(senseId)) throw snapshotInconsistent("A Sense has multiple approved Acquisition Profiles.");
    profilesBySense.set(senseId, row);
  }
  const profileIds = profileRows.map((row) => readUuid(row, "acquisition_profile_id", "Acquisition Profile identity"));
  const boundaryRows = profileIds.length === 0
    ? []
    : (await query<Row>(executor, `
        SELECT acquisition_profile_id, sense_relation_id, ordinal, is_required
          FROM sensa.profile_boundary_targets
         WHERE content_release_id = $2
           AND acquisition_profile_id = ANY($1::UUID[])
         ORDER BY acquisition_profile_id, ordinal`, [profileIds, contentReleaseId])).rows;
  const boundariesByProfile = new Map<string, Row[]>();
  for (const row of boundaryRows) {
    const profileId = readUuid(row, "acquisition_profile_id", "Profile boundary owner");
    const existing = boundariesByProfile.get(profileId) ?? [];
    existing.push(row);
    boundariesByProfile.set(profileId, existing);
  }

  const relationRows = (await query<Row>(executor, `
    SELECT relations.content_release_id, relations.sense_relation_id,
           relations.source_sense_id, relations.target_sense_id,
           source_stable.lexeme_id AS source_lexeme_id,
           target_stable.lexeme_id AS target_lexeme_id,
           relations.relation_type, relations.scope::TEXT AS scope,
           relations.distinguishing_feature, relations.source_evidence_refs,
           relations.review_status::TEXT AS review_status
      FROM sensa.sense_relations AS relations
      JOIN sensa.senses AS source_stable ON source_stable.sense_id = relations.source_sense_id
      JOIN sensa.senses AS target_stable ON target_stable.sense_id = relations.target_sense_id
    WHERE relations.content_release_id = $2
       AND relations.review_status = 'approved'
       AND (relations.source_sense_id = ANY($1::UUID[]) OR relations.target_sense_id = ANY($1::UUID[]))
     ORDER BY relations.sense_relation_id`, [senseIds, contentReleaseId])).rows;
  const relationById = new Map<string, SensaPublicSenseRelationSnapshot>();
  const relationIdsBySense = new Map<string, Set<string>>();
  for (const row of relationRows) {
    const relation = mapRelation(row);
    relationById.set(relation.senseRelationId, relation);
    for (const senseId of [relation.sourceSenseId, relation.targetSenseId]) {
      const relationIds = relationIdsBySense.get(senseId) ?? new Set<string>();
      relationIds.add(relation.senseRelationId);
      relationIdsBySense.set(senseId, relationIds);
    }
  }

  const manifestRows = (await query<Row>(executor, `
    SELECT DISTINCT ON (manifests.sense_version_id)
           manifests.required_asset_manifest_id, manifests.content_release_id,
           manifests.sense_version_id, manifests.acquisition_profile_id,
           manifests.validator_version, manifests.capability_resolver_version,
           manifests.status::TEXT AS status,
           manifests.package_digest, manifests.validated_at
      FROM sensa.required_asset_manifests AS manifests
      JOIN sensa.acquisition_profiles AS profiles
        ON profiles.acquisition_profile_id = manifests.acquisition_profile_id
       AND profiles.content_release_id = $2
       AND profiles.review_status = 'approved'
       JOIN sensa.content_releases AS releases
         ON releases.content_release_id = manifests.content_release_id
       AND releases.status = $3
     WHERE manifests.content_release_id = $2
       AND manifests.sense_version_id = ANY($1::UUID[])
       AND profiles.learner_locale = releases.learner_locale
       AND manifests.validator_version = releases.validator_version
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
       ORDER BY manifests.sense_version_id, manifests.validated_at DESC, manifests.required_asset_manifest_id ASC`, [senseVersionIds, contentReleaseId, releaseReference.status])).rows;
  const manifestsBySense = new Map<string, Row>();
  for (const row of manifestRows) {
    const manifestReleaseId = readUuid(row, "content_release_id", "Manifest release");
    const manifestSenseVersionId = readUuid(row, "sense_version_id", "Manifest Sense owner");
    const manifestProfileId = readUuid(row, "acquisition_profile_id", "Manifest Profile owner");
    if (manifestReleaseId !== contentReleaseId) {
      throw snapshotInconsistent("A published manifest crosses Content Releases.");
    }
    if (!senseVersionIds.includes(manifestSenseVersionId)) {
      throw snapshotInconsistent("A published manifest is not owned by a page Sense.");
    }
    const profile = profilesBySense.get(manifestSenseVersionId);
    if (profile === undefined
      || readUuid(profile, "content_release_id", "Acquisition Profile release") !== contentReleaseId
      || readUuid(profile, "sense_version_id", "Acquisition Profile Sense owner") !== manifestSenseVersionId
      || readString(profile, "learner_locale", "Acquisition Profile locale") !== releaseReference.learnerLocale
      || readUuid(profile, "acquisition_profile_id", "Acquisition Profile identity") !== manifestProfileId) {
      throw snapshotInconsistent("A published manifest is not aligned with its Acquisition Profile and Sense.");
    }
    manifestsBySense.set(manifestSenseVersionId, row);
  }
  const manifestIds = manifestRows.map((row) => readUuid(row, "required_asset_manifest_id", "Manifest identity"));
  const requirementRows = manifestIds.length === 0
    ? []
    : (await query<Row>(executor, `
        SELECT manifest_requirement_id, required_asset_manifest_id, requirement_key,
               capability::TEXT AS capability, required_count, satisfied_count,
               status::TEXT AS status
          FROM sensa.manifest_requirements
         WHERE content_release_id = $2
           AND required_asset_manifest_id = ANY($1::UUID[])
         ORDER BY required_asset_manifest_id, requirement_key, manifest_requirement_id`, [manifestIds, contentReleaseId])).rows;
  const requirementIds = requirementRows.map((row) => readUuid(row, "manifest_requirement_id", "Manifest requirement identity"));
  const assetMatches = requirementIds.length === 0
    ? []
    : (await query<Row>(executor, `
        SELECT manifest_requirement_id, learning_asset_id
          FROM sensa.manifest_requirement_asset_matches
         WHERE content_release_id = $2
           AND manifest_requirement_id = ANY($1::UUID[])
         ORDER BY manifest_requirement_id, learning_asset_id`, [requirementIds, contentReleaseId])).rows;
  const usageMatches = requirementIds.length === 0
    ? []
    : (await query<Row>(executor, `
        SELECT manifest_requirement_id, usage_pattern_id
          FROM sensa.manifest_requirement_usage_pattern_matches
         WHERE content_release_id = $2
           AND manifest_requirement_id = ANY($1::UUID[])
         ORDER BY manifest_requirement_id, usage_pattern_id`, [requirementIds, contentReleaseId])).rows;
  const assetsByRequirement = new Map<string, string[]>();
  for (const row of assetMatches) {
    const id = readUuid(row, "manifest_requirement_id", "Manifest requirement");
    const list = assetsByRequirement.get(id) ?? [];
    list.push(readUuid(row, "learning_asset_id", "Manifest asset match"));
    assetsByRequirement.set(id, list);
  }
  const usagesByRequirement = new Map<string, string[]>();
  for (const row of usageMatches) {
    const id = readUuid(row, "manifest_requirement_id", "Manifest requirement");
    const list = usagesByRequirement.get(id) ?? [];
    list.push(readUuid(row, "usage_pattern_id", "Manifest Usage Pattern match"));
    usagesByRequirement.set(id, list);
  }
  const requirementsByManifest = new Map<string, SensaPublicManifestRequirement[]>();
  for (const row of requirementRows) {
    const manifestId = readUuid(row, "required_asset_manifest_id", "Manifest requirement owner");
    const requirementId = readUuid(row, "manifest_requirement_id", "Manifest requirement identity");
    const capability = readEnum<SensaPublicAssetCapability>(row, "capability", assetCapabilitySet, "Manifest capability");
    const matchedResourceIds = [
      ...(assetsByRequirement.get(requirementId) ?? []),
      ...(usagesByRequirement.get(requirementId) ?? []),
    ].sort();
    if (matchedResourceIds.length === 0) throw snapshotInconsistent("A satisfied manifest requirement has no matched resource.");
    const status = readString(row, "status", "Manifest requirement status");
    if (status !== "satisfied") throw snapshotInconsistent("A published manifest requirement is not satisfied.");
    const requirement: SensaPublicManifestRequirement = {
      manifestRequirementId: requirementId,
      requirementKey: readString(row, "requirement_key", "Manifest requirement key"),
      capability,
      requiredCount: readInteger(row, "required_count", "Manifest required count", { minimum: 0 }),
      satisfiedCount: readInteger(row, "satisfied_count", "Manifest satisfied count", { minimum: 0 }),
      matchedResourceIds: matchedResourceIds as unknown as readonly [string, ...string[]],
      status: "satisfied",
    };
    const list = requirementsByManifest.get(manifestId) ?? [];
    list.push(requirement);
    requirementsByManifest.set(manifestId, list);
  }

  const commonAssetRows = (await query<Row>(executor, `
    SELECT learning_asset_id, content_release_id, asset_kind::TEXT AS asset_kind,
           sense_version_id, lexeme_version_id, learner_locale, content_digest,
           source_evidence_refs, generator_provider, generator_model, prompt_version,
           source_license, source_attribution, review_status::TEXT AS review_status
      FROM sensa.learning_assets
     WHERE content_release_id = $2
       AND review_status = 'approved'
       AND (
         sense_version_id = ANY($1::UUID[])
         OR (asset_kind = 'pronunciation_audio' AND lexeme_version_id = ANY($3::UUID[]))
       )
     ORDER BY asset_kind, learning_asset_id`, [senseVersionIds, contentReleaseId, lexemeVersionIds])).rows;
  const assetOwnershipById = new Map<string, Readonly<{
    kind: string;
    senseVersionId: string | null;
    lexemeVersionId: string | null;
  }>>();
  for (const row of commonAssetRows) {
    assetOwnershipById.set(readUuid(row, "learning_asset_id", "Learning Asset identity"), {
      kind: readString(row, "asset_kind", "Learning Asset kind"),
      senseVersionId: readNullableUuid(row, "sense_version_id", "Learning Asset Sense owner"),
      lexemeVersionId: readNullableUuid(row, "lexeme_version_id", "Learning Asset Lexeme owner"),
    });
  }
  const manifestSenseById = new Map<string, string>();
  for (const row of manifestsBySense.values()) {
    manifestSenseById.set(
      readUuid(row, "required_asset_manifest_id", "Manifest identity"),
      readUuid(row, "sense_version_id", "Manifest Sense owner"),
    );
  }
  for (const [manifestId, requirements] of requirementsByManifest) {
    const manifestSenseVersionId = manifestSenseById.get(manifestId);
    if (manifestSenseVersionId === undefined) {
      throw snapshotInconsistent("A published manifest requirement has no package owner.");
    }
    const expectedLexemeVersionId = lexemeVersionBySenseVersion.get(manifestSenseVersionId);
    if (expectedLexemeVersionId === undefined) {
      throw snapshotInconsistent("A published manifest package owner is not in the requested page.");
    }
    for (const requirement of requirements) {
      const matchedUsageIds = usagesByRequirement.get(requirement.manifestRequirementId) ?? [];
      for (const usageId of matchedUsageIds) {
        if (usageSenseById.get(usageId) !== manifestSenseVersionId) {
          throw snapshotInconsistent("A manifest requirement references a Usage Pattern owned by another Sense.");
        }
      }
      const matchedAssetIds = assetsByRequirement.get(requirement.manifestRequirementId) ?? [];
      for (const assetId of matchedAssetIds) {
        const ownership = assetOwnershipById.get(assetId);
        if (ownership === undefined) {
          throw snapshotInconsistent("A manifest requirement references an unavailable Learning Asset.");
        }
        if (ownership.kind === "pronunciation_audio") {
          if (ownership.lexemeVersionId !== expectedLexemeVersionId || ownership.senseVersionId !== null) {
            throw snapshotInconsistent("A manifest requirement references pronunciation for another Lexeme.");
          }
        } else if (ownership.senseVersionId !== manifestSenseVersionId || ownership.lexemeVersionId !== null) {
          throw snapshotInconsistent("A manifest requirement references an asset owned by another Sense.");
        }
      }
    }
  }
  const assetIds = commonAssetRows.map((row) => readUuid(row, "learning_asset_id", "Learning Asset identity"));
  const detailsParams = [assetIds, contentReleaseId] as SqlValue[];
  const textRows = assetIds.length === 0 ? [] : (await query<Row>(executor, `
    SELECT learning_asset_id, body, sense_relation_id
      FROM sensa.text_assets
     WHERE content_release_id = $2 AND learning_asset_id = ANY($1::UUID[])`, detailsParams)).rows;
  const exampleRows = assetIds.length === 0 ? [] : (await query<Row>(executor, `
    SELECT learning_asset_id, sense_version_id, ordinal, text_l2, text_l1, target_form,
           target_start, target_end, disambiguating_cue, variation_note,
           construction::TEXT AS construction, scene_domain::TEXT AS scene_domain,
           collocations, role::TEXT AS role, context_l2, context_l1
      FROM sensa.example_assets
     WHERE content_release_id = $2 AND learning_asset_id = ANY($1::UUID[])`, detailsParams)).rows;
  const contrastRows = assetIds.length === 0 ? [] : (await query<Row>(executor, `
    SELECT learning_asset_id, sense_relation_id, positive_text_l2, positive_text_l1,
           negative_text_l2, negative_text_l1, distinguishing_feature
      FROM sensa.contrast_case_assets
     WHERE content_release_id = $2 AND learning_asset_id = ANY($1::UUID[])`, detailsParams)).rows;
  const visualRows = assetIds.length === 0 ? [] : (await query<Row>(executor, `
    SELECT assets.learning_asset_id, assets.media_blob_id, blobs.sha256 AS media_sha256,
           blobs.mime_type AS media_mime_type, blobs.size_bytes::TEXT AS media_size_bytes,
           assets.alt_text, assets.distinguishing_feature,
           assets.source_license, assets.source_attribution
      FROM sensa.visual_assets AS assets
      JOIN content.media_blobs AS blobs ON blobs.media_blob_id = assets.media_blob_id
     WHERE assets.content_release_id = $2 AND assets.learning_asset_id = ANY($1::UUID[])`, detailsParams)).rows;
  const diagramRows = assetIds.length === 0 ? [] : (await query<Row>(executor, `
    SELECT learning_asset_id, figure_label, ground_label, path_description, topology,
           text_fallback, start_description, endpoint_description, contrast_relation_id
      FROM sensa.diagram_assets
     WHERE content_release_id = $2 AND learning_asset_id = ANY($1::UUID[])`, detailsParams)).rows;
  const sequenceRows = assetIds.length === 0 ? [] : (await query<Row>(executor, `
    SELECT learning_asset_id, text_fallback
      FROM sensa.sequence_assets
     WHERE content_release_id = $2 AND learning_asset_id = ANY($1::UUID[])`, detailsParams)).rows;
  const sequenceSteps = assetIds.length === 0 ? [] : (await query<Row>(executor, `
    SELECT learning_asset_id, ordinal, label, description
      FROM sensa.sequence_asset_steps
     WHERE content_release_id = $2 AND learning_asset_id = ANY($1::UUID[])
     ORDER BY learning_asset_id, ordinal`, detailsParams)).rows;
  const audioRows = assetIds.length === 0 ? [] : (await query<Row>(executor, `
    SELECT assets.learning_asset_id, assets.media_blob_id, blobs.sha256 AS media_sha256,
           blobs.mime_type AS media_mime_type, blobs.size_bytes::TEXT AS media_size_bytes,
           assets.source_example_asset_id, assets.accent_locale, assets.provider,
           assets.model, assets.voice, assets.source_text_digest, assets.duration_ms
      FROM sensa.audio_assets AS assets
      JOIN content.media_blobs AS blobs ON blobs.media_blob_id = assets.media_blob_id
     WHERE assets.content_release_id = $2 AND assets.learning_asset_id = ANY($1::UUID[])`, detailsParams)).rows;
  const byId = <T extends Row>(rows: ReadonlyArray<T>): Map<string, T> => new Map(rows.map((row) => [readUuid(row, "learning_asset_id", "Learning Asset detail owner"), row]));
  const textById = byId(textRows);
  const exampleById = byId(exampleRows);
  const contrastById = byId(contrastRows);
  const visualById = byId(visualRows);
  const diagramById = byId(diagramRows);
  const sequenceById = byId(sequenceRows);
  const audioById = byId(audioRows);
  const exampleDetailById = byId(exampleRows);
  const assertAudioSemantics = (asset: SensaPublicLearningAsset): void => {
    if (asset.kind !== "pronunciation_audio" && asset.kind !== "study_example_audio") return;
    const sourceTuple = [asset.provenance.sourceLicense, asset.provenance.sourceAttribution];
    const completeSource = hasCompleteTuple(sourceTuple);
    if (hasAnyTupleValue(sourceTuple) && !completeSource) {
      throw snapshotInconsistent("Audio source provenance is incomplete.");
    }
    if (asset.kind === "pronunciation_audio") {
      const lemma = lexemeLemmaByVersion.get(asset.lexemeVersionId);
      if (lemma === undefined || asset.sourceTextDigest !== sha256(lemma)) {
        throw snapshotInconsistent("Pronunciation audio source text does not match its Lexeme lemma.");
      }
      const ttsTuple = [asset.provider, asset.model, asset.voice, asset.accentLocale];
      const completeTts = hasCompleteTuple(ttsTuple);
      if (!completeTts && (hasAnyTupleValue(ttsTuple) || !completeSource)) {
        throw snapshotInconsistent("Pronunciation audio has incomplete TTS or source provenance.");
      }
      return;
    }
    if (!hasCompleteTuple([asset.provider, asset.model, asset.voice, asset.accentLocale])) {
      throw snapshotInconsistent("Study Example Audio has incomplete TTS provenance.");
    }
    if (asset.sourceExampleAssetId === null) {
      throw snapshotInconsistent("Study Example Audio is missing its source Example.");
    }
    const sourceExample = exampleDetailById.get(asset.sourceExampleAssetId);
    if (sourceExample === undefined
      || readString(sourceExample, "role", "Study Example role") !== "study"
      || readUuid(sourceExample, "sense_version_id", "Study Example Sense owner") !== asset.senseVersionId) {
      throw snapshotInconsistent("Study Example Audio references an Example owned by another Sense.");
    }
    if (asset.sourceTextDigest !== sha256(readString(sourceExample, "text_l2", "Study Example L2 text"))) {
      throw snapshotInconsistent("Study Example Audio source text digest does not match its Example.");
    }
  };
  const approvedAssetIds = new Set(commonAssetRows.map((row) => readUuid(row, "learning_asset_id", "Learning Asset identity")));
  const approvedUsageIds = new Set(usageRows.map((row) => readUuid(row, "usage_pattern_id", "Usage Pattern identity")));
  for (const row of requirementRows) {
    const requirementId = readUuid(row, "manifest_requirement_id", "Manifest requirement identity");
    const matchedAssetIds = assetsByRequirement.get(requirementId) ?? [];
    const matchedUsageIds = usagesByRequirement.get(requirementId) ?? [];
    const requiredCount = readInteger(row, "required_count", "Manifest required count", { minimum: 0 });
    const satisfiedCount = readInteger(row, "satisfied_count", "Manifest satisfied count", { minimum: 0 });
    if (satisfiedCount < requiredCount || satisfiedCount !== matchedAssetIds.length + matchedUsageIds.length) {
      throw snapshotInconsistent("A published manifest requirement count does not match its approved matches.");
    }
    if (matchedAssetIds.some((assetId) => !approvedAssetIds.has(assetId))) {
      throw snapshotInconsistent("A published manifest references an unavailable or non-approved Learning Asset.");
    }
    if (matchedUsageIds.some((usageId) => !approvedUsageIds.has(usageId))) {
      throw snapshotInconsistent("A published manifest references an unavailable or non-approved Usage Pattern.");
    }
  }
  const stepsByAsset = new Map<string, Row[]>();
  for (const row of sequenceSteps) {
    const id = readUuid(row, "learning_asset_id", "Sequence step owner");
    const steps = stepsByAsset.get(id) ?? [];
    steps.push(row);
    stepsByAsset.set(id, steps);
  }
  const assetsBySense = new Map<string, SensaPublicLearningAsset[]>();
  for (const row of commonAssetRows) {
    const kind = readString(row, "asset_kind", "Learning Asset kind");
    const details = {
      text: textById.get(readUuid(row, "learning_asset_id", "Learning Asset identity")),
      example: exampleById.get(readUuid(row, "learning_asset_id", "Learning Asset identity")),
      contrast: contrastById.get(readUuid(row, "learning_asset_id", "Learning Asset identity")),
      visual: visualById.get(readUuid(row, "learning_asset_id", "Learning Asset identity")),
      diagram: diagramById.get(readUuid(row, "learning_asset_id", "Learning Asset identity")),
      sequence: sequenceById.get(readUuid(row, "learning_asset_id", "Learning Asset identity")),
      sequenceSteps: stepsByAsset.get(readUuid(row, "learning_asset_id", "Learning Asset identity")) ?? [],
      audio: audioById.get(readUuid(row, "learning_asset_id", "Learning Asset identity")),
    };
    const asset = mapAsset(row, details);
    assertMappedAssetRelease(asset, releaseReference);
    assertAudioSemantics(asset);
    const assetRelationId = mappedAssetRelationId(asset);
    if (assetRelationId !== null) {
      const assetSenseVersionId = "senseVersionId" in asset ? asset.senseVersionId : null;
      const assetSenseId = assetSenseVersionId === null ? null : senseIdByVersion.get(assetSenseVersionId);
      if (assetSenseId === null || assetSenseId === undefined || !relationIdsBySense.get(assetSenseId)?.has(assetRelationId) || !relationById.has(assetRelationId)) {
        throw snapshotInconsistent("A published Learning Asset references a Relation outside its Sense.");
      }
    }
    const ownerSense = "senseVersionId" in asset ? asset.senseVersionId : null;
    if (ownerSense !== null) {
      const list = assetsBySense.get(ownerSense) ?? [];
      list.push(asset);
      assetsBySense.set(ownerSense, list);
    }
    if (asset.kind === "pronunciation_audio") {
      const lexemeVersionId = asset.lexemeVersionId;
      const ownerSenseVersionIds = memberRows
        .filter((member) => readUuid(member, "lexeme_version_id", "page Lexeme Version") === lexemeVersionId)
        .map((member) => readUuid(member, "sense_version_id", "page Sense Version"));
      if (ownerSenseVersionIds.length === 0) throw snapshotInconsistent("Pronunciation audio is not owned by a page Lexeme.");
      for (const ownerSenseVersionId of ownerSenseVersionIds) {
        const list = assetsBySense.get(ownerSenseVersionId) ?? [];
        if (!list.some((candidate) => candidate.learningAssetId === asset.learningAssetId)) {
          list.push(asset);
        }
        assetsBySense.set(ownerSenseVersionId, list);
      }
    }
  }

  const items: SensaCatalogBuildContentItem[] = [];
  for (const memberRow of memberRows) {
    const senseVersionId = readUuid(memberRow, "sense_version_id", "page Sense Version");
    const profileRow = profilesBySense.get(senseVersionId);
    const manifestRow = manifestsBySense.get(senseVersionId);
    const usages = usageRows
      .filter((row) => readUuid(row, "sense_version_id", "Usage Pattern owner") === senseVersionId)
      .map((row) => mapUsagePattern(row, slotsByUsage.get(readUuid(row, "usage_pattern_id", "Usage Pattern identity")) ?? []));
    if (profileRow === undefined || manifestRow === undefined || usages.length === 0) {
      throw snapshotInconsistent("A published Book member is missing its complete package.");
    }
    if (
      readUuid(profileRow, "content_release_id", "Acquisition Profile release") !== contentReleaseId
      || readUuid(profileRow, "sense_version_id", "Acquisition Profile Sense owner") !== senseVersionId
      || readString(profileRow, "learner_locale", "Acquisition Profile locale") !== releaseReference.learnerLocale
      || readUuid(manifestRow, "content_release_id", "Manifest release") !== contentReleaseId
      || readUuid(manifestRow, "sense_version_id", "Manifest Sense owner") !== senseVersionId
      || readUuid(manifestRow, "acquisition_profile_id", "Manifest Profile owner") !== readUuid(profileRow, "acquisition_profile_id", "Acquisition Profile identity")
    ) {
      throw snapshotInconsistent("A published package Profile and Manifest are not aligned with the page Sense.");
    }
    const profileId = readUuid(profileRow, "acquisition_profile_id", "Acquisition Profile identity");
    const manifestId = readUuid(manifestRow, "required_asset_manifest_id", "Manifest identity");
    const requirements = requirementsByManifest.get(manifestId) ?? [];
    if (requirements.length === 0) throw snapshotInconsistent("A published package has no manifest requirements.");
    const boundaryTargets = boundariesByProfile.get(profileId) ?? [];
    const memberSenseId = readUuid(memberRow, "sense_id", "page Sense");
    const allowedRelationIds = relationIdsBySense.get(memberSenseId) ?? new Set<string>();
    for (const target of boundaryTargets) {
      const relationId = readUuid(target, "sense_relation_id", "Profile boundary relation");
      if (!allowedRelationIds.has(relationId) || !relationById.has(relationId)) {
        throw snapshotInconsistent("A published Acquisition Profile references a Relation outside the current Sense.");
      }
    }
    const relations = relationRows
      .filter((row) => allowedRelationIds.has(readUuid(row, "sense_relation_id", "Sense Relation identity")))
      .map((row) => relationById.get(readUuid(row, "sense_relation_id", "Sense Relation identity")))
      .filter((relation): relation is SensaPublicSenseRelationSnapshot => relation !== undefined);
    const memberAssets = assetsBySense.get(senseVersionId) ?? [];
    const experienceCount = memberAssets.filter((asset) => asset.kind === "experience_sketch").length;
    const bridgeCount = memberAssets.filter((asset) => asset.kind === "l1_bridge").length;
    const examples = memberAssets.filter((asset): asset is Extract<SensaPublicLearningAsset, { kind: "example" }> => asset.kind === "example");
    const pronunciationCount = memberAssets.filter((asset) => asset.kind === "pronunciation_audio").length;
    const studyAudioCount = memberAssets.filter((asset) => asset.kind === "study_example_audio").length;
    if (
      experienceCount !== 1
      || bridgeCount !== 1
      || examples.length < 6
      || examples.filter((asset) => asset.role === "study").length !== 3
      || examples.filter((asset) => asset.role === "quiz").length < 3
      || pronunciationCount < 1
      || studyAudioCount !== 3
    ) {
      throw snapshotInconsistent("A published Book member does not contain the complete baseline Learning Package.");
    }
    const baselineRequirementShapes: ReadonlyArray<Readonly<{
      key: string;
      requiredCount: number;
      resourceKinds: ReadonlyArray<SensaPublicLearningAsset["kind"]> | "usage";
    }>> = [
      { key: "baseline.experience-sketch", requiredCount: 1, resourceKinds: ["experience_sketch"] },
      { key: "baseline.l1-bridge", requiredCount: 1, resourceKinds: ["l1_bridge"] },
      { key: "baseline.examples", requiredCount: 6, resourceKinds: ["example"] },
      { key: "baseline.pronunciation-audio", requiredCount: 1, resourceKinds: ["pronunciation_audio"] },
      { key: "baseline.study-example-audio", requiredCount: 3, resourceKinds: ["study_example_audio"] },
    ];
    for (const shape of baselineRequirementShapes) {
      const requirement = requirements.find((candidate) => candidate.requirementKey === shape.key);
      const requiredCountIsCompatible = requirement !== undefined
        && (shape.key === "baseline.examples"
          ? requirement.requiredCount === 6 || requirement.requiredCount === 10
          : requirement.requiredCount === shape.requiredCount);
      if (!requiredCountIsCompatible || requirement === undefined) {
        throw snapshotInconsistent("A published package is missing a frozen baseline manifest requirement.");
      }
      const matchedIds = new Set(requirement.matchedResourceIds);
      if (shape.resourceKinds === "usage") {
        const matchingUsages = usages.filter((usage) => matchedIds.has(usage.usagePatternId));
        if (matchingUsages.length !== matchedIds.size || matchingUsages.length < shape.requiredCount) {
          throw snapshotInconsistent("A published package has an invalid Usage Pattern baseline match.");
        }
      } else {
        const matchingAssets = memberAssets.filter((asset) => matchedIds.has(asset.learningAssetId));
        const exactBaselineCount = shape.key !== "baseline.pronunciation-audio" && shape.key !== "baseline.examples";
        if (matchingAssets.length !== requirement.matchedResourceIds.length
          || (shape.key === "baseline.examples"
            ? matchingAssets.length < requirement.requiredCount
            : exactBaselineCount && requirement.matchedResourceIds.length !== shape.requiredCount)
          || matchingAssets.some((asset) => !shape.resourceKinds.includes(asset.kind))) {
          throw snapshotInconsistent("A published package has an invalid Learning Asset baseline match.");
        }
      }
    }
    const snapshot = mapSenseSnapshot(memberRow);
    const packageSnapshot: SensaCatalogBuildPackage = {
      packageDigest: readSha256(manifestRow, "package_digest", "Package digest"),
      contentRelease: releaseReference,
      lexeme: snapshot.lexeme,
      sense: snapshot.sense,
      relations,
      usagePatterns: usages,
      acquisitionProfile: mapProfile(profileRow, boundaryTargets),
      learningAssets: memberAssets as unknown as readonly [SensaPublicLearningAsset, ...SensaPublicLearningAsset[]],
      requiredAssetManifest: {
        requiredAssetManifestId: manifestId,
        contentReleaseId: readUuid(manifestRow, "content_release_id", "Manifest release"),
        senseVersionId,
        acquisitionProfileId: profileId,
        validatorVersion: readString(manifestRow, "validator_version", "Manifest validator version"),
        capabilityResolverVersion: readString(manifestRow, "capability_resolver_version", "Manifest Capability Resolver version"),
        status: "satisfied",
        packageDigest: readSha256(manifestRow, "package_digest", "Manifest package digest"),
        validatedAt: readDate(manifestRow, "validated_at", "Manifest validation timestamp"),
        requirements: requirements as unknown as readonly [SensaPublicManifestRequirement, ...SensaPublicManifestRequirement[]],
      } satisfies SensaPublicRequiredAssetManifest,
    };
    items.push({
      ordinal: readInteger(memberRow, "ordinal", "page member ordinal", { minimum: 1 }),
      package: packageSnapshot,
    });
  }
  return items;
}

/**
 * Assemble complete immutable package snapshots for a caller that has already
 * authorized the Book/Release tuple.  Authorization and pagination stay in
 * the owning Catalog or pinned-content module; this helper only reuses the
 * strict package validator/mapper and keeps one serialization path for both.
 */
export async function buildSensaCatalogPackages(
  executor: DatabaseExecutor,
  contentReleaseId: string,
  memberRows: ReadonlyArray<MemberRow>,
  releaseReference: SensaCatalogBuildReleaseReference,
): Promise<ReadonlyArray<SensaCatalogBuildContentItem>> {
  return buildPackages(executor, contentReleaseId, memberRows, releaseReference);
}

export type SensaCatalogModuleOptions = Readonly<{
  executor?: DatabaseExecutor;
}>;

export function createPostgresSensaCatalogModule(
  options: SensaCatalogModuleOptions = {},
): SensaCatalogModule {
  const readOnly = <Result>(callback: (executor: DatabaseExecutor) => Promise<Result>): Promise<Result> =>
    options.executor === undefined
      ? unsafeRepeatableReadReadOnlyTransaction(callback)
      : callback(options.executor);

  return {
    async listPublicBooks(input): Promise<ReturnType<SensaCatalogModule["listPublicBooks"]> extends Promise<infer Result> ? Result : never> {
      assertPublicPageSize(input.pageSize, 100);
      const listCursor = requireListCursor(input.cursor, input);
      const rows = await readOnly((executor) => loadPublicBookRows(executor, {
        targetLanguage: input.targetLanguage,
        learnerLocale: input.learnerLocale,
        cursor: listCursor,
        pageSize: input.pageSize,
      }));
      const hasMore = rows.length > input.pageSize;
      const pageRows = hasMore ? rows.slice(0, input.pageSize) : rows;
      const books = pageRows.map(mapBookSummary);
      const last = books.at(-1);
      return {
        books,
        nextCursor: hasMore && last !== undefined
          ? encodeCursor({
            v: 1,
            endpoint: "books",
            targetLanguage: input.targetLanguage ?? null,
            learnerLocale: input.learnerLocale ?? null,
            bookKey: last.bookKey,
            versionNumber: last.versionNumber,
            bookVersionId: last.bookVersionId,
          })
          : null,
        hasMore,
      };
    },

    async getPublicBookManifest(input): Promise<SensaPublicBookManifest> {
      const bookVersionId = assertUuidInput(input.bookVersionId, "bookVersionId");
      return readOnly(async (executor) => {
        const loaded = await loadPublicBook(executor, bookVersionId);
        const members = await loadManifestMembers(executor, bookVersionId, loaded.summary.contentRelease.contentReleaseId);
        if (members.length !== loaded.summary.senseCount) throw snapshotInconsistent("Book member count changed during manifest assembly.");
        await verifyBookManifestDigest(executor, bookVersionId, loaded.summary.contentRelease.contentReleaseId, loaded.summary.manifestDigest);
        if (members.some((row) => row["package_digest"] === null || row["package_digest"] === undefined)) {
          throw snapshotInconsistent("A published Book member is missing its satisfied package digest.");
        }
        return {
          book: loaded.summary,
          contentRelease: loaded.summary.contentRelease,
          members: members.map(mapManifestMember),
          manifestDigest: loaded.summary.manifestDigest,
        };
      });
    },

    async getPublicContentReleasePage(input): Promise<SensaPublicContentReleasePage> {
      assertPublicPageSize(input.pageSize, 25);
      const bookVersionId = assertUuidInput(input.bookVersionId, "bookVersionId");
      const contentReleaseId = assertUuidInput(input.contentReleaseId, "contentReleaseId");
      const normalizedInput = { ...input, bookVersionId, contentReleaseId };
      const contentCursor = requireContentCursor(normalizedInput.cursor, normalizedInput);
      return readOnly(async (executor) => {
        const loaded = await loadPublicBook(executor, bookVersionId);
        if (loaded.summary.contentRelease.contentReleaseId !== contentReleaseId) {
          throw notFound("SENSA_CATALOG_RELEASE_NOT_FOUND");
        }
        await verifyBookManifestDigest(executor, bookVersionId, contentReleaseId, loaded.summary.manifestDigest);
        const params: SqlValue[] = [bookVersionId, contentReleaseId];
        const cursorClause = contentCursor === null
          ? ""
          : (() => {
            params.push(contentCursor.ordinal);
            return ` AND members.ordinal > $${params.length}`;
          })();
        params.push(input.pageSize + 1);
        const rows = (await query<Row>(executor, `
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
                 senses.teaching_priority::TEXT AS teaching_priority
            FROM sensa.book_version_senses AS members
            JOIN sensa.sense_versions AS senses ON senses.sense_version_id = members.sense_version_id
             AND senses.content_release_id = $2
             AND senses.review_status = 'approved'
            JOIN sensa.senses AS stable_senses ON stable_senses.sense_id = senses.sense_id
            JOIN sensa.lexemes AS lexemes ON lexemes.lexeme_id = stable_senses.lexeme_id
            JOIN sensa.lexeme_versions AS lexeme_versions
              ON lexeme_versions.content_release_id = $2
             AND lexeme_versions.lexeme_id = stable_senses.lexeme_id
           WHERE members.book_version_id = $1${cursorClause}
           ORDER BY members.ordinal ASC
           LIMIT $${params.length}`,
          params,
        )).rows;
        const hasMore = rows.length > input.pageSize;
        const pageRows = hasMore ? rows.slice(0, input.pageSize) : rows;
        if (pageRows.some((row) => row["sense_version_id"] === undefined)) throw snapshotInconsistent("A published Book member cannot be assembled.");
        const items = await buildPackages(executor, contentReleaseId, pageRows, loaded.summary.contentRelease) as ReadonlyArray<SensaPublicContentReleaseItem>;
        const last = items.at(-1);
        return {
          book: loaded.summary,
          contentRelease: loaded.summary.contentRelease,
          items,
          nextCursor: hasMore && last !== undefined
            ? encodeCursor({
              v: 1,
              endpoint: "content-release-items",
              bookVersionId,
              contentReleaseId,
              ordinal: last.ordinal,
            })
            : null,
          hasMore,
        };
      });
    },
  };
}

export const postgresSensaCatalogModule = createPostgresSensaCatalogModule();
