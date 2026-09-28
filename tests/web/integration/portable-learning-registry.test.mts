import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";

import {test} from "vitest";

import {readSensaPortableLightweightPackage} from "@sensa/content-validator/portable-lightweight";
import {stableUuid} from "@sensa/learning-kernel";
import {
  canonicalConsumerJson,
  maxBookVersionManifestBytes,
  sensaBookVersionManifestDescriptorSchema,
  sensaBookVersionManifestSchema,
  sensaPortableLearningContentRegistrySchema,
} from "@sensa/contracts/sensa";

import {createAuthoredMediaPackager} from "../../../scripts/release/authoredMedia.mts";
import {syntheticSound} from "../../../scripts/support/lightweightMaterialFixture.mts";
import {contentSupplySystem} from "../../../apps/web/src/contentSupply/system/index.ts";
import {
  command,
  openLibrary,
  readLibrary,
  writeLibraryCache,
} from "../../../apps/web/src/data/library/store.ts";

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
  const realFetch = globalThis.fetch;
  try {
    const source = JSON.parse(await readFile("content/authored/web-starter.json", "utf8"));
    source.entries[0].key = "ids:1-310";
    source.entries[0].scene = `A public author may reveal ${source.entries[0].expression} in a cue.`;
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

    const runBuilder = (
      output: string,
      catalog: string,
      selectedSource = sourcePath,
      existingCatalog?: string,
    ) => spawnSync(
      process.execPath,
      ["--import", "tsx", resolve("scripts/release/buildPortableBookRegistry.mts")],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...process.env,
          SENSA_BOOK_RELEASE_SOURCES: selectedSource,
          SENSA_AUTHORED_MEDIA_ROOT: join(root, "absent-media"),
          SENSA_AUTHORED_MEDIA_PACK: mediaPackPath,
          SENSA_PACKAGE_OUTPUT: output,
          SENSA_PACKAGE_CATALOG_OUTPUT: catalog,
          SENSA_PACKAGE_BASE_URL: base,
          SENSA_WEB_ORIGIN: "https://app.example.test",
          ...(existingCatalog ? {SENSA_PACKAGE_EXISTING_CATALOG: existingCatalog} : {}),
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

    const delivered = new Map<string, Uint8Array>([[descriptor.url, manifestBytes]]);

    for (const member of manifest.members) {
      const packageRelative = [
        "packages",
        member.packageId,
        String(member.version),
        `${member.archiveSha256}.sensa`,
      ].join("/");
      const packageBytes = await readFile(join(releases, packageRelative));
      delivered.set(member.url, packageBytes);
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
      if (archive.package.semanticDeclaration?.sense.senseKey === "ids:1-310") {
        const declaration = archive.package.semanticDeclaration;
        const expressionId = stableUuid(
          `sensa:expression:${source.targetLanguage}:${archive.package.targetExpression.text.toLocaleLowerCase()}`,
        );
        const bindingId = stableUuid(`sensa:ids:binding:ids:1-310:${expressionId}`);
        assert.equal(declaration.sense.senseId, stableUuid("sensa:ids:sense:ids:1-310"));
        assert.equal(declaration.expression.expressionId, expressionId);
        assert.equal(declaration.binding.senseExpressionBindingId, bindingId);
        assert.equal(
          archive.package.metadata.packageId,
          stableUuid(`sensa:official:ids-lightweight:ids:1-310:${source.targetLanguage}:${source.supportLanguage}`),
        );
      }
    }

    Object.assign(globalThis,{
      window:new EventTarget(),
      location:new URL("https://sensa.local/"),
      BroadcastChannel:undefined,
    });
    globalThis.fetch=async input=>{
      const bytes=delivered.get(String(input));
      return bytes
        ?new Response(bytes)
        :new Response(null,{status:404});
    };
    await openLibrary();
    await command({id:crypto.randomUUID(),kind:"fixture.owner",input:{}},async tx=>{
      tx.put("meta","service-owner",{
        subject:crypto.randomUUID(),
        accountId:crypto.randomUUID(),
      });
    });
    const progress:number[]=[];
    const installed=await contentSupplySystem.execute({
      kind:"install_catalog_item",
      descriptor,
      signal:new AbortController().signal,
      onProgress:value=>progress.push(value),
    });
    assert.equal(installed.length,manifest.members.length);
    assert.equal(progress.at(0),0);
    assert.equal(progress.at(-1),1);
    for(const pack of installed){
      const declaration=pack.portableOrigin.manifest.semanticDeclaration;
      const entry=pack.content.entries[0]!;
      assert(declaration);
      assert.equal(entry.senseId,declaration.sense.senseId);
      assert.equal(entry.senseVersionId,declaration.sense.senseVersionId);
      assert.equal(entry.bindingId,declaration.binding.senseExpressionBindingId);
      assert.equal(entry.bindingVersionId,declaration.binding.bindingVersionId);
      assert.equal(entry.semantic?.senseKey,declaration.sense.senseKey);
      assert.equal(pack.portableOrigin.publications[0]?.manifestSha256,descriptor.sha256);
    }
    const installedKeys=installed.map(pack=>pack.key).sort();
    await writeLibraryCache(async tx=>{
      tx.clear("packageCache");
      tx.put("meta","package-catalog",{
        format:"sensa-local-registry-cache-v2",
        items:[descriptor],
        revision:registry.revision,
        checkedAt:new Date().toISOString(),
      });
    });
    assert.equal(await readLibrary(tx=>tx.count("packageCache")),0);
    assert.deepEqual(await contentSupplySystem.execute({kind:"rehydrate"}),{
      ready:installedKeys,
      blocked:[],
      failed:[],
    });
    assert.equal(await readLibrary(tx=>tx.count("packageCache")),manifest.members.length);

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

    const nextSourcePath = join(root, "next-source.json");
    await writeFile(nextSourcePath, JSON.stringify({
      ...source,
      bookKey: "portable-registry-next-book",
      title: "Portable Registry Next Book",
    }));
    const mergedReleases = join(root, "merged-releases");
    const mergedRegistryPath = join(root, "merged-catalog.json");
    const merged = runBuilder(mergedReleases, mergedRegistryPath, nextSourcePath, registryPath);
    assert.equal(merged.status, 0, merged.stderr || merged.stdout);
    const mergedRegistry = sensaPortableLearningContentRegistrySchema.parse(
      JSON.parse(await readFile(mergedRegistryPath, "utf8")),
    );
    assert.equal(mergedRegistry.items.length, 2);
    assert.deepEqual(
      mergedRegistry.items.find((item) => item.book.bookKey === descriptor.book.bookKey),
      descriptor,
      "an incremental release keeps the existing immutable descriptor unchanged",
    );
  } finally {
    globalThis.fetch=realFetch;
    await rm(root, {recursive: true, force: true});
  }
});
