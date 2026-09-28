#!/usr/bin/env node
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

import {sensaLanguages, sensaPortableLearningContentRegistrySchema} from "@sensa/contracts/sensa";

const path = process.argv[2];
if (!path || process.argv[3]) {
  throw new Error("Usage: assert_english_lightweight_registry.mts REGISTRY.json");
}

const registry = sensaPortableLearningContentRegistrySchema.parse(
  JSON.parse(await readFile(resolve(path), "utf8")),
);
const expectedSupports = sensaLanguages.map((language) => language.tag).filter((tag) => tag !== "en");
const expectedCounts = new Map(expectedSupports.map((support) => [
  support,
  support === "zh-CN" ? 100 : support === "ja" ? 17 : 10,
]));
const books = registry.items.filter((item) => item.book.bookKey.startsWith("ids-lightweight-en-"));

assert.equal(books.length, expectedSupports.length, "Registry lost an English target Book");
for (const support of expectedSupports) {
  const bookKey = `ids-lightweight-en-${support.toLocaleLowerCase()}`;
  const matches = books.filter((item) => item.book.bookKey === bookKey);
  assert.equal(matches.length, 1, `${bookKey} must have exactly one published Book version`);
  const [descriptor] = matches;
  assert.equal(descriptor!.route.targetLanguage, "en", `${bookKey} target language changed`);
  assert.equal(descriptor!.route.supportLanguage, support, `${bookKey} support language changed`);
  assert.equal(
    descriptor!.memberCount,
    expectedCounts.get(support),
    `${bookKey} was replaced by an incomplete release`,
  );
}

assert.equal(
  books.reduce((sum, item) => sum + item.memberCount, 0),
  267,
  "English target Book membership changed",
);
console.log("PASS 17 English target Books retain 267 published Sense packages.");
