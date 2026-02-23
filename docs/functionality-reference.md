# Functionality Reference

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

Status transitions are controlled by workflow/document gates and role actions.

## Workflow Engine

Core records:

- `CaseWorkflowTemplate`
- `CaseWorkflowStep`
- `CaseWorkflowState`

Key behavior:

- Cases are assigned workflow templates by counselling type.
- Steps can be `required` and `blocksScheduling`.
- Scheduling cannot proceed until blocking steps are complete.
- Some steps require both participants for couples cases.

## Intake and Form Ingestion

### Secure intake

- PIN-gated access for non-public intake.
- Multi-step “Application for Counselling”.
- Safeguarding responses can trigger high-risk audit signaling.

### Generic form ingestion API

Route: `POST /forms/submission`

Purpose:

- Match external form submission to a case.
- Complete workflow/document steps from metadata.
- Recalculate scheduling eligibility.

## Scheduling and Assignment

### Scheduling provider abstraction

Supported engine types:

- `manual` (MVP deterministic provider)
- `calcom` (adapter placeholder)
- `microsoft_bookings` (Microsoft Graph Bookings integration)

### Assignment modes

- `manual`: ops assigns cases in assignment board.
- `auto`: system runs automatic allocation logic.

### Manual assignment dashboard

Route: `/admin/assignments`

- Drag from unassigned to counsellor lanes.
- Reassign across counsellors.
- Move back to unassigned.
- Supports Kanban and Calendar Grid view.

## Counsellor Availability

Routes:

- `/specialist/availability`
- `/admin/specialists/:id/availability`

Capabilities:

- Set available blocks.
- Set out-of-office blocks.
- Batch presets for common windows.
- Calendar views for ongoing planning.

## Documents and PINs

Route: `/admin/cases/:id?panel=forms`

- Document instances can be marked complete.
- PINs can be issued for specific participants/forms.
- Active PINs can be revoked.

## Operational Settings

Routes:

- `/admin/settings/operations`
- `/admin/settings/intake`

Settings include:

- Scheduling engine and assignment mode.
- Session defaults and manual simulation policy.
- Workflow gate toggles.
- PIN/secure-link limits and expiries.
- Intake content and guidance copy.

## Email Delivery and Tracking

### Provider

The platform uses [Resend](https://resend.com) for transactional email delivery.

### Emails sent

| Email type | Trigger | Template location |
|------------|---------|-------------------|
| Intake confirmation | Intake form submitted | `src/lib/mailer.ts` — `sendIntakeConfirmationEmail` |
| Form access PIN | Ops issues PIN from case detail | `src/lib/mailer.ts` — `sendFormPinEmail` |
| Intake access invite | Ops issues secure intake link | `src/lib/mailer.ts` — `sendIntakeAccessInviteEmail` |

### Delivery tracking via webhooks

Resend pushes real-time delivery events to `POST /api/webhooks/resend`. The webhook is authenticated using Svix signature verification (not session auth).

Tracked statuses:

| Status | Meaning |
|--------|---------|
| `SENT` | Accepted by Resend API |
| `DELIVERED` | Reached recipient mail server |
| `DELIVERY_DELAYED` | Temporary delivery issue (retrying) |
| `OPENED` | Recipient opened the email (tracking pixel) |
| `CLICKED` | Recipient clicked a link in the email |
| `BOUNCED` | Permanently rejected by recipient server |
| `COMPLAINED` | Recipient marked as spam |
| `FAILED` | Sending encountered an error |

Status updates follow a priority system — statuses only move forward (e.g. `DELIVERED` does not overwrite `OPENED`). Terminal statuses (`BOUNCED`, `COMPLAINED`, `FAILED`) are never overwritten.

### Event timeline

Every webhook event is stored as an `EmailEvent` record linked to the `EmailLog`. This provides a full timeline (sent, delivered, opened, clicked) even though the `EmailLog.status` only shows the latest state.

### Response tracking

Separate from delivery tracking, the system marks emails as "responded" when a client submits the form that an email linked to. This is tracked via the `respondedAt` field on `EmailLog`.

### Database models

- `EmailLog` — one record per email sent, tracks current status and form response
- `EmailEvent` — one record per webhook event, provides full delivery timeline

### Environment variables

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Resend API key for sending emails |
| `CONFIRMATION_EMAIL_FROM` | Sender address (e.g. `noreply@yourdomain.com`) |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret for webhook verification |

See [Resend Setup Guide](./resend-setup.md) for configuration instructions.

## Auditability

All critical operations create audit entries, including:

- Workflow changes
- Manual overrides
- Form/PIN actions
- Provider event state changes
