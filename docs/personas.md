# Personas

## Persona Matrix

| Persona | Access Scope | Core Goals | Key Routes |
| --- | --- | --- | --- |
| Ops Manager | All cases, all counsellors, all settings | Intake triage, workflow compliance, assignment, scheduling control, document and PIN management | `/admin/cases`, `/admin/cases/:id`, `/admin/assignments`, `/admin/specialists`, `/admin/workflows`, `/admin/settings` |
| Counsellor | Assigned work only | Prepare and deliver sessions, maintain own availability, review own clients | `/specialist/sessions`, `/specialist/sessions/:id`, `/specialist/clients`, `/specialist/availability` |
| End Client | PIN-gated form access | Submit intake and required forms securely | `/intake/access/:accessKey`, `/intake`, `/forms/access/:accessKey`, `/forms/terms-and-conditions` |

## What Each Persona Does

### Ops Manager

- Issues secure intake links and PINs.
- Reviews intake responses and adds internal intake review notes.
- Assigns workflow templates and tracks blocking/non-blocking workflow steps.
- Assigns, reassigns, or unassigns cases in manual assignment mode.
- Uses case detail to transition status, complete documents, and issue/disable form PINs.
- Maintains counsellor profiles and availability policies.
- Configures operational settings including scheduling engine and assignment mode.

### Counsellor

- Views upcoming sessions in a briefing-oriented dashboard.
- Opens session briefing pages with participant and case context.
- Reviews only clients assigned to them.
- Manages their own availability and out-of-office windows.

### End Client

- Receives secure link and PIN from ops.
- Verifies PIN and completes Application for Counselling (intake).
- Provides profile, presenting concerns, and availability preferences.
- Completes required follow-up forms when sent by ops.

## Permission Notes

- Ops do not have personal “own cases”; they operate across all cases.
- Counsellor pages are role-scoped and do not expose other counsellors’ work.
- Client-facing forms are not publicly open; access is controlled by link + PIN/session.

