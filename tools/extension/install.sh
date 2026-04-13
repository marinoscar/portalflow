#!/usr/bin/env bash
# =============================================================================
#
#  portalflow extension installer (personal use)
#
#  Install:    curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/extension/install.sh | bash
#  Update:     portalflow-recorder-update
#  Uninstall:  curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/extension/install.sh | bash -s -- --uninstall
#
#  Or run locally:
#    ./install.sh
#    ./install.sh --uninstall
#
#  The script is fully idempotent — run it again to update.
#
#  Note: Chrome extensions cannot be fully installed via a shell script the
#  way the CLI can. After the first successful build you'll need to:
#    1. Open chrome://extensions
#    2. Enable "Developer mode" (top right)
#    3. Click "Load unpacked" and select the dist directory printed below
#  On subsequent updates, click the reload icon on the extension card.
#
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_URL="https://github.com/marinoscar/portalflow.git"
INSTALL_DIR="${PORTALFLOW_EXTENSION_DIR:-${HOME}/.portalflow-recorder}"
USER_BIN_DIR="${HOME}/.local/bin"
UPDATE_LINK="${USER_BIN_DIR}/portalflow-recorder-update"
INSTALLED_MARKER_REL=".portalflow-installed"
MIN_NODE_MAJOR=18
BRANCH="main"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------

if [ -t 1 ] 2>/dev/null; then
  RED='\033[0;31m'    GREEN='\033[0;32m'  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'   BOLD='\033[1m'      DIM='\033[2m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' BOLD='' DIM='' RESET=''
fi

info()    { echo -e "  ${CYAN}●${RESET}  $*"; }
success() { echo -e "  ${GREEN}✓${RESET}  $*"; }
warn()    { echo -e "  ${YELLOW}!${RESET}  $*" >&2; }
fail()    { echo -e "  ${RED}✗${RESET}  $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}$*${RESET}"; }

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

if [[ "${1:-}" == "--uninstall" ]]; then
  echo ""
  echo -e "${BOLD}portalflow extension — Uninstaller${RESET}"
  echo ""

  if [ -L "${UPDATE_LINK}" ] || [ -f "${UPDATE_LINK}" ]; then
    rm -f "${UPDATE_LINK}"
    success "Removed ${UPDATE_LINK}"
  fi

  if [ -d "${INSTALL_DIR}" ]; then
    echo ""
    info "Installation directory at ${INSTALL_DIR} was kept."
    info "To remove it:  rm -rf ${INSTALL_DIR}"
  fi

  echo ""
  echo -e "${BOLD}  Remove from Chrome:${RESET}"
  echo "    1. Open chrome://extensions"
  echo "    2. Find \"PortalFlow Recorder\" and click Remove"
  echo ""
  exit 0
fi

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

echo ""
echo -e "${BOLD}  ┌──────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}  │     PortalFlow Recorder installer         │${RESET}"
echo -e "${BOLD}  └──────────────────────────────────────────┘${RESET}"
echo ""

# ---------------------------------------------------------------------------
# Step 1 — Prerequisites
# ---------------------------------------------------------------------------

step "[1/5] Checking prerequisites"

# git
if ! command -v git &>/dev/null; then
  fail "git is not installed. Install it first:  sudo apt install git  (or equivalent)"
fi
success "git $(git --version | awk '{print $3}')"

# Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node.js ${MIN_NODE_MAJOR}+:\n       https://nodejs.org  or  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
fi

NODE_VERSION="$(node -v | sed 's/^v//')"
NODE_MAJOR="$(echo "${NODE_VERSION}" | cut -d. -f1)"

if [ "${NODE_MAJOR}" -lt "${MIN_NODE_MAJOR}" ]; then
  fail "Node.js ${NODE_VERSION} found, but ${MIN_NODE_MAJOR}+ is required."
fi
success "Node.js ${NODE_VERSION}"

# npm
if ! command -v npm &>/dev/null; then
  fail "npm is not installed. It should come with Node.js."
fi
success "npm $(npm -v)"

# Warn if Chrome/Chromium not detected (non-fatal — the user might have a different Chromium build)
if command -v google-chrome &>/dev/null; then
  success "google-chrome $(google-chrome --version | awk '{print $NF}')"
elif command -v chromium &>/dev/null; then
  success "chromium $(chromium --version | awk '{print $NF}')"
elif command -v chromium-browser &>/dev/null; then
  success "chromium-browser $(chromium-browser --version | awk '{print $NF}')"
else
  warn "Could not detect Chrome or Chromium on PATH — you'll still need it installed to load the extension."
fi

# ---------------------------------------------------------------------------
# Step 2 — Get the source code
# ---------------------------------------------------------------------------

step "[2/5] Getting source code"

# Detect if running from inside the repo (copy of tools/extension/install.sh)
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" != "bash" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "${SCRIPT_DIR}" ] && [ -f "${SCRIPT_DIR}/package.json" ] && [ -f "${SCRIPT_DIR}/manifest.json" ]; then
  # Running from inside the repo — use the current checkout
  EXT_DIR="${SCRIPT_DIR}"
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  info "Running from local repo: ${REPO_ROOT}"

  if [ -d "${REPO_ROOT}/.git" ]; then
    info "Pulling latest changes..."
    (cd "${REPO_ROOT}" && git pull origin "${BRANCH}" 2>&1 | tail -3) || warn "git pull failed — continuing with current code"
    success "Source up to date"
  fi
else
  # Running via curl pipe — clone (or update) to INSTALL_DIR
  REPO_ROOT="${INSTALL_DIR}"
  EXT_DIR="${INSTALL_DIR}/tools/extension"

  if [ -d "${REPO_ROOT}/.git" ]; then
    info "Existing installation found at ${REPO_ROOT}"
    info "Pulling latest changes..."
    (cd "${REPO_ROOT}" && git fetch origin "${BRANCH}" && git reset --hard "origin/${BRANCH}" 2>&1 | tail -3)
    success "Updated to latest"
  else
    info "Cloning repository to ${REPO_ROOT}..."
    git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${REPO_ROOT}" 2>&1 | tail -3
    success "Cloned"
  fi
fi

# Sanity checks
if [ ! -f "${EXT_DIR}/package.json" ]; then
  fail "package.json not found at ${EXT_DIR}. Installation may be corrupt."
fi
if [ ! -f "${EXT_DIR}/manifest.json" ]; then
  fail "manifest.json not found at ${EXT_DIR}. Installation may be corrupt."
fi

# ---------------------------------------------------------------------------
# Helper — run a command, stream to tmpfile, print a tail on success or
# the FULL output on failure so the user can diagnose the root cause.
# ---------------------------------------------------------------------------

run_step() {
  local label="$1"
  shift
  local tmpfile
  tmpfile="$(mktemp)"
  if "$@" >"${tmpfile}" 2>&1; then
    tail -5 "${tmpfile}" || true
    rm -f "${tmpfile}"
    return 0
  else
    local exit_code=$?
    echo "" >&2
    echo -e "  ${RED}✗${RESET}  ${label} failed (exit ${exit_code})" >&2
    echo -e "  ${DIM}Full output:${RESET}" >&2
    echo "" >&2
    sed 's/^/    /' "${tmpfile}" >&2
    echo "" >&2
    rm -f "${tmpfile}"
    exit "${exit_code}"
  fi
}

# ---------------------------------------------------------------------------
# Step 3 — Install dependencies
# ---------------------------------------------------------------------------

step "[3/5] Installing dependencies"

if [ -f "${REPO_ROOT}/package.json" ] && grep -q '"workspaces"' "${REPO_ROOT}/package.json" 2>/dev/null; then
  info "Monorepo detected — installing workspace dependencies..."
  run_step "npm install" bash -c "cd '${REPO_ROOT}' && npm install --workspace=tools/extension"
else
  run_step "npm install" bash -c "cd '${EXT_DIR}' && npm install"
fi
success "Dependencies installed"

# ---------------------------------------------------------------------------
# Step 4 — Build
# ---------------------------------------------------------------------------

step "[4/5] Building extension"

run_step "npm run build" bash -c "cd '${EXT_DIR}' && npm run build"

DIST_DIR="${EXT_DIR}/dist"
if [ ! -f "${DIST_DIR}/manifest.json" ]; then
  fail "dist/manifest.json not found after build. Build may have failed."
fi
success "Build complete"

# Try to read the extension version from the compiled manifest
EXT_VERSION="$(node -e "try { console.log(require('${DIST_DIR}/manifest.json').version); } catch { console.log('unknown'); }" 2>/dev/null || echo "unknown")"
success "Extension version: ${EXT_VERSION}"

# ---------------------------------------------------------------------------
# Step 5 — Install the update helper and finalize
# ---------------------------------------------------------------------------

step "[5/5] Installing update helper"

# Create ~/.local/bin if needed (user-local, no sudo)
mkdir -p "${USER_BIN_DIR}"

# Write an updater script inside the install dir that just re-runs this installer
UPDATER_SCRIPT="${EXT_DIR}/.portalflow-recorder-update.sh"
cat > "${UPDATER_SCRIPT}" << 'UPDATER'
#!/usr/bin/env bash
# Quick updater — pulls latest and rebuilds the extension.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/install.sh"
UPDATER
chmod +x "${UPDATER_SCRIPT}"

# Symlink into ~/.local/bin (no sudo required)
if [ -L "${UPDATE_LINK}" ] || [ -f "${UPDATE_LINK}" ]; then
  rm -f "${UPDATE_LINK}"
fi
ln -s "${UPDATER_SCRIPT}" "${UPDATE_LINK}"
success "portalflow-recorder-update installed at ${UPDATE_LINK}"

if ! echo "${PATH}" | tr ':' '\n' | grep -q "^${USER_BIN_DIR}\$"; then
  warn "${USER_BIN_DIR} is not on your PATH — add this to your shell profile:"
  echo '    export PATH="$HOME/.local/bin:$PATH"'
fi

# Mark this install as complete (used to detect first install vs update)
INSTALLED_MARKER="${EXT_DIR}/${INSTALLED_MARKER_REL}"
FIRST_INSTALL="false"
if [ ! -f "${INSTALLED_MARKER}" ]; then
  FIRST_INSTALL="true"
  touch "${INSTALLED_MARKER}"
fi

# ---------------------------------------------------------------------------
# Done — print next steps
# ---------------------------------------------------------------------------

echo ""
echo -e "${BOLD}  ┌───────────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}  │  ${GREEN}✓${RESET}${BOLD}  Build complete — follow the next step below  │${RESET}"
echo -e "${BOLD}  └───────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "  ${BOLD}Build output:${RESET}"
echo "    ${DIST_DIR}"
echo ""

if [ "${FIRST_INSTALL}" = "true" ]; then
  echo -e "  ${BOLD}Load the extension into Chrome (one-time, per device):${RESET}"
  echo ""
  echo "    1. Open this URL in Chrome:"
  echo -e "       ${CYAN}chrome://extensions${RESET}"
  echo ""
  echo "    2. Toggle ${BOLD}Developer mode${RESET} (top-right of the page) ON"
  echo ""
  echo "    3. Click ${BOLD}Load unpacked${RESET} and select:"
  echo -e "       ${CYAN}${DIST_DIR}${RESET}"
  echo ""
  echo "    4. Click the PortalFlow Recorder icon in your toolbar to start recording"
  echo ""
else
  echo -e "  ${BOLD}Apply the update in Chrome:${RESET}"
  echo ""
  echo "    1. Open ${CYAN}chrome://extensions${RESET}"
  echo "    2. Find \"PortalFlow Recorder\" and click the reload (circular arrow) icon"
  echo ""
  echo "    The dist path has not changed, so no \"Load unpacked\" step is needed."
  echo ""
fi

# Attempt to copy the dist path to the system clipboard for convenience
if command -v xclip &>/dev/null; then
  echo -n "${DIST_DIR}" | xclip -selection clipboard 2>/dev/null && info "Dist path copied to clipboard (xclip)"
elif command -v xsel &>/dev/null; then
  echo -n "${DIST_DIR}" | xsel --clipboard --input 2>/dev/null && info "Dist path copied to clipboard (xsel)"
elif command -v pbcopy &>/dev/null; then
  echo -n "${DIST_DIR}" | pbcopy 2>/dev/null && info "Dist path copied to clipboard (pbcopy)"
elif command -v wl-copy &>/dev/null; then
  echo -n "${DIST_DIR}" | wl-copy 2>/dev/null && info "Dist path copied to clipboard (wl-copy)"
fi

echo ""
echo -e "  ${BOLD}Maintenance:${RESET}"
echo -e "    Update:     ${DIM}portalflow-recorder-update${RESET}"
echo -e "    Update:     ${DIM}curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/extension/install.sh | bash${RESET}"
echo -e "    Uninstall:  ${DIM}${EXT_DIR}/install.sh --uninstall${RESET}"
echo ""
