import {
  canonicalConsumerJson,
  maxPortableBookArchiveBytes,
  maxPortableBookManifestBytes,
  maxPortableBookMembers,
  sensaPortableBookManifestSchema,
  type SensaPortableBookManifest,
  type SensaPortableBookMember,
} from "@sensa/contracts/sensa";
import {sha256} from "@sensa/learning-kernel";
import {strToU8, unzipSync, zipSync, type Zippable} from "fflate";

import {
  readSensaPortableLightweightPackage,
  type SensaPortableLightweightPackageArchive,
} from "./portableLightweightPackageValidator.js";

export const sensaPortableBookValidatorVersion = "sensa-portable-book-validator-v1" as const;
export const sensaPortableBookMaximumEntries = maxPortableBookMembers + 1;

const manifestPath = "book.json";
const fixedZipTimestamp = new Date(1980, 0, 1, 0, 0, 0);
const memberPathPattern = /^packages\/([0-9a-f-]{36})\/([1-9][0-9]*)\.sensa$/u;

export const portableBookMemberKey = (member: SensaPortableBookMember): string =>
  `${member.packageId}:${member.version}`;

export const portableBookMemberPath = (member: SensaPortableBookMember): string =>
  `packages/${member.packageId}/${member.version}.sensa`;

export type SensaPortableBookPackageMember = Readonly<{
  member: SensaPortableBookMember;
  bytes: Uint8Array;
  archive: SensaPortableLightweightPackageArchive;
}>;

export type SensaPortableBookPackage = Readonly<{
  archiveDigest: string;
  manifest: SensaPortableBookManifest;
  members: readonly SensaPortableBookPackageMember[];
}>;

const fail = (message: string, cause?: unknown): never => {
  throw new Error(`Portable Book is invalid: ${message}`, cause === undefined ? undefined : {cause});
};

/** Opens a `.sensa-book` and validates its complete, closed set of `.sensa` members. */
export function readSensaPortableBook(archiveBytes: Uint8Array): SensaPortableBookPackage {
  if (archiveBytes.byteLength > maxPortableBookArchiveBytes) fail("archive size exceeds the Book limit");

  let entryCount = 0;
  let expandedBytes = 0;
  const seen = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archiveBytes, {
      filter: (entry) => {
        if (entry.name === "packages/") return false;
        entryCount += 1;
        if (entryCount > sensaPortableBookMaximumEntries) fail("archive entry count exceeds the Book limit");
        if (seen.has(entry.name)) fail(`duplicate archive entry: ${entry.name}`);
        seen.add(entry.name);
        if (entry.name !== manifestPath && !memberPathPattern.test(entry.name)) {
          fail(`unexpected archive entry: ${entry.name}`);
        }
        if (entry.name === manifestPath && entry.originalSize > maxPortableBookManifestBytes) {
          fail("book.json exceeds the manifest limit");
        }
        expandedBytes += entry.originalSize;
        if (expandedBytes > maxPortableBookArchiveBytes + maxPortableBookManifestBytes) {
          fail("expanded archive exceeds the Book limit");
        }
        return true;
      },
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("Portable Book is invalid:")) throw cause;
    return fail("unable to read ZIP archive", cause);
  }

  const manifestBytes = files[manifestPath];
  if (manifestBytes === undefined) fail("book.json is missing");
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(manifestBytes));
  } catch (cause) {
    return fail("book.json is not valid UTF-8 JSON", cause);
  }
  const parsed = sensaPortableBookManifestSchema.safeParse(document);
  if (!parsed.success) return fail(`book.json does not satisfy the contract: ${parsed.error.message}`);
  const manifest = parsed.data;
  const expectedPaths = new Set(manifest.members.map(portableBookMemberPath));
  const actualPaths = Object.keys(files).filter((path) => path !== manifestPath);
  if (actualPaths.length !== expectedPaths.size
    || actualPaths.some((path) => !expectedPaths.has(path))) {
    fail("archive members do not exactly match book.json");
  }

  const members = manifest.members.map((member) => {
    const path = portableBookMemberPath(member);
    const bytes = files[path];
    if (bytes === undefined) return fail(`member is missing: ${path}`);
    let archive: SensaPortableLightweightPackageArchive;
    try {
      archive = readSensaPortableLightweightPackage(bytes);
    } catch (cause) {
      return fail(`member is invalid: ${path}`, cause);
    }
    if (archive.package.metadata.packageId !== member.packageId
      || archive.package.metadata.version !== member.version
      || archive.package.route.targetLanguage !== manifest.route.targetLanguage
      || archive.package.route.supportLanguage !== manifest.route.supportLanguage
      || archive.package.semanticDeclaration === undefined) {
      fail(`member identity, route or semantic declaration does not match: ${path}`);
    }
    return Object.freeze({member, bytes, archive});
  });

  return Object.freeze({
    archiveDigest: sha256(archiveBytes),
    manifest,
    members: Object.freeze(members),
  });
}

/** Creates a deterministic `.sensa-book` without changing its atomic `.sensa` members. */
export function createSensaPortableBook(
  rawManifest: unknown,
  memberBytes: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const manifest = sensaPortableBookManifestSchema.parse(rawManifest);
  const expectedKeys = new Set(manifest.members.map(portableBookMemberKey));
  for (const key of memberBytes.keys()) {
    if (!expectedKeys.has(key)) fail(`undeclared member: ${key}`);
  }
  const entries: Zippable = {
    [manifestPath]: [strToU8(canonicalConsumerJson(manifest)), {level: 6, mtime: fixedZipTimestamp}],
  };
  for (const member of manifest.members) {
    const bytes = memberBytes.get(portableBookMemberKey(member));
    if (bytes === undefined) {
      fail(`member bytes are missing: ${portableBookMemberKey(member)}`);
    }
    entries[portableBookMemberPath(member)] = [bytes!, {level: 0, mtime: fixedZipTimestamp}];
  }
  const archive = zipSync(entries, {mtime: fixedZipTimestamp});
  readSensaPortableBook(archive);
  return archive;
}
