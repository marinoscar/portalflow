# PortalFlow CLI

PortalFlow CLI (`portalflow`) is the execution engine for PortalFlow browser automations. It loads a structured JSON automation definition, drives a real Chrome browser via Playwright, and delegates element-finding and decision-making to an LLM (Anthropic Claude or OpenAI) when CSS selectors fail. The result is reliable, maintainable automation that degrades gracefully when page markup changes.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Update](#update)
- [Uninstall](#uninstall)
- [Quick Start](#quick-start)
- [Interactive Modes](#interactive-modes)
- [Interactive Provider Setup](#interactive-provider-setup)
- [Commands](#commands)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Automation JSON Format](#automation-json-format)
  - [Top-Level Fields](#top-level-fields)
  - [Inputs](#inputs)
  - [Steps](#steps)
  - [Step Types](#step-types)
  - [Step Options](#step-options)
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
6. Creates symlinks at `/usr/local/bin/portalflow` and `/usr/local/bin/portalflow-update` (requires `sudo`)

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

To also remove provider credentials:

```bash
rm -rf ~/.portalflow
```

---

## Quick Start

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
portalflow validate tools/cli/examples/demo-search.json
```

**3. Run the demo automation**

```bash
portalflow run tools/cli/examples/demo-search.json
```

**4. Run headless**

```bash
portalflow run tools/cli/examples/demo-search.json --headless
```

---

## Interactive Modes

Every PortalFlow command has a guided TUI mode. Run the command without its required argument and a wizard walks you through the options.

| Command | TUI trigger | What it does |
|---|---|---|
| `portalflow` | bare (no args) | Top-level menu: run / validate / manage providers / exit |
| `portalflow run` | no file argument | File picker (discovers `./*.json`, `./examples/*.json`, `./automations/*.json`), validates before running, shows an automation preview, asks about headless mode, and confirms before launching |
| `portalflow validate` | no file argument | File picker, then full schema validation with a formatted summary on success or error details on failure |
| `portalflow provider` | no subcommand | Provider management menu (documented below) |

You can always supply the required argument to skip the TUI and run non-interactively — scripts and CI pipelines are unaffected.

The file picker automatically discovers `.json` files in `./`, `./examples/`, `./automations/`, and `./tools/cli/examples/`, sorted by most recently modified. A "Enter path manually..." option is always available if your file lives elsewhere.

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

## Commands

### `portalflow run [file]`

Execute an automation from a JSON file. If `file` is omitted, launches the interactive run TUI (file picker + preview + confirmation). See [Interactive Modes](#interactive-modes).

```bash
portalflow run automation.json
portalflow run automation.json --headless
portalflow run   # interactive mode
```

| Option | Description |
|---|---|
| `--headless` | Run Chrome in headless mode (default: headed) |

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

Provider configuration is stored at `~/.portalflow/config.json`:

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
  }
}
```

The `kind` field controls which API client is used: `anthropic` uses the native Anthropic Messages API; `openai-compatible` uses the OpenAI client with a custom `baseUrl`. Existing configs without a `kind` field are automatically upgraded on first use: `anthropic` maps to kind `anthropic`, everything else maps to `openai-compatible`.

---

## Environment Variables

Environment variables override the values in `~/.portalflow/config.json` at runtime.

| Variable | Description |
|---|---|
| `PORTALFLOW_LLM_PROVIDER` | Override the active provider (must match a configured provider name) |
| `ANTHROPIC_API_KEY` | Fallback API key for Anthropic when no config file entry exists |
| `OPENAI_API_KEY` | Fallback API key for OpenAI when no config file entry exists |
| `LOG_LEVEL` | Pino log level: `trace`, `debug`, `info`, `warn`, `error` (default: `info`) |
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
| `condition` | `check`, `value` | Assert `element_exists`, `url_matches`, `text_contains`, or `variable_equals` |
| `download` | `trigger`, `expectedFilename?` | Trigger and capture a file download via `click` or `navigation` |

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

### Settings

```json
{
  "settings": {
    "headless": false,
    "viewport": { "width": 1280, "height": 800 },
    "defaultTimeout": 30000,
    "screenshotOnFailure": true,
    "artifactDir": "./artifacts"
  }
}
```

The `--headless` CLI flag overrides `settings.headless` in the JSON.

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

Use `{{inputName}}` template syntax inside `action.url` and other string fields to substitute input values at runtime.

See `examples/demo-search.json` for a complete working example, and `examples/phone-bill.json` for a template covering portal login, OTP via smscli, and file download.

---

## How Execution Works

When `portalflow run` is called, the `AutomationRunner`:

1. Parses and validates the JSON against the Zod schema — aborts immediately on schema errors.
2. Resolves all inputs: reads environment variables, calls `vaultcli` for secrets, applies literals.
3. Initializes the configured LLM provider (Anthropic or OpenAI).
4. Launches Chrome via Playwright (headed by default).
5. Executes each step in order via `StepExecutor`:
   - Tries the primary selector, then each fallback in order.
   - If all selectors fail and `aiGuidance` is set, calls the LLM to locate the element from page context.
   - Runs the action.
   - Runs post-step validation if defined.
   - Applies the `onFailure` policy (`abort`, `retry`, or `skip`) on error.
6. Takes a screenshot on abort when `screenshotOnFailure: true`.
7. Writes outputs and artifacts to `artifactDir`.
8. Returns a structured run result.

The design is a hybrid model: the JSON provides deterministic process guidance while the LLM absorbs selector variability. This avoids expensive, repeated website discovery on every run and keeps automations resilient to minor UI changes without modifying the JSON.

---

## External Tool Integration

### smscli (OTP retrieval)

`smscli` waits for and extracts OTP codes during MFA flows. Use it in a `tool_call` step. The captured value is stored in the run context under `outputName` and referenced by later steps via `inputRef`.

```json
{
  "id": "step-otp",
  "name": "Retrieve OTP from SMS",
  "type": "tool_call",
  "action": {
    "tool": "smscli",
    "command": "get-otp",
    "args": { "sender": "ExampleCarrier", "pattern": "\\d{6}" },
    "outputName": "otpCode"
  },
  "onFailure": "abort",
  "maxRetries": 2,
  "timeout": 60000
}
```

A subsequent interact step can then use `"inputRef": "otpCode"` to type the code into the OTP field.

See the [smscli README](https://github.com/marinoscar/sink/blob/main/tools/smscli/README.md) for setup instructions.

### vaultcli (secrets)

`vaultcli` pulls credentials at runtime so that sensitive values are never embedded in automation JSON. Reference it as an input `source`:

```json
{
  "name": "password",
  "type": "secret",
  "required": true,
  "source": "vaultcli",
  "value": "carrier/phone-account",
  "description": "Account password from vault"
}
```

The resolved secret is available as `password` throughout the automation.

See the [vaultcli README](https://github.com/marinoscar/vault/blob/main/tools/vaultcli/README.md) for setup instructions.

---

## Development

```bash
cd tools/cli
npm install
npm run build    # Compile TypeScript to dist/
npm run dev      # Run from source via tsx (no build step)
npm test         # Run Vitest schema tests
```

---

## Project Structure

```
tools/cli/
├── install.sh              # Installer / updater / uninstaller
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── examples/
│   ├── demo-search.json    # Working DuckDuckGo search demo
│   └── phone-bill.json     # Template: portal login + OTP + download
├── src/
│   ├── index.ts            # CLI entry point (commander)
│   ├── schema/             # Zod schema for automation JSON
│   ├── config/             # ~/.portalflow/config.json management
│   ├── llm/                # Anthropic + OpenAI providers and prompts
│   ├── browser/            # Playwright lifecycle, page service, element resolver
│   ├── tools/              # smscli + vaultcli subprocess adapters
│   └── runner/             # AutomationRunner, StepExecutor, RunContext
└── tests/
    └── schema.test.ts
```

---

## Troubleshooting

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
Verify the `aiGuidance` field describes the target element precisely. Check the screenshot saved to `artifactDir` — it captures the page state at the moment of failure and is the fastest way to diagnose what the browser actually rendered.

**"I want to start fresh"**
Run `portalflow provider` and pick "Reset all configurations" from the menu, or run `portalflow provider reset --yes` non-interactively. This deletes `~/.portalflow/config.json`.
