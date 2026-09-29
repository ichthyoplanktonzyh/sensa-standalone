import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";

import {test} from "vitest";

import {readSensaPortableBook} from "@sensa/content-validator/portable-book";
import {stableUuid} from "@sensa/learning-kernel";
import {
  canonicalConsumerJson,
  maxPortableBookArchiveBytes,
  maxPortableBookMembers,
  sensaPortableBookDescriptorSchema,
  sensaPortableBookManifestSchema,
  sensaPortableLearningContentRegistrySchema,
} from "@sensa/contracts/sensa";

import {createAuthoredMediaPackager} from "../../../scripts/release/authoredMedia.mts";
import {syntheticSound} from "../../../scripts/support/lightweightMaterialFixture.mts";
import {contentSupplySystem} from "../../../apps/web/src/contentSupply/system/index.ts";
import {portablePackageInstallationFor} from "../../../apps/web/src/data/library/packageRecords.ts";
import {
  command,
  openLibrary,
  readLibrary,
  writeLibraryCache,
} from "../../../apps/web/src/data/library/store.ts";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

test("one atomic Book contract can carry a 5,000-Sense curriculum", () => {
  const memberCount = 5_000;
  const manifest = sensaPortableBookManifestSchema.parse({
    format:"sensa-portable-book-v1",
    publisher:{namespace:"sensa.fixture",name:"Sensa Fixture"},
    book:{
      bookId:stableUuid("fixture:large-book"),
      bookKey:"large-book-fixture",
      bookVersionId:stableUuid("fixture:large-book:v1"),
      versionNumber:1,
      title:"Large Book Fixture",
      description:"Contract boundary for a large, atomic curriculum.",
    },
    contentRelease:{
      contentReleaseId:stableUuid("fixture:large-book:release:v1"),
      versionNumber:1,
      schemaVersion:"sensa-portable-lightweight-package-v2",
    },
    route:{targetLanguage:"en",supportLanguage:"zh-CN"},
    publishedAt:"2026-09-30T00:00:00.000Z",
    changeSummary:"Initial fixture release.",
    semanticAttestation:{
      kind:"publisher-attestation",
      publisherNamespace:"sensa.fixture",
      subject:"member-semantic-declarations",
    },
    members:Array.from({length:memberCount},(_,index)=>({
      packageId:stableUuid(`fixture:large-book:member:${index}`),
      version:1,
    })),
  });
  assert.equal(manifest.members.length,memberCount);
  assert(memberCount<=maxPortableBookMembers);
});

test("official Registry delivers one atomic Book while preserving independent Sense packages", async () => {
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
    const bookRelative = [
      "books",
      descriptor.book.bookId,
      descriptor.book.bookVersionId,
      `${descriptor.sha256}.sensa-book`,
    ].join("/");
    const bookBytes = await readFile(join(releases, bookRelative));
    const bookArchive = readSensaPortableBook(bookBytes);
    const manifest = bookArchive.manifest;
    assert.equal(descriptor.url, new URL(bookRelative, base).href);
    assert.equal(descriptor.byteLength, bookBytes.byteLength);
    assert.equal(descriptor.sha256, digest(bookBytes));
    assert.equal(manifest.semanticAttestation.publisherNamespace, descriptor.publisher.namespace);
    assert.equal(manifest.members.length, 3);

    const delivered = new Map<string, Uint8Array>([[descriptor.url, bookBytes]]);

    for (const {member,archive} of bookArchive.members) {
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
    const conflictingMember=bookArchive.members.at(-1)!;
    const conflictingInstallation=portablePackageInstallationFor(
      conflictingMember.archive.package,
      "0".repeat(64),
      conflictingMember.archive.packageDigest,
      conflictingMember.bytes.byteLength,
      descriptor.sha256,
    );
    await command({id:crypto.randomUUID(),kind:"fixture.conflict",input:{}},async tx=>{
      tx.put("packageInstallations",conflictingInstallation.key,conflictingInstallation);
    });
    await assert.rejects(contentSupplySystem.execute({
      kind:"install_catalog_item",
      descriptor,
      signal:new AbortController().signal,
    }),/localFlow\.packageVersionChanged/u);
    assert.equal(
      await readLibrary(tx=>tx.count("packageCache")),
      0,
      "a conflict in the final member must roll back the complete Book installation",
    );
    await command({id:crypto.randomUUID(),kind:"fixture.cleanup",input:{}},async tx=>{
      tx.delete("packageInstallations",conflictingInstallation.key);
    });
    const localMember=bookArchive.members[0]!;
    const localInstallation=portablePackageInstallationFor(
      localMember.archive.package,
      localMember.archive.archiveDigest,
      localMember.archive.packageDigest,
      localMember.bytes.byteLength,
    );
    await command({id:crypto.randomUUID(),kind:"fixture.local-installation",input:{}},async tx=>{
      tx.put("packageInstallations",localInstallation.key,localInstallation);
    });
    assert.equal(
      (await readLibrary(tx=>tx.get<any>("packageInstallations",localInstallation.key)))?.artifact?.bookArchiveSha256,
      undefined,
    );
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
      assert.equal(pack.portableOrigin.publications[0]?.bookArchiveSha256,descriptor.sha256);
    }
    const localInstallationKey=installed.find(pack=>
      pack.portableOrigin.manifest.metadata.packageId===localMember.member.packageId)!.key;
    assert.equal(
      (await readLibrary(tx=>tx.get<any>("packageInstallations",localInstallationKey)))?.artifact?.bookArchiveSha256,
      descriptor.sha256,
      "an exact local import must gain a public recovery source without conflicting",
    );
    const installedKeys=installed.map(pack=>pack.key).sort();
    await writeLibraryCache(async tx=>{
      tx.clear("packageCache");
      tx.put("meta","package-catalog",{
        format:"sensa-local-registry-cache-v3",
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
      sensaPortableBookDescriptorSchema.parse({
        ...descriptor,
        byteLength: maxPortableBookArchiveBytes,
      }).byteLength,
      maxPortableBookArchiveBytes,
    );
    assert.throws(() => sensaPortableBookDescriptorSchema.parse({
      ...descriptor,
      byteLength: maxPortableBookArchiveBytes + 1,
    }), /Too big/u);
    assert.throws(() => sensaPortableLearningContentRegistrySchema.parse({
      ...registry,
      items: [descriptor, descriptor],
    }), /Duplicate public Book version/u);
    assert.throws(() => sensaPortableLearningContentRegistrySchema.parse({
      ...registry,
      items: [descriptor, {
        ...descriptor,
        publisher: {...descriptor.publisher, namespace: "another-publisher"},
        book: {
          ...descriptor.book,
          bookId: "729ea821-bc15-4c5f-9e9c-2bbfe38487c9",
          bookVersionId: "616af0ce-e28c-4fa2-9653-7b7aec90cc7c",
        },
      }],
    }), /Public Book keys must be unique/u);

    const repeated = runBuilder(repeatReleases, repeatRegistryPath);
    assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
    assert.equal(
      (await readFile(repeatRegistryPath)).toString("utf8"),
      registryBytes.toString("utf8"),
      "the same authored release must rebuild byte-for-byte",
    );
    assert.deepEqual(
      await readFile(join(repeatReleases,bookRelative)),
      bookBytes,
      "the same authored Book must rebuild as the same archive bytes",
    );

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
