#!/usr/bin/env node
/** Convert the reviewed split English authoring batches into canonical Book sources. */
import {createHash} from "node:crypto";
import {mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

type TextValue = {text?: string};
type LegacyPackage = {
  schema_version: string;
  sense: {id: string; idea: string; avoid?: string; target: string};
  route: {target: string; support: string};
  target_core: {
    target_expression: {text: string};
    pronunciation: {
      ipa: string;
      audio: {asset: string; provider: string; voice: string; locale: string; sha256: string};
    };
    scene_realization: {
      example: string;
      audio: {asset: string; sha256: string};
    };
    optional?: Record<string, TextValue>;
  };
  support_overlay: {
    experience_recall_cue: {text: string};
    sense_confirmation: {text: string};
    scene_bridge: {text: string};
    scene_translation: {text: string};
    optional?: Record<string, TextValue>;
  };
  visual: {
    status: "ready" | "deferred" | "not_planned";
    alt_text?: string;
  };
  research_notes?: Array<{source?: string; url?: string}>;
};

const [sourceArgument, imageArgument, outputArgument, mediaArgument] = process.argv.slice(2);
if (!sourceArgument || !imageArgument || !outputArgument || process.argv.length > 6) {
  throw new Error(
    "Usage: migrate_english_lightweight.mts MATERIALIZED_ROOT IMAGE_BOOK.json OUTPUT_DIRECTORY [MEDIA_ROOT]",
  );
}

const sourceRoot = resolve(sourceArgument);
const outputRoot = resolve(outputArgument);
const mediaRoot = mediaArgument ? resolve(mediaArgument) : null;
const publishedAt = "2026-09-25T00:00:00Z";
const imageBook = JSON.parse(await readFile(resolve(imageArgument), "utf8"));
const imageBySense = new Map<string, {sha256: string; mimeType: "image/jpeg"}>();
for (const entry of imageBook.entries ?? []) {
  if (!entry.images?.length) continue;
  imageBySense.set(String(entry.key).replace(/^ids-/u, "ids:"), entry.images[0].media);
}

const stagedMedia = new Set<string>();
async function stageAudio(asset: string, sha256: string): Promise<void> {
  if (!mediaRoot || stagedMedia.has(sha256)) return;
  const bytes = await readFile(resolve(sourceRoot, "..", asset));
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw new Error(`Reviewed audio digest changed: ${asset}`);
  }
  const directory = join(mediaRoot, "audio");
  const destination = join(directory, `${sha256}.mp3`);
  await mkdir(directory, {recursive: true});
  try {
    await writeFile(destination, bytes, {flag: "wx"});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(destination);
    if (createHash("sha256").update(existing).digest("hex") !== sha256) {
      throw new Error(`Content-addressed media changed: ${destination}`);
    }
  }
  stagedMedia.add(sha256);
}

const irregularForms: Record<string, string[]> = {
  answer: ["answered"], ask: ["asked"], break: ["broke", "broken"], buy: ["bought"],
  carry: ["carried"], catch: ["catches", "caught"], enter: ["entered"], fall: ["fell", "fallen"],
  give: ["gave", "given"], hear: ["heard"], leave: ["left"], listen: ["listened"],
  open: ["opened"], pull: ["pulled"], push: ["pushed"], rise: ["rose", "risen"],
  run: ["ran"], sell: ["sold"], sit: ["sits", "sat"], stand: ["stands", "stood"],
  throw: ["throws", "threw", "thrown"], walk: ["walked"],
};

function candidateForms(expression: string): string[] {
  const forms = new Set([expression, ...(irregularForms[expression.toLocaleLowerCase()] ?? [])]);
  if (!expression.includes(" ")) {
    forms.add(`${expression}s`);
    forms.add(`${expression}ed`);
    forms.add(`${expression}ing`);
    if (expression.endsWith("e")) {
      forms.add(`${expression.slice(0, -1)}ed`);
      forms.add(`${expression.slice(0, -1)}ing`);
    }
    if (expression.endsWith("y")) forms.add(`${expression.slice(0, -1)}ied`);
    if (/(?:s|x|z|ch|sh)$/u.test(expression)) forms.add(`${expression}es`);
  }
  return [...forms].sort((left, right) => right.length - left.length);
}

function locateTarget(example: string, expression: string) {
  for (const form of candidateForms(expression)) {
    const start = example.toLocaleLowerCase().indexOf(form.toLocaleLowerCase());
    if (start >= 0) return {start, end: start + form.length, form: example.slice(start, start + form.length)};
  }
  throw new Error(`Could not locate ${expression} in ${example}`);
}

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;
const packagePaths = async (route: string) => (await readdir(join(sourceRoot, route, "packages")))
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => join(sourceRoot, route, "packages", name));

const canonicalZh = new Map<string, LegacyPackage>();
for (const path of await packagePaths("en--zh-CN")) {
  const value = await readJson<LegacyPackage>(path);
  canonicalZh.set(value.sense.id, value);
}
if (canonicalZh.size !== 100) throw new Error(`Expected 100 canonical zh-CN Senses, received ${canonicalZh.size}`);

const routeDirectories = (await readdir(sourceRoot, {withFileTypes: true}))
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("en--"))
  .map((entry) => entry.name)
  .sort();
if (routeDirectories.length !== 17) throw new Error(`Expected 17 English target routes, received ${routeDirectories.length}`);

await mkdir(outputRoot, {recursive: true});
const outputSummary: Array<{supportLanguage: string; entryCount: number; output: string}> = [];
for (const routeDirectory of routeDirectories) {
  const supportLanguage = routeDirectory.slice("en--".length);
  const entries = [];
  for (const path of await packagePaths(routeDirectory)) {
    const value = await readJson<LegacyPackage>(path);
    if (value.schema_version !== "sensa.lightweight-learning-package.authoring.v2"
      || value.route.target !== "en"
      || value.route.support !== supportLanguage) {
      throw new Error(`Unexpected authoring identity: ${path}`);
    }
    const canonical = canonicalZh.get(value.sense.id);
    if (!canonical) throw new Error(`Missing canonical semantic source: ${value.sense.id}`);
    const expression = value.target_core.target_expression.text.trim();
    await stageAudio(
      value.target_core.pronunciation.audio.asset,
      value.target_core.pronunciation.audio.sha256,
    );
    await stageAudio(
      value.target_core.scene_realization.audio.asset,
      value.target_core.scene_realization.audio.sha256,
    );
    const target = locateTarget(value.target_core.scene_realization.example, expression);
    const targetOptional = value.target_core.optional ?? {};
    const supportOptional = value.support_overlay.optional ?? {};
    const optionalText = (source: Record<string, TextValue>, key: string) => source[key]?.text?.trim();
    const usagePattern = [
      optionalText(targetOptional, "language_structure"),
      optionalText(supportOptional, "language_structure"),
      optionalText(targetOptional, "usage_guidance"),
      optionalText(supportOptional, "usage_guidance"),
    ].filter(Boolean).join("\n");
    const contrastNote = [
      optionalText(targetOptional, "boundary_contrast"),
      optionalText(supportOptional, "boundary_contrast"),
    ].filter(Boolean).join("\n");
    const featureLabels = [
      optionalText(targetOptional, "recall_support"),
      optionalText(supportOptional, "recall_support"),
      optionalText(targetOptional, "word_formation"),
      optionalText(supportOptional, "word_formation"),
      optionalText(targetOptional, "etymology"),
      optionalText(supportOptional, "etymology"),
    ].filter((item): item is string => Boolean(item));
    const sources = (value.research_notes ?? [])
      .filter((note) => note.source?.trim())
      .map((note) => ({
        title: note.source!.trim(),
        ...(note.url && /^https?:\/\//u.test(note.url) ? {url: note.url} : {}),
      }));
    const image = value.visual.status === "ready" ? imageBySense.get(value.sense.id) : undefined;
    if (value.visual.status === "ready" && (!image || !value.visual.alt_text)) {
      throw new Error(`Ready image is not available as a release-safe JPEG: ${value.sense.id}`);
    }
    entries.push({
      key: value.sense.id,
      packageVersion: 1,
      senseVersion: 1,
      bindingVersion: 1,
      expressionKind: expression.includes(" ") ? "phrase" : "word",
      expression,
      ...(target.form.toLocaleLowerCase() === expression.toLocaleLowerCase()
        ? {} : {acceptedForms: [target.form]}),
      meaning: value.sense.idea,
      senseConfirmation: value.support_overlay.sense_confirmation.text,
      scene: value.support_overlay.experience_recall_cue.text,
      ...(featureLabels.length ? {featureLabels} : {}),
      sceneBridge: value.support_overlay.scene_bridge.text,
      pronunciation: {
        audio: {sha256: value.target_core.pronunciation.audio.sha256, mimeType: "audio/mpeg"},
        phoneticNotation: value.target_core.pronunciation.ipa || null,
        accentLabel: value.target_core.pronunciation.audio.locale || null,
        source: [
          value.target_core.pronunciation.audio.provider,
          value.target_core.pronunciation.audio.voice,
        ].join("/"),
        method: "tts",
      },
      ...((usagePattern || contrastNote) ? {languageStructure: {
        expressionTypeLabel: expression.includes(" ") ? "phrase" : "word",
        partOfSpeech: null,
        ...(usagePattern ? {usagePattern} : {}),
        ...(contrastNote ? {contrastNote} : {}),
      }} : {}),
      sceneExample: {
        example: value.target_core.scene_realization.example,
        translation: value.support_overlay.scene_translation.text,
        audio: {sha256: value.target_core.scene_realization.audio.sha256, mimeType: "audio/mpeg"},
        targetStart: target.start,
        targetEnd: target.end,
      },
      ...(image ? {images: [{name: value.visual.alt_text!, media: image}]} : {}),
      ...(sources.length ? {sources} : {}),
      semanticSpec: {
        schemaVersion: "sensa-sense-semantic-spec-v1",
        coreMeaningFocus: canonical.sense.idea,
        prototypeScenes: [{
          summary: canonical.support_overlay.experience_recall_cue.text,
          participantRoles: [],
          states: [],
          directionOrCausality: null,
        }],
        includedCases: [canonical.target_core.scene_realization.example],
        excludedCases: canonical.sense.avoid ? [canonical.sense.avoid] : [],
        neighborContrasts: [],
        openQuestions: [],
      },
    });
  }
  const expected = supportLanguage === "zh-CN" ? 100 : supportLanguage === "ja" ? 17 : 10;
  if (entries.length !== expected) {
    throw new Error(`${routeDirectory} expected ${expected} entries, received ${entries.length}`);
  }
  const bookKey = `ids-lightweight-en-${supportLanguage.toLocaleLowerCase()}`;
  const output = join(outputRoot, `${bookKey}.json`);
  await writeFile(output, `${JSON.stringify({
    publisher: {namespace: "sensa.official", name: "Sensa Official"},
    author: {name: "Sensa Official"},
    license: {name: "All rights reserved"},
    bookKey,
    title: `IDS 轻量学习：英语 → ${supportLanguage}`,
    description: `以英语为目标语言、${supportLanguage} 为支持语言的常用共同概念学习包。`,
    versionNumber: 1,
    publishedAt,
    changeSummary: "将既有轻量学习成品纳入可复现的官方 Book 发布源。",
    targetLanguage: "en",
    supportLanguage,
    entries,
  }, null, 2)}\n`);
  outputSummary.push({supportLanguage, entryCount: entries.length, output});
}

console.log(JSON.stringify({status: "migrated", books: outputSummary.length, entries: outputSummary.reduce((sum, item) => sum + item.entryCount, 0), stagedMedia: stagedMedia.size, outputSummary}, null, 2));
