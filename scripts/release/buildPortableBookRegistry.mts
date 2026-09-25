/** Build immutable per-Sense `.sensa` artifacts, Book Version Manifests and one Registry. */
import {createHash} from "node:crypto";
import {mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";

import {
  canonicalConsumerJson,
  learningReferenceInputSchema,
  sensaBookVersionManifestDescriptorSchema,
  sensaBookVersionManifestSchema,
  sensaLightweightExpressionSnapshotSchema,
  sensaPortableLearningContentRegistrySchema,
  sensaSenseSemanticSpecSchema,
  type SensaPortableLightweightMedia,
  type SensaPortableLightweightPackage,
  type SensaSenseSemanticSpec,
} from "@sensa/contracts/sensa";
import {
  createSensaPortableLightweightPackage,
  readSensaPortableLightweightPackage,
} from "@sensa/content-validator/portable-lightweight";
import {stableUuid} from "@sensa/learning-kernel";

import {provisionLightweightInitialContent} from "../../apps/web/src/contentSupply/provisioning/lightweightInitialContent.ts";
import {
  createAuthoredMediaPackager,
  type AuthoredMediaInput,
  type AuthoredMediaReference,
} from "./authoredMedia.mts";

type SourceParty = Readonly<{name: string; url?: string}>;
type SourceEntry = {
  key: string;
  packageVersion: number;
  senseVersion: number;
  bindingVersion: number;
  expressionKind?: "word" | "phrase" | "construction" | "utterance" | "sentence";
  expression: string;
  spokenForm?: string;
  acceptedForms?: string[];
  formParts?: {kind: "fixed" | "slot"; text: string; constraint?: string}[];
  meaning: string;
  scene: string;
  featureLabels?: string[];
  sceneBridge?: string;
  pronunciation?: {
    audio?: AuthoredMediaInput;
    audioUrl?: string;
    phoneticNotation: string | null;
    accentLabel: string | null;
    source: string;
    method: "recording" | "tts";
  };
  languageStructure?: {
    expressionTypeLabel: string | null;
    partOfSpeech: string | null;
    usagePattern?: string | null;
    contrastNote?: string | null;
  };
  sceneExample?: {
    targetStart: number;
    targetEnd: number;
    example: string;
    translation?: string | null;
    audio?: AuthoredMediaInput | null;
    audioUrl?: string | null;
  };
  usageExamples?: {
    example: string;
    translation?: string | null;
    audio?: AuthoredMediaInput | null;
    audioUrl?: string | null;
  }[];
  images?: {name: string; media: AuthoredMediaReference}[];
  referenceFacts?: unknown[];
  semanticSpec: SensaSenseSemanticSpec;
};
type Source = {
  publisher: {namespace: string; name: string};
  author: SourceParty;
  license: SourceParty;
  bookKey: string;
  title: string;
  description: string;
  versionNumber: number;
  publishedAt: string;
  changeSummary: string;
  targetLanguage: string;
  supportLanguage: string;
  entries: SourceEntry[];
};

type PortableMedia = Readonly<{
  declaration: SensaPortableLightweightMedia;
  bytes: Uint8Array;
}>;

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const configuredSources = process.env.SENSA_BOOK_RELEASE_SOURCES?.trim();
const sourcePaths = configuredSources
  ? configuredSources.split(",").map((value) => value.trim()).filter(Boolean)
  : (await readdir("content/authored", {withFileTypes: true}))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => `content/authored/${entry.name}`);
if (sourcePaths.length === 0 || new Set(sourcePaths).size !== sourcePaths.length) {
  throw new Error("Explicit unique authored Book release sources required");
}

const media = await createAuthoredMediaPackager({
  mediaRoot: resolve(process.env.SENSA_AUTHORED_MEDIA_ROOT ?? "content/data/media"),
  ...(process.env.SENSA_AUTHORED_MEDIA_PACK?.trim()
    ? {mediaPackPath: resolve(process.env.SENSA_AUTHORED_MEDIA_PACK)}
    : {}),
});
const mediaInput = (
  reference: AuthoredMediaInput | null | undefined,
  legacyUrl: string | null | undefined,
  label: string,
): AuthoredMediaInput | null | undefined => {
  if (reference != null && legacyUrl != null) {
    throw new Error(`Authored media has two competing references: ${label}`);
  }
  return reference ?? legacyUrl;
};
const dataUrlMedia = (
  dataUrl: string,
  mediaId: string,
  kind: "audio" | "image",
  attribution?: SensaPortableLightweightMedia["attribution"],
): PortableMedia => {
  const matched = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u);
  if (!matched) throw new Error(`Authored media did not resolve to canonical bytes: ${mediaId}`);
  const bytes = Buffer.from(matched[2]!, "base64");
  if (bytes.toString("base64") !== matched[2]) throw new Error(`Authored media is not canonical: ${mediaId}`);
  return {
    declaration: {
      mediaId,
      kind,
      mimeType: matched[1]!,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      ...(attribution === undefined ? {} : {attribution}),
    },
    bytes,
  };
};

const origin = new URL(process.env.SENSA_WEB_ORIGIN ?? "https://candidate.invalid");
if (origin.protocol !== "https:"
  && !(origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))) {
  throw new Error("HTTPS origin required");
}
const defaultBase = new URL("/learning-packages/", origin);
const base = new URL(process.env.SENSA_PACKAGE_BASE_URL ?? defaultBase);
if (base.username || base.password || base.search || base.hash
  || !(base.protocol === "https:"
    || (base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname)))) {
  throw new Error("Safe package base URL required");
}
if (!base.pathname.endsWith("/")) base.pathname += "/";

const outputRoot = resolve(process.env.SENSA_PACKAGE_OUTPUT ?? "release-candidate/learning-packages");
const registryOutput = resolve(
  process.env.SENSA_PACKAGE_CATALOG_OUTPUT ?? "release-candidate/portable-catalog.json",
);
const owner = stableUuid("sensa:publisher");
const descriptors = [];
let totalMembers = 0;

for (const path of [...sourcePaths].sort()) {
  const source = JSON.parse(await readFile(path, "utf8")) as Source;
  if (!source.bookKey?.trim()
    || !Number.isInteger(source.versionNumber)
    || source.versionNumber < 1
    || !Number.isFinite(Date.parse(source.publishedAt))) {
    throw new Error(`Invalid authored Book identity: ${path}`);
  }
  if (!source.publisher?.namespace?.trim() || !source.publisher.name?.trim()) {
    throw new Error(`Authored Book publisher required: ${path}`);
  }
  if (!source.author?.name?.trim() || !source.license?.name?.trim()) {
    throw new Error(`Authored Book author and license required: ${path}`);
  }
  if (!source.targetLanguage?.trim() || !source.supportLanguage?.trim()) {
    throw new Error(`Authored Book must name its exact language route: ${path}`);
  }
  if (!source.entries?.length
    || new Set(source.entries.map((entry) => entry.key)).size !== source.entries.length) {
    throw new Error(`Authored Book must contain unique entry keys: ${path}`);
  }

  const bookId = stableUuid(`sensa:book:${source.bookKey}`);
  const bookVersionId = stableUuid(`sensa:book:${source.bookKey}:version:${source.versionNumber}`);
  const contentReleaseId = stableUuid(
    `sensa:content-release:${source.bookKey}:version:${source.versionNumber}`,
  );
  const members = [];

  for (const entry of source.entries) {
    if (!Number.isInteger(entry.packageVersion) || entry.packageVersion < 1
      || !Number.isInteger(entry.senseVersion) || entry.senseVersion < 1
      || !Number.isInteger(entry.bindingVersion) || entry.bindingVersion < 1) {
      throw new Error(`Entry versions must be positive: ${entry.key}`);
    }
    if (!entry.pronunciation || !entry.sceneBridge || !entry.sceneExample?.translation) {
      throw new Error(`Portable core resources are incomplete: ${entry.key}`);
    }

    const semanticSpec = sensaSenseSemanticSpecSchema.parse(entry.semanticSpec);
    const senseId = stableUuid(`sensa:starter:sense:${entry.key}`);
    const senseVersionId = stableUuid(
      `sensa:starter:sense:${entry.key}:version:${entry.senseVersion}`,
    );
    const expressionKey = `${source.targetLanguage}:${entry.expression.trim().toLocaleLowerCase()}`;
    const expressionId = stableUuid(`sensa:starter:expression:${expressionKey}`);
    const expressionVersionId = stableUuid(
      `sensa:starter:expression:${expressionKey}:version:${entry.bindingVersion}`,
    );
    const bindingId = stableUuid(`sensa:starter:binding:${entry.key}`);
    const bindingVersionId = stableUuid(
      `sensa:starter:binding:${entry.key}:version:${entry.bindingVersion}`,
    );
    const packageId = stableUuid([
      "sensa:official:portable",
      source.bookKey,
      entry.key,
      source.targetLanguage,
      source.supportLanguage,
    ].join(":"));
    const expression = sensaLightweightExpressionSnapshotSchema.parse({
      surface: entry.expression,
      languageTag: source.targetLanguage,
      expressionKind: entry.expressionKind ?? "unspecified",
      ...(entry.spokenForm ? {spokenForm: entry.spokenForm} : {}),
      ...(entry.formParts ? {formParts: entry.formParts} : {}),
      ...(entry.acceptedForms ? {acceptedForms: entry.acceptedForms} : {}),
    });
    if (expression.expressionKind === "unspecified") {
      throw new Error(`Authored expressionKind required: ${entry.key}`);
    }

    const pronunciationUrl = await media.embed(
      mediaInput(entry.pronunciation.audio, entry.pronunciation.audioUrl, `${entry.key}:pronunciation`),
      `${entry.key}:pronunciation`,
    );
    if (!pronunciationUrl) throw new Error(`Authored pronunciation audio required: ${entry.key}`);
    const sceneAudioUrl = await media.embed(
      mediaInput(entry.sceneExample.audio, entry.sceneExample.audioUrl, `${entry.key}:scene`),
      `${entry.key}:scene`,
    );
    const usageExamples = await Promise.all((entry.usageExamples ?? []).map(async (example, index) => ({
      example: example.example,
      translation: example.translation ?? null,
      audioUrl: await media.embed(
        mediaInput(example.audio, example.audioUrl, `${entry.key}:example:${index}`),
        `${entry.key}:example:${index}`,
      ),
    })));
    const images = await Promise.all((entry.images ?? []).map(async (image, index) => {
      const dataUrl = await media.embed(image.media, `${entry.key}:image:${index}`);
      if (!dataUrl) throw new Error(`Authored image required: ${entry.key}:${index}`);
      return {name: image.name, dataUrl};
    }));
    const referenceFacts = (entry.referenceFacts ?? []).map((fact) =>
      learningReferenceInputSchema.parse(fact));

    const result = provisionLightweightInitialContent({
      learnerUserId: owner,
      learningTargetId: stableUuid(`sensa:starter:target:${entry.key}`),
      senseId,
      senseVersionId,
      senseExpressionBindingId: bindingId,
      resolvedLearningPlanRevisionId: `authored:${source.bookKey}:${source.versionNumber}`,
      expressionSourceVersion: String(entry.bindingVersion),
      senseSourceVersion: String(entry.senseVersion),
      expression,
      sense: {meaning: entry.meaning, supportLanguageTag: source.supportLanguage},
      originExperience: {
        source: "other_authoritative_source",
        sourceVersion: String(source.versionNumber),
        personalAnchorUseGrantId: null,
        experience: {
          scene: entry.scene,
          senseFocus: entry.meaning,
          featureLabels: entry.featureLabels ?? [],
          ...(images.length ? {images: images.map((image, index) => ({
            id: stableUuid(`sensa:authored-image:${entry.key}:${index}`),
            name: image.name,
            dataUrl: image.dataUrl,
          }))} : {}),
          sceneBridge: entry.sceneBridge,
          sceneRealization: {
            example: entry.sceneExample.example,
            targetStart: entry.sceneExample.targetStart,
            targetEnd: entry.sceneExample.targetEnd,
            translation: entry.sceneExample.translation,
            audioUrl: sceneAudioUrl,
          },
        },
      },
      referenceFacts: [
        ...referenceFacts,
        {
          source: "pronunciation_lexicon" as const,
          sourceVersion: `authored:${source.bookKey}:${source.versionNumber}:${entry.key}:pronunciation`,
          fact: {
            factKind: "pronunciation" as const,
            surface: entry.spokenForm ?? entry.expression,
            languageTag: source.targetLanguage,
            audioUrl: pronunciationUrl,
            phoneticNotation: entry.pronunciation.phoneticNotation,
            accentLabel: entry.pronunciation.accentLabel,
            source: entry.pronunciation.source,
            method: entry.pronunciation.method,
          },
        },
        ...(entry.languageStructure ? [{
          source: "dictionary" as const,
          sourceVersion: `authored:${source.bookKey}:${source.versionNumber}:${entry.key}:structure`,
          fact: {factKind: "language_structure" as const, ...entry.languageStructure},
        }] : []),
        ...usageExamples.map((example, index) => ({
          source: "other_authoritative_source" as const,
          sourceVersion: `authored:${source.bookKey}:${source.versionNumber}:${entry.key}:example:${index}`,
          fact: {factKind: "usage_example" as const, ...example},
        })),
      ],
      requestedAt: source.publishedAt,
    });
    if (result.status !== "ready") {
      throw new Error(`Authored resource failed material validation: ${entry.key} (${JSON.stringify(result.issues)})`);
    }

    const portableMedia: PortableMedia[] = [
      dataUrlMedia(pronunciationUrl, "pronunciation", "audio", {source: entry.pronunciation.source}),
      ...(sceneAudioUrl ? [dataUrlMedia(sceneAudioUrl, "scene-realization", "audio")] : []),
      ...usageExamples.flatMap((example, index) => example.audioUrl
        ? [dataUrlMedia(example.audioUrl, `usage-guidance-${index}`, "audio")]
        : []),
      ...images.map((image, index) =>
        dataUrlMedia(image.dataUrl, `experience-image-${index}`, "image")),
    ];
    const optional: SensaPortableLightweightPackage["resources"]["optional"] = {};
    if (entry.featureLabels?.length) {
      optional.recallSupport = entry.featureLabels.map((text) => ({text}));
    }
    if (entry.languageStructure) optional.languageStructure = entry.languageStructure;
    if (usageExamples.length) {
      optional.usageGuidance = usageExamples.map((example, index) => ({
        example: example.example,
        translation: example.translation,
        ...(example.audioUrl ? {audioMediaId: `usage-guidance-${index}`} : {}),
      }));
    }
    for (const reference of referenceFacts) {
      const fact = reference.fact;
      if (fact.factKind === "boundary_contrast") {
        optional.boundaryContrast = {
          text: fact.explanation,
          source: fact.source,
          sourceUrl: fact.sourceUrl,
        };
      } else if (fact.factKind === "word_formation") {
        optional.wordFormation = {
          text: fact.explanation,
          source: fact.source,
          sourceUrl: fact.sourceUrl,
        };
      } else if (fact.factKind === "mnemonic") {
        optional.mnemonic = {text: fact.text};
      } else if (fact.factKind === "etymology") {
        optional.etymology = {
          text: fact.explanation,
          source: fact.source,
          sourceUrl: fact.sourceUrl,
        };
      }
    }

    const manifest: SensaPortableLightweightPackage = {
      format: "sensa-portable-lightweight-package-v2",
      metadata: {
        packageId,
        version: entry.packageVersion,
        title: `${source.title}: ${entry.expression}`,
        description: source.description,
        createdAt: source.publishedAt,
        author: source.author,
        license: source.license,
      },
      route: {targetLanguage: source.targetLanguage, supportLanguage: source.supportLanguage},
      sense: {senseId: entry.key, meaning: entry.meaning},
      targetExpression: {
        text: entry.expression,
        expressionKind: expression.expressionKind,
        ...(entry.spokenForm ? {spokenForm: entry.spokenForm} : {}),
        ...(entry.acceptedForms ? {acceptedForms: entry.acceptedForms} : {}),
      },
      resources: {
        experienceRecallCue: {
          text: entry.scene,
          senseFocus: entry.meaning,
          ...(images.length ? {images: images.map((image, index) => ({
            mediaId: `experience-image-${index}`,
            altText: image.name,
          }))} : {}),
        },
        senseConfirmation: {text: entry.meaning},
        pronunciation: {
          surface: entry.spokenForm ?? entry.expression,
          audioMediaId: "pronunciation",
          method: entry.pronunciation.method,
          source: entry.pronunciation.source,
          phoneticNotation: entry.pronunciation.phoneticNotation,
          accentLabel: entry.pronunciation.accentLabel,
        },
        sceneBridge: {text: entry.sceneBridge},
        sceneRealization: {
          example: entry.sceneExample.example,
          translation: entry.sceneExample.translation,
          targetStart: entry.sceneExample.targetStart,
          targetEnd: entry.sceneExample.targetEnd,
          ...(sceneAudioUrl ? {audioMediaId: "scene-realization"} : {}),
        },
        optional,
      },
      media: portableMedia.map((item) => item.declaration),
      semanticDeclaration: {
        contractVersion: "sensa-portable-semantic-declaration-v1",
        sense: {
          senseId,
          senseVersionId,
          senseKey: entry.key,
          versionNumber: entry.senseVersion,
          semanticPolicyVersion: "sensa-editorial-starter-v1",
          semanticSpec,
        },
        expression: {
          expressionId,
          expressionVersionId,
          versionNumber: entry.bindingVersion,
          expressionType: expression.expressionKind === "utterance"
            ? "utterance_strategy"
            : expression.expressionKind,
          structure: {
            ...(entry.spokenForm ? {spokenForm: entry.spokenForm} : {}),
            ...(entry.formParts ? {formParts: entry.formParts} : {}),
          },
        },
        binding: {
          senseExpressionBindingId: bindingId,
          bindingVersionId,
          versionNumber: entry.bindingVersion,
          relation: "realizes",
          semanticCoverage: "exact",
          registerLabel: null,
          usageConstraints: [],
        },
      },
    };
    const mediaById = new Map(portableMedia.map((item) => [
      item.declaration.mediaId,
      item.bytes,
    ]));
    const archiveBytes = createSensaPortableLightweightPackage(manifest, mediaById);
    const archive = readSensaPortableLightweightPackage(archiveBytes);
    const packageRelative = [
      "packages",
      packageId,
      String(entry.packageVersion),
      `${archive.archiveDigest}.sensa`,
    ].join("/");
    const packageOutput = resolve(outputRoot, packageRelative);
    await mkdir(dirname(packageOutput), {recursive: true});
    await writeFile(packageOutput, archiveBytes);
    members.push({
      packageId,
      version: entry.packageVersion,
      byteLength: archiveBytes.byteLength,
      archiveSha256: archive.archiveDigest,
      packageDigest: archive.packageDigest,
      url: new URL(packageRelative, base).href,
    });
  }

  const bookManifest = sensaBookVersionManifestSchema.parse({
    format: "sensa-book-version-manifest-v1",
    publisher: source.publisher,
    book: {
      bookId,
      bookKey: source.bookKey,
      bookVersionId,
      versionNumber: source.versionNumber,
      title: source.title,
      description: source.description,
    },
    contentRelease: {
      contentReleaseId,
      versionNumber: source.versionNumber,
      schemaVersion: "sensa-portable-lightweight-package-v2",
    },
    route: {targetLanguage: source.targetLanguage, supportLanguage: source.supportLanguage},
    publishedAt: source.publishedAt,
    changeSummary: source.changeSummary,
    semanticAttestation: {
      kind: "publisher-digest-attestation",
      publisherNamespace: source.publisher.namespace,
      subject: "member-semantic-declarations",
    },
    members,
  });
  const manifestBytes = Buffer.from(canonicalConsumerJson(bookManifest));
  const manifestDigest = sha256(manifestBytes);
  const manifestRelative = [
    "books",
    bookId,
    bookVersionId,
    `${manifestDigest}.json`,
  ].join("/");
  const manifestOutput = resolve(outputRoot, manifestRelative);
  await mkdir(dirname(manifestOutput), {recursive: true});
  await writeFile(manifestOutput, manifestBytes);
  descriptors.push(sensaBookVersionManifestDescriptorSchema.parse({
    format: "sensa-book-version-manifest-descriptor-v1",
    publisher: source.publisher,
    book: bookManifest.book,
    contentRelease: bookManifest.contentRelease,
    route: bookManifest.route,
    publishedAt: bookManifest.publishedAt,
    changeSummary: bookManifest.changeSummary,
    memberCount: bookManifest.members.length,
    byteLength: manifestBytes.byteLength,
    sha256: manifestDigest,
    url: new URL(manifestRelative, base).href,
  }));
  totalMembers += members.length;
}

media.assertSealedPackFullyConsumed();
const publishedAt = descriptors.map((item) => item.publishedAt).sort().at(-1)!;
const registrySnapshot = {
  format: "sensa-learning-content-registry-v2" as const,
  publishedAt,
  items: descriptors,
};
const revision = sha256(canonicalConsumerJson(registrySnapshot));
const registry = sensaPortableLearningContentRegistrySchema.parse({...registrySnapshot, revision});
await mkdir(dirname(registryOutput), {recursive: true});
await writeFile(registryOutput, canonicalConsumerJson(registry));
console.log(
  `Built ${descriptors.length} Book Version Manifest(s) with ${totalMembers} independent ` +
    ".sensa member(s); Portable, semantic declaration, Manifest and Registry validation passed. " +
    "No media generation, provider call, publication or user acceptance claimed.",
);
