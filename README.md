# Case Workflow + Scheduling Provider MVP

This app is the workflow and allocation layer for a service-delivery organisation.
Scheduling now runs through a provider abstraction with a deterministic fake scheduler for local development.

## Architecture Contract

- This app owns: case lifecycle, assignment rules, document workflow, and audit logs.
- Scheduling is accessed only via `SchedulingProvider`.
- Business logic never computes slots directly outside provider implementations.
- Session records store provider booking references and provider-owned time values.

## Discovery Summary (Current State)

Before refactor, scheduling lived in `src/lib/case-service.ts` and called Cal.com functions directly from `src/lib/calcom.ts`.
Session fields were Cal.com-specific (`calBookingId`, `calStartTime`, etc).

Refactor preserved lifecycle/document logic and replaced scheduling calls with provider-based adapters.

## Scheduling Provider Abstraction

`src/lib/scheduling/types.ts`

```ts
interface SchedulingProvider {
  getAvailableSlots(specialistId, eventType, durationMinutes): Promise<Date[]>;
  createBooking(specialistId, startTime, caseData): Promise<BookingResult>;
  cancelBooking(bookingId): Promise<void>;
}
```

Factory:

- `src/lib/scheduling/index.ts`
- Environment switch: `SCHEDULING_PROVIDER=fake|calcom`

Implementations:

- `FakeSchedulingProvider` (`src/lib/scheduling/fake-provider.ts`)
- `CalcomSchedulingProvider` placeholder (`src/lib/scheduling/calcom-provider.ts`)

## Fake Scheduler Behaviour

- Weekly hours: Mon-Fri, 09:00-12:00 and 13:00-17:00 (UTC).
- Deterministic slot generation over next 14 days.
- No randomness.
- Overlap prevention based on active sessions (`SCHEDULED`, `IN_SESSION`).
- Cancellation support by booking id.

Default durations:

- Individual: 40 minutes
- Couple: 60 minutes

Optional duration override for simulation/testing:

- `requestedDurationMinutes` on intake payload (supports deterministic tests like 30/60/90).

## Session Model (Provider-Owned)

`prisma/schema.prisma` -> `Session` fields:

- `providerBookingId`
- `providerStartTime`
- `providerEndTime`
- `providerType` (`"fake" | "calcom"` value stored as string)

No manual/ad-hoc session time generation in workflow paths.

## Stack

- Next.js (App Router)
- TypeScript
- PostgreSQL
- Prisma ORM
- Simple email/password auth

## Core Models

Required models implemented:

- `Case`
- `CaseParticipant`
- `Specialist`
- `Session`
- `DocumentTemplate`
- `DocumentInstance`
- `AuditLog`

Additional supporting models:

- `Client`
- `OperationsUser`
- `UserAccount`
- `AuthSession`

## Local Run

1. Start PostgreSQL (example):

```bash
docker run --name cgplatform-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=cgplatform \
  -p 5432:5432 -d postgres:16
```

2. Configure env:

```bash
cp .env.example .env
```

Minimum env values:

- `DATABASE_URL`
- `SCHEDULING_PROVIDER` (`fake` for local MVP)

3. Prepare DB:

```bash
npm install
npm run db:generate
npx prisma db push --force-reset
npm run db:seed
```

4. Start app:

```bash
npm run dev
```

5. Open:

- Intake: `http://localhost:3001/intake`
- Login: `http://localhost:3001/login`

## Demo Credentials

- Ops: `ops@demo.local / password123`
- Specialist: `avery.specialist@demo.local / password123`
- Specialist: `jordan.specialist@demo.local / password123`

## Lifecycle + Documents

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

Document triggers:

- `NEW` -> Terms & Conditions
- `MATCHED` -> Contract
- `SCHEDULED` -> Intake Form
- `COMPLETED` -> Outtake Form

Required document gates:

- Enter `READY_TO_SCHEDULE`: Terms & Conditions + Contract completed
- Enter `IN_SESSION`: Intake Form completed
- Enter `CLOSED`: Outtake Form completed

## Assignment Flow

When assigning a case:

1. Determine participant count.
2. Select eligible specialist (`supportsCouples=true` for couples).
3. Resolve session type (`individual` / `couple`) and duration.
4. Ask provider for available slots.
5. Pick earliest slot.
6. Create provider booking.
7. Save provider booking reference to `Session`.
8. Move case to `SCHEDULED` and trigger scheduling docs.

## Override Flow

Ops can override assignment from case detail:

- choose specialist
- provide override reason
- optional matching-rule note

Override cancels prior booking reference and rebooks through provider.

## Development Simulation Endpoint

`POST /dev/simulate-week`

Creates a batch of simulated single/couple cases and auto-assigns them via provider.
Default durations created: `30`, `60`, `90`.

Example:

```bash
curl -X POST http://localhost:3001/dev/simulate-week \
  -H "Content-Type: application/json" \
  -d '{"durations":[30,60,90]}'
```

## API Surface

- `POST /api/intake`
- `POST /api/cases/:id/allocate`
- `POST /api/cases/:id/transition`
- `POST /api/cases/:id/override`
- `POST /api/documents/:id/complete`
- `POST /dev/simulate-week`

## Role-Based Access

Ops users do not have personal case ownership views. Their dashboards are global:

- `/admin/cases` -> all cases
- `/admin/clients` -> all clients
- `/admin/specialists` -> all specialists

Specialists only see their own workload:

- `/specialist/sessions` -> only sessions where `session.specialistId = current specialist`
- `/specialist/clients` -> only clients linked to cases assigned to the current specialist

## Screens

Public:

- `/intake`

Admin/Ops:

- `/admin/cases`
- `/admin/cases/[id]`
- `/admin/clients`
- `/admin/specialists`
- `/admin/specialists/[id]`

Specialist:

- `/specialist/sessions`
- `/specialist/sessions/[id]`
- `/specialist/clients`

## Example Workflow Walkthrough

### 1) Lifecycle end-to-end

1. Submit intake.
2. Case is created in `NEW`, Terms sent.
3. Auto assignment uses provider and books earliest slot.
4. Ops completes required docs and transitions status.
5. Intake/Outtake forms trigger at scheduling/completion milestones.

### 2) Couple matching

1. Submit intake as couple.
2. Allocation filters to `supportsCouples = true` specialists.
3. Session type resolves to `couple`, then provider returns slots and booking.

### 3) Override

1. Open `/admin/cases/[id]`.
2. Choose specialist in override form.
3. Submit reason.
4. System rebooks through provider and records `MANUAL_OVERRIDE` audit entry.

### 4) Client dashboard visibility

1. Ops opens `/admin/clients` and sees all clients with linked cases.
2. Specialist opens `/specialist/clients` and sees only assigned clients/cases.

## End-to-End Tests

Run:

```bash
npm run test:e2e
```

Covered scenarios include:

- Intake-to-closure workflow
- Specialist profile editing
- Role-scoped client dashboards
- One-to-one bookings at 30/60/90 minutes
- Many-to-one bookings at 30/60/90 minutes
- Clash prevention for one-to-one and many-to-one bookings
- Blocking `READY_TO_SCHEDULE` when required terms documents are incomplete
