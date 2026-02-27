# CG Platform Documentation

This documentation is designed for GitHub Pages and focuses on three personas:

- Ops Manager
- Counsellor
- End Client

The product supports counselling case management with workflow-gated scheduling, secure intake, and role-scoped operations.

## Quick Links

- [Persona Overview](./personas.md)
- [Ops Manager Guide](./ops-manager.md)
- [Counsellor Guide](./counsellor.md)
- [End Client Guide](./end-client.md)
- [Functionality Reference](./functionality-reference.md)
- [Resend Setup Guide](./resend-setup.md)
- [Outlook Calendar Sync Setup](./outlook-calendar-sync-setup.md)
- [Persona Screenshots](./PERSONA_UI_SCREENSHOTS.md)
- [E2E Verification Report](./E2E_VERIFICATION_REPORT.md)

## High-Level Process

```mermaid
flowchart TD
  A["Ops sends secure intake link + PIN"] --> B["End client completes Application for Counselling"]
  B --> C["System creates case and workflow state"]
  C --> D["Ops reviews intake and workflow blockers"]
  D --> E{"Scheduling eligible?"}
  E -- "No" --> D
  E -- "Yes" --> F["Ops assigns counsellor (manual mode) or runs auto allocation"]
  F --> G["Session booked via scheduling provider"]
  G --> H["Terms of Counselling sent and completed"]
  H --> I["Case progresses through in-session to completion"]
  I --> J["Audit log retained for all actions and overrides"]
```

## GitHub Pages Setup

1. Open repository settings on GitHub.
2. Go to `Settings` -> `Pages`.
3. Under source, choose `Deploy from a branch`.
4. Select branch `main` and folder `/docs`.
5. Save.

After publish, this page becomes the documentation home.

