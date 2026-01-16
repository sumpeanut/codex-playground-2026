import fs from "node:fs";
import { chromium, expect, test } from "@playwright/test";

const hasChromium = (() => {
  try {
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

test.skip(!hasChromium, "Playwright Chromium binary not installed");

test("debug harness loads with expected sections", async ({ page }) => {
  await page.goto("/tools/debug.html");

  await expect(page.getByRole("heading", { name: "CA Debug Harness" })).toBeVisible();
  await expect(page.getByTestId("debug-section-pathfinding")).toBeVisible();
  await expect(page.getByTestId("debug-section-editor")).toBeVisible();
});

test("main simulation UI opens structure editor when WebGPU is available", async ({ page }) => {
  await page.goto("/");

  const hasGpu = await page.evaluate(() => !!navigator.gpu);
  test.skip(!hasGpu, "WebGPU not supported in this environment");

  await expect(page.locator("#openEditor")).toBeVisible();
  await page.click("#openEditor");
  await expect(page.locator("#editorDialog")).toBeVisible();
});
