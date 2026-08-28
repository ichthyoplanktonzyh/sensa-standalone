#!/usr/bin/env tsx

/**
 * Local-only operator import for the first real Sensa learner.
 *
 * This command intentionally reads the immutable release directly from an
 * explicitly supplied source root. It never copies the release into this
 * worktree, and it refuses non-loopback databases unless the caller opts in
 * explicitly for this local operation.
 */

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import {
  sensaPackageValidatorVersion,
  validateSenseLearningPackage,
} from "@sensa/content-validator";
import { sensaExecutableLearningCapabilityResolverVersion } from "@sensa/learning-kernel";
import type {
  LearningAssetCandidate,
  PackageValidationStatus,
  SenseLearningPackageCandidate,
} from "@sensa/content-validator";

const { Pool } = pg;

// These counts are pinned to the currently supplied v2 release report. They
// are checked so an operator cannot accidentally import a different or
// partially generated content snapshot under the same run key.
const expectedAcceptedPackageCount = 438;
const expectedAcceptedLexemeCount = 249;
const defaultDatabaseUrl = "postgresql://localhost:5432/sensa_standalone_dev";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const safeRunKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const allowedAudioMimeTypes = new Set(["audio/mpeg", "audio/mp3"]);
const allowedAssetKinds = new Set([
  "experience_sketch",
  "l1_bridge",
  "example",
  "contrast_pair",
  "pronunciation_audio",
  "study_example_audio",
]);

type JsonObject = Record<string, unknown>;
type DatabaseClient = pg.PoolClient;

type ImportOptions = Readonly<{
  sourceRoot: string;
  databaseUrl: string;
  runKey: string;
  workspaceId: string;
  learnerUserId: string;
  dailyNewTarget: number;
  replicaId: string | null;
  allowInsecureLocalDb: boolean;
  replaceActivePlan: boolean;
  dryRun: boolean;
}>;

type ReleaseTuple = Readonly<{
  contentReleaseId: string;
  targetLanguage: string;
  learnerLocale: string;
  schemaVersion: string;
  status: string;
  validatorVersion: string;
}>;

type ReportPackage = Readonly<{
  senseId: string;
  package: string;
  validator: Readonly<{
    status: string;
    validatorVersion: string;
    capabilityResolverVersion: string;
    packageDigest: string;
    requirements: readonly JsonObject[];
  }>;
  validatorStatus: string;
  effectiveStatus: string;
  review: Readonly<{
    inputDigest: string;
    deterministicStatus: string;
    semanticApproved: boolean;
  }>;
}>;

type ValidationSidecar = Readonly<{
  status: string;
  validatorVersion: string;
  capabilityResolverVersion: string;
  packageDigest: string;
  requirements: readonly JsonObject[];
  issues: readonly JsonObject[];
  automatedReview?: JsonObject;
  checkedAt?: string;
}>;

type LoadedPackage = Readonly<{
  packageId: string;
  report: ReportPackage;
  candidate: SenseLearningPackageCandidate;
  validation: ValidationSidecar;
  profile: JsonObject;
  manifest: JsonObject;
  deterministicReview: JsonObject;
  semanticReview: JsonObject;
}>;

type RejectedPackage = Readonly<{
  senseId: string;
  status: PackageValidationStatus;
  issues: readonly Readonly<{ code: string; path: string }>[];
  packageDigest: string;
}>;

type SourceAudioAsset = LearningAssetCandidate & Readonly<{
  kind: "pronunciation_audio" | "study_example_audio";
  mediaBlobId: string;
  mediaSha256: string;
  mimeType: string;
  sizeBytes: number;
  sourceExampleAssetId?: string | null;
  accentLocale?: string | null;
  provider?: string | null;
  model?: string | null;
  voice?: string | null;
  sourceTextDigest: string;
  durationMs: number;
}>;

type SourceProfile = SenseLearningPackageCandidate["profile"] & Readonly<{
  generatorProvider?: string | null;
  generatorModel?: string | null;
  promptVersion?: string | null;
  sourceDigest: string;
}>;

type SourceUsagePattern = SenseLearningPackageCandidate["usagePatterns"][number] & Readonly<{
  slots: readonly Readonly<{
    slotName: string;
    semanticRole: string;
    valueDescription: string;
    isOptional: boolean;
  }>[];
}>;

type MediaReference = Readonly<{
  mediaSha256: string;
  mediaBlobId: string;
  mimeType: string;
  sizeBytes: number;
  sourceAssetIds: readonly string[];
}>;

type RelationRecord = Readonly<{
  contentReleaseId: string;
  senseRelationId: string;
  sourceSenseId: string;
  targetSenseId: string;
  sourceLexemeId: string;
  targetLexemeId: string;
  relationType: string;
  scope: string;
  distinguishingFeature: string;
  sourceEvidenceRefs: readonly string[];
  reviewStatus: string;
}>;

type SourceIdentityIndex = Readonly<{
  lexemes: ReadonlyMap<string, JsonObject>;
  senses: ReadonlyMap<string, Readonly<{ lexemeId: string }>>;
  relations: ReadonlyMap<string, RelationRecord>;
  selectedLexemeIds: ReadonlySet<string>;
  selectedSenseIds: ReadonlySet<string>;
}>;

type ImportIds = Readonly<{
  releaseId: string;
  releaseKey: string;
  bookId: string;
  bookKey: string;
  bookVersionId: string;
  planId: string;
  mapSourceId: (kind: string, sourceId: string) => string;
  mapIdentityId: (kind: string, sourceId: string) => string;
}>;

type Preflight = Readonly<{
  options: ImportOptions;
  reportDigest: string;
  reportCheckedAt: string;
  release: ReleaseTuple;
  packages: readonly LoadedPackage[];
  media: ReadonlyMap<string, MediaReference>;
  sourceIdentities: SourceIdentityIndex;
  ids: ImportIds;
  packageCounts: Readonly<Record<string, number>>;
  reportCandidateCount: number;
  reportCandidateLexemeCount: number;
  reportCandidateMediaCount: number;
  rejectedPackages: readonly RejectedPackage[];
}>;

type PlanInspection = Readonly<{
  activePlanId: string | null;
  desiredPlanExists: boolean;
  replaceEmptyActivePlan: boolean;
  replicaId: string;
  replacePlanCleanup: Readonly<{
    sessionCount: number;
    encounterCount: number;
    actionCount: number;
  }> | null;
}>;

type ReplacementResult = Readonly<{
  archivedOldPlanId: string | null;
  deletedSessionCount: number;
  deletedEncounterCount: number;
  deletedActionCount: number;
  deletedAttemptCount: number;
  deletedEvidenceCount: number;
  deletedOutcomeCount: number;
  deletedMutableFeedCount: number;
  deletedFactFeedCount: number;
  deletedOperationCount: number;
  rebootstrapReplicaCount: number;
}>;

type ImportExecutionResult = Readonly<{
  planInspection: PlanInspection;
  replacedOldPlan: boolean;
  replacement: ReplacementResult;
}>;

function fail(message: string): never {
  throw new Error(message);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("JSON number is not finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isJsonObject(value)) fail("JSON value is not canonicalizable");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value: string): string {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

function stableUuid(namespace: string, value: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(`${namespace}:${value}`, "utf8").digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseArgs(argv: readonly string[]): ImportOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const knownOptions = new Set([
    "--source-root",
    "--database-url",
    "--run-key",
    "--workspace-id",
    "--learner-user-id",
    "--daily-new-target",
    "--replica-id",
  ]);
  const knownFlags = new Set([
    "--allow-insecure-local-db",
    "--replace-active-plan",
    "--dry-run",
    "--help",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (knownFlags.has(arg)) {
      flags.add(arg);
      continue;
    }
    if (!knownOptions.has(arg)) fail(`Unknown option: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`${arg} requires a value`);
    }
    values.set(arg, value);
    index += 1;
  }
  if (flags.has("--help")) {
    console.log(`Usage: npm run sensa:first-user-import -- \\
  --source-root /absolute/path/to/validated-release \\
  --run-key first-user-v2 \\
  --workspace-id WORKSPACE_UUID \\
  --learner-user-id USER_ID \\
  [--database-url postgresql://...@localhost:5432/sensa_standalone_dev] \\
  [--replica-id REPLICA_UUID] [--daily-new-target 10] \\
  [--allow-insecure-local-db] [--replace-active-plan] [--dry-run]`);
    process.exit(0);
  }

  const sourceRootArg = values.get("--source-root");
  if (sourceRootArg === undefined) fail("--source-root is required; the release is never copied into this worktree");
  const runKey = values.get("--run-key");
  if (runKey === undefined || !safeRunKeyPattern.test(runKey)) {
    fail("--run-key must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}");
  }
  const workspaceId = values.get("--workspace-id");
  if (workspaceId === undefined || !uuidPattern.test(workspaceId)) {
    fail("--workspace-id must be a UUID");
  }
  const learnerUserId = values.get("--learner-user-id");
  if (learnerUserId === undefined || learnerUserId.trim() === "" || learnerUserId.length > 256) {
    fail("--learner-user-id must be a non-empty value of at most 256 characters");
  }
  const dailyValue = values.get("--daily-new-target") ?? "10";
  const dailyNewTarget = Number.parseInt(dailyValue, 10);
  if (!Number.isSafeInteger(dailyNewTarget) || dailyNewTarget < 1 || dailyNewTarget > 100) {
    fail("--daily-new-target must be an integer from 1 through 100");
  }
  const replicaId = values.get("--replica-id") ?? null;
  if (replicaId !== null && !uuidPattern.test(replicaId)) fail("--replica-id must be a UUID");
  const databaseUrl = values.get("--database-url")
    ?? process.env.SENSA_FIRST_USER_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? defaultDatabaseUrl;
  const allowInsecureLocalDb = flags.has("--allow-insecure-local-db")
    || process.env.SENSA_FIRST_USER_ALLOW_INSECURE_LOCAL_DB === "true";
  if (!allowInsecureLocalDb) {
    fail("This local operator import requires --allow-insecure-local-db or SENSA_FIRST_USER_ALLOW_INSECURE_LOCAL_DB=true");
  }
  assertLoopbackDatabaseUrl(databaseUrl);
  return {
    sourceRoot: path.resolve(sourceRootArg),
    databaseUrl,
    runKey,
    workspaceId: workspaceId.toLowerCase(),
    learnerUserId,
    dailyNewTarget,
    replicaId: replicaId?.toLowerCase() ?? null,
    allowInsecureLocalDb,
    replaceActivePlan: flags.has("--replace-active-plan"),
    dryRun: flags.has("--dry-run"),
  };
}

function assertLoopbackDatabaseUrl(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("--database-url must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    fail("--database-url must use postgresql:// or postgres://");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const isLoopback = hostname === "localhost"
    || hostname === "::1"
    || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);
  if (!isLoopback) {
    fail(`Refusing non-loopback database host ${parsed.hostname}; this command is local-only`);
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) fail(`${label} must be a JSON object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value;
}

function requireSha(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (!sha256Pattern.test(result)) fail(`${label} must be lowercase SHA-256 hex`);
  return result;
}

function assertValidTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  if (Number.isNaN(new Date(timestamp).getTime())) fail(`${label} must be an ISO timestamp`);
  return timestamp;
}

function assertEqualJson(left: unknown, right: unknown, label: string): void {
  if (canonicalJson(left) !== canonicalJson(right)) fail(`${label} does not match its sidecar`);
}

function releaseTuple(candidate: SenseLearningPackageCandidate): ReleaseTuple {
  const release = candidate.release;
  return {
    contentReleaseId: requireString(release.contentReleaseId, "candidate.release.contentReleaseId"),
    targetLanguage: requireString(release.targetLanguage, "candidate.release.targetLanguage"),
    learnerLocale: requireString(release.learnerLocale, "candidate.release.learnerLocale"),
    schemaVersion: requireString(release.schemaVersion, "candidate.release.schemaVersion"),
    status: requireString(release.status, "candidate.release.status"),
    validatorVersion: requireString(release.validatorVersion, "candidate.release.validatorVersion"),
  };
}

function assertSameReleaseTuple(expected: ReleaseTuple, actual: ReleaseTuple, label: string): void {
  assertEqualJson(actual, expected, `${label} release tuple`);
}

function packageValidationSidecar(value: unknown, label: string): ValidationSidecar {
  const object = requireObject(value, label);
  const requirements = object.requirements;
  if (!Array.isArray(requirements)) fail(`${label}.requirements must be an array`);
  const issues = object.issues;
  if (!Array.isArray(issues)) fail(`${label}.issues must be an array`);
  return {
    status: requireString(object.status, `${label}.status`),
    validatorVersion: requireString(object.validatorVersion, `${label}.validatorVersion`),
    capabilityResolverVersion: requireString(object.capabilityResolverVersion, `${label}.capabilityResolverVersion`),
    packageDigest: requireSha(object.packageDigest, `${label}.packageDigest`),
    requirements: requirements as readonly JsonObject[],
    issues: issues as readonly JsonObject[],
    automatedReview: object.automatedReview === undefined
      ? undefined
      : requireObject(object.automatedReview, `${label}.automatedReview`),
    checkedAt: object.checkedAt === undefined ? undefined : assertValidTimestamp(object.checkedAt, `${label}.checkedAt`),
  };
}

async function loadAndValidatePackages(
  options: ImportOptions,
): Promise<Readonly<{
  reportDigest: string;
  reportCheckedAt: string;
  release: ReleaseTuple;
  packages: readonly LoadedPackage[];
  reportCandidateCount: number;
  reportCandidateLexemeCount: number;
  reportCandidateMediaCount: number;
  rejectedPackages: readonly RejectedPackage[];
}>> {
  const reportPath = path.join(options.sourceRoot, "reports", "release-validation.json");
  const reportBytes = await readFile(reportPath);
  const reportValue = JSON.parse(reportBytes.toString("utf8")) as unknown;
  const report = requireObject(reportValue, "reports/release-validation.json");
  if (report.schemaVersion !== "sensa-release-validation-v1") fail("release-validation.json has an unsupported schemaVersion");
  if (report.capabilityResolverVersion !== sensaExecutableLearningCapabilityResolverVersion) {
    fail("release-validation.json has an unsupported Capability Resolver version");
  }
  const reportCheckedAt = assertValidTimestamp(report.checkedAt, "release-validation.checkedAt");
  const reportPackages = report.packages;
  if (!Array.isArray(reportPackages)) fail("release-validation.packages must be an array");
  const strictEntries: ReportPackage[] = [];
  for (const [index, value] of reportPackages.entries()) {
    const entry = requireObject(value, `release-validation.packages[${index}]`);
    const validator = requireObject(entry.validator, `release-validation.packages[${index}].validator`);
    const review = requireObject(entry.review, `release-validation.packages[${index}].review`);
    if (
      entry.effectiveStatus === "satisfied"
      && validator.status === "satisfied"
      && entry.validatorStatus === "satisfied"
      && review.deterministicStatus === "passed"
      && review.semanticApproved === true
    ) {
      const senseId = requireString(entry.senseId, `release-validation.packages[${index}].senseId`);
      const packageName = requireString(entry.package, `release-validation.packages[${index}].package`);
      if (packageName !== `${senseId}.candidate.json`) {
        fail(`${senseId}: package path is not the canonical candidate path`);
      }
      strictEntries.push({
        senseId,
        package: packageName,
        validator: {
          status: requireString(validator.status, "report validator status"),
          validatorVersion: requireString(validator.validatorVersion, "report validator version"),
          capabilityResolverVersion: requireString(validator.capabilityResolverVersion, "report Capability Resolver version"),
          packageDigest: requireSha(validator.packageDigest, "report package digest"),
          requirements: Array.isArray(validator.requirements)
            ? validator.requirements as readonly JsonObject[]
            : fail(`${senseId}: report validator requirements must be an array`),
        },
        validatorStatus: requireString(entry.validatorStatus, "report validatorStatus"),
        effectiveStatus: requireString(entry.effectiveStatus, "report effectiveStatus"),
        review: {
          inputDigest: requireSha(review.inputDigest, `${senseId}: report review.inputDigest`),
          deterministicStatus: requireString(review.deterministicStatus, `${senseId}: report deterministicStatus`),
          semanticApproved: review.semanticApproved === true,
        },
      });
    }
  }
  const packages: LoadedPackage[] = [];
  const rejectedPackages: RejectedPackage[] = [];
  const selectedSenseIds = new Set<string>();
  const selectedPackageNames = new Set<string>();
  const selectedSenseVersionIds = new Set<string>();
  const reportCandidateLexemeIds = new Set<string>();
  const reportCandidateMediaIds = new Set<string>();
  const reportSenseIds = new Set<string>();
  let expectedRelease: ReleaseTuple | undefined;
  for (const entry of strictEntries.sort((left, right) => left.senseId.localeCompare(right.senseId))) {
    if (reportSenseIds.has(entry.senseId) || selectedPackageNames.has(entry.package)) {
      fail(`${entry.senseId}: release report contains duplicate strict package identity`);
    }
    reportSenseIds.add(entry.senseId);
    selectedPackageNames.add(entry.package);
    const packagePath = path.join(options.sourceRoot, "packages", entry.package);
    const validationPath = path.join(options.sourceRoot, "packages", entry.package.replace(/\.candidate\.json$/u, ".validation.json"));
    const profilePath = path.join(options.sourceRoot, "profiles", `${entry.senseId}.json`);
    const manifestPath = path.join(options.sourceRoot, "assets", entry.senseId, "manifest.json");
    const deterministicReviewPath = path.join(options.sourceRoot, "assets", entry.senseId, "deterministic_review.json");
    const semanticReviewPath = path.join(options.sourceRoot, "assets", entry.senseId, "semantic_review.json");
    const candidate = requireObject(await readJson(packagePath), `${entry.package}`) as unknown as SenseLearningPackageCandidate;
    const validation = packageValidationSidecar(await readJson(validationPath), `${entry.package.replace(/\.candidate\.json$/u, ".validation.json")}`);
    const profile = requireObject(await readJson(profilePath), `${entry.senseId} profile`);
    const manifest = requireObject(await readJson(manifestPath), `${entry.senseId} manifest`);
    const deterministicReview = requireObject(await readJson(deterministicReviewPath), `${entry.senseId} deterministic review`);
    const semanticReview = requireObject(await readJson(semanticReviewPath), `${entry.senseId} semantic review`);
    const result = validateSenseLearningPackage(candidate);
    const release = releaseTuple(candidate);
    expectedRelease ??= release;
    assertSameReleaseTuple(expectedRelease, release, entry.senseId);
    if (release.validatorVersion !== sensaPackageValidatorVersion) {
      fail(`${entry.senseId}: candidate validatorVersion is not ${sensaPackageValidatorVersion}`);
    }
    if (result.validatorVersion !== entry.validator.validatorVersion) {
      fail(`${entry.senseId}: current frozen validator version differs from the release report`);
    }
    if (result.capabilityResolverVersion !== sensaExecutableLearningCapabilityResolverVersion
      || result.capabilityResolverVersion !== entry.validator.capabilityResolverVersion
      || result.capabilityResolverVersion !== validation.capabilityResolverVersion) {
      fail(`${entry.senseId}: Capability Resolver version differs between the current Kernel, report, and sidecar`);
    }
    if (result.packageDigest !== entry.validator.packageDigest || result.packageDigest !== validation.packageDigest) {
      fail(`${entry.senseId}: packageDigest differs between report, sidecar, and current validator`);
    }
    assertEqualJson(result.requirements, validation.requirements, `${entry.senseId} validation requirements`);
    assertEqualJson(result.requirements, manifest.requirements, `${entry.senseId} manifest requirements`);
    if (validation.status !== "satisfied" || validation.issues.length !== 0) {
      fail(`${entry.senseId}: validation sidecar is not clean and satisfied`);
    }
    if (manifest.status !== "satisfied"
      || manifest.packageDigest !== result.packageDigest
      || manifest.validatorVersion !== result.validatorVersion
      || manifest.capabilityResolverVersion !== result.capabilityResolverVersion
      || manifest.contentReleaseId !== release.contentReleaseId
      || manifest.senseVersionId !== candidate.senseVersion.senseVersionId) {
      fail(`${entry.senseId}: manifest identity/status/digest is invalid`);
    }
    if (deterministicReview.status !== "passed"
      || deterministicReview.validatorInputDigest !== entry.review.inputDigest) {
      fail(`${entry.senseId}: deterministic review sidecar does not match the release report`);
    }
    if (semanticReview.verdict !== "approved"
      || semanticReview.inputDigest !== entry.review.inputDigest) {
      fail(`${entry.senseId}: semantic review sidecar does not match the release report`);
    }
    if (validation.automatedReview !== undefined) {
      if (validation.automatedReview.verdict !== "approved"
        || validation.automatedReview.inputDigest !== entry.review.inputDigest) {
        fail(`${entry.senseId}: validation automated review does not match the release report`);
      }
    }
    assertEqualJson(profile, candidate.profile, `${entry.senseId} profile`);
    if (entry.senseId !== candidate.senseVersion.senseId) {
      fail(`${entry.senseId}: report sense ID and candidate sense ID differ`);
    }
    reportCandidateLexemeIds.add(candidate.lexemeVersion.lexemeId);
    for (const asset of candidate.assets) {
      if (asset.kind === "pronunciation_audio" || asset.kind === "study_example_audio") {
        reportCandidateMediaIds.add(asset.mediaSha256);
      }
    }
    if (selectedSenseVersionIds.has(candidate.senseVersion.senseVersionId)) {
      fail(`${entry.senseId}: release contains a duplicate Sense Version identity`);
    }
    selectedSenseVersionIds.add(candidate.senseVersion.senseVersionId);
    if (result.status !== "satisfied") {
      rejectedPackages.push({
        senseId: entry.senseId,
        status: result.status,
        issues: result.issues.map(({ code, path: issuePath }) => ({ code, path: issuePath })),
        packageDigest: result.packageDigest,
      });
      continue;
    }
    selectedSenseIds.add(entry.senseId);
    packages.push({
      packageId: entry.senseId,
      report: entry,
      candidate,
      validation,
      profile,
      manifest,
      deterministicReview,
      semanticReview,
    });
  }
  if (expectedRelease === undefined) fail("No strict release tuple was selected");
  if (packages.length === 0) fail("No report candidate satisfied the current frozen package validator");
  return {
    reportDigest: sha256Bytes(reportBytes),
    reportCheckedAt,
    release: expectedRelease,
    packages,
    reportCandidateCount: strictEntries.length,
    reportCandidateLexemeCount: reportCandidateLexemeIds.size,
    reportCandidateMediaCount: reportCandidateMediaIds.size,
    rejectedPackages,
  };
}

function buildSourceIdentityIndex(packages: readonly LoadedPackage[], release: ReleaseTuple): SourceIdentityIndex {
  const lexemes = new Map<string, JsonObject>();
  const senses = new Map<string, { lexemeId: string }>();
  const relations = new Map<string, RelationRecord>();
  const senseLexemes = new Map<string, string>();
  const selectedLexemeIds = new Set<string>();
  const selectedSenseIds = new Set<string>();
  for (const loaded of packages) {
    const lexeme = loaded.candidate.lexemeVersion;
    selectedLexemeIds.add(lexeme.lexemeId);
    const lexemeValue = {
      languageTag: lexeme.languageTag,
      lemma: lexeme.lemma,
      forms: lexeme.forms,
      pronunciationSourceDigest: lexeme.pronunciationSourceDigest ?? null,
    };
    const existingLexeme = lexemes.get(lexeme.lexemeId);
    if (existingLexeme !== undefined) assertEqualJson(existingLexeme, lexemeValue, `${lexeme.lexemeId} Lexeme snapshot`);
    else lexemes.set(lexeme.lexemeId, lexemeValue);
    const sense = loaded.candidate.senseVersion;
    selectedSenseIds.add(sense.senseId);
    const existingSenseLexeme = senseLexemes.get(sense.senseId);
    if (existingSenseLexeme !== undefined && existingSenseLexeme !== sense.lexemeId) {
      fail(`${sense.senseId}: Sense is associated with conflicting Lexeme identities`);
    }
    senseLexemes.set(sense.senseId, sense.lexemeId);
    senses.set(sense.senseId, { lexemeId: sense.lexemeId });
    for (const relation of loaded.candidate.relations) {
      const normalized: RelationRecord = {
        contentReleaseId: relation.contentReleaseId,
        senseRelationId: relation.senseRelationId,
        sourceSenseId: relation.sourceSenseId,
        targetSenseId: relation.targetSenseId,
        sourceLexemeId: relation.sourceLexemeId,
        targetLexemeId: relation.targetLexemeId,
        relationType: relation.relationType,
        scope: relation.scope,
        distinguishingFeature: relation.distinguishingFeature,
        sourceEvidenceRefs: relation.sourceEvidenceRefs,
        reviewStatus: relation.reviewStatus,
      };
      const existingRelation = relations.get(relation.senseRelationId);
      if (existingRelation !== undefined) assertEqualJson(existingRelation, normalized, `${relation.senseRelationId} relation`);
      else relations.set(relation.senseRelationId, normalized);
      for (const [senseId, lexemeId] of [
        [relation.sourceSenseId, relation.sourceLexemeId],
        [relation.targetSenseId, relation.targetLexemeId],
      ] as const) {
        const existing = senseLexemes.get(senseId);
        if (existing !== undefined && existing !== lexemeId) {
          fail(`${senseId}: relation references conflicting Lexeme identities`);
        }
        senseLexemes.set(senseId, lexemeId);
        senses.set(senseId, { lexemeId });
      }
    }
  }
  for (const relation of relations.values()) {
    for (const lexemeId of [relation.sourceLexemeId, relation.targetLexemeId]) {
      if (!lexemes.has(lexemeId)) {
        lexemes.set(lexemeId, {
          languageTag: release.targetLanguage,
          lemma: lexemeId,
          forms: [lexemeId],
          pronunciationSourceDigest: null,
        });
      }
    }
  }
  return { lexemes, senses, relations, selectedLexemeIds, selectedSenseIds };
}

async function validateMediaFiles(
  sourceRoot: string,
  packages: readonly LoadedPackage[],
): Promise<ReadonlyMap<string, MediaReference>> {
  const media = new Map<string, MediaReference>();
  const mediaRoot = await realpath(path.join(sourceRoot, "media", "audio"));
  const packageMedia = new Map<string, Readonly<{ mimeType: string; sizeBytes: number; mediaBlobId: string; sourceAssetIds: readonly string[] }>>();
  for (const loaded of packages) {
    for (const asset of loaded.candidate.assets) {
      if (!allowedAssetKinds.has(asset.kind)) {
        fail(`${loaded.packageId}.${asset.learningAssetId}: unsupported source asset kind ${asset.kind}`);
      }
      if (asset.kind !== "pronunciation_audio" && asset.kind !== "study_example_audio") continue;
      const mediaAsset = asset as SourceAudioAsset;
      const digest = requireSha(mediaAsset.mediaSha256, `${loaded.packageId}.${asset.learningAssetId}.mediaSha256`);
      if (!allowedAudioMimeTypes.has(mediaAsset.mimeType)) fail(`${loaded.packageId}.${asset.learningAssetId}: unsupported audio MIME`);
      if (!Number.isSafeInteger(mediaAsset.sizeBytes) || mediaAsset.sizeBytes <= 0) {
        fail(`${loaded.packageId}.${asset.learningAssetId}: invalid media size`);
      }
      const reference = {
        mimeType: mediaAsset.mimeType,
        sizeBytes: mediaAsset.sizeBytes,
        mediaBlobId: mediaAsset.mediaBlobId,
        sourceAssetIds: [asset.learningAssetId],
      };
      const prior = packageMedia.get(digest);
      if (prior !== undefined) {
        if (prior.mimeType !== reference.mimeType
          || prior.sizeBytes !== reference.sizeBytes
          || prior.mediaBlobId !== reference.mediaBlobId) {
          fail(`${digest} media metadata differs across source assets`);
        }
        packageMedia.set(digest, {
          ...prior,
          sourceAssetIds: [...prior.sourceAssetIds, asset.learningAssetId],
        });
      }
      else packageMedia.set(digest, reference);
    }
  }
  for (const [digest, reference] of packageMedia) {
    const fileName = `${digest}.mp3`;
    const candidatePath = path.resolve(mediaRoot, fileName);
    if (candidatePath !== path.join(mediaRoot, fileName)) fail(`${digest}: media path normalization failed`);
    const actualPath = await realpath(candidatePath);
    if (actualPath !== path.join(mediaRoot, fileName)) fail(`${digest}: media file resolves outside the canonical media root`);
    const fileStats = await stat(actualPath);
    if (!fileStats.isFile()) fail(`${digest}: media path is not a regular file`);
    const bytes = await readFile(actualPath);
    if (bytes.byteLength !== reference.sizeBytes) {
      fail(`${digest}: media size mismatch (declared ${reference.sizeBytes}, actual ${bytes.byteLength})`);
    }
    const actualDigest = sha256Bytes(bytes);
    if (actualDigest !== digest) fail(`${digest}: media SHA-256 mismatch (actual ${actualDigest})`);
    media.set(digest, {
      mediaSha256: digest,
      mediaBlobId: reference.mediaBlobId,
      mimeType: reference.mimeType,
      sizeBytes: reference.sizeBytes,
      sourceAssetIds: reference.sourceAssetIds,
    });
  }
  if (media.size === 0) fail("No accepted package media was validated");
  return media;
}

function buildIds(options: ImportOptions, release: ReleaseTuple): ImportIds {
  const importNamespace = `sensa:first-user:${options.runKey}`;
  const identityNamespace = `sensa:source-identity:${release.contentReleaseId}`;
  const mapSourceId = (kind: string, sourceId: string): string => stableUuid(`${importNamespace}:${kind}`, sourceId);
  const mapIdentityId = (kind: string, sourceId: string): string => stableUuid(`${identityNamespace}:${kind}`, sourceId);
  return {
    releaseId: mapSourceId("content-release", release.contentReleaseId),
    releaseKey: `sensa-first-user-${options.runKey}-release`,
    bookId: mapSourceId("book", options.runKey),
    bookKey: `sensa-first-user-${options.runKey}-book`,
    bookVersionId: mapSourceId("book-version", options.runKey),
    planId: mapSourceId("study-plan", `${options.workspaceId}:${options.learnerUserId}`),
    mapSourceId,
    mapIdentityId,
  };
}

async function preflight(options: ImportOptions): Promise<Preflight> {
  const loaded = await loadAndValidatePackages(options);
  const sourceIdentities = buildSourceIdentityIndex(loaded.packages, loaded.release);
  if (loaded.packages.length !== expectedAcceptedPackageCount) {
    fail(`Current frozen validator expected ${expectedAcceptedPackageCount} accepted packages, got ${loaded.packages.length}`);
  }
  if (sourceIdentities.selectedLexemeIds.size !== expectedAcceptedLexemeCount) {
    fail(`Current frozen validator expected ${expectedAcceptedLexemeCount} accepted distinct Lexemes, got ${sourceIdentities.selectedLexemeIds.size}`);
  }
  const media = await validateMediaFiles(options.sourceRoot, loaded.packages);
  const packageCounts: Record<string, number> = {};
  for (const loadedPackage of loaded.packages) {
    for (const asset of loadedPackage.candidate.assets) {
      packageCounts[asset.kind] = (packageCounts[asset.kind] ?? 0) + 1;
    }
  }
  return {
    options,
    reportDigest: loaded.reportDigest,
    reportCheckedAt: loaded.reportCheckedAt,
    release: loaded.release,
    packages: loaded.packages,
    media,
    sourceIdentities,
    ids: buildIds(options, loaded.release),
    packageCounts,
    reportCandidateCount: loaded.reportCandidateCount,
    reportCandidateLexemeCount: loaded.reportCandidateLexemeCount,
    reportCandidateMediaCount: loaded.reportCandidateMediaCount,
    rejectedPackages: loaded.rejectedPackages,
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function arrayOfStrings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) fail(`${label} must be a string array`);
  return value as string[];
}

function asTimestamp(value: string | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) fail(`Invalid timestamp ${value}`);
  return timestamp;
}

async function queryOne<T extends pg.QueryResultRow>(client: DatabaseClient, sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
  const result = await client.query<T>(sql, params as unknown[]);
  return result.rows[0];
}

async function queryRows<T extends pg.QueryResultRow>(client: DatabaseClient, sql: string, params: readonly unknown[] = []): Promise<readonly T[]> {
  const result = await client.query<T>(sql, params as unknown[]);
  return result.rows;
}

function assertRowString(row: JsonObject | undefined, key: string, expected: string, label: string): void {
  if (row === undefined || row[key] !== expected) fail(`${label}: ${key} does not match expected value`);
}

async function ensureWorkspaceMembership(client: DatabaseClient, options: ImportOptions): Promise<void> {
  const row = await queryOne(client, `
    SELECT 1
      FROM org.workspace_memberships
     WHERE workspace_id = $1
       AND user_id = $2
     LIMIT 1
  `, [options.workspaceId, options.learnerUserId]);
  if (row === undefined) fail(`Learner ${options.learnerUserId} is not a member of Workspace ${options.workspaceId}`);
}

async function resolveReplica(client: DatabaseClient, options: ImportOptions): Promise<string> {
  const params: unknown[] = [options.workspaceId, options.learnerUserId];
  let predicate = "";
  if (options.replicaId !== null) {
    params.push(options.replicaId);
    predicate = "AND replicas.replica_id = $3";
  }
  const rows = await queryRows<JsonObject>(client, `
    SELECT replicas.replica_id::TEXT AS replica_id,
           replicas.workspace_id::TEXT AS workspace_id,
           replicas.user_id,
           replicas.actor_kind,
           replicas.platform,
           installations.platform AS installation_platform,
           installations.user_id AS installation_user_id
      FROM sync.workspace_replicas AS replicas
      LEFT JOIN sync.installations AS installations
        ON installations.installation_id = replicas.installation_id
       AND installations.user_id = replicas.user_id
     WHERE replicas.workspace_id = $1
       AND replicas.user_id = $2
       AND replicas.actor_kind = 'client_installation'
       AND replicas.platform = 'web'
       ${predicate}
     ORDER BY replicas.last_seen_at DESC NULLS LAST,
              replicas.created_at DESC,
              replicas.replica_id ASC
     LIMIT 1
  `, params);
  if (rows.length !== 1) fail(options.replicaId === null
    ? "No verified web replica is available for the target learner and Workspace; pass --replica-id"
    : "The requested replica is not a verified web client replica for the target learner and Workspace");
  const row = rows[0];
  if (row.installation_platform !== "web" || row.installation_user_id !== options.learnerUserId) {
    fail("The requested replica does not have a matching web installation/user identity");
  }
  return requireString(row.replica_id, "replica_id");
}

async function inspectPlan(client: DatabaseClient, preflightValue: Preflight, replicaId: string): Promise<PlanInspection> {
  const { options, ids } = preflightValue;
  const desired = await queryOne<JsonObject>(client, `
    SELECT study_plan_id::TEXT AS study_plan_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           book_version_id::TEXT AS book_version_id,
           status::TEXT AS status
      FROM sensa.study_plans
     WHERE study_plan_id = $1
     FOR UPDATE
  `, [ids.planId]);
  if (desired !== undefined
    && (desired.workspace_id !== options.workspaceId || desired.learner_user_id !== options.learnerUserId)) {
    fail("Deterministic Study Plan ID is already bound to another learner or Workspace");
  }
  if (desired !== undefined && desired.status !== "active") {
    fail(`Deterministic Study Plan already exists with terminal/non-active status ${String(desired.status)}`);
  }
  const active = await queryOne<JsonObject>(client, `
    SELECT study_plan_id::TEXT AS study_plan_id,
           book_version_id::TEXT AS book_version_id
      FROM sensa.study_plans
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND status = 'active'
     FOR UPDATE
  `, [options.workspaceId, options.learnerUserId]);
  if (active === undefined) {
    return {
      activePlanId: null,
      desiredPlanExists: desired !== undefined,
      replaceEmptyActivePlan: false,
      replicaId,
      replacePlanCleanup: null,
    };
  }
  const activePlanId = requireString(active.study_plan_id, "active study plan ID");
  if (activePlanId === ids.planId) {
    return {
      activePlanId,
      desiredPlanExists: desired !== undefined,
      replaceEmptyActivePlan: false,
      replicaId,
      replacePlanCleanup: null,
    };
  }
  if (!options.replaceActivePlan) {
    fail(`Another active Study Plan ${activePlanId} exists; pass --replace-active-plan to archive it`);
  }
  const history = await queryOne<JsonObject>(client, `
    WITH target_senses AS (
      SELECT DISTINCT versions.sense_id
        FROM sensa.book_version_senses AS members
        JOIN sensa.sense_versions AS versions
          ON versions.sense_version_id = members.sense_version_id
       WHERE members.book_version_id = $2
    ), plan_encounters AS (
      SELECT encounters.sense_encounter_id
        FROM sensa.sense_encounters AS encounters
       WHERE encounters.study_plan_id = $1
    )
    SELECT
      (SELECT COUNT(*)::INTEGER
         FROM sensa.learning_sessions
        WHERE study_plan_id = $1) AS session_count,
      (SELECT COUNT(*)::INTEGER
         FROM plan_encounters) AS encounter_count,
      (SELECT COUNT(*)::INTEGER
         FROM sensa.learning_actions AS actions
        WHERE actions.sense_encounter_id IN (SELECT sense_encounter_id FROM plan_encounters)) AS action_count,
      (SELECT COUNT(*)::INTEGER
         FROM sensa.learning_attempts AS attempts
        WHERE attempts.sense_encounter_id IN (SELECT sense_encounter_id FROM plan_encounters)) AS attempt_count,
      (SELECT COUNT(*)::INTEGER
         FROM sensa.learning_evidence AS evidence
        WHERE evidence.sense_encounter_id IN (SELECT sense_encounter_id FROM plan_encounters)) AS evidence_count,
      (SELECT COUNT(*)::INTEGER
         FROM sensa.memory_outcomes AS outcomes
        WHERE outcomes.sense_encounter_id IN (SELECT sense_encounter_id FROM plan_encounters)) AS outcome_count,
      (SELECT COUNT(*)::INTEGER
         FROM sensa.learner_semantic_states AS states
        WHERE states.workspace_id = $3
          AND states.learner_user_id = $4
          AND states.sense_id IN (SELECT sense_id FROM target_senses)) AS semantic_state_count,
      (SELECT COUNT(*)::INTEGER
         FROM sensa.sense_memory_states AS states
        WHERE states.workspace_id = $3
          AND states.learner_user_id = $4
          AND states.sense_id IN (SELECT sense_id FROM target_senses)) AS memory_state_count,
      (SELECT COUNT(*)::INTEGER
         FROM sensa.learner_declared_masteries AS masteries
        WHERE masteries.workspace_id = $3
          AND masteries.learner_user_id = $4
          AND masteries.sense_id IN (SELECT sense_id FROM target_senses)) AS mastery_state_count
  `, [activePlanId, active.book_version_id, options.workspaceId, options.learnerUserId]);
  const sessionCount = Number(history?.session_count ?? 0);
  const encounterCount = Number(history?.encounter_count ?? 0);
  const actionCount = Number(history?.action_count ?? 0);
  const attemptCount = Number(history?.attempt_count ?? 0);
  const evidenceCount = Number(history?.evidence_count ?? 0);
  const outcomeCount = Number(history?.outcome_count ?? 0);
  const semanticStateCount = Number(history?.semantic_state_count ?? 0);
  const memoryStateCount = Number(history?.memory_state_count ?? 0);
  const masteryStateCount = Number(history?.mastery_state_count ?? 0);
  if (attemptCount !== 0
    || evidenceCount !== 0
    || outcomeCount !== 0
    || semanticStateCount !== 0
    || memoryStateCount !== 0
    || masteryStateCount !== 0) {
    fail(`Refusing to replace active Study Plan ${activePlanId}: learner history exists (attempts=${attemptCount}, evidence=${evidenceCount}, outcomes=${outcomeCount}, semanticStates=${semanticStateCount}, memoryStates=${memoryStateCount}, masteryStates=${masteryStateCount})`);
  }
  return {
    activePlanId,
    desiredPlanExists: desired !== undefined,
    replaceEmptyActivePlan: true,
    replicaId,
    replacePlanCleanup: { sessionCount, encounterCount, actionCount },
  };
}

function identityId(ids: ImportIds, sourceId: string, kind: "lexeme" | "sense"): string {
  return ids.mapIdentityId(kind, sourceId);
}

async function ensureLexemeIdentities(client: DatabaseClient, preflightValue: Preflight): Promise<ReadonlyMap<string, string>> {
  const resolved = new Map<string, string>();
  for (const [sourceLexemeId, snapshot] of preflightValue.sourceIdentities.lexemes) {
    const languageTag = requireString(snapshot.languageTag, `${sourceLexemeId}.languageTag`);
    const lemma = requireString(snapshot.lemma, `${sourceLexemeId}.lemma`);
    const deterministicId = identityId(preflightValue.ids, sourceLexemeId, "lexeme");
    const byLemma = await queryOne<JsonObject>(client, `
      SELECT lexeme_id::TEXT AS lexeme_id, language_tag, lemma
        FROM sensa.lexemes
       WHERE language_tag = $1 AND lemma = $2
       FOR UPDATE
    `, [languageTag, lemma]);
    const resolvedId = byLemma?.lexeme_id === undefined
      ? deterministicId
      : requireString(byLemma.lexeme_id, `${sourceLexemeId}.existingLexemeId`);
    const byId = await queryOne<JsonObject>(client, `
      SELECT lexeme_id::TEXT AS lexeme_id, language_tag, lemma
        FROM sensa.lexemes
       WHERE lexeme_id = $1
       FOR UPDATE
    `, [resolvedId]);
    if (byId !== undefined && (byId.language_tag !== languageTag || byId.lemma !== lemma)) {
      fail(`${sourceLexemeId}: deterministic Lexeme identity conflicts with an existing row`);
    }
    await client.query(`
      INSERT INTO sensa.lexemes (lexeme_id, language_tag, lemma)
      VALUES ($1, $2, $3)
      ON CONFLICT (lexeme_id) DO NOTHING
    `, [resolvedId, languageTag, lemma]);
    resolved.set(sourceLexemeId, resolvedId);
  }
  return resolved;
}

async function ensureSenseIdentities(
  client: DatabaseClient,
  preflightValue: Preflight,
  lexemeIds: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, string>> {
  const resolved = new Map<string, string>();
  for (const [sourceSenseId, senseMeta] of preflightValue.sourceIdentities.senses) {
    const lexemeId = lexemeIds.get(senseMeta.lexemeId);
    if (lexemeId === undefined) fail(`${sourceSenseId}: relation identity references an unknown Lexeme identity`);
    const deterministicId = identityId(preflightValue.ids, sourceSenseId, "sense");
    const senseKey = `sensa.source.${preflightValue.release.contentReleaseId}.${sourceSenseId}`;
    const byKey = await queryOne<JsonObject>(client, `
      SELECT sense_id::TEXT AS sense_id, lexeme_id::TEXT AS lexeme_id, sense_key
        FROM sensa.senses
       WHERE sense_key = $1
       FOR UPDATE
    `, [senseKey]);
    const resolvedId = byKey?.sense_id === undefined
      ? deterministicId
      : requireString(byKey.sense_id, `${sourceSenseId}.existingSenseId`);
    const byId = await queryOne<JsonObject>(client, `
      SELECT sense_id::TEXT AS sense_id, lexeme_id::TEXT AS lexeme_id, sense_key
        FROM sensa.senses
       WHERE sense_id = $1
       FOR UPDATE
    `, [resolvedId]);
    if (byId !== undefined && (byId.lexeme_id !== lexemeId || byId.sense_key !== senseKey)) {
      fail(`${sourceSenseId}: deterministic Sense identity conflicts with an existing row`);
    }
    await client.query(`
      INSERT INTO sensa.senses (sense_id, sense_key, lexeme_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (sense_id) DO NOTHING
    `, [resolvedId, senseKey, lexemeId]);
    resolved.set(sourceSenseId, resolvedId);
  }
  return resolved;
}

async function ensureRelease(client: DatabaseClient, preflightValue: Preflight): Promise<JsonObject> {
  const { ids, release } = preflightValue;
  const existing = await queryOne<JsonObject>(client, `
    SELECT content_release_id::TEXT AS content_release_id,
           release_key,
           version_number,
           target_language,
           learner_locale,
           schema_version,
           source_digest,
           status::TEXT AS status,
           validator_version,
           capability_resolver_version
      FROM sensa.content_releases
     WHERE content_release_id = $1
     FOR UPDATE
  `, [ids.releaseId]);
  if (existing !== undefined) {
    for (const [key, value] of Object.entries({
      content_release_id: ids.releaseId,
      release_key: ids.releaseKey,
      version_number: 1,
      target_language: release.targetLanguage,
      learner_locale: release.learnerLocale,
      schema_version: release.schemaVersion,
      source_digest: preflightValue.reportDigest,
      validator_version: sensaPackageValidatorVersion,
      capability_resolver_version: sensaExecutableLearningCapabilityResolverVersion,
    })) {
      if (existing[key] !== value) fail(`Existing Content Release ${ids.releaseId} does not match this run key/source report (${key})`);
    }
    return existing;
  }
  await client.query(`
    INSERT INTO sensa.content_releases
      (content_release_id, release_key, version_number, target_language, learner_locale,
       schema_version, source_digest, status, validator_version, capability_resolver_version)
    VALUES ($1, $2, 1, $3, $4, $5, $6, 'draft', $7, $8)
  `, [ids.releaseId, ids.releaseKey, release.targetLanguage, release.learnerLocale, release.schemaVersion, preflightValue.reportDigest, sensaPackageValidatorVersion, sensaExecutableLearningCapabilityResolverVersion]);
  return {
    content_release_id: ids.releaseId,
    release_key: ids.releaseKey,
    version_number: 1,
    target_language: release.targetLanguage,
    learner_locale: release.learnerLocale,
    schema_version: release.schemaVersion,
    source_digest: preflightValue.reportDigest,
    status: "draft",
    validator_version: sensaPackageValidatorVersion,
    capability_resolver_version: sensaExecutableLearningCapabilityResolverVersion,
  };
}

async function ensureLexemeVersions(
  client: DatabaseClient,
  preflightValue: Preflight,
  lexemeIds: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, string>> {
  const mapped = new Map<string, string>();
  const releaseId = preflightValue.ids.releaseId;
  const rowsBySource = new Map<string, SenseLearningPackageCandidate["lexemeVersion"]>();
  for (const loaded of preflightValue.packages) {
    const value = loaded.candidate.lexemeVersion;
    const existing = rowsBySource.get(value.lexemeId);
    if (existing !== undefined) assertEqualJson(existing, value, `${value.lexemeId} Lexeme Version snapshot`);
    else rowsBySource.set(value.lexemeId, value);
  }
  for (const value of rowsBySource.values()) {
    const lexemeId = lexemeIds.get(value.lexemeId);
    if (lexemeId === undefined) fail(`${value.lexemeId}: Lexeme identity was not mapped`);
    const mappedId = preflightValue.ids.mapSourceId("lexeme-version", value.lexemeVersionId);
    await client.query(`
      INSERT INTO sensa.lexeme_versions
        (lexeme_version_id, content_release_id, lexeme_id, ipa_us, ipa_uk, syllables, forms, frequency_rank)
      VALUES ($1, $2, $3, NULL, NULL, NULL, $4::TEXT[], NULL)
      ON CONFLICT (lexeme_version_id) DO NOTHING
    `, [mappedId, releaseId, lexemeId, value.forms]);
    const row = await queryOne<JsonObject>(client, `
      SELECT lexeme_version_id::TEXT AS lexeme_version_id,
             content_release_id::TEXT AS content_release_id,
             lexeme_id::TEXT AS lexeme_id,
             forms
        FROM sensa.lexeme_versions
       WHERE lexeme_version_id = $1
    `, [mappedId]);
    if (row === undefined || row.content_release_id !== releaseId || row.lexeme_id !== lexemeId) fail(`${value.lexemeVersionId}: Lexeme Version insert could not be verified`);
    assertEqualJson(row.forms, value.forms, `${value.lexemeVersionId} forms`);
    mapped.set(value.lexemeVersionId, mappedId);
  }
  return mapped;
}

async function ensureRelationOnlyLexemeVersions(
  client: DatabaseClient,
  preflightValue: Preflight,
  lexemeIds: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, string>> {
  const mapped = new Map<string, string>();
  for (const [sourceLexemeId, snapshot] of preflightValue.sourceIdentities.lexemes) {
    if (preflightValue.sourceIdentities.selectedLexemeIds.has(sourceLexemeId)) continue;
    const lexemeId = lexemeIds.get(sourceLexemeId);
    if (lexemeId === undefined) fail(`${sourceLexemeId}: relation-only Lexeme identity was not mapped`);
    const forms = Array.isArray(snapshot.forms)
      ? snapshot.forms.map((value) => requireString(value, `${sourceLexemeId}.forms`))
      : fail(`${sourceLexemeId}.forms must be a string array`);
    const mappedId = preflightValue.ids.mapSourceId("relation-lexeme-version", sourceLexemeId);
    await client.query(`
      INSERT INTO sensa.lexeme_versions
        (lexeme_version_id, content_release_id, lexeme_id, ipa_us, ipa_uk, syllables, forms, frequency_rank)
      VALUES ($1, $2, $3, NULL, NULL, NULL, $4::TEXT[], NULL)
      ON CONFLICT (lexeme_version_id) DO NOTHING
    `, [mappedId, preflightValue.ids.releaseId, lexemeId, forms]);
    const row = await queryOne<JsonObject>(client, `
      SELECT lexeme_version_id::TEXT AS lexeme_version_id,
             content_release_id::TEXT AS content_release_id,
             lexeme_id::TEXT AS lexeme_id,
             forms
        FROM sensa.lexeme_versions
       WHERE lexeme_version_id = $1
    `, [mappedId]);
    if (row === undefined || row.content_release_id !== preflightValue.ids.releaseId || row.lexeme_id !== lexemeId) {
      fail(`${sourceLexemeId}: relation-only Lexeme Version insert could not be verified`);
    }
    assertEqualJson(row.forms, forms, `${sourceLexemeId} relation-only forms`);
    mapped.set(sourceLexemeId, mappedId);
  }
  return mapped;
}

async function ensureSenseVersions(
  client: DatabaseClient,
  preflightValue: Preflight,
  senseIds: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, string>> {
  const mapped = new Map<string, string>();
  const releaseId = preflightValue.ids.releaseId;
  for (const loaded of preflightValue.packages) {
    const value = loaded.candidate.senseVersion;
    const senseId = senseIds.get(value.senseId);
    if (senseId === undefined) fail(`${value.senseId}: Sense identity was not mapped`);
    const mappedId = preflightValue.ids.mapSourceId("sense-version", value.senseVersionId);
    const evidenceDigest = sha256Text(canonicalJson({
      sourceSenseVersionId: value.senseVersionId,
      packageDigest: loaded.validation.packageDigest,
      review: loaded.report.review,
    }));
    const identityDigest = sha256Text(canonicalJson({
      sourceSenseId: value.senseId,
      sourceLexemeId: value.lexemeId,
      reviewInputDigest: loaded.report.review.inputDigest,
    }));
    await client.query(`
      INSERT INTO sensa.sense_versions
        (sense_version_id, content_release_id, sense_id, sense_rank, part_of_speech,
         guide_label_l1, definition_l2, teaching_priority, inventory_version,
         evidence_digest, identity_digest, review_status, reviewed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::sensa.teaching_priority, 1,
              $9, $10, $11::sensa.content_review_status, statement_timestamp())
      ON CONFLICT (sense_version_id) DO NOTHING
    `, [mappedId, releaseId, senseId, value.senseRank, value.partOfSpeech, value.guideLabelL1, value.definitionL2, value.teachingPriority ?? "core", evidenceDigest, identityDigest, value.reviewStatus]);
    mapped.set(value.senseVersionId, mappedId);
  }
  return mapped;
}

async function ensureRelationOnlySenseVersions(
  client: DatabaseClient,
  preflightValue: Preflight,
  senseIds: ReadonlyMap<string, string>,
  relationOnlyLexemeVersionIds: ReadonlyMap<string, string>,
): Promise<void> {
  for (const [sourceSenseId, senseMeta] of preflightValue.sourceIdentities.senses) {
    if (preflightValue.sourceIdentities.selectedSenseIds.has(sourceSenseId)) continue;
    const stableSenseId = senseIds.get(sourceSenseId);
    const lexemeVersionId = relationOnlyLexemeVersionIds.get(senseMeta.lexemeId);
    if (stableSenseId === undefined || lexemeVersionId === undefined) {
      fail(`${sourceSenseId}: relation-only Sense Version identities were not mapped`);
    }
    const mappedId = preflightValue.ids.mapSourceId("relation-sense-version", sourceSenseId);
    const evidenceDigest = sha256Text(canonicalJson({
      sourceReleaseId: preflightValue.release.contentReleaseId,
      sourceSenseId,
      relationOnly: true,
    }));
    const identityDigest = sha256Text(canonicalJson({
      sourceSenseId,
      sourceLexemeId: senseMeta.lexemeId,
      relationOnly: true,
    }));
    const existing = await queryOne<JsonObject>(client, `
      SELECT sense_version_id::TEXT AS sense_version_id,
             content_release_id::TEXT AS content_release_id,
             sense_id::TEXT AS sense_id,
             sense_rank,
             review_status::TEXT AS review_status
        FROM sensa.sense_versions
       WHERE sense_version_id = $1
       FOR UPDATE
    `, [mappedId]);
    if (existing === undefined) {
      const rankRow = await queryOne<JsonObject>(client, `
        SELECT COALESCE(MAX(versions.sense_rank), 0)::INTEGER + 1 AS next_rank
          FROM sensa.sense_versions AS versions
          JOIN sensa.senses AS stable_senses
            ON stable_senses.sense_id = versions.sense_id
         WHERE versions.content_release_id = $1
           AND stable_senses.lexeme_id = (
             SELECT lexeme_id FROM sensa.senses WHERE sense_id = $2
           )
      `, [preflightValue.ids.releaseId, stableSenseId]);
      const nextRank = Number(rankRow?.next_rank ?? 0);
      if (!Number.isSafeInteger(nextRank) || nextRank < 1) fail(`${sourceSenseId}: relation-only Sense Version rank could not be allocated`);
      await client.query(`
        INSERT INTO sensa.sense_versions
          (sense_version_id, content_release_id, sense_id, sense_rank, part_of_speech,
           guide_label_l1, definition_l2, teaching_priority, inventory_version,
           evidence_digest, identity_digest, review_status, reviewed_at)
        VALUES ($1, $2, $3, $4, 'relation_only', 'Relation-only identity',
                'Relation-only endpoint retained for content relationship integrity.',
                'recognition'::sensa.teaching_priority, 1, $5, $6,
                'approved'::sensa.content_review_status, statement_timestamp())
        ON CONFLICT (sense_version_id) DO NOTHING
      `, [mappedId, preflightValue.ids.releaseId, stableSenseId, nextRank, evidenceDigest, identityDigest]);
    }
    const row = await queryOne<JsonObject>(client, `
      SELECT sense_version_id::TEXT AS sense_version_id,
             content_release_id::TEXT AS content_release_id,
             sense_id::TEXT AS sense_id,
             review_status::TEXT AS review_status
        FROM sensa.sense_versions
       WHERE sense_version_id = $1
    `, [mappedId]);
    if (row === undefined
      || row.content_release_id !== preflightValue.ids.releaseId
      || row.sense_id !== stableSenseId
      || row.review_status !== "approved") {
      fail(`${sourceSenseId}: relation-only Sense Version insert could not be verified`);
    }
  }
}

async function ensureRelations(
  client: DatabaseClient,
  preflightValue: Preflight,
  lexemeIds: ReadonlyMap<string, string>,
  senseIds: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, string>> {
  const mapped = new Map<string, string>();
  for (const relation of preflightValue.sourceIdentities.relations.values()) {
    const sourceSenseId = senseIds.get(relation.sourceSenseId);
    const targetSenseId = senseIds.get(relation.targetSenseId);
    const sourceLexemeId = lexemeIds.get(relation.sourceLexemeId);
    const targetLexemeId = lexemeIds.get(relation.targetLexemeId);
    if (sourceSenseId === undefined || targetSenseId === undefined || sourceLexemeId === undefined || targetLexemeId === undefined) {
      fail(`${relation.senseRelationId}: relation identities were not mapped`);
    }
    const mappedId = preflightValue.ids.mapSourceId("sense-relation", relation.senseRelationId);
    await client.query(`
      INSERT INTO sensa.sense_relations
        (sense_relation_id, content_release_id, source_sense_id, target_sense_id, relation_type,
         scope, distinguishing_feature, source_evidence_refs, review_status, reviewed_at)
      VALUES ($1, $2, $3, $4, $5, $6::sensa.relation_scope, $7, $8::TEXT[],
              $9::sensa.content_review_status, statement_timestamp())
      ON CONFLICT (sense_relation_id) DO NOTHING
    `, [mappedId, preflightValue.ids.releaseId, sourceSenseId, targetSenseId, relation.relationType, relation.scope, relation.distinguishingFeature, relation.sourceEvidenceRefs, relation.reviewStatus]);
    mapped.set(relation.senseRelationId, mappedId);
  }
  return mapped;
}

async function ensureProfileAndUsage(
  client: DatabaseClient,
  preflightValue: Preflight,
  senseVersionIds: ReadonlyMap<string, string>,
  relationIds: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, string>> {
  const usageIds = new Map<string, string>();
  for (const loaded of preflightValue.packages) {
    const candidate = loaded.candidate;
    const profile = candidate.profile as SourceProfile;
    const mappedSenseVersionId = senseVersionIds.get(candidate.senseVersion.senseVersionId);
    if (mappedSenseVersionId === undefined) fail(`${loaded.packageId}: profile Sense Version was not mapped`);
    const mappedProfileId = preflightValue.ids.mapSourceId("profile", profile.acquisitionProfileId);
    await client.query(`
      INSERT INTO sensa.acquisition_profiles
        (acquisition_profile_id, content_release_id, sense_version_id, learner_locale, schema_version,
         acquisition_needs, minimum_sufficient_experience, distinguishing_features, preferred_primitives,
         required_asset_capabilities, optional_asset_capabilities, fallback_primitives, domain_bound,
         domain_constraints, generator_provider, generator_model, prompt_version, source_digest,
         review_status, reviewed_at)
      VALUES ($1, $2, $3, $4, $5, $6::sensa.acquisition_need[], $7, $8::TEXT[], $9::sensa.acquisition_primitive[],
              $10::sensa.asset_capability[], $11::sensa.asset_capability[], $12::sensa.acquisition_primitive[],
              $13, $14::TEXT[], $15, $16, $17, $18, $19::sensa.content_review_status, statement_timestamp())
      ON CONFLICT (acquisition_profile_id) DO NOTHING
    `, [mappedProfileId, preflightValue.ids.releaseId, mappedSenseVersionId, profile.learnerLocale, profile.schemaVersion, profile.acquisitionNeeds, profile.minimumSufficientExperience, profile.distinguishingFeatures, profile.preferredPrimitives, profile.requiredAssetCapabilities, profile.optionalAssetCapabilities, profile.fallbackPrimitives, profile.domainBound, profile.domainConstraints, textOrNull(profile.generatorProvider), textOrNull(profile.generatorModel), textOrNull(profile.promptVersion), requireSha(profile.sourceDigest, `${loaded.packageId}.profile.sourceDigest`), profile.reviewStatus]);
    for (const target of profile.boundaryTargets ?? []) {
      const mappedRelationId = relationIds.get(target.senseRelationId);
      if (mappedRelationId === undefined) fail(`${loaded.packageId}: profile boundary target relation was not mapped`);
      await client.query(`
        INSERT INTO sensa.profile_boundary_targets
          (content_release_id, acquisition_profile_id, sense_relation_id, ordinal, is_required)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (acquisition_profile_id, sense_relation_id) DO NOTHING
      `, [preflightValue.ids.releaseId, mappedProfileId, mappedRelationId, target.ordinal, target.isRequired]);
    }
    for (const pattern of candidate.usagePatterns as readonly SourceUsagePattern[]) {
      const mappedPatternId = preflightValue.ids.mapSourceId("usage-pattern", pattern.usagePatternId);
      await client.query(`
        INSERT INTO sensa.usage_patterns
          (usage_pattern_id, content_release_id, sense_version_id, ordinal, canonical_pattern,
           common_collocations, register_label, domain_label, usage_restriction, source_evidence_refs,
           review_status, reviewed_at)
        VALUES ($1, $2, $3, $4, $5, $6::TEXT[], $7, $8, $9, $10::TEXT[],
                $11::sensa.content_review_status, statement_timestamp())
        ON CONFLICT (usage_pattern_id) DO NOTHING
      `, [mappedPatternId, preflightValue.ids.releaseId, mappedSenseVersionId, pattern.ordinal, pattern.canonicalPattern, pattern.commonCollocations, textOrNull(pattern.registerLabel), textOrNull(pattern.domainLabel), textOrNull(pattern.usageRestriction), pattern.sourceEvidenceRefs, pattern.reviewStatus]);
      usageIds.set(pattern.usagePatternId, mappedPatternId);
      for (const [index, slot] of pattern.slots.entries()) {
        await client.query(`
          INSERT INTO sensa.usage_pattern_slots
            (content_release_id, usage_pattern_id, ordinal, slot_name, semantic_role, value_description, is_optional)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (usage_pattern_id, ordinal) DO NOTHING
        `, [preflightValue.ids.releaseId, mappedPatternId, index + 1, slot.slotName, slot.semanticRole, slot.valueDescription, slot.isOptional]);
      }
    }
  }
  return usageIds;
}

async function ensureAssets(
  client: DatabaseClient,
  preflightValue: Preflight,
  senseVersionIds: ReadonlyMap<string, string>,
  lexemeVersionIds: ReadonlyMap<string, string>,
  relationIds: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, string>> {
  const mappedAssets = new Map<string, string>();
  for (const loaded of preflightValue.packages) {
    const candidate = loaded.candidate;
    const mappedSenseVersionId = senseVersionIds.get(candidate.senseVersion.senseVersionId);
    const mappedLexemeVersionId = lexemeVersionIds.get(candidate.lexemeVersion.lexemeVersionId);
    if (mappedSenseVersionId === undefined || mappedLexemeVersionId === undefined) fail(`${loaded.packageId}: asset owner versions were not mapped`);
    for (const asset of candidate.assets) {
      const mappedAssetId = preflightValue.ids.mapSourceId("learning-asset", asset.learningAssetId);
      const isPronunciation = asset.kind === "pronunciation_audio";
      await client.query(`
        INSERT INTO sensa.learning_assets
          (learning_asset_id, content_release_id, asset_kind, sense_version_id, lexeme_version_id,
           learner_locale, content_digest, source_evidence_refs, generator_provider, generator_model,
           prompt_version, source_license, source_attribution, review_status, reviewed_at)
        VALUES ($1, $2, $3::sensa.asset_kind, $4, $5, $6, $7, $8::TEXT[], $9, $10, $11, $12, $13,
                $14::sensa.content_review_status, statement_timestamp())
        ON CONFLICT (learning_asset_id) DO NOTHING
      `, [mappedAssetId, preflightValue.ids.releaseId, asset.kind,
        isPronunciation ? null : mappedSenseVersionId,
        isPronunciation ? mappedLexemeVersionId : null,
        textOrNull(asset.learnerLocale ?? preflightValue.release.learnerLocale),
        requireSha(asset.contentDigest, `${loaded.packageId}.${asset.learningAssetId}.contentDigest`),
        arrayOfStrings(asset.sourceEvidenceRefs, `${loaded.packageId}.${asset.learningAssetId}.sourceEvidenceRefs`),
        textOrNull(asset.generatorProvider), textOrNull(asset.generatorModel), textOrNull(asset.promptVersion),
        textOrNull(asset.sourceLicense), textOrNull(asset.sourceAttribution), asset.reviewStatus]);
      mappedAssets.set(asset.learningAssetId, mappedAssetId);
    }
  }

  for (const loaded of preflightValue.packages) {
    const candidate = loaded.candidate;
    const mappedSenseVersionId = senseVersionIds.get(candidate.senseVersion.senseVersionId);
    if (mappedSenseVersionId === undefined) fail(`${loaded.packageId}: typed asset owner was not mapped`);
    for (const asset of candidate.assets) {
      const mappedAssetId = mappedAssets.get(asset.learningAssetId);
      if (mappedAssetId === undefined) fail(`${loaded.packageId}.${asset.learningAssetId}: asset was not mapped`);
      if (asset.kind === "experience_sketch" || asset.kind === "l1_bridge") {
        await client.query(`
          INSERT INTO sensa.text_assets (content_release_id, learning_asset_id, body, sense_relation_id)
          VALUES ($1, $2, $3, NULL)
          ON CONFLICT (learning_asset_id) DO NOTHING
        `, [preflightValue.ids.releaseId, mappedAssetId, asset.body]);
      } else if (asset.kind === "example") {
        await client.query(`
          INSERT INTO sensa.example_assets
            (content_release_id, learning_asset_id, sense_version_id, ordinal, text_l2, text_l1,
             target_form, target_start, target_end, disambiguating_cue, variation_note, construction,
             scene_domain, collocations, role, context_l2, context_l1)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::sensa.example_construction,
                  $13::sensa.scene_domain, $14::TEXT[], $15::sensa.example_role, $16, $17)
          ON CONFLICT (learning_asset_id) DO NOTHING
        `, [preflightValue.ids.releaseId, mappedAssetId, mappedSenseVersionId, asset.ordinal, asset.textL2, asset.textL1, asset.targetForm, asset.targetStart, asset.targetEnd, asset.disambiguatingCue, asset.variationNote, asset.construction, asset.sceneDomain, asset.collocations, asset.role, textOrNull(asset.contextL2), textOrNull(asset.contextL1)]);
      } else if (asset.kind === "contrast_pair") {
        const mappedRelationId = relationIds.get(asset.senseRelationId);
        if (mappedRelationId === undefined) fail(`${loaded.packageId}.${asset.learningAssetId}: contrast relation was not mapped`);
        await client.query(`
          INSERT INTO sensa.contrast_case_assets
            (content_release_id, learning_asset_id, sense_relation_id, positive_text_l2, positive_text_l1,
             negative_text_l2, negative_text_l1, distinguishing_feature)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (learning_asset_id) DO NOTHING
        `, [preflightValue.ids.releaseId, mappedAssetId, mappedRelationId, asset.positiveTextL2, asset.positiveTextL1, asset.negativeTextL2, asset.negativeTextL1, asset.distinguishingFeature]);
      }
    }
  }

  for (const [mediaSha256, media] of preflightValue.media) {
    const existing = await queryOne<JsonObject>(client, `
      SELECT media_blob_id::TEXT AS media_blob_id, sha256, mime_type, size_bytes, storage_key
        FROM content.media_blobs
       WHERE sha256 = $1
       FOR UPDATE
    `, [mediaSha256]);
    const deterministicId = preflightValue.ids.mapSourceId("media-blob", media.mediaBlobId);
    const resolvedId = existing?.media_blob_id === undefined
      ? deterministicId
      : requireString(existing.media_blob_id, `${mediaSha256}.existingMediaBlobId`);
    if (existing !== undefined
      && (existing.mime_type !== media.mimeType || Number(existing.size_bytes) !== media.sizeBytes)) {
      fail(`${mediaSha256}: existing media metadata differs from source bytes`);
    }
    const byId = await queryOne<JsonObject>(client, `
      SELECT media_blob_id::TEXT AS media_blob_id, sha256, mime_type, size_bytes
        FROM content.media_blobs
       WHERE media_blob_id = $1
       FOR UPDATE
    `, [resolvedId]);
    if (byId !== undefined && (byId.sha256 !== mediaSha256 || byId.mime_type !== media.mimeType || Number(byId.size_bytes) !== media.sizeBytes)) {
      fail(`${mediaSha256}: deterministic media identity conflicts with an existing blob row`);
    }
    await client.query(`
      INSERT INTO content.media_blobs
        (media_blob_id, sha256, mime_type, size_bytes, storage_key)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (sha256) DO NOTHING
    `, [resolvedId, mediaSha256, media.mimeType, media.sizeBytes, `sensa/content/audio/${mediaSha256}.mp3`]);
    for (const loaded of preflightValue.packages) {
      for (const asset of loaded.candidate.assets) {
        if ((asset.kind === "pronunciation_audio" || asset.kind === "study_example_audio")
          && asset.mediaSha256 === mediaSha256) {
          mappedAssets.set(`media:${asset.learningAssetId}`, resolvedId);
        }
      }
    }
  }

  for (const loaded of preflightValue.packages) {
    const candidate = loaded.candidate;
    const mappedSenseVersionId = senseVersionIds.get(candidate.senseVersion.senseVersionId);
    if (mappedSenseVersionId === undefined) fail(`${loaded.packageId}: audio owner version was not mapped`);
    for (const asset of candidate.assets) {
      if (asset.kind !== "pronunciation_audio" && asset.kind !== "study_example_audio") continue;
      const mappedAssetId = mappedAssets.get(asset.learningAssetId);
      const mediaBlobId = mappedAssets.get(`media:${asset.learningAssetId}`);
      if (mappedAssetId === undefined || mediaBlobId === undefined) fail(`${loaded.packageId}.${asset.learningAssetId}: audio identity was not mapped`);
      const sourceExampleId = asset.kind === "study_example_audio"
        ? asset.sourceExampleAssetId ?? null
        : null;
      const sourceExampleAssetId = sourceExampleId === null
        ? null
        : mappedAssets.get(sourceExampleId);
      if (asset.kind === "study_example_audio" && sourceExampleAssetId === undefined) fail(`${loaded.packageId}.${asset.learningAssetId}: study Example source was not mapped`);
      await client.query(`
        INSERT INTO sensa.audio_assets
          (content_release_id, learning_asset_id, media_blob_id, source_example_asset_id,
           accent_locale, provider, model, voice, source_text_digest, duration_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (learning_asset_id) DO NOTHING
      `, [preflightValue.ids.releaseId, mappedAssetId, mediaBlobId, sourceExampleAssetId ?? null, textOrNull(asset.accentLocale), textOrNull(asset.provider), textOrNull(asset.model), textOrNull(asset.voice), requireSha(asset.sourceTextDigest, `${loaded.packageId}.${asset.learningAssetId}.sourceTextDigest`), asset.durationMs]);
    }
  }
  return mappedAssets;
}

async function ensureManifests(
  client: DatabaseClient,
  preflightValue: Preflight,
  senseVersionIds: ReadonlyMap<string, string>,
  relationIds: ReadonlyMap<string, string>,
  usageIds: ReadonlyMap<string, string>,
  assetIds: ReadonlyMap<string, string>,
): Promise<void> {
  for (const loaded of preflightValue.packages) {
    const candidate = loaded.candidate;
    const mappedSenseVersionId = senseVersionIds.get(candidate.senseVersion.senseVersionId);
    const mappedProfileId = preflightValue.ids.mapSourceId("profile", candidate.profile.acquisitionProfileId);
    if (mappedSenseVersionId === undefined) fail(`${loaded.packageId}: manifest Sense Version was not mapped`);
    const manifestId = preflightValue.ids.mapSourceId("manifest", candidate.senseVersion.senseVersionId);
    await client.query(`
      INSERT INTO sensa.required_asset_manifests
        (required_asset_manifest_id, content_release_id, sense_version_id, acquisition_profile_id,
         validator_version, capability_resolver_version, status, package_digest, validated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'incomplete', $7, $8)
      ON CONFLICT (required_asset_manifest_id) DO NOTHING
    `, [manifestId, preflightValue.ids.releaseId, mappedSenseVersionId, mappedProfileId, loaded.validation.validatorVersion, loaded.validation.capabilityResolverVersion, loaded.validation.packageDigest, asTimestamp(loaded.validation.checkedAt, new Date())]);
    for (const requirement of loaded.validation.requirements) {
      const requirementKey = requireString(requirement.key, `${loaded.packageId}.manifest.requirement.key`);
      const capability = requireString(requirement.capability, `${loaded.packageId}.${requirementKey}.capability`);
      const requiredCount = Number(requirement.requiredCount);
      const matchedResourceIds = Array.isArray(requirement.matchedResourceIds)
        ? requirement.matchedResourceIds.map((value) => requireString(value, `${loaded.packageId}.${requirementKey}.matchedResourceId`))
        : fail(`${loaded.packageId}.${requirementKey}: matchedResourceIds must be an array`);
      const requirementId = preflightValue.ids.mapSourceId("manifest-requirement", `${candidate.senseVersion.senseVersionId}:${requirementKey}`);
      await client.query(`
        INSERT INTO sensa.manifest_requirements
          (content_release_id, manifest_requirement_id, required_asset_manifest_id, requirement_key,
           capability, required_count, satisfied_count, status)
        VALUES ($1, $2, $3, $4, $5::sensa.asset_capability, $6, 0, 'incomplete')
        ON CONFLICT (manifest_requirement_id) DO NOTHING
      `, [preflightValue.ids.releaseId, requirementId, manifestId, requirementKey, capability, requiredCount]);
      for (const sourceResourceId of matchedResourceIds) {
        const mappedAssetId = assetIds.get(sourceResourceId);
        const mappedUsageId = usageIds.get(sourceResourceId);
        if (mappedAssetId !== undefined) {
          await client.query(`
            INSERT INTO sensa.manifest_requirement_asset_matches
              (content_release_id, manifest_requirement_id, learning_asset_id)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
          `, [preflightValue.ids.releaseId, requirementId, mappedAssetId]);
        } else if (mappedUsageId !== undefined) {
          await client.query(`
            INSERT INTO sensa.manifest_requirement_usage_pattern_matches
              (content_release_id, manifest_requirement_id, usage_pattern_id)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
          `, [preflightValue.ids.releaseId, requirementId, mappedUsageId]);
        } else {
          fail(`${loaded.packageId}.${requirementKey}: manifest references unknown resource ${sourceResourceId}`);
        }
      }
      await client.query(`
        UPDATE sensa.manifest_requirements
           SET satisfied_count = $2,
               status = 'satisfied'::sensa.manifest_status
         WHERE manifest_requirement_id = $1
      `, [requirementId, matchedResourceIds.length]);
    }
    await client.query(`
      UPDATE sensa.required_asset_manifests
         SET status = 'satisfied'::sensa.manifest_status
       WHERE required_asset_manifest_id = $1
    `, [manifestId]);
    // Relation IDs are intentionally evaluated here as well, so an importer
    // cannot silently discard a conditional boundary reference.
    for (const target of candidate.profile.boundaryTargets) {
      if (!relationIds.has(target.senseRelationId)) fail(`${loaded.packageId}: boundary target relation was not imported`);
    }
  }
}

/**
 * The source release intentionally carries relation edges to senses outside
 * the selected 372-package Book. The kernel's relation FK guard requires a
 * release-local Sense Version, and the release publish gate requires every
 * Sense Version to have a valid Profile/Manifest. These rows are therefore
 * explicit non-learnable identity scaffolds: they are never Book members and
 * have one zero-cardinality satisfied requirement.
 */
async function ensureRelationOnlyProfilesAndManifests(
  client: DatabaseClient,
  preflightValue: Preflight,
): Promise<void> {
  for (const sourceSenseId of preflightValue.sourceIdentities.senses.keys()) {
    if (preflightValue.sourceIdentities.selectedSenseIds.has(sourceSenseId)) continue;
    const senseVersionId = preflightValue.ids.mapSourceId("relation-sense-version", sourceSenseId);
    const profileId = preflightValue.ids.mapSourceId("relation-only-profile", sourceSenseId);
    const sourceDigest = sha256Text(canonicalJson({
      sourceReleaseId: preflightValue.release.contentReleaseId,
      sourceSenseId,
      relationOnly: true,
    }));
    await client.query(`
      INSERT INTO sensa.acquisition_profiles
        (acquisition_profile_id, content_release_id, sense_version_id, learner_locale, schema_version,
         acquisition_needs, minimum_sufficient_experience, distinguishing_features, preferred_primitives,
         required_asset_capabilities, optional_asset_capabilities, fallback_primitives, domain_bound,
         domain_constraints, generator_provider, generator_model, prompt_version, source_digest,
         review_status, reviewed_at)
      VALUES ($1, $2, $3, $4, $5, ARRAY['form_binding']::sensa.acquisition_need[],
              'Stable endpoint retained for relation integrity.', ARRAY['relation-only identity']::TEXT[],
              ARRAY['production_cue']::sensa.acquisition_primitive[],
              ARRAY[]::sensa.asset_capability[], ARRAY[]::sensa.asset_capability[],
              ARRAY['production_cue']::sensa.acquisition_primitive[], false, ARRAY[]::TEXT[],
              NULL, NULL, NULL, $6, 'approved'::sensa.content_review_status, statement_timestamp())
      ON CONFLICT (acquisition_profile_id) DO NOTHING
    `, [profileId, preflightValue.ids.releaseId, senseVersionId, preflightValue.release.learnerLocale, preflightValue.release.schemaVersion, sourceDigest]);

    const manifestId = preflightValue.ids.mapSourceId("relation-only-manifest", sourceSenseId);
    const requirementId = preflightValue.ids.mapSourceId("relation-only-requirement", sourceSenseId);
    const packageDigest = sha256Text(canonicalJson({
      sourceReleaseId: preflightValue.release.contentReleaseId,
      sourceSenseId,
      relationOnlyManifest: true,
    }));
    await client.query(`
      INSERT INTO sensa.required_asset_manifests
        (required_asset_manifest_id, content_release_id, sense_version_id, acquisition_profile_id,
         validator_version, capability_resolver_version, status, package_digest, validated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'incomplete', $7, statement_timestamp())
      ON CONFLICT (required_asset_manifest_id) DO NOTHING
    `, [manifestId, preflightValue.ids.releaseId, senseVersionId, profileId, sensaPackageValidatorVersion, sensaExecutableLearningCapabilityResolverVersion, packageDigest]);
    await client.query(`
      INSERT INTO sensa.manifest_requirements
        (content_release_id, manifest_requirement_id, required_asset_manifest_id, requirement_key,
         capability, required_count, satisfied_count, status)
      VALUES ($1, $2, $3, 'relation-only.identity', 'meaning_grounding'::sensa.asset_capability,
              0, 0, 'satisfied'::sensa.manifest_status)
      ON CONFLICT (manifest_requirement_id) DO NOTHING
    `, [preflightValue.ids.releaseId, requirementId, manifestId]);
    await client.query(`
      UPDATE sensa.required_asset_manifests
         SET status = 'satisfied'::sensa.manifest_status
       WHERE required_asset_manifest_id = $1
    `, [manifestId]);
  }
}

async function ensureBook(
  client: DatabaseClient,
  preflightValue: Preflight,
  senseVersionIds: ReadonlyMap<string, string>,
): Promise<void> {
  const { ids, release } = preflightValue;
  const existingBook = await queryOne<JsonObject>(client, `
    SELECT book_id::TEXT AS book_id, book_key
      FROM sensa.books
     WHERE book_id = $1
     FOR UPDATE
  `, [ids.bookId]);
  if (existingBook !== undefined) {
    assertRowString(existingBook, "book_key", ids.bookKey, "Existing Book");
  } else {
    const conflicting = await queryOne<JsonObject>(client, `SELECT book_id::TEXT AS book_id FROM sensa.books WHERE book_key = $1`, [ids.bookKey]);
    if (conflicting !== undefined && conflicting.book_id !== ids.bookId) fail(`Book key ${ids.bookKey} is already bound to another ID`);
    await client.query(`INSERT INTO sensa.books (book_id, book_key) VALUES ($1, $2)`, [ids.bookId, ids.bookKey]);
  }
  const existingVersion = await queryOne<JsonObject>(client, `
    SELECT book_version_id::TEXT AS book_version_id,
           book_id::TEXT AS book_id,
           version_number,
           content_release_id::TEXT AS content_release_id,
           target_language,
           learner_locale,
           title,
           description,
           status::TEXT AS status,
           manifest_digest,
           sense_count,
           lexeme_count
      FROM sensa.book_versions
     WHERE book_version_id = $1
     FOR UPDATE
  `, [ids.bookVersionId]);
  if (existingVersion !== undefined) {
    for (const [key, expected] of Object.entries({
      book_id: ids.bookId,
      version_number: 1,
      content_release_id: ids.releaseId,
      target_language: release.targetLanguage,
      learner_locale: release.learnerLocale,
      title: "Sensa 首位用户真实词书",
      description: "Local-only first-user production content. This Book is pinned to one learner and is never public.",
    })) {
      if (existingVersion[key] !== expected) fail(`Existing Book Version ${ids.bookVersionId} does not match the first-user import`);
    }
  } else {
    await client.query(`
      INSERT INTO sensa.book_versions
        (book_version_id, book_id, version_number, content_release_id, target_language, learner_locale,
         title, description, status, manifest_digest, sense_count, lexeme_count)
      VALUES ($1, $2, 1, $3, $4, $5, $6, $7, 'draft', $8, 0, 0)
    `, [ids.bookVersionId, ids.bookId, ids.releaseId, release.targetLanguage, release.learnerLocale, "Sensa 首位用户真实词书", "Local-only first-user production content. This Book is pinned to one learner and is never public.", sha256Text(`sensa-first-user-pending:${ids.bookVersionId}`)]);
  }
  const versionStatus = existingVersion?.status ?? "draft";
  if (versionStatus === "draft") {
    for (const [index, loaded] of preflightValue.packages.entries()) {
      const mappedSenseVersionId = senseVersionIds.get(loaded.candidate.senseVersion.senseVersionId);
      if (mappedSenseVersionId === undefined) fail(`${loaded.packageId}: Book member Sense Version was not mapped`);
      await client.query(`
        INSERT INTO sensa.book_version_senses (book_version_id, ordinal, sense_version_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [ids.bookVersionId, index + 1, mappedSenseVersionId]);
    }
    const manifestRow = await queryOne<JsonObject>(client, `SELECT sensa.book_manifest_digest($1) AS manifest_digest`, [ids.bookVersionId]);
    const manifestDigest = requireSha(manifestRow?.manifest_digest, "Book manifest digest");
    await client.query(`
      UPDATE sensa.book_versions
         SET status = 'published',
             manifest_digest = $2,
             sense_count = $3,
             lexeme_count = $4,
             published_at = statement_timestamp()
       WHERE book_version_id = $1
         AND status = 'draft'
    `, [ids.bookVersionId, manifestDigest, preflightValue.packages.length, expectedAcceptedLexemeCount]);
  } else if (versionStatus !== "published" && versionStatus !== "retired") {
    fail(`Book Version ${ids.bookVersionId} has unsupported status ${versionStatus}`);
  }
}

type EmptyPlanRuntimeCleanup = Readonly<{
  deletedSessionCount: number;
  deletedEncounterCount: number;
  deletedActionCount: number;
  deletedAttemptCount: number;
  deletedEvidenceCount: number;
  deletedOutcomeCount: number;
  deletedMutableFeedCount: number;
  deletedFactFeedCount: number;
  deletedOperationCount: number;
  rebootstrapReplicaCount: number;
}>;

function stringSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values);
}

function assertSameStringOrNull(actual: unknown, expected: unknown, label: string): void {
  const actualValue = actual === null || actual === undefined ? null : String(actual);
  const expectedValue = expected === null || expected === undefined ? null : String(expected);
  if (actualValue !== expectedValue) fail(`${label} does not match its feed rows`);
}

async function verifySyncOperationBounds(client: DatabaseClient, options: ImportOptions): Promise<void> {
  const rows = await queryRows<JsonObject>(client, `
    SELECT operations.operation_id,
           operations.first_mutable_sequence::TEXT AS first_mutable_sequence,
           operations.last_mutable_sequence::TEXT AS last_mutable_sequence,
           operations.first_fact_sequence::TEXT AS first_fact_sequence,
           operations.last_fact_sequence::TEXT AS last_fact_sequence,
           (SELECT MIN(changes.mutable_change_sequence)::TEXT
              FROM sensa.sync_mutable_changes AS changes
             WHERE changes.workspace_id = operations.workspace_id
               AND changes.learner_user_id = operations.learner_user_id
               AND changes.source_operation_id = operations.operation_id) AS actual_first_mutable_sequence,
           (SELECT MAX(changes.mutable_change_sequence)::TEXT
              FROM sensa.sync_mutable_changes AS changes
             WHERE changes.workspace_id = operations.workspace_id
               AND changes.learner_user_id = operations.learner_user_id
               AND changes.source_operation_id = operations.operation_id) AS actual_last_mutable_sequence,
           (SELECT MIN(facts.fact_sequence)::TEXT
              FROM sensa.sync_append_facts AS facts
             WHERE facts.workspace_id = operations.workspace_id
               AND facts.learner_user_id = operations.learner_user_id
               AND facts.source_operation_id = operations.operation_id) AS actual_first_fact_sequence,
           (SELECT MAX(facts.fact_sequence)::TEXT
              FROM sensa.sync_append_facts AS facts
             WHERE facts.workspace_id = operations.workspace_id
               AND facts.learner_user_id = operations.learner_user_id
               AND facts.source_operation_id = operations.operation_id) AS actual_last_fact_sequence
      FROM sensa.sync_operations AS operations
     WHERE operations.workspace_id = $1
       AND operations.learner_user_id = $2
  `, [options.workspaceId, options.learnerUserId]);
  for (const row of rows) {
    const operationId = requireString(row.operation_id, "Sensa Sync operation ID");
    assertSameStringOrNull(row.first_mutable_sequence, row.actual_first_mutable_sequence, `${operationId} first mutable bound`);
    assertSameStringOrNull(row.last_mutable_sequence, row.actual_last_mutable_sequence, `${operationId} last mutable bound`);
    assertSameStringOrNull(row.first_fact_sequence, row.actual_first_fact_sequence, `${operationId} first fact bound`);
    assertSameStringOrNull(row.last_fact_sequence, row.actual_last_fact_sequence, `${operationId} last fact bound`);
  }
}

async function cleanupEmptyPlanRuntimeAndSync(
  client: DatabaseClient,
  options: ImportOptions,
  planInspection: PlanInspection,
): Promise<EmptyPlanRuntimeCleanup> {
  const oldPlanId = planInspection.activePlanId;
  if (oldPlanId === null || !planInspection.replaceEmptyActivePlan) {
    return {
      deletedSessionCount: 0,
      deletedEncounterCount: 0,
      deletedActionCount: 0,
      deletedAttemptCount: 0,
      deletedEvidenceCount: 0,
      deletedOutcomeCount: 0,
      deletedMutableFeedCount: 0,
      deletedFactFeedCount: 0,
      deletedOperationCount: 0,
      rebootstrapReplicaCount: 0,
    };
  }
  const cleanup = planInspection.replacePlanCleanup;
  if (cleanup === null) fail("Active Plan replacement was requested without an empty-plan cleanup snapshot");

  // Capture every runtime identity and every feed identity before the cascade.
  // The operation set is deliberately derived from the exact target feed rows;
  // an operation that also carries a retained row is rejected below.
  const sessions = await queryRows<JsonObject>(client, `
    SELECT learning_session_id::TEXT AS learning_session_id
      FROM sensa.learning_sessions
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND study_plan_id = $3
     FOR UPDATE
  `, [options.workspaceId, options.learnerUserId, oldPlanId]);
  const sessionIds = sessions.map((row) => requireString(row.learning_session_id, "old Plan session ID"));
  const encounters = await queryRows<JsonObject>(client, `
    SELECT sense_encounter_id::TEXT AS sense_encounter_id
      FROM sensa.sense_encounters
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND study_plan_id = $3
     FOR UPDATE
  `, [options.workspaceId, options.learnerUserId, oldPlanId]);
  const encounterIds = encounters.map((row) => requireString(row.sense_encounter_id, "old Plan encounter ID"));
  const actions = await queryRows<JsonObject>(client, `
    SELECT actions.learning_action_id::TEXT AS learning_action_id
      FROM sensa.learning_actions AS actions
      JOIN sensa.sense_encounters AS encounters
        ON encounters.sense_encounter_id = actions.sense_encounter_id
     WHERE actions.workspace_id = $1
       AND actions.learner_user_id = $2
       AND encounters.workspace_id = $1
       AND encounters.learner_user_id = $2
       AND encounters.study_plan_id = $3
     FOR UPDATE OF actions
  `, [options.workspaceId, options.learnerUserId, oldPlanId]);
  const actionIds = actions.map((row) => requireString(row.learning_action_id, "old Plan action ID"));
  const attempts = await queryRows<JsonObject>(client, `
    SELECT attempts.learning_attempt_id::TEXT AS learning_attempt_id
      FROM sensa.learning_attempts AS attempts
      JOIN sensa.sense_encounters AS encounters
        ON encounters.sense_encounter_id = attempts.sense_encounter_id
     WHERE attempts.workspace_id = $1
       AND attempts.learner_user_id = $2
       AND encounters.workspace_id = $1
       AND encounters.learner_user_id = $2
       AND encounters.study_plan_id = $3
     FOR UPDATE OF attempts
  `, [options.workspaceId, options.learnerUserId, oldPlanId]);
  const attemptIds = attempts.map((row) => requireString(row.learning_attempt_id, "old Plan attempt ID"));
  const evidence = await queryRows<JsonObject>(client, `
    SELECT evidence.learning_evidence_id::TEXT AS learning_evidence_id
      FROM sensa.learning_evidence AS evidence
      JOIN sensa.sense_encounters AS encounters
        ON encounters.sense_encounter_id = evidence.sense_encounter_id
     WHERE evidence.workspace_id = $1
       AND evidence.learner_user_id = $2
       AND encounters.workspace_id = $1
       AND encounters.learner_user_id = $2
       AND encounters.study_plan_id = $3
     FOR UPDATE OF evidence
  `, [options.workspaceId, options.learnerUserId, oldPlanId]);
  const evidenceIds = evidence.map((row) => requireString(row.learning_evidence_id, "old Plan evidence ID"));
  const outcomes = await queryRows<JsonObject>(client, `
    SELECT outcomes.memory_outcome_id::TEXT AS memory_outcome_id
      FROM sensa.memory_outcomes AS outcomes
      JOIN sensa.sense_encounters AS encounters
        ON encounters.sense_encounter_id = outcomes.sense_encounter_id
     WHERE outcomes.workspace_id = $1
       AND outcomes.learner_user_id = $2
       AND encounters.workspace_id = $1
       AND encounters.learner_user_id = $2
       AND encounters.study_plan_id = $3
     FOR UPDATE OF outcomes
  `, [options.workspaceId, options.learnerUserId, oldPlanId]);
  const outcomeIds = outcomes.map((row) => requireString(row.memory_outcome_id, "old Plan outcome ID"));
  if (sessionIds.length !== cleanup.sessionCount
    || encounterIds.length !== cleanup.encounterCount
    || actionIds.length !== cleanup.actionCount) {
    fail(`Active Plan replacement runtime changed during import preflight for ${oldPlanId}`);
  }
  if (attemptIds.length !== 0 || evidenceIds.length !== 0 || outcomeIds.length !== 0) {
    fail(`Refusing to delete active Plan ${oldPlanId}: runtime facts exist (attempts=${attemptIds.length}, evidence=${evidenceIds.length}, outcomes=${outcomeIds.length})`);
  }

  const mutableRows = await queryRows<JsonObject>(client, `
    SELECT mutable_change_sequence::TEXT AS mutable_change_sequence,
           entity_type::TEXT AS entity_type,
           entity_id::TEXT AS entity_id,
           source_operation_id
      FROM sensa.sync_mutable_changes
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND (
         (entity_type = 'learning_session' AND entity_id = ANY($3::UUID[]))
         OR (entity_type = 'sense_encounter' AND entity_id = ANY($4::UUID[]))
       )
     FOR UPDATE
  `, [options.workspaceId, options.learnerUserId, sessionIds, encounterIds]);
  const factRows = await queryRows<JsonObject>(client, `
    SELECT fact_sequence::TEXT AS fact_sequence,
           fact_type::TEXT AS fact_type,
           fact_id::TEXT AS fact_id,
           source_operation_id
      FROM sensa.sync_append_facts
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND (
         (fact_type = 'learning_action' AND fact_id = ANY($3::UUID[]))
         OR (fact_type = 'learning_attempt' AND fact_id = ANY($4::UUID[]))
         OR (fact_type = 'learning_evidence' AND fact_id = ANY($5::UUID[]))
         OR (fact_type = 'memory_outcome' AND fact_id = ANY($6::UUID[]))
       )
     FOR UPDATE
  `, [options.workspaceId, options.learnerUserId, actionIds, attemptIds, evidenceIds, outcomeIds]);
  const mutableSequences = stringSet(mutableRows.map((row) => requireString(row.mutable_change_sequence, "mutable feed sequence")));
  const factSequences = stringSet(factRows.map((row) => requireString(row.fact_sequence, "fact feed sequence")));
  const operationIds = [...new Set([
    ...mutableRows.map((row) => requireString(row.source_operation_id, "mutable source operation ID")),
    ...factRows.map((row) => requireString(row.source_operation_id, "fact source operation ID")),
  ])];
  const operationRows = operationIds.length === 0
    ? []
    : await queryRows<JsonObject>(client, `
        SELECT operation_id
          FROM sensa.sync_operations
         WHERE workspace_id = $1
           AND learner_user_id = $2
           AND operation_id = ANY($3::TEXT[])
         FOR UPDATE
      `, [options.workspaceId, options.learnerUserId, operationIds]);
  if (operationRows.length !== operationIds.length) {
    fail(`Active Plan replacement found a feed without its operation ledger row for ${oldPlanId}`);
  }
  if (operationIds.length > 0) {
    const allMutableRows = await queryRows<JsonObject>(client, `
      SELECT mutable_change_sequence::TEXT AS mutable_change_sequence,
             source_operation_id
        FROM sensa.sync_mutable_changes
       WHERE workspace_id = $1
         AND learner_user_id = $2
         AND source_operation_id = ANY($3::TEXT[])
       FOR UPDATE
    `, [options.workspaceId, options.learnerUserId, operationIds]);
    const allFactRows = await queryRows<JsonObject>(client, `
      SELECT fact_sequence::TEXT AS fact_sequence,
             source_operation_id
        FROM sensa.sync_append_facts
       WHERE workspace_id = $1
         AND learner_user_id = $2
         AND source_operation_id = ANY($3::TEXT[])
       FOR UPDATE
    `, [options.workspaceId, options.learnerUserId, operationIds]);
    for (const row of allMutableRows) {
      const sequence = requireString(row.mutable_change_sequence, "operation mutable feed sequence");
      if (!mutableSequences.has(sequence)) {
        fail(`Refusing to delete operation ${String(row.source_operation_id)}: it references a retained mutable entity`);
      }
    }
    for (const row of allFactRows) {
      const sequence = requireString(row.fact_sequence, "operation fact feed sequence");
      if (!factSequences.has(sequence)) {
        fail(`Refusing to delete operation ${String(row.source_operation_id)}: it references a retained fact`);
      }
    }
  }

  const deletedRuntime = await client.query(`
    DELETE FROM sensa.learning_sessions
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND study_plan_id = $3
  `, [options.workspaceId, options.learnerUserId, oldPlanId]);
  if (Number(deletedRuntime.rowCount ?? -1) !== sessionIds.length) {
    fail(`Active Plan replacement deleted ${String(deletedRuntime.rowCount)} sessions but captured ${sessionIds.length}`);
  }
  const deletedMutable = mutableRows.length === 0
    ? { rowCount: 0 }
    : await client.query(`
        DELETE FROM sensa.sync_mutable_changes
         WHERE workspace_id = $1
           AND learner_user_id = $2
           AND mutable_change_sequence = ANY($3::BIGINT[])
      `, [options.workspaceId, options.learnerUserId, [...mutableSequences]]);
  const deletedFacts = factRows.length === 0
    ? { rowCount: 0 }
    : await client.query(`
        DELETE FROM sensa.sync_append_facts
         WHERE workspace_id = $1
           AND learner_user_id = $2
           AND fact_sequence = ANY($3::BIGINT[])
      `, [options.workspaceId, options.learnerUserId, [...factSequences]]);
  const deletedOperations = operationIds.length === 0
    ? { rowCount: 0 }
    : await client.query(`
        DELETE FROM sensa.sync_operations
         WHERE workspace_id = $1
           AND learner_user_id = $2
           AND operation_id = ANY($3::TEXT[])
      `, [options.workspaceId, options.learnerUserId, operationIds]);
  if (Number(deletedMutable.rowCount ?? -1) !== mutableRows.length
    || Number(deletedFacts.rowCount ?? -1) !== factRows.length
    || Number(deletedOperations.rowCount ?? -1) !== operationIds.length) {
    fail(`Active Plan replacement did not delete the captured Sensa Sync rows for ${oldPlanId}`);
  }
  const remainingRuntime = await queryOne<JsonObject>(client, `
    SELECT
      (SELECT COUNT(*)::INTEGER FROM sensa.learning_sessions WHERE workspace_id = $1 AND learner_user_id = $2 AND study_plan_id = $3) AS session_count,
      (SELECT COUNT(*)::INTEGER FROM sensa.sense_encounters WHERE workspace_id = $1 AND learner_user_id = $2 AND study_plan_id = $3) AS encounter_count,
      (SELECT COUNT(*)::INTEGER
         FROM sensa.learning_actions AS actions
         JOIN sensa.sense_encounters AS encounters ON encounters.sense_encounter_id = actions.sense_encounter_id
        WHERE actions.workspace_id = $1 AND actions.learner_user_id = $2 AND encounters.study_plan_id = $3) AS action_count
  `, [options.workspaceId, options.learnerUserId, oldPlanId]);
  if (Number(remainingRuntime?.session_count ?? -1) !== 0
    || Number(remainingRuntime?.encounter_count ?? -1) !== 0
    || Number(remainingRuntime?.action_count ?? -1) !== 0) {
    fail(`Active Plan replacement left runtime rows behind for ${oldPlanId}`);
  }
  const replicas = await client.query(`
    UPDATE sensa.sync_replica_states
       SET bootstrap_required = TRUE
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND NOT bootstrap_required
  `, [options.workspaceId, options.learnerUserId]);
  await verifySyncOperationBounds(client, options);
  return {
    deletedSessionCount: sessionIds.length,
    deletedEncounterCount: encounterIds.length,
    deletedActionCount: actionIds.length,
    deletedAttemptCount: attemptIds.length,
    deletedEvidenceCount: evidenceIds.length,
    deletedOutcomeCount: outcomeIds.length,
    deletedMutableFeedCount: mutableRows.length,
    deletedFactFeedCount: factRows.length,
    deletedOperationCount: operationIds.length,
    rebootstrapReplicaCount: Number(replicas.rowCount ?? 0),
  };
}

async function ensurePlan(
  client: DatabaseClient,
  preflightValue: Preflight,
  planInspection: PlanInspection,
): Promise<Readonly<{
  archivedOldPlanId: string | null;
  deletedSessionCount: number;
  deletedEncounterCount: number;
  deletedActionCount: number;
}>> {
  const { options, ids } = preflightValue;
  let cleanupResult: EmptyPlanRuntimeCleanup = {
    deletedSessionCount: 0,
    deletedEncounterCount: 0,
    deletedActionCount: 0,
    deletedAttemptCount: 0,
    deletedEvidenceCount: 0,
    deletedOutcomeCount: 0,
    deletedMutableFeedCount: 0,
    deletedFactFeedCount: 0,
    deletedOperationCount: 0,
    rebootstrapReplicaCount: 0,
  };
  let archivedOldPlanId: string | null = null;
  if (planInspection.replaceEmptyActivePlan && planInspection.activePlanId !== null) {
    cleanupResult = await cleanupEmptyPlanRuntimeAndSync(client, options, planInspection);
    const archived = await client.query(`
      UPDATE sensa.study_plans
         SET status = 'archived'::sensa.study_plan_status,
             revision = revision + 1,
             updated_at = statement_timestamp(),
             archived_at = statement_timestamp()
       WHERE study_plan_id = $1
         AND status = 'active'
    `, [planInspection.activePlanId]);
    if (Number(archived.rowCount ?? -1) !== 1) {
      fail(`Active Plan ${planInspection.activePlanId} could not be archived during replacement`);
    }
    archivedOldPlanId = planInspection.activePlanId;
  }
  const existing = await queryOne<JsonObject>(client, `
    SELECT study_plan_id::TEXT AS study_plan_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           book_version_id::TEXT AS book_version_id,
           status::TEXT AS status,
           daily_new_sense_target,
           created_by_replica_id::TEXT AS created_by_replica_id
      FROM sensa.study_plans
     WHERE study_plan_id = $1
     FOR UPDATE
  `, [ids.planId]);
  if (existing === undefined) {
    await client.query(`
      INSERT INTO sensa.study_plans
        (study_plan_id, workspace_id, learner_user_id, book_version_id, status,
         daily_new_sense_target, revision, created_by_replica_id)
      VALUES ($1, $2, $3, $4, 'active', $5, 1, $6)
    `, [ids.planId, options.workspaceId, options.learnerUserId, ids.bookVersionId, options.dailyNewTarget, planInspection.replicaId]);
  } else {
    for (const [key, expected] of Object.entries({
      workspace_id: options.workspaceId,
      learner_user_id: options.learnerUserId,
      book_version_id: ids.bookVersionId,
      status: "active",
      daily_new_sense_target: options.dailyNewTarget,
      created_by_replica_id: planInspection.replicaId,
    })) {
      if (existing[key] !== expected && String(existing[key]) !== String(expected)) fail(`Existing Study Plan ${ids.planId} does not match the requested learner/book/target`);
    }
  }
  return {
    archivedOldPlanId,
    ...cleanupResult,
  };
}

async function publishContentRelease(client: DatabaseClient, preflightValue: Preflight): Promise<void> {
  const { ids } = preflightValue;
  const release = await queryOne<JsonObject>(client, `SELECT status::TEXT AS status FROM sensa.content_releases WHERE content_release_id = $1 FOR UPDATE`, [ids.releaseId]);
  if (release === undefined) fail("Content Release disappeared during import");
  if (release.status === "draft") {
    await client.query(`UPDATE sensa.content_releases SET status = 'approved'::sensa.content_release_status, approved_at = statement_timestamp() WHERE content_release_id = $1 AND status = 'draft'`, [ids.releaseId]);
    await client.query(`UPDATE sensa.content_releases SET status = 'published'::sensa.content_release_status, published_at = statement_timestamp() WHERE content_release_id = $1 AND status = 'approved'`, [ids.releaseId]);
  } else if (release.status !== "approved" && release.status !== "published" && release.status !== "superseded") {
    fail(`Content Release has unsupported status ${String(release.status)}`);
  } else if (release.status === "approved") {
    await client.query(`UPDATE sensa.content_releases SET status = 'published'::sensa.content_release_status, published_at = statement_timestamp() WHERE content_release_id = $1 AND status = 'approved'`, [ids.releaseId]);
  }
}

async function retireBookAndSupersedeRelease(client: DatabaseClient, preflightValue: Preflight): Promise<void> {
  const { ids } = preflightValue;
  const version = await queryOne<JsonObject>(client, `SELECT status::TEXT AS status FROM sensa.book_versions WHERE book_version_id = $1 FOR UPDATE`, [ids.bookVersionId]);
  if (version === undefined) fail("Book Version disappeared during import");
  if (version.status === "published") {
    await client.query(`UPDATE sensa.book_versions SET status = 'retired'::sensa.book_version_status, retired_at = statement_timestamp() WHERE book_version_id = $1 AND status = 'published'`, [ids.bookVersionId]);
  } else if (version.status !== "retired") {
    fail(`Book Version did not publish through the database gate (status=${String(version.status)})`);
  }
  const currentRelease = await queryOne<JsonObject>(client, `SELECT status::TEXT AS status FROM sensa.content_releases WHERE content_release_id = $1`, [ids.releaseId]);
  if (currentRelease?.status === "published") {
    await client.query(`UPDATE sensa.content_releases SET status = 'superseded'::sensa.content_release_status, superseded_at = statement_timestamp() WHERE content_release_id = $1 AND status = 'published'`, [ids.releaseId]);
  } else if (currentRelease?.status !== "superseded") {
    fail(`Content Release did not publish/supersede through the database gate (status=${String(currentRelease?.status)})`);
  }
}

async function verifyImportedContent(client: DatabaseClient, preflightValue: Preflight): Promise<void> {
  const { ids } = preflightValue;
  const summary = await queryOne<JsonObject>(client, `
    SELECT
      (SELECT COUNT(*)::INTEGER FROM sensa.content_releases WHERE content_release_id = $1) AS release_count,
      (SELECT COUNT(*)::INTEGER
         FROM sensa.book_version_senses AS members
         JOIN sensa.sense_versions AS versions ON versions.sense_version_id = members.sense_version_id
        WHERE members.book_version_id = $2
          AND versions.content_release_id = $1) AS sense_version_count,
      (SELECT COUNT(*)::INTEGER FROM sensa.book_version_senses WHERE book_version_id = $2) AS book_member_count,
      (SELECT COUNT(DISTINCT stable_senses.lexeme_id)::INTEGER
         FROM sensa.book_version_senses AS members
         JOIN sensa.sense_versions AS versions ON versions.sense_version_id = members.sense_version_id
         JOIN sensa.senses AS stable_senses ON stable_senses.sense_id = versions.sense_id
        WHERE members.book_version_id = $2) AS distinct_lexeme_count,
      (SELECT COUNT(*)::INTEGER
         FROM sensa.required_asset_manifests AS manifests
         JOIN sensa.book_version_senses AS members ON members.sense_version_id = manifests.sense_version_id
        WHERE manifests.content_release_id = $1
          AND members.book_version_id = $2
          AND manifests.status = 'satisfied'
          AND manifests.capability_resolver_version = 'sensa-executable-learning-capability-resolver-v1') AS satisfied_manifest_count,
      (SELECT COUNT(*)::INTEGER
         FROM sensa.manifest_requirements AS requirements
         JOIN sensa.required_asset_manifests AS manifests
           ON manifests.required_asset_manifest_id = requirements.required_asset_manifest_id
          AND manifests.content_release_id = requirements.content_release_id
         JOIN sensa.book_version_senses AS members ON members.sense_version_id = manifests.sense_version_id
        WHERE requirements.content_release_id = $1
          AND members.book_version_id = $2
          AND requirements.status = 'satisfied'
          AND requirements.satisfied_count >= requirements.required_count) AS satisfied_requirement_count,
      (SELECT COUNT(DISTINCT audio.media_blob_id)::INTEGER
         FROM sensa.audio_assets AS audio
         JOIN sensa.learning_assets AS assets ON assets.learning_asset_id = audio.learning_asset_id
        WHERE audio.content_release_id = $1 AND assets.content_release_id = $1) AS unique_media_count
  `, [ids.releaseId, ids.bookVersionId]);
  const expected = {
    release_count: 1,
    sense_version_count: expectedAcceptedPackageCount,
    book_member_count: expectedAcceptedPackageCount,
    distinct_lexeme_count: expectedAcceptedLexemeCount,
    satisfied_manifest_count: expectedAcceptedPackageCount,
    unique_media_count: preflightValue.media.size,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (Number(summary?.[key] ?? -1) !== value) fail(`Imported content verification failed for ${key}: expected ${value}, got ${String(summary?.[key])}`);
  }
  if (Number(summary?.satisfied_requirement_count ?? 0) <= 0) fail("Imported content has no satisfied manifest requirements");
  const packageRows = await queryRows<JsonObject>(client, `
      SELECT stable_senses.sense_key,
           manifests.package_digest,
           manifests.capability_resolver_version,
           manifests.status::TEXT AS status
      FROM sensa.sense_versions AS versions
      JOIN sensa.senses AS stable_senses
        ON stable_senses.sense_id = versions.sense_id
      JOIN sensa.book_version_senses AS members
        ON members.sense_version_id = versions.sense_version_id
       AND members.book_version_id = $2
      JOIN sensa.required_asset_manifests AS manifests
        ON manifests.sense_version_id = versions.sense_version_id
       AND manifests.content_release_id = versions.content_release_id
     WHERE versions.content_release_id = $1
  `, [ids.releaseId, ids.bookVersionId]);
  const expectedDigests = new Map(preflightValue.packages.map((item) => [
    `sensa.source.${preflightValue.release.contentReleaseId}.${item.candidate.senseVersion.senseId}`,
    item.validation.packageDigest,
  ]));
  if (packageRows.length !== expectedDigests.size) fail("Imported manifest count does not match accepted package count");
  for (const row of packageRows) {
    const senseKey = requireString(row.sense_key, "Imported manifest Sense key");
    if (row.status !== "satisfied"
      || row.capability_resolver_version !== sensaExecutableLearningCapabilityResolverVersion
      || expectedDigests.get(senseKey) !== row.package_digest) fail(`Imported manifest digest/status/version mismatch for Sense ${senseKey}`);
  }
}

async function runDatabaseImport(preflightValue: Preflight): Promise<ImportExecutionResult> {
  const { options } = preflightValue;
  const pool = new Pool({ connectionString: options.databaseUrl, max: 1 });
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`sensa-first-user:${options.runKey}:${options.workspaceId}:${options.learnerUserId}`]);
    await ensureWorkspaceMembership(client, options);
    const replicaId = await resolveReplica(client, options);
    const planInspection = await inspectPlan(client, preflightValue, replicaId);
    await ensureRelease(client, preflightValue);
    const releaseRow = await queryOne<JsonObject>(client, `SELECT status::TEXT AS status FROM sensa.content_releases WHERE content_release_id = $1`, [preflightValue.ids.releaseId]);
    if (releaseRow?.status !== "published" && releaseRow?.status !== "superseded") {
      const lexemeIds = await ensureLexemeIdentities(client, preflightValue);
      const senseIds = await ensureSenseIdentities(client, preflightValue, lexemeIds);
      const lexemeVersionIds = await ensureLexemeVersions(client, preflightValue, lexemeIds);
      const relationOnlyLexemeVersionIds = await ensureRelationOnlyLexemeVersions(client, preflightValue, lexemeIds);
      const relationSenseLexemeVersionIds = new Map(relationOnlyLexemeVersionIds);
      for (const loaded of preflightValue.packages) {
        const mappedLexemeVersionId = lexemeVersionIds.get(loaded.candidate.lexemeVersion.lexemeVersionId);
        if (mappedLexemeVersionId === undefined) {
          fail(`${loaded.packageId}: accepted Lexeme Version was not mapped for relation integrity`);
        }
        relationSenseLexemeVersionIds.set(loaded.candidate.lexemeVersion.lexemeId, mappedLexemeVersionId);
      }
      const senseVersionIds = await ensureSenseVersions(client, preflightValue, senseIds);
      await ensureRelationOnlySenseVersions(client, preflightValue, senseIds, relationSenseLexemeVersionIds);
      const relationIds = await ensureRelations(client, preflightValue, lexemeIds, senseIds);
      const usageIds = await ensureProfileAndUsage(client, preflightValue, senseVersionIds, relationIds);
      await ensureAssets(client, preflightValue, senseVersionIds, lexemeVersionIds, relationIds);
      const assetIds = new Map<string, string>();
      for (const loaded of preflightValue.packages) {
        for (const asset of loaded.candidate.assets) assetIds.set(asset.learningAssetId, preflightValue.ids.mapSourceId("learning-asset", asset.learningAssetId));
      }
      await ensureManifests(client, preflightValue, senseVersionIds, relationIds, usageIds, assetIds);
      await ensureRelationOnlyProfilesAndManifests(client, preflightValue);
    }
    await publishContentRelease(client, preflightValue);
    const senseVersionIds = new Map(preflightValue.packages.map((item) => [item.candidate.senseVersion.senseVersionId, preflightValue.ids.mapSourceId("sense-version", item.candidate.senseVersion.senseVersionId)]));
    await ensureBook(client, preflightValue, senseVersionIds);
    const replacement = await ensurePlan(client, preflightValue, planInspection);
    await retireBookAndSupersedeRelease(client, preflightValue);
    await verifyImportedContent(client, preflightValue);
    await client.query("COMMIT");
    transactionStarted = false;
    return {
      planInspection,
      replacedOldPlan: planInspection.replaceEmptyActivePlan,
      replacement,
    };
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function inspectDryRun(preflightValue: Preflight): Promise<Readonly<{ planInspection: PlanInspection }>> {
  const pool = new Pool({ connectionString: preflightValue.options.databaseUrl, max: 1 });
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await ensureWorkspaceMembership(client, preflightValue.options);
    const replicaId = await resolveReplica(client, preflightValue.options);
    const planInspection = await inspectPlan(client, preflightValue, replicaId);
    await client.query("ROLLBACK");
    transactionStarted = false;
    return { planInspection };
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function emptyReplacementResult(): ReplacementResult {
  return {
    archivedOldPlanId: null,
    deletedSessionCount: 0,
    deletedEncounterCount: 0,
    deletedActionCount: 0,
    deletedAttemptCount: 0,
    deletedEvidenceCount: 0,
    deletedOutcomeCount: 0,
    deletedMutableFeedCount: 0,
    deletedFactFeedCount: 0,
    deletedOperationCount: 0,
    rebootstrapReplicaCount: 0,
  };
}

function printSummary(
  preflightValue: Preflight,
  result: ImportExecutionResult,
): void {
  const { ids, options } = preflightValue;
  const rejectedByStatus = new Map<string, number>();
  for (const rejected of preflightValue.rejectedPackages) {
    rejectedByStatus.set(rejected.status, (rejectedByStatus.get(rejected.status) ?? 0) + 1);
  }
  const plannedReplacement = result.planInspection.replacePlanCleanup;
  console.log(JSON.stringify({
    command: "sensa-first-user-import",
    dryRun: options.dryRun,
    runKey: options.runKey,
    sourceRoot: options.sourceRoot,
    sourceReport: {
      path: path.join(options.sourceRoot, "reports", "release-validation.json"),
      checkedAt: preflightValue.reportCheckedAt,
      digest: preflightValue.reportDigest,
    },
    reportCandidates: {
      packages: preflightValue.reportCandidateCount,
      distinctLexemes: preflightValue.reportCandidateLexemeCount,
      uniqueMediaReferences: preflightValue.reportCandidateMediaCount,
    },
    accepted: {
      packages: preflightValue.packages.length,
      senses: preflightValue.packages.length,
      lexemes: expectedAcceptedLexemeCount,
      media: preflightValue.media.size,
      assets: preflightValue.packageCounts,
      relations: preflightValue.sourceIdentities.relations.size,
    },
    rejectedByFrozenValidator: {
      count: preflightValue.rejectedPackages.length,
      byStatus: Object.fromEntries([...rejectedByStatus.entries()].sort(([left], [right]) => left.localeCompare(right))),
      packages: preflightValue.rejectedPackages,
    },
    deterministicIds: {
      releaseId: ids.releaseId,
      bookId: ids.bookId,
      bookVersionId: ids.bookVersionId,
      studyPlanId: ids.planId,
    },
    releaseId: ids.releaseId,
    releaseKey: ids.releaseKey,
    bookId: ids.bookId,
    bookVersionId: ids.bookVersionId,
    studyPlanId: ids.planId,
    workspaceId: options.workspaceId,
    learnerUserId: options.learnerUserId,
    replicaId: result.planInspection.replicaId,
    replaceActivePlanRequested: options.replaceActivePlan,
    replacedOldEmptyPlan: result.replacedOldPlan,
    replacement: {
      oldPlanId: result.replacement.archivedOldPlanId
        ?? (result.replacedOldPlan ? result.planInspection.activePlanId : null),
      plannedDeletion: {
        sessions: plannedReplacement?.sessionCount ?? 0,
        encounters: plannedReplacement?.encounterCount ?? 0,
        actions: plannedReplacement?.actionCount ?? 0,
      },
      archivedOldPlanId: result.replacement.archivedOldPlanId,
      deleted: {
        sessions: result.replacement.deletedSessionCount,
        encounters: result.replacement.deletedEncounterCount,
        actions: result.replacement.deletedActionCount,
        attempts: result.replacement.deletedAttemptCount,
        evidence: result.replacement.deletedEvidenceCount,
        outcomes: result.replacement.deletedOutcomeCount,
        mutableFeedRows: result.replacement.deletedMutableFeedCount,
        factFeedRows: result.replacement.deletedFactFeedCount,
        operations: result.replacement.deletedOperationCount,
      },
      rebootstrapReplicaCount: result.replacement.rebootstrapReplicaCount,
    },
    oldActivePlanId: result.planInspection.activePlanId,
    publicBookExpected: "hidden (retired Book Version + superseded Content Release)",
    packageValidatorVersion: sensaPackageValidatorVersion,
  }, null, 2));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const preflightValue = await preflight(options);
  let result: ImportExecutionResult;
  if (options.dryRun) {
    const { planInspection } = await inspectDryRun(preflightValue);
    result = {
      planInspection,
      replacedOldPlan: planInspection.replaceEmptyActivePlan,
      replacement: emptyReplacementResult(),
    };
  } else {
    result = await runDatabaseImport(preflightValue);
  }
  printSummary(preflightValue, result);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
