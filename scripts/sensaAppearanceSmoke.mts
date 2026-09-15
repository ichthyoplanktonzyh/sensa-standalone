import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import {
  colorModeCatalog,
  defaultAppearancePreference,
  parseAppearancePreference,
  resolveAppearance,
  semanticDesignContractVersion,
  skinCatalog,
  textSizeCatalog,
} from "../apps/web/src/experience/appearance/contract.ts";

assert.deepEqual(skinCatalog.map(({ id }) => id), ["quiet", "clear"]);
assert.equal(new Set(skinCatalog.map(({ id }) => id)).size, skinCatalog.length);
for (const skin of skinCatalog) {
  assert.equal(skin.contractVersion, semanticDesignContractVersion);
  assert.match(skin.version, /^\d+\.\d+\.\d+$/u);
}
assert.deepEqual(colorModeCatalog, ["system", "light", "dark"]);
assert.deepEqual(textSizeCatalog, ["standard", "large"]);
assert.deepEqual(parseAppearancePreference(null), defaultAppearancePreference);
assert.deepEqual(parseAppearancePreference("not-json"), defaultAppearancePreference);
assert.deepEqual(
  parseAppearancePreference(JSON.stringify({ skin: "clear", colorMode: "dark", textSize: "large" })),
  { skin: "clear", colorMode: "dark", textSize: "large" },
);
assert.deepEqual(
  parseAppearancePreference(JSON.stringify({ skin: "retired", colorMode: "light", textSize: "huge" })),
  { skin: "quiet", colorMode: "light", textSize: "standard" },
);
assert.equal(resolveAppearance(defaultAppearancePreference, false).resolvedColorMode, "light");
assert.equal(resolveAppearance(defaultAppearancePreference, true).resolvedColorMode, "dark");
assert.equal(
  resolveAppearance({ ...defaultAppearancePreference, colorMode: "light" }, true).resolvedColorMode,
  "light",
);

const theme = await readFile(new URL("../apps/web/src/theme.css", import.meta.url), "utf8");
const colorRoles = [
  "surface-canvas",
  "surface-subtle",
  "surface-panel",
  "surface-raised",
  "surface-selected",
  "surface-media",
  "fg-primary",
  "fg-secondary",
  "fg-tertiary",
  "fg-inverse",
  "fg-on-media",
  "border-subtle",
  "border-strong",
  "action-primary",
  "action-primary-hover",
  "action-on-primary",
  "focus",
  "selection",
  "accent-soft",
  "feedback-success",
  "feedback-warning",
  "feedback-danger",
  "overlay",
  "progress",
  "decorative",
] as const;
const selectors = [
  ":root",
  'html[data-sensa-skin="clear"]',
  'html[data-sensa-color-mode="dark"]',
  'html[data-sensa-skin="clear"][data-sensa-color-mode="dark"]',
] as const;

function block(selector: string): string {
  const start = theme.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing palette block ${selector}`);
  const end = theme.indexOf("}", start);
  assert.notEqual(end, -1, `unclosed palette block ${selector}`);
  return theme.slice(start, end);
}

function colorValue(source: string, role: string): string {
  const match = source.match(new RegExp(`--sensa-${role}:\\s*(#[0-9a-f]{6})`, "iu"));
  assert(match, `missing hex value for ${role}`);
  return match[1];
}

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
    const linear = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const selector of selectors) {
  const palette = block(selector);
  for (const role of colorRoles) {
    assert(palette.includes(`--sensa-${role}:`), `${selector} does not implement ${role}`);
  }
  assert(
    contrast(colorValue(palette, "fg-primary"), colorValue(palette, "surface-canvas")) >= 4.5,
    `${selector} primary text contrast is below WCAG AA`,
  );
  assert(
    contrast(colorValue(palette, "fg-secondary"), colorValue(palette, "surface-canvas")) >= 4.5,
    `${selector} secondary text contrast is below WCAG AA`,
  );
  assert(
    contrast(colorValue(palette, "fg-on-media"), colorValue(palette, "surface-media")) >= 4.5,
    `${selector} media text contrast is below WCAG AA`,
  );
  for (const action of ["action-primary", "action-primary-hover"]) {
    assert(
      contrast(colorValue(palette, "action-on-primary"), colorValue(palette, action)) >= 4.5,
      `${selector} ${action} contrast is below WCAG AA`,
    );
  }
}

for (const role of colorRoles) {
  assert(theme.includes(`--color-${role}: var(--sensa-${role});`), `Tailwind does not expose ${role}`);
}

const migratedSurfaces = [
  "apps/web/src/experience/App.tsx",
  "apps/web/src/experience/ui/WebShell.tsx",
  "apps/web/src/experience/account/AccountExperience.tsx",
  "apps/web/src/experience/components/HomeScreen.tsx",
  "apps/web/src/experience/components/ProfileScreen.tsx",
  "apps/web/src/experience/components/StudyScreen.tsx",
  "apps/web/src/experience/components/StudyCalendar.tsx",
  "apps/web/src/experience/components/StatsScreen.tsx",
  "apps/web/src/experience/components/ContentScreen.tsx",
  "apps/web/src/experience/components/ContentWorkspace.tsx",
  "apps/web/src/experience/components/ContentLibraryScreen.tsx",
  "apps/web/src/experience/components/ContentComingSoonScreen.tsx",
  "apps/web/src/experience/components/ContentExampleDetailScreen.tsx",
  "apps/web/src/experience/components/ContentSenseDetailScreen.tsx",
  "apps/web/src/experience/components/ConfirmedSenseDetailScreen.tsx",
  "apps/web/src/experience/components/ClickableSentence.tsx",
  "apps/web/src/experience/components/DictDetailModal.tsx",
  "apps/web/src/experience/components/ExpressionBindingScreen.tsx",
  "apps/web/src/experience/components/IntakeInboxDrawer.tsx",
  "apps/web/src/experience/components/IntakeSimulatorModal.tsx",
  "apps/web/src/experience/components/LearnScreen.tsx",
  "apps/web/src/experience/components/PersonalConnectionActions.tsx",
  "apps/web/src/experience/components/PersonalMeaningDetailScreen.tsx",
  "apps/web/src/experience/components/QuickDictPopup.tsx",
  "apps/web/src/experience/components/ReferenceDictionaryScreen.tsx",
  "apps/web/src/experience/components/SceneEditorModal.tsx",
  "apps/web/src/experience/components/SemanticWorldScreen.tsx",
  "apps/web/src/experience/components/SensaSemanticWorldScreen.tsx",
  "apps/web/src/experience/components/SensaFreePracticeScreen.tsx",
  "apps/web/src/experience/components/PracticeScopeScreen.tsx",
  "apps/web/src/experience/components/language/LanguagePanel.tsx",
  "apps/web/src/experience/components/language/GlossaryPanel.tsx",
  "apps/web/src/experience/components/ProviderPanel.tsx",
  "apps/web/src/experience/components/YouGlishListeningScreen.tsx",
  "apps/web/src/experience/components/ReferenceExampleViewer.tsx",
  "apps/web/src/experience/components/SensaExampleScreen.tsx",
  "apps/web/src/experience/components/examples/LearningExampleLookup.tsx",
  "apps/web/src/experience/components/examples/ExampleCardCarousel.tsx",
  "apps/web/src/experience/components/MeaningGraphView.tsx",
  "apps/web/src/experience/components/PersonalMeaningComposer.tsx",
  "apps/web/src/experience/components/NoteEditorModal.tsx",
  "apps/web/src/experience/components/LibraryBackupPanel.tsx",
  "apps/web/src/experience/components/LocalAgentPanel.tsx",
  "apps/web/src/experience/components/LocalDataControlPanel.tsx",
  "apps/web/src/experience/components/ModelExecutionPanel.tsx",
  "apps/web/src/experience/components/ExpressionChatInput.tsx",
  "apps/web/src/experience/components/CloudSyncPanel.tsx",
  "apps/web/src/experience/components/learning/RuntimeFrame.tsx",
  "apps/web/src/experience/components/learning/RuntimeRating.tsx",
  "apps/web/src/experience/components/learning/LearningSetupFrame.tsx",
  "apps/web/src/experience/components/learning/LearningTargetLibraryScreen.tsx",
  "apps/web/src/experience/components/learning/LearningTargetDetailScreen.tsx",
  "apps/web/src/experience/components/learning/LearningResourceDetails.tsx",
  "apps/web/src/experience/components/learning/RuntimeTools.tsx",
  "apps/web/src/experience/components/learning/LearningPreferencesPanel.tsx",
  "apps/web/src/experience/components/learning/LightweightRuntimeStartScreen.tsx",
  "apps/web/src/experience/components/learning/InterleavedFourStageRuntimeScreen.tsx",
  "apps/web/src/experience/components/learning/InterleavedFourStageReviewScreen.tsx",
  "apps/web/src/experience/components/learning/AssuranceSummary.tsx",
  "apps/web/src/experience/components/cards/ExperienceRenderer.tsx",
  "apps/web/src/experience/components/cards/IntroductionCard.tsx",
  "apps/web/src/experience/components/cards/NovelTransferCard.tsx",
  "apps/web/src/experience/components/cards/SensaRecallCard.tsx",
  "apps/web/src/experience/components/cards/SensaRecognitionCard.tsx",
  "apps/web/src/experience/components/cards/review/SensaReviewAssessmentCard.tsx",
  "apps/web/src/experience/components/cards/review/SensaReviewFeedbackCard.tsx",
  "apps/web/src/experience/components/cards/lightweight/ExperienceRecallCard.tsx",
  "apps/web/src/experience/components/cards/lightweight/ExpressionRevealCard.tsx",
] as const;
for (const path of migratedSurfaces) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  assert(!/(?<!&)#[0-9a-f]{3,8}\b/iu.test(source), `${path} bypasses the semantic color contract`);
  assert(
    !/data-sensa-skin|dataset\.sensaSkin|\bskin(?:Id)?\s*(?:===?|:)\s*["'](?:quiet|clear)["']/iu.test(source),
    `${path} couples product behavior to a skin`,
  );
  assert(!/\buiClass\s*\(/u.test(source), `${path} uses the retired recipe runtime`);
}

const migratedStyleSources = [
  "apps/web/src/experience/ui/primitives.ts",
  "apps/web/src/experience/components/DictDetailModal.css",
  "apps/web/src/experience/components/PersonalMeaningDetailScreen.css",
  "apps/web/src/experience/components/SensaSemanticWorldScreen.css",
  "apps/web/src/experience/components/examples/learningExample.css",
] as const;
for (const path of migratedStyleSources) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  assert(!/(?<!&)#[0-9a-f]{3,8}\b/iu.test(source), `${path} contains a palette literal`);
  assert(!/\b(?:rgb|hsl|oklch)a?\(/iu.test(source), `${path} contains a color-function literal`);
  assert(
    !/\b(?:bg-(?:white|paper|accent)(?!-)|text-(?:white|ink)(?!-)|border-line(?!-)|outline-accent(?!-))/iu.test(source),
    `${path} uses a legacy palette utility`,
  );
  assert(!/var\(--content-/iu.test(source), `${path} recreates a private content palette`);
  for (const [, role] of source.matchAll(/var\(--sensa-([a-z0-9-]+)\)/giu)) {
    assert(theme.includes(`--sensa-${role}:`), `${path} references unknown semantic role ${role}`);
  }
}

for (const path of [
  "apps/web/src/experience/ui/classes.ts",
  "apps/web/src/experience/ui/contentStyles.ts",
  "apps/web/src/experience/ui/recipes.ts",
] as const) {
  await assert.rejects(access(new URL(`../${path}`, import.meta.url)), `${path} must remain retired`);
}

async function presentationSources(directory: URL, prefix = ""): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...await presentationSources(new URL(`${entry.name}/`, directory), `${path}/`));
    } else if (/\.(?:css|ts|tsx)$/u.test(entry.name)) {
      paths.push(path);
    }
  }
  return paths;
}

const experienceRoot = new URL("../apps/web/src/experience/", import.meta.url);
for (const path of await presentationSources(experienceRoot)) {
  const source = await readFile(new URL(path, experienceRoot), "utf8");
  assert(!/(?<!&)#[0-9a-f]{3,8}\b/iu.test(source), `${path} bypasses the semantic color contract`);
  assert(!/\b(?:rgb|hsl|oklch)a?\(/iu.test(source), `${path} contains a color-function literal`);
  assert(
    !/\b(?:bg-white|text-white|bg-black|text-black|(?:bg|text|border|outline|ring|divide|accent)-(?:red|amber|slate|gray|zinc|neutral|stone|orange|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]+)\b/iu.test(source),
    `${path} uses a palette-specific utility`,
  );
  assert(!/\buiClass\s*\(|(?:^|["'])\.\.\/ui\/classes(?:["']|$)/mu.test(source), `${path} revives the retired recipe runtime`);
  if (!path.startsWith("appearance/")) {
    assert(
      !/data-sensa-skin|dataset\.sensaSkin|\bskin(?:Id)?\s*(?:===?|:)\s*["'](?:quiet|clear)["']/iu.test(source),
      `${path} couples product behavior to a skin`,
    );
  }
}

for (const [componentPath, stylesheetPath, ownedSelector] of [
  ["components/DictDetailModal.tsx", "components/DictDetailModal.css", /^(?:dict-|collins-|c-|feature-|promo-|exam-|note-|m-)/u],
  ["components/PersonalMeaningDetailScreen.tsx", "components/PersonalMeaningDetailScreen.css", /^pmw-/u],
  ["components/SensaSemanticWorldScreen.tsx", "components/SensaSemanticWorldScreen.css", /^personal-world-v2/u],
] as const) {
  const component = await readFile(new URL(componentPath, experienceRoot), "utf8");
  const stylesheet = await readFile(new URL(stylesheetPath, experienceRoot), "utf8");
  const selectors = new Set<string>();
  for (const match of component.matchAll(/classNames\((?:`([^`]*)`|["']([^"']*)["'])/gu)) {
    for (const token of (match[1] || match[2] || "").replace(/\$\{[^}]*\}/gu, "").split(/\s+/u)) {
      if (ownedSelector.test(token)) selectors.add(token);
    }
  }
  for (const selector of selectors) {
    assert(stylesheet.includes(`.${selector}`), `${componentPath} selector ${selector} is missing from its scoped stylesheet`);
  }
}

const entry = await readFile(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");
assert(entry.indexOf("initializeAppearance();") < entry.indexOf("createRoot("));

console.log(
  "PASS: curated appearance contract, safe fallback, complete light/dark adapters, AA core contrast, early bootstrap, retired recipe runtime, and semantic-only Web presentation sources.",
);
