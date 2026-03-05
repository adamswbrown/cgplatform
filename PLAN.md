# Implementation Plan: Align Platform to Agreed Client Intake Flow

## Overview
Bring the platform in line with the agreed 8-step client intake process. Work is broken into 8 phases, ordered by dependency chain. Each phase is independently deployable.

---

## Phase 1: Make the referral form public (Step 1)

**What changes:** The intake form becomes fully public at `/intake` — no PIN, no access key needed.

### Schema changes
- None required. The existing intake submission API already creates cases and clients.

### Files to modify

1. **`src/app/intake/page.tsx`** — Remove the "Secure Access Required" gate. Render the `IntakeMultiStepForm` directly without requiring an `accessKey`. Keep the PIN-gated path working for ops-issued invites as a secondary flow.

2. **`src/components/intake/intake-multi-step-form.tsx`** — Make `accessKey` optional. When no accessKey is present, the form submits without PIN session validation.

3. **`src/app/api/intake/route.ts`** (or the form submission handler) — Allow submissions without a valid form access session when the source is the public form. Still validate all form data with Zod.

4. **`src/lib/form-access.ts`** — Add a bypass path in `requireFormAccessOrRedirect` / `requireIntakeAccessOrRedirect` for the public intake route.

### Verification
- Visit `/intake` without any access key → form renders
- Submit the form → case created with AWAITING_REVIEW status, confirmation email sent
- Existing PIN-gated intake flow still works for ops-issued invites

---

## Phase 2: Add ADMIN role + decline referral path (Steps 2, 5 context)

**What changes:** New ADMIN UserRole. AWAITING_REVIEW can transition to CLOSED (decline). Purpose-built review UI.

### Schema changes (Prisma)

```prisma
enum UserRole {
  OPS
  ADMIN    // NEW
  SPECIALIST
}
```

### Files to modify

1. **`prisma/schema.prisma`** — Add `ADMIN` to UserRole enum.

2. **`src/lib/workflow.ts`** — Add `AWAITING_REVIEW → CLOSED` as a valid transition. Add `NEW → CLOSED` for edge cases.

3. **`src/app/admin/cases/[id]/page.tsx`** — Replace the generic transition dropdown for AWAITING_REVIEW status with a purpose-built clinical review panel:
   - Three buttons: "Accept Referral", "Accept with Flag", "Decline Referral"
   - Accept → transitions to MATCHED (or AWAITING_REVIEW → next status in flow)
   - Accept with Flag → prompts for flag text, saves to `flags[]` + `intakeReviewNotes`, then transitions
   - Decline → prompts for reason, transitions to CLOSED with audit log

4. **`src/lib/auth.ts`** — Update `requirePageUser` and `requireApiUser` to accept ADMIN role where appropriate. ADMIN users get access to `/admin` pages for scheduling/calendar tasks. OPS users retain all existing access.

5. **`src/app/api/cases/[id]/transition/route.ts`** — Allow both OPS and ADMIN roles.

6. **`src/components/authenticated-shell.tsx`** — Add ADMIN nav items (calendar/scheduling focused). OPS nav shows clinical review items.

### Verification
- ADMIN user can log in and see scheduling-related admin pages
- OPS user can accept/flag/decline a referral from the case detail page
- Declining a referral moves it to CLOSED with a reason in the audit log
- ADMIN user cannot access clinical review actions (only OPS can review referrals)

---

## Phase 3: Case proposal + counsellor accept/decline (Steps 3-4)

**What changes:** New `CaseProposal` model. Ops proposes a case to a counsellor. Counsellor sees it in their dashboard and formally accepts or declines.

### Schema changes (Prisma)

```prisma
enum CaseProposalStatus {
  PENDING
  ACCEPTED
  DECLINED
}

model CaseProposal {
  id            String              @id @default(cuid())
  caseId        String
  case          Case                @relation(fields: [caseId], references: [id])
  specialistId  String
  specialist    Specialist          @relation(fields: [specialistId], references: [id])
  proposedById  String
  proposedBy    UserAccount         @relation(fields: [proposedById], references: [id])
  status        CaseProposalStatus  @default(PENDING)
  notes         String?             // ops notes for the counsellor
  declineReason String?             // required if DECLINED
  respondedAt   DateTime?
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt

  @@index([caseId])
  @@index([specialistId, status])
}
```

Add relations:
- `Case` → `proposals CaseProposal[]`
- `Specialist` → `proposals CaseProposal[]`
- `UserAccount` → `proposedCases CaseProposal[]`

### New case status

Add `PROPOSED` to `CaseStatus` enum, between AWAITING_REVIEW and MATCHED:

```
AWAITING_REVIEW → PROPOSED (ops sends proposal)
PROPOSED → MATCHED (counsellor accepts)
PROPOSED → AWAITING_REVIEW (counsellor declines, ops re-proposes to someone else)
```

### New API routes

1. **`POST /api/cases/[id]/propose`** — OPS only. Creates a CaseProposal, transitions case to PROPOSED, sends email + (future) in-app notification to the counsellor.

2. **`POST /api/proposals/[id]/respond`** — SPECIALIST only. Accepts or declines. If accepted: case → MATCHED, specialist assigned. If declined: case → AWAITING_REVIEW, proposal marked DECLINED with reason.

### New pages / UI

1. **Specialist dashboard: "My Proposals" page** (`/specialist/proposals`) — Shows pending proposals with case summary (presenting issue, flags, availability), accept/decline buttons, decline reason textarea. Add to specialist nav.

2. **Admin case detail** — Replace the direct assignment with a "Propose to Counsellor" flow. Show proposal history on the case.

### Email

1. **`sendCaseProposalEmail()`** — New email template sent to counsellor when a case is proposed. Contains: case reference, presenting issue summary, any flags/notes from ops, link to respond.

2. **`sendProposalDeclinedNotification()`** — Notify ops when a counsellor declines, including the reason.

### Files to modify

1. `prisma/schema.prisma` — New model, new enum, new status, relations
2. `src/lib/workflow.ts` — New transitions for PROPOSED status
3. `src/lib/case-service.ts` — New functions: `proposeCaseToSpecialist()`, `respondToProposal()`
4. `src/app/api/cases/[id]/propose/route.ts` — New route
5. `src/app/api/proposals/[id]/respond/route.ts` — New route
6. `src/app/specialist/proposals/page.tsx` — New page
7. `src/app/admin/cases/[id]/page.tsx` — Replace assignment panel with proposal flow
8. `src/components/authenticated-shell.tsx` — Add "My Proposals" to specialist nav
9. `src/lib/mailer.ts` — New email templates
10. `src/components/admin/manual-assignment-board.tsx` — Update to use proposal flow instead of direct assignment

### Verification
- Ops reviews a case → clicks "Propose to Counsellor" → selects a counsellor → proposal created
- Counsellor sees proposal in `/specialist/proposals` with case details
- Counsellor accepts → case moves to MATCHED, specialist assigned
- Counsellor declines with reason → case goes back to AWAITING_REVIEW, ops notified
- Email sent on proposal and on decline

---

## Phase 4: Session time proposal workflow (Steps 5-6)

**What changes:** New `SessionTimeProposal` model. Admin proposes a time, counsellor confirms or rejects. Loop until agreed.

### Schema changes (Prisma)

```prisma
enum TimeProposalStatus {
  PENDING_COUNSELLOR   // waiting for counsellor to confirm
  CONFIRMED            // counsellor confirmed, ready to send to client
  REJECTED             // counsellor rejected, admin needs to re-propose
  PENDING_CLIENT       // sent to client for confirmation
  CLIENT_CONFIRMED     // client confirmed
  CLIENT_COUNTER       // client requested different time
}

model SessionTimeProposal {
  id              String                @id @default(cuid())
  caseId          String
  case            Case                  @relation(fields: [caseId], references: [id])
  specialistId    String
  specialist      Specialist            @relation(fields: [specialistId], references: [id])
  proposedById    String
  proposedBy      UserAccount           @relation(fields: [proposedById], references: [id])
  status          TimeProposalStatus    @default(PENDING_COUNSELLOR)
  proposedStart   DateTime
  proposedEnd     DateTime
  adminNote       String?
  counsellorNote  String?               // counsellor's note when rejecting
  clientNote      String?               // client's note when counter-proposing
  respondedAt     DateTime?
  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt

  @@index([caseId])
  @@index([specialistId, status])
}
```

### New API routes

1. **`POST /api/cases/[id]/propose-time`** — ADMIN/OPS. Creates a SessionTimeProposal with proposed start/end + optional note. Sends notification to counsellor.

2. **`POST /api/time-proposals/[id]/counsellor-respond`** — SPECIALIST only. Confirms or rejects with optional note. If confirmed → status becomes CONFIRMED and triggers client notification.

3. **`POST /api/time-proposals/[id]/client-respond`** — Public (PIN-protected). Client confirms or counter-proposes. If confirmed → session is created, case transitions to SCHEDULED.

### New pages / UI

1. **Specialist: "Pending Times" section** — on `/specialist/proposals` or a dedicated page. Shows proposed times with confirm/reject buttons.

2. **Admin case detail** — "Propose Session Time" panel appears after counsellor is MATCHED. Shows calendar, lets admin pick a time slot, add note, send to counsellor. Shows proposal history.

3. **Client: Time confirmation page** (`/forms/confirm-time`) — PIN-protected page showing proposed time + Terms of Counselling. Client can confirm both or request a different time with a note.

### Email

1. **`sendTimeProposalEmail()`** — To counsellor: "A session time has been proposed for [case ref]"
2. **`sendTimeConfirmedToClientEmail()`** — To client: Secure link + PIN to confirm the time
3. **`sendSessionConfirmationEmail()`** — To both counsellor and client once everything is confirmed
4. **`sendCounterProposalNotification()`** — To admin/ops when client requests different time

### Files to modify

1. `prisma/schema.prisma` — New model + enum
2. `src/lib/case-service.ts` — New functions for time proposal lifecycle
3. `src/lib/workflow.ts` — Ensure MATCHED → AGREEMENT_PENDING → READY_TO_SCHEDULE → SCHEDULED transitions support the new flow
4. New API routes (3 files)
5. `src/app/specialist/proposals/page.tsx` — Add time proposal section
6. `src/app/admin/cases/[id]/page.tsx` — Add time proposal panel
7. `src/app/forms/confirm-time/page.tsx` — New client-facing page
8. `src/lib/mailer.ts` — New email templates
9. `src/lib/form-access.ts` — Support time confirmation as a form type

### Verification
- Admin proposes a time for a matched case → counsellor gets notification
- Counsellor confirms → client receives secure link + PIN
- Client confirms time + accepts terms → session created, both get confirmation email
- Client counter-proposes → admin/ops notified, loop continues
- Counsellor rejects time → admin proposes a new one

---

## Phase 5: Client time confirmation + terms (Step 7)

**What changes:** Unified confirmation page where client sees proposed time AND Terms of Counselling. Must confirm both.

### Implementation

This is partially covered by Phase 4 (the client-respond endpoint and `/forms/confirm-time` page). The additional work here is:

1. **`/forms/confirm-time/page.tsx`** — Combine time display with Terms of Counselling signature flow. Show:
   - Proposed session date/time
   - Counsellor name (first name only for privacy)
   - Terms of Counselling text with acceptance checkboxes
   - Signature capture (reuse existing `TermsOfCounsellingForm` pattern)
   - "Confirm time & agree to terms" button
   - "Request a different time" button with note textarea

2. **Form submission** — On confirm: mark Terms document as COMPLETED, confirm the time proposal, create the session, transition case to SCHEDULED.

3. **Counter-proposal** — On "request different time": update proposal status to CLIENT_COUNTER, save client's note, notify admin.

### Verification
- Client page shows proposed time + terms together
- Both must be completed for submission
- Counter-proposal sends note back to admin without accepting terms

---

## Phase 6: Session confirmation + post-booking pipeline (Step 8)

**What changes:** After client confirms, the system finalises everything automatically.

### Implementation

1. **Auto-create session** — When client confirms time + terms, automatically:
   - Create `Session` record with the confirmed start/end times
   - Transition case to SCHEDULED
   - Mark Terms of Counselling document as COMPLETED
   - Send confirmation emails to both counsellor and client

2. **Confirmation emails** —
   - **To counsellor:** Session confirmed for [date/time], client name, case reference
   - **To client:** Your session is confirmed for [date/time], what to expect

3. **Calendar integration** — If a scheduling provider (Cal.com / Microsoft Bookings) is configured, create the booking through the provider API.

### Files to modify

1. `src/lib/case-service.ts` — `finaliseSessionBooking()` function
2. `src/lib/mailer.ts` — Confirmation email templates
3. `src/lib/scheduling/events.ts` — Hook into provider if configured

### Verification
- After client confirms → Session record exists, case is SCHEDULED
- Both parties receive confirmation emails
- If provider is configured, external booking is created

---

## Phase 7: In-app notification system (supports Steps 3-7)

**What changes:** Basic notification model so counsellors see alerts in their dashboard without relying solely on email.

### Schema changes (Prisma)

```prisma
model Notification {
  id          String      @id @default(cuid())
  userId      String
  user        UserAccount @relation(fields: [userId], references: [id])
  type        String      // CASE_PROPOSAL, TIME_PROPOSAL, SESSION_CONFIRMED, etc.
  title       String
  message     String
  linkTo      String?     // internal path to navigate to
  readAt      DateTime?
  createdAt   DateTime    @default(now())

  @@index([userId, readAt])
}
```

### Implementation

1. **`src/lib/notifications.ts`** — `createNotification()`, `getUnreadCount()`, `markAsRead()`, `listNotifications()`

2. **Notification bell** — Add to `AuthenticatedShell` for SPECIALIST users. Shows unread count badge. Clicking opens a dropdown with recent notifications.

3. **Hook into existing flows** — Call `createNotification()` alongside email sends in:
   - Case proposal (Phase 3)
   - Time proposal (Phase 4)
   - Session confirmation (Phase 6)

### Files to modify

1. `prisma/schema.prisma` — New Notification model
2. `src/lib/notifications.ts` — New service
3. `src/app/api/notifications/route.ts` — GET (list) + PATCH (mark read)
4. `src/components/authenticated-shell.tsx` — Add notification bell
5. All proposal/confirmation functions — Add notification creation calls

### Verification
- Counsellor sees notification bell with unread count
- Clicking a notification navigates to the relevant page
- Notifications marked as read when viewed

---

## Phase 8: Purpose-built review UI (Step 2 enhancement)

**What changes:** Replace the generic transition dropdown with a clinical review decision panel.

### Implementation

1. **New component: `ClinicalReviewPanel`** — Rendered on the case detail page when case is in AWAITING_REVIEW status. Three clear action buttons:
   - **Accept** (green) — Transition to next status
   - **Accept with Flag** (amber) — Opens inline form for flag text + notes, then transitions
   - **Decline** (red) — Opens inline form for decline reason, transitions to CLOSED

2. **Visual design** — Follow the existing card pattern with `rounded-2xl border` styling. Each decision is a bordered card (like the dc-yes/dc-flag/dc-no pattern in the agreed flow document).

### Files to modify

1. `src/components/admin/clinical-review-panel.tsx` — New component
2. `src/app/admin/cases/[id]/page.tsx` — Render ClinicalReviewPanel when status is AWAITING_REVIEW

### Verification
- Case in AWAITING_REVIEW shows the review panel instead of generic dropdown
- Each action works correctly and records appropriate audit trail

---

## Execution Order

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8
  │          │          │          │          │          │          │          │
  │          │          │          │          │          │          │          └─ UI polish
  │          │          │          │          │          │          └─ Notifications
  │          │          │          │          │          └─ Auto-finalise bookings
  │          │          │          │          └─ Client confirms time+terms
  │          │          │          └─ Time proposal workflow
  │          │          └─ Case proposal workflow
  │          └─ ADMIN role + decline path
  └─ Public referral form
```

Each phase includes its own Prisma migration and can be deployed independently. Later phases build on earlier ones.

## Rollback

Each phase is a separate Prisma migration + code change. To roll back:
1. Revert the code commit
2. Roll back the Prisma migration (if schema changed)
3. The previous phase's functionality continues to work

## Risk notes

- **Phase 1** (public form): Adds spam risk. Consider adding rate limiting on the intake API endpoint.
- **Phase 3** (proposals): Changes how assignment works. The existing direct-assignment flow on the manual assignment board should be preserved as a fallback/override for ops.
- **Phase 4** (time proposals): Most complex phase. The loop between admin/counsellor/client has multiple states to manage.
- **Phase 7** (notifications): Client-side polling or similar mechanism needed for real-time updates. Start simple with page-load fetching.
