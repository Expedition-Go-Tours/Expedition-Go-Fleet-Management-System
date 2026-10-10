import { expect, test, type Page } from "@playwright/test";

/*
 * Responsive + console-error QA over the signed-in app.
 *
 * Runs only when E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD are provided (live
 * project). Without them it self-skips, so the default suite stays hermetic.
 * For each required viewport it loads the primary operational pages and asserts
 * (a) the response is not an error, (b) the layout does not overflow
 * horizontally, and (c) no uncaught console/page errors are emitted.
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

const PATHS = [
  "/",
  "/vehicles",
  "/reports",
  "/work-orders?open=1",
  "/expenses",
  "/maintenance",
  "/fuel",
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

test.describe("authenticated responsive QA", () => {
  test.skip(!EMAIL || !PASSWORD, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set");

  test("primary pages render cleanly at every required viewport", async ({ page }) => {
    test.setTimeout(300_000);
    const errors = collectErrors(page);

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(EMAIL as string);
    await page.getByLabel("Password").fill(PASSWORD as string);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 20_000 });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const path of PATHS) {
        const response = await page.goto(path);
        expect(response?.status(), `${path} @ ${viewport.width}px`).toBeLessThan(400);
        const overflow = await page.evaluate(() => {
          const viewportWidth = document.documentElement.clientWidth;
          const offenders: string[] = [];
          for (const element of document.querySelectorAll<HTMLElement>("body *")) {
            const rect = element.getBoundingClientRect();
            if (rect.right > viewportWidth + 1 || rect.left < -1) {
              const cls =
                typeof element.className === "string" ? element.className.slice(0, 60) : "";
              offenders.push(
                `${element.tagName.toLowerCase()}.${cls} left=${Math.round(rect.left)} right=${Math.round(rect.right)}`,
              );
            }
          }
          return {
            delta: document.documentElement.scrollWidth - viewportWidth,
            offenders: offenders.slice(0, 8),
          };
        });
        expect(
          overflow.delta,
          `horizontal overflow on ${path} @ ${viewport.width}px — ${overflow.offenders.join(" | ")}`,
        ).toBeLessThanOrEqual(2);
      }
    }

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
