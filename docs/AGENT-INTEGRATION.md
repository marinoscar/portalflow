# Agent Integration

Coding agents — OpenClaw, opencode, Claude Code, custom shell harnesses — need a stable, parseable surface to drive portalflow without screen-scraping ANSI output or guessing at exit conditions. This document is that contract. It describes the four levers that make the CLI agent-friendly: `--json` output on `run`, process exit codes, `schema` introspection, and `tools list` introspection. Everything here is stable across **minor** versions of `@portalflow/cli`; see [Versioning promise](#versioning-promise) for the full guarantee.

For OpenClaw-specific setup and the bundled skill, see [OPENCLAW-INTEGRATION.md](./OPENCLAW-INTEGRATION.md).

---

## `--json` flag on `run`

Pass `--json` to suppress the human presenter, redirect pino logs to the configured log file, and emit a single JSON document on stdout when the run completes (or fails pre-flight). Stdout becomes the sole source of truth — no ANSI codes, no progress lines, no spinner text.

```bash
portalflow run ./my-automation.json --json
```

`--json` implies `--no-color`. Both flags together are redundant but harmless.

### Success payload

On a completed run (whether all steps passed or some steps failed), the CLI emits one line on stdout matching the `RunResult` shape described in [RunResult wire shape](#runresult-wire-shape):

```json
{
  "success": true,
  "startedAt": "2026-04-25T17:42:11.082Z",
  "completedAt": "2026-04-25T17:42:18.341Z",
  "stepsCompleted": 3,
  "stepsTotal": 3,
  "outputs": {
    "page_title": "Example Domain",
    "page_dom": "- tag: html\n  children:\n    - tag: head\n  ..."
  },
  "artifacts": [
    "/home/user/.portalflow/artifacts/html/page_dom.yaml"
  ],
  "errors": []
}
```

`success` is `true` when `errors` is empty. A run that completed but had step failures reports `"success": false` with entries in `errors`.

### Pre-flight failure payload

When the run cannot start at all (bad input format, unconfigured Chrome profile, schema invalid), the CLI emits a shorter envelope and exits with the matching exit code:

```json
{ "success": false, "error": "Chrome profile mode is not configured.", "exitCode": 1 }
```

The `exitCode` field mirrors the process exit code so agents that capture stdout before inspecting `$?` have both signals available.

For a complete annotated run from an agent's perspective, see `tools/cli/skills/portalflow/examples/walkthrough.md`.

---

## Exit codes

The exit code is the fastest signal. Parse it before reading the JSON body.

| Code | Name      | Meaning                                       | Recommended agent reaction                                                                                       |
|-----:|-----------|-----------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| 0    | Ok        | Run completed successfully                    | Read `outputs` and `artifacts` from the JSON body.                                                              |
| 1    | Runtime   | Unexpected error, user input error, or generic failure | Read the JSON `error` field. Decide whether to retry based on the message.                            |
| 2    | Schema    | Automation JSON failed schema validation      | Show the user the validation error from stderr (or the `error` field). Do not retry without editing the JSON.   |
| 3    | Auth      | LLM provider auth or pre-flight failure       | Ask the user to check their provider key (`ANTHROPIC_API_KEY` or equivalent). Run `portalflow provider list`.   |
| 4    | Extension | Chrome launch or extension handshake failure  | Tell the user Chrome isn't ready. Suggest closing all Chrome windows and retrying, or running `--kill-chrome`.  |

Collapsing all failures to `1` forces callers to string-sniff error text. These codes let agents react without parsing messages.

---

## NO_COLOR / non-TTY behavior

Color is disabled automatically when running in a non-interactive context. The precedence chain, from highest to lowest:

1. `--no-color` flag — always disables color regardless of environment.
2. `--json` flag — implies `--no-color`; both together are harmless.
3. `NO_COLOR` env var (any non-empty value) — disables color; honored by the `defaultColorEnabled()` helper used throughout the presenter.
4. Non-TTY stdout (`!process.stdout.isTTY`) — disables color when stdout is a pipe or redirect.
5. Default — color on for interactive terminals.

In practice: agents piping stdout or redirecting to a file get clean output automatically. Setting `NO_COLOR=1` in the agent's subprocess environment is the belt-and-suspenders option.

---

## `portalflow schema`

`portalflow schema` emits the full automation file format as a JSON Schema document. Use it to synthesize new automation files without reading the prose spec.

```bash
# Machine-readable (compact, pipe-friendly)
portalflow schema

# Human-readable (2-space indented)
portalflow schema --pretty
```

The schema is derived at runtime from the Zod definitions in `@portalflow/schema`. It is the same schema the CLI uses to validate files before running them, so it is always in sync with what the runner accepts.

Example — extract the required top-level fields:

```bash
portalflow schema | jq '.definitions.Automation.required'
# ["id","name","description","goal","inputs","steps"]
```

Example — inspect the step type enum:

```bash
portalflow schema | jq '.definitions.Step.discriminator'
```

The schema output is a stable wire contract. Agents can cache it for the lifetime of a session (it does not change between invocations on the same CLI version).

For the full human-readable field reference, see [`docs/AUTOMATION-JSON-SPEC.md`](./AUTOMATION-JSON-SPEC.md).

---

## `portalflow tools list`

`portalflow tools list` emits the built-in tool inventory as a `ToolDescription[]` JSON array. This is the same inventory the LLM sees when it decides whether to emit a `tool_call` action inside an `aiscope` step.

```bash
# Machine-readable
portalflow tools list

# Human-readable
portalflow tools list --pretty
```

Example output (abbreviated):

```json
[
  {
    "tool": "smscli",
    "description": "Retrieves SMS OTP codes from a connected phone.",
    "commands": [
      {
        "command": "otp-wait",
        "description": "Waits for a NEW SMS OTP to arrive after this moment.",
        "args": [
          { "name": "timeout", "required": false, "description": "Seconds to wait before giving up (default 60)." }
        ],
        "resultDescription": "The OTP code extracted from the SMS body. Stored as smscli_otp_wait_result."
      }
    ]
  },
  {
    "tool": "vaultcli",
    "description": "Retrieves secrets from the local vault.",
    "commands": [
      {
        "command": "secrets-get",
        "description": "Fetches a secret by name. Returns all fields or a single field.",
        "args": [
          { "name": "name", "required": true, "description": "The name of the secret to retrieve." },
          { "name": "field", "required": false, "description": "If provided, returns only this field." }
        ],
        "resultDescription": "The secret value(s). Stored as vaultcli_secrets_get_result."
      }
    ]
  }
]
```

Each `resultDescription` tells the agent what context variable name holds the tool's output after the LLM emits a `tool_call`. The agent should include this information in its automation-authoring guidance.

Example — list just the tool names:

```bash
portalflow tools list | jq -r '.[].tool'
# smscli
# vaultcli
```

---

## Non-interactive input patterns

Pass runtime inputs to an automation without prompting. Two forms:

```bash
# Repeatable key=value pairs
portalflow run ./my-automation.json --json \
  --input username=alice \
  --input environment=staging

# Single JSON object (convenient for many keys or keys with spaces)
portalflow run ./my-automation.json --json \
  --inputs-json '{"username":"alice","environment":"staging"}'
```

Both forms are merged; if the same key appears in both, `--inputs-json` wins for that key.

**Do not put secrets on the command line.** Command-line arguments appear in process listings and shell history. For secrets, use the `vaultcli` tool adapter: declare the input in the automation JSON with `"source": "vaultcli"` and let the runner fetch the value from the vault at runtime. The LLM never sees the actual secret — only the `inputRef` name.

---

## RunResult wire shape

Every completed run (success or failure) emits a `RunResult` JSON document on stdout when `--json` is active. Fields:

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | `true` when `errors` is empty; `false` when one or more steps recorded an error. |
| `startedAt` | `string` (ISO 8601) | When the run began. The underlying `Date` serializes as an ISO string via `JSON.stringify`. |
| `completedAt` | `string` (ISO 8601) | When the run ended, regardless of outcome. Same serialization as `startedAt`. |
| `stepsCompleted` | `number` | Number of steps that ran to a terminal state (success, failure, or skipped). Does not include steps that were never reached. |
| `stepsTotal` | `number` | Total steps defined in the automation file. |
| `outputs` | `Record<string, unknown>` | Named values collected by `extract` steps with `outputName` set. Keys are the `outputName` values from the automation JSON; values are whatever the step extracted (string, number, object, etc.). |
| `artifacts` | `string[]` | Absolute file paths of files written to disk during the run (screenshots, HTML extracts, downloads). Paths are local to the machine running the CLI. |
| `errors` | `RunError[]` | One entry per step that failed. Empty on a fully successful run. See `RunError` below. |

`RunError` fields:

| Field | Type | Description |
|-------|------|-------------|
| `stepId` | `string` | The `id` field from the failing step in the automation JSON. |
| `stepName` | `string` | The `name` field from the failing step. |
| `message` | `string` | Human-readable error message from the runner or extension. |
| `timestamp` | `string` (ISO 8601) | When the error was recorded. |

Pre-flight failures (bad JSON, schema invalid, unconfigured extension) use a shorter shape and never reach `RunResult`:

```json
{ "success": false, "error": "<message>", "exitCode": <code> }
```

---

## Versioning promise

The `--json` output shape (`RunResult`), the exit codes, and the `schema` / `tools list` output formats are stable across **minor** versions of `@portalflow/cli` (e.g. `3.1.x → 3.2.x`). Agents built against this contract do not need to change when the CLI gains new features.

**Major version bumps** (`3.x → 4.x`) may change any part of this surface. When that happens, the root `CHANGELOG.md` will include a migration note describing the exact changes and any backward-compatibility period.

To check the CLI version at runtime:

```bash
portalflow --version
```

---

## Integrating with a specific agent

### OpenClaw

The portalflow repo ships a bundled OpenClaw skill at `tools/cli/skills/portalflow/`. See [OPENCLAW-INTEGRATION.md](./OPENCLAW-INTEGRATION.md) for installation and the first-run checklist.

### Other agents (shells, opencode, Claude Code, custom harnesses)

The minimal integration is:

1. Run `portalflow run <file> --json --no-color`.
2. Capture stdout as the result document.
3. Check the process exit code; react per the [exit code table](#exit-codes).
4. Parse the JSON body for `outputs`, `artifacts`, and `errors`.

No log-tailing, no ANSI parsing, no follow-up commands needed.

**Agents that pty-mux stdout** (some terminal multiplexers or PTY harnesses merge stdout and stderr into a single stream): pipe through `tee` so you have both a parseable file and the live stream:

```bash
portalflow run ./my-automation.json --json --no-color | tee /tmp/pf-result.json
EXIT_CODE=${PIPESTATUS[0]}
jq '.outputs' /tmp/pf-result.json
```

This pattern ensures the exit code is from portalflow, not from `tee`.
