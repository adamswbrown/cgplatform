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
- `microsoft_bookings` (adapter placeholder)

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

## Auditability

All critical operations create audit entries, including:

- Workflow changes
- Manual overrides
- Form/PIN actions
- Provider event state changes

