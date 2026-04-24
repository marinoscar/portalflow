# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [extension 2.1.0] - 2026-04-24

Tooling release: the extension's Automation Editor gains a one-click "Duplicate step" feature so users can fork an existing step when building similar ones.

### Added

- **Duplicate step action** (`@portalflow/extension` 2.1.0)
  - Every step row in the Outline now has a hover-revealed ⎘ button; the StepForm editor has a "⎘ Duplicate" button in its header; Ctrl/Cmd+D on the currently selected step does the same thing.
  - Click creates a copy of the step — new id, " (copy)" suffix on name, every other field preserved (type, action, selectors, validation, onFailure, maxRetries, timeout, aiGuidance) — inserts it immediately after the original and auto-selects the new step for editing.
  - Loop substeps are recursively duplicated with fresh ids so a copied loop works standalone.
  - Works identically at every scope: top-level steps, substeps inside loops, steps inside function bodies, and substeps inside loops inside function bodies.
- **Why this exists**: authoring several similar steps (e.g., a sequence of form-field interactions) previously meant repeating the same click/type pattern by hand. Duplicating and tweaking is faster and less error-prone, especially for aiscope steps with complex selector/budget configuration.

## [3.0.0] - 2026-04-24

Breaking tooling release: the aiscope `allowedActions` schema field is
renamed to `disallowedActions` with inverted semantics — presence now
means BLOCKED rather than ALLOWED. Omitting the field still means
"everything allowed" (same default behavior).

### Changed (breaking)

- **`@portalflow/schema` 1.2.1 → 2.0.0** — aiscope action control field renamed and inverted. Same optional array of the same enum values; the semantics flip from whitelist to blocklist.
- **`@portalflow/cli` 2.1.0 → 3.0.0** — runner computes the effective allowed list by subtracting `disallowedActions` from the default vocabulary. Internal LLM query plumbing still uses a positive `allowedActions: string[]` (the list shown to the LLM), so provider prompts and the decision-validation path are unchanged.
- **`@portalflow/extension` 1.4.0 → 2.0.0** — editor form's action-vocabulary control flips: each checkbox now means "block this action" rather than "allow this action". The zero-checked default still emits `undefined` (all allowed); 11-checked now emits the full array (all blocked — valid, if unusual, user intent) instead of collapsing to `undefined`.

### Migration

- Automations that had `allowedActions: ['click', 'type', 'done']` (meaning "only these three") should change to `disallowedActions: ['navigate', 'select', 'check', 'uncheck', 'hover', 'focus', 'scroll', 'wait']` (meaning "block everything except those three"), or simply remove the field to accept the full default vocabulary.
- The `docs/AUTOMATION-JSON-SPEC.md` aiscope section documents the new semantics with a worked migration example.

### Why this exists

The whitelist framing was backwards for the common case. In practice, users almost always want the full action vocabulary and occasionally need to block ONE or TWO actions for a specific step (e.g., "don't let the LLM navigate away while I'm working on this form"). The whitelist form forced them to restate all 10 other actions just to exclude one. The blocklist form is additive to the default and expresses the real intent directly.

## [extension 1.4.0] - 2026-04-24

Tooling release: the PortalFlow extension gains a full-page
Automation Editor — a three-pane IDE for opening, editing, and
downloading automation JSON.

### Added

- **Automation Editor page** (`@portalflow/extension` 1.4.0)
  - Opens in its own browser tab via the new "Open Editor" button in the sidepanel header.
  - Three-pane layout: outline tree on the left (metadata, inputs, steps, functions, with drag-to-reorder), form editor in the middle, JSON preview + Issues panel on the right.
  - Form coverage for every one of the 11 step types — `navigate`, `interact`, `wait`, `extract`, `tool_call`, `condition`, `download`, `loop`, `call`, `goto`, `aiscope` — with the schema's discriminated unions enforced through the UI (interaction-type gates which fields appear, aiscope's `successCheck` tri-state maps to deterministic / AI / omit, condition's deterministic-vs-AI mutual exclusion, etc.).
  - Upload `.json` via file picker or drag-and-drop anywhere on the page. Files that fail schema validation surface the errors in a modal with a "Load anyway" escape hatch so the user can fix them in the editor.
  - Download emits a clean, schema-validated `.json` ready to feed to `portalflow run`. The download button disables itself when the document has validation errors.
  - Every Zod validation error is clickable in the Issues panel and jumps the form pane to the offending node.
  - Keyboard shortcuts: Ctrl/Cmd+O to upload, Ctrl/Cmd+S to download. `beforeunload` warns on unsaved changes.
- **Why this exists**: authoring automations by hand against `docs/AUTOMATION-JSON-SPEC.md` was error-prone — 11 step types with discriminated unions and template fields is a lot to keep in one's head. The in-extension editor closes the edit → validate → run loop entirely inside the extension, and the downloaded file runs unchanged through the CLI.

## [2.1.0] - 2026-04-24

CLI and extension both pre-flight LLM connectivity and show a clear friendly message when the API is unreachable. LLM-agnostic — works on Anthropic, OpenAI, and every OpenAI-compatible shim.

### Added

- **`LlmProvider.ping()`** (`@portalflow/cli` 2.1.0, `@portalflow/extension` 1.3.0)
  - New method on both CLI and extension provider interfaces that performs a cheap authenticated `GET /v1/models` against the configured endpoint. Never throws — all failures are captured in a `PingResult` with provider, model, HTTP status, a plain-English message, and a concrete remediation hint.
  - Shared `ping-error.ts` helper maps the common failure cases (401 bad key, 403 model access, 404 wrong base-url, 429 rate limit, 5xx provider outage, network-level errors) to consistent user-facing messages.
- **CLI pre-flight** (`@portalflow/cli` 2.1.0)
  - `automation-runner.ts` now scans every automation for LLM-requiring steps (`aiscope`, `condition.ai`, `loop.items.description`, `loop.exitWhen.ai`) — recursively, including function bodies. If any is found it calls `llmService.verifyConnectivity()` BEFORE launching the browser or opening any windows. On failure the user sees a clean block on stderr and the run aborts with exit code 1 before any partial state exists. Deterministic-only automations skip the check entirely — no network round-trip.
- **Extension banner** (`@portalflow/extension` 1.3.0)
  - `AiAssistant` runs the same connectivity check when a provider is first configured and on every provider change. A dismissible red banner (`LlmConnectivityBanner`) renders with the same structured info as the CLI; the Polish / Improve / Chat Edit buttons are disabled until the banner clears.
- **Why this exists**: users were hitting 401 errors mid-run (expired API keys) or watching aiscope fail with cryptic provider errors on a bad base-url. Surfacing "LLM is unreachable, here's why, here's how to fix it" before work begins is a much cleaner story than discovering it half-way through a login flow.

## [2.0.1] - 2026-04-23

Patch fix: `portalflow --version` no longer lies.

### Fixed

- `portalflow --version` printed a hardcoded `1.0.8` regardless of the installed version — the string was written when cli2 was at 1.0.8 and silently outlived every bump through 1.1.0, 1.2.0, and 2.0.0. Now reads from `tools/cli/package.json` at startup via `fs.readFileSync`, so it can never drift again.
- **Why this exists**: a user running `portalflow --version` on a fresh `install.sh` from main saw `1.0.8` and reasonably assumed the install was broken. The binary was fine — only the version string was stale.

## [2.0.0] - 2026-04-23

Tooling release: the Playwright-based CLI is removed and the extension-transport CLI (formerly `@portalflow/cli2`) is now the one and only CLI under the `@portalflow/cli` name.

### Changed (breaking)

- **Removed `@portalflow/cli` v1** — the original Playwright-based CLI at `tools/cli/` is gone. The last commit where it existed is preserved as the `cli1-version` tag for historical reference.
- **Renamed `@portalflow/cli2` → `@portalflow/cli`** (`tools/cli2/` → `tools/cli/`). Binary renamed from `portalflow2` → `portalflow`. Anyone scripting against `@portalflow/cli2` or the `portalflow2` binary needs to update imports and command invocations.
- **Major version bump to 2.0.0** signals the breaking rename.

### Removed

- All `cli v1` / `cli2 only` / `cli2-only` compatibility qualifiers in docs, prompts, examples, and comments — there's one CLI now, so the distinctions are moot.
- The `tools/cli/README.md` "deprecated Playwright CLI" section.
- **Why this exists**: keeping two CLIs (one Playwright, one extension-transport) sharing aiscope behavior but diverging on self-terminating / agent-mode support was confusing for new users and doubled the maintenance surface. Every post-1.0.x aiscope feature was extension-transport-only anyway.

### Patch

- `@portalflow/schema` 1.2.0 → 1.2.1 — JSDoc updated to drop the v1-vs-v2 distinctions; no behavioral change.
- `@portalflow/extension` 1.2.0 → 1.2.1 — sidepanel dropdown option labels and hint text updated; no behavioral change.
- `@portalflow/cli` 1.2.0 → **2.0.0** (rename + all the above).

## [1.2.0] - 2026-04-23

Tooling release: aiscope gains a true agent mode — planner + milestones + replan — while keeping fast mode as the cheap default. LLM-agnostic by design.

### Added

- **aiscope agent mode** (`@portalflow/schema` 1.2.0, `@portalflow/cli2` 1.2.0, `@portalflow/extension` 1.2.0)
  - New `mode: 'fast' | 'agent'` field on aiscope actions (default `'fast'` — existing behavior, byte-identical). When `'agent'` is set, cli2 opens the step with a planning call that produces a linear list of 2–8 milestones, then drives the browser turn-by-turn with the plan visible in every prompt.
  - New `maxReplans` cap (0–10, default 2). The LLM can emit `replan: true` mid-run when the plan is materially wrong; the runner rebuilds the plan via the planner, passing the old plan as context so the model avoids repeating failed milestones. Replan requests past the cap are ignored so the loop keeps working rather than failing the step.
  - New `milestoneComplete` flag on action responses advances the runner's milestone pointer before dispatching the chosen action.
  - Extension sidepanel exposes a new **Execution mode** dropdown (fast / agent) and a conditional **Max replans** input. Generator prompt gains a rule for picking fast vs agent.
  - **Why this exists**: the original observe-act-repeat loop plateaus on goals with more than one distinct phase (login → navigate → extract → confirm) because the model only sees a 5-action history window — no long-term memory of the overall plan. Agent mode gives the model explicit planning + progress tracking for compound goals, while fast mode stays the right pick for single-phase goals like "dismiss the cookie banner" or "click Next".
  - **LLM-agnostic by design**: every call is plain JSON in / plain JSON out over the existing provider interface. No provider-specific features (no extended thinking, no tool-use API). Works on Claude 3.5+, GPT-4o+, Gemini, Mistral, and local Llama via Ollama — anywhere the model can reliably emit structured JSON.

### Documentation

- `docs/AUTOMATION-JSON-SPEC.md` §6.11 extended with agent mode: new action-shape rows, a dedicated *Agent mode* section with a worked AT&T invoice example, agent-mode flag columns on the action vocabulary, updated cost notes.
- `tools/cli2/README.md` parallel Agent mode section with a when-to-pick-which checklist and the LLM-agnostic guarantee explicitly called out.
- New example: `tools/cli2/examples/aiscope-agent-demo.json` (runs against Wikipedia, no credentials needed).

## [1.1.0] - 2026-04-23

Tooling release: aiscope can now self-terminate when the goal has no concrete success predicate.

### Added

- **aiscope self-terminating mode** (`@portalflow/schema` 1.1.0, `@portalflow/cli2` 1.1.0, `@portalflow/extension` 1.1.0)
  - `successCheck` is now optional on `aiscope` actions. When omitted, cli2's runner hands the completion decision to the LLM: it emits `done` when the goal is reached and the loop ends immediately. Budget caps (`maxDurationSec`, `maxIterations`) remain the only safety net.
  - **Why this exists**: some goals (triage, fill-whatever-is-there, open-ended cleanup) cannot be expressed as a concrete yes/no predicate. Previously these forced users to write an AI predicate that was really just a second copy of the goal, paying two LLM calls per iteration for what was effectively one decision. Self-terminating mode drops the second call and accepts the trade that the LLM is the oracle.
  - Extension sidepanel now offers an **"LLM decides"** option in the success-check editor that emits a `successCheck`-less aiscope step.
  - System prompt tells the model whether its `done` is authoritative (self-terminating) or a hint (with `successCheck`) via a `selfTerminating: true` marker in the user message.
  - **cli v1 is not updated** — it still throws `aiscope step has no successCheck` at runtime. Use an AI predicate (`{ "ai": "..." }`) for automations that need to run on both runners.

### Changed

- **CLAUDE.md**: new MANDATORY section requires version bumps on the relevant `tools/*/package.json` files and a CHANGELOG entry whenever a feature or fix ships. Closes the drift where tooling versions fell behind reality.

### Documentation

- `docs/AUTOMATION-JSON-SPEC.md` §6.11 now documents all three aiscope modes (deterministic, AI, self-terminating), including a worked inbox-triage example and per-mode cost notes.
- `tools/cli2/README.md` gains a self-terminating section with a runnable example.
- New example: `tools/cli2/examples/aiscope-self-terminating.json`.

## [1.0.1] - 2026-01-24

### Added

- **CLI Storage Commands**: New storage commands for interacting with the storage API
  - File upload support with `storage upload` command
  - Interactive storage menu for browsing and managing files
- **CLI Sync Feature**: Full folder synchronization functionality
  - Sync database layer with better-sqlite3 for local state tracking
  - Sync engine for bidirectional folder synchronization
  - Sync commands (`sync push`, `sync pull`, `sync status`)
  - Interactive sync menu for easy sync management
- **API Improvements**: DatabaseSeedException for better seed-related error handling

### Fixed

- **Authentication**: Enhanced OAuth callback error logging for easier debugging
- **Authentication**: Improved error handling for missing database seeds
- **API**: Fixed metadata casting to `Prisma.InputJsonValue` in processing service
- **API**: Fixed metadata casting to `Prisma.InputJsonValue` in objects service
- **API**: Handle unknown error types in S3 storage provider
- **CLI**: Use ESM import for `existsSync` in sync-database module
- **Tests**: Convert ISO strings to timestamps for date comparison

### Changed

- **Database**: Squashed migrations into single initial migration
- **Infrastructure**: Added AWS environment variables to compose file

### Dependencies

- Added AWS SDK dependencies for S3 storage provider
- Added better-sqlite3 and related dependencies for CLI sync feature

### Documentation

- Added storage and folder sync documentation to CLI README

## [1.0.0] - 2026-01-24

### Initial Release

Enterprise Application Foundation - A production-grade full-stack application foundation built with React, NestJS, and PostgreSQL.

### Features

#### Authentication
- Google OAuth 2.0 with JWT access tokens and refresh token rotation
- Short-lived access tokens (15 min default) with secure refresh rotation
- HttpOnly cookie storage for refresh tokens

#### Device Authorization (RFC 8628)
- Device Authorization Flow for CLI tools, mobile apps, and IoT devices
- Secure device code generation and polling
- Device session management and revocation

#### Authorization
- Role-Based Access Control (RBAC) with three roles:
  - **Admin**: Full access, manage users and system settings
  - **Contributor**: Standard capabilities, manage own settings
  - **Viewer**: Least privilege (default), manage own settings
- Flexible permission system for feature expansion

#### Access Control
- Email allowlist restricts application access to pre-authorized users
- Pending/Claimed status tracking for allowlist entries
- Initial admin bootstrap via `INITIAL_ADMIN_EMAIL` environment variable

#### User Management
- Admin interface for managing users and role assignments
- User activation/deactivation controls
- Allowlist management UI at `/admin/users`

#### Settings Framework
- System-wide settings with type-safe Zod schemas
- Per-user settings with validation
- JSONB storage in PostgreSQL

#### API
- RESTful API built with NestJS and Fastify (2-3x better performance than Express)
- Swagger/OpenAPI documentation at `/api/docs`
- Health check endpoints (liveness and readiness probes)
- Input validation on all endpoints

#### Frontend
- React 18 with TypeScript
- Material-UI (MUI) component library
- Theme support with responsive design
- Protected routes with role-based access
- Vite build tool with hot module replacement

#### CLI Tool
- Cross-platform CLI (`app`) for development and API management
- Device authorization flow for secure CLI authentication
- Interactive menu-driven mode and command-line interface
- Support for multiple server environments (local, staging, production)

#### Infrastructure
- Docker Compose configurations:
  - `base.compose.yml`: Core services (api, web, db, nginx)
  - `dev.compose.yml`: Development overrides with hot reload
  - `prod.compose.yml`: Production overrides with resource limits
  - `otel.compose.yml`: Observability stack
- Nginx reverse proxy for same-origin architecture
- PostgreSQL 16 with Prisma ORM
- Automated database migrations and seeding

#### Observability
- OpenTelemetry instrumentation for traces and metrics
- Uptrace integration for visualization (UI at localhost:14318)
- Pino structured logging
- OTEL Collector configuration included

#### Testing
- Backend: Jest + Supertest for unit and integration tests
- Frontend: Vitest + React Testing Library
- CI pipeline with GitHub Actions

### API Endpoints

#### Authentication
- `GET /api/auth/providers` - List enabled OAuth providers
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/google/callback` - OAuth callback
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout and invalidate session
- `GET /api/auth/me` - Get current user

#### Device Authorization
- `POST /api/auth/device/code` - Generate device code
- `POST /api/auth/device/token` - Poll for authorization
- `GET /api/auth/device/sessions` - List device sessions
- `DELETE /api/auth/device/sessions/:id` - Revoke device session

#### Users (Admin only)
- `GET /api/users` - List users (paginated)
- `GET /api/users/:id` - Get user by ID
- `PATCH /api/users/:id` - Update user

#### Allowlist (Admin only)
- `GET /api/allowlist` - List allowlisted emails
- `POST /api/allowlist` - Add email to allowlist
- `DELETE /api/allowlist/:id` - Remove from allowlist

#### Settings
- `GET /api/user-settings` - Get user settings
- `PUT /api/user-settings` - Update user settings
- `GET /api/system-settings` - Get system settings
- `PUT /api/system-settings` - Update system settings (Admin)

#### Health
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe

### Technical Stack
- **Backend**: Node.js + TypeScript, NestJS with Fastify adapter
- **Frontend**: React + TypeScript, Material-UI (MUI)
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Passport strategies (Google OAuth)
- **Testing**: Jest, Supertest, Vitest, React Testing Library
- **Observability**: OpenTelemetry, Uptrace, Pino
- **Infrastructure**: Docker, Docker Compose, Nginx
