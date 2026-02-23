# PRD: Client Self-Scheduling

**Status**: Draft
**Author**: Adam Brown / Claude
**Date**: 2026-02-23
**Branch**: `feature/client-self-scheduling`

---

## 1. Problem Statement

Today, after a client submits their counselling intake form, the ops team manually schedules every session by dragging cases onto counsellor time slots on the assignment board. This creates two bottlenecks:

1. **Ops workload** — Every case requires a human to match availability and pick a time slot, even when the clinical matching (which counsellor) has already been decided.
2. **Time to first session** — Clients wait for the ops team to get around to scheduling, which may take hours or days depending on workload.

The clinical matching step (deciding *which* counsellor) is valuable and should remain with the ops team. But the time-slot selection step (deciding *when*) can be delegated to the client.

---

## 2. Proposed Solution

After the ops team allocates a client to a counsellor, the platform sends the client a **secure booking link**. The client opens the link, sees available time slots filtered by their own stated preferences, and picks a time. The booking is created automatically in Microsoft Bookings.

**Key principle**: The ops team controls *who* the client sees. The client controls *when*.

---

## 3. User Flow

### 3.1 Flowchart

```
                         CLIENT INTAKE
                              |
                              v
                    +-------------------+
                    |  Client submits   |
                    |  intake form      |
                    |  (existing flow)  |
                    +-------------------+
                              |
                              v
                    +-------------------+
                    |  Case created     |
                    |  Status: NEW      |
                    +-------------------+
                              |
                              v
                    +-------------------+
                    |  Workflow steps    |
                    |  (T&Cs, consent)  |
                    +-------------------+
                              |
                              v
                    +-------------------+
                    |  Case status:     |
                    |  READY_TO_SCHEDULE|
                    +-------------------+
                              |
                              v
              +-------------------------------+
              |  OPS TEAM: Clinical matching  |
              |  Allocate client to a         |
              |  specific counsellor          |
              +-------------------------------+
                              |
                              v
              +-------------------------------+
              |  Platform generates secure    |
              |  booking link (PIN-protected) |
              |  and emails it to client      |
              +-------------------------------+
                              |
                              v
                    +-------------------+
                    |  Case status:     |
                    |  AWAITING_BOOKING |  <-- NEW STATUS
                    +-------------------+
                              |
                              v
              +-------------------------------+
              |  CLIENT: Opens booking link   |
              |  Verifies PIN                 |
              +-------------------------------+
                              |
                              v
              +-------------------------------+
              |  CLIENT: Sees available slots |
              |  Filtered by:                 |
              |  1. Counsellor's real         |
              |     availability (MS Bookings)|
              |  2. Client's time preferences |
              |     (from intake form)        |
              |  3. Session duration           |
              +-------------------------------+
                              |
                              v
              +-------------------------------+
              |  CLIENT: Selects a time slot  |
              +-------------------------------+
                              |
                              v
              +-------------------------------+
              |  Platform creates booking in  |
              |  Microsoft Bookings           |
              |  Creates Session record       |
              |  Sends calendar invites       |
              +-------------------------------+
                              |
                              v
                    +-------------------+
                    |  Case status:     |
                    |  SCHEDULED        |
                    +-------------------+
                              |
                              v
                    +-------------------+
                    |  Both parties get |
                    |  calendar invites |
                    |  from MS Bookings |
                    +-------------------+


    EXPIRY / FALLBACK PATH
    ----------------------

              +-------------------------------+
              |  Booking link expires         |
              |  (e.g. 7 days, configurable)  |
              +-------------------------------+
                              |
                              v
              +-------------------------------+
              |  OPS team sees case still in  |
              |  AWAITING_BOOKING status      |
              |  Can: re-send link, or        |
              |  manually schedule (existing  |
              |  assignment board flow)        |
              +-------------------------------+
```

### 3.2 Step-by-Step

1. **Client completes intake** — existing flow, unchanged.
2. **Case progresses through workflow steps** — T&Cs, consent forms, etc. Case reaches `READY_TO_SCHEDULE`.
3. **Ops team allocates counsellor** — On the assignment board or case detail page, the ops manager selects a counsellor for the case. This is the clinical matching decision.
4. **Platform sends booking link** — An email is sent to the client's primary email with a secure PIN and link to `/booking/access/{accessKey}`. The case transitions to a new `AWAITING_BOOKING` status.
5. **Client opens link and verifies PIN** — Same security pattern as existing form access (6-digit PIN, max attempts, expiry).
6. **Client sees filtered available slots** — The booking page shows the assigned counsellor's available time slots, filtered to only show slots that match the client's stated time preferences (morning/afternoon/evening from intake).
7. **Client selects a slot** — The platform calls `createBooking()` on the scheduling provider, creates a Session record, and transitions the case to `SCHEDULED`.
8. **Calendar invites sent** — Microsoft Bookings sends calendar invites to both the counsellor and the client automatically.
9. **Confirmation shown** — The client sees a confirmation page with the booking details.

### 3.3 Fallback Paths

- **Link expires**: Ops team can re-issue a new booking link, or fall back to manual scheduling on the assignment board.
- **No matching slots**: If the counsellor has no availability matching the client's preferences, the page shows a message explaining this and suggests the client contact the service. Ops team can also manually override.
- **Client doesn't book**: Case stays in `AWAITING_BOOKING`. Ops dashboard shows these cases so the team can follow up.

---

## 4. Detailed Requirements

### 4.1 New Case Status: `AWAITING_BOOKING`

Add `AWAITING_BOOKING` to the `CaseStatus` enum, positioned between `READY_TO_SCHEDULE` and `SCHEDULED`.

**Transitions**:
```
READY_TO_SCHEDULE  -->  AWAITING_BOOKING   (when booking link sent)
AWAITING_BOOKING   -->  SCHEDULED          (when client books)
AWAITING_BOOKING   -->  SCHEDULED          (when ops manually schedules)
READY_TO_SCHEDULE  -->  SCHEDULED          (existing manual flow, unchanged)
```

The existing manual scheduling flow (`READY_TO_SCHEDULE` → `SCHEDULED`) remains available as a fallback.

### 4.2 Booking Access Model

Create a new `BookingAccessInvite` model following the existing `FormAccessPin` security pattern:

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key (cuid) |
| `caseId` | String | FK to Case |
| `clientId` | String | FK to Client (primary participant) |
| `specialistId` | String | FK to assigned Specialist |
| `accessKey` | String | 32-char hex, unique |
| `pinHash` | String | SHA256 hash of 6-digit PIN |
| `expiresAt` | DateTime | When the link expires |
| `sessionTokenHash` | String? | Session token after PIN verify |
| `sessionExpiresAt` | DateTime? | Session expiry |
| `attemptCount` | Int | PIN entry attempts (default 0) |
| `maxAttempts` | Int | Max PIN attempts (default 5) |
| `bookedAt` | DateTime? | When client completed booking |
| `revokedAt` | DateTime? | If manually revoked |
| `metadata` | Json? | Extra context |
| `issuedByUserId` | String? | FK to OPS user who triggered |

### 4.3 Booking Page (Client-Facing)

**Route**: `/booking/access/{accessKey}`

**PIN Verification Screen**:
- 6-digit PIN input
- Same UX as existing form access PIN pages
- On success: set session cookie, show booking calendar

**Slot Selection Screen**:
- Display assigned counsellor's first name only (privacy)
- Show available slots grouped by day
- Filter slots by client's time preferences from intake:
  - `MORNING` = slots starting between 06:00–12:00
  - `AFTERNOON` = slots starting between 12:00–17:00
  - `EVENING` = slots starting between 17:00–21:00
- Show session duration (e.g. "60-minute session")
- Each slot shows start time in the client's local timezone (detected from browser)
- Client clicks a slot → confirmation dialog → booking created

**Confirmation Screen**:
- "Your session is booked"
- Date, time, duration
- Counsellor's first name
- "You'll receive a calendar invite shortly"

### 4.4 Slot Filtering Logic

Available slots = intersection of:

1. **Counsellor's real availability** — from `getAvailableSlots()` (Microsoft Bookings)
2. **Client's time preferences** — from `intakeFormData.availability.timePreferences`
3. **Session duration** — from case counselling type (`defaultIndividualSessionMinutes` or `defaultCoupleSessionMinutes`)

If a client selected multiple preferences (e.g. MORNING + EVENING), slots from any of those blocks are shown.

If no preferences were stated (empty array), show all available slots.

### 4.5 Email: Booking Link

**New EmailType**: `BOOKING_LINK`

**Subject**: "Book your counselling session"

**Body**:
- Greeting with client's first name
- "You've been matched with a counsellor. Please use the link below to choose a session time that works for you."
- PIN code (6 digits, prominent styling)
- Secure access URL
- Expiry notice
- Contact info for help

### 4.6 Ops Team Experience

**On the case detail page** (`/admin/cases/{id}`):
- When case is in `AWAITING_BOOKING`, show a panel:
  - "Booking link sent to {email} on {date}"
  - "Expires: {expiry date}"
  - "PIN attempts: {count}/{max}"
  - Button: "Re-send booking link" (revokes old, issues new)
  - Button: "Schedule manually" (overrides to assignment board flow)

**On the assignment board**:
- Cases in `AWAITING_BOOKING` appear in a distinct visual state (e.g. pulsing border, different colour) to indicate they're waiting for client action.
- Ops can still drag an `AWAITING_BOOKING` case to a slot to manually override.

**On the cases list**:
- `AWAITING_BOOKING` status badge with appropriate colour.

### 4.7 Configuration (Admin Settings)

Add to Integration Settings (`/admin/settings/integrations`):

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `bookingLinkExpiresHours` | 168 (7 days) | 24–720 | How long booking links are valid |
| `bookingLinkMaxAttempts` | 5 | 1–10 | Max PIN entry attempts |
| `autoSendBookingLink` | true | boolean | Automatically send link on allocation, or require manual trigger |

### 4.8 Audit Trail

All booking access operations are logged to `AuditLog`:
- `BOOKING_LINK_ISSUED` — when link is created and sent
- `BOOKING_LINK_VERIFIED` — when client successfully enters PIN
- `BOOKING_LINK_VERIFY_FAILED` — when PIN entry fails
- `BOOKING_LINK_REVOKED` — when ops manually revokes
- `CLIENT_SELF_SCHEDULED` — when client selects a time slot (includes slot details)

---

## 5. Data Flow Diagram

```
+-------------+     allocate      +----------+     send link     +---------+
|  OPS TEAM   | ----------------> | PLATFORM | ---------------> | CLIENT  |
|             |                   |          |                  | (email) |
+-------------+                   +----------+                  +---------+
                                       |                             |
                                       |  create BookingAccessInvite |
                                       |  transition to              |
                                       |  AWAITING_BOOKING           |
                                       |                             |
                                       |                             v
                                       |                    +-----------------+
                                       |                    | Client opens    |
                                       |                    | /booking/access |
                                       |                    | verifies PIN    |
                                       |                    +-----------------+
                                       |                             |
                                       v                             v
                              +------------------+         +------------------+
                              | MS Bookings API  | <------ | Client picks     |
                              | getAvailability  |         | time slot        |
                              +------------------+         +------------------+
                                       |                             |
                                       v                             v
                              +------------------+         +------------------+
                              | MS Bookings API  | <------ | Platform creates |
                              | createAppointment|         | booking          |
                              +------------------+         +------------------+
                                       |                             |
                                       v                             v
                              +------------------+         +------------------+
                              | Calendar invites |         | Case -> SCHEDULED|
                              | sent to both     |         | Session created  |
                              +------------------+         +------------------+
```

---

## 6. Technical Architecture

### 6.1 New/Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `AWAITING_BOOKING` to CaseStatus, add `BookingAccessInvite` model, add `BOOKING_LINK` to EmailType |
| `src/lib/booking-access.ts` | **New** — issue, verify, revoke booking links (mirrors `form-access.ts` pattern) |
| `src/lib/booking-slots.ts` | **New** — fetch and filter available slots by client preferences |
| `src/app/booking/access/[accessKey]/page.tsx` | **New** — PIN verification + slot selection page (client-facing) |
| `src/app/api/booking/slots/route.ts` | **New** — API to fetch filtered slots for a booking invite |
| `src/app/api/booking/confirm/route.ts` | **New** — API to confirm slot selection and create booking |
| `src/lib/mailer.ts` | Add `sendBookingLinkEmail()` template |
| `src/lib/workflow.ts` | Update `CASE_TRANSITIONS` to include `AWAITING_BOOKING` |
| `src/lib/case-service.ts` | Add `sendBookingLink()`, update allocation flow |
| `src/lib/integration-settings.ts` | Add booking link configuration fields |
| `src/app/admin/cases/[id]/page.tsx` | Add booking link status panel |
| `src/components/admin/manual-assignment-board.tsx` | Visual treatment for `AWAITING_BOOKING` cases |
| `src/app/actions.ts` | Add `sendBookingLinkAction()`, `revokeBookingLinkAction()` |

### 6.2 API Endpoints

**`GET /api/booking/slots?accessKey={key}`**
- Requires valid session cookie (PIN already verified)
- Returns available slots filtered by client preferences
- Response: `{ slots: [{ date: string, startTime: string, endTime: string }] }`

**`POST /api/booking/confirm`**
- Requires valid session cookie
- Body: `{ accessKey: string, startTime: string }`
- Creates booking via scheduling provider
- Creates Session record
- Transitions case to SCHEDULED
- Marks BookingAccessInvite as `bookedAt`
- Response: `{ ok: true, booking: { date, startTime, endTime, counsellorFirstName } }`

### 6.3 Reused Patterns

| Pattern | Source | Reuse |
|---------|--------|-------|
| PIN security (hash, verify, attempts) | `src/lib/form-access.ts` | Same SHA256 hashing, timing-safe compare, session tokens |
| Session cookies | `src/lib/form-access.ts` | Same httpOnly/secure/sameSite cookie pattern |
| Email template | `src/lib/mailer.ts` | Same Resend API, HTML builder, email logging |
| Slot fetching | `src/lib/scheduling/microsoft-bookings-provider.ts` | Direct reuse of `getAvailableSlots()` |
| Booking creation | `src/lib/scheduling/microsoft-bookings-provider.ts` | Direct reuse of `createBooking()` |
| Time preference filtering | `src/lib/case-service.ts` | Reuse `slotMatchesAnyManualTimeBlock()` |
| Audit logging | `src/lib/case-service.ts` | Same `AuditLog` creation pattern |
| Admin settings | `src/lib/integration-settings.ts` | Add fields to existing settings type |

---

## 7. Edge Cases

| Scenario | Handling |
|----------|----------|
| Client books, then ops unassigns | Cancel MS Bookings appointment (existing flow), revoke booking link, case returns to `READY_TO_SCHEDULE` |
| Ops manually schedules while link is active | Revoke booking link, case skips to `SCHEDULED` |
| Booking link expires | Case stays in `AWAITING_BOOKING`, visible on ops dashboard for follow-up |
| Counsellor has no availability | Booking page shows "No available times" message, suggests contacting the service |
| Client's preferences match zero slots | Show message: "No slots match your preferred times. Contact us for alternative arrangements." With option to show all available slots regardless of preference. |
| Couples case | Both participants share the same booking link (sent to primary email). Only one booking needed. |
| Multiple active links | Issuing a new link revokes all previous active links for the same case |
| Client tries to book an already-taken slot | Re-fetch availability at confirmation time. Show error and refresh slots if taken. |
| PIN brute force | Max 5 attempts (configurable), then link is locked. Ops can re-issue. |

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Reduction in ops scheduling time per case | >80% (only clinical matching remains manual) |
| Time from allocation to first session booked | <24 hours (vs current multi-day manual process) |
| Client booking link completion rate | >70% within 7 days |
| Cases requiring ops fallback to manual scheduling | <20% |

---

## 9. Out of Scope (Future)

- **Client rescheduling** — Client cannot change their booking after confirming. Must contact ops.
- **Waitlist** — No automatic waitlisting if counsellor has no availability.
- **SMS notifications** — Email only for now.
- **Multiple session booking** — One booking per link. Recurring sessions are a future feature.
- **Client choosing counsellor** — Ops team retains full control of the clinical matching decision.

---

## 10. Dependencies

- Microsoft Bookings integration must be configured and working (already built)
- Resend email service must be configured (already built)
- At least one specialist must have MS Bookings IDs configured

---

## 11. Rollout Plan

1. **Phase 1**: Build feature behind `autoSendBookingLink = false` (default off). Ops can manually trigger booking links per case.
2. **Phase 2**: Enable `autoSendBookingLink = true` to automatically send booking links when a counsellor is allocated.
3. **Phase 3**: Gather metrics and refine UX based on client completion rates.
