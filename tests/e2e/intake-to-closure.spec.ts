import { expect, test, type Page } from "@playwright/test";

function statusLabel(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function minutesBetween(startIso: string, endIso: string) {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000;
}

function overlaps(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) {
  return new Date(firstStart) < new Date(secondEnd) && new Date(secondStart) < new Date(firstEnd);
}

async function expectCurrentStatus(page: Page, status: string) {
  await expect(page.getByTestId("case-current-status")).toHaveText(statusLabel(status));
}

async function transitionTo(page: Page, status: string) {
  await page.selectOption('select[name="targetStatus"]', status);
  await page.getByRole("button", { name: "Apply transition" }).click();
  await expectCurrentStatus(page, status);
}

async function completeAllPendingDocuments(page: Page) {
  for (let i = 0; i < 10; i += 1) {
    const buttons = page
      .getByTestId("document-workflow")
      .getByRole("button", { name: "Mark complete" });

    const count = await buttons.count();
    if (count === 0) {
      return;
    }

    await buttons.first().click();
    await expect(
      page
        .getByTestId("document-workflow")
        .getByRole("button", { name: "Mark complete" }),
    ).toHaveCount(count - 1);
  }

  throw new Error("Exceeded maximum document completion attempts.");
}

async function loginAsOps(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', "ops@demo.local");
  await page.fill('input[name="password"]', "password123");

  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin/cases"),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

async function createCaseViaApi(
  page: Page,
  payload: {
    primary: { firstName: string; lastName: string; email: string; phone?: string };
    secondary?: { firstName: string; lastName: string; email: string; phone?: string };
    notes?: string;
    requestedDurationMinutes?: number;
    autoAllocate?: boolean;
  },
) {
  const response = await page.request.post("/api/intake", { data: payload });
  expect(response.ok()).toBeTruthy();

  const json = (await response.json()) as {
    ok: boolean;
    data: { caseId: string; reference: string };
  };

  expect(json.ok).toBe(true);
  return json.data;
}

async function postJsonFromBrowser(
  page: Page,
  path: string,
  payload?: Record<string, unknown>,
) {
  return page.evaluate(
    async ({ path: targetPath, payload: targetPayload }) => {
      const response = await fetch(targetPath, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: targetPayload ? JSON.stringify(targetPayload) : "{}",
      });

      const json = await response.json();
      return { ok: response.ok, status: response.status, json };
    },
    { path, payload },
  );
}

async function allocateCaseViaApi(page: Page, caseId: string) {
  const response = await postJsonFromBrowser(page, `/api/cases/${caseId}/allocate`);
  expect(response.ok).toBeTruthy();

  const json = response.json as {
    ok: boolean;
    data: {
      sessions: Array<{
        specialistId: string;
        providerStartTime: string;
        providerEndTime: string;
      }>;
    };
  };

  expect(json.ok).toBe(true);
  return json.data;
}

async function overrideCaseViaApi(page: Page, caseId: string, specialistId: string) {
  const response = await postJsonFromBrowser(page, `/api/cases/${caseId}/override`, {
    specialistId,
    reason: "playwright clash scenario",
  });

  expect(response.ok).toBeTruthy();
  const json = response.json as {
    ok: boolean;
    data: {
      sessions: Array<{
        specialistId: string;
        providerStartTime: string;
        providerEndTime: string;
      }>;
    };
  };

  expect(json.ok).toBe(true);
  return json.data;
}

test("intake to closed case smoke flow", async ({ page }) => {
  const unique = Date.now();

  await page.goto("/intake");

  await page.fill('input[name="primaryFirstName"]', "Smoke");
  await page.fill('input[name="primaryLastName"]', `Test${unique}`);
  await page.fill('input[name="primaryEmail"]', `smoke-${unique}@example.com`);
  await page.fill('textarea[name="notes"]', "Playwright smoke flow");

  await Promise.all([
    page.waitForURL((url) => url.pathname === "/intake/success"),
    page.getByRole("button", { name: "Submit intake" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Intake submitted" })).toBeVisible();

  const successUrl = new URL(page.url());
  const caseId = successUrl.searchParams.get("caseId");

  expect(caseId).toBeTruthy();
  if (!caseId) {
    throw new Error("Case ID missing in intake success URL.");
  }

  await loginAsOps(page);
  await page.goto(`/admin/cases/${caseId}`);

  await expect(page.getByRole("heading", { name: /Case CASE-/ })).toBeVisible();
  await expectCurrentStatus(page, "SCHEDULED");

  await completeAllPendingDocuments(page);

  await transitionTo(page, "IN_SESSION");
  await transitionTo(page, "COMPLETED");

  await completeAllPendingDocuments(page);

  await transitionTo(page, "CLOSED");

  await expect(
    page.getByTestId("document-workflow").getByText("Outtake Form", { exact: false }),
  ).toBeVisible();
});

test("ops can edit specialist profile", async ({ page }) => {
  const unique = Date.now();
  const updatedNotes = `Playwright updated notes ${unique}`;

  await loginAsOps(page);

  await page.goto("/admin/specialists");
  await page.getByRole("link", { name: "View profile" }).first().click();

  await expect(page.getByRole("heading", { name: /Specialist Profile:/ })).toBeVisible();

  await page.fill('textarea[name="notes"]', updatedNotes);
  await page.fill('input[name="capabilities"]', `individual, playwright-${unique}`);
  await page.getByRole("button", { name: "Save profile" }).click();

  await expect(page.getByText("Specialist profile updated.")).toBeVisible();
  await expect(page.locator('textarea[name="notes"]')).toHaveValue(updatedNotes);
  await expect(page.locator('input[name="capabilities"]')).toHaveValue(
    `individual, playwright-${unique}`,
  );
});

test("client dashboards are role scoped", async ({ page }) => {
  await loginAsOps(page);

  await page.goto("/admin/clients");
  await expect(page.getByRole("heading", { name: "Client Dashboard" })).toBeVisible();
  await expect(page.getByText("Taylor Ng")).toBeVisible();
  await expect(page.getByText("Chris Diaz")).toBeVisible();

  await Promise.all([
    page.waitForURL((url) => url.pathname === "/login"),
    page.getByRole("button", { name: "Sign out" }).click(),
  ]);

  await page.fill('input[name="email"]', "avery.specialist@demo.local");
  await page.fill('input[name="password"]', "password123");

  await Promise.all([
    page.waitForURL((url) => url.pathname === "/specialist/sessions"),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);

  await page.goto("/specialist/clients");
  await expect(page.getByRole("heading", { name: "My Clients" })).toBeVisible();
  await expect(page.getByText("Taylor Ng")).toBeVisible();
  await expect(page.getByText("Chris Diaz")).toHaveCount(0);
});

test("one-to-one bookings support 30, 60, 90 minute durations", async ({ page }) => {
  await loginAsOps(page);

  for (const duration of [30, 60, 90]) {
    const unique = `${duration}-${Date.now()}`;
    const created = await createCaseViaApi(page, {
      primary: {
        firstName: "Duration",
        lastName: `Single${duration}`,
        email: `duration-single-${unique}@example.com`,
      },
      notes: `single duration ${duration}`,
      requestedDurationMinutes: duration,
      autoAllocate: false,
    });

    const allocated = await allocateCaseViaApi(page, created.caseId);
    const session = allocated.sessions[0];
    expect(session).toBeTruthy();
    expect(minutesBetween(session.providerStartTime, session.providerEndTime)).toBe(duration);
  }
});

test("many-to-one bookings support 30, 60, 90 minute durations", async ({ page }) => {
  await loginAsOps(page);

  for (const duration of [30, 60, 90]) {
    const unique = `${duration}-${Date.now()}`;
    const created = await createCaseViaApi(page, {
      primary: {
        firstName: "Duration",
        lastName: `CoupleA${duration}`,
        email: `duration-couple-a-${unique}@example.com`,
      },
      secondary: {
        firstName: "Duration",
        lastName: `CoupleB${duration}`,
        email: `duration-couple-b-${unique}@example.com`,
      },
      notes: `couple duration ${duration}`,
      requestedDurationMinutes: duration,
      autoAllocate: false,
    });

    const allocated = await allocateCaseViaApi(page, created.caseId);
    const session = allocated.sessions[0];
    expect(session).toBeTruthy();
    expect(minutesBetween(session.providerStartTime, session.providerEndTime)).toBe(duration);
  }
});

test("provider prevents booking clashes for one-to-one and many-to-one bookings", async ({ page }) => {
  await loginAsOps(page);

  const singleOne = await createCaseViaApi(page, {
    primary: {
      firstName: "Clash",
      lastName: "SingleOne",
      email: `clash-single-one-${Date.now()}@example.com`,
    },
    requestedDurationMinutes: 60,
    autoAllocate: false,
  });

  const singleOneAllocated = await allocateCaseViaApi(page, singleOne.caseId);
  const singleOneSession = singleOneAllocated.sessions[0];

  const singleTwo = await createCaseViaApi(page, {
    primary: {
      firstName: "Clash",
      lastName: "SingleTwo",
      email: `clash-single-two-${Date.now()}@example.com`,
    },
    requestedDurationMinutes: 60,
    autoAllocate: false,
  });

  const singleTwoAllocated = await overrideCaseViaApi(
    page,
    singleTwo.caseId,
    singleOneSession.specialistId,
  );
  const singleTwoSession = singleTwoAllocated.sessions[0];

  expect(
    overlaps(
      singleOneSession.providerStartTime,
      singleOneSession.providerEndTime,
      singleTwoSession.providerStartTime,
      singleTwoSession.providerEndTime,
    ),
  ).toBe(false);

  const coupleOne = await createCaseViaApi(page, {
    primary: {
      firstName: "Clash",
      lastName: "CoupleOneA",
      email: `clash-couple-one-a-${Date.now()}@example.com`,
    },
    secondary: {
      firstName: "Clash",
      lastName: "CoupleOneB",
      email: `clash-couple-one-b-${Date.now()}@example.com`,
    },
    requestedDurationMinutes: 90,
    autoAllocate: false,
  });

  const coupleOneAllocated = await allocateCaseViaApi(page, coupleOne.caseId);
  const coupleOneSession = coupleOneAllocated.sessions[0];

  const coupleTwo = await createCaseViaApi(page, {
    primary: {
      firstName: "Clash",
      lastName: "CoupleTwoA",
      email: `clash-couple-two-a-${Date.now()}@example.com`,
    },
    secondary: {
      firstName: "Clash",
      lastName: "CoupleTwoB",
      email: `clash-couple-two-b-${Date.now()}@example.com`,
    },
    requestedDurationMinutes: 90,
    autoAllocate: false,
  });

  const coupleTwoAllocated = await overrideCaseViaApi(
    page,
    coupleTwo.caseId,
    coupleOneSession.specialistId,
  );
  const coupleTwoSession = coupleTwoAllocated.sessions[0];

  expect(
    overlaps(
      coupleOneSession.providerStartTime,
      coupleOneSession.providerEndTime,
      coupleTwoSession.providerStartTime,
      coupleTwoSession.providerEndTime,
    ),
  ).toBe(false);
});

test("terms and conditions must be completed before ready-to-schedule transition", async ({ page }) => {
  await loginAsOps(page);

  const single = await createCaseViaApi(page, {
    primary: {
      firstName: "Terms",
      lastName: "GateSingle",
      email: `terms-single-${Date.now()}@example.com`,
    },
    autoAllocate: false,
  });

  const toMatched = await postJsonFromBrowser(page, `/api/cases/${single.caseId}/transition`, {
    targetStatus: "MATCHED",
  });
  expect(toMatched.ok).toBeTruthy();

  const blocked = await postJsonFromBrowser(page, `/api/cases/${single.caseId}/transition`, {
    targetStatus: "READY_TO_SCHEDULE",
  });
  expect(blocked.status).toBe(409);

  const blockedJson = blocked.json as { ok: boolean; error: string };
  expect(blockedJson.ok).toBe(false);
  expect(blockedJson.error).toContain("Required documents pending");
  expect(blockedJson.error).toContain("TERMS_AND_CONDITIONS");

  const couple = await createCaseViaApi(page, {
    primary: {
      firstName: "Terms",
      lastName: "GateCoupleA",
      email: `terms-couple-a-${Date.now()}@example.com`,
    },
    secondary: {
      firstName: "Terms",
      lastName: "GateCoupleB",
      email: `terms-couple-b-${Date.now()}@example.com`,
    },
    autoAllocate: false,
  });

  const coupleMatched = await postJsonFromBrowser(page, `/api/cases/${couple.caseId}/transition`, {
    targetStatus: "MATCHED",
  });
  expect(coupleMatched.ok).toBeTruthy();

  const coupleBlocked = await postJsonFromBrowser(
    page,
    `/api/cases/${couple.caseId}/transition`,
    {
      targetStatus: "READY_TO_SCHEDULE",
    },
  );
  expect(coupleBlocked.status).toBe(409);

  const coupleBlockedJson = coupleBlocked.json as { ok: boolean; error: string };
  expect(coupleBlockedJson.ok).toBe(false);
  expect(coupleBlockedJson.error).toContain("Required documents pending");
  expect(coupleBlockedJson.error).toContain("TERMS_AND_CONDITIONS");
});
