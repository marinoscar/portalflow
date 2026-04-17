# portalflow2 — PortalFlow CLI v2

`portalflow2` is the second-generation PortalFlow CLI that executes browser automations through a WebSocket connection to the PortalFlow Chrome extension, eliminating every Playwright-based browser-launch failure mode catalogued in [`docs/BROWSER-CONTROL-STRATEGY.md §4`](../../docs/BROWSER-CONTROL-STRATEGY.md#4-the-recommended-path-forward-chrome-extension). Unlike the original `tools/cli/` (which drove Chrome via Playwright and is deprecated), `portalflow2` never touches a CDP channel — Chrome is a normal user-facing browser, and the extension is its automation runtime. The same `tools/extension/` package that records workflows also executes them; the two modes coexist without interference.

---

## Table of Contents

- [Requirements](#requirements)
- [First-time setup](#first-time-setup)
- [Running an automation](#running-an-automation)
- [Commands](#commands)
- [Configuration reference](#configuration-reference)
- [Architecture](#architecture)
- [aiscope: credentials and tool integration](#aiscope-credentials-and-tool-integration)
- [WebSocket protocol reference](#websocket-protocol-reference)
- [Troubleshooting](#troubleshooting)
- [Known limitations (v1)](#known-limitations-v1)
- [Development](#development)
- [Relationship to other packages](#relationship-to-other-packages)
- [Reporting issues / contributing](#reporting-issues--contributing)

---

## Requirements

- Node.js 18 or later
- npm 9 or later
- Chrome 114 or later (the extension uses Manifest V3 + the offscreen API, which requires this version)
- Linux, macOS, or Windows
- The PortalFlow repo cloned locally (the extension is loaded unpacked from `tools/extension/dist/`)

---

## First-time setup

### 1. Install workspace dependencies

From the repo root:

```bash
npm install
```

### 2. Build the schema and the extension

```bash
npm -w tools/schema run build
npm -w tools/extension run build
```

This produces `tools/extension/dist/`. You will point Chrome at this directory in the next step.

### 3. Load the extension in Chrome

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the absolute path to `tools/extension/dist/` in your clone

The PortalFlow toolbar icon appears. After any future rebuild of the extension, click the reload icon on the extension card — no need to Load unpacked again.

### 4. Build cli2

```bash
npm -w tools/cli2 run build
```

### 5. (Optional) Link globally

```bash
cd tools/cli2 && npm link
```

After this, `portalflow2 --help` works from any directory. Without it, invoke the CLI as `node tools/cli2/dist/index.js`.

### 6. First run

```bash
portalflow2
```

Running with no arguments launches the interactive TUI. On the first invocation (or whenever `profileMode` is `unset`), the TUI asks which Chrome profile to use:

- **Dedicated profile** (recommended): `portalflow2` spawns Chrome pointed at `~/.portalflow/chrome-profile/`, completely isolated from your day-to-day browsing. No SingletonLock conflicts, no session-restore surprises, fully reproducible. The extension must be loaded into this profile (the profile directory is created on first launch; after Chrome opens in the new profile, load the extension via `chrome://extensions` as described in step 3 above).
- **Real profile**: `portalflow2` spawns Chrome with no `--user-data-dir` flag, so Chrome uses your system default profile. Your real cookies, saved passwords, and installed extensions are all available. Requirement: you must have installed the PortalFlow extension in that profile and Chrome must NOT already be running when `portalflow2` starts.

The choice is persisted to `~/.portalflow/config.json` and can be changed later with `portalflow2 settings extension`.

---

## Quick install (scripted)

Instead of following the manual steps above, you can run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/cli2/install.sh | bash
```

The script is idempotent — run it again to update. It clones the repo to `~/.portalflow-cli2/`, builds `@portalflow/schema`, the extension at `tools/extension/dist/`, and `portalflow2` itself, seeds `~/.portalflow/` default directories, and installs `portalflow2` + `portalflow2-update` to `/usr/local/bin/` (requires `sudo`).

After the script completes you still need to do the one-time "Load unpacked" step in `chrome://extensions` — the installer prints the exact dist path and copies it to your clipboard.

To uninstall:

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/cli2/install.sh | bash -s -- --uninstall
```

---

## Running an automation

### Three invocation modes

**Interactive TUI** (no arguments):

```bash
portalflow2
```

Launches a menu. Choose "Run" to get a file picker for automation JSON files.

**Non-interactive with a file argument**:

```bash
portalflow2 run path/to/automation.json
```

Runs the specified file without any TUI. Exits 0 on success, 1 on failure. Suitable for scripts and CI-like environments.

**TUI file picker** (run subcommand, no file):

```bash
portalflow2 run
```

Opens the TUI file picker scoped to the configured automations directory.

### What happens during a run

1. `portalflow2` reads `~/.portalflow/config.json` and verifies that `profileMode` is set. If it is `unset`, the CLI exits with instructions to configure it first.
2. `portalflow2` starts the WebSocket server on `127.0.0.1:7667` (configurable).
3. `portalflow2` detects the Chrome binary (via `detectChromeBinary`) or uses the `extension.chromeBinary` config override.
4. If `--kill-chrome` was passed (or answered "Yes" in the TUI), all running Chrome/Chromium processes are terminated using `pkill` (Linux/macOS) or `taskkill` (Windows). The CLI waits 1.5 seconds afterward so that file locks on the Chrome profile are fully released before the new instance starts.
5. Chrome is spawned with `--no-first-run --no-default-browser-check` and, for dedicated mode, `--user-data-dir=<profileDir>`. No headless, no CDP, no automation flags.
6. The extension's offscreen document connects to the WebSocket and sends a `hello` event carrying the Chrome version, extension version, and protocol version.
7. `portalflow2` validates the protocol version and replies with a `session` envelope carrying a UUID `runId`.
8. If `--clear-history <range>` was passed with a value other than `none` (or a range was selected in the TUI), the CLI sends a `clearHistory` command to the extension, which calls `chrome.browsingData.remove()` to clear browsing history and cache for the requested time range. Cookies and saved passwords are not touched, so existing logged-in sessions survive.
9. `portalflow2` sends an `openWindow` command; the extension opens a new dedicated browser window.
10. Automation steps execute one at a time over the WebSocket, each as a typed command. The extension performs the DOM action in the run window and replies with a `result` or `error` envelope.
11. On completion, `portalflow2` either closes the run window (if `extension.closeWindowOnFinish: true`) or leaves it open for inspection.

---

## Commands

### `portalflow2`

Launches the interactive TUI. Covers all subcommands below in menu form. On first use, prompts for the Chrome profile mode.

### `portalflow2 run [file]`

Executes an automation from a JSON file. Omit `file` to use the interactive file picker.

```bash
portalflow2 run ~/automations/my-flow.json
portalflow2 run ~/automations/login.json --input username=alice --input password=s3cr3t
portalflow2 run ~/automations/export.json --download-dir ~/Downloads/reports
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--video` | boolean | — | Enable video recording for this run |
| `--no-video` | boolean | — | Disable video recording even if enabled in config |
| `--video-dir <dir>` | string | — | Directory to store recorded videos |
| `--screenshot-dir <dir>` | string | — | Directory to store screenshots |
| `--download-dir <dir>` | string | — | Directory to store downloaded files |
| `--automations-dir <dir>` | string | — | Directory to search for automation files |
| `--input <key=value>` | string | — | Pass an input value (repeatable) |
| `--inputs-json <json>` | string | — | Pass multiple inputs as a JSON object |
| `-l, --log-level <level>` | string | — | Log verbosity: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` |
| `--stealth` | boolean | `false` | Apply anti-detection patches (opt-in) |
| `-v, --verbose` | boolean | — | Print the full pino log stream to stdout |
| `--kill-chrome` | boolean | `false` | Close all existing Chrome/Chromium processes before launching Chrome. Ensures a clean start with no stale singleton locks or leftover sessions. Uses `pkill` on Linux/macOS, `taskkill` on Windows, followed by a 1.5 s pause to let processes release file locks. |
| `--clear-history <range>` | string | `none` | Clear browsing history and cache (not cookies or passwords) after the extension connects but before steps execute. Preserves logged-in sessions. Accepted values: `none`, `last15min`, `last1hour`, `last24hour`, `last7days`, `all`. |

> **Note:** `--kill-chrome` and `--clear-history` are per-run runtime options. They are not persisted in `~/.portalflow/config.json`. Pass them on the command line each time, or answer the corresponding TUI prompts before each run.

### `portalflow2 validate [file]`

Validates an automation JSON file against `AutomationSchema`. Omit `file` to use the interactive file picker.

```bash
portalflow2 validate ~/automations/my-flow.json
# OK — My Flow (12 steps)
```

Exits 0 on valid, 1 on invalid, with structured validation errors to stderr.

### `portalflow2 provider list`

Lists all configured LLM providers and marks the active one.

```bash
portalflow2 provider list
#   anthropic [active]   kind: anthropic   model: claude-opus-4-5
#   openai               kind: openai-compatible   model: gpt-4o
```

### `portalflow2 provider set <name>`

Sets the active LLM provider.

```bash
portalflow2 provider set anthropic
```

### `portalflow2 provider config <name>`

Adds or edits a provider's credentials.

```bash
portalflow2 provider config anthropic --api-key sk-ant-... --model claude-opus-4-5
portalflow2 provider config local --kind openai-compatible --base-url http://localhost:11434/v1 --model llama3
```

| Flag | Description |
|------|-------------|
| `--api-key <key>` | API key for the provider |
| `--model <model>` | Default model to use |
| `--base-url <url>` | Base URL (for openai-compatible endpoints) |
| `--kind <kind>` | Provider kind: `anthropic` or `openai-compatible` |

### `portalflow2 provider reset`

Deletes all provider configuration. Destructive — requires `--yes` for non-interactive use.

```bash
portalflow2 provider reset --yes
```

### `portalflow2 settings list`

Prints the current configuration: paths, video, logging, and extension settings.

```bash
portalflow2 settings list
```

### `portalflow2 settings paths`

Sets storage directory paths. Any subset of flags is accepted; omit all flags to print current values.

```bash
portalflow2 settings paths --automations ~/automations --downloads ~/Downloads/portalflow
```

| Flag | Description |
|------|-------------|
| `--automations <dir>` | Directory for automation JSON files |
| `--screenshots <dir>` | Directory for screenshots |
| `--videos <dir>` | Directory for recorded videos |
| `--downloads <dir>` | Directory for downloaded files |

### `portalflow2 settings logging`

Configures log level, output file, formatting, and secret redaction.

```bash
portalflow2 settings logging --level debug --file ~/logs/portalflow.log
portalflow2 settings logging --no-pretty --no-redact
```

| Flag | Description |
|------|-------------|
| `-l, --level <level>` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` |
| `--file <path>` | Write logs to this file in addition to stdout |
| `--no-file` | Disable file logging |
| `--pretty` / `--no-pretty` | Pretty-print stdout (default: on) |
| `--redact` / `--no-redact` | Redact secret inputs in log output (default: on) |

### `portalflow2 settings extension`

Opens the interactive TUI for configuring the Chrome extension transport: profile mode, host, port, Chrome binary override, and close-on-finish behavior.

```bash
portalflow2 settings extension
```

All `ExtensionConfig` fields are editable here. See the [Configuration reference](#configuration-reference) for the full field list.

### `portalflow2 settings video`

Enables or disables video recording and sets resolution.

```bash
portalflow2 settings video --enable --width 1920 --height 1080
portalflow2 settings video --disable
```

| Flag | Description |
|------|-------------|
| `--enable` | Enable video recording by default |
| `--disable` | Disable video recording by default |
| `--width <n>` | Video width in pixels |
| `--height <n>` | Video height in pixels |

---

## Configuration reference

All configuration lives in `~/.portalflow/config.json`. The file is created automatically on first write.

### `extension` section

This is the primary new section introduced by cli2.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | `string` | `127.0.0.1` | Bind address for the WebSocket server |
| `port` | `number` | `7667` | WebSocket port (1024–65535) |
| `chromeBinary` | `string \| undefined` | auto-detect | Override Chrome binary path. When unset, cli2 probes platform-specific locations (see Troubleshooting). |
| `profileMode` | `'dedicated' \| 'real' \| 'unset'` | `unset` | `unset` triggers the first-run prompt. `dedicated` uses an isolated profile at `profileDir`. `real` uses a Chrome profile — either the specific one recorded in `realProfile`, or Chrome's default if `realProfile` is undefined. |
| `profileDir` | `string \| undefined` | `~/.portalflow/chrome-profile/` | Profile directory when `profileMode` is `dedicated` |
| `realProfile` | `object \| undefined` | `undefined` | Which Chrome sub-profile to launch into when `profileMode` is `real`. Selected interactively via the first-run prompt or `portalflow2 settings extension`; if undefined, Chrome picks its default profile. Object shape: `{ userDataDir, profileName, displayName, browser }`. |
| `closeWindowOnFinish` | `boolean` | `false` | Close the run window when the automation completes |

### `paths` section

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `automations` | `string` | `~/automations` | Default directory for automation files |
| `screenshots` | `string` | `~/.portalflow/screenshots` | Screenshot output directory |
| `videos` | `string` | `~/.portalflow/videos` | Video recording output directory |
| `downloads` | `string` | `~/.portalflow/downloads` | Download output directory |

### `video` section

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable video recording by default |
| `width` | `number` | `1280` | Video width in pixels |
| `height` | `number` | `720` | Video height in pixels |

### `logging` section

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | `'trace' \| 'debug' \| 'info' \| 'warn' \| 'error' \| 'fatal' \| 'silent'` | `info` | Minimum log level |
| `file` | `string \| undefined` | (none) | Log file path (in addition to stdout) |
| `pretty` | `boolean` | `true` | Pretty-print stdout logs |
| `redactSecrets` | `boolean` | `true` | Redact secret-typed input values in log output |

### `providers` and `activeProvider`

LLM provider credentials and the active provider name. Managed via `portalflow2 provider` subcommands.

---

## Architecture

```
┌─────────────────────┐    ws://127.0.0.1:7667   ┌──────────────────────┐
│  portalflow2 CLI    │ ◀──────────────────────▶ │  User's Chrome       │
│  (tools/cli2)       │     command/response     │  + PortalFlow ext    │
│                     │     + event + log        │  (tools/extension)   │
│  AutomationRunner   │                          │  ┌────────────────┐  │
│  StepExecutor       │                          │  │ service worker │  │
│  PageClient ────────┼──────── WS ──────────────┼─▶│ + offscreen doc│  │
│  ExtensionHost (WS) │                          │  │ + runner-cs    │  │
│                     │                          │  └────────────────┘  │
└─────────────────────┘                          └──────────────────────┘
        │                                                 │
        └─── spawns Chrome ──────────────────────────────▶
              (plain binary + dedicated profile)
```

**portalflow2 CLI** owns automation state, step dispatch, LLM calls, condition evaluation, loops, gotos, and aiscope orchestration. It also runs the WebSocket server that the extension connects to.

**ExtensionHost** (WS server) manages the connection lifecycle: handshake, session assignment, reconnect window, and the four-state machine (`idle → connected → reconnect_pending → aborted`).

**PageClient** is the CLI-side adapter that translates `PageService`-style method calls (navigate, click, type, extract, etc.) into WebSocket commands and awaits typed responses.

**Chrome + PortalFlow extension** owns DOM access, tab and window lifecycle, navigation tracking, network-idle detection, downloads, and screenshots. It is stateless per command — each command is a complete, self-describing request that the extension executes and responds to.

**Transport split:** the CLI dispatches commands; the extension executes them in the browser. Parallelism in `aiscope` is preserved because the two parallel LLM calls run entirely in the CLI — the WebSocket is not in their critical path.

**Offscreen document:** the WebSocket client in the extension runs in a dedicated offscreen document (`chrome.offscreen.createDocument`), not the service worker. MV3 service workers are evicted after 30 seconds of idle; a held-open WebSocket from the service worker does not count as activity. The offscreen document avoids this eviction.

For the full architectural rationale behind this design, see [`docs/BROWSER-CONTROL-STRATEGY.md §4`](../../docs/BROWSER-CONTROL-STRATEGY.md#4-the-recommended-path-forward-chrome-extension).

---

## aiscope: credentials and tool integration

`aiscope` steps drive the browser using an observe-act loop: the LLM sees a screenshot (or page snapshot), emits a single action, the executor carries it out, and the cycle repeats until the `successCheck` condition is met or the step budget is exhausted. Two mechanisms let the LLM interact with secrets and external tools without the raw values ever appearing in the LLM prompt: `inputRef` for reading automation inputs, and `tool_call` for invoking external tools (such as `vaultcli` or `smscli`) and capturing their output.

### Using credentials and tools in aiscope

`aiscope` can reference automation inputs — passwords, usernames, OTPs — without the LLM ever seeing the actual secret values. When the LLM needs to type a secret, it emits an `inputRef` field pointing to an input name instead of a `value` field containing the text. The step executor resolves the real value from the in-memory context at dispatch time and sends it directly to the browser; the value never travels through the LLM. Similarly, when the LLM needs data from an external tool (for example, an OTP from `smscli`), it emits a `tool_call` action. The executor runs the tool, stores the result in context under a predictable key, and the LLM can reference that key via `inputRef` on the very next iteration.

### Worked example: AT&T login with OTP

The automation JSON below defines a single `aiscope` step that handles the full AT&T login flow, including an OTP challenge, using credentials from `vaultcli` and a one-time code from `smscli`.

```json
{
  "name": "AT&T login with OTP",
  "version": "1.0.0",
  "inputs": [
    {
      "name": "credentials",
      "type": "secret",
      "source": "vaultcli",
      "value": "att",
      "description": "AT&T login credentials (username + password from vault)"
    }
  ],
  "tools": ["vaultcli", "smscli"],
  "steps": [
    {
      "id": "login",
      "name": "Sign in to AT&T",
      "type": "aiscope",
      "action": {
        "goal": "Navigate to https://www.att.com/my/#/login, enter the username and password, handle any OTP/2FA verification, and reach the account dashboard.",
        "successCheck": {
          "ai": "The page shows the AT&T account overview or dashboard with account details visible"
        },
        "maxDurationSec": 300,
        "maxIterations": 50,
        "includeScreenshot": true
      },
      "onFailure": "abort",
      "maxRetries": 1,
      "timeout": 600000
    }
  ]
}
```

### What happens at runtime

The following sequence describes the LLM's internal decisions during the observe-act loop. These are NOT part of the JSON above — they are what the LLM emits on each iteration, processed by the step executor.

1. LLM sees the goal and the available inputs: `credentials (secret)`, `credentials_username (string)`, `credentials_password (string)`.
2. LLM emits `{"action": "navigate", "value": "https://www.att.com/my/#/login"}` — the executor navigates to the login page.
3. Page loads the login form. LLM sees a username field in the screenshot.
4. LLM emits `{"action": "type", "selector": "#username", "inputRef": "credentials_username"}` — the executor resolves the actual username from context and types it. The LLM never sees the value.
5. LLM emits `{"action": "click", "selector": "#next-button"}` — advances to the password screen.
6. LLM emits `{"action": "type", "selector": "#password", "inputRef": "credentials_password"}` — same pattern for the password; the executor resolves and types the real value.
7. LLM emits `{"action": "click", "selector": "#sign-in"}` — submits the form.
8. Page shows an OTP verification screen. LLM recognizes it needs an OTP.
9. LLM emits `{"action": "tool_call", "value": "smscli:get-otp"}` — the executor runs `smscli`, captures the OTP, and stores it as `smscli_get_otp_result` in context.
10. LLM emits `{"action": "type", "selector": "#otp-input", "inputRef": "smscli_get_otp_result"}` — types the OTP code via `inputRef`; the actual digits are never in the prompt.
11. LLM emits `{"action": "click", "selector": "#verify-button"}` — submits the OTP.
12. Success check passes — the dashboard is visible. The step completes.

### Security note

Secret values are never included in the LLM prompt. The LLM sees only the input names and their declared types (for example, `credentials_password (secret)`). When the LLM emits `"inputRef": "credentials_password"`, the step executor resolves the actual value from the in-memory context at dispatch time — after the LLM has already responded. The history buffer shown to the LLM on subsequent iterations displays `[inputRef:credentials_password]` in place of the actual password, so secrets are never surfaced in the conversation history that feeds back into the model.

### Naming conventions

Vault-sourced inputs are exploded into per-field variables at load time. If the input is named `credentials` and the vault entry returns `{ username, password }`, the available `inputRef` names are `credentials` (the raw secret string, if applicable), `credentials_username`, and `credentials_password`. Tool call results are stored as `<tool>_<command>_result` — for example, a `smscli:get-otp` call produces `smscli_get_otp_result`. Use these exact names in `inputRef` fields.

---

## WebSocket protocol reference

Defined in `tools/cli2/src/browser/protocol.ts` (CLI side) and mirrored in `tools/extension/src/shared/runner-protocol.ts` (extension side).

**Current version:** `RUNNER_PROTOCOL_VERSION = '2'`

The version is checked on every connection. A mismatch closes the connection immediately. The version is bumped on any breaking change to the message shapes.

### Session handshake

On connection, the extension sends `hello` first. The CLI replies with `session`.

**`hello` (extension → CLI)**

```json
{
  "kind": "event",
  "type": "hello",
  "chromeVersion": "134.0.6998.165",
  "extensionVersion": "0.1.0",
  "protocolVersion": "2",
  "existingWindowId": 42,
  "previousRunId": "d3f1a0b2-..."
}
```

`existingWindowId` is present when the extension already has a run window open. `previousRunId` is present when the extension is reconnecting after a disconnect — the CLI uses this to resume the run.

**`session` (CLI → extension)**

```json
{
  "kind": "session",
  "runId": "d3f1a0b2-...",
  "protocolVersion": "2",
  "resumeFromStep": 4
}
```

`resumeFromStep` is omitted on a fresh connection. On reconnect it is set to the step index where the run should continue.

### Commands (CLI → extension)

Each command includes a `commandId` (UUID) and `timeoutMs`. The extension correlates responses by `commandId`.

**`NavigateCommand`** — navigate the tab to `url`

```json
{
  "type": "navigate",
  "commandId": "...",
  "timeoutMs": 30000,
  "tab": { "kind": "active" },
  "url": "https://example.com"
}
```

`tab` is either `{ "kind": "active" }` (the run window's active tab) or `{ "kind": "id", "tabId": 123 }`.

**`InteractCommand`** — perform a DOM interaction

```json
{
  "type": "interact",
  "commandId": "...",
  "timeoutMs": 15000,
  "tab": { "kind": "active" },
  "action": "click",
  "selectors": { "primary": "#submit-btn", "fallbacks": ["button[type=submit]"] },
  "value": "text to type (required for type and select actions)"
}
```

`action` is one of: `click`, `type`, `select`, `check`, `uncheck`, `hover`, `focus`.

**`WaitCommand`** — wait for a condition

```json
{
  "type": "wait",
  "commandId": "...",
  "timeoutMs": 30000,
  "tab": { "kind": "active" },
  "condition": "selector",
  "selectors": { "primary": ".spinner" },
  "urlPattern": "https://example.com/dashboard",
  "durationMs": 2000
}
```

`condition` is one of: `selector`, `navigation`, `delay`, `network_idle`. `selectors` is required for `selector`. `urlPattern` is optional for `navigation`. `durationMs` is required for `delay`.

**`ExtractCommand`** — read a value from the page

```json
{
  "type": "extract",
  "commandId": "...",
  "timeoutMs": 10000,
  "tab": { "kind": "active" },
  "target": "text",
  "selectors": { "primary": ".account-balance" },
  "attribute": "data-value"
}
```

`target` is one of: `text`, `attribute`, `html`, `url`, `title`, `screenshot`. `selectors` is used for element-scoped targets. `attribute` is required when `target` is `attribute`.

**`DownloadCommand`** — trigger and capture a file download

```json
{
  "type": "download",
  "commandId": "...",
  "timeoutMs": 60000,
  "tab": { "kind": "active" },
  "trigger": "click",
  "selectors": { "primary": "a.download-link" },
  "saveDir": "/home/user/downloads"
}
```

`trigger` is `click` or `navigation`. `selectors` is required for `click`; `url` is required for `navigation`.

**`ScreenshotCommand`** — capture the visible viewport

```json
{
  "type": "screenshot",
  "commandId": "...",
  "timeoutMs": 10000,
  "tab": { "kind": "active" },
  "saveDir": "/home/user/.portalflow/screenshots"
}
```

**`CountMatchingCommand`** / **`AnyMatchCommand`** — count or test selector matches

```json
{ "type": "countMatching", "commandId": "...", "timeoutMs": 5000, "tab": { "kind": "active" }, "selectors": { "primary": ".item-row" } }
{ "type": "anyMatch",      "commandId": "...", "timeoutMs": 5000, "tab": { "kind": "active" }, "selectors": { "primary": ".error-banner" } }
```

**`ScrollCommand`** — scroll the page

```json
{
  "type": "scroll",
  "commandId": "...",
  "timeoutMs": 5000,
  "tab": { "kind": "active" },
  "direction": "down",
  "amountPx": 500
}
```

`direction` is one of: `up`, `down`, `top`, `bottom`. `amountPx` is optional.

**`OpenWindowCommand`** / **`CloseWindowCommand`** — manage the run window

```json
{ "type": "openWindow",  "commandId": "...", "timeoutMs": 30000 }
{ "type": "closeWindow", "commandId": "...", "timeoutMs": 10000, "windowId": 42 }
```

### Responses (extension → CLI)

**Success**

```json
{
  "kind": "result",
  "commandId": "...",
  "ok": true,
  "value": "extracted text or structured return value"
}
```

**Error**

```json
{
  "kind": "result",
  "commandId": "...",
  "ok": false,
  "message": "selector not found: .account-balance",
  "recoverable": false,
  "code": "selector_not_found"
}
```

`recoverable: true` means the CLI may safely retry the command. `code` is a machine-readable discriminant: `selector_not_found`, `timeout`, `tab_not_found`, etc.

### Unsolicited events (extension → CLI)

```json
{ "kind": "event", "type": "navigationComplete", "tabId": 123, "url": "https://..." }
{ "kind": "event", "type": "downloadComplete", "downloadId": 7, "filename": "statement.pdf", "bytesReceived": 204800 }
{ "kind": "event", "type": "tabClosed", "tabId": 123 }
{ "kind": "event", "type": "windowClosed", "windowId": 42 }
{ "kind": "event", "type": "log", "level": "warn", "message": "selector retry 2/3", "context": { "selector": ".btn" } }
```

`tabClosed` and `windowClosed` trigger run abort in the CLI — if the user closes the run window, the run cannot continue.

### Reconnect flow

`CheckpointStore` records `{ runId, lastCompletedStepIndex, contextSnapshot }` after every successfully completed step.

When the WebSocket drops between steps:

1. `ExtensionHost` enters `reconnect_pending` state and starts a 30-second timer.
2. If the extension reconnects within 30 seconds and sends a `hello` with `previousRunId` matching the active `runId`, the CLI accepts the reconnect.
3. The CLI sends a `session` envelope with `resumeFromStep: lastCompletedStepIndex + 1`.
4. The run resumes from the next step with the context state restored.

When the WebSocket drops while a command is in flight (mid-step):

- `ExtensionHost` rejects all pending commands with `Extension disconnected mid-step — run aborted`.
- The run is aborted immediately. There is no mid-step resume.

When the 30-second reconnect window expires:

- `ExtensionHost` emits `reconnectTimeout` and transitions to `aborted`.
- The run is aborted with `Extension did not reconnect within 30s — run aborted at step X`.

---

## Troubleshooting

### Extension did not connect within 30 seconds

The exact error message from `chrome-launcher.ts`:

```
Extension did not connect within 30 seconds.

Checklist:
  1. Is Chrome running? (it should be — portalflow2 just launched it)
  2. Is the PortalFlow extension loaded?
     → Open chrome://extensions
     → Enable Developer mode (top-right toggle)
     → Click "Load unpacked"
     → Select: <path to tools/extension/dist/>
  3. Is the extension version correct?
     → The extension must be built with `npm -w tools/extension run build` after any update.
  4. Is another process holding port 7667?
     → Kill the other process or set extension.port in ~/.portalflow/config.json to a free port.
```

Common causes: the extension was never loaded, the extension was loaded from an old `dist/` that has not been rebuilt, or another process is already listening on port 7667.

### Chrome not found

```
Could not find Chrome. Install Chrome or set extension.chromeBinary in ~/.portalflow/config.json
```

The binary search order on each platform:

- **Linux**: `google-chrome-stable`, `google-chrome`, `chromium`, `chromium-browser` (via `which`)
- **macOS**: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `/Applications/Chromium.app/Contents/MacOS/Chromium`
- **Windows**: `%ProgramFiles%\Google\Chrome\Application\chrome.exe`, `%ProgramFiles(x86)%\...`, `%LocalAppData%\...`

To set a custom path:

```bash
portalflow2 settings extension
# select "Chrome binary" and enter the path
```

Or edit `~/.portalflow/config.json` directly:

```json
{
  "extension": {
    "chromeBinary": "/usr/bin/google-chrome-stable"
  }
}
```

### Run window closed by user

If the user closes the dedicated run window, the extension sends a `windowClosed` event and the runner aborts. This is expected behavior — the run cannot continue without the window. Re-run the automation.

### Extension disconnected mid-step — run aborted

The offscreen document dropped while a command was in flight. Rare; suggests the offscreen doc was evicted under memory pressure or Chrome OOM'd. Re-run the automation from scratch.

### Extension did not reconnect within 30s — run aborted at step X

The offscreen doc dropped between steps and did not reconnect within the 30-second window. The most common cause is that Chrome was closed or the extension was disabled. Re-run the automation.

### Extension not loaded in the selected profile

Chrome extensions are per-profile: an extension loaded in "Default" is invisible to "Profile 1" and vice versa. When `profileMode` is `real` and you have selected a specific profile via `portalflow2 settings extension`, portalflow2 launches Chrome with `--user-data-dir=<path>` and `--profile-directory=<name>`, which opens Chrome in exactly that profile. If the PortalFlow extension was only installed in a different profile, Chrome will open correctly but the extension will not be present, and the 30-second handshake will time out. Fix: switch to the chosen profile in Chrome's profile picker (the round avatar icon in the top-right corner), then go to `chrome://extensions`, enable Developer mode, click Load unpacked, and select `tools/extension/dist/`. After that re-run `portalflow2`.

### Yellow "Developer mode extensions" balloon

Chrome always shows this notification bar when unpacked extensions are loaded. It is non-blocking and non-critical. Click the X to dismiss it for the session.

### Kill chrome killed my other work

`--kill-chrome` sends a terminate signal to every Chrome and Chromium process on the machine — not just the automation window. Any unsaved work in other Chrome tabs (open forms, in-progress uploads, unsubmitted drafts) is lost. Use this flag only when you want a completely fresh start with no stale singleton locks. The TUI prompt for this option defaults to "No" as a safety measure. If you only need to resolve a SingletonLock conflict, consider closing Chrome manually before running instead.

### Port 7667 already in use

Set `extension.port` to a free port:

```bash
portalflow2 settings extension
# select "WebSocket port" and enter a new value (1024–65535)
```

Or edit `~/.portalflow/config.json`:

```json
{
  "extension": {
    "port": 7668
  }
}
```

### Protocol version mismatch

If the extension was built from an older commit, its `protocolVersion` in the `hello` message will not match the CLI's `RUNNER_PROTOCOL_VERSION`. The connection is closed immediately with a `1002` code.

Fix: rebuild the extension and reload it in Chrome.

```bash
npm -w tools/extension run build
# then click the reload icon in chrome://extensions
```

### Recording still works?

Yes. The extension is bi-modal. The recorder side panel and the runtime command handler use separate message-type prefixes (`RUNNER_*` vs `RECORDED_*`), separate storage keys (`portalflow:runner-state` vs `portalflow:session`), and separate event listeners. They coexist without interference.

---

## Known limitations (v1)

These are explicit non-goals for the current release. Each has a brief note on why it is deferred.

- **File uploads (`<input type="file">`)**: the extension cannot set file inputs directly without a native messaging host or browser-level API. Deferred to a future release; no timeline yet.
- **Cross-origin iframes**: content scripts must be injected into each frame separately, and some cross-origin frames (e.g. Stripe checkout, Google Sign-In) require additional permission grants. Deferred pending user demand.
- **Drag-and-drop**: simulating drag events reliably in MV3 content scripts is non-trivial. Deferred; most automations do not require it.
- **Full-page screenshots**: `chrome.tabs.captureVisibleTab` captures only the visible viewport. Full-page capture requires multiple captures and stitching. The `extract: screenshot` step produces viewport-only screenshots for now.
- **Headless operation**: the extension requires a visible Chrome window — MV3 extensions cannot run in `--headless=new` without additional infrastructure. Headless CI support is a future roadmap item.
- **Signed CRX distribution**: the extension is loaded unpacked (developer mode). Distributing as a signed CRX via the Chrome Web Store or a private channel requires additional infra. No timeline.
- **Concurrent runs**: `ExtensionHost` enforces a single active run per extension instance. A second `portalflow2 run` while one is active will be rejected. Queuing concurrent runs is a future roadmap item.
- **Mid-step reconnect recovery**: if the extension disconnects while a command is in flight, the run is aborted. Only step-boundary reconnect is supported. Mid-step recovery would require idempotency guarantees per command type — deferred.

---

## Development

### Build commands

```bash
# TypeScript build (produces dist/)
npm -w tools/cli2 run build

# Watch mode via tsx (no build step required)
npm -w tools/cli2 run dev

# Run tests via vitest
npm -w tools/cli2 run test

# Rebuild the extension (required after editing tools/extension/src/)
npm -w tools/extension run build
# Then click the reload icon in chrome://extensions
```

### After editing the extension

You do not need to "Load unpacked" again. After rebuilding, click the circular reload icon on the PortalFlow extension card in `chrome://extensions`. The updated extension takes effect immediately for new runs.

### Test structure

- `tools/cli2/src/runner/checkpoint.ts` — `CheckpointStore` and snapshot helpers; covered by unit tests
- `tools/cli2/src/browser/extension-host.ts` — `ExtensionHost` state machine; covered by mock WebSocket tests
- `tools/cli2/src/browser/chrome-launcher.ts` — `detectChromeBinary`; covered with injected platform stubs
- `tools/extension/src/shared/selector-resolver.ts` — selector cascade; covered by parity tests against the recorder's selector-builder

---

## Relationship to other packages

### `tools/cli/` — deprecated Playwright CLI

The original `@portalflow/cli` package (`portalflow` binary) executes automations via Playwright, launching Chrome with a CDP channel. After five versions of persistent-mode fixes documented in [`docs/BROWSER-CONTROL-STRATEGY.md §2`](../../docs/BROWSER-CONTROL-STRATEGY.md#2-attempts-log), the approach was abandoned because every fix revealed a deeper incompatibility between Playwright's CDP contract and the user's real Chrome environment. `tools/cli/` remains fully functional for users who do not need real-profile automation (e.g. simple sites, isolated test runs), but it is scheduled for removal once `portalflow2` has been in active use for a few releases. Do not add new features to it.

### `tools/extension/` — PortalFlow Recorder (bi-modal)

The same extension that records workflows now also executes them. The recorder (side panel, event capture, export) and the runtime (offscreen WebSocket client, runner content script, command handlers) coexist in the same extension package without touching each other's code paths. See [`tools/extension/README.md`](../extension/README.md) for the recorder's documentation, installation options, and known limitations.

### `tools/schema/` — shared schema

Both `tools/cli/` and `tools/cli2/` import `@portalflow/schema` for automation validation and step-type definitions. The schema is the single source of truth for every field both tools produce and consume. See [`docs/AUTOMATION-JSON-SPEC.md`](../../docs/AUTOMATION-JSON-SPEC.md) for the full reference.

---

## Reporting issues / contributing

Open an issue on GitHub with:

- The exact error message (copy from the terminal — do not paraphrase)
- The full `portalflow2 run` command you ran
- Your OS, Chrome version (`chrome://settings/help`), and Node.js version (`node --version`)
- The contents of `~/.portalflow/config.json` (redact any API keys)
- The automation JSON file if the issue is step-specific (remove any real credentials first)

For feature requests, open an issue describing the use case before starting any code. For code contributions, check that the relevant area (CLI, extension, schema) does not have an open issue being worked on first.
