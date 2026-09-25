import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";

import {test} from "vitest";

import {readSensaPortableLightweightPackage} from "@sensa/content-validator/portable-lightweight";
import {
  canonicalConsumerJson,
  maxBookVersionManifestBytes,
  sensaBookVersionManifestDescriptorSchema,
  sensaBookVersionManifestSchema,
  sensaPortableLearningContentRegistrySchema,
} from "@sensa/contracts/sensa";

import {createAuthoredMediaPackager} from "../../../scripts/release/authoredMedia.mts";
import {syntheticSound} from "../../../scripts/support/lightweightMaterialFixture.mts";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

test("official portable Registry fixes per-Sense packages behind one Book Manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "sensa-portable-learning-registry-"));
  const releases = join(root, "releases");
  const registryPath = join(root, "catalog.json");
  const repeatReleases = join(root, "repeat-releases");
  const repeatRegistryPath = join(root, "repeat-catalog.json");
  const mediaRoot = join(root, "media");
  const mediaPackPath = join(root, "authored-media-pack.json");
  const base = "https://content.example.test/releases/";
  try {
    const source = JSON.parse(await readFile("content/authored/web-starter.json", "utf8"));
    const sourcePath = join(root, "synthetic-source.json");
    const audioBytes = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
    const audioSha256 = digest(audioBytes);
    const audio = {sha256: audioSha256, mimeType: "audio/mpeg"};
    const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
    const imageSha256 = digest(imageBytes);
    const image = {sha256: imageSha256, mimeType: "image/jpeg"};
    await mkdir(join(mediaRoot, "audio"), {recursive: true});
    await mkdir(join(mediaRoot, "images"), {recursive: true});
    await writeFile(join(mediaRoot, "audio", `${audioSha256}.mp3`), audioBytes);
    await writeFile(join(mediaRoot, "images", `${imageSha256}.jpg`), imageBytes);
    const media = await createAuthoredMediaPackager({mediaRoot});
    assert.equal(
      await media.embed(audio, "synthetic-audio"),
      `data:audio/mpeg;base64,${audioBytes.toString("base64")}`,
    );
    assert.equal(
      await media.embed(image, "synthetic-image"),
      `data:image/jpeg;base64,${imageBytes.toString("base64")}`,
    );
    await writeFile(mediaPackPath, `${JSON.stringify({
      format: "sensa-authored-media-pack-v1",
      objects: [
        {...audio, base64: audioBytes.toString("base64")},
        {...image, base64: imageBytes.toString("base64")},
      ],
    })}\n`);
    for (const [index, entry] of source.entries.entries()) {
      const {audioUrl: discarded, ...sound} = syntheticSound(
        entry.expression,
        source.targetLanguage,
      );
      void discarded;
      entry.pronunciation = {...sound, audio};
      entry.sceneBridge = "Synthetic binding for portable release validation";
      entry.sceneExample = {
        example: entry.expression,
        translation: entry.meaning,
        targetStart: 0,
        targetEnd: entry.expression.length,
        audio,
      };
      entry.usageExamples = (entry.usageExamples ?? []).map((example: Record<string, unknown>) => ({
        example: example.example,
        translation: example.translation,
        audio,
      }));
      entry.images = index === 0 ? [{name: "synthetic-context.jpg", media: image}] : [];
    }
    await writeFile(sourcePath, JSON.stringify(source));

    const runBuilder = (output: string, catalog: string) => spawnSync(
      process.execPath,
      ["--import", "tsx", resolve("scripts/release/buildPortableBookRegistry.mts")],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...process.env,
          SENSA_BOOK_RELEASE_SOURCES: sourcePath,
          SENSA_AUTHORED_MEDIA_ROOT: join(root, "absent-media"),
          SENSA_AUTHORED_MEDIA_PACK: mediaPackPath,
          SENSA_PACKAGE_OUTPUT: output,
          SENSA_PACKAGE_CATALOG_OUTPUT: catalog,
          SENSA_PACKAGE_BASE_URL: base,
          SENSA_WEB_ORIGIN: "https://app.example.test",
        },
      },
    );
    const built = runBuilder(releases, registryPath);
    assert.equal(built.status, 0, built.stderr || built.stdout);

    const registryBytes = await readFile(registryPath);
    const registry = sensaPortableLearningContentRegistrySchema.parse(
      JSON.parse(registryBytes.toString("utf8")),
    );
    assert.equal(registry.items.length, 1);
    const {revision, ...snapshot} = registry;
    assert.equal(revision, digest(canonicalConsumerJson(snapshot)));
    const descriptor = registry.items[0]!;
    assert.equal(descriptor.publisher.namespace, "sensa.official");
    const manifestRelative = [
      "books",
      descriptor.book.bookId,
      descriptor.book.bookVersionId,
      `${descriptor.sha256}.json`,
    ].join("/");
    const manifestBytes = await readFile(join(releases, manifestRelative));
    const manifest = sensaBookVersionManifestSchema.parse(
      JSON.parse(manifestBytes.toString("utf8")),
    );
    assert.equal(descriptor.url, new URL(manifestRelative, base).href);
    assert.equal(descriptor.byteLength, manifestBytes.byteLength);
    assert.equal(descriptor.sha256, digest(manifestBytes));
    assert.equal(manifest.semanticAttestation.publisherNamespace, descriptor.publisher.namespace);
    assert.equal(manifest.members.length, 3);

    for (const member of manifest.members) {
      const packageRelative = [
        "packages",
        member.packageId,
        String(member.version),
        `${member.archiveSha256}.sensa`,
      ].join("/");
      const packageBytes = await readFile(join(releases, packageRelative));
      const archive = readSensaPortableLightweightPackage(packageBytes);
      assert.equal(member.url, new URL(packageRelative, base).href);
      assert.equal(member.byteLength, packageBytes.byteLength);
      assert.equal(member.archiveSha256, archive.archiveDigest);
      assert.equal(member.packageDigest, archive.packageDigest);
      assert.equal(archive.package.metadata.packageId, member.packageId);
      assert.equal(archive.package.metadata.version, member.version);
      assert(archive.package.semanticDeclaration, "official members require a semantic declaration");
      assert.equal(archive.package.route.targetLanguage, manifest.route.targetLanguage);
      assert.equal(archive.package.route.supportLanguage, manifest.route.supportLanguage);
    }

    assert.equal(
      sensaBookVersionManifestDescriptorSchema.parse({
        ...descriptor,
        byteLength: maxBookVersionManifestBytes,
      }).byteLength,
      maxBookVersionManifestBytes,
    );
    assert.throws(() => sensaBookVersionManifestDescriptorSchema.parse({
      ...descriptor,
      byteLength: maxBookVersionManifestBytes + 1,
    }), /Too big/u);
    assert.throws(() => sensaPortableLearningContentRegistrySchema.parse({
      ...registry,
      items: [descriptor, descriptor],
    }), /Duplicate public Book version/u);

    const repeated = runBuilder(repeatReleases, repeatRegistryPath);
    assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
    assert.equal(
      (await readFile(repeatRegistryPath)).toString("utf8"),
      registryBytes.toString("utf8"),
      "the same authored release must rebuild byte-for-byte",
    );
    for (const member of manifest.members) {
      const relative = [
        "packages",
        member.packageId,
        String(member.version),
        `${member.archiveSha256}.sensa`,
      ].join("/");
      assert.deepEqual(await readFile(join(repeatReleases, relative)), await readFile(join(releases, relative)));
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
