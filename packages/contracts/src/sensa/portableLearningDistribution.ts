import {z} from "zod";

import {sensaLanguageTagSchema} from "./language.js";

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const label = nonEmpty.max(500);
const positiveInteger = z.number().int().positive();
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const timestamp = z.string().datetime({offset: true});
const publisherNamespace = nonEmpty.max(200).regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u);
const deliveryUrl = z.url().refine((value) => {
  const url = new URL(value);
  return !url.username
    && !url.password
    && (url.protocol === "https:"
      || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
}, "Safe HTTP(S) delivery URL required");

export const maxPublishedPortablePackageBytes = 64 * 1024 * 1024;
export const maxBookVersionManifestBytes = 1024 * 1024;

export const sensaPublishedPortableArtifactSchema = z.object({
  packageId: uuid,
  version: positiveInteger,
  byteLength: positiveInteger.max(maxPublishedPortablePackageBytes),
  archiveSha256: digest,
  packageDigest: digest,
  url: deliveryUrl,
}).strict();

const publisherSchema = z.object({
  namespace: publisherNamespace,
  name: label,
}).strict();

const bookSchema = z.object({
  bookId: uuid,
  bookKey: label,
  bookVersionId: uuid,
  versionNumber: positiveInteger,
  title: label,
  description: z.string().trim().max(2_000),
}).strict();

const contentReleaseSchema = z.object({
  contentReleaseId: uuid,
  versionNumber: positiveInteger,
  schemaVersion: label,
}).strict();

const routeSchema = z.object({
  targetLanguage: sensaLanguageTagSchema,
  supportLanguage: sensaLanguageTagSchema,
}).strict();

export const sensaBookVersionManifestSchema = z.object({
  format: z.literal("sensa-book-version-manifest-v1"),
  publisher: publisherSchema,
  book: bookSchema,
  contentRelease: contentReleaseSchema,
  route: routeSchema,
  publishedAt: timestamp,
  changeSummary: z.string().trim().max(2_000),
  semanticAttestation: z.object({
    kind: z.literal("publisher-digest-attestation"),
    publisherNamespace,
    subject: z.literal("member-semantic-declarations"),
  }).strict(),
  members: z.array(sensaPublishedPortableArtifactSchema).min(1).max(1_000),
}).strict().superRefine((manifest, context) => {
  if (manifest.semanticAttestation.publisherNamespace !== manifest.publisher.namespace) {
    context.addIssue({
      code: "custom",
      path: ["semanticAttestation", "publisherNamespace"],
      message: "Semantic attestation namespace must match the publisher namespace.",
    });
  }
  const identities = manifest.members.map((member) => `${member.packageId}:${member.version}`);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({code: "custom", path: ["members"], message: "Duplicate Portable Package member."});
  }
});

export const sensaBookVersionManifestDescriptorSchema = z.object({
  format: z.literal("sensa-book-version-manifest-descriptor-v1"),
  publisher: publisherSchema,
  book: bookSchema,
  contentRelease: contentReleaseSchema,
  route: routeSchema,
  publishedAt: timestamp,
  changeSummary: z.string().trim().max(2_000),
  memberCount: positiveInteger.max(1_000),
  byteLength: positiveInteger.max(maxBookVersionManifestBytes),
  sha256: digest,
  url: deliveryUrl,
}).strict();

export const sensaPortableLearningContentRegistrySchema = z.object({
  format: z.literal("sensa-learning-content-registry-v2"),
  revision: digest,
  publishedAt: timestamp,
  items: z.array(sensaBookVersionManifestDescriptorSchema).max(1_000),
}).strict().superRefine((registry, context) => {
  const identities = registry.items.map((item) => [
    item.publisher.namespace,
    item.book.bookId,
    item.route.targetLanguage,
    item.route.supportLanguage,
  ].join(":"));
  if (new Set(identities).size !== identities.length) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "Duplicate public Book version for one publisher and language route.",
    });
  }
});

export type SensaPublishedPortableArtifact = z.infer<
  typeof sensaPublishedPortableArtifactSchema
>;
export type SensaBookVersionManifest = z.infer<
  typeof sensaBookVersionManifestSchema
>;
export type SensaBookVersionManifestDescriptor = z.infer<
  typeof sensaBookVersionManifestDescriptorSchema
>;
export type SensaPortableLearningContentRegistry = z.infer<
  typeof sensaPortableLearningContentRegistrySchema
>;
