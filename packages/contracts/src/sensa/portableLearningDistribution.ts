import {z} from "zod";

import {sensaLanguageTagSchema} from "./language.js";

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const label = nonEmpty.max(500);
const positiveInteger = z.number().int().positive();
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const timestamp = z.string().datetime({offset: true});
const publisherNamespace = nonEmpty.max(200).regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u);
const bookKey = nonEmpty.max(200).regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u);
const deliveryUrl = z.url().refine((value) => {
  const url = new URL(value);
  return !url.username
    && !url.password
    && (url.protocol === "https:"
      || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
}, "Safe HTTP(S) delivery URL required");

export const maxPortableBookArchiveBytes = 256 * 1024 * 1024;
export const maxPortableBookManifestBytes = 1024 * 1024;
export const maxPortableBookMembers = 10_000;
export const maxPortableBookPreviewBytes = 8 * 1024 * 1024;
/** Older publications can be inspected in memory without installing their archive. */
export const maxLegacyBookPreviewArchiveBytes = 8 * 1024 * 1024;

const publisherSchema = z.object({
  namespace: publisherNamespace,
  name: label,
}).strict();

const bookSchema = z.object({
  bookId: uuid,
  bookKey,
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

/** One independently useful `.sensa` member carried by a `.sensa-book`. */
export const sensaPortableBookMemberSchema = z.object({
  packageId: uuid,
  version: positiveInteger,
}).strict();

/** The identity document stored as `book.json` inside a `.sensa-book`. */
export const sensaPortableBookManifestSchema = z.object({
  format: z.literal("sensa-portable-book-v1"),
  publisher: publisherSchema,
  book: bookSchema,
  contentRelease: contentReleaseSchema,
  route: routeSchema,
  publishedAt: timestamp,
  changeSummary: z.string().trim().max(2_000),
  semanticAttestation: z.object({
    kind: z.literal("publisher-attestation"),
    publisherNamespace,
    subject: z.literal("member-semantic-declarations"),
  }).strict(),
  members: z.array(sensaPortableBookMemberSchema).min(1).max(maxPortableBookMembers),
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

/** Registry metadata for one directly downloadable `.sensa-book`. */
export const sensaPortableBookDescriptorSchema = z.object({
  format: z.literal("sensa-portable-book-descriptor-v1"),
  publisher: publisherSchema,
  book: bookSchema,
  contentRelease: contentReleaseSchema,
  route: routeSchema,
  publishedAt: timestamp,
  changeSummary: z.string().trim().max(2_000),
  memberCount: positiveInteger.max(maxPortableBookMembers),
  byteLength: positiveInteger.max(maxPortableBookArchiveBytes),
  sha256: digest,
  url: deliveryUrl,
  preview: z.object({url:deliveryUrl,sha256:digest,byteLength:positiveInteger.max(maxPortableBookPreviewBytes)}).strict().optional(),
}).strict();

const previewEntry = sensaPortableBookMemberSchema.extend({expression:label}).strict();
const previewParty = z.object({name:label,url:z.url().refine(value=>{const url=new URL(value);return !url.username&&!url.password&&['http:','https:'].includes(url.protocol);}).optional()}).strict();
/** Public text only: no media bytes, installation facts or learner state. */
export const sensaPortableBookPreviewSchema = z.object({
  format:z.literal('sensa-portable-book-preview-v1'),
  publisher:publisherSchema,book:bookSchema,contentRelease:contentReleaseSchema,route:routeSchema,
  publishedAt:timestamp,changeSummary:z.string().trim().max(2_000),archiveSha256:digest,
  memberCount:positiveInteger.max(maxPortableBookMembers),
  authors:z.array(previewParty).min(1).max(maxPortableBookMembers),
  licenses:z.array(previewParty).min(1).max(maxPortableBookMembers),
  entries:z.array(previewEntry).min(1).max(maxPortableBookMembers),
  samples:z.array(previewEntry.extend({
    scene:nonEmpty.max(8_000).optional(),senseFocus:nonEmpty.max(4_000),hasVisualCue:z.boolean(),
    meaning:nonEmpty.max(8_000),bridge:nonEmpty.max(8_000),example:nonEmpty.max(8_000),
    translation:nonEmpty.max(8_000).optional(),
  }).strict()).min(1).max(3),
}).strict().superRefine((preview,context)=>{
  const key=(entry:{packageId:string;version:number})=>`${entry.packageId}:${entry.version}`;
  const entries=new Map(preview.entries.map(entry=>[key(entry),entry]));
  if(preview.entries.length!==preview.memberCount||entries.size!==preview.memberCount)
    context.addIssue({code:'custom',path:['entries'],message:'Preview must enumerate each member exactly once.'});
  if(preview.samples.length!==Math.min(3,preview.memberCount)||new Set(preview.samples.map(key)).size!==preview.samples.length
    ||preview.samples.some(sample=>entries.get(key(sample))?.expression!==sample.expression))
    context.addIssue({code:'custom',path:['samples'],message:'Preview samples must identify distinct enumerated members.'});
});

export const sensaPortableLearningContentRegistrySchema = z.object({
  format: z.literal("sensa-learning-content-registry-v3"),
  revision: digest,
  publishedAt: timestamp,
  items: z.array(sensaPortableBookDescriptorSchema).max(1_000),
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
  const bookKeys = registry.items.map((item) => item.book.bookKey);
  if (new Set(bookKeys).size !== bookKeys.length) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "Public Book keys must be unique because each key owns one catalog URL.",
    });
  }
});

export type SensaPortableBookMember = z.infer<typeof sensaPortableBookMemberSchema>;
export type SensaPortableBookManifest = z.infer<typeof sensaPortableBookManifestSchema>;
export type SensaPortableBookDescriptor = z.infer<typeof sensaPortableBookDescriptorSchema>;
export type SensaPortableBookPreview = z.infer<typeof sensaPortableBookPreviewSchema>;
export type SensaPortableLearningContentRegistry = z.infer<
  typeof sensaPortableLearningContentRegistrySchema
>;
