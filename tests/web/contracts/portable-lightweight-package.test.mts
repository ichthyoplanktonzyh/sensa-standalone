import assert from "node:assert/strict";
import {createHash} from "node:crypto";

import {strToU8, zipSync, type Zippable} from "fflate";
import {test} from "vitest";

import {
  createSensaPortableLightweightPackage,
  readSensaPortableLightweightPackage,
  validateSensaPortableLightweightPackage,
} from "@sensa/content-validator/portable-lightweight";
import type {SensaPortableLightweightPackage} from "@sensa/contracts/sensa";

const audioBytes = Buffer.from("ID3sensa-portable-audio-fixture", "utf8");
const audioDigest = createHash("sha256").update(audioBytes).digest("hex");
const zipTimestamp = new Date(1980, 0, 1, 0, 0, 0);

function validManifest(): SensaPortableLightweightPackage {
  return {
    format: "sensa-portable-lightweight-package-v2",
    metadata: {
      packageId: "82415cab-85fe-4e1d-936e-7d2b4ff83cb7",
      version: 1,
      title: "Water in English",
      description: "A portable Lightweight package fixture.",
      createdAt: "2026-09-25T00:00:00Z",
      author: {name: "Fixture Author"},
      license: {name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/"},
    },
    route: {targetLanguage: "en", supportLanguage: "zh-CN"},
    sense: {senseId: "fixture:water-drinking", meaning: "日常饮用的水"},
    targetExpression: {text: "water", expressionKind: "word"},
    resources: {
      // Deliberate disclosure: public admission must not enforce Sensa Official's authoring policy.
      experienceRecallCue: {text: "看到 water 时，想象运动后喝下一杯清水。", senseFocus: "饮用水"},
      senseConfirmation: {text: "这里说的是日常饮用的水。"},
      pronunciation: {
        surface: "water",
        audioMediaId: "water-pronunciation",
        method: "recording",
        source: "Fixture recording",
      },
      sceneBridge: {text: "杯中的液体正是句子里请求的东西。"},
      sceneRealization: {
        example: "Could I have a glass of water, please?",
        translation: "请给我一杯水，好吗？",
        targetStart: 24,
        targetEnd: 29,
      },
      optional: {},
    },
    media: [{
      mediaId: "water-pronunciation",
      kind: "audio",
      mimeType: "audio/mpeg",
      sha256: audioDigest,
      sizeBytes: audioBytes.byteLength,
    }],
  };
}

function semanticDeclaration(): NonNullable<
  SensaPortableLightweightPackage["semanticDeclaration"]
> {
  return {
    contractVersion: "sensa-portable-semantic-declaration-v1",
    sense: {
      senseId: "e2a2e33e-c0f0-4554-a3e1-1b09311e1d90",
      senseVersionId: "b3e9d456-1a87-4d84-ac10-c9fd0dbc822a",
      senseKey: "water-drinking",
      versionNumber: 1,
      semanticPolicyVersion: "fixture-editorial-v1",
      semanticSpec: {
        schemaVersion: "sensa-sense-semantic-spec-v1",
        coreMeaningFocus: "Water considered as something people drink.",
        prototypeScenes: [{
          summary: "A person drinks water after exercise.",
          participantRoles: ["drinker", "water"],
          states: ["thirsty", "drinking"],
          directionOrCausality: "Drinking water relieves thirst.",
        }],
        includedCases: ["a glass of drinking water"],
        excludedCases: ["a municipal water supply"],
        neighborContrasts: [],
        openQuestions: [],
      },
    },
    expression: {
      expressionId: "7be22e77-c9f8-46d5-9094-1a332785301e",
      expressionVersionId: "dcbecb7e-7471-4eb4-a475-4f36ade07f38",
      versionNumber: 1,
      expressionType: "word",
      structure: {},
    },
    binding: {
      senseExpressionBindingId: "ae4840c5-b0ec-4caf-859c-c21764342160",
      bindingVersionId: "82ecabfd-b967-4608-be45-f73bdf3f3c67",
      versionNumber: 1,
      relation: "realizes",
      semanticCoverage: "exact",
      registerLabel: null,
      usageConstraints: [],
    },
  };
}

function rawArchive(
  manifest: unknown,
  extraEntries: Readonly<Record<string, Uint8Array>>,
): Uint8Array {
  const entries: Zippable = {
    "package.json": [strToU8(JSON.stringify(manifest)), {mtime: zipTimestamp}],
  };
  for (const [path, bytes] of Object.entries(extraEntries)) {
    entries[path] = [bytes, {level: 0, mtime: zipTimestamp}];
  }
  return zipSync(entries, {mtime: zipTimestamp});
}

function rawArchiveForManifest(manifest: SensaPortableLightweightPackage): Uint8Array {
  return rawArchive(manifest, {[`media/${manifest.media[0]!.sha256}`]: audioBytes});
}

test("portable packer creates a deterministic valid archive", () => {
  const manifest = validManifest();
  const media = new Map([["water-pronunciation", audioBytes]]);
  const first = createSensaPortableLightweightPackage(manifest, media);
  const second = createSensaPortableLightweightPackage(manifest, media);
  assert.deepEqual(first, second);

  const result = validateSensaPortableLightweightPackage(first);
  assert.equal(result.status, "satisfied");
  assert.equal(result.issues.length, 0);
  assert.equal(result.mediaBytes, audioBytes.length);
  assert.match(result.archiveDigest, /^[0-9a-f]{64}$/u);
  assert.match(result.packageDigest ?? "", /^[0-9a-f]{64}$/u);
  const opened = readSensaPortableLightweightPackage(first);
  assert.deepEqual(
    Array.from(opened.mediaById.get("water-pronunciation") ?? []),
    Array.from(audioBytes),
  );
});

test("portable package admits creator-chosen teaching text", () => {
  const archive = createSensaPortableLightweightPackage(
    validManifest(),
    new Map([["water-pronunciation", audioBytes]]),
  );
  const result = validateSensaPortableLightweightPackage(archive);
  assert.equal(result.status, "satisfied");
});

test("portable package carries declarative experience HTML and an optional translation", () => {
  const manifest=validManifest();
  manifest.resources.experienceRecallCue={
    senseFocus:'饮用水',
    html:'<section><button>杯子</button><span>口渴</span></section>',
  };
  delete manifest.resources.sceneRealization.translation;
  const archive=createSensaPortableLightweightPackage(
    manifest,
    new Map([["water-pronunciation",audioBytes]]),
  );
  assert.equal(validateSensaPortableLightweightPackage(archive).status,'satisfied');
});

test("portable package preserves an optional untrusted semantic declaration", () => {
  const manifest = validManifest();
  manifest.semanticDeclaration = semanticDeclaration();
  const archive = createSensaPortableLightweightPackage(
    manifest,
    new Map([["water-pronunciation", audioBytes]]),
  );
  const result = validateSensaPortableLightweightPackage(archive);
  assert.equal(result.status, "satisfied");
  assert.deepEqual(result.package?.semanticDeclaration, semanticDeclaration());
});

test("portable package rejects a semantic declaration for a different expression type", () => {
  const manifest = validManifest();
  manifest.semanticDeclaration = semanticDeclaration();
  manifest.semanticDeclaration.expression.expressionType = "phrase";
  const result = validateSensaPortableLightweightPackage(rawArchiveForManifest(manifest));
  assert.equal(result.status, "invalid");
  assert(result.issues.some((issue) => issue.code === "semantic.expression_type_mismatch"));
});

test("portable package rejects the obsolete v1 format", () => {
  const manifest = {...validManifest(), format: "sensa-portable-lightweight-package-v1"};
  const result = validateSensaPortableLightweightPackage(rawArchive(
    manifest,
    {[`media/${audioDigest}`]: audioBytes},
  ));
  assert.equal(result.status, "invalid");
  assert(result.issues.some((issue) => issue.code === "schema.invalid"));
});

test("portable package rejects changed media bytes", () => {
  const manifest = validManifest();
  manifest.media[0]!.sha256 = "0".repeat(64);
  const result = validateSensaPortableLightweightPackage(rawArchiveForManifest(manifest));
  assert.equal(result.status, "invalid");
  assert(result.issues.some((issue) => issue.code === "media.digest_mismatch"));
});

test("portable package rejects missing or wrong-kind media references", () => {
  const manifest = validManifest();
  manifest.resources.experienceRecallCue.images = [{
    mediaId: "water-pronunciation",
    altText: "A glass of water",
  }];
  manifest.resources.pronunciation.audioMediaId = "missing-audio";
  const result = validateSensaPortableLightweightPackage(rawArchiveForManifest(manifest));
  assert.equal(result.status, "invalid");
  assert(result.issues.some((issue) => issue.code === "reference.media_kind_mismatch"));
  assert(result.issues.some((issue) => issue.code === "reference.media_missing"));
});

test("portable package rejects an out-of-bounds target span", () => {
  const manifest = validManifest();
  manifest.resources.sceneRealization.targetEnd = 999;
  const result = validateSensaPortableLightweightPackage(rawArchiveForManifest(manifest));
  assert.equal(result.status, "invalid");
  assert(result.issues.some((issue) => issue.code === "binding.scene_target_span_invalid"));
});

test("portable package exposes no internal authoring fields", () => {
  const manifest = {...validManifest(), coreRef: {sha256: "0".repeat(64)}};
  const result = validateSensaPortableLightweightPackage(rawArchive(
    manifest,
    {[`media/${audioDigest}`]: audioBytes},
  ));
  assert.equal(result.status, "invalid");
  assert(result.issues.some((issue) => issue.code === "schema.invalid"));
});

test("portable package rejects files outside its fixed archive layout", () => {
  const result = validateSensaPortableLightweightPackage(rawArchive(
    validManifest(),
    {
      [`media/${audioDigest}`]: audioBytes,
      "../outside.txt": strToU8("not allowed"),
    },
  ));
  assert.equal(result.status, "invalid");
  assert(result.issues.some((issue) => issue.code === "archive.path_invalid"));
});

test("portable package rejects declared media that no resource uses", () => {
  const manifest = validManifest();
  const unusedBytes = Buffer.from("unused", "utf8");
  const unusedDigest = createHash("sha256").update(unusedBytes).digest("hex");
  manifest.media.push({
    mediaId: "unused-image",
    kind: "image",
    mimeType: "image/x-fixture",
    sha256: unusedDigest,
    sizeBytes: unusedBytes.byteLength,
  });
  const result = validateSensaPortableLightweightPackage(rawArchive(manifest, {
    [`media/${audioDigest}`]: audioBytes,
    [`media/${unusedDigest}`]: unusedBytes,
  }));
  assert.equal(result.status, "invalid");
  assert(result.issues.some((issue) => issue.code === "media.unused"));
});

test("portable package accepts creator-chosen image formats without inspecting signatures", () => {
  const manifest = validManifest();
  const imageBytes = Buffer.from("creator-owned-opaque-image", "utf8");
  const imageDigest = createHash("sha256").update(imageBytes).digest("hex");
  manifest.media.push({
    mediaId: "scene-image",
    kind: "image",
    mimeType: "image/tiff",
    sha256: imageDigest,
    sizeBytes: imageBytes.byteLength,
  });
  manifest.resources.experienceRecallCue.images = [{
    mediaId: "scene-image",
    altText: "A creator-provided scene",
  }];
  const archive = createSensaPortableLightweightPackage(manifest, new Map([
    ["water-pronunciation", audioBytes],
    ["scene-image", imageBytes],
  ]));
  assert.equal(validateSensaPortableLightweightPackage(archive).status, "satisfied");
});
