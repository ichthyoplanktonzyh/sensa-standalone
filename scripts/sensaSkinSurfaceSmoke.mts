/** Browser matrix for the development-only Skin Lab. No account or provider calls. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import {
  componentFamilyContract,
  componentTokenCatalog,
} from "../apps/web/src/experience/appearance/componentContract.ts";
import {
  pageLayoutFamilyContract,
  pageLayoutTokenCatalog,
} from "../apps/web/src/experience/appearance/pageLayoutContract.ts";

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
    const layoutSpecimen = page.locator('[data-sensa-page-layout="learning-runtime"][data-sensa-contract-specimen="full"]');
    const shellSpecimen = page.locator('[data-sensa-page-layout="application-shell"][data-sensa-contract-specimen="full"]');
    const focusedShellSpecimen = page.locator('[data-sensa-page-layout="application-shell"][data-sensa-shell-focus-probe]');
    const layoutOrders = Object.fromEntries(
      Object.entries(pageLayoutFamilyContract).map(([family, contract]) => [family, [...contract.logicalOrder]]),
    );

    for (const family of Object.keys(componentFamilyContract)) {
      assert(
        await page.locator(`[data-sensa-component="${family}"]`).count() > 0,
        `Skin Lab does not render the ${family} family`,
      );
    }
    for (const [family, contract] of Object.entries(pageLayoutFamilyContract)) {
      const layout = page.locator(`[data-sensa-page-layout="${family}"][data-sensa-contract-specimen="full"]`);
      assert.equal(await layout.count(), 1, `Skin Lab does not render exactly one ${family} layout specimen`);
      const regionOrder = await layout.locator(":scope > [data-sensa-page-region]").evaluateAll(
        (elements) => elements.map((element) => element.getAttribute("data-sensa-page-region")),
      );
      assert.deepEqual(regionOrder, [...contract.logicalOrder], `${family} DOM regions do not follow logical order`);
    }
    await expect(focusedShellSpecimen.getByText("Focused viewport remains visible without application chrome.")).toBeVisible();
    const focusedGeometry = await focusedShellSpecimen.evaluate((shell) => {
      const viewport = shell.querySelector<HTMLElement>(':scope > [data-sensa-page-region="viewport"]')!;
      const shellRect = shell.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      return {
        shell: { width: shellRect.width, height: shellRect.height },
        viewport: { width: viewportRect.width, height: viewportRect.height },
      };
    });
    assert(
      focusedGeometry.viewport.width >= focusedGeometry.shell.width - 2
        && focusedGeometry.viewport.height >= focusedGeometry.shell.height - 2,
      "focused application shell collapsed its only viewport region",
    );

    const quietRadius = await page.locator('[data-sensa-component="action"]').first().evaluate(
      (element) => getComputedStyle(element).borderRadius,
    );
    const runtimeProbe = page.locator("#skin-layout-state-probe");
    const shellProbe = page.locator("#skin-shell-state-probe");
    await runtimeProbe.fill("Preserved across runtime layout adapters");
    await shellProbe.fill("Preserved across shell layout adapters");
    const runtimeProbeHandle = await runtimeProbe.elementHandle();
    const shellProbeHandle = await shellProbe.elementHandle();
    assert(runtimeProbeHandle, "runtime layout state probe is missing");
    assert(shellProbeHandle, "shell layout state probe is missing");
    const quietGrid = await layoutSpecimen.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    const quietShellGrid = await shellSpecimen.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    await appearanceControls.getByRole("button", { name: "Clear", exact: true }).click();
    await page.locator('html[data-sensa-skin="clear"]').waitFor();
    const clearRadius = await page.locator('[data-sensa-component="action"]').first().evaluate(
      (element) => getComputedStyle(element).borderRadius,
    );
    assert.notEqual(quietRadius, clearRadius, "Quiet and Clear resolve to the same component shape");
    const clearGrid = await layoutSpecimen.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    const clearShellGrid = await shellSpecimen.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    assert.notEqual(quietGrid, clearGrid, "Quiet and Clear resolve to the same wide-screen page topology");
    assert.notEqual(quietShellGrid, clearShellGrid, "Quiet and Clear resolve to the same wide-screen shell topology");
    assert.equal(await runtimeProbe.inputValue(), "Preserved across runtime layout adapters", "Skin switch discarded runtime input");
    assert.equal(await shellProbe.inputValue(), "Preserved across shell layout adapters", "Skin switch discarded shell input");
    assert(await runtimeProbeHandle.evaluate((element) => element.isConnected), "Skin switch remounted the runtime region tree");
    assert(await shellProbeHandle.evaluate((element) => element.isConnected), "Skin switch remounted the shell region tree");

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1280, height: 900 },
    ]) {
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
            const result = await page.evaluate(({ componentTokens, layoutTokens, layoutOrders }) => {
              const rootStyle = getComputedStyle(document.documentElement);
              const action = document.querySelector<HTMLElement>('[data-sensa-component="action"]')!;
              const choice = document.querySelector<HTMLElement>('[data-sensa-component="selection"][data-sensa-variant="choice"]')!;
              const bodyWidth = document.documentElement.scrollWidth - document.documentElement.clientWidth;
              return {
                missingComponentTokens: componentTokens.filter((token) => !rootStyle.getPropertyValue(`--sensa-component-${token}`).trim()),
                missingLayoutTokens: layoutTokens.filter((token) => !rootStyle.getPropertyValue(`--sensa-layout-${token}`).trim()),
                actionHeight: action.getBoundingClientRect().height,
                choiceHeight: choice.getBoundingClientRect().height,
                horizontalOverflow: bodyWidth,
                layouts: Object.entries(layoutOrders).map(([family, logicalOrder]) => {
                  const layout = document.querySelector<HTMLElement>(`[data-sensa-page-layout="${family}"][data-sensa-contract-specimen="full"]`)!;
                  const renderedRegions = [...layout.querySelectorAll<HTMLElement>(":scope > [data-sensa-page-region]")];
                  return {
                    family,
                    logicalOrder,
                    overflow: layout.scrollWidth - layout.clientWidth,
                    hiddenRegions: renderedRegions
                      .filter((region) => {
                        const style = getComputedStyle(region);
                        return style.display === "none" || style.visibility === "hidden";
                      })
                      .map((region) => region.dataset.sensaPageRegion),
                    regionOrder: renderedRegions.map((region) => region.dataset.sensaPageRegion),
                  };
                }),
                fontSize: rootStyle.fontSize,
              };
            }, {
              componentTokens: [...componentTokenCatalog],
              layoutTokens: [...pageLayoutTokenCatalog],
              layoutOrders,
            });
            assert.deepEqual(result.missingComponentTokens, [], `${skin}/${mode}/${textSize} has unresolved component tokens`);
            assert.deepEqual(result.missingLayoutTokens, [], `${skin}/${mode}/${textSize} has unresolved layout tokens`);
            assert(result.actionHeight >= 44, `${skin}/${mode}/${textSize} action target is below 44px`);
            assert(result.choiceHeight >= 44, `${skin}/${mode}/${textSize} choice target is below 44px`);
            assert(result.horizontalOverflow <= 1, `${skin}/${mode}/${textSize} overflows at ${viewport.width}px`);
            for (const layout of result.layouts) {
              assert(layout.overflow <= 1, `${skin}/${mode}/${textSize} ${layout.family} overflows at ${viewport.width}px`);
              assert.deepEqual(layout.hiddenRegions, [], `${skin}/${mode}/${textSize} hides ${layout.family} semantic regions`);
              assert.deepEqual(layout.regionOrder, layout.logicalOrder, `${skin}/${mode}/${textSize} reorders ${layout.family} regions`);
            }
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
    assert.equal(await runtimeProbe.inputValue(), "Preserved across runtime layout adapters", "appearance matrix discarded runtime input state");
    assert.equal(await shellProbe.inputValue(), "Preserved across shell layout adapters", "appearance matrix discarded shell input state");
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

console.log("PASS: Skin Lab preserves stable application-shell and learning-runtime region trees while adapters vary across skin, color-mode, text-size and responsive matrices.");
