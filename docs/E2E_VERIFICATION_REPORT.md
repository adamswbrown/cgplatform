# E2E Verification Report (Workflow Gate + Scheduling)

Generated: 2026-02-14T12:12:02Z  
Workspace: `/Users/adambrown/Developer/codex-cgplatform`  
Evidence bundle: `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z`  
Latest symlink: `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/latest`

## Commands Executed

```bash
npx prisma db push --force-reset
node prisma/seed.mjs
FORCE_COLOR=0 NO_COLOR=1 npx playwright test --reporter=json
FORCE_COLOR=0 NO_COLOR=1 npx playwright test --reporter=list
```

Raw logs:

- `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/01-db-push.txt`
- `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/02-db-seed.txt`
- `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/04-playwright-report.json`
- `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/05-playwright-list.txt`

## Overall Result

From `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/04-playwright-report.json` (`stats`):

- Expected: `9`
- Unexpected: `0`
- Flaky: `0`
- Skipped: `0`
- Duration: `28376.388ms`

From `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/05-playwright-list.txt`:

- `9 passed (26.6s)`

## Seed Baseline Proof

From `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/03-seed-snapshot.json`:

- `caseWorkflowTemplates = 2` (`INDIVIDUAL_COUNSELLING`, `COUPLES_COUNSELLING`)
- `caseWorkflowSteps = 5`
- `caseWorkflowStates = 5`
- Seeded individual case (`CASE-1001`) has blocking workflow steps completed.
- Seeded couples case (`CASE-1002`) has blocking workflow steps pending.

## Scenario Proof Mapping

### 1) Intake to closed case smoke flow

- Test: `/Users/adambrown/Developer/codex-cgplatform/tests/e2e/intake-to-closure.spec.ts:227`
- Proof: `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/06-post-run-proof.json`
  - `smokeFlowAssertion.caseReference = CASE-1018`
  - `smokeFlowAssertion.status = CLOSED`
  - `smokeFlowAssertion.sessionStatuses = ["COMPLETED"]`

### 2) Ops specialist profile editing

- Test: `/Users/adambrown/Developer/codex-cgplatform/tests/e2e/intake-to-closure.spec.ts:284`
- UI assertion: specialist profile save shows success and persisted values.

### 3) Role-scoped dashboards

- Test: `/Users/adambrown/Developer/codex-cgplatform/tests/e2e/intake-to-closure.spec.ts:306`
- UI assertion: ops sees global clients, specialist sees scoped client list.

### 4) One-to-one 30/60/90 durations

- Test: `/Users/adambrown/Developer/codex-cgplatform/tests/e2e/intake-to-closure.spec.ts:333`
- Proof (`06-post-run-proof.json`):
  - `durationAssertions.singles.allMatch = true`
  - `CASE-1019` requested `30`, actual `30`
  - `CASE-1020` requested `60`, actual `60`
  - `CASE-1021` requested `90`, actual `90`

### 5) Scheduling gate enforcement (blocking workflow steps)

- Test: `/Users/adambrown/Developer/codex-cgplatform/tests/e2e/intake-to-closure.spec.ts:363`
- UI/API assertion: allocation returns `409` before blocking steps complete, then succeeds.
- Post-run proof:
  - `schedulingGate.caseReference = CASE-1022`
  - `schedulingGate.eligibleAfterCompletion = true`
  - `schedulingGate.pendingBlockingStepsAfterCompletion = []`

### 6) Couples workflow requires both participants

- Test: `/Users/adambrown/Developer/codex-cgplatform/tests/e2e/intake-to-closure.spec.ts:393`
- Proof (`06-post-run-proof.json`):
  - `couplesBothParticipantsGate.caseReference = CASE-1023`
  - `participantCount = 2`
  - `intake.status = COMPLETED` and `participantsCompleted.length = 2`
  - `consent.status = COMPLETED` and `participantsCompleted.length = 2`
  - `bothParticipantStepsSatisfied = true`

### 7) Many-to-one 30/60/90 durations

- Test: `/Users/adambrown/Developer/codex-cgplatform/tests/e2e/intake-to-closure.spec.ts:464`
- Proof (`06-post-run-proof.json`):
  - `durationAssertions.couples.allMatch = true`
  - `CASE-1024` requested `30`, actual `30`
  - `CASE-1025` requested `60`, actual `60`
  - `CASE-1026` requested `90`, actual `90`

### 8) Clash prevention (single + couple)

- Test: `/Users/adambrown/Developer/codex-cgplatform/tests/e2e/intake-to-closure.spec.ts:503`
- Proof (`06-post-run-proof.json`):
  - `clashAssertions.singlePair.sameSpecialist = true`
  - `clashAssertions.singlePair.overlaps = false`
  - `clashAssertions.couplePair.sameSpecialist = true`
  - `clashAssertions.couplePair.overlaps = false`
  - `clashAssertions.globalActiveOverlapCount = 0`

### 9) Terms & conditions gate on transition

- Test: `/Users/adambrown/Developer/codex-cgplatform/tests/e2e/intake-to-closure.spec.ts:631`
- UI/API assertion: transition to `READY_TO_SCHEDULE` blocked when required docs incomplete.
- Post-run proof:
  - `termsTransitionGate.single.status = MATCHED`
  - `termsTransitionGate.couple.status = MATCHED`

## Artifact Index

- `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/01-db-push.txt`
- `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/02-db-seed.txt`
- `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/03-seed-snapshot.json`
- `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/04-playwright-report.json`
- `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/04-playwright-report.stderr.txt`
- `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/05-playwright-list.txt`
- `/Users/adambrown/Developer/codex-cgplatform/docs/e2e-evidence/2026-02-14T12-09-31Z/06-post-run-proof.json`
