import {
  canonicalConsumerJson,
  sensaPortableLightweightPackageSchema,
  type SensaPortableLightweightMedia,
  type SensaPortableLightweightPackage,
} from "@sensa/contracts/sensa";
import {sha256} from "@sensa/learning-kernel";
import {strToU8, unzipSync, zipSync, type Zippable} from "fflate";

export const sensaPortableLightweightPackageValidatorVersion =
  "sensa-portable-lightweight-package-validator-v2" as const;
export const sensaPortableLightweightPackageMaximumArchiveBytes = 64 * 1024 * 1024;
export const sensaPortableLightweightPackageMaximumMediaBytes = 50 * 1024 * 1024;
export const sensaPortableLightweightPackageMaximumManifestBytes = 1024 * 1024;
export const sensaPortableLightweightPackageMaximumEntries = 65;

const manifestPath = "package.json";
const mediaPathPattern = /^media\/[0-9a-f]{64}$/u;
const fixedZipTimestamp = new Date(1980, 0, 1, 0, 0, 0);

export type SensaPortableLightweightPackageValidationIssue = Readonly<{
  code: string;
  path: string;
  message: string;
}>;

export type SensaPortableLightweightPackageValidationResult = Readonly<{
  status: "invalid" | "satisfied";
  validatorVersion: typeof sensaPortableLightweightPackageValidatorVersion;
  archiveDigest: string;
  packageDigest: string | null;
  mediaBytes: number;
  package: SensaPortableLightweightPackage | null;
  issues: readonly SensaPortableLightweightPackageValidationIssue[];
}>;

class Issues {
  readonly #values: SensaPortableLightweightPackageValidationIssue[] = [];

  add(code: string, path: string, message: string): void {
    if (!this.#values.some((issue) =>
      issue.code === code && issue.path === path && issue.message === message)) {
      this.#values.push({code, path, message});
    }
  }

  result(): readonly SensaPortableLightweightPackageValidationIssue[] {
    return [...this.#values].sort((left, right) =>
      left.code.localeCompare(right.code)
      || left.path.localeCompare(right.path)
      || left.message.localeCompare(right.message));
  }
}

function digest(bytes: Uint8Array): string {
  return sha256(bytes);
}

function invalidResult(
  archiveDigest: string,
  issues: Issues,
): SensaPortableLightweightPackageValidationResult {
  return {
    status: "invalid",
    validatorVersion: sensaPortableLightweightPackageValidatorVersion,
    archiveDigest,
    packageDigest: null,
    mediaBytes: 0,
    package: null,
    issues: issues.result(),
  };
}

function mediaReference(
  issues: Issues,
  mediaById: ReadonlyMap<string, SensaPortableLightweightMedia>,
  referencedMediaIds: Set<string>,
  mediaId: string,
  expectedKind: SensaPortableLightweightMedia["kind"],
  path: string,
): void {
  referencedMediaIds.add(mediaId);
  const media = mediaById.get(mediaId);
  if (media === undefined) {
    issues.add("reference.media_missing", path, `Unknown mediaId: ${mediaId}`);
  } else if (media.kind !== expectedKind) {
    issues.add(
      "reference.media_kind_mismatch",
      path,
      `Expected ${expectedKind} media, got ${media.kind}.`,
    );
  }
}

function validateManifest(
  value: SensaPortableLightweightPackage,
  files: Readonly<Record<string, Uint8Array>>,
  issues: Issues,
): number {
  const mediaById = new Map<string, SensaPortableLightweightMedia>();
  const referencedMediaIds = new Set<string>();
  const declaredPaths = new Set<string>();
  const countedPaths = new Set<string>();
  let mediaBytes = 0;

  value.media.forEach((media, index) => {
    const path = `media.${index}`;
    if (mediaById.has(media.mediaId)) {
      issues.add("identity.media_duplicate", `${path}.mediaId`, `Duplicate mediaId: ${media.mediaId}`);
    } else {
      mediaById.set(media.mediaId, media);
    }

    const expectedPrefix = media.kind === "audio" ? "audio/" : "image/";
    if (!media.mimeType.toLowerCase().startsWith(expectedPrefix)) {
      issues.add(
        "media.mime_kind_mismatch",
        `${path}.mimeType`,
        `Media kind ${media.kind} requires a ${expectedPrefix} MIME type.`,
      );
    }

    const archivePath = `media/${media.sha256}`;
    declaredPaths.add(archivePath);
    const bytes = files[archivePath];
    if (bytes === undefined) {
      issues.add("media.file_missing", `${path}.sha256`, `Archive entry is missing: ${archivePath}`);
      return;
    }
    if (bytes.byteLength === 0) {
      issues.add("media.empty", `${path}.sizeBytes`, "Media file must not be empty.");
    }
    if (bytes.byteLength !== media.sizeBytes) {
      issues.add(
        "media.size_mismatch",
        `${path}.sizeBytes`,
        `Declared ${media.sizeBytes} bytes but archive entry has ${bytes.byteLength}.`,
      );
    }
    if (digest(bytes) !== media.sha256) {
      issues.add("media.digest_mismatch", `${path}.sha256`, "SHA-256 does not match the media bytes.");
    }
    if (!countedPaths.has(archivePath)) {
      countedPaths.add(archivePath);
      mediaBytes += bytes.byteLength;
    }
  });

  for (const path of Object.keys(files)) {
    if (path !== manifestPath && !declaredPaths.has(path)) {
      issues.add("archive.entry_undeclared", path, "Archive contains a file not declared by package.json.");
    }
  }
  if (mediaBytes > sensaPortableLightweightPackageMaximumMediaBytes) {
    issues.add(
      "media.total_size_exceeded",
      "media",
      `Media exceeds ${sensaPortableLightweightPackageMaximumMediaBytes} expanded bytes.`,
    );
  }

  value.resources.experienceRecallCue.images?.forEach((image, index) => {
    mediaReference(
      issues,
      mediaById,
      referencedMediaIds,
      image.mediaId,
      "image",
      `resources.experienceRecallCue.images.${index}.mediaId`,
    );
  });
  mediaReference(
    issues,
    mediaById,
    referencedMediaIds,
    value.resources.pronunciation.audioMediaId,
    "audio",
    "resources.pronunciation.audioMediaId",
  );
  if (value.resources.sceneRealization.audioMediaId !== undefined) {
    mediaReference(
      issues,
      mediaById,
      referencedMediaIds,
      value.resources.sceneRealization.audioMediaId,
      "audio",
      "resources.sceneRealization.audioMediaId",
    );
  }
  value.resources.optional.usageGuidance?.forEach((guidance, index) => {
    if (guidance.audioMediaId !== undefined) {
      mediaReference(
        issues,
        mediaById,
        referencedMediaIds,
        guidance.audioMediaId,
        "audio",
        `resources.optional.usageGuidance.${index}.audioMediaId`,
      );
    }
  });
  value.media.forEach((media, index) => {
    if (!referencedMediaIds.has(media.mediaId)) {
      issues.add(
        "media.unused",
        `media.${index}.mediaId`,
        `Media is declared but no learning resource references it: ${media.mediaId}`,
      );
    }
  });

  const expectedSurface = value.targetExpression.spokenForm ?? value.targetExpression.text;
  if (value.resources.pronunciation.surface !== expectedSurface) {
    issues.add(
      "binding.pronunciation_surface_mismatch",
      "resources.pronunciation.surface",
      "Pronunciation surface must match targetExpression.spokenForm or targetExpression.text.",
    );
  }
  const realization = value.resources.sceneRealization;
  if (
    realization.targetStart >= realization.targetEnd
    || realization.targetEnd > realization.example.length
    || realization.example.slice(realization.targetStart, realization.targetEnd).trim().length === 0
  ) {
    issues.add(
      "binding.scene_target_span_invalid",
      "resources.sceneRealization",
      "Scene target span must select non-empty text inside the example.",
    );
  }

  if (value.semanticDeclaration !== undefined) {
    const declaredType = value.semanticDeclaration.expression.expressionType;
    const expectedType = value.targetExpression.expressionKind === "utterance"
      ? "utterance_strategy"
      : value.targetExpression.expressionKind;
    if (expectedType === "unspecified" || declaredType !== expectedType) {
      issues.add(
        "semantic.expression_type_mismatch",
        "semanticDeclaration.expression.expressionType",
        "Semantic expressionType must match the target expression kind.",
      );
    }
  }

  return mediaBytes;
}

/**
 * Public admission validator for a portable `.sensa` archive.
 *
 * It checks only whether the package is safe and complete enough for the
 * Lightweight runtime. Editorial rules used by Sensa Official production,
 * including pre-reveal non-disclosure, deliberately do not belong here.
 */
export function validateSensaPortableLightweightPackage(
  archive: Uint8Array,
): SensaPortableLightweightPackageValidationResult {
  const issues = new Issues();
  const archiveDigest = digest(archive);
  if (archive.byteLength > sensaPortableLightweightPackageMaximumArchiveBytes) {
    issues.add(
      "archive.size_exceeded",
      "$",
      `Archive exceeds ${sensaPortableLightweightPackageMaximumArchiveBytes} bytes.`,
    );
    return invalidResult(archiveDigest, issues);
  }

  const seenPaths = new Set<string>();
  let entryCount = 0;
  let expandedBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive, {
      filter: (entry) => {
        if (entry.name === "media/") return false;
        entryCount += 1;
        if (entryCount > sensaPortableLightweightPackageMaximumEntries) {
          issues.add(
            "archive.entry_count_exceeded",
            "$",
            `Archive exceeds ${sensaPortableLightweightPackageMaximumEntries} entries.`,
          );
          return false;
        }
        if (seenPaths.has(entry.name)) {
          issues.add("archive.entry_duplicate", entry.name, "Archive entry path is duplicated.");
          return false;
        }
        seenPaths.add(entry.name);
        if (entry.name !== manifestPath && !mediaPathPattern.test(entry.name)) {
          issues.add("archive.path_invalid", entry.name, "Only package.json and media/<sha256> are allowed.");
          return false;
        }
        if (entry.name === manifestPath && entry.originalSize > sensaPortableLightweightPackageMaximumManifestBytes) {
          issues.add(
            "manifest.size_exceeded",
            manifestPath,
            `package.json exceeds ${sensaPortableLightweightPackageMaximumManifestBytes} bytes.`,
          );
          return false;
        }
        expandedBytes += entry.originalSize;
        if (expandedBytes > sensaPortableLightweightPackageMaximumManifestBytes
          + sensaPortableLightweightPackageMaximumMediaBytes) {
          issues.add("archive.expanded_size_exceeded", "$", "Expanded archive exceeds the package limit.");
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    issues.add(
      "archive.invalid_zip",
      "$",
      error instanceof Error ? error.message : "Unable to read ZIP archive.",
    );
    return invalidResult(archiveDigest, issues);
  }

  if (issues.result().length > 0) return invalidResult(archiveDigest, issues);
  const manifestBytes = files[manifestPath];
  if (manifestBytes === undefined) {
    issues.add("manifest.missing", manifestPath, "Archive must contain package.json.");
    return invalidResult(archiveDigest, issues);
  }

  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(manifestBytes));
  } catch (error) {
    issues.add(
      "manifest.invalid_json",
      manifestPath,
      error instanceof Error ? error.message : "package.json is not valid UTF-8 JSON.",
    );
    return invalidResult(archiveDigest, issues);
  }

  const parsed = sensaPortableLightweightPackageSchema.safeParse(document);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.add(
        "schema.invalid",
        issue.path.length > 0 ? issue.path.join(".") : "$",
        issue.message,
      );
    }
    return invalidResult(archiveDigest, issues);
  }

  const value = parsed.data;
  const mediaBytes = validateManifest(value, files, issues);
  const finalIssues = issues.result();
  return {
    status: finalIssues.length === 0 ? "satisfied" : "invalid",
    validatorVersion: sensaPortableLightweightPackageValidatorVersion,
    archiveDigest,
    packageDigest: digest(strToU8(canonicalConsumerJson(value))),
    mediaBytes,
    package: value,
    issues: finalIssues,
  };
}

export type SensaPortableLightweightPackageArchive = Readonly<{
  archiveDigest: string;
  packageDigest: string;
  package: SensaPortableLightweightPackage;
  mediaById: ReadonlyMap<string, Uint8Array>;
}>;

/** Opens a validated archive without exposing ZIP paths to callers. */
export function readSensaPortableLightweightPackage(
  archive: Uint8Array,
): SensaPortableLightweightPackageArchive {
  const validation = validateSensaPortableLightweightPackage(archive);
  if (
    validation.status !== "satisfied"
    || validation.package === null
    || validation.packageDigest === null
  ) {
    const details = validation.issues.map((issue) => `${issue.code}:${issue.path}`).join(", ");
    throw new Error(`Portable package is invalid: ${details}`);
  }
  const files = unzipSync(archive);
  const mediaById = new Map(validation.package.media.map((media) => [
    media.mediaId,
    files[`media/${media.sha256}`]!,
  ]));
  return Object.freeze({
    archiveDigest: validation.archiveDigest,
    packageDigest: validation.packageDigest,
    package: validation.package,
    mediaById,
  });
}

/** Creates a deterministic `.sensa` archive from a public manifest and media bytes. */
export function createSensaPortableLightweightPackage(
  manifest: unknown,
  mediaById: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const value = sensaPortableLightweightPackageSchema.parse(manifest);
  const expectedIds = new Set(value.media.map((media) => media.mediaId));
  for (const mediaId of mediaById.keys()) {
    if (!expectedIds.has(mediaId)) throw new Error(`Undeclared mediaId: ${mediaId}`);
  }

  const entries: Zippable = {
    [manifestPath]: [strToU8(canonicalConsumerJson(value)), {level: 6, mtime: fixedZipTimestamp}],
  };
  for (const media of value.media) {
    const bytes = mediaById.get(media.mediaId);
    if (bytes === undefined) throw new Error(`Missing media bytes for mediaId: ${media.mediaId}`);
    if (bytes.byteLength !== media.sizeBytes) {
      throw new Error(`Media size mismatch for mediaId: ${media.mediaId}`);
    }
    if (digest(bytes) !== media.sha256) {
      throw new Error(`Media digest mismatch for mediaId: ${media.mediaId}`);
    }
    const path = `media/${media.sha256}`;
    if (entries[path] === undefined) {
      entries[path] = [bytes, {level: 0, mtime: fixedZipTimestamp}];
    }
  }

  const archive = zipSync(entries, {mtime: fixedZipTimestamp});
  const validation = validateSensaPortableLightweightPackage(archive);
  if (validation.status !== "satisfied") {
    const details = validation.issues.map((issue) => `${issue.code}:${issue.path}`).join(", ");
    throw new Error(`Portable package is invalid: ${details}`);
  }
  return archive;
}
