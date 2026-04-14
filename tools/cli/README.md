# PortalFlow CLI

PortalFlow CLI (`portalflow`) is the execution engine for PortalFlow browser automations. It loads a structured JSON automation definition, drives a real Chrome browser via Playwright, and delegates element-finding and decision-making to a configurable LLM when CSS selectors fail. Works with Anthropic Claude natively and any OpenAI-compatible endpoint (OpenAI, Moonshot Kimi, DeepSeek, Groq, Mistral, Together AI, OpenRouter, local Ollama, or a custom proxy). The result is reliable, maintainable automation that degrades gracefully when page markup changes.

> **Authoring automation JSON files?** See [`docs/AUTOMATION-JSON-SPEC.md`](../../docs/AUTOMATION-JSON-SPEC.md) for the complete reference covering every field, every step type, and worked examples.

## Features

- **Interactive TUI for every command** — run `portalflow` bare to launch a guided menu, or invoke any command without its required argument to get a wizard (file picker, preview, confirmation)
- **Verbose `--help` output** — every command has examples, precedence rules, exit codes, and "see also" pointers designed for AI agents and new developers
- **9 built-in LLM presets** plus any OpenAI-compatible endpoint — Anthropic, OpenAI, Kimi, DeepSeek, Groq, Mistral, Together AI, OpenRouter, Ollama, custom proxies
- **Video recording** via Playwright's native capture, configurable per run, per automation, or globally
- **Configurable storage paths** for automations, screenshots, videos, and downloads — with 4-level precedence (CLI flag > automation JSON > user config > built-in defaults)
- **Reusable LLM abstraction** — swap providers without changing automation definitions
- **External tool integration** — built-in adapters for `smscli` (SMS/OTP retrieval) and `vaultcli` (credential management)
- **First-run bootstrap** — automatically creates `~/.portalflow/` layout and seeds example automations on first use
- **100% scriptable** — every interactive feature has a non-interactive equivalent for CI and automation

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Update](#update)
- [Uninstall](#uninstall)
- [Quick Start](#quick-start)
- [Interactive Modes](#interactive-modes)
- [Interactive Provider Setup](#interactive-provider-setup)
- [Storage and Video Settings](#storage-and-video-settings)
- [Commands](#commands)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Automation JSON Format](#automation-json-format)
  - [Top-Level Fields](#top-level-fields)
  - [Inputs](#inputs)
  - [Steps](#steps)
  - [Step Types](#step-types)
  - [Step Options](#step-options)
  - [Reusable functions](#reusable-functions)
  - [Settings](#settings)
  - [Minimal Example](#minimal-example)
- [How Execution Works](#how-execution-works)
- [External Tool Integration](#external-tool-integration)
  - [smscli (OTP retrieval)](#smscli-otp-retrieval)
  - [vaultcli (secrets)](#vaultcli-secrets)
- [Development](#development)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 18+**
- **npm**
- **git**
- An API key for your chosen LLM provider (Anthropic, OpenAI, or any OpenAI-compatible endpoint)

---

## Installation

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/cli/install.sh | bash
```

### Local install (from inside the repo)

```bash
cd tools/cli
./install.sh
```

### What the installer does

1. Checks prerequisites: `git`, Node.js 18+, `npm`
2. Clones the repo to `~/.portalflow-cli` (or uses the current checkout when run locally)
3. Installs npm dependencies
4. Installs Playwright Chromium (`npx playwright install chromium`)
5. Builds the TypeScript project (`npm run build`)
6. Creates `~/.portalflow/automations/`, `~/.portalflow/artifacts/screenshots/`, `~/.portalflow/artifacts/videos/`, and `~/.portalflow/artifacts/downloads/`, then copies the bundled example automations into `~/.portalflow/automations/`
7. Creates symlinks at `/usr/local/bin/portalflow` and `/usr/local/bin/portalflow-update` (requires `sudo`)

The installer is idempotent — re-running it pulls the latest code, rebuilds, and refreshes the symlinks.

You can override the clone location with the `PORTALFLOW_INSTALL_DIR` environment variable.

---

## Update

```bash
portalflow-update
```

Or re-run the one-liner installer; it performs the same pull-rebuild-relink steps.

---

## Uninstall

```bash
# Remote
curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/cli/install.sh | bash -s -- --uninstall

# Local
./install.sh --uninstall
```

This removes the `/usr/local/bin/portalflow` and `/usr/local/bin/portalflow-update` symlinks. The cloned repo at `~/.portalflow-cli` is kept; delete it manually with:

```bash
rm -rf ~/.portalflow-cli
```

To also remove provider credentials, default directories, and example automations:

```bash
rm -rf ~/.portalflow
```

---

## Quick Start

### Getting detailed help

Every command has extended help with examples, exit codes, precedence rules,
and related commands. Run `--help` on any command to see it:

```bash
portalflow --help                        # Top-level overview
portalflow run --help                    # Run command details + examples
portalflow provider config --help        # Provider configuration examples for all presets
portalflow settings paths --help         # Path configuration examples
```

The help output is designed to be self-contained — an AI agent or new
developer should be able to use any command without reading external docs.

### First run

The very first time you run `portalflow` (after install), it bootstraps `~/.portalflow/`:

- Creates `~/.portalflow/automations/`, `~/.portalflow/artifacts/screenshots/`, `~/.portalflow/artifacts/videos/`, and `~/.portalflow/artifacts/downloads/`
- Copies the bundled example automations (`demo-search.json`, `phone-bill.json`) into `~/.portalflow/automations/` — only if the directory is empty, never overwriting existing files
- Logs a one-line summary at `info` level showing what was created

The bootstrap is idempotent — subsequent runs are silent and do nothing if the directories already exist. The installer also runs an equivalent shell seeding step so you can run `portalflow run ~/.portalflow/automations/demo-search.json` immediately after install.

### Interactive mode (easiest)

Run `portalflow` with no arguments to launch a guided menu:

```bash
portalflow
```

This opens a top-level TUI where you can pick any action — run an automation, validate a file, or manage LLM providers — without remembering command names or file paths. Each option has its own guided sub-flow.

**1. Configure a provider**

The easiest way is to launch the interactive setup:

```bash
portalflow provider
```

This opens a guided TUI that walks you through choosing a provider, entering your API key, and picking a model. See [Interactive Provider Setup](#interactive-provider-setup) for details.

If you prefer scripting or CI, use the non-interactive subcommands:

```bash
portalflow provider config anthropic --api-key sk-ant-... --model claude-sonnet-4-20250514
portalflow provider set anthropic
portalflow provider list
```

**2. Validate an automation file**

```bash
portalflow validate ~/.portalflow/automations/demo-search.json
```

**3. Run the demo automation**

```bash
portalflow run ~/.portalflow/automations/demo-search.json
```

**4. Run headless**

```bash
portalflow run ~/.portalflow/automations/demo-search.json --headless
```

---

## Interactive Modes

Every PortalFlow command has a guided TUI mode. Run the command without its required argument and a wizard walks you through the options.

| Command | TUI trigger | What it does |
|---|---|---|
| `portalflow` | bare (no args) | Top-level menu: run / validate / manage providers / settings / exit |
| `portalflow run` | no file argument | File picker, validates, shows automation preview with resolved artifact paths, asks about headless mode and video recording, then confirms before launching |
| `portalflow validate` | no file argument | File picker, then full schema validation with a formatted summary on success or error details on failure |
| `portalflow provider` | no subcommand | Provider management menu (documented below) |
| `portalflow settings` | no subcommand | Settings menu: view current paths and video config, configure storage paths, configure video recording, or reset to defaults |

You can always supply the required argument to skip the TUI and run non-interactively — scripts and CI pipelines are unaffected.

The file picker automatically discovers `.json` files in the configured automations directory first (default: `~/.portalflow/automations`), then falls back to `./`, `./examples/`, and `./tools/cli/examples/`, sorted by most recently modified. A "Enter path manually..." option is always available if your file lives elsewhere.

---

## Interactive Provider Setup

Running `portalflow provider` with no subcommand launches a guided Terminal UI for managing LLM providers. It's the recommended way to configure the CLI for the first time.

```bash
portalflow provider
```

On start, the TUI shows your current status (active provider and model, or a prompt to configure one if none exist) and presents a menu:

| Action | What it does |
|---|---|
| **Configure a provider** | Shows a preset picker with all built-in providers (Anthropic, OpenAI, Kimi, DeepSeek, Groq, Mistral, Together AI, OpenRouter, Ollama) plus a "Custom" option. Prompts for API key, model, and base URL (pre-filled from preset), then offers to set it as active. |
| **Set active provider** | Shows configured providers and lets you pick which one to use. Disabled until at least two providers are configured. |
| **List providers** | Displays all configured providers with their kind, model, and base URL (if applicable), marking the active one. |
| **Remove a provider** | Deletes a provider's stored credentials after confirmation. Also clears the active provider if it was the one removed. |
| **Reset all configurations** | Deletes every provider and the active selection after a two-step confirmation (confirm + type `reset`). Useful when you want to start fresh. |
| **Exit** | Leaves the TUI. |

The menu loops until you choose Exit, so you can chain multiple actions in a single session. Press `Ctrl+C` at any prompt to cancel cleanly without saving changes.

All non-interactive subcommands (`provider list`, `provider set`, `provider config`) still work as before and remain the recommended approach for scripting and CI.

---

## Storage and Video Settings

PortalFlow writes four kinds of files during a run: automation definitions (input), screenshots, videos, and downloads. Each has its own configurable directory and can be set globally, per-automation, or per-run.

### Built-in defaults

All default locations live under `~/.portalflow/`:

| Purpose | Default location |
|---|---|
| Automation files (file picker input) | `~/.portalflow/automations` |
| Screenshots | `~/.portalflow/artifacts/screenshots` |
| Videos | `~/.portalflow/artifacts/videos` |
| Downloads | `~/.portalflow/artifacts/downloads` |

These directories are created automatically on first run. The installer also seeds `~/.portalflow/automations/` with the bundled example automations (`demo-search.json` and `phone-bill.json`) so you have something to try immediately after install.

Video recording is disabled by default.

### Precedence

When resolving the effective path or video config, the CLI checks these sources in order (highest wins):

1. **CLI flag** on `portalflow run` (`--screenshot-dir`, `--video-dir`, `--download-dir`, `--automations-dir`, `--video` / `--no-video`)
2. **Automation JSON `settings`** (per-automation)
3. **User config** `~/.portalflow/config.json` (`paths.*`, `video.*`)
4. **Built-in defaults**

### Configuring globally

Use the interactive settings menu:

```bash
portalflow settings
```

Or the non-interactive subcommands:

```bash
# Show current settings
portalflow settings list

# Update paths (any subset of flags)
portalflow settings paths --automations ~/my-automations --videos ~/recordings

# Enable video and set resolution
portalflow settings video --enable --width 1920 --height 1080

# Disable video
portalflow settings video --disable
```

### Configuring per run

```bash
portalflow run automation.json --video --video-dir ./one-off-recordings
portalflow run automation.json --screenshot-dir /tmp/shots --no-video
```

### Configuring per automation

In the automation JSON's `settings` object:

```json
{
  "settings": {
    "recordVideo": true,
    "videoSize": { "width": 1920, "height": 1080 },
    "videoDir": "./my-automation-videos",
    "screenshotDir": "./my-automation-screenshots",
    "downloadDir": "./my-automation-downloads"
  }
}
```

### Config file example

```json
{
  "activeProvider": "anthropic",
  "providers": { },
  "paths": {
    "automations": "/home/user/portalflow-runs/automations",
    "screenshots": "/home/user/portalflow-runs/screenshots",
    "videos": "/home/user/portalflow-runs/videos",
    "downloads": "/home/user/portalflow-runs/downloads"
  },
  "video": {
    "enabled": true,
    "width": 1920,
    "height": 1080
  }
}
```

---

## Commands

### `portalflow run [file]`

Execute an automation from a JSON file. If `file` is omitted, launches the interactive run TUI (file picker + preview + confirmation). See [Interactive Modes](#interactive-modes).

```bash
portalflow run automation.json
portalflow run automation.json --headless
portalflow run automation.json --video --video-dir ./recordings
portalflow run   # interactive mode
```

| Option | Description |
|---|---|
| `--headless` | Run Chrome in headless mode (default: headed) |
| `--video` | Enable video recording of the browser session |
| `--no-video` | Disable video recording even if enabled in config |
| `--video-dir <dir>` | Directory to store recorded videos |
| `--screenshot-dir <dir>` | Directory to store screenshots |
| `--download-dir <dir>` | Directory to store downloaded files |
| `--automations-dir <dir>` | Directory to look for automation files (used by the file picker) |

See [Storage and Video Settings](#storage-and-video-settings) for the full precedence rules.

### `portalflow validate [file]`

Validate an automation JSON file against the schema. Prints structured errors on failure; useful before running an automation in CI or production. If `file` is omitted, launches the interactive validate TUI (file picker + formatted schema report). See [Interactive Modes](#interactive-modes).

```bash
portalflow validate automation.json
portalflow validate   # interactive mode
```

### `portalflow provider`

With no subcommand, launches the interactive provider setup TUI. See [Interactive Provider Setup](#interactive-provider-setup) for the full walkthrough.

```bash
portalflow provider
```

### `portalflow provider list`

List all configured LLM providers and mark the currently active one.

```bash
portalflow provider list
```

### `portalflow provider set <name>`

Set the active LLM provider by name.

```bash
portalflow provider set anthropic
portalflow provider set kimi
```

### `portalflow provider config <name>`

Configure credentials and model for a provider. Settings are written to `~/.portalflow/config.json`.

```bash
portalflow provider config anthropic --api-key sk-ant-... --model claude-sonnet-4-20250514
portalflow provider config openai --api-key sk-... --model gpt-4o
portalflow provider config kimi --kind openai-compatible \
  --api-key sk-... \
  --model moonshot-v1-32k \
  --base-url https://api.moonshot.cn/v1
portalflow provider config openai --api-key sk-... --base-url https://my-proxy.example.com/v1
```

| Option | Description |
|---|---|
| `--api-key <key>` | Provider API key |
| `--model <model>` | Model identifier |
| `--base-url <url>` | Base URL for OpenAI-compatible endpoints |
| `--kind <kind>` | Provider kind: `anthropic` or `openai-compatible` (inferred from name if omitted) |

### `portalflow provider reset`

Delete all configured providers and clear the active provider selection. This is destructive — all stored API keys and model settings are removed.

```bash
portalflow provider reset --yes
```

| Option | Description |
|---|---|
| `--yes` | Required. Skip confirmation and proceed (without it the command refuses, by design). |

For an interactive reset with a safer two-step confirmation, run `portalflow provider` and pick "Reset all configurations" from the menu instead.

### `portalflow settings`

With no subcommand, launches the interactive settings TUI for managing storage paths and video recording. See [Storage and Video Settings](#storage-and-video-settings).

```bash
portalflow settings
```

### `portalflow settings list`

Show the effective storage paths and video recording settings (merging config file with built-in defaults).

```bash
portalflow settings list
```

### `portalflow settings paths`

Set one or more storage path directories. Omit all flags to display the current effective paths.

```bash
portalflow settings paths --automations ~/automations --screenshots ~/screenshots
portalflow settings paths --videos ~/videos --downloads ~/downloads
portalflow settings paths   # show current paths
```

| Option | Description |
|---|---|
| `--automations <dir>` | Directory for the file picker to search |
| `--screenshots <dir>` | Directory to store screenshots |
| `--videos <dir>` | Directory to store recorded videos |
| `--downloads <dir>` | Directory to store downloaded files |

### `portalflow settings video`

Configure video recording defaults. Omit all flags to display the current effective video config.

```bash
portalflow settings video --enable --width 1920 --height 1080
portalflow settings video --disable
portalflow settings video   # show current video config
```

| Option | Description |
|---|---|
| `--enable` | Enable video recording by default for all runs |
| `--disable` | Disable video recording by default |
| `--width <n>` | Video width in pixels |
| `--height <n>` | Video height in pixels |

### Custom OpenAI-compatible providers

Any OpenAI-compatible endpoint is supported. The built-in presets provide pre-filled base URLs and default models. You can also add a fully custom endpoint.

#### Built-in presets

| ID | Label | Default base URL | Default model |
|---|---|---|---|
| `anthropic` | Anthropic Claude | (native API) | `claude-sonnet-4-20250514` |
| `openai` | OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| `kimi` | Moonshot Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-32k` |
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| `mistral` | Mistral | `https://api.mistral.ai/v1` | `mistral-large-latest` |
| `together` | Together AI | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4` |
| `ollama` | Ollama (local) | `http://localhost:11434/v1` | `llama3.3` |

#### Configure via TUI

Run `portalflow provider` to open the interactive setup. The "Configure a provider" step presents all built-in presets (with pre-filled base URLs) and a "Custom OpenAI-compatible provider" option at the bottom.

#### Configure non-interactively

```bash
# Use a built-in preset (kind inferred automatically)
portalflow provider config kimi --api-key sk-... --model moonshot-v1-32k \
  --base-url https://api.moonshot.cn/v1
portalflow provider set kimi

# Configure Groq
portalflow provider config groq --api-key gsk_... \
  --base-url https://api.groq.com/openai/v1 \
  --model llama-3.3-70b-versatile
portalflow provider set groq

# Configure a fully custom proxy
portalflow provider config my-proxy \
  --kind openai-compatible \
  --api-key sk-... \
  --base-url https://my-proxy.example.com/v1 \
  --model gpt-4o
portalflow provider set my-proxy

# Configure local Ollama (no API key needed)
portalflow provider config ollama --base-url http://localhost:11434/v1 --model llama3.3
portalflow provider set ollama
```

---

## Configuration

All configuration is stored at `~/.portalflow/config.json`:

```json
{
  "activeProvider": "kimi",
  "providers": {
    "anthropic": {
      "kind": "anthropic",
      "apiKey": "sk-ant-...",
      "model": "claude-sonnet-4-20250514"
    },
    "openai": {
      "kind": "openai-compatible",
      "apiKey": "sk-...",
      "model": "gpt-4o",
      "baseUrl": "https://api.openai.com/v1"
    },
    "kimi": {
      "kind": "openai-compatible",
      "apiKey": "sk-...",
      "model": "moonshot-v1-32k",
      "baseUrl": "https://api.moonshot.cn/v1"
    }
  },
  "paths": {
    "automations": "/home/user/automations",
    "screenshots": "/home/user/artifacts/screenshots",
    "videos": "/home/user/artifacts/videos",
    "downloads": "/home/user/artifacts/downloads"
  },
  "video": {
    "enabled": false,
    "width": 1280,
    "height": 720
  }
}
```

The `kind` field controls which API client is used: `anthropic` uses the native Anthropic Messages API; `openai-compatible` uses the OpenAI client with a custom `baseUrl`. Existing configs without a `kind` field are automatically upgraded on first use: `anthropic` maps to kind `anthropic`, everything else maps to `openai-compatible`.

The `paths`, `video`, `logging`, and `browser` sections are all optional; built-in defaults apply for any omitted values. See [Storage and Video Settings](#storage-and-video-settings), [Logging and Troubleshooting](#logging-and-troubleshooting), and [Browser Profile Configuration](#browser-profile-configuration).

---

## Browser Profile Configuration

PortalFlow can run automations in two browser modes. Picking the right one is one of the most important decisions for any automation that needs long-lived sign-in state, real cookies, browser extensions (password managers, ad blockers), or compatibility with sites that fingerprint bot-like Chromium contexts.

### Modes

| Mode | Use it when | What happens |
|---|---|---|
| `isolated` (default) | The automation is short-lived, hermetic, and walks through every login flow on every run. CI runs, smoke tests, ephemeral demos. | Playwright launches a fresh in-memory Chromium for every run. No cookies, no extensions, no sign-in state, no history. Side-effect-free. |
| `persistent` | You want the automation to behave like a returning human user from your normal browser. Logged-in portals, MFA-gated sites, sites that depend on extensions, sites that block plain Chromium. | Playwright opens (or creates) a real on-disk Chrome / Brave / Chromium / Edge user data directory via `launchPersistentContext`. Cookies, localStorage, saved logins, extensions, and history all persist between runs. |

### Important: the Chrome lock

A Chrome user data directory cannot be opened by two processes at the same time. If you have your normal browser running with the same profile, the persistent-mode launch will fail with a profile-locked error. Two ways to handle it:

1. **Close your normal browser before each run.** Works for occasional runs.
2. **Reserve a profile for automation.** Create a dedicated Chrome profile (e.g. "Automation"), sign into the portals you need, and tell PortalFlow to use that profile. Your daily-driver profile stays untouched.

### Configuration precedence

Highest priority first:

1. CLI flags on `portalflow run` (`--browser-mode`, `--browser-channel`, `--browser-user-data-dir`, `--browser-profile-directory`)
2. The `browser` section of `~/.portalflow/config.json`
3. Default: `mode: "isolated"`

### Configuring a profile interactively

```bash
portalflow settings   # → "Configure browser profile"
```

The TUI scans installed Chromium-family browsers (Google Chrome, Chrome Beta/Dev, Chromium, Brave, Microsoft Edge, Edge Beta), reads each browser's `Local State` JSON to discover the named profiles inside, and presents them as a single picker:

```
Google Chrome / Personal — oscar@marin.cr  [Default]
Google Chrome / Work — oscar@work.example  [Profile 1]
Brave / Privacy  [Default]
Microsoft Edge / Default  [Default]
```

Pick one, confirm, and the choice is persisted in `~/.portalflow/config.json`.

### Configuring a profile non-interactively

```bash
# Print current config
portalflow settings browser

# List installed browser profiles
portalflow settings browser --list

# Switch to isolated mode
portalflow settings browser --mode isolated

# Use a specific Chrome profile
portalflow settings browser \
  --mode persistent \
  --channel chrome \
  --user-data-dir ~/.config/google-chrome \
  --profile-directory "Default"

# Use a Brave profile (Brave is launched via the chrome channel)
portalflow settings browser \
  --mode persistent \
  --channel chrome \
  --user-data-dir ~/.config/BraveSoftware/Brave-Browser \
  --profile-directory "Profile 1"

# Use Microsoft Edge
portalflow settings browser \
  --mode persistent \
  --channel msedge \
  --user-data-dir ~/.config/microsoft-edge \
  --profile-directory "Default"
```

### Per-run override

```bash
# Force isolated mode for one run, ignoring the saved config
portalflow run my-automation.json --browser-mode isolated

# Use a different profile just for one run
portalflow run my-automation.json \
  --browser-mode persistent \
  --browser-channel chrome \
  --browser-user-data-dir ~/.config/google-chrome \
  --browser-profile-directory "Profile 2"
```

### Config file shape

```json
{
  "browser": {
    "mode": "persistent",
    "channel": "chrome",
    "userDataDir": "/home/marinoscar/.config/google-chrome",
    "profileDirectory": "Default"
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `mode` | `"isolated" \| "persistent"` | `"isolated"` | Launch strategy. |
| `channel` | string | `undefined` (Playwright Chromium) | Which Chromium-family binary to launch. Valid values: `chromium`, `chrome`, `chrome-beta`, `chrome-dev`, `msedge`, `msedge-beta`, `msedge-dev`. Used only in persistent mode. |
| `userDataDir` | string | `undefined` | Absolute path to a user data directory. Required when `mode === "persistent"`. |
| `profileDirectory` | string | `"Default"` | Sub-profile name inside the user data dir (e.g. `"Default"`, `"Profile 1"`). |

### What survives across persistent-mode runs

Everything Chrome normally persists:
- Cookies and localStorage (so you stay signed in)
- Saved passwords and form autofill
- Extensions and their state (password managers, ad blockers, etc.)
- Browsing history
- Site permissions (camera, mic, notifications)

This is exactly the surface that makes persistent mode feel like a returning human user instead of a fresh bot.

---

## Control Flow and Recovery

PortalFlow supports step-level error inspection and step-to-step jumps for building recovery flows. After every step settles (success, skip, or failed-then-abort), the runtime records these context variables:

- `<stepId>_status` — `"success"` / `"failed"` / `"skipped"`, keyed by step id
- `<stepId>_error` — error message (only set when status is `failed`)
- `last_step_id`, `last_step_status`, `last_step_error` — rolling pointers to the most recently settled step

The same data is exposed as system functions — `{{$lastStepStatus}}`, `{{$lastStepError}}`, `{{$lastStepId}}` — so you can read step state from any templated URL, tool_call arg, or other templated field.

**Conditional jumps:** `condition` steps now honor `thenStep` / `elseStep` fields that name a top-level step to jump to when the check evaluates true/false. Combined with the `last_step_status` variable, you can fork into a recovery handler and then use a `goto` step to jump back and retry:

```json
[
  { "id": "step-login", "type": "navigate", "action": { "url": "..." }, "onFailure": "skip", ... },
  { "id": "check", "type": "condition",
    "action": {
      "check": "variable_equals",
      "value": "last_step_status=failed",
      "thenStep": "step-recover",
      "elseStep": "step-continue"
    } },
  { "id": "step-recover", "type": "interact", "action": { "interaction": "click" }, ... },
  { "id": "jump-back", "type": "goto", "action": { "targetStepId": "step-login" } },
  { "id": "step-continue", "type": "navigate", "action": { "url": "..." }, ... }
]
```

**Goto step:** The new `goto` step type unconditionally resets the runner's instruction pointer to a named top-level step. `action.targetStepId` supports template syntax.

**Safety net:** A hard cap of **1000 step executions per run** catches runaway goto loops. A broken retry pattern aborts in under a second with a clear error instead of hanging the process.

**Jump scope:** Jumps only work at the top level. Targets inside loop substeps or function bodies are rejected at schema validation time — the iteration / parameter scope would be lost. For retry-from-earlier inside a loop, put the retry logic in a function and invoke it via `call`.

See `docs/AUTOMATION-JSON-SPEC.md` §6.10 for the full semantics, the worked recovery pattern, and the list of validation errors you may encounter. See `tools/cli/examples/retry-with-goto.json` for a runnable example.

---

## AI-driven Sub-Runs (`aiscope`)

PortalFlow also supports `aiscope` steps: a bounded, goal-driven sub-run where the runtime hands control to an LLM. The LLM observes the page (simplified HTML plus an optional viewport screenshot), picks the next browser action, and PortalFlow dispatches it. The loop runs until the user's success check passes, the wall-clock budget expires, or the iteration cap is hit — whichever fires first.

Use it when the exact selectors or flow can't be predicted — "dismiss whatever cookie banner this site shows" or "find the PDF download button somewhere in the bills table". For known flows, stick with explicit steps — they're cheaper and far more debuggable.

**Action shape:**

```json
{
  "type": "aiscope",
  "action": {
    "goal": "Dismiss the cookie consent banner",
    "successCheck": { "ai": "Is the page free of any cookie or consent banner?" },
    "maxDurationSec": 60,
    "maxIterations": 10,
    "includeScreenshot": true
  },
  "onFailure": "skip",
  "maxRetries": 0,
  "timeout": 60000
}
```

**Dual budget caps (both enforced, whichever fires first):**
- `maxDurationSec` — wall-clock budget, default 300s (5 min), range 1–3600.
- `maxIterations` — observe→decide→dispatch cycles, default 25, range 1–200.

**Vision:** screenshots are sent to the LLM on every iteration by default. Requires a vision-capable model (Claude 3.5+ / GPT-4o+). Set `includeScreenshot: false` to fall back to HTML-only.

**Success check:** either a deterministic `{ check, value }` (same enum as the `condition` step) or an AI `{ ai: "yes/no question" }`. Exactly one must be set.

**Safety:** the LLM can only pick from a fixed action vocabulary (`navigate`, `click`, `type`, `select`, `check`, `uncheck`, `hover`, `focus`, `scroll`, `wait`, `done`). There's no `eval` or raw-JS escape hatch. Failed actions are fed back to the LLM in a 5-entry history buffer so the model can adapt instead of repeating broken moves.

See `docs/AUTOMATION-JSON-SPEC.md` §6.11 for the full reference and `tools/cli/examples/aiscope-demo.json` for a runnable example.

---

## Logging and Troubleshooting

PortalFlow uses [pino](https://getpino.io) for structured, JSON-native logging. Every automation run produces a detailed event stream you can grep, pipe through `jq`, or follow live in a terminal.

### What gets logged

At **info** (default) you see:
- Automation id/name/version, the effective logging config, and the effective paths/video config.
- Input resolution (per input, with secret values redacted).
- Per-step start / complete / failed events with `stepId`, `stepName`, `type`, `attempt`, and `durationMs`.
- Retry backoffs (attempt number, delay, error message).
- Final run summary (success, stepsCompleted, stepsTotal, errorCount, artifactCount, durationMs).
- Screenshot paths on step failure.

At **debug** you additionally see:
- Template resolution: raw vs. resolved URL, type-step source (`inputRef` / `template`), tool-call `rawArgs` vs. `resolvedArgs`.
- Element resolution source (primary / fallback / AI), AI confidence, and resolution latency.
- Extracted values (first 500 characters, longer payloads truncated with a `truncated: true` marker).
- Tool call dispatch: raw + resolved args, success flag, duration, output length, multi-field exploding.
- **LLM provider telemetry**: `provider`, `model`, `operation`, `latencyMs`, `inputTokens`, `outputTokens`. Emitted after every `findElement`, `findItems`, `evaluateCondition`, `decideAction`, `interpretPage`, and `extractData` call.
- **Browser page lifecycle**: `framenavigated`, `load`, `domcontentloaded`, `pageerror`, `crash`, `dialog`, console warnings/errors, failed requests, and non-2xx responses.

At **trace** pino forwards every call site above the threshold — currently equivalent to `debug` plus any extra-verbose diagnostics you add to the code.

On step failure, errors are logged with the full stack trace (pino's default `err` serializer). A failure screenshot is captured automatically and its path is recorded.

### Log level precedence

Highest priority first:

1. `--log-level <level>` CLI flag
2. `LOG_LEVEL` environment variable
3. `logging.level` in `~/.portalflow/config.json`
4. Default: `info`

Valid levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`.

### Configuring logging

**Interactive TUI** — run `portalflow settings` and pick **Configure logging**.

**Non-interactive subcommand**:

```bash
portalflow settings logging                                   # print current config
portalflow settings logging --level debug                     # set default level
portalflow settings logging --file ~/.portalflow/run.log      # enable file output
portalflow settings logging --no-file                         # disable file output
portalflow settings logging --no-pretty                       # emit raw JSON to stdout
portalflow settings logging --no-redact                       # disable secret redaction (CAUTION)
```

**Per-run override**:

```bash
# CLI flag
portalflow run my-automation.json --log-level debug

# Or via env var
LOG_LEVEL=debug portalflow run my-automation.json
```

### Log destination

By default, logs go to stdout (pretty-printed and colorized). When `logging.file` is set, logs are fanned out to **both** stdout AND the file. The file output is always raw JSON (one entry per line) to keep it easy to grep and parse with `jq`.

The file's parent directory is created automatically if missing. Logs are appended, not truncated, so successive runs accumulate in the same file. Rotate it yourself with `logrotate` or a cron job if it grows too large.

### Secret redaction

When `logging.redactSecrets` is true (default), pino's redact feature replaces the values of these property paths with `[REDACTED]` before writing the log line:

`apiKey`, `password`, `secret`, `token`, `otp`, `otpCode`, and the same set under `args.*` / `resolvedArgs.*`.

This protects credentials pulled from vaultcli, OTP codes from smscli, and any nested config passed through `tool_call` args. **Disable it only for local debugging** — the CLI will still print secrets to stderr via uncaught exceptions if something panics deeply, so redaction alone is not a compliance boundary.

### Piping to a file ad-hoc

Even without file logging enabled, you can always redirect stdout:

```bash
LOG_LEVEL=debug portalflow run my-automation.json 2>&1 | tee run.log
```

### Troubleshooting tips

- **Step timing**: look for `step complete` events with `durationMs` to find slow steps.
- **Selector drift**: at debug level, every interact step logs `source: "primary" | "fallback" | "ai"`. Steps that consistently fall back to AI have brittle primary selectors — replace them with data-testid or stable attributes.
- **LLM cost**: the `llm call` debug entries include `inputTokens` + `outputTokens` so you can audit token usage per run.
- **Failed OTP runs**: search for `smscli` tool_call entries. The adapter automatically falls back from `otp-wait` to `otp-latest` on `OTP_TIMEOUT` — the fallback appears as a second `Executing tool call` log line.
- **Page errors**: at debug level, `page uncaught exception` (warn) and `page request failed` entries catch JS errors and broken network calls that the automation didn't otherwise notice.
- **Stack traces**: failed steps log the full `err.stack` automatically. No need to re-run with extra flags.

---

## Environment Variables

Environment variables override the values in `~/.portalflow/config.json` at runtime.

| Variable | Description |
|---|---|
| `PORTALFLOW_LLM_PROVIDER` | Override the active provider (must match a configured provider name) |
| `ANTHROPIC_API_KEY` | Fallback API key for Anthropic when no config file entry exists |
| `OPENAI_API_KEY` | Fallback API key for OpenAI when no config file entry exists |
| `LOG_LEVEL` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` (default: `info`). Overridden by `--log-level` CLI flag. |
| `PORTALFLOW_INSTALL_DIR` | Installer: override clone location (default: `~/.portalflow-cli`) |

---

## Automation JSON Format

An automation is a single JSON file that describes what the browser should do. The CLI validates the file against a Zod schema before executing it.

### Top-Level Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (UUID) | Yes | Unique identifier for the automation |
| `name` | string | Yes | Human-readable name |
| `version` | string | Yes | Semver version string |
| `description` | string | Yes | Short description |
| `goal` | string | Yes | Plain-English statement of what the automation achieves |
| `inputs` | array | Yes | Input definitions (can be empty) |
| `steps` | array | Yes | Ordered list of steps to execute |
| `tools` | array | No | External tools required (`smscli`, `vaultcli`) |
| `outputs` | array | No | Named outputs captured during execution |
| `settings` | object | No | Runtime settings (headless, timeouts, artifacts) |

### Inputs

Each input defines a value that steps can reference via `inputRef`.

```json
{
  "name": "username",
  "type": "string",
  "required": true,
  "source": "env",
  "value": "APP_USERNAME",
  "description": "Login username"
}
```

| Field | Description |
|---|---|
| `name` | Identifier used in step `inputRef` fields |
| `type` | `string`, `secret`, `number`, `boolean` |
| `required` | Whether the automation aborts if this input is missing |
| `source` | `env` (env var name in `value`), `vaultcli` (vault path in `value`), `literal` (value used as-is), `cli_arg` |
| `value` | The env var name, vault path, or literal string depending on `source` |

### Steps

Each step has a common envelope plus a `type`-specific `action`.

```json
{
  "id": "step-1",
  "name": "Navigate to login page",
  "type": "navigate",
  "action": { "url": "https://example.com/login" },
  "onFailure": "abort",
  "maxRetries": 2,
  "timeout": 15000
}
```

### Step Types

| Type | Action Fields | Description |
|---|---|---|
| `navigate` | `url` | Go to a URL |
| `interact` | `interaction`, `value?`, `inputRef?` | Click, type, select, check, uncheck, hover, or focus an element |
| `wait` | `condition`, `value?`, `timeout?` | Wait for `selector`, `navigation`, `delay`, or `network_idle` |
| `extract` | `target`, `outputName`, `attribute?` | Capture `text`, `attribute`, `html`, `url`, `title`, or `screenshot` |
| `tool_call` | `tool`, `command`, `args`, `outputName?` | Invoke an external tool (`smscli` or `vaultcli`) |
| `condition` | `check` or `ai`, plus optional `thenCall`/`elseCall` | Evaluate a deterministic check (`element_exists`, `url_matches`, `text_contains`, `variable_equals`) or a plain-English AI question, optionally branching into a named function. |
| `download` | `trigger`, `expectedFilename?` | Trigger and capture a file download via `click` or `navigation` |
| `loop` | `maxIterations`, `items?`, `exitWhen?`, `indexVar?` | Bounded iteration over items (with optional AI discovery) or bounded repetition with an exit condition. Child steps go in `substeps`. See [the full loop spec](../../docs/AUTOMATION-JSON-SPEC.md#14-the-loop-step-in-depth) |
| `call` | `function`, `args?` | Invoke a named function declared in the top-level `functions` section. See [Reusable functions](#reusable-functions) below. |

### Step Options

All step types share these fields:

| Field | Default | Description |
|---|---|---|
| `selectors.primary` | — | Primary CSS selector for element-targeting steps |
| `selectors.fallbacks` | `[]` | Ordered list of fallback selectors tried if primary fails |
| `aiGuidance` | — | Natural-language hint passed to the LLM when all selectors fail |
| `validation` | — | Post-action assertion: `{ type, value }` |
| `onFailure` | `"abort"` | `"retry"`, `"skip"`, or `"abort"` |
| `maxRetries` | `3` | Maximum retry attempts (exponential backoff: 1s, 2s, 4s, ...) |
| `timeout` | `30000` | Step timeout in milliseconds |

The `substeps` field is also accepted on every step object but is only used by the `loop` step type, which places its child steps there. See [`docs/AUTOMATION-JSON-SPEC.md`](../../docs/AUTOMATION-JSON-SPEC.md) for the full field reference.

### Reusable functions

An automation can declare reusable functions at the top level and invoke them via the `call` step type. Functions let you package a sequence of steps under a name and run it from multiple places — once at the top level, N times inside a loop, or from a condition's `thenCall` / `elseCall` branch.

Minimal example:

```json
{
  "functions": [
    {
      "name": "downloadBill",
      "parameters": [
        { "name": "billRow", "required": true }
      ],
      "steps": [
        { "id": "f1", "name": "Click", "type": "interact", "action": { "interaction": "click" }, "selectors": { "primary": "{{billRow}}" } },
        { "id": "f2", "name": "Save",  "type": "download", "action": { "trigger": "click" }, "selectors": { "primary": "button.download-pdf" } }
      ]
    }
  ],
  "steps": [
    {
      "id": "loop",
      "name": "Download 3 bills",
      "type": "loop",
      "action": { "maxIterations": 3, "items": { "description": "bill rows", "selectorPattern": "tr.bill-row", "itemVar": "row" } },
      "substeps": [
        {
          "id": "call",
          "name": "Call downloadBill",
          "type": "call",
          "action": { "function": "downloadBill", "args": { "billRow": "{{row}}" } }
        }
      ]
    }
  ]
}
```

Key rules:

- Functions share the caller's `RunContext` — loop iteration variables, extract outputs, and inputs all flow through automatically.
- Declared parameters temporarily shadow existing context variables while the function runs, then restore on return.
- Functions may call other functions up to a hard depth cap of 16 to prevent runaway recursion.
- Condition steps may set `thenCall` / `elseCall` to a function name to branch based on the boolean result; these are the supported branching mechanism because `thenStep` / `elseStep` are not yet implemented.
- Duplicate function names and `call` steps that reference an unknown function are rejected at `portalflow validate` time.

See the full specification at [`docs/AUTOMATION-JSON-SPEC.md#45-functions`](../../docs/AUTOMATION-JSON-SPEC.md#45-functions) and the worked example at `examples/functions-demo.json`.

### Settings

```json
{
  "settings": {
    "headless": false,
    "viewport": { "width": 1280, "height": 800 },
    "defaultTimeout": 30000,
    "screenshotOnFailure": true,
    "artifactDir": "./artifacts",
    "screenshotDir": "./my-screenshots",
    "videoDir": "./my-videos",
    "downloadDir": "./my-downloads",
    "automationsDir": "./my-automations",
    "recordVideo": true,
    "videoSize": { "width": 1920, "height": 1080 }
  }
}
```

| Field | Default | Description |
|---|---|---|
| `headless` | `false` | Run browser headless |
| `viewport` | — | Browser viewport dimensions |
| `userAgent` | — | Custom user-agent string |
| `defaultTimeout` | `30000` | Default step timeout in ms |
| `screenshotOnFailure` | `true` | Capture a screenshot when a step aborts |
| `artifactDir` | `./artifacts` | Legacy fallback. If `screenshotDir` is not set, screenshots fall back to this directory. New automations should prefer `screenshotDir`. |
| `screenshotDir` | — | Per-automation screenshot directory (overrides config and defaults) |
| `videoDir` | — | Per-automation video directory |
| `downloadDir` | — | Per-automation downloads directory |
| `automationsDir` | — | Per-automation automations directory (affects file picker) |
| `recordVideo` | — | Per-automation video recording toggle |
| `videoSize` | — | Per-automation video resolution `{ width, height }` |

The `--headless` CLI flag overrides `settings.headless` in the JSON. See [Storage and Video Settings](#storage-and-video-settings) for the full precedence rules for storage paths and video recording.

### Minimal Example

A three-step automation that navigates to a page, types a search query, and extracts the page title:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440099",
  "name": "Simple Search",
  "version": "1.0.0",
  "description": "Search DuckDuckGo and capture the result page title",
  "goal": "Demonstrate navigate, interact, and extract steps",
  "inputs": [
    {
      "name": "query",
      "type": "string",
      "required": true,
      "source": "literal",
      "value": "PortalFlow automation",
      "description": "Search term"
    }
  ],
  "steps": [
    {
      "id": "step-1",
      "name": "Open DuckDuckGo",
      "type": "navigate",
      "action": { "url": "https://duckduckgo.com" },
      "onFailure": "abort",
      "maxRetries": 2,
      "timeout": 15000
    },
    {
      "id": "step-2",
      "name": "Type search query",
      "type": "interact",
      "action": { "interaction": "type", "inputRef": "query" },
      "selectors": {
        "primary": "input[name=\"q\"]",
        "fallbacks": ["#searchbox_input"]
      },
      "aiGuidance": "Find the main search input field on the DuckDuckGo homepage",
      "onFailure": "abort",
      "maxRetries": 3,
      "timeout": 10000
    },
    {
      "id": "step-3",
      "name": "Extract result page title",
      "type": "extract",
      "action": { "target": "title", "outputName": "resultTitle" },
      "onFailure": "skip",
      "maxRetries": 0,
      "timeout": 5000
    }
  ],
  "outputs": [
    { "name": "resultTitle", "type": "text", "description": "Title of the results page" }
  ],
  "settings": {
    "headless": false,
    "defaultTimeout": 30000,
    "screenshotOnFailure": true,
    "artifactDir": "./artifacts"
  }
}
```

Use `{{inputName}}` template syntax inside `action.url` and other string fields to substitute input values at runtime. The same syntax also exposes built-in **system functions** via the reserved `$` prefix — `{{$date}}`, `{{$year}}`, `{{$monthName}}`, `{{$uuid}}`, `{{$runId}}`, and ~20 more — for embedding the current date, time, run id, or fresh UUIDs into URLs, filenames, and tool args. See [`docs/AUTOMATION-JSON-SPEC.md#134-system-functions`](../../docs/AUTOMATION-JSON-SPEC.md#134-system-functions) for the full list.

See `examples/demo-search.json` for a complete working example, `examples/phone-bill.json` for a template covering portal login, OTP via smscli, and file download, `examples/att-bills-last-n.json` for the canonical `loop` step example, and `examples/functions-demo.json` for a worked example of the `functions` / `call` feature.

---

## How Execution Works

When `portalflow run` is called, the `AutomationRunner`:

1. Parses and validates the JSON against the Zod schema — aborts immediately on schema errors.
2. Resolves effective storage paths and video config by merging CLI flags, automation JSON `settings`, user config, and built-in defaults.
3. Bootstraps `~/.portalflow/` directories on first run and seeds example automations if the automations directory is empty.
4. Resolves all inputs: reads environment variables, calls `vaultcli` for secrets, applies literals.
5. Initializes the configured LLM provider (Anthropic or any OpenAI-compatible endpoint).
6. Launches Chrome via Playwright (headed by default). If video recording is enabled, the browser context records a `.webm` file to the configured videos directory.
7. Executes each step in order via `StepExecutor`:
   - Tries the primary selector, then each fallback in order.
   - If all selectors fail and `aiGuidance` is set, calls the LLM to locate the element from page context.
   - Runs the action.
   - Runs post-step validation if defined.
   - Applies the `onFailure` policy (`abort`, `retry`, or `skip`) on error.
8. Captures a failure screenshot to the configured screenshots directory when `screenshotOnFailure: true`.
9. Routes any files downloaded during steps to the configured downloads directory.
10. Closes the browser context. Recorded videos are finalized at this point and added to the run artifacts.
11. Returns a structured run result with stepsCompleted, stepsTotal, errors, and artifact paths.

The design is a hybrid model: the JSON provides deterministic process guidance while the LLM absorbs selector variability. This avoids expensive, repeated website discovery on every run and keeps automations resilient to minor UI changes without modifying the JSON.

---

## External Tool Integration

### smscli (OTP retrieval)

`smscli` waits for and extracts OTP codes during MFA flows. Use it in a `tool_call` step.
The captured value is stored in the run context under `outputName` and referenced by later
steps via `inputRef`.

Commands:

| Command       | Underlying CLI                                              |
|---------------|-------------------------------------------------------------|
| `otp-wait`    | `smscli otp wait --json [--timeout S --sender X ...]` — **auto-falls back to `otp-latest` on `OTP_TIMEOUT`**. |
| `otp-latest`  | `smscli otp latest --json [--sender X ...]`                 |
| `otp-extract` | `smscli otp extract --message "<body>" --json`              |

```json
{
  "id": "step-otp",
  "name": "Retrieve OTP from SMS",
  "type": "tool_call",
  "action": {
    "tool": "smscli",
    "command": "otp-wait",
    "args": { "sender": "ExampleCarrier", "timeout": "60" },
    "outputName": "otpCode"
  },
  "onFailure": "abort",
  "maxRetries": 0,
  "timeout": 180000
}
```

On `OTP_TIMEOUT`, the adapter automatically retries `smscli otp latest` with the same filter
args — no extra fallback step is needed. A subsequent interact step can then use
`"inputRef": "otpCode"` to type the code into the OTP field.

See the [smscli README](https://github.com/marinoscar/sink/blob/main/tools/smscli/README.md)
for setup instructions, and §6.5 of `docs/AUTOMATION-JSON-SPEC.md` for the full command/args
reference.

### vaultcli (secrets)

`vaultcli` pulls credentials at runtime so that sensitive values are never embedded in
automation JSON. Vault secrets contain multiple fields (typically `username`, `password`,
`url`) — the runner exposes every field as its own context variable named
`<inputName>_<field>`.

Reference it as an input `source`:

```json
{
  "name": "creds",
  "type": "secret",
  "required": true,
  "source": "vaultcli",
  "value": "att",
  "description": "Portal credentials from vault (username + password + url)"
}
```

After resolution, `{{creds_username}}`, `{{creds_password}}`, `{{creds_url}}` are all
available as context variables. Use them via `inputRef: "creds_password"` in type steps.

Or invoke it as a mid-run `tool_call` step with `command: "secrets-get"` (optionally passing
`field: "<one-key>"` for single-field access). See §6.5 and §10.2 of
`docs/AUTOMATION-JSON-SPEC.md` for the full reference.

See the [vaultcli README](https://github.com/marinoscar/vault/blob/main/tools/vaultcli/README.md)
for setup instructions.

---

## Development

```bash
cd tools/cli
npm install
npm run build         # Compile TypeScript to dist/
npm run dev           # Run from source via tsx (no build step)
npm test              # Run Vitest schema tests
npx tsc --noEmit      # Typecheck without emitting files
```

---

## Project Structure

```
tools/cli/
├── install.sh                    # Installer / updater / uninstaller
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── examples/
│   ├── demo-search.json          # Working DuckDuckGo search demo
│   └── phone-bill.json           # Template: portal login + OTP + download
├── src/
│   ├── index.ts                  # CLI entry point (commander wire-up)
│   ├── help-text.ts              # Verbose --help text for every command
│   ├── schema/                   # Zod schema and TypeScript types for automation JSON
│   │   ├── automation.schema.ts
│   │   └── types.ts
│   ├── config/
│   │   └── config.service.ts     # ~/.portalflow/config.json read/write
│   ├── llm/
│   │   ├── provider.interface.ts # Common LLM interface
│   │   ├── provider-kinds.ts     # 9 built-in presets + kind inference
│   │   ├── anthropic.provider.ts # Native Anthropic client
│   │   ├── openai.provider.ts    # OpenAI-compatible client (any baseUrl)
│   │   ├── llm.service.ts        # Provider selection and routing
│   │   └── prompts.ts            # System prompts for element finding, decisions, extraction
│   ├── browser/
│   │   ├── browser.service.ts    # Playwright lifecycle, video recording, download routing
│   │   ├── page.service.ts       # Click, type, wait, extract, download helpers
│   │   ├── context.ts            # Simplified page state capture for LLM
│   │   └── element-resolver.ts   # Primary > fallback > AI selector cascade
│   ├── tools/
│   │   ├── tool.interface.ts     # External tool interface
│   │   ├── tool-executor.ts      # Generic subprocess runner
│   │   ├── smscli.adapter.ts     # SMS/OTP retrieval
│   │   └── vaultcli.adapter.ts   # Vault secret retrieval
│   ├── runner/
│   │   ├── automation-runner.ts  # Top-level orchestrator
│   │   ├── step-executor.ts      # Per-step dispatch and action handlers
│   │   ├── run-context.ts        # Runtime state (variables, outputs, artifacts)
│   │   ├── paths.ts              # Effective path resolver (4-level precedence)
│   │   ├── bootstrap.ts          # First-run directory setup and example seeding
│   │   └── logger.ts             # pino logger factory
│   └── tui/
│       ├── main-tui.ts           # Top-level interactive menu
│       ├── provider-tui.ts       # Provider management menu
│       ├── settings-tui.ts       # Settings management menu
│       ├── file-picker.ts        # Reusable JSON file picker
│       ├── helpers.ts            # Shared TUI utilities (masking, display names)
│       └── flows/                # Individual guided flow screens
│           ├── run.ts
│           ├── validate.ts
│           ├── configure.ts      # Configure a provider
│           ├── set-active.ts     # Switch active provider
│           ├── list.ts           # List providers
│           ├── remove.ts         # Remove a provider
│           ├── reset.ts          # Reset all provider config
│           ├── settings-paths.ts # Edit storage paths
│           └── settings-video.ts # Toggle video recording
└── tests/
    └── schema.test.ts            # Vitest schema validation tests
```

---

## Troubleshooting

**File picker shows no automations**
The default automations directory is `~/.portalflow/automations`. After a fresh install, the installer seeds this directory with `demo-search.json` and `phone-bill.json`. If the directory is empty, run `portalflow run` and choose "Enter path manually..." to locate your file, or copy automation JSON files into `~/.portalflow/automations/`.

**"No LLM provider configured"**
Run `portalflow provider` to launch the interactive setup, or see `portalflow provider --help` for non-interactive configuration options.

**"browserType.launch: Executable doesn't exist"**
The Playwright Chromium binary is missing. Run:
```bash
cd tools/cli && npx playwright install chromium
```

**"portalflow: command not found" after install**
Ensure `/usr/local/bin` is in your `PATH`:
```bash
export PATH="/usr/local/bin:$PATH"
```
Add the line to your shell profile (`~/.bashrc`, `~/.zshrc`) to make it permanent.

**Schema validation errors when running**
Run `portalflow validate <file>` first to see detailed, field-level error output before attempting execution.

**Element not found, LLM fallback fails**
Verify the `aiGuidance` field describes the target element precisely. Check the screenshot saved to the configured screenshots directory (default: `~/.portalflow/artifacts/screenshots`) — it captures the page state at the moment of failure and is the fastest way to diagnose what the browser actually rendered.

**Video file is empty or missing after a run**
Playwright writes the `.webm` file only when the browser context closes cleanly. If the process is killed mid-run (Ctrl+C, crash, or OS signal), the video may be empty or missing. To verify video recording is enabled, check `portalflow settings list` or the "Video recording" panel in the interactive settings TUI.

**"I want to start fresh"**
Run `portalflow provider` and pick "Reset all configurations" from the menu, or run `portalflow provider reset --yes` non-interactively. This deletes `~/.portalflow/config.json`.
