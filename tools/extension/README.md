# PortalFlow Recorder — Chrome Extension

A Manifest V3 Chrome extension that records browser workflows, lets you edit them in a side panel with optional LLM assist, and exports them as JSON files that the PortalFlow CLI can run unmodified.

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [How Recording Works](#how-recording-works)
- [Editing in the Side Panel](#editing-in-the-side-panel)
- [LLM Assist Features](#llm-assist-features)
- [Credential and OTP Integration](#credential-and-otp-integration)
- [Configuration](#configuration)
- [Relationship to the CLI](#relationship-to-the-cli)
- [Known Limitations](#known-limitations)
- [Development](#development)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Security Note](#security-note)

---

## Features

- Records click, type, select, check, uncheck, and submit events as you navigate
- Computes robust multi-strategy selectors for each element (seven fallback strategies)
- De-bounces typing into single consolidated type events
- Auto-tracks navigation via `chrome.webNavigation.onCommitted`
- Detects password fields and automatically converts them to `vaultcli` credential references
- Detects OTP fields and automatically inserts `smscli get-otp` tool call steps before them
- Manual banner buttons for credential/OTP conversion when auto-detection misses a field
- Side panel editor for metadata, inputs, and step-by-step review before export
- LLM assist for selector improvement, AI guidance generation, and metadata auto-fill
- Export validates against `AutomationSchema` and prompts a Save As dialog
- Options page supports nine built-in LLM provider presets plus any custom OpenAI-compatible endpoint

---

## Requirements

- Node.js 18 or later
- npm 9 or later (comes with Node 18)
- Chrome 114 or later (required for the side panel API)

---

## Installation

### Option A: One-liner (recommended for personal use)

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/extension/install.sh | bash
```

The script clones the repo to `~/.portalflow-recorder`, installs dependencies, builds the extension into a stable path, and prints the exact Chrome "Load unpacked" instructions with the directory path. It also installs a `portalflow-recorder-update` command into `~/.local/bin` so you can update with a single command.

Re-run the same one-liner (or `portalflow-recorder-update`) to pull the latest code and rebuild. After an update, just click the reload icon on the extension card in `chrome://extensions` — the dist path stays the same.

To uninstall:

```bash
curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/extension/install.sh | bash -s -- --uninstall
```

Override the install location by setting `PORTALFLOW_EXTENSION_DIR` before running the script.

### Option B: Build from source manually

From the repository root:

```bash
npm install                          # installs all workspace dependencies
npm -w tools/extension run build     # builds into tools/extension/dist/
```

### Option C: Package for distribution

```bash
npm -w tools/extension run package   # produces tools/extension/portalflow-extension.zip
```

### Load the extension in Chrome (all options)

Regardless of which install method you use, Chrome requires a one-time manual step to load an unpacked extension:

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `dist/` directory printed by the installer (or `tools/extension/dist/` for a local build)
5. The PortalFlow Recorder icon appears in the Chrome toolbar

After an update, click the reload icon on the extension card in `chrome://extensions` — no need to Load unpacked again.

---

## Quick Start

### Step 1 — Configure an LLM provider (optional but recommended)

LLM features are optional. If you want them, configure a provider before recording.

**Option A — via the extension options page:**

1. Right-click the PortalFlow toolbar icon and choose **Options**, or navigate to `chrome://extensions` and click the extension's **Details > Extension options**
2. Select a preset from the dropdown (for example, Anthropic Claude or OpenAI)
3. Enter your API key and confirm or adjust the model name
4. Click **Add provider**, then set it as the active provider using the radio button in the provider list

**Option B — via the PortalFlow CLI (if installed):**

```bash
portalflow provider add --name anthropic --key sk-ant-...
portalflow provider set-active anthropic
```

### Step 2 — Open the side panel

Click the PortalFlow toolbar icon. The side panel opens on the right side of the browser window.

### Step 3 — Record a workflow

1. Click **Start recording** in the side panel
2. Navigate to the website you want to automate
3. Perform the workflow: click buttons, fill forms, submit pages
4. Click **Stop recording** when done

Events appear in the side panel as you act. Password and OTP fields are flagged automatically.

### Step 4 — Review and edit

In the side panel:

- Fill in the automation **name**, **goal**, and **description** (or use **Auto-fill with LLM**)
- Review each step — expand a step row to edit selectors, add AI guidance, adjust timeouts, or change the failure strategy
- Reorder steps using the up/down buttons on each row
- Check that any credential inputs have `source: vaultcli` and the correct vault key path

### Step 5 — Export and run

1. Click **Export** in the side panel
2. Chrome opens a Save As dialog — save the file to `~/.portalflow/automations/` or any directory you prefer
3. Run the automation with the CLI:

```bash
portalflow run ~/.portalflow/automations/my-workflow.json
```

---

## How Recording Works

### Event capture

The content script (`src/content/recorder.ts`) listens to DOM events on every page load and sends them to the service worker, which stores them in `chrome.storage.local` under the key `portalflow:session`.

Captured event types:

| Event | What triggers it |
|-------|-----------------|
| `click` | Mouse click on any element |
| `type` | Keyboard input — de-bounced at 1 second idle, collapsed into one event per field |
| `select` | Change on a `<select>` element |
| `check` / `uncheck` | Checkbox or radio toggle |
| `submit` | Form submission |
| `navigate` | Page navigation via `chrome.webNavigation.onCommitted` |

### Selector cascade

For each captured element, the recorder computes a `{ primary, fallbacks[] }` selector using seven strategies in priority order:

1. `data-testid` attribute
2. `id` attribute
3. `name` attribute
4. `aria-label` attribute
5. ARIA role combined with visible text content
6. Short CSS path (closest unique ancestor + element)
7. Tag name combined with class list

The most stable strategy that uniquely identifies the element is chosen as `primary`. The remaining strategies that also match are stored as `fallbacks`, giving the runtime multiple options if the page structure changes.

### Password detection

`credential-detector.ts` flags an input if any of the following is true:

- `type="password"`
- `autocomplete` attribute contains common credential hints (current-password, new-password, etc.)
- `name`, `id`, or `aria-label` matches patterns like `pass`, `pwd`, `secret`, or `credential`

Password field values are **never stored** in the event stream. The recorder blanks the value immediately and marks the event for vaultcli conversion.

### OTP detection

`otp-detector.ts` flags an input if any of the following is true:

- `autocomplete="one-time-code"`
- Numeric `inputmode` with a `maxlength` between 4 and 8
- An associated `<label>` whose text matches patterns like `OTP`, `verification code`, `2FA`, or `one-time`

OTP field values are **never stored**. The event is marked for smscli insertion.

---

## Editing in the Side Panel

The side panel (`src/sidepanel/App.tsx`) has four sections:

### Recording controls

Start, Stop, Clear, and Reset buttons. **Clear** removes all recorded events. **Reset to recording** keeps the existing steps but re-enters record mode so you can append more.

### Metadata form

| Field | Description |
|-------|-------------|
| Name | Short identifier for the automation (used in CLI output) |
| Goal | One sentence describing what the automation achieves |
| Description | Optional longer explanation |
| Version | Semantic version string, for example `1.0.0` |

The **Auto-fill with LLM** button sends the current step list to the configured LLM provider and fills all four fields from the response.

### Inputs list

Declared inputs are the parameters an automation expects at runtime (credentials, arguments, environment values). Each input has:

- **Type** — the expected data type (string, secret, etc.)
- **Source** — where the value comes from at runtime: `literal`, `env`, `vaultcli`, or `cli_arg`
- **Value** — the literal value, environment variable name, vault key path, or CLI argument name

Password and OTP conversions automatically add inputs here. You can also add inputs manually.

### Steps list

Each step row shows its index, type, and primary selector. Expanding a row reveals:

- **Action editor** — fields specific to the step type:
  - `navigate` — URL field
  - `interact` — action dropdown (click, type, select, check, uncheck, submit) and value field
  - `wait` — condition selector (network_idle, selector_visible, selector_gone, delay)
  - `tool_call` — tool name and arguments
- **Selector editor** — primary selector text field plus an **Improve with LLM** button
- **AI guidance** — a free-text hint for the runtime LLM fallback, with a **Generate with LLM** button
- **Advanced options** — `onFailure` strategy (stop, continue, retry), `maxRetries`, and `timeout` in milliseconds

Steps can be reordered using the up and down buttons on each row.

### Export

The **Export** button validates the full automation object against `AutomationSchema` (the shared Zod schema from `@portalflow/schema`). If validation passes, Chrome triggers a Save As dialog. If validation fails, errors are displayed inline so you can fix them before retrying.

---

## LLM Assist Features

All LLM calls are routed through the service worker because content scripts and the side panel cannot make cross-origin fetch requests directly. The active provider is read from `chrome.storage.local` before each call.

- **Improve selector** — sends the current selector and a description of the step to the LLM and returns a more robust or readable selector string; useful when the recorded CSS path is brittle
- **Generate AI guidance** — produces a single natural-language sentence describing what the step does, stored in `aiGuidance` on the step; the CLI runtime uses this as context when a selector fails and the LLM needs to locate the element by description
- **Auto-fill metadata** — derives a name, goal, description, and version from the full step list; reduces the manual work of documenting each automation after recording

LLM buttons are disabled when no active provider is configured. Configure one via the options page before using these features.

---

## Credential and OTP Integration

### Automatic conversion (during recording)

The converter (`src/converter/events-to-automation.ts`) processes the raw event stream when you stop recording:

**Password fields** are converted to a vaultcli input reference:

1. A new `Input` entry is added with `source: 'vaultcli'` and `value: 'CHANGE_ME/secret-key'`
2. The `type` step is rewritten to use `inputRef` pointing to that input
3. You must replace `CHANGE_ME/secret-key` with the actual vault key path before running

**OTP fields** trigger smscli insertion:

1. A `tool_call` step is inserted immediately before the type step, calling `smscli get-otp`
2. The `type` step is rewritten to use `inputRef: 'otpCode'`
3. At runtime, the tool call retrieves the OTP and stores it in the `otpCode` variable

**Submit button clicks** automatically receive a `wait` step with `condition: 'network_idle'` inserted immediately after them, preventing the next step from running before the page response arrives.

**Navigate events** become dedicated `navigate` steps rather than being embedded in other step types.

### Manual conversion (when auto-detection misses)

If the recorder did not auto-detect a password or OTP field — for example, because the site uses unusual markup — each `interact` step of type `type` shows two banner buttons in the editor:

- **Convert to vaultcli credential** — opens a modal where you name the input and enter the vault key path, then rewrites the step to use `inputRef`
- **Insert smscli OTP step before this** — opens a modal to confirm, then inserts the tool call step and rewrites the type step

Both modals perform the same transformation as the automatic converter. Use them any time you want to replace a literal value with a secure runtime reference.

---

## Configuration

All configuration is stored in `chrome.storage.local`. Nothing is sent to any server by the extension itself.

| Storage key | Content |
|-------------|---------|
| `portalflow:session` | Raw recorded event stream for the current session |
| `portalflow:providers` | Array of configured LLM provider objects |
| `portalflow:active-provider` | ID string of the active provider |

To reset configuration, open the options page and remove all providers, or clear extension storage via Chrome DevTools:

1. Open `chrome://extensions`
2. Click **Details** on the PortalFlow Recorder entry
3. Open **background page** (service worker) in DevTools
4. In the Console: `chrome.storage.local.clear(() => console.log('cleared'))`

---

## Relationship to the CLI

The extension **authors** automation JSON. The CLI **executes** it.

When you export from the side panel, the output is a complete `Automation` object that conforms to the shared schema in `@portalflow/schema`. The CLI reads that same schema to validate and execute each step. Because both tools share the schema package, any automation the extension produces is accepted by the CLI without any transformation.

A typical workflow:

```
Record in browser  →  Edit in side panel  →  Export JSON
    (extension)           (extension)      (extension + schema)

portalflow run automation.json
          (CLI + schema)
```

The schema package is a workspace dependency: `@portalflow/schema` is declared in the extension's `package.json` with `"*"` as the version specifier, resolved by the npm workspace to `tools/schema`.

---

## Known Limitations

- **Single top frame only** — the recorder captures events in the main page frame. Interactions inside iframes are not recorded.
- **No multi-tab recording** — recording covers only the tab that was active when you clicked Start. Events on other tabs are ignored.
- **No direct filesystem writes** — Chrome extensions cannot write files to arbitrary paths. Export always uses the browser's Save As dialog and goes to your downloads directory or wherever Chrome is configured to save.
- **Navigation within SPAs** — client-side routing (pushState / replaceState) is tracked via `webNavigation.onCommitted`, but some frameworks update the URL without triggering a navigation event. Review the step list after recording SPA workflows.
- **Page reload clears the active flag** — if the content script loses its connection to the service worker (for example, after an extension reload), recording stops silently. Click Stop and then Start again to resume.

---

## Development

```bash
# Start Vite dev server with hot module replacement
npm -w tools/extension run dev

# Type-check without emitting output
npm -w tools/extension run typecheck

# Production build into tools/extension/dist/
npm -w tools/extension run build

# Build and zip into tools/extension/portalflow-extension.zip
npm -w tools/extension run package
```

After running `dev` or `build`, reload the extension in Chrome (`chrome://extensions` > reload button) to pick up changes. With `@crxjs/vite-plugin`, changes to the side panel and options page React code hot-reload without a full extension reload during development.

---

## Project Structure

```
tools/extension/
  src/
    background/         # Service worker: message routing, LLM calls, download trigger
    content/            # Content scripts injected into every page
      detectors/        # credential-detector.ts and otp-detector.ts
      recorder.ts       # DOM event capture and selector computation
      selector-builder.ts  # Seven-strategy selector cascade
    converter/          # Transform raw events into Automation objects
      events-to-automation.ts
      automation-to-json.ts
    llm/                # LLM provider abstraction and fetch clients
      llm.service.ts    # Routes requests to the active provider
      anthropic.provider.ts
      openai.provider.ts
      prompts.ts        # Prompt templates for each LLM feature
      provider.interface.ts
    options/            # Options page (provider management)
      App.tsx
    shared/             # Types and constants shared across contexts
      messaging.ts      # Chrome runtime message type definitions
      provider-kinds.ts # PROVIDER_PRESETS array with nine built-in entries
      types.ts
    sidepanel/          # Side panel UI (recording, editing, export)
      App.tsx           # Root component and state orchestration
      components/       # MetadataForm, InputsList, StepRow, ExportBar, modals
      hooks/useLlm.ts   # Hook for dispatching LLM requests via the service worker
      state/            # Automation state management
    storage/            # Typed wrappers for chrome.storage.local
      config.storage.ts
      session.storage.ts
  dist/                 # Build output (git-ignored) — load this in Chrome
```

---

## Troubleshooting

**The toolbar icon does not appear after loading**

- Confirm Chrome has at least version 114 (`chrome://settings/help`)
- Open `chrome://extensions` and verify Developer mode is on
- Check the extension entry for any error badges — click **Details** to see error messages
- Click the reload icon on the extension card, then check your toolbar again (you may need to pin it from the Extensions menu)

**The side panel will not open**

- The side panel API requires Chrome 114 or later. Earlier versions and most non-Chrome Chromium builds do not support it. Check your Chrome version at `chrome://settings/help`

**LLM buttons are greyed out**

- No active provider is configured. Open the options page (right-click the toolbar icon > Options), add a provider with a valid API key, and mark it as active using the radio button

**Exported JSON fails validation when run with the CLI**

- Run `portalflow validate path/to/automation.json` to see the exact Zod validation errors
- Common causes:
  - A `vaultcli` input still has the placeholder value `CHANGE_ME/secret-key` — replace it with the actual vault key path
  - A step references an `inputRef` that does not exist in the inputs list — check that the input was not accidentally deleted
  - A `wait` step has `condition: 'delay'` but is missing the `duration` field

**Recording stops unexpectedly mid-workflow**

- Navigating to a new page unloads the content script. Recording automatically resumes on the new page via the background service worker re-injecting the script. If it does not resume, click Stop and Start again
- Extension reloads (during `dev` mode builds) disconnect content scripts. After a hot reload, refresh the target page before continuing to record

---

## Security Note

API keys configured in the options page are stored as plaintext in `chrome.storage.local`. This is intentional: the extension is a single-user, local-first developer tool, and `chrome.storage.local` is sandboxed to the extension's origin and inaccessible to websites.

Do not use the extension on a shared Chrome profile or a machine where other users have access to your Chrome data directory. If you need to rotate a key, open the options page, remove the provider, and add it again with the new key.

No recorded session data, automation content, or API keys are transmitted to any PortalFlow server. LLM requests go directly from the extension's service worker to the configured provider's API endpoint.
