# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [cli 3.5.0] - 2026-04-25

Goal-driven mode: a one-line CLI command and a top-menu TUI entry that
let users run an agent without authoring or picking an automation file.
Defaults are configurable at the user-config level (and from the TUI)
so common preferences don't need to be respecified each run.

### Added

- **`portalflow agent "<goal>"`** — new top-level CLI command. Internally
  synthesizes a one-step `aiscope` automation in memory and runs it
  through the existing `AutomationRunner` pipeline, so every flag from
  `portalflow run` (`--json`, `--no-color`, `--inputs-json`, `--html-dir`,
  `--screenshot-dir`, `--download-dir`, `--video`, `--kill-chrome`,
  `--clear-history`, `-l/--log-level`, `-v/--verbose`) works identically.
  Agent-specific flags layered on top:
  - `--start-url <url>` / `--no-start-url` (when set, the runner navigates
    here first; otherwise the LLM picks where to go from the goal text)
  - `--mode fast|agent` (default `agent` for compound goals)
  - `--max-iterations <n>` (1-200), `--max-duration <sec>` (1-3600),
    `--max-replans <n>` (0-10)
  - `--no-screenshot` (skip per-iteration viewport capture)
- **`portalflow settings agent`** — persist defaults to the new `agent`
  section of `~/.portalflow/config.json`. Same flags as the run-time
  command (minus the run-time-only ones); pass nothing to print current
  effective values.
- **TUI: "Run from goal" top-menu entry** — between "Run an automation"
  and "Validate". Same shape as the file-based run flow but sources the
  work from a multi-line goal input instead of a file picker. Resolved
  defaults are shown up front; a single "Customize for this run" toggle
  walks the user through per-run overrides for mode, start URL, max
  iterations, max duration, and screenshot capture.
- **TUI: "Configure agent defaults" entry under Settings** — between
  Logging and Browser. Edit-one-or-all flow over the same six fields,
  with input validation matching the CLI flag bounds.
- **Config: `agent.*` section** in `~/.portalflow/config.json`.
  Optional fields: `mode`, `maxIterations`, `maxDuration`, `maxReplans`,
  `includeScreenshot`, `startUrl`. Precedence at runtime: CLI flag >
  this config > built-in default. Built-in defaults: agent mode, 50
  iterations, 900s wall clock, 2 replans, screenshots on, no start URL —
  tuned 2-3× higher than aiscope sub-step defaults because top-level
  goals need more headroom.
- **`AutomationRunner.runFromAutomation(automation, opts)`** — new public
  method that takes an already-parsed `Automation` instead of a file
  path. The legacy `run(path)` is now a 3-line wrapper. Lets agent mode
  (and any future caller) skip the file round-trip.
- **`synthesizeAgentAutomation({ goal, defaults, inputKeys })`** —
  pure synthesizer that builds a schema-valid `Automation` (optional
  navigate step + aiscope step) from a goal and resolved defaults.
- **OpenClaw skill update** — `tools/cli/skills/portalflow/SKILL.md`
  gains a "Goal-driven mode (preferred for ad-hoc tasks)" section
  pointing agents at `portalflow agent` for one-off goals so they don't
  have to author automation JSON. Walkthrough demonstrates both paths
  side by side.
- **Documentation** — new "Goal-driven mode" section in
  `docs/AGENT-INTEGRATION.md`; OpenClaw on-ramp updated; tools/cli
  README adds `### portalflow agent` and `### portalflow settings agent`
  subsections; root README links to the feature; AUTOMATION-JSON-SPEC
  callout notes the no-JSON path.

### Why this exists

Authoring an automation JSON file is overkill for one-shot tasks ("open
this page and tell me X", "log in and grab a number"). The aiscope step
type already supported handing a goal to the LLM mid-automation; this
release exposes that capability as a top-level command so the user
never has to write JSON for ad-hoc goals. Configurable defaults cover
the ergonomic complaint that follows: tuning a 50-iteration cap or a
mode preference should be a one-time setup, not a per-run flag.

### Out of scope (future work)

- Saving the synthesized automation to disk (deferred — the user
  explicitly asked us to skip this for now).
- Streaming agent decisions over stdout in real time. The final
  `RunResult` summary is enough for the first cut.
- Mid-run human override / pause / "what should I do next?" interaction.

## [cli 3.4.1] - 2026-04-25

Documentation patch closing four reference-surface gaps in the 3.4.0
agent-friendly release. No code behavior change.

### Fixed

- **`tools/cli/README.md` `portalflow run` flag table** now lists
  `--html-dir` (was missed in 3.3.0), `--no-color`, and `--json`
  alongside the existing flags.
- **`tools/cli/README.md` Commands section** gains
  `### portalflow schema` and `### portalflow tools list` subsections
  matching the style of the existing per-command reference. The
  high-level "Agent integration" intro still links to
  `docs/AGENT-INTEGRATION.md` for the full wire contract.
- **`portalflow run --help`** curated example block (in
  `tools/cli/src/help-text.ts`) now demonstrates `--html-dir`,
  `--no-color`, `--json`, and a combined `--json --inputs-json`
  invocation.
- **`portalflow schema --help`** and **`portalflow tools list --help`**
  now use proper `schemaHelpText()` / `toolsListHelpText()` helpers
  matching `runHelpText()` / `validateHelpText()` style instead of the
  3.4.0 inline strings.

### Why this exists

The 3.4.0 release added `--json`, `--no-color`, `schema`, and
`tools list` plus the bundled OpenClaw skill, but the CLI's own
reference docs (the README flag table + per-command subsections + the
curated `--help` examples) weren't updated in lock-step. A user
running `portalflow run --help` saw only the auto-generated flag
listing without curated examples for the new flags, and the README
table was the wrong source of truth. This patch makes the in-repo
reference docs match what shipped.

## [cli 3.4.0] - 2026-04-25

Tooling release: the CLI is now first-class consumable by coding agents
(OpenClaw, opencode, Claude Code, custom). New machine-parseable surface
plus a bundled OpenClaw skill.

### Added

- **`portalflow run --json`** — emits `JSON.stringify(RunResult)` on
  stdout, suppresses the colored presenter, forces the pino logger to
  file-only mode. Pre-flight failures (bad input, missing config) emit
  a `{success:false, error, exitCode}` envelope on stdout instead of a
  human stderr message, so an agent always sees a parseable JSON
  document on stdout regardless of where the run failed.
- **`portalflow run --no-color`** plus auto-detection of `NO_COLOR`
  env var and non-TTY stdout. Passing `--json` implies no color.
- **Stable exit-code wire contract** in `tools/cli/src/exit-codes.ts`:
  `0` Ok, `1` Runtime, `2` Schema validation failed, `3` LLM/provider
  auth failed, `4` Chrome / extension handshake failed. Documented in
  `docs/AGENT-INTEGRATION.md` with recommended agent reactions.
- **`portalflow schema [--pretty]`** — converts `AutomationSchema`
  (Zod) to a JSON Schema document via `zod-to-json-schema`. Lets
  agents discover the automation file format without parsing
  AUTOMATION-JSON-SPEC.md.
- **`portalflow tools list [--pretty]`** — emits the built-in tool
  inventory (`smscli`, `vaultcli`) as `ToolDescription[]`, identical
  to what the LLM sees during aiscope steps.
- **OpenClaw skill** at `tools/cli/skills/portalflow/`:
  - `SKILL.md` — frontmatter (`requires.bins`, `requires.env`,
    `metadata.openclaw.install`) plus the agent workflow.
  - `README.md` — install, precedence chain, troubleshooting.
  - `examples/demo-hello-world.json` — minimal validated automation.
  - `examples/walkthrough.md` — annotated end-to-end transcript.
  Install with: `cp -r tools/cli/skills/portalflow ~/.openclaw/skills/`
- **Documentation**: new `docs/AGENT-INTEGRATION.md` (agent-agnostic
  reference) and `docs/OPENCLAW-INTEGRATION.md` (OpenClaw on-ramp).
  `tools/cli/README.md` and root `README.md` link to both. Small
  introspection callout added to `docs/AUTOMATION-JSON-SPEC.md`.
- New runtime dep: `zod-to-json-schema` (used by `schema` command).

### Why this exists

Coding agents consume CLIs by shelling out and parsing stdout. The
3.3.0 surface was human-friendly: colorized text, no JSON, no schema
export, opaque exit code 1 for every kind of failure. Agents had to
screen-scrape ANSI output and couldn't distinguish auth failures from
extension failures from user input errors. This release fixes all
three: stable JSON, stable exit codes, stable introspection commands —
plus a bundled OpenClaw skill so users get the integration without
hand-authoring it.

### Out of scope (future work)

- MCP server wrapper — separate package, separate decision.
- Streaming NDJSON progress on stdout (in-flight events).
- Shell completions.

## [cli 3.3.0] - 2026-04-24

Tooling release: the `htmlDir` setting shipped in 3.2.0 is now
controllable from the command line, matching the existing
`--screenshot-dir` / `--screenshots` surface.

### Added

- **`@portalflow/cli` 3.2.0 → 3.3.0** — `portalflow run --html-dir <dir>`
  overrides the HTML artifact path for a single run; `portalflow
  settings paths --html <dir>` persists the value to
  `~/.portalflow/config.json`. The same precedence chain already in place
  (CLI > automation settings.htmlDir > user config paths.html >
  built-in default `~/.portalflow/artifacts/html/`) is unchanged.

### Why this exists

3.2.0 honoured `htmlDir` at runtime but only via automation JSON or
config file — there was no per-run CLI override equivalent to the
existing `--screenshot-dir` flag. This closes that gap so ad-hoc runs
can redirect HTML artifacts without editing the automation.

## [cli 3.2.0, schema 2.1.0] - 2026-04-24

Tooling release: `extract` steps with `target: 'html'` can now save the
captured DOM to a file and optionally transform it into a much smaller
representation before writing. Makes full-page DOM snapshots a
first-class artifact — same treatment screenshots already get.

### Added

- **`@portalflow/schema` 2.0.0 → 2.1.0** — `ExtractActionSchema` gains
  two optional fields: `saveToFile: boolean` (persist the extracted
  HTML to disk) and `format: 'raw' | 'simplified' | 'markdown'` (which
  transform to apply before writing / storing). `SettingsSchema` gains
  an optional `htmlDir` — per-automation override for where HTML files
  land, parallel to `screenshotDir`. All three fields are optional and
  existing automations parse unchanged.
- **`@portalflow/cli` 3.1.0 → 3.2.0** — new `transforms/html.ts`
  module wraps cheerio + turndown. `simplified` walks the DOM, drops
  `script` / `style` / `noscript` / `svg`, keeps a narrow allow-list
  of semantically-meaningful attributes (`id`, `role`, `aria-*`,
  `href`, `data-testid`, …), collapses whitespace, and emits a YAML
  tree — roughly a 95% size reduction on typical pages while
  preserving the structure an LLM or diff tool actually uses.
  `markdown` uses turndown. `raw` is a pass-through (you just wanted
  the file). When `saveToFile` is true the step executor writes
  `<htmlDir>/<outputName>.<ext>` (`.html` / `.yaml` / `.md`), registers
  the path as a run artifact, and still populates `outputs` with the
  transformed string so downstream templates keep working. Default
  htmlDir is `~/.portalflow/artifacts/html/` — created lazily on
  first run via the existing bootstrap helper.

### Why this exists

Before this change, the only way to get a page's DOM out of a run was
to stash the full HTML string in a context variable — which is fine
for a single-KB snippet, useless for a 2MB e-commerce page, and in
either case not saved anywhere a human or follow-up tool could look at
after the run. Screenshots already had the save-to-disk + artifact
pipeline; bringing HTML up to parity (and optionally compressing it
for LLM consumption) lets authors build flows that capture "what the
page actually looked like when we got here" without stuffing
megabytes into run logs.

## [cli 3.1.0] - 2026-04-24

Tooling release: aiscope `tool_call` is now plug-and-play — the CLI introspects every registered tool and injects an accurate "Tools available in this run" block into the LLM prompt each iteration. Authors no longer have to describe tools in the aiscope `goal`.

### Added

- **Tool introspection** (`@portalflow/cli` 3.1.0) — new `describe(): ToolDescription` method on the `Tool` interface. `smscli` exposes `otp-wait`, `otp-latest`, and `otp-extract`; `vaultcli` exposes `secrets-get`. Each command advertises its args, a plain-English description, and the exact result variable name the LLM can reference via `inputRef` on the next iteration.
- **Narrow LLM-facing surface** — smscli's advertised args are deliberately minimal: `otp-wait` exposes only `timeout`; `otp-latest` exposes zero args; `otp-extract` exposes only `message`. The adapter runtime still accepts every arg it always did (sender, number, since, device) — those remain available for hand-authored top-level `tool_call` steps — but we don't ask the LLM to reason about filters it rarely needs.
- **Prompt injection** — both anthropic and openai providers insert the inventory block into the aiscope action-decider and agent-planner prompts right before the page HTML. Empty tool list emits no block.
- **Example** — `tools/cli/examples/aiscope-tool-call-demo.json` shows the feature end-to-end: an aiscope goal that deliberately says nothing about tools, the LLM picks `smscli:otp-wait` (or `otp-latest`) on its own based on what it sees.
- **Spec** — `docs/AUTOMATION-JSON-SPEC.md` §6.11 has a new "tool_call inside aiscope" sub-section covering the decision JSON shape, the `inputRef` follow-up pattern, and the full command inventory.

### Fixed

- The aiscope system prompt previously showed `smscli:get-otp` as its tool_call example — a command that doesn't exist (the adapter only accepts `otp-wait | otp-latest | otp-extract`). Any LLM that followed the example hit `Unknown smscli command "get-otp"`. The hardcoded example is removed; the LLM now reads the real inventory instead.

### Why this exists

Authoring aiscope steps that needed OTP retrieval previously meant hand-writing the tool inventory into every `goal` — "if you see an OTP field, emit tool_call with value 'smscli:otp-wait' and args `{timeout:'120'}`..." — and hoping the LLM followed along. With the inventory injected automatically, goals stay focused on the business intent and the LLM gets an accurate, current tool menu for free.

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
