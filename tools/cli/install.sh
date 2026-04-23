#!/usr/bin/env bash
# =============================================================================
#
#  portalflow CLI + Chrome extension installer
#
#  Install:    curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/cli/install.sh | bash
#  Update:     portalflow-update   (alias created during install)
#  Uninstall:  curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/cli/install.sh | bash -s -- --uninstall
#
#  Or run locally:
#    ./install.sh
#    ./install.sh --uninstall
#
#  The script is fully idempotent — run it again to update.
#
#  This installer builds both the Chrome extension (tools/extension/) and the
#  portalflow CLI (tools/cli/) from source, in dependency order:
#    1. tools/schema  (shared schema package)
#    2. tools/extension  (Chrome extension — produces dist/)
#    3. tools/cli   (portalflow binary)
#
#  After the script completes you still need to do the one-time
#  "Load unpacked" step in Chrome:
#    1. Open chrome://extensions
#    2. Enable Developer mode (top-right toggle)
#    3. Click "Load unpacked" and select the dist/ path printed at the end
#  On subsequent updates, click the reload icon on the extension card.
#
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_URL="https://github.com/marinoscar/portalflow.git"
INSTALL_DIR="${PORTALFLOW_INSTALL_DIR:-${HOME}/.portalflow-cli}"
LINK_TARGET="/usr/local/bin/portalflow"
UPDATE_LINK="/usr/local/bin/portalflow-update"
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

if [ "${1:-}" = "--uninstall" ]; then
  echo ""
  echo -e "${BOLD}portalflow — Uninstaller${RESET}"
  echo ""

  for f in "${LINK_TARGET}" "${UPDATE_LINK}"; do
    if [ -L "$f" ] || [ -f "$f" ]; then
      sudo rm -f "$f"
      success "Removed $f"
    fi
  done

  if [ -d "${INSTALL_DIR}" ]; then
    echo ""
    info "Repository at ${INSTALL_DIR} was kept."
    info "To remove it:  rm -rf ${INSTALL_DIR}"
  fi

  echo ""
  info "To remove config and provider credentials:"
  echo "    rm -rf ~/.portalflow"
  echo ""
  echo -e "${BOLD}  Remove the extension from Chrome:${RESET}"
  echo "    1. Open chrome://extensions"
  echo "    2. Find \"PortalFlow\" and click Remove"
  echo ""
  exit 0
fi

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

echo ""
echo -e "${BOLD}  ┌──────────────────────────────────────┐${RESET}"
echo -e "${BOLD}  │      portalflow CLI installer         │${RESET}"
echo -e "${BOLD}  └──────────────────────────────────────┘${RESET}"
echo ""

# ---------------------------------------------------------------------------
# run_step — capture build output; tail on success, full log on failure
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
# Step 1 — Prerequisites
# ---------------------------------------------------------------------------

step "[1/8] Checking prerequisites"

# git
if ! command -v git &>/dev/null; then
  fail "git is not installed. Install it first:  sudo apt install git"
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

# Warn if Chrome/Chromium not detected (non-fatal)
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

step "[2/8] Getting source code"

# Detect if running from inside the repo or via curl pipe
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" != "bash" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

# Check if SCRIPT_DIR is inside a valid tools/cli folder
if [ -n "${SCRIPT_DIR}" ] && [ -f "${SCRIPT_DIR}/package.json" ] && [ -f "${SCRIPT_DIR}/src/index.ts" ]; then
  # Running from inside the repo (local install)
  CLI_DIR="${SCRIPT_DIR}"
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  info "Running from local repo: ${REPO_ROOT}"

  # Pull latest if this is a git repo
  if [ -d "${REPO_ROOT}/.git" ]; then
    info "Pulling latest changes..."
    (cd "${REPO_ROOT}" && git pull origin "${BRANCH}" 2>&1 | tail -3) || warn "git pull failed — continuing with current code"
    success "Source up to date"
  fi
else
  # Running via curl pipe or from outside the repo — clone to INSTALL_DIR
  REPO_ROOT="${INSTALL_DIR}"
  CLI_DIR="${INSTALL_DIR}/tools/cli"

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

EXT_DIR="${REPO_ROOT}/tools/extension"
SCHEMA_DIR="${REPO_ROOT}/tools/schema"

# Sanity checks
if [ ! -f "${CLI_DIR}/package.json" ]; then
  fail "package.json not found at ${CLI_DIR}. Installation may be corrupt."
fi

if [ ! -f "${CLI_DIR}/src/index.ts" ]; then
  fail "src/index.ts not found at ${CLI_DIR}. Installation may be corrupt."
fi

if [ ! -f "${EXT_DIR}/manifest.json" ]; then
  fail "tools/extension/manifest.json not found. Installation may be corrupt."
fi

# First-install detection (used later in the done block)
INSTALLED_MARKER="${CLI_DIR}/.portalflow-installed"
FIRST_INSTALL="false"
if [ ! -f "${INSTALLED_MARKER}" ]; then
  FIRST_INSTALL="true"
  touch "${INSTALLED_MARKER}"
fi

# ---------------------------------------------------------------------------
# Step 3 — Install dependencies
# ---------------------------------------------------------------------------

step "[3/8] Installing dependencies"

info "Monorepo install — this covers schema, extension, and cli..."
run_step "npm install" bash -c "cd '${REPO_ROOT}' && npm install"
success "Dependencies installed"

# ---------------------------------------------------------------------------
# Step 4 — Build schema
# ---------------------------------------------------------------------------

step "[4/8] Building schema"

info "Building @portalflow/schema (required by extension and cli)..."
run_step "schema build" bash -c "cd '${SCHEMA_DIR}' && npm run build"
success "Schema built"

# ---------------------------------------------------------------------------
# Step 5 — Build extension
# ---------------------------------------------------------------------------

step "[5/8] Building extension"

info "Building Chrome extension..."
run_step "extension build" bash -c "cd '${EXT_DIR}' && npm run build"

DIST_DIR="${EXT_DIR}/dist"
if [ ! -f "${DIST_DIR}/manifest.json" ]; then
  fail "dist/manifest.json not found after extension build. Build may have failed."
fi

EXT_VERSION="$(node -e "try { console.log(require('${DIST_DIR}/manifest.json').version); } catch(e) { console.log('unknown'); }" 2>/dev/null || echo "unknown")"
success "Extension built (v${EXT_VERSION})"

# ---------------------------------------------------------------------------
# Step 6 — Build cli
# ---------------------------------------------------------------------------

step "[6/8] Building cli"

info "Building portalflow..."
run_step "cli build" bash -c "cd '${CLI_DIR}' && npm run build"

BIN_SOURCE="${CLI_DIR}/dist/index.js"
if [ ! -f "${BIN_SOURCE}" ]; then
  fail "dist/index.js not found after cli build. Build may have failed."
fi

CLI2_VERSION="$(node "${BIN_SOURCE}" --version 2>/dev/null || echo "unknown")"
success "Version: ${CLI2_VERSION}"

# ---------------------------------------------------------------------------
# Step 7 — Seed default directories
# ---------------------------------------------------------------------------

step "[7/8] Seeding default directories"

PORTALFLOW_HOME="${HOME}/.portalflow"

# Create the standard layout (idempotent)
mkdir -p "${PORTALFLOW_HOME}/automations"
mkdir -p "${PORTALFLOW_HOME}/artifacts/screenshots"
mkdir -p "${PORTALFLOW_HOME}/artifacts/videos"
mkdir -p "${PORTALFLOW_HOME}/artifacts/downloads"

# Copy bundled examples into ~/.portalflow/automations if it has no .json files yet
if [ -d "${CLI_DIR}/examples" ]; then
  existing_json="$(find "${PORTALFLOW_HOME}/automations" -maxdepth 1 -name '*.json' 2>/dev/null | head -n 1)"
  if [ -z "${existing_json}" ]; then
    cp "${CLI_DIR}/examples/"*.json "${PORTALFLOW_HOME}/automations/" 2>/dev/null || true
    success "Seeded example automations to ${PORTALFLOW_HOME}/automations"
  else
    info "Automations directory already has files — leaving it alone"
  fi
fi

success "Default directories ready at ${PORTALFLOW_HOME}"

# ---------------------------------------------------------------------------
# Step 8 — Install globally
# ---------------------------------------------------------------------------

step "[8/8] Installing to ${LINK_TARGET}"

# Ensure the bin script is executable
chmod +x "${BIN_SOURCE}"

# Create or update the main symlink
if [ -L "${LINK_TARGET}" ]; then
  EXISTING="$(readlink -f "${LINK_TARGET}" 2>/dev/null || echo "")"
  if [ "${EXISTING}" = "$(readlink -f "${BIN_SOURCE}")" ]; then
    success "Symlink already correct"
  else
    sudo ln -sf "${BIN_SOURCE}" "${LINK_TARGET}"
    success "Symlink updated"
  fi
elif [ -f "${LINK_TARGET}" ]; then
  warn "${LINK_TARGET} exists as a regular file — replacing"
  sudo ln -sf "${BIN_SOURCE}" "${LINK_TARGET}"
  success "Symlink created"
else
  sudo ln -sf "${BIN_SOURCE}" "${LINK_TARGET}"
  success "Symlink created"
fi

# Create a convenience `portalflow-update` command
UPDATER_SCRIPT="${CLI_DIR}/.portalflow-update.sh"
cat > "${UPDATER_SCRIPT}" << 'UPDATER'
#!/usr/bin/env bash
# Quick updater — pulls latest and reinstalls portalflow + extension
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/install.sh"
UPDATER
chmod +x "${UPDATER_SCRIPT}"
sudo ln -sf "${UPDATER_SCRIPT}" "${UPDATE_LINK}" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------

echo ""
if command -v portalflow &>/dev/null; then
  INSTALLED_VERSION="$(portalflow --version 2>/dev/null || echo "unknown")"
  success "portalflow ${INSTALLED_VERSION} is installed and ready"
else
  warn "portalflow was installed at ${LINK_TARGET} but is not in your PATH"
  warn "Add this to your shell profile:"
  echo '    export PATH="/usr/local/bin:$PATH"'
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
echo -e "${BOLD}  ┌──────────────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}  │  ${GREEN}✓${RESET}${BOLD}  Build complete — one more step in Chrome      │${RESET}"
echo -e "${BOLD}  └──────────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "  ${BOLD}Extension built at:${RESET}"
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
  echo "    4. Pin the PortalFlow icon in your toolbar for quick access"
  echo ""
else
  echo -e "  ${BOLD}Apply the update in Chrome:${RESET}"
  echo ""
  echo "    1. Open ${CYAN}chrome://extensions${RESET}"
  echo "    2. Find \"PortalFlow\" and click the reload (circular arrow) icon"
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
echo "  Get started:"
echo ""
echo "    ${DIM}\$${RESET} portalflow                                                    ${DIM}# Interactive menu${RESET}"
echo "    ${DIM}\$${RESET} portalflow provider config                                   ${DIM}# Set up an LLM provider${RESET}"
echo "    ${DIM}\$${RESET} portalflow run ${HOME}/.portalflow/automations/<file>.json"
echo "    ${DIM}\$${RESET} portalflow --help                                            ${DIM}# Show all commands${RESET}"
echo ""
echo -e "  ${BOLD}Maintenance:${RESET}"
echo -e "    Update:     ${DIM}portalflow-update${RESET}"
echo -e "    Update:     ${DIM}curl -fsSL https://raw.githubusercontent.com/marinoscar/portalflow/main/tools/cli/install.sh | bash${RESET}"
echo -e "    Uninstall:  ${DIM}${CLI_DIR}/install.sh --uninstall${RESET}"
echo ""
