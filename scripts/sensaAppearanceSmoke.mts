import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  "fg-primary",
  "fg-secondary",
  "fg-tertiary",
  "fg-inverse",
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
  for (const action of ["action-primary", "action-primary-hover"]) {
    assert(
      contrast(colorValue(palette, "action-on-primary"), colorValue(palette, action)) >= 4.5,
      `${selector} ${action} contrast is below WCAG AA`,
    );
  }
}

for (const role of colorRoles.filter((role) => role !== "decorative")) {
  assert(theme.includes(`--color-${role}: var(--sensa-${role});`), `Tailwind does not expose ${role}`);
}

const migratedSurfaces = [
  "apps/web/src/experience/ui/WebShell.tsx",
  "apps/web/src/experience/account/AccountExperience.tsx",
  "apps/web/src/experience/components/HomeScreen.tsx",
  "apps/web/src/experience/components/ProfileScreen.tsx",
  "apps/web/src/experience/components/learning/RuntimeFrame.tsx",
  "apps/web/src/experience/components/learning/RuntimeRating.tsx",
  "apps/web/src/experience/components/learning/LearningSetupFrame.tsx",
  "apps/web/src/experience/components/learning/LearningTargetLibraryScreen.tsx",
  "apps/web/src/experience/components/learning/LearningTargetDetailScreen.tsx",
  "apps/web/src/experience/components/learning/LearningResourceDetails.tsx",
  "apps/web/src/experience/components/learning/RuntimeTools.tsx",
  "apps/web/src/experience/components/learning/LearningPreferencesPanel.tsx",
  "apps/web/src/experience/components/learning/LightweightRuntimeStartScreen.tsx",
  "apps/web/src/experience/components/learning/AssuranceSummary.tsx",
  "apps/web/src/experience/components/cards/lightweight/ExperienceRecallCard.tsx",
  "apps/web/src/experience/components/cards/lightweight/ExpressionRevealCard.tsx",
] as const;
for (const path of migratedSurfaces) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  assert(!/#[0-9a-f]{3,8}/iu.test(source), `${path} bypasses the semantic color contract`);
  assert(!/data-sensa-skin|\bquiet\b|\bclear\b/iu.test(source), `${path} couples product behavior to a skin`);
}

const entry = await readFile(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");
assert(entry.indexOf("initializeAppearance();") < entry.indexOf("createRoot("));

console.log(
  "PASS: curated appearance contract, safe fallback, complete light/dark adapters, AA core contrast, early bootstrap and semantic-only vertical slice.",
);
