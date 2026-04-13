# PortalFlow Recorder (Chrome Extension)

Record browser workflows and export them as PortalFlow automation JSON.

## Prerequisites

- Node.js 18+
- npm
- A Chromium-based browser (Chrome 114+ required for the side panel API)

## Install and build

From the repo root:

```bash
npm install                         # installs all workspaces
npm -w tools/extension run build    # build the extension into tools/extension/dist/
```

## Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `tools/extension/dist/` directory
5. The PortalFlow Recorder icon appears in your toolbar

## Development

```bash
npm -w tools/extension run dev    # Vite dev server with HMR
npm -w tools/extension run typecheck
```

## Status

This is the scaffold. Recording, editing, export, LLM assist, and options-page
functionality land in subsequent phases.
