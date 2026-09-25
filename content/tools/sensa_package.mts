#!/usr/bin/env node
import {readFile, stat, writeFile} from "node:fs/promises";
import {extname, join, resolve} from "node:path";

import {
  createSensaPortableLightweightPackage,
  sensaPortableLightweightPackageMaximumArchiveBytes,
  validateSensaPortableLightweightPackage,
} from "@sensa/content-validator/portable-lightweight";
import {sensaPortableLightweightPackageSchema} from "@sensa/contracts/sensa";

function usage(): never {
  throw new Error([
    "Usage:",
    "  sensa:package pack AUTHORING_DIRECTORY OUTPUT.sensa",
    "  sensa:package validate PACKAGE.sensa",
    "  sensa:package inspect PACKAGE.sensa",
    "",
    "AUTHORING_DIRECTORY must contain package.json and media/<sha256> files.",
  ].join("\n"));
}

function requireSensaExtension(path: string): void {
  if (extname(path) !== ".sensa") {
    throw new Error("Portable learning packages must use the .sensa extension.");
  }
}

const command = process.argv[2];
if (command === "pack") {
  const input = process.argv[3];
  const output = process.argv[4];
  if (input === undefined || output === undefined || process.argv[5] !== undefined) usage();
  const authoringDirectory = resolve(input);
  const outputPath = resolve(output);
  requireSensaExtension(outputPath);

  const manifestPath = join(authoringDirectory, "package.json");
  const manifest = sensaPortableLightweightPackageSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const mediaById = new Map<string, Uint8Array>();
  for (const media of manifest.media) {
    mediaById.set(media.mediaId, await readFile(join(authoringDirectory, "media", media.sha256)));
  }
  const archive = createSensaPortableLightweightPackage(manifest, mediaById);
  await writeFile(outputPath, archive);
  const result = validateSensaPortableLightweightPackage(archive);
  console.log(`PACKED ${outputPath} ${result.archiveDigest} ${archive.byteLength} bytes`);
  process.exit(0);
}

if (command !== "validate" && command !== "inspect") usage();
const input = process.argv[3];
if (input === undefined || process.argv[4] !== undefined) usage();

const path = resolve(input);
requireSensaExtension(path);
const file = await stat(path);
if (!file.isFile()) throw new Error("Package path is not a file.");
if (file.size > sensaPortableLightweightPackageMaximumArchiveBytes) {
  throw new Error(`.sensa archive exceeds ${sensaPortableLightweightPackageMaximumArchiveBytes} bytes.`);
}

const result = validateSensaPortableLightweightPackage(await readFile(path));
if (result.status !== "satisfied" || result.package === null) {
  for (const issue of result.issues) {
    console.error(`${issue.code}\t${issue.path}\t${issue.message}`);
  }
  process.exitCode = 1;
} else if (command === "validate") {
  console.log(
    `PASS ${result.archiveDigest} ${result.packageDigest} ${result.mediaBytes} media bytes`,
  );
} else {
  console.log(JSON.stringify({
    format: result.package.format,
    packageId: result.package.metadata.packageId,
    version: result.package.metadata.version,
    title: result.package.metadata.title,
    author: result.package.metadata.author,
    license: result.package.metadata.license,
    route: result.package.route,
    senseId: result.package.sense.senseId,
    targetExpression: result.package.targetExpression.text,
    mediaCount: result.package.media.length,
    mediaBytes: result.mediaBytes,
    archiveDigest: result.archiveDigest,
    packageDigest: result.packageDigest,
  }, null, 2));
}
