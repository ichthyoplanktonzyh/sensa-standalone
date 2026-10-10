/** Browser matrix for the development-only Skin Lab. No account or provider calls. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { test, expect } from "@playwright/test";
import {
  componentFamilyContract,
  componentTokenCatalog,
} from "../../../apps/web/src/experience/appearance/componentContract.ts";
import {
  pageLayoutFamilyContract,
  pageLayoutTokenCatalog,
} from "../../../apps/web/src/experience/appearance/pageLayoutContract.ts";
import {
  overlayLayoutFamilyContract,
  overlayLayoutTokenCatalog,
} from "../../../apps/web/src/experience/appearance/overlayLayoutContract.ts";
import { skinAssetRoleCatalog } from "../../../apps/web/src/experience/appearance/assetContract.ts";
import { motionTokenCatalog } from "../../../apps/web/src/experience/appearance/motionContract.ts";

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

test.setTimeout(180_000);
test("Skin Lab preserves contracted layouts and state across the browser matrix",async({browser})=>{
try {
  server = spawn(
    process.execPath,
    [`${root}/node_modules/vite/bin/vite.js`, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: `${root}/apps/web`,
      // Skin Lab is a self-contained presentation matrix. Do not inherit a
      // developer's local API endpoint and accidentally emit telemetry while
      // validating browser-only surfaces.
      // A previous in-process Vite build can set NODE_ENV=production. This is
      // explicitly a development-only server even when specs share a worker.
      env: { ...process.env, NODE_ENV: "development", VITE_SENSA_API_URL: "" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let serverOutput = "";
  server.stdout?.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });
  await waitForServer().catch((error) => {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serverOutput}`);
  });

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon.ico")) {
        const location=message.location();
        runtimeErrors.push(`console: ${message.text()}${location.url?` (${location.url}:${location.lineNumber})`:''}`);
      }
    });
    const response = await page.goto(`${origin}/?skin-lab=1`, { waitUntil: "networkidle" });
    assert(response?.ok(), "Skin Lab did not serve");
    await expect(page.locator("[data-sensa-skin-lab]"),"Development server must expose Skin Lab before matrix checks").toBeVisible({timeout:15_000});
    const appearanceControls = page.getByLabel("Appearance controls");
    const layoutSpecimen = page.locator('[data-sensa-page-layout="learning-runtime"][data-sensa-contract-specimen="full"]');
    const shellSpecimen = page.locator('[data-sensa-page-layout="application-shell"][data-sensa-contract-specimen="full"]');
    const focusedShellSpecimen = page.locator('[data-sensa-page-layout="application-shell"][data-sensa-shell-focus-probe]');
    const layoutOrders = Object.fromEntries(
      Object.entries(pageLayoutFamilyContract).map(([family, contract]) => [family, [...contract.logicalOrder]]),
    );
    const overlayOrders = Object.fromEntries(
      Object.entries(overlayLayoutFamilyContract).map(([family, contract]) => [family, [...contract.logicalOrder]]),
    );

    await test.step("Skin Lab renders every contracted component, asset and semantic region",async()=>{
    for (const family of Object.keys(componentFamilyContract)) {
      assert(
        await page.locator(`[data-sensa-component="${family}"]`).count() > 0,
        `Skin Lab does not render the ${family} family`,
      );
    }
    for (const role of skinAssetRoleCatalog) {
      assert(
        await page.locator(`[data-sensa-skin-asset="${role}"]`).count() > 0,
        `Skin Lab does not render the ${role} asset role`,
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
    for (const [family, contract] of Object.entries(overlayLayoutFamilyContract)) {
      const layout = page.locator(`[data-sensa-overlay-layout="${family}"][data-sensa-contract-specimen="full"]`);
      assert.equal(await layout.count(), 1, `Skin Lab does not render exactly one ${family} overlay specimen`);
      const regionOrder = await layout.locator('[data-sensa-slot="panel"] > [data-sensa-overlay-region]').evaluateAll(
        (elements) => elements.map((element) => element.getAttribute("data-sensa-overlay-region")),
      );
      assert.deepEqual(regionOrder, [...contract.logicalOrder], `${family} overlay DOM regions do not follow logical order`);
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
    });

    const runtimeProbe = page.locator("#skin-layout-state-probe");
    const shellProbe = page.locator("#skin-shell-state-probe");
    const overlayProbe = page.locator("#skin-overlay-state-probe");
    const brandProbe = page.locator("[data-sensa-brand-logo]").first();
    const skinAssetProbe = page.locator("[data-sensa-skin-asset]").first();
    const motionProbe = page.locator("[data-sensa-motion-probe]");
    await test.step("Skin switching changes adapters without remounting or losing input",async()=>{
    const quietRadius = await page.locator('[data-sensa-component="action"]').first().evaluate(
      (element) => getComputedStyle(element).borderRadius,
    );
    await runtimeProbe.fill("Preserved across runtime layout adapters");
    await shellProbe.fill("Preserved across shell layout adapters");
    await overlayProbe.fill("Preserved across overlay layout adapters");
    const runtimeProbeHandle = await runtimeProbe.elementHandle();
    const shellProbeHandle = await shellProbe.elementHandle();
    const overlayProbeHandle = await overlayProbe.elementHandle();
    const brandProbeHandle = await brandProbe.elementHandle();
    const skinAssetProbeHandle = await skinAssetProbe.elementHandle();
    assert(runtimeProbeHandle, "runtime layout state probe is missing");
    assert(shellProbeHandle, "shell layout state probe is missing");
    assert(overlayProbeHandle, "overlay layout state probe is missing");
    assert(brandProbeHandle, "fixed brand probe is missing");
    assert(skinAssetProbeHandle, "Skin asset probe is missing");
    assert.equal(await skinAssetProbe.getAttribute("data-sensa-asset-set"), "quiet-editorial");
    const quietBrandImage = await brandProbe.evaluate((element) => getComputedStyle(element).backgroundImage);
    const quietMotionDuration = await motionProbe.evaluate((element) => getComputedStyle(element).transitionDuration);
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
    assert.equal(
      await brandProbe.evaluate((element) => getComputedStyle(element).backgroundImage),
      quietBrandImage,
      "Skin switch changed the fixed Sensa identity artwork",
    );
    assert.equal(await skinAssetProbe.getAttribute("data-sensa-asset-set"), "clear-utility", "Skin switch did not resolve the Clear asset set");
    const clearMotionDuration = await motionProbe.evaluate((element) => getComputedStyle(element).transitionDuration);
    assert.notEqual(quietMotionDuration, clearMotionDuration, "Quiet and Clear resolve to the same motion cadence");
    const clearShellBaseline = await shellSpecimen.evaluate((shell) => {
      const shellRect = shell.getBoundingClientRect();
      const brandMark = shell.querySelector<HTMLElement>("[data-sensa-shell-brand-mark]")!;
      const navigationItem = shell.querySelector<HTMLElement>("[data-sensa-shell-navigation-item]")!;
      const navigation = shell.querySelector<HTMLElement>("[data-sensa-shell-navigation]")!;
      const utilitiesRegion = shell.querySelector<HTMLElement>(':scope > [data-sensa-page-region="utilities"]')!;
      const utilities = shell.querySelector<HTMLElement>("[data-sensa-shell-utilities]")!;
      const utilityAction = shell.querySelector<HTMLElement>("[data-sensa-shell-utility-action]")!;
      const navigationRect = shell.querySelector<HTMLElement>(':scope > [data-sensa-page-region="navigation"]')!.getBoundingClientRect();
      return {
        sidebarWidth: Math.round(navigationRect.right - shellRect.left),
        brandInset: Math.round(brandMark.getBoundingClientRect().left - shellRect.left),
        navigationInset: Math.round(navigationItem.getBoundingClientRect().left - shellRect.left),
        navigationGap: getComputedStyle(navigation).gap,
        utilitiesInset: Math.round(utilities.getBoundingClientRect().left - shellRect.left),
        utilityActionHeight: Math.round(utilityAction.getBoundingClientRect().height),
        utilitiesRegionBorderWidth: getComputedStyle(utilitiesRegion).borderTopWidth,
        utilitiesBorderWidth: getComputedStyle(utilities).borderTopWidth,
      };
    });
    assert.deepEqual(clearShellBaseline, {
      sidebarWidth: 225,
      brandInset: 33,
      navigationInset: 17,
      navigationGap: "6px",
      utilitiesInset: 17,
      utilityActionHeight: 48,
      utilitiesRegionBorderWidth: "0px",
      utilitiesBorderWidth: "1px",
    }, "Clear application shell drifted from the deployed sidebar geometry");
    assert.equal(await runtimeProbe.inputValue(), "Preserved across runtime layout adapters", "Skin switch discarded runtime input");
    assert.equal(await shellProbe.inputValue(), "Preserved across shell layout adapters", "Skin switch discarded shell input");
    assert.equal(await overlayProbe.inputValue(), "Preserved across overlay layout adapters", "Skin switch discarded overlay input");
    assert(await runtimeProbeHandle.evaluate((element) => element.isConnected), "Skin switch remounted the runtime region tree");
    assert(await shellProbeHandle.evaluate((element) => element.isConnected), "Skin switch remounted the shell region tree");
    assert(await overlayProbeHandle.evaluate((element) => element.isConnected), "Skin switch remounted the overlay region tree");
    assert(await brandProbeHandle.evaluate((element) => element.isConnected), "Skin switch remounted the brand seam");
    assert(await skinAssetProbeHandle.evaluate((element) => element.isConnected), "Skin switch remounted the asset seam");
    });

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1280, height: 900 },
    ]) {
      await test.step(`${viewport.width}px viewport resolves every Skin, color and text-size contract`,async()=>{
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
            await page.evaluate(async () => {
              await document.fonts.ready;
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
              });
            });
            const result = await page.evaluate(({ componentTokens, layoutTokens, overlayTokens, motionTokens, layoutOrders, overlayOrders }) => {
              const rootStyle = getComputedStyle(document.documentElement);
              const action = document.querySelector<HTMLElement>('[data-sensa-component="action"]')!;
              const choice = document.querySelector<HTMLElement>('[data-sensa-component="selection"][data-sensa-variant="choice"]')!;
              const brand = document.querySelector<HTMLElement>("[data-sensa-brand-logo]")!;
              const brandStyle = getComputedStyle(brand);
              const bodyWidth = document.documentElement.scrollWidth - document.documentElement.clientWidth;
              const runtime = document.querySelector<HTMLElement>('[data-sensa-page-layout="learning-runtime"][data-sensa-contract-specimen="full"]')!;
              const runtimeHeader = runtime.querySelector<HTMLElement>('[data-sensa-page-region="header"]')!.getBoundingClientRect();
              const runtimeTools = runtime.querySelector<HTMLElement>('[data-sensa-page-region="tools"]')!.getBoundingClientRect();
              return {
                runtimeToolsBelowHeader: runtimeTools.top >= runtimeHeader.bottom - 1,
                missingComponentTokens: componentTokens.filter((token) => !rootStyle.getPropertyValue(`--sensa-component-${token}`).trim()),
                missingLayoutTokens: layoutTokens.filter((token) => !rootStyle.getPropertyValue(`--sensa-layout-${token}`).trim()),
                missingOverlayTokens: overlayTokens.filter((token) => !rootStyle.getPropertyValue(`--sensa-overlay-layout-${token}`).trim()),
                missingMotionTokens: motionTokens.filter((token) => !rootStyle.getPropertyValue(`--sensa-motion-${token}`).trim()),
                actionHeight: action.getBoundingClientRect().height,
                choiceHeight: choice.getBoundingClientRect().height,
                brand: {
                  width: brand.getBoundingClientRect().width,
                  height: brand.getBoundingClientRect().height,
                  backgroundImage: brandStyle.backgroundImage,
                },
                horizontalOverflow: bodyWidth,
                overflowingElements: [...document.body.querySelectorAll<HTMLElement>("*")]
                  .map((element) => {
                    const rect = element.getBoundingClientRect();
                    return {
                      element: element.id
                        ? `#${element.id}`
                        : `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).trim().replace(/\s+/gu, ".")}` : ""}`,
                      left: Math.round(rect.left),
                      right: Math.round(rect.right),
                      width: Math.round(rect.width),
                    };
                  })
                  .filter(({ left, right }) => left < -1 || right > document.documentElement.clientWidth + 1)
                  .slice(0, 12),
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
                overlays: Object.entries(overlayOrders).map(([family, logicalOrder]) => {
                  const layout = document.querySelector<HTMLElement>(`[data-sensa-overlay-layout="${family}"][data-sensa-contract-specimen="full"]`)!;
                  const panel = layout.querySelector<HTMLElement>('[data-sensa-slot="panel"]')!;
                  const renderedRegions = [...panel.querySelectorAll<HTMLElement>(":scope > [data-sensa-overlay-region]")];
                  return {
                    family,
                    logicalOrder,
                    overflow: layout.scrollWidth - layout.clientWidth,
                    hiddenRegions: renderedRegions
                      .filter((region) => {
                        const style = getComputedStyle(region);
                        return style.display === "none" || style.visibility === "hidden";
                      })
                      .map((region) => region.dataset.sensaOverlayRegion),
                    regionOrder: renderedRegions.map((region) => region.dataset.sensaOverlayRegion),
                  };
                }),
                fontSize: rootStyle.fontSize,
              };
            }, {
              componentTokens: [...componentTokenCatalog],
              layoutTokens: [...pageLayoutTokenCatalog],
              overlayTokens: [...overlayLayoutTokenCatalog],
              motionTokens: [...motionTokenCatalog],
              layoutOrders,
              overlayOrders,
            });
            assert.deepEqual(result.missingComponentTokens, [], `${skin}/${mode}/${textSize} has unresolved component tokens`);
            assert.deepEqual(result.missingLayoutTokens, [], `${skin}/${mode}/${textSize} has unresolved layout tokens`);
            assert.deepEqual(result.missingOverlayTokens, [], `${skin}/${mode}/${textSize} has unresolved overlay layout tokens`);
            assert.deepEqual(result.missingMotionTokens, [], `${skin}/${mode}/${textSize} has unresolved motion tokens`);
            assert(result.actionHeight >= 44, `${skin}/${mode}/${textSize} action target is below 44px`);
            assert(result.choiceHeight >= 44, `${skin}/${mode}/${textSize} choice target is below 44px`);
            const compactBrand = viewport.width < 384;
            assert.equal(result.brand.width, compactBrand ? 32 : 125, `${skin}/${mode}/${textSize} resolves the wrong brand width at ${viewport.width}px`);
            assert.equal(result.brand.height, compactBrand ? 32 : 40, `${skin}/${mode}/${textSize} resolves the wrong brand height at ${viewport.width}px`);
            const expectedBrandAsset = compactBrand
              ? `sensa-mark-${mode === "dark" ? "reverse" : "ink"}.svg`
              : `sensa-lockup-horizontal-${mode === "dark" ? "reverse" : "color"}.svg`;
            assert(result.brand.backgroundImage.includes(expectedBrandAsset), `${skin}/${mode}/${textSize} resolves the wrong fixed brand tone`);
            assert(
              result.horizontalOverflow <= 1,
              `${skin}/${mode}/${textSize} overflows by ${result.horizontalOverflow}px at ${viewport.width}px: ${JSON.stringify(result.overflowingElements)}`,
            );
            if (skin === "Quiet" && viewport.width < 640) {
              assert(result.runtimeToolsBelowHeader, `Quiet/${mode}/${textSize} tools collide with the mobile runtime header`);
            }
            for (const layout of result.layouts) {
              assert(layout.overflow <= 1, `${skin}/${mode}/${textSize} ${layout.family} overflows at ${viewport.width}px`);
              assert.deepEqual(layout.hiddenRegions, [], `${skin}/${mode}/${textSize} hides ${layout.family} semantic regions`);
              assert.deepEqual(layout.regionOrder, layout.logicalOrder, `${skin}/${mode}/${textSize} reorders ${layout.family} regions`);
            }
            for (const overlay of result.overlays) {
              assert(overlay.overflow <= 1, `${skin}/${mode}/${textSize} ${overlay.family} overlay overflows at ${viewport.width}px`);
              assert.deepEqual(overlay.hiddenRegions, [], `${skin}/${mode}/${textSize} hides ${overlay.family} overlay regions`);
              assert.deepEqual(overlay.regionOrder, overlay.logicalOrder, `${skin}/${mode}/${textSize} reorders ${overlay.family} overlay regions`);
            }
            assert.equal(result.fontSize, textSize === "large" ? "18px" : "16px");
          }
        }
      }
      });
    }

    await test.step("keyboard focus, runtime state and reduced motion survive the matrix",async()=>{
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press("Tab");
    const outline = await page.locator(":focus-visible").evaluate((element) => getComputedStyle(element).outlineStyle);
    assert.notEqual(outline, "none", "keyboard focus is not visibly styled");
    assert.equal(await runtimeProbe.inputValue(), "Preserved across runtime layout adapters", "appearance matrix discarded runtime input state");
    assert.equal(await shellProbe.inputValue(), "Preserved across shell layout adapters", "appearance matrix discarded shell input state");
    assert.equal(await overlayProbe.inputValue(), "Preserved across overlay layout adapters", "appearance matrix discarded overlay input state");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedMotionDuration = await page.locator("[data-sensa-motion-probe]").evaluate((element) => (
      getComputedStyle(element).transitionDuration
        .split(",")
        .map((value) => Number.parseFloat(value) * (value.includes("ms") ? 1 : 1000))
    ));
    assert(reducedMotionDuration.every((duration) => duration <= 0.01), "reduced-motion preference did not collapse Skin motion");
    assert.deepEqual(runtimeErrors, [], "Skin Lab emitted browser errors");
    });
  } finally {
    await context.close();
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
});
