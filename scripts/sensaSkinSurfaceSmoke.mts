/** Browser matrix for the development-only Skin Lab. No account or provider calls. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium } from "@playwright/test";
import {
  componentFamilyContract,
  componentTokenCatalog,
} from "../apps/web/src/experience/appearance/componentContract.ts";

const root = process.cwd();
const port = 43100 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
let server: ChildProcess | undefined;

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Vite has not bound the loopback port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Skin Lab Vite server did not become ready");
}

try {
  server = spawn(
    process.execPath,
    [`${root}/node_modules/vite/bin/vite.js`, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: `${root}/apps/web`,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let serverOutput = "";
  server.stdout?.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });
  await waitForServer().catch((error) => {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serverOutput}`);
  });

  const browser = await chromium.launch({ headless: true, executablePath: process.env.SENSA_CHROMIUM_PATH });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon.ico")) {
        runtimeErrors.push(`console: ${message.text()}`);
      }
    });
    const response = await page.goto(`${origin}/?skin-lab=1`, { waitUntil: "networkidle" });
    assert(response?.ok(), "Skin Lab did not serve");
    await page.locator("[data-sensa-skin-lab]").waitFor({ state: "visible" });
    const appearanceControls = page.getByLabel("Appearance controls");

    for (const family of Object.keys(componentFamilyContract)) {
      assert(
        await page.locator(`[data-sensa-component="${family}"]`).count() > 0,
        `Skin Lab does not render the ${family} family`,
      );
    }

    const quietRadius = await page.locator('[data-sensa-component="action"]').first().evaluate(
      (element) => getComputedStyle(element).borderRadius,
    );
    await appearanceControls.getByRole("button", { name: "Clear", exact: true }).click();
    await page.locator('html[data-sensa-skin="clear"]').waitFor();
    const clearRadius = await page.locator('[data-sensa-component="action"]').first().evaluate(
      (element) => getComputedStyle(element).borderRadius,
    );
    assert.notEqual(quietRadius, clearRadius, "Quiet and Clear resolve to the same component shape");

    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      for (const skin of ["Quiet", "Clear"] as const) {
        await appearanceControls.getByRole("button", { name: skin, exact: true }).click();
        for (const mode of ["light", "dark"] as const) {
          await appearanceControls.getByRole("button", { name: mode, exact: true }).click();
          for (const textSize of ["standard", "large"] as const) {
            await appearanceControls.getByRole("button", { name: textSize, exact: true }).click();
            const expectedSkin = skin.toLowerCase();
            await page.locator(
              `html[data-sensa-skin="${expectedSkin}"][data-sensa-color-mode="${mode}"][data-sensa-text-size="${textSize}"]`,
            ).waitFor();
            const result = await page.evaluate(({ tokens }) => {
              const rootStyle = getComputedStyle(document.documentElement);
              const action = document.querySelector<HTMLElement>('[data-sensa-component="action"]')!;
              const choice = document.querySelector<HTMLElement>('[data-sensa-component="selection"][data-sensa-variant="choice"]')!;
              const bodyWidth = document.documentElement.scrollWidth - document.documentElement.clientWidth;
              return {
                missingTokens: tokens.filter((token) => !rootStyle.getPropertyValue(`--sensa-component-${token}`).trim()),
                actionHeight: action.getBoundingClientRect().height,
                choiceHeight: choice.getBoundingClientRect().height,
                horizontalOverflow: bodyWidth,
                fontSize: rootStyle.fontSize,
              };
            }, { tokens: [...componentTokenCatalog] });
            assert.deepEqual(result.missingTokens, [], `${skin}/${mode}/${textSize} has unresolved component tokens`);
            assert(result.actionHeight >= 44, `${skin}/${mode}/${textSize} action target is below 44px`);
            assert(result.choiceHeight >= 44, `${skin}/${mode}/${textSize} choice target is below 44px`);
            assert(result.horizontalOverflow <= 1, `${skin}/${mode}/${textSize} overflows at ${viewport.width}px`);
            assert.equal(result.fontSize, textSize === "large" ? "18px" : "16px");
          }
        }
      }
    }

    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press("Tab");
    const outline = await page.locator(":focus-visible").evaluate((element) => getComputedStyle(element).outlineStyle);
    assert.notEqual(outline, "none", "keyboard focus is not visibly styled");
    assert.deepEqual(runtimeErrors, [], "Skin Lab emitted browser errors");
    await context.close();
  } finally {
    await browser.close();
  }
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3_000);
      server!.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}

console.log("PASS: Skin Lab renders every component family across skin, color-mode, text-size and responsive matrices.");
