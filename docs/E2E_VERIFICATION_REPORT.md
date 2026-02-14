# E2E Verification Report (Scheduling Simulator MVP)

Generated: 2026-02-14T11:31:03Z  
Workspace: `/Users/adambrown/Developer/codex-cgplatform`  
Evidence bundle: `docs/e2e-evidence/2026-02-14T11-30-11Z`  
Latest symlink: `docs/e2e-evidence/latest`

## Purpose

This report provides executable proof that the workflow + scheduling simulator behaves correctly with seeded data and edge-case coverage.

## Exact Command Sequence

```bash
npx prisma db push --force-reset
npm run db:seed
FORCE_COLOR=0 NO_COLOR=1 npx playwright test --reporter=json
FORCE_COLOR=0 NO_COLOR=1 npx playwright test --reporter=list
```

Raw command logs are stored in:

- `docs/e2e-evidence/2026-02-14T11-30-11Z/01-db-push.txt`
- `docs/e2e-evidence/2026-02-14T11-30-11Z/02-db-seed.txt`
- `docs/e2e-evidence/2026-02-14T11-30-11Z/04-playwright-report.json`
- `docs/e2e-evidence/2026-02-14T11-30-11Z/05-playwright-list.txt`

## Test Runner Result

Summary from `04-playwright-report.json`:

- Expected: `7`
- Unexpected: `0`
- Flaky: `0`
- Skipped: `0`

Human-readable output from `05-playwright-list.txt`:

```text
Running 7 tests using 1 worker
✓ intake to closed case smoke flow
✓ ops can edit specialist profile
✓ client dashboards are role scoped
✓ one-to-one bookings support 30, 60, 90 minute durations
✓ many-to-one bookings support 30, 60, 90 minute durations
✓ provider prevents booking clashes for one-to-one and many-to-one bookings
✓ terms and conditions must be completed before ready-to-schedule transition
7 passed
```

## Seed Baseline Proof

Source snapshot: `docs/e2e-evidence/2026-02-14T11-30-11Z/03-seed-snapshot.json`

Seed counts before any E2E steps:

- Clients: `3`
- Cases: `2`
- CaseParticipants: `3`
- Specialists: `3`
- Sessions: `1`
- DocumentTemplates: `4`
- DocumentInstances: `4`
- UserAccounts: `4`
- AuditLogs: `2`

Seeded specialist capability baseline:

- Avery Mills: individual only
- Jordan Patel: supports couples
- Morgan Lee: supports couples

## Scenario-by-Scenario Proof

### 1) End-to-end lifecycle smoke flow

Test location: `tests/e2e/intake-to-closure.spec.ts:148`

Steps executed:

1. Submit intake as a new client from `/intake`.
2. Capture `caseId` from `/intake/success`.
3. Login as ops and open `/admin/cases/:id`.
4. Confirm case is `SCHEDULED`.
5. Complete all pending documents.
6. Transition case to `IN_SESSION`.
7. Transition case to `COMPLETED`.
8. Complete newly pending documents.
9. Transition case to `CLOSED`.
10. Assert Outtake Form appears in document workflow.

Database proof from `06-post-run-proof.json`:

- `smokeFlowAssertion.caseReference = CASE-1016`
- Final status: `CLOSED`
- Session status: `COMPLETED`
- Documents completed: `TERMS_AND_CONDITIONS`, `CONTRACT`, `INTAKE_FORM`, `OUTTAKE_FORM`

### 2) Ops specialist profile editing

Test location: `tests/e2e/intake-to-closure.spec.ts:193`

Steps executed:

1. Login as ops.
2. Open specialist profile from `/admin/specialists`.
3. Edit notes and capabilities.
4. Save profile.
5. Assert success message and persisted field values in UI.

Database proof from `06-post-run-proof.json`:

- `specialistEditAssertion.email = avery.specialist@demo.local`
- Updated notes value persisted.
- Updated capability token `playwright-*` persisted.

### 3) Role-scoped client dashboards

Test location: `tests/e2e/intake-to-closure.spec.ts:215`

Steps executed:

1. Login as ops and open `/admin/clients`.
2. Assert ops can see global clients list.
3. Sign out.
4. Login as specialist (`avery.specialist@demo.local`).
5. Open `/specialist/clients`.
6. Assert specialist only sees own clients and does not see unrelated seeded client.

Pass evidence:

- Test completed with `status=expected` in `04-playwright-report.json`.

### 4) One-to-one durations 30/60/90

Test location: `tests/e2e/intake-to-closure.spec.ts:242`

Steps executed for each duration value (`30`, `60`, `90`):

1. Create single-participant case via `/api/intake` with `requestedDurationMinutes`.
2. Allocate case via `/api/cases/:id/allocate`.
3. Assert `providerEndTime - providerStartTime == requestedDurationMinutes`.

Database proof from `06-post-run-proof.json`:

- `CASE-1017`: requested `30`, actual `30`
- `CASE-1018`: requested `60`, actual `60`
- `CASE-1019`: requested `90`, actual `90`
- Aggregate assertion: `durationAssertions.singles = true`

### 5) Many-to-one (couple) durations 30/60/90

Test location: `tests/e2e/intake-to-closure.spec.ts:265`

Steps executed for each duration value (`30`, `60`, `90`):

1. Create two-participant case via `/api/intake` with `requestedDurationMinutes`.
2. Allocate case via `/api/cases/:id/allocate`.
3. Assert `providerEndTime - providerStartTime == requestedDurationMinutes`.

Database proof from `06-post-run-proof.json`:

- `CASE-1020`: requested `30`, actual `30`
- `CASE-1021`: requested `60`, actual `60`
- `CASE-1022`: requested `90`, actual `90`
- Aggregate assertion: `durationAssertions.couples = true`

### 6) Booking clash prevention (single and couple)

Test location: `tests/e2e/intake-to-closure.spec.ts:293`

Steps executed:

1. Create single case A and allocate.
2. Create single case B and override to same specialist as case A.
3. Assert B session does not overlap A session.
4. Create couple case A and allocate.
5. Create couple case B and override to same specialist as couple case A.
6. Assert B session does not overlap A session.

Database proof from `06-post-run-proof.json`:

- Single pair (`CASE-1023`, `CASE-1024`): `sameSpecialist=true`, `overlaps=false`
- Couple pair (`CASE-1025`, `CASE-1026`): `sameSpecialist=true`, `overlaps=false`
- Global overlap sweep across all active sessions: `globalActiveOverlapCount=0`
- Manual override audit records exist with reason `playwright clash scenario`

### 7) Terms and Conditions gating

Test location: `tests/e2e/intake-to-closure.spec.ts:385`

Steps executed for both single and couple:

1. Create case with `autoAllocate=false`.
2. Transition to `MATCHED` succeeds.
3. Attempt transition to `READY_TO_SCHEDULE`.
4. Assert HTTP `409`.
5. Assert error includes `Required documents pending` and `TERMS_AND_CONDITIONS`.

Database proof from `06-post-run-proof.json`:

- Single gate case `CASE-1027` remains `MATCHED`.
- Couple gate case `CASE-1028` remains `MATCHED`.
- Required docs for both are still `TERMS_AND_CONDITIONS: SENT`.

## Edge Cases Verified

- Variable durations for single sessions (`30/60/90`) match exactly.
- Variable durations for couple sessions (`30/60/90`) match exactly.
- Forced same-specialist overrides do not create overlaps.
- Document gate prevents illegal status transition to `READY_TO_SCHEDULE`.
- Full lifecycle closes only after required documents are completed.
- Manual override actions produce audit log entries with booking metadata.

## Notes

- The seeded fixture booking `fake-seed-booking-1001` is intentionally static seed data and may not follow generated weekday-slot rules.  
- Generated simulator bookings validated by tests do follow the deterministic fake provider behavior and no-overlap constraints.

## Re-run Instructions

To regenerate a new evidence bundle:

```bash
cd /Users/adambrown/Developer/codex-cgplatform
npx prisma db push --force-reset
npm run db:seed
FORCE_COLOR=0 NO_COLOR=1 npx playwright test --reporter=json > /tmp/playwright-report.json
FORCE_COLOR=0 NO_COLOR=1 npx playwright test --reporter=list > /tmp/playwright-list.txt
```

If you want a fresh in-repo artifact bundle, repeat the scripted collection workflow used in this report and write outputs into a new timestamped directory under `docs/e2e-evidence/`.
