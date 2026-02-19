import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
const OUTPUT_DIR = path.resolve("docs/screenshots/personas");

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function waitForStable(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  } catch {
    // Fall back to a small settle delay if networkidle is noisy.
  }
  await page.waitForTimeout(750);
}

async function assertNoRuntimeError(page, stageLabel) {
  const bodyText = (await page.textContent("body")) || "";
  const errorSignatures = [
    "Runtime PrismaClientValidationError",
    "Unhandled Runtime Error",
    "Unknown field `availabilityType`",
    "Invalid `this.persistence.specialistAvailabilityWindow.findMany()` invocation",
  ];

  const hit = errorSignatures.find((entry) => bodyText.includes(entry));
  if (hit) {
    throw new Error(`Runtime error detected at stage "${stageLabel}": ${hit}`);
  }
}

async function saveShot(page, fileName) {
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await page.screenshot({ path: outputPath, fullPage: false });
  return outputPath;
}

async function saveLocatorShot(locator, fileName) {
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await locator.screenshot({ path: outputPath });
  return outputPath;
}

async function login(page, email, password) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await waitForStable(page);
}

async function captureClientJourney(browser) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();

  const shots = [];

  await page.goto(`${BASE_URL}/intake/access/seed-intake-primary-2001`, {
    waitUntil: "domcontentloaded",
  });
  await waitForStable(page);
  await assertNoRuntimeError(page, "client_pin_entry");
  shots.push({
    key: "client_pin_entry",
    title: "End Client: Secure Intake PIN Entry",
    fileName: "01-client-pin-entry.png",
    path: await saveShot(page, "01-client-pin-entry.png"),
    route: "/intake/access/seed-intake-primary-2001",
  });

  await page.fill("#pin", "778899");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/intake?**", { timeout: 20_000 });
  await waitForStable(page);
  await assertNoRuntimeError(page, "client_intake_application");
  shots.push({
    key: "client_intake_application",
    title: "End Client: Application For Counselling (Step 1)",
    fileName: "02-client-intake-application-step-1.png",
    path: await saveShot(page, "02-client-intake-application-step-1.png"),
    route: "/intake?accessKey=...",
  });

  await context.close();
  return shots;
}

async function captureOpsJourney(browser) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  const shots = [];

  await login(page, "ops@demo.local", "password123");

  await page.goto(`${BASE_URL}/admin/cases`, { waitUntil: "domcontentloaded" });
  await waitForStable(page);
  await assertNoRuntimeError(page, "ops_case_list");
  shots.push({
    key: "ops_case_list",
    title: "Ops Manager: Case List",
    fileName: "03-ops-case-list.png",
    path: await saveShot(page, "03-ops-case-list.png"),
    route: "/admin/cases",
  });

  await page.goto(`${BASE_URL}/admin/assignments`, { waitUntil: "domcontentloaded" });
  await waitForStable(page);
  await assertNoRuntimeError(page, "ops_assignment_board");
  shots.push({
    key: "ops_assignment_board",
    title: "Ops Manager: Assignment Dashboard",
    fileName: "04-ops-assignment-dashboard.png",
    path: await saveShot(page, "04-ops-assignment-dashboard.png"),
    route: "/admin/assignments",
  });

  const firstCaseCard = page.locator('article[role="button"]').first();
  if (await firstCaseCard.count()) {
    await firstCaseCard.click();
    const dialog = page.locator('div[role="dialog"]').first();
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    await waitForStable(page);
    await assertNoRuntimeError(page, "ops_assignment_modal");
    shots.push({
      key: "ops_assignment_modal",
      title: "Ops Manager: Case Modal From Assignment Board",
      fileName: "05-ops-assignment-case-modal.png",
      path: await saveLocatorShot(dialog, "05-ops-assignment-case-modal.png"),
      route: "/admin/assignments (modal)",
    });
  }

  await page.goto(`${BASE_URL}/admin/cases`, { waitUntil: "domcontentloaded" });
  const openCaseLink = page.locator('tbody tr a[href^="/admin/cases/"]').first();
  await openCaseLink.waitFor({ state: "visible", timeout: 15_000 });
  await openCaseLink.click();
  await waitForStable(page);
  await assertNoRuntimeError(page, "ops_case_detail");
  shots.push({
    key: "ops_case_detail",
    title: "Ops Manager: Case Detail",
    fileName: "06-ops-case-detail.png",
    path: await saveShot(page, "06-ops-case-detail.png"),
    route: "/admin/cases/:id",
  });

  await context.close();
  return shots;
}

async function captureCounsellorJourney(browser) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  const shots = [];

  await login(page, "avery.specialist@demo.local", "password123");

  await page.goto(`${BASE_URL}/specialist/sessions`, { waitUntil: "domcontentloaded" });
  await waitForStable(page);
  await assertNoRuntimeError(page, "counsellor_sessions");
  shots.push({
    key: "counsellor_sessions",
    title: "Counsellor: Upcoming Sessions",
    fileName: "07-counsellor-upcoming-sessions.png",
    path: await saveShot(page, "07-counsellor-upcoming-sessions.png"),
    route: "/specialist/sessions",
  });

  await page.goto(`${BASE_URL}/specialist/clients`, { waitUntil: "domcontentloaded" });
  await waitForStable(page);
  await assertNoRuntimeError(page, "counsellor_clients");
  shots.push({
    key: "counsellor_clients",
    title: "Counsellor: My Clients",
    fileName: "08-counsellor-clients.png",
    path: await saveShot(page, "08-counsellor-clients.png"),
    route: "/specialist/clients",
  });

  await page.goto(`${BASE_URL}/specialist/availability`, { waitUntil: "domcontentloaded" });
  await waitForStable(page);
  await assertNoRuntimeError(page, "counsellor_availability");
  shots.push({
    key: "counsellor_availability",
    title: "Counsellor: Availability Calendar",
    fileName: "09-counsellor-availability-calendar.png",
    path: await saveShot(page, "09-counsellor-availability-calendar.png"),
    route: "/specialist/availability",
  });

  await context.close();
  return shots;
}

async function main() {
  await ensureOutputDir();

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const screenshots = [
      ...(await captureClientJourney(browser)),
      ...(await captureOpsJourney(browser)),
      ...(await captureCounsellorJourney(browser)),
    ];

    const metadata = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      screenshots: screenshots.map((entry) => ({
        ...entry,
        relativePath: path.relative(process.cwd(), entry.path),
      })),
    };

    await fs.writeFile(
      path.join(OUTPUT_DIR, "manifest.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );

    console.log(`Saved ${screenshots.length} persona screenshots to ${OUTPUT_DIR}`);
    console.log(`Manifest: ${path.join(OUTPUT_DIR, "manifest.json")}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Failed to capture persona screenshots.");
  console.error(error);
  process.exit(1);
});
