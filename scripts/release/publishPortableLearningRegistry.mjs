/** Publish immutable `.sensa-book` archives and then the Registry snapshot. */
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";

import {createClient} from "@supabase/supabase-js";
import {readSensaPortableBook} from "@sensa/content-validator/portable-book";
import {
  canonicalConsumerJson,
  sensaPortableBookDescriptorSchema,
  sensaPortableLearningContentRegistrySchema,
} from "@sensa/contracts/sensa";
import {ensurePublicLearningContentBucket} from "./learningContentBucket.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const safeSegment = (value, name) => {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/u.test(value)) throw new Error(`${name} is invalid`);
  return value;
};
const fetchBytes = async (url, path) => {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Published learning content is not readable at ${path} (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
};

if (process.env.SENSA_CONTENT_PUBLISH !== "true") {
  throw new Error("Set SENSA_CONTENT_PUBLISH=true only in the authorized content publication environment");
}
const supabaseUrl = new URL(required("SUPABASE_URL"));
const projectRef = required("SUPABASE_PROJECT_REF");
if (supabaseUrl.protocol !== "https:"
  || supabaseUrl.hostname !== `${projectRef}.supabase.co`
  || !/^[a-z0-9]{20}$/u.test(projectRef)) {
  throw new Error("Supabase publication target mismatch");
}
const secret = required("SUPABASE_SECRET_KEY");
const bucket = safeSegment(
  process.env.SENSA_PACKAGE_BUCKET?.trim() || "sensa-learning-content",
  "SENSA_PACKAGE_BUCKET",
);
const publishConcurrency = Number(process.env.SENSA_CONTENT_UPLOAD_CONCURRENCY ?? "8");
if (!Number.isInteger(publishConcurrency) || publishConcurrency < 1 || publishConcurrency > 16) {
  throw new Error("SENSA_CONTENT_UPLOAD_CONCURRENCY must be an integer from 1 to 16");
}
const releaseRoot = resolve(
  process.env.SENSA_PACKAGE_OUTPUT ?? "release-candidate/learning-packages",
);
const registryPath = resolve(
  process.env.SENSA_PACKAGE_CATALOG ?? "release-candidate/portable-catalog.json",
);
const registryBytes = await readFile(registryPath);
const registry = sensaPortableLearningContentRegistrySchema.parse(
  JSON.parse(registryBytes.toString("utf8")),
);
const {revision, ...registrySnapshot} = registry;
if (sha256(canonicalConsumerJson(registrySnapshot)) !== revision) {
  throw new Error("Learning content Registry revision does not match its canonical snapshot");
}

const client = createClient(supabaseUrl.href, secret, {
  auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
});
await ensurePublicLearningContentBucket(client.storage, bucket);

const storage = client.storage.from(bucket);
async function publishObject(path, bytes, contentType) {
  const publicUrl = storage.getPublicUrl(path).data.publicUrl;
  const uploaded = await storage.upload(path, bytes, {
    cacheControl: "31536000",
    contentType,
    upsert: false,
  });
  if (uploaded.error) {
    let existing;
    try {
      existing = await fetchBytes(publicUrl, path);
    } catch (error) {
      throw new Error(`Learning content upload failed at ${path}: ${uploaded.error.message}`, {
        cause: error,
      });
    }
    if (sha256(existing) !== sha256(bytes)) {
      throw new Error("An immutable learning content path already has different bytes");
    }
    return publicUrl;
  }
  const delivered = await fetchBytes(publicUrl, path);
  if (sha256(delivered) !== sha256(bytes)) {
    throw new Error("Uploaded learning content failed public digest verification");
  }
  return publicUrl;
}

async function publishInBatches(tasks, label, work) {
  for (let offset = 0; offset < tasks.length; offset += publishConcurrency) {
    await Promise.all(tasks.slice(offset, offset + publishConcurrency).map(work));
    console.log(`${label}: ${Math.min(offset + publishConcurrency, tasks.length)}/${tasks.length}`);
  }
}

const bookTasks = [];
for (const descriptor of registry.items) {
  const bookRelative = [
    "books",
    descriptor.book.bookId,
    descriptor.book.bookVersionId,
    `${descriptor.sha256}.sensa-book`,
  ].join("/");
  const bookBytes = await readFile(resolve(releaseRoot, bookRelative));
  if (bookBytes.byteLength !== descriptor.byteLength
    || sha256(bookBytes) !== descriptor.sha256) {
    throw new Error("Portable Book bytes do not match the Registry descriptor");
  }
  const archive = readSensaPortableBook(bookBytes);
  const manifest = archive.manifest;
  const expectedDescriptor = sensaPortableBookDescriptorSchema.parse({
    format: "sensa-portable-book-descriptor-v1",
    publisher: manifest.publisher,
    book: manifest.book,
    contentRelease: manifest.contentRelease,
    route: manifest.route,
    publishedAt: manifest.publishedAt,
    changeSummary: manifest.changeSummary,
    memberCount: manifest.members.length,
    byteLength: bookBytes.byteLength,
    sha256: archive.archiveDigest,
    url: descriptor.url,
  });
  if (canonicalConsumerJson(expectedDescriptor) !== canonicalConsumerJson(descriptor)) {
    throw new Error("Portable Book identity does not match the Registry descriptor");
  }
  bookTasks.push({bookRelative, bookBytes, memberCount: archive.members.length, expectedUrl: descriptor.url});
}

await publishInBatches(bookTasks, "Portable Books", async ({bookRelative, bookBytes, expectedUrl}) => {
  const bookUrl = await publishObject(
    `releases/${bookRelative}`,
    bookBytes,
    "application/vnd.sensa.book+zip",
  );
  if (bookUrl !== expectedUrl) throw new Error("Portable Book URL does not match the publication target");
});

const packageCount = bookTasks.reduce((total, task) => total + task.memberCount, 0);

const registryObjectPath = `registries/${registry.revision}.json`;
const registryUrl = await publishObject(registryObjectPath, registryBytes, "application/json");
const envOutput = resolve(required("SENSA_REGISTRY_ENV_OUTPUT"));
const reportOutput = resolve(
  process.env.SENSA_REGISTRY_REPORT_OUTPUT
    ?? "release-candidate/portable-learning-content-publication.json",
);
if (/[\r\n']/u.test(registryUrl)) throw new Error("Registry URL cannot be encoded safely");
await mkdir(dirname(envOutput), {recursive: true});
await writeFile(envOutput, `SENSA_PACKAGE_REGISTRY_URL='${registryUrl}'\n`, {mode: 0o600});
await mkdir(dirname(reportOutput), {recursive: true});
await writeFile(reportOutput, `${JSON.stringify({
  format: "sensa-portable-learning-content-publication-v2",
  projectRef,
  bucket,
  registryRevision: registry.revision,
  registryUrl,
  bookVersions: registry.items.map((item) => ({
    publisherNamespace: item.publisher.namespace,
    bookId: item.book.bookId,
    bookVersionId: item.book.bookVersionId,
    bookArchiveSha256: item.sha256,
  })),
  packageCount,
}, null, 2)}\n`);
console.log([
  `Published and verified ${registry.items.length} immutable .sensa-book archive(s) containing`,
  `${packageCount} atomic .sensa member(s); Registry ${registry.revision} is ready for promotion.`,
].join(" "));
