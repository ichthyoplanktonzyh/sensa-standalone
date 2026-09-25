#!/usr/bin/env node
import {createHash} from "node:crypto";
import {mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {basename, dirname, extname, join, resolve} from "node:path";

import {sensaLanguages, sensaSenseSemanticSpecSchema} from "@sensa/contracts/sensa";
import {z} from "zod";

const contributionFormat = "sensa-route-foundation-language-contribution-v1" as const;
const preparedFormat = "sensa-route-foundation-prepared-v1" as const;
const expectedSenses = [
  {senseId: "ids:1-310", concept: "WATER"},
  {senseId: "ids:5-130", concept: "DRINK"},
  {senseId: "ids:11-620", concept: "BORROW"},
] as const;
const supportedLanguages = sensaLanguages.map((language) => language.tag);
const languageSchema = z.enum(supportedLanguages as [string, ...string[]]);
const text = (maximum: number) => z.string().trim().min(1).max(maximum);

const targetCoreShape = {
  expression: text(200),
  expressionKind: z.enum(["word", "phrase"]),
  spokenForm: text(200).nullable(),
  acceptedForms: z.array(text(200)).max(12),
  sceneExample: text(1_000),
  sceneOccurrence: text(200),
} as const;
type TargetCore = z.infer<z.ZodObject<typeof targetCoreShape>>;

function refineTargetCore(core: TargetCore, context: z.RefinementCtx): void {
  if (!core.sceneExample.includes(core.sceneOccurrence)) {
    context.addIssue({
      code: "custom",
      path: ["sceneOccurrence"],
      message: "sceneOccurrence must be an exact sceneExample substring",
    });
  }
  const realizations = [core.expression, core.spokenForm, ...core.acceptedForms]
    .filter((value): value is string => value !== null);
  if (!realizations.includes(core.sceneOccurrence)) {
    context.addIssue({
      code: "custom",
      path: ["sceneOccurrence"],
      message: "sceneOccurrence must be the expression, spokenForm or an acceptedForm",
    });
  }
  if (new Set(core.acceptedForms).size !== core.acceptedForms.length) {
    context.addIssue({code: "custom", path: ["acceptedForms"], message: "acceptedForms must be unique"});
  }
}

const targetCoreSchema = z.object(targetCoreShape).strict().superRefine(refineTargetCore);
const supportOverlaySchema = z.object({
  meaning: text(1_000),
  experienceRecallCue: text(2_000),
  senseConfirmation: text(1_000),
  sceneBridgeTemplate: text(2_000),
  sceneTranslation: text(2_000),
}).strict().superRefine((overlay, context) => {
  if (overlay.sceneBridgeTemplate.split("{expression}").length !== 2) {
    context.addIssue({
      code: "custom",
      path: ["sceneBridgeTemplate"],
      message: "sceneBridgeTemplate must contain {expression} exactly once",
    });
  }
});
const contributionSchema = z.object({
  format: z.literal(contributionFormat),
  language: languageSchema,
  senses: z.array(z.object({
    senseId: text(100),
    concept: text(100),
    targetCore: targetCoreSchema,
    supportOverlay: supportOverlaySchema,
  }).strict()).length(expectedSenses.length),
}).strict();

const audioReferenceSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  mimeType: z.literal("audio/mpeg"),
  source: text(2_000),
  accentLabel: text(100),
}).strict();
const preparedTargetCoreSchema = z.object({
  ...targetCoreShape,
  expressionAudio: audioReferenceSchema,
  sceneAudio: audioReferenceSchema,
}).strict().superRefine(refineTargetCore);
const preparedContributionSchema = z.object({
  format: z.literal(contributionFormat),
  language: languageSchema,
  senses: z.array(z.object({
    senseId: text(100),
    concept: text(100),
    targetCore: preparedTargetCoreSchema,
    supportOverlay: supportOverlaySchema,
  }).strict()).length(expectedSenses.length),
}).strict();
const preparedSchema = z.object({
  format: z.literal(preparedFormat),
  contributions: z.array(preparedContributionSchema).length(supportedLanguages.length),
}).strict();

type Contribution = z.infer<typeof contributionSchema>;
type Prepared = z.infer<typeof preparedSchema>;
type AudioReference = z.infer<typeof audioReferenceSchema>;

const semanticSpecs = new Map([
  ["ids:1-310", sensaSenseSemanticSpecSchema.parse({
    schemaVersion: "sensa-sense-semantic-spec-v1",
    coreMeaningFocus: "Ordinary water used for drinking and cooking.",
    prototypeScenes: [{
      summary: "A thirsty person politely asks for a glass of water.",
      participantRoles: ["person asking", "water requested"],
      states: ["the person is thirsty", "water is available to drink"],
      directionOrCausality: "Thirst leads the person to ask for water.",
    }],
    includedCases: ["water served as a drink", "water used in cooking"],
    excludedCases: ["juice or another flavored drink", "a body of water as a place"],
    neighborContrasts: [],
    openQuestions: [],
  })],
  ["ids:5-130", sensaSenseSemanticSpecSchema.parse({
    schemaVersion: "sensa-sense-semantic-spec-v1",
    coreMeaningFocus: "Take liquid into the mouth and swallow it.",
    prototypeScenes: [{
      summary: "A thirsty person wants to take in and swallow some water.",
      participantRoles: ["person drinking", "liquid consumed"],
      states: ["the liquid is outside the body", "the person swallows the liquid"],
      directionOrCausality: "The person takes liquid into the mouth and swallows it.",
    }],
    includedCases: ["drinking water", "drinking tea"],
    excludedCases: ["eating solid food", "holding liquid without swallowing"],
    neighborContrasts: [],
    openQuestions: [],
  })],
  ["ids:11-620", sensaSenseSemanticSpecSchema.parse({
    schemaVersion: "sensa-sense-semantic-spec-v1",
    coreMeaningFocus: "Temporarily take and use something controlled by someone else, with an expectation of returning it, from the receiver's perspective.",
    prototypeScenes: [{
      summary: "A person needs a friend's book for a short time and will return it.",
      participantRoles: ["temporary receiver", "provider", "item to be returned"],
      states: ["the item is controlled by the provider", "the receiver uses it temporarily", "the item is expected to return"],
      directionOrCausality: "The item moves temporarily from provider to receiver without a change of ownership.",
    }],
    includedCases: ["borrowing a book from a friend", "temporarily using another person's tool"],
    excludedCases: ["lending one's own item", "buying or receiving an item permanently"],
    neighborContrasts: [{label: "lend", distinction: "Lend describes the same temporary transfer from the provider's perspective."}],
    openQuestions: [],
  })],
]);

function usage(): never {
  throw new Error([
    "Usage:",
    "  route_foundation.mts validate CONTRIBUTIONS_DIRECTORY [--require-all]",
    "  route_foundation.mts prepare CONTRIBUTIONS_DIRECTORY PREPARED.json [--allow-tts]",
    "  route_foundation.mts expand PREPARED.json OUTPUT_DIRECTORY",
  ].join("\n"));
}

function caseFold(value: string, language: string): string {
  try {
    return value.toLocaleLowerCase(language);
  } catch {
    return value.toLocaleLowerCase();
  }
}

function validateSenseOrder(contribution: Contribution | Prepared["contributions"][number], path: string): void {
  contribution.senses.forEach((sense, index) => {
    const expected = expectedSenses[index]!;
    if (sense.senseId !== expected.senseId || sense.concept !== expected.concept) {
      throw new Error(`${path}: sense ${index + 1} must be ${expected.senseId}/${expected.concept}`);
    }
    const cue = caseFold(sense.supportOverlay.experienceRecallCue, contribution.language);
    const targetForms = [sense.targetCore.expression, sense.targetCore.spokenForm, ...sense.targetCore.acceptedForms]
      .filter((form): form is string => form !== null && form.trim().length > 0);
    const leaked = targetForms.find((form) => cue.includes(caseFold(form, contribution.language)));
    if (leaked !== undefined) {
      throw new Error(`${path}: ${sense.senseId} recall cue leaks target form ${JSON.stringify(leaked)}`);
    }
  });
}

function validateContribution(value: unknown, path: string): Contribution {
  const contribution = contributionSchema.parse(value);
  const expectedFile = `${contribution.language}.json`;
  if (basename(path) !== expectedFile) throw new Error(`${path}: contribution language requires filename ${expectedFile}`);
  validateSenseOrder(contribution, path);
  return contribution;
}

function validateLanguageSet(languages: readonly string[], requireAll: boolean): void {
  if (new Set(languages).size !== languages.length) throw new Error("Contribution languages must be unique");
  if (!requireAll) return;
  const missing = supportedLanguages.filter((language) => !languages.includes(language));
  const extra = languages.filter((language) => !supportedLanguages.includes(language));
  if (missing.length || extra.length) {
    throw new Error(`Language matrix mismatch: missing=${missing.join(",")} extra=${extra.join(",")}`);
  }
}

async function loadContributions(directoryArgument: string, requireAll: boolean): Promise<Contribution[]> {
  const directory = resolve(directoryArgument);
  const paths = (await readdir(directory, {withFileTypes: true}))
    .filter((entry) => entry.isFile() && extname(entry.name) === ".json")
    .map((entry) => join(directory, entry.name))
    .sort();
  if (paths.length === 0) throw new Error("At least one language contribution is required");
  const contributions = [];
  for (const path of paths) contributions.push(validateContribution(JSON.parse(await readFile(path, "utf8")), path));
  validateLanguageSet(contributions.map((contribution) => contribution.language), requireAll);
  return contributions;
}

function decodeAudioDataUrl(dataUrl: string): Uint8Array {
  const match = /^data:audio\/mpeg;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  if (!match) throw new Error("Edge TTS returned a non-canonical MP3 data URL");
  const bytes = Buffer.from(match[1]!, "base64");
  if (bytes.toString("base64") !== match[1]) throw new Error("Edge TTS returned non-canonical base64");
  return bytes;
}

async function saveContentAddressedAudio(dataUrl: string, source: string, accentLabel: string | null): Promise<AudioReference> {
  if (!accentLabel) throw new Error("Edge TTS did not report an accent locale");
  const bytes = decodeAudioDataUrl(dataUrl);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = resolve("content/data/media/audio", `${sha256}.mp3`);
  await mkdir(dirname(path), {recursive: true});
  try {
    await writeFile(path, bytes, {flag: "wx"});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(path);
    if (!existing.equals(bytes)) throw new Error(`Content-addressed media collision: ${path}`);
  }
  return {sha256, mimeType: "audio/mpeg", source, accentLabel};
}

async function prepare(contributions: Contribution[], outputArgument: string, allowTts: boolean): Promise<void> {
  const {edgeSpeechProvider} = await import("../../scripts/local/speechProvider.mts");
  const provider = edgeSpeechProvider(allowTts);
  const preparedAudio = new Map<string, AudioReference>();
  const jobs = contributions.flatMap((contribution) => contribution.senses.flatMap((sense) => [
    {key: `${contribution.language}\0${sense.senseId}\0expression`, language: contribution.language, text: sense.targetCore.spokenForm ?? sense.targetCore.expression},
    {key: `${contribution.language}\0${sense.senseId}\0scene`, language: contribution.language, text: sense.targetCore.sceneExample},
  ]));
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const sound = await provider({surface: job.text, languageTag: job.language}, AbortSignal.timeout(60_000));
      preparedAudio.set(job.key, await saveContentAddressedAudio(sound.audioUrl, sound.source, sound.accentLabel));
    }
  };
  await Promise.all([worker(), worker()]);
  const prepared = preparedSchema.parse({
    format: preparedFormat,
    contributions: contributions.map((contribution) => ({
      ...contribution,
      senses: contribution.senses.map((sense) => ({
        ...sense,
        targetCore: {
          ...sense.targetCore,
          expressionAudio: preparedAudio.get(`${contribution.language}\0${sense.senseId}\0expression`),
          sceneAudio: preparedAudio.get(`${contribution.language}\0${sense.senseId}\0scene`),
        },
      })),
    })),
  });
  prepared.contributions.forEach((contribution) => validateSenseOrder(contribution, contribution.language));
  const output = resolve(outputArgument);
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, `${JSON.stringify(prepared, null, 2)}\n`);
  console.log(JSON.stringify({status: "prepared", languageCount: prepared.contributions.length, targetCoreCount: 54, audioCount: 108, output}, null, 2));
}

function authoredEntry(target: Prepared["contributions"][number], support: Prepared["contributions"][number], index: number) {
  const targetSense = target.senses[index]!;
  const supportSense = support.senses[index]!;
  if (targetSense.senseId !== supportSense.senseId) throw new Error("Contribution Sense order changed");
  const core = targetSense.targetCore;
  const overlay = supportSense.supportOverlay;
  const targetStart = core.sceneExample.indexOf(core.sceneOccurrence);
  if (targetStart < 0) throw new Error(`Scene occurrence missing: ${target.language}/${targetSense.senseId}`);
  const semanticSpec = semanticSpecs.get(targetSense.senseId);
  if (!semanticSpec) throw new Error(`Semantic specification missing: ${targetSense.senseId}`);
  return {
    key: targetSense.senseId,
    packageVersion: 1,
    senseVersion: 1,
    bindingVersion: 1,
    expressionKind: core.expressionKind,
    expression: core.expression,
    ...(core.spokenForm ? {spokenForm: core.spokenForm} : {}),
    ...(core.acceptedForms.length ? {acceptedForms: core.acceptedForms} : {}),
    meaning: overlay.meaning,
    scene: overlay.experienceRecallCue,
    sceneBridge: overlay.sceneBridgeTemplate.replace("{expression}", core.expression),
    pronunciation: {audio: {sha256: core.expressionAudio.sha256, mimeType: core.expressionAudio.mimeType}, phoneticNotation: null, accentLabel: core.expressionAudio.accentLabel, source: core.expressionAudio.source, method: "tts"},
    sceneExample: {example: core.sceneExample, translation: overlay.sceneTranslation, targetStart, targetEnd: targetStart + core.sceneOccurrence.length, audio: {sha256: core.sceneAudio.sha256, mimeType: core.sceneAudio.mimeType}},
    semanticSpec,
  };
}

async function expand(preparedArgument: string, outputArgument: string): Promise<void> {
  const prepared = preparedSchema.parse(JSON.parse(await readFile(resolve(preparedArgument), "utf8")));
  prepared.contributions.forEach((contribution) => validateSenseOrder(contribution, contribution.language));
  validateLanguageSet(prepared.contributions.map((contribution) => contribution.language), true);
  const output = resolve(outputArgument);
  await mkdir(output, {recursive: true});
  const expectedFiles = new Set<string>();
  let memberCount = 0;
  for (const target of prepared.contributions) {
    for (const support of prepared.contributions) {
      if (target.language === "en" && support.language !== "en") continue;
      const filename = `${target.language}--${support.language}.json`;
      expectedFiles.add(filename);
      const source = {
        title: `IDS Route Foundation: ${target.language} / ${support.language}`,
        description: `Three shared everyday Senses for target ${target.language} with support ${support.language}.`,
        publisher: {namespace: "sensa.official", name: "Sensa Official"},
        author: {name: "Sensa Official"},
        license: {name: "All rights reserved"},
        bookKey: `ids-route-foundation-${target.language.toLocaleLowerCase()}-${support.language.toLocaleLowerCase()}`,
        versionNumber: 1,
        publishedAt: "2026-09-25T00:00:00Z",
        changeSummary: "Adds WATER, DRINK and BORROW as a minimal route-coverage foundation.",
        targetLanguage: target.language,
        supportLanguage: support.language,
        entries: expectedSenses.map((_, senseIndex) => authoredEntry(target, support, senseIndex)),
      };
      await writeFile(join(output, filename), `${JSON.stringify(source, null, 2)}\n`);
      memberCount += source.entries.length;
    }
  }
  const stale = (await readdir(output, {withFileTypes: true}))
    .filter((entry) => entry.isFile() && extname(entry.name) === ".json" && !expectedFiles.has(entry.name))
    .map((entry) => entry.name);
  if (stale.length) throw new Error(`Derived source directory contains stale files: ${stale.join(",")}`);
  console.log(JSON.stringify({status: "expanded", routeBookCount: expectedFiles.size, memberCount, reusedEnglishRouteCount: 17, output}, null, 2));
}

const command = process.argv[2];
if (command === "validate") {
  const directory = process.argv[3];
  if (!directory || process.argv.slice(4).some((flag) => flag !== "--require-all")) usage();
  const contributions = await loadContributions(directory, process.argv.includes("--require-all"));
  console.log(JSON.stringify({status: "satisfied", format: contributionFormat, contributionCount: contributions.length, senseCount: contributions.length * 3, languages: contributions.map((contribution) => contribution.language), complete: contributions.length === supportedLanguages.length}, null, 2));
} else if (command === "prepare") {
  const directory = process.argv[3];
  const output = process.argv[4];
  if (!directory || !output || process.argv.slice(5).some((flag) => flag !== "--allow-tts")) usage();
  await prepare(await loadContributions(directory, true), output, process.argv.includes("--allow-tts"));
} else if (command === "expand") {
  const prepared = process.argv[3];
  const output = process.argv[4];
  if (!prepared || !output || process.argv[5] !== undefined) usage();
  await expand(prepared, output);
} else {
  usage();
}
