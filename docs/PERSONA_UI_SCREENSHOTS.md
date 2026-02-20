# Persona UI Screenshots

This document captures key UI stages for each persona using Playwright against seeded local data.

Related docs:

- [Documentation Home](./index.md)
- [Persona Overview](./personas.md)
- [Ops Manager Guide](./ops-manager.md)
- [Counsellor Guide](./counsellor.md)
- [End Client Guide](./end-client.md)

- Generated: 2026-02-19 (local)
- Base URL: `http://127.0.0.1:3001`
- Source manifest: `docs/screenshots/personas/manifest.json`

## Regenerate

1. Seed data:

```bash
npm run db:seed
```

2. Run app:

```bash
npm run dev
```

3. Capture:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 npm run screenshots:personas
```

## End Client Journey

### Secure intake PIN entry

Route: `/intake/access/seed-intake-primary-2001`

![End Client Secure Intake PIN](screenshots/personas/01-client-pin-entry.png)

### Application for counselling (step 1)

Route: `/intake?accessKey=...`

![End Client Intake Application](screenshots/personas/02-client-intake-application-step-1.png)

## Ops Manager Journey

### Case list

Route: `/admin/cases`

![Ops Case List](screenshots/personas/03-ops-case-list.png)

### Assignment dashboard

Route: `/admin/assignments`

![Ops Assignment Dashboard](screenshots/personas/04-ops-assignment-dashboard.png)

### Case modal from assignment dashboard

Route: `/admin/assignments` (case card click)

![Ops Assignment Case Modal](screenshots/personas/05-ops-assignment-case-modal.png)

### Case detail

Route: `/admin/cases/:id`

![Ops Case Detail](screenshots/personas/06-ops-case-detail.png)

## Counsellor Journey

### Upcoming sessions

Route: `/specialist/sessions`

![Counsellor Upcoming Sessions](screenshots/personas/07-counsellor-upcoming-sessions.png)

### My clients

Route: `/specialist/clients`

![Counsellor Clients](screenshots/personas/08-counsellor-clients.png)

### Availability calendar

Route: `/specialist/availability`

![Counsellor Availability Calendar](screenshots/personas/09-counsellor-availability-calendar.png)
