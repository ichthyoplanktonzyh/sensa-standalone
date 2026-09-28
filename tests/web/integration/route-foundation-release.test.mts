import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {test} from "vitest";

import {sensaLanguages} from "@sensa/contracts/sensa";

test("the fixed route foundation expands into every supported language route", async () => {
  const root = await mkdtemp(join(tmpdir(), "sensa-route-foundation-release-"));
  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      resolve("content/tools/route_foundation.mts"),
      "expand",
      resolve("content/authored/route-foundation-v1/prepared.json"),
      root,
    ], {cwd: resolve("."), encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const files = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
    assert.equal(files.length, sensaLanguages.length ** 2);

    const routes = new Set<string>();
    for (const file of files) {
      const source = JSON.parse(await readFile(join(root, file), "utf8"));
      routes.add(`${source.targetLanguage}->${source.supportLanguage}`);
      assert.equal(source.entries.length, 3, `${file} lost a foundation Sense`);
      assert.equal(source.bookKey, `ids-route-foundation-${source.targetLanguage.toLocaleLowerCase()}-${source.supportLanguage.toLocaleLowerCase()}`);
    }
    assert.equal(routes.size, sensaLanguages.length ** 2);
    for (const target of sensaLanguages) {
      for (const support of sensaLanguages) {
        assert(routes.has(`${target.tag}->${support.tag}`), `missing ${target.tag}->${support.tag}`);
      }
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("the media pack builder accepts the same derived source directory as the Registry builder", async () => {
  const root = await mkdtemp(join(tmpdir(), "sensa-media-directory-release-"));
  try {
    const sources = join(root, "sources");
    const mediaRoot = join(root, "media");
    const output = join(root, "authored-media-pack.json");
    const bytes = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await mkdir(sources, {recursive: true});
    await mkdir(join(mediaRoot, "audio"), {recursive: true});
    await writeFile(join(sources, "fixture.json"), JSON.stringify({audio: {sha256, mimeType: "audio/mpeg"}}));
    await writeFile(join(mediaRoot, "audio", `${sha256}.mp3`), bytes);

    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      resolve("scripts/release/buildAuthoredMediaPack.mts"),
    ], {
      cwd: resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        SENSA_BOOK_RELEASE_SOURCE_DIRECTORY: sources,
        SENSA_AUTHORED_MEDIA_ROOT: mediaRoot,
        SENSA_AUTHORED_MEDIA_PACK_OUTPUT: output,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const pack = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(pack, {
      format: "sensa-authored-media-pack-v1",
      objects: [{sha256, mimeType: "audio/mpeg", base64: bytes.toString("base64")}],
    });
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
