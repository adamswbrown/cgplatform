# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added per-counsellor standard working hours (`standardStartHour`, `standardEndHour`) to specialist profiles.
- Added operational settings for default counsellor working hours and availability calendar default/max range.

### Changed
- Changed manual assignment and availability flows to respect counsellor-specific working hours.
- Changed assignment board time-block labels to render configured window ranges instead of hardcoded times.
- Changed seeded counsellor fixtures to include explicit standard working hours for local demos.

### Fixed
- Fixed remaining hardcoded hour assumptions across assignment/availability UI copy and validation checks.

### Docs
- Updated README configuration and workflow notes for counsellor standard working hours.

## [0.2.0] - 2026-02-19

### Added
- Added client drill-down profile page at `/admin/clients/[id]` with full client context:
  related cases, intake snapshot, scheduling gate summary, required document progress,
  availability windows, and PIN/access history.
- Added ops-side intake review notes persistence on cases (`intakeReviewNotes`) with
  `CASE_INTAKE_REVIEW_NOTES_UPDATED` audit entries.
- Added explicit workflow step modeling with `WorkflowStepCode` and
  `requiresAllParticipants` to support deterministic workflow gating.
- Added legacy-cleanup utility script `scripts/purge-legacy-availability-submission.mjs`
  and npm script `db:purge-legacy-availability`.

### Changed
- Changed workflow semantics so availability is represented as a system checkpoint
  (`AVAILABILITY_CAPTURED`) rather than a standalone `AVAILABILITY_SUBMISSION` form step.
- Changed workflow admin UX to provide clearer step modeling and editing:
  step code, participant scope, scheduling-blocking, and flow preview.
- Changed assignment board cards so assigned case cards now show booking preference and
  assigned date/time details directly.
- Changed ops shell navigation so `Workflows` is treated as a settings/cog action instead
  of a day-to-day primary nav item.
- Changed cog/settings menu to remove redundant top-level `Settings` link, keeping only
  direct actionable entries.
- Changed specialist management/profile UX to grey/de-emphasize Cal.com mapping fields
  when scheduling engine is not `calcom`.
- Changed intake detail rendering to human-readable field labels and friendlier values,
  while preserving raw-key traceability.

### Fixed
- Fixed assignment board usability so the `Unassigned` lane remains visible and usable during
  long board interaction by moving it outside the horizontal scroll container.
- Fixed assignment board layout regression where malformed Tailwind grid template syntax caused
  the unassigned panel to span the full page.
- Fixed assigned-case visibility gap by surfacing client time preference on assigned cards
  and flagging assignments outside preferred blocks.
- Fixed legacy availability data inconsistency by purging stale `AVAILABILITY_SUBMISSION`
  workflow records and normalizing to `AVAILABILITY_CAPTURED`.
- Fixed multiple UI/runtime consistency issues across assignment and availability flows
  (including prior availability-window query/schema mismatches).

### Docs
- Added persona screenshot capture tooling and updated docs gallery/manifests.
- Updated workflow and architecture documentation to reflect provider abstraction,
  manual mode behavior, and workflow-gated scheduling.

## [0.1.0] - 2026-02-19

### Added
- Initial MVP with Next.js, TypeScript, PostgreSQL, and Prisma for counselling case management.
- Core domain models for cases, participants, counsellors, sessions, documents, workflows,
  audit logs, and secure access/PIN flows.
- Role-based experiences for ops and counsellors:
  case lifecycle management, assignment controls, specialist briefing/session views.
- Secure intake pipeline with PIN-gated access, multi-step counselling application,
  document workflow triggers, and form submission ingestion endpoints.
- Scheduling provider abstraction with manual provider support and operational
  settings for engine/assignment mode switching.
- Manual assignment dashboard with Kanban + calendar grid interactions and reassignment.
- Specialist availability management including available and out-of-office blocks.
- Provider event ingestion endpoint for external booking lifecycle sync.
- Development simulation endpoints for test case creation and provider event simulation.

[Unreleased]: https://github.com/adamswbrown/cgplatform/compare/0.2.0...HEAD
[0.2.0]: https://github.com/adamswbrown/cgplatform/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/adamswbrown/cgplatform/releases/tag/0.1.0
