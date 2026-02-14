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

function buildAvailabilityWindow(dayOffset: number, startHourUtc: number, endHourUtc: number) {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), startHourUtc, 0, 0, 0),
  );
  start.setUTCDate(start.getUTCDate() + dayOffset);

  while (start.getUTCDay() === 0 || start.getUTCDay() === 6) {
    start.setUTCDate(start.getUTCDate() + 1);
  }

  const end = new Date(start);
  end.setUTCHours(endHourUtc, 0, 0, 0);

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

function availabilityShiftSeed(seed: string) {
  let total = 0;
  for (const character of seed) {
    total += character.charCodeAt(0);
  }

  return total % 5;
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
    counsellingType?: string;
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
        providerBookingId: string;
        providerStartTime: string;
        providerEndTime: string;
        status: string;
      }>;
    };
  };

  expect(json.ok).toBe(true);
  return json.data;
}

async function allocateCaseViaApiExpectError(page: Page, caseId: string) {
  const response = await postJsonFromBrowser(page, `/api/cases/${caseId}/allocate`);
  expect(response.ok).toBe(false);
  return response;
}

async function submitFormForCase(
  page: Page,
  payload: {
    formType: string;
    caseId: string;
    participantIdentifier: string;
    source?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const response = await postJsonFromBrowser(page, "/forms/submission", payload);
  expect(response.ok).toBeTruthy();

  const json = response.json as {
    ok: boolean;
    data: {
      eligibleForScheduling: boolean;
    };
  };

  expect(json.ok).toBe(true);
  return json.data;
}

async function submitAvailabilityForCase(
  page: Page,
  payload: {
    caseId: string;
    participantIdentifier: string;
    windows: Array<{ startTime: string; endTime: string }>;
    timezone?: string;
  },
) {
  const response = await postJsonFromBrowser(page, "/availability/submission", {
    ...payload,
    source: "playwright",
  });
  expect(response.ok).toBeTruthy();

  const json = response.json as {
    ok: boolean;
    data: {
      eligibleForScheduling: boolean;
      hasOverlap: boolean;
      participantsSubmitted: number;
      requiredParticipants: number;
    };
  };
  expect(json.ok).toBe(true);
  return json.data;
}

function defaultAvailabilityWindows(
  participantType: "single" | "couple",
  variant: "primary" | "secondary",
  seed: string,
) {
  const shift = availabilityShiftSeed(seed);

  if (participantType === "single") {
    return [buildAvailabilityWindow(2 + shift, 9, 12), buildAvailabilityWindow(3 + shift, 13, 17)];
  }

  if (variant === "primary") {
    return [buildAvailabilityWindow(2 + shift, 10, 13), buildAvailabilityWindow(4 + shift, 14, 17)];
  }

  return [buildAvailabilityWindow(2 + shift, 11, 14), buildAvailabilityWindow(4 + shift, 15, 17)];
}

function nonOverlappingCoupleWindows(variant: "primary" | "secondary") {
  if (variant === "primary") {
    return [buildAvailabilityWindow(2, 9, 10), buildAvailabilityWindow(3, 9, 10)];
  }

  return [buildAvailabilityWindow(2, 15, 16), buildAvailabilityWindow(3, 15, 16)];
}

async function completeRequiredFormsForCase(
  page: Page,
  caseId: string,
  participants: {
    primaryIdentifier: string;
    secondaryIdentifier?: string;
  },
  participantType: "single" | "couple",
) {
  await submitFormForCase(page, {
    caseId,
    participantIdentifier: participants.primaryIdentifier,
    formType: "INTAKE_FORM",
    source: "playwright",
  });

  if (participantType === "couple") {
    await submitFormForCase(page, {
      caseId,
      participantIdentifier: participants.secondaryIdentifier || participants.primaryIdentifier,
      formType: "INTAKE_FORM",
      source: "playwright",
    });
  }

  await submitFormForCase(page, {
    caseId,
    participantIdentifier: participants.primaryIdentifier,
    formType: participantType === "single" ? "TERMS_AND_CONDITIONS" : "AGREEMENT_FORM",
    source: "playwright",
  });

  if (participantType === "couple") {
    await submitFormForCase(page, {
      caseId,
      participantIdentifier: participants.primaryIdentifier,
      formType: "CONSENT_FORM",
      source: "playwright",
    });
    await submitFormForCase(page, {
      caseId,
      participantIdentifier: participants.secondaryIdentifier || participants.primaryIdentifier,
      formType: "CONSENT_FORM",
      source: "playwright",
    });
  }
}

async function completeBlockingFormsForCase(
  page: Page,
  caseId: string,
  participants: {
    primaryIdentifier: string;
    secondaryIdentifier?: string;
  },
  participantType: "single" | "couple",
) {
  await completeRequiredFormsForCase(page, caseId, participants, participantType);

  await submitAvailabilityForCase(page, {
    caseId,
    participantIdentifier: participants.primaryIdentifier,
    windows: defaultAvailabilityWindows(participantType, "primary", caseId),
    timezone: "UTC",
  });

  if (participantType === "couple") {
    await submitAvailabilityForCase(page, {
      caseId,
      participantIdentifier: participants.secondaryIdentifier || participants.primaryIdentifier,
      windows: defaultAvailabilityWindows(participantType, "secondary", caseId),
      timezone: "UTC",
    });
  }
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
        providerBookingId: string;
        providerStartTime: string;
        providerEndTime: string;
        status: string;
      }>;
    };
  };

  expect(json.ok).toBe(true);
  return json.data;
}

test("intake to closed case smoke flow", async ({ page }) => {
  const unique = Date.now();

  await page.goto("/intake");

  const primaryEmail = `smoke-${unique}@example.com`;
  await page.fill('input[name="primaryFirstName"]', "Smoke");
  await page.fill('input[name="primaryLastName"]', `Test${unique}`);
  await page.fill('input[name="primaryEmail"]', primaryEmail);
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
  await expectCurrentStatus(page, "AWAITING_REVIEW");

  await completeBlockingFormsForCase(
    page,
    caseId,
    { primaryIdentifier: primaryEmail },
    "single",
  );
  await transitionTo(page, "MATCHED");
  await allocateCaseViaApi(page, caseId);
  await page.goto(`/admin/cases/${caseId}`);
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
    const primaryEmail = `duration-single-${unique}@example.com`;
    const created = await createCaseViaApi(page, {
      primary: {
        firstName: "Duration",
        lastName: `Single${duration}`,
        email: primaryEmail,
      },
      notes: `single duration ${duration}`,
      requestedDurationMinutes: duration,
      autoAllocate: false,
    });

    await completeBlockingFormsForCase(
      page,
      created.caseId,
      { primaryIdentifier: primaryEmail },
      "single",
    );
    const allocated = await allocateCaseViaApi(page, created.caseId);
    const session = allocated.sessions[0];
    expect(session).toBeTruthy();
    expect(minutesBetween(session.providerStartTime, session.providerEndTime)).toBe(duration);
  }
});

test("scheduling stays blocked until blocking workflow form steps are completed", async ({ page }) => {
  await loginAsOps(page);

  const primaryEmail = `workflow-gate-${Date.now()}@example.com`;
  const created = await createCaseViaApi(page, {
    counsellingType: "individual",
    primary: {
      firstName: "Workflow",
      lastName: "GateSingle",
      email: primaryEmail,
    },
    requestedDurationMinutes: 60,
    autoAllocate: false,
  });

  const blocked = await allocateCaseViaApiExpectError(page, created.caseId);
  expect(blocked.status).toBe(409);
  expect((blocked.json as { error: string }).error).toContain("Case not eligible for scheduling");

  await completeBlockingFormsForCase(
    page,
    created.caseId,
    { primaryIdentifier: primaryEmail },
    "single",
  );

  const allocated = await allocateCaseViaApi(page, created.caseId);
  expect(allocated.sessions[0]).toBeTruthy();
});

test("couples workflow requires both participants before scheduling is eligible", async ({ page }) => {
  await loginAsOps(page);

  const unique = Date.now();
  const primaryEmail = `workflow-couple-a-${unique}@example.com`;
  const secondaryEmail = `workflow-couple-b-${unique}@example.com`;
  const created = await createCaseViaApi(page, {
    counsellingType: "couples",
    primary: {
      firstName: "Workflow",
      lastName: "CoupleGateA",
      email: primaryEmail,
    },
    secondary: {
      firstName: "Workflow",
      lastName: "CoupleGateB",
      email: secondaryEmail,
    },
    autoAllocate: false,
  });

  let blocked = await allocateCaseViaApiExpectError(page, created.caseId);
  expect(blocked.status).toBe(409);

  const intakePrimary = await submitFormForCase(page, {
    caseId: created.caseId,
    participantIdentifier: primaryEmail,
    formType: "INTAKE_FORM",
    source: "playwright",
  });
  expect(intakePrimary.eligibleForScheduling).toBe(false);

  blocked = await allocateCaseViaApiExpectError(page, created.caseId);
  expect(blocked.status).toBe(409);

  const intakeSecondary = await submitFormForCase(page, {
    caseId: created.caseId,
    participantIdentifier: secondaryEmail,
    formType: "INTAKE_FORM",
    source: "playwright",
  });
  expect(intakeSecondary.eligibleForScheduling).toBe(false);

  const agreement = await submitFormForCase(page, {
    caseId: created.caseId,
    participantIdentifier: primaryEmail,
    formType: "AGREEMENT_FORM",
    source: "playwright",
  });
  expect(agreement.eligibleForScheduling).toBe(false);

  const consentPrimary = await submitFormForCase(page, {
    caseId: created.caseId,
    participantIdentifier: primaryEmail,
    formType: "CONSENT_FORM",
    source: "playwright",
  });
  expect(consentPrimary.eligibleForScheduling).toBe(false);

  const consentSecondary = await submitFormForCase(page, {
    caseId: created.caseId,
    participantIdentifier: secondaryEmail,
    formType: "CONSENT_FORM",
    source: "playwright",
  });
  expect(consentSecondary.eligibleForScheduling).toBe(false);

  const availabilityPrimary = await submitAvailabilityForCase(page, {
    caseId: created.caseId,
    participantIdentifier: primaryEmail,
    windows: defaultAvailabilityWindows("couple", "primary", created.caseId),
    timezone: "UTC",
  });
  expect(availabilityPrimary.eligibleForScheduling).toBe(false);

  const availabilitySecondary = await submitAvailabilityForCase(page, {
    caseId: created.caseId,
    participantIdentifier: secondaryEmail,
    windows: defaultAvailabilityWindows("couple", "secondary", created.caseId),
    timezone: "UTC",
  });
  expect(availabilitySecondary.eligibleForScheduling).toBe(true);

  const allocated = await allocateCaseViaApi(page, created.caseId);
  expect(allocated.sessions[0]).toBeTruthy();
});

test("couples scheduling stays blocked when submissions do not overlap", async ({ page }) => {
  await loginAsOps(page);

  const unique = Date.now();
  const primaryEmail = `workflow-no-overlap-a-${unique}@example.com`;
  const secondaryEmail = `workflow-no-overlap-b-${unique}@example.com`;
  const created = await createCaseViaApi(page, {
    counsellingType: "couples",
    primary: {
      firstName: "NoOverlap",
      lastName: "Primary",
      email: primaryEmail,
    },
    secondary: {
      firstName: "NoOverlap",
      lastName: "Secondary",
      email: secondaryEmail,
    },
    requestedDurationMinutes: 60,
    autoAllocate: false,
  });

  await completeRequiredFormsForCase(
    page,
    created.caseId,
    {
      primaryIdentifier: primaryEmail,
      secondaryIdentifier: secondaryEmail,
    },
    "couple",
  );

  const firstSubmission = await submitAvailabilityForCase(page, {
    caseId: created.caseId,
    participantIdentifier: primaryEmail,
    windows: nonOverlappingCoupleWindows("primary"),
    timezone: "UTC",
  });
  expect(firstSubmission.eligibleForScheduling).toBe(false);

  const secondSubmission = await submitAvailabilityForCase(page, {
    caseId: created.caseId,
    participantIdentifier: secondaryEmail,
    windows: nonOverlappingCoupleWindows("secondary"),
    timezone: "UTC",
  });
  expect(secondSubmission.hasOverlap).toBe(false);
  expect(secondSubmission.eligibleForScheduling).toBe(false);

  const blocked = await allocateCaseViaApiExpectError(page, created.caseId);
  expect(blocked.status).toBe(409);
  expect((blocked.json as { error: string }).error).toContain("Case not eligible for scheduling");
});

test("many-to-one bookings support 30, 60, 90 minute durations", async ({ page }) => {
  await loginAsOps(page);

  for (const duration of [30, 60, 90]) {
    const unique = `${duration}-${Date.now()}`;
    const primaryEmail = `duration-couple-a-${unique}@example.com`;
    const secondaryEmail = `duration-couple-b-${unique}@example.com`;
    const created = await createCaseViaApi(page, {
      primary: {
        firstName: "Duration",
        lastName: `CoupleA${duration}`,
        email: primaryEmail,
      },
      secondary: {
        firstName: "Duration",
        lastName: `CoupleB${duration}`,
        email: secondaryEmail,
      },
      notes: `couple duration ${duration}`,
      requestedDurationMinutes: duration,
      autoAllocate: false,
    });

    await completeBlockingFormsForCase(
      page,
      created.caseId,
      {
        primaryIdentifier: primaryEmail,
        secondaryIdentifier: secondaryEmail,
      },
      "couple",
    );
    const allocated = await allocateCaseViaApi(page, created.caseId);
    const session = allocated.sessions[0];
    expect(session).toBeTruthy();
    expect(minutesBetween(session.providerStartTime, session.providerEndTime)).toBe(duration);
  }
});

test("provider prevents booking clashes for one-to-one and many-to-one bookings", async ({ page }) => {
  await loginAsOps(page);

  const singleOneEmail = `clash-single-one-${Date.now()}@example.com`;
  const singleOne = await createCaseViaApi(page, {
    primary: {
      firstName: "Clash",
      lastName: "SingleOne",
      email: singleOneEmail,
    },
    requestedDurationMinutes: 60,
    autoAllocate: false,
  });

  await completeBlockingFormsForCase(
    page,
    singleOne.caseId,
    { primaryIdentifier: singleOneEmail },
    "single",
  );
  const singleOneAllocated = await allocateCaseViaApi(page, singleOne.caseId);
  const singleOneSession = singleOneAllocated.sessions[0];

  const singleTwoEmail = `clash-single-two-${Date.now()}@example.com`;
  const singleTwo = await createCaseViaApi(page, {
    primary: {
      firstName: "Clash",
      lastName: "SingleTwo",
      email: singleTwoEmail,
    },
    requestedDurationMinutes: 60,
    autoAllocate: false,
  });

  await completeBlockingFormsForCase(
    page,
    singleTwo.caseId,
    { primaryIdentifier: singleTwoEmail },
    "single",
  );
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

  const coupleOneEmailA = `clash-couple-one-a-${Date.now()}@example.com`;
  const coupleOneEmailB = `clash-couple-one-b-${Date.now()}@example.com`;
  const coupleOne = await createCaseViaApi(page, {
    primary: {
      firstName: "Clash",
      lastName: "CoupleOneA",
      email: coupleOneEmailA,
    },
    secondary: {
      firstName: "Clash",
      lastName: "CoupleOneB",
      email: coupleOneEmailB,
    },
    requestedDurationMinutes: 90,
    autoAllocate: false,
  });

  await completeBlockingFormsForCase(
    page,
    coupleOne.caseId,
    {
      primaryIdentifier: coupleOneEmailA,
      secondaryIdentifier: coupleOneEmailB,
    },
    "couple",
  );
  const coupleOneAllocated = await allocateCaseViaApi(page, coupleOne.caseId);
  const coupleOneSession = coupleOneAllocated.sessions[0];

  const coupleTwoEmailA = `clash-couple-two-a-${Date.now()}@example.com`;
  const coupleTwoEmailB = `clash-couple-two-b-${Date.now()}@example.com`;
  const coupleTwo = await createCaseViaApi(page, {
    primary: {
      firstName: "Clash",
      lastName: "CoupleTwoA",
      email: coupleTwoEmailA,
    },
    secondary: {
      firstName: "Clash",
      lastName: "CoupleTwoB",
      email: coupleTwoEmailB,
    },
    requestedDurationMinutes: 90,
    autoAllocate: false,
  });

  await completeBlockingFormsForCase(
    page,
    coupleTwo.caseId,
    {
      primaryIdentifier: coupleTwoEmailA,
      secondaryIdentifier: coupleTwoEmailB,
    },
    "couple",
  );
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

test("external provider cancellation moves case back to ready-to-schedule and writes audit log", async ({
  page,
}) => {
  await loginAsOps(page);

  const primaryEmail = `provider-cancel-${Date.now()}@example.com`;
  const created = await createCaseViaApi(page, {
    counsellingType: "individual",
    primary: {
      firstName: "Provider",
      lastName: "CancelFlow",
      email: primaryEmail,
    },
    requestedDurationMinutes: 60,
    autoAllocate: false,
  });

  await completeBlockingFormsForCase(
    page,
    created.caseId,
    { primaryIdentifier: primaryEmail },
    "single",
  );
  const allocated = await allocateCaseViaApi(page, created.caseId);
  const booking = allocated.sessions[0];
  expect(booking.providerBookingId).toBeTruthy();

  await page.goto(`/admin/cases/${created.caseId}`);
  await expectCurrentStatus(page, "SCHEDULED");

  const cancellation = await postJsonFromBrowser(
    page,
    `/dev/provider/cancel/${encodeURIComponent(booking.providerBookingId)}`,
  );
  expect(cancellation.ok).toBe(true);

  const cancellationJson = cancellation.json as {
    ok: boolean;
    data: {
      found: boolean;
      applied: boolean;
      caseStatus: string;
      sessionStatus: string;
    };
  };
  expect(cancellationJson.ok).toBe(true);
  expect(cancellationJson.data.found).toBe(true);
  expect(cancellationJson.data.caseStatus).toBe("READY_TO_SCHEDULE");
  expect(cancellationJson.data.sessionStatus).toBe("CANCELLED");

  await page.goto(`/admin/cases/${created.caseId}`);
  await expectCurrentStatus(page, "READY_TO_SCHEDULE");
  await expect(page.getByText("PROVIDER_BOOKING_CANCELLED")).toBeVisible();
  await expect(page.getByText("PROVIDER_CANCELLED")).toBeVisible();
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
