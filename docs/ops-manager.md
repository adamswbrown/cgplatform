# Ops Manager Guide

This guide covers daily operations workflows.

## 1) Issue Secure Intake Invite + PIN

Route: `/admin/cases`

1. Open `Issue Secure Intake Link`.
2. Enter recipient email and optional name.
3. Set expiry hours and max attempts.
4. Submit.
5. Share generated access URL/PIN if email delivery fallback is needed.

Outcome:

- End client can access `/intake/access/:accessKey`.
- Intake access is time-limited and attempt-limited.

## 2) Review New Case Intake

Route: `/admin/cases/:id` (defaults to Intake tab)

1. Open a case from case list or assignment modal.
2. Review top “Intake Review” chips and presenting concerns + availability columns.
3. Review profile information and intake responses in form order.
4. Add internal notes in `Intake Review Notes (Ops)` and save.

Outcome:

- Ops gets a fast triage view without raw field keys.
- Notes are stored as internal operational context.

## 3) Workflow Assignment and Gate Checking

Route: `/admin/cases/:id?panel=assignment`

1. Confirm/assign the workflow template.
2. Inspect workflow states and blocking steps.
3. Ensure blocking steps are completed before scheduling.

Outcome:

- Case scheduling is blocked until all required blocking workflow steps are complete.

## 4) Manual Assignment (MVP default)

Route: `/admin/assignments`

1. Move cases from `Unassigned` into counsellor lanes.
2. Reassign by moving across counsellor lanes.
3. Unassign by dragging back to `Unassigned`.
4. Use Kanban or Calendar Grid mode based on preference.

Outcome:

- Session assignment respects configured slot policy and counsellor availability.

## 5) Case Detail Assignment + Override

Route: `/admin/cases/:id?panel=assignment`

1. Review counsellor availability snapshot.
2. Select counsellor and add override reason.
3. Apply override.

Outcome:

- Assignment decision is logged with audit trail.

## 6) Forms, Documents, and PINs

Route: `/admin/cases/:id?panel=forms`

1. Mark document instances complete when appropriate.
2. Issue form PINs for specific participants and form types.
3. Disable active PINs when needed.

Outcome:

- Document completion and secure form access are both controlled in one place.

## 7) Counsellor Management

Routes:

- `/admin/specialists`
- `/admin/specialists/:id`
- `/admin/specialists/:id/availability`

Tasks:

- Create/edit counsellor profile.
- Configure support for couples.
- Set standard working hours.
- Manage availability and out-of-office windows.

## 8) Workflow Administration

Route: `/admin/workflows`

Tasks:

- Create/edit workflow templates.
- Add/edit steps, required flags, blocking flags, and participant requirements.

## 9) Operational Configuration

Routes:

- `/admin/settings`
- `/admin/settings/operations`
- `/admin/settings/intake`

Tasks:

- Choose scheduling engine (`manual`, `calcom`, `microsoft_bookings`).
- Choose assignment mode (`manual` or `auto`).
- Configure simulation windows, slot policy, and workflow/document gates.
- Edit intake text content via structured/WYSIWYG controls.
