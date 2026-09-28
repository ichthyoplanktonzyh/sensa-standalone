import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import {join, resolve} from "node:path";

import {sensaLanguages, sensaSenseSemanticSpecSchema} from "@sensa/contracts/sensa";
import {test} from "vitest";

test("English target authored Books preserve every reviewed support route", async () => {
  const root = resolve("content/authored");
  const files = (await readdir(root))
    .filter((name) => name.startsWith("ids-lightweight-en-") && name.endsWith(".json"))
    .sort();
  const supports = sensaLanguages.map((language) => language.tag).filter((tag) => tag !== "en");
  assert.equal(files.length, supports.length);
  let total = 0;
  const semanticBySense = new Map<string, string>();
  for (const support of supports) {
    const bookKey = `ids-lightweight-en-${support.toLocaleLowerCase()}`;
    const file = `${bookKey}.json`;
    assert(files.includes(file), `missing ${file}`);
    const source = JSON.parse(await readFile(join(root, file), "utf8"));
    const expectedCount = support === "zh-CN" ? 100 : support === "ja" ? 17 : 10;
    assert.equal(source.publisher.namespace, "sensa.official");
    assert.equal(source.bookKey, bookKey);
    assert.equal(source.targetLanguage, "en");
    assert.equal(source.supportLanguage, support);
    assert.equal(source.entries.length, expectedCount, `${bookKey} lost reviewed Senses`);
    assert.equal(new Set(source.entries.map((entry: {key: string}) => entry.key)).size, expectedCount);
    for (const entry of source.entries) {
      assert.match(entry.key, /^ids:/u);
      assert(entry.pronunciation?.audio?.sha256);
      assert(entry.sceneExample?.audio?.sha256);
      assert(entry.senseConfirmation?.trim());
      const semantic = JSON.stringify(sensaSenseSemanticSpecSchema.parse(entry.semanticSpec));
      const previous = semanticBySense.get(entry.key);
      if (previous === undefined) semanticBySense.set(entry.key, semantic);
      else assert.equal(semantic, previous, `${entry.key} changed identity across support languages`);
    }
    total += source.entries.length;
  }
  assert.equal(total, 267);
  assert.equal(semanticBySense.size, 100);
});
