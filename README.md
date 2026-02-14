# Case Workflow + Scheduling Provider MVP

This app is the workflow/operations brain for a counselling service.

- Cases are created from intake submissions.
- Each case is assigned a counselling workflow template.
- Scheduling is provider-driven (`fake` now, `calcom` placeholder) and blocked until required workflow steps are complete.

## Architecture Contract

- App owns: case lifecycle, workflow compliance, assignment, and audit logs.
- Scheduling provider owns: booking slot truth and booking creation.
- The app must not schedule if workflow blocking steps are incomplete.

## Workflow Engine

Implemented models:

- `CaseWorkflowTemplate`
  - `counsellingType`
  - ordered `steps`
- `CaseWorkflowStep`
  - `name`
  - `type` (`FORM` | `REVIEW` | `SYSTEM`)
  - `required`
  - `blocksScheduling`
  - optional `formType` key for external form mapping
- `CaseWorkflowState`
  - `caseId`
  - `stepId`
  - `status` (`PENDING` | `COMPLETED`)
  - `metadata`

When a case is created, the system selects an active `CaseWorkflowTemplate` for the counselling type and initializes `CaseWorkflowState` rows.

## Scheduling Provider

`src/lib/scheduling/types.ts`

```ts
interface SchedulingProvider {
  getAvailableSlots(specialistId, eventType, durationMinutes): Promise<Date[]>;
  createBooking(specialistId, startTime, caseData): Promise<BookingResult>;
  cancelBooking(bookingId): Promise<void>;
}
```

Provider implementations:

- `FakeSchedulingProvider` (`src/lib/scheduling/fake-provider.ts`)
- `CalcomSchedulingProvider` placeholder (`src/lib/scheduling/calcom-provider.ts`)

Factory:

- `src/lib/scheduling/index.ts`
- env switch: `SCHEDULING_PROVIDER=fake|calcom`

External provider compatibility:

- Availability and booking are provider-owned and can come from external APIs.
- The app normalizes provider responses into internal booking/session records.
- Workflow and allocation logic are provider-agnostic; changing provider should only require a new adapter implementing `SchedulingProvider`.
- This supports Cal.com or alternatives (for example Microsoft Bookings) without changing case lifecycle logic.

## Scheduling Gate (Required Rule)

Scheduling is rejected unless all required blocking workflow steps are completed.

- Service-layer enforcement in case allocation/override (`src/lib/case-service.ts`).
- Rejection message: `Case not eligible for scheduling`.
- Availability policy lock-in: `separate participant submissions with overlap required`.
  - Singles: one participant availability submission required.
  - Couples: each participant submits separately, and scheduling is only eligible when submitted windows overlap for the required session duration.

## Form Ingestion Endpoint

Generic external form completion ingestion:

- `POST /forms/submission`

Payload supports:

- `formType`
- `participantIdentifier` (email/phone)
- optional identifiers: `caseId` or `caseReference`
- `answersMetadata`/`metadata`

Behavior:

1. Match submission to a case.
2. Match to workflow form step by `formType`.
3. Mark `CaseWorkflowState` as completed.
4. Re-evaluate and return scheduling eligibility.

For workflow steps marked as "both participants", participant completions are tracked in metadata and the step only completes once all participants submit.

Note: form files/documents are **not** stored by this endpoint. Only completion state + metadata are stored.

Availability ingestion (separate endpoint):

- `POST /availability/submission`

Payload:

- `participantIdentifier`
- optional identifiers: `caseId` or `caseReference`
- `windows[]` with `startTime` and `endTime`
- optional: `timezone`, `metadata`, `source`

Behavior:

1. Match participant + case.
2. Replace that participant's active availability windows.
3. Recompute overlap across participants.
4. Update `AVAILABILITY_SUBMISSION` workflow step (`PENDING`/`COMPLETED`).
5. Return current scheduling eligibility.

## Case Lifecycle

Case statuses:

1. `NEW`
2. `AWAITING_REVIEW`
3. `MATCHED`
4. `AGREEMENT_PENDING`
5. `READY_TO_SCHEDULE`
6. `SCHEDULED`
7. `IN_SESSION`
8. `COMPLETED`
9. `CLOSED`

Public intake creates pending cases (`AWAITING_REVIEW`) and does not auto-schedule.

## Data Model Highlights

Core models:

- `Case`
- `CaseParticipant`
- `Specialist`
- `Session`
- `DocumentTemplate`
- `DocumentInstance`
- `AuditLog`
- `CaseWorkflowTemplate`
- `CaseWorkflowStep`
- `CaseWorkflowState`
- `CaseAvailabilityWindow`

Supporting models:

- `Client`
- `OperationsUser`
- `UserAccount`
- `AuthSession`

## Local Run

1. Install and configure:

```bash
npm install
cp .env.example .env
```

2. Generate/push/seed:

```bash
npm run db:generate
npx prisma db push --force-reset
npm run db:seed
```

3. Start app:

```bash
npm run dev
```

## Demo Credentials

- Ops: `ops@demo.local / password123`
- Specialist: `avery.specialist@demo.local / password123`
- Specialist: `jordan.specialist@demo.local / password123`

## Ops Screens

- `/admin/cases`
- `/admin/cases/[id]`
- `/admin/clients`
- `/admin/specialists`
- `/admin/specialists/[id]`
- `/admin/workflows` (design templates/steps)

Public:

- `/intake`

Specialist:

- `/specialist/sessions`
- `/specialist/sessions/[id]`
- `/specialist/clients`

## API Surface

- `POST /api/intake`
- `POST /forms/submission`
- `POST /availability/submission`
- `POST /api/cases/:id/allocate`
- `POST /api/cases/:id/transition`
- `POST /api/cases/:id/override`
- `POST /api/documents/:id/complete`
- `POST /api/provider/events`
- `POST /dev/simulate-week`
- `POST /dev/create-test-cases`
- `POST /dev/provider/cancel/:bookingId`

## Example Flow (Counselling)

1. Client submits intake form.
2. Case is created in pending review and assigned a workflow template.
3. External form completions are ingested via `/forms/submission`.
4. Clients submit availability via `/availability/submission` (separate per participant).
5. Workflow remains blocked until overlap exists for all required participants.
6. Once blocking workflow steps are complete, ops can run allocation.
7. Scheduler books the earliest eligible slot and case moves to `SCHEDULED`.

Provider-originated booking events are ingested via `/api/provider/events`. Cancellation events mark the session cancelled and move the case back to `READY_TO_SCHEDULE`.

## End-to-End Tests

Run:

```bash
npm run test:e2e
```

Current suite validates:

- intake-to-closure flow
- specialist profile edit
- role-scoped client dashboards
- one-to-one durations: `30/60/90`
- many-to-one durations: `30/60/90`
- scheduling gate blocks allocation until blocking workflow steps complete
- availability overlap gate blocks allocation until required participant submissions overlap
- booking clash prevention
- external provider cancellation returns case to `READY_TO_SCHEDULE`
- terms gating on status transition
