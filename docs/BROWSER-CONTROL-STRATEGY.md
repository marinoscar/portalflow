# Browser Control Strategy — Retrospective and Path Forward

**Status:** Living document. Current state as of CLI 1.1.21.
**Purpose:** Capture every approach we've tried to make PortalFlow look like a real human user to a real website, why each attempt fell short, and what the evidence tells us to try next. Use this before making any new browser-control decision so we don't re-learn the same lessons.

---

## TL;DR

- **The goal** is to automate websites like AT&T with a browser session that is indistinguishable from a real human user's Chrome. This means the user's real cookies, real logins, real MFA state, and real browser fingerprint must all be present.
- **We have tried five approaches** over CLI versions 1.1.8 → 1.1.21, each addressing a different failure mode, and **none of them fully work**. Each fix unblocked the symptom we were chasing but revealed a deeper layer of Chrome / Playwright interaction that still breaks the flow.
- **The pattern is clear:** driving a real user profile with Playwright is whack-a-mole. Every layer of Chrome (process singleton, session restore, startup network calls, CDP handshake, automation flags, fingerprint signals) was designed with assumptions that Playwright breaks.
- **The recommended next path is a Chrome extension**: run PortalFlow's automation logic *inside* a Chrome the user launched themselves, as a normal human. An extension can drive the browser with `chrome.tabs`, `chrome.webNavigation`, and content-script DOM access, and from Chrome's perspective there is zero automation — the browser is genuinely being used by a human whose keyboard happens to issue commands via a WebSocket to an extension.
- **This document exists so we stop retrying paths that have already failed.** Read the attempts log before proposing anything that touches the browser launch path.

---

## 1. The Goal (and Why It Is Hard)

### 1.1 The goal

> "I want PortalFlow to automate a website the same way I would do it manually. If I can download my AT&T bill by clicking through the browser, PortalFlow should do the same. Without me, unattended, on a schedule."

Specifically:

| Requirement | Means |
|---|---|
| Works on sites with bot protection | No `navigator.webdriver`, no obvious fingerprint tells, human-like behavior |
| Uses my real logins / MFA tokens | Real browser profile with real cookies / localStorage / saved sessions |
| Uses my installed extensions | Password manager, Duo, SSO agents must be loaded and running |
| Runs on a schedule (unattended) | Browser launch + automation must complete without manual intervention |
| Works across "all" websites | Not tunable per site; robust to arbitrary HTML, CSS, and JS frameworks |

### 1.2 Why it is hard

The combination of "real profile" + "bot-protected site" + "unattended" is the hardest point in the browser-automation design space. Each pair of these is possible on its own:

- **Real profile + unattended, simple site**: easy — just `launchPersistentContext`.
- **Bot-protected site + unattended, fresh profile**: possible with stealth patches and storageState cookie injection.
- **Real profile + bot-protected site, attended (human in loop)**: trivial — the human does it.

All three at once is the hard problem, because:

1. Real profiles have **state that conflicts with Playwright's launch assumptions** (SingletonLock, session restore, sync, crashed flag, extensions demanding attention).
2. Bot protection keys on **signals that Playwright adds to Chrome** (the `--enable-automation` flag, the CDP channel, specific timing patterns, fingerprint drift).
3. Unattended runs mean **no human is available** to dismiss Chrome's popups, approve MFA prompts, or retry a flaky launch.

Every fix we've shipped has addressed one of these without addressing the others, and a fresh failure mode emerges at the next layer.

---

## 2. Attempts Log

Each entry lists the **CLI version**, **what we shipped**, **what happened when the user ran it**, **why it failed**, and **the lesson we pulled from that outcome**. Read top-to-bottom to understand the current state.

### 2.1 Attempt 1 — Isolated Playwright chromium (baseline, ≤ 1.1.10)

**What we shipped.** Default Playwright `chromium.launch()` + `browser.newContext()`. Fresh in-memory Chromium every time. No persistence.

**What happened.** Basic automation worked for sites with no bot protection. AT&T's login page blocked it within the first couple of requests.

**Why it failed.**

- `navigator.webdriver === true` — set because Playwright passes `--enable-automation` by default.
- No cookies, no saved logins — every run had to re-authenticate from scratch, which for AT&T means re-doing MFA. Not unattended-capable.
- Playwright's bundled Chromium has a different fingerprint than stable Chrome (WebGL renderer, default extensions, plugin list).
- No extensions loaded — password manager, SSO agents, etc. unavailable.

**Lesson.** Isolated Playwright is fine for deterministic automation of unprotected sites. It cannot handle real-user authentication workflows and has no chance against modern bot detection.

---

### 2.2 Attempt 2 — Persistent mode with the user's real profile (1.1.11)

**What we shipped.** Added `browser.mode: "persistent"` config. `BrowserService.launchPersistent` calls `chromium.launchPersistentContext(userDataDir, {channel: 'chrome', args: ['--profile-directory=Profile 2']})` against the user's real `~/.config/google-chrome/` with a sub-profile selector.

**Goal of this attempt.** Inherit every property of the user's real Chrome: cookies, logins, extensions, fingerprint. Solve the "unattended auth" requirement by letting MFA state carry over between runs.

**What happened.** First run worked fine on some sites. Second run onward: browser window opens, sits on `about:blank`, never loads the first navigate step. The runner hangs indefinitely. No error, no log after `Resolved browser config`.

**Why it failed.** Chrome's **process singleton**. When Chrome exits (or is killed), it ideally removes `<userDataDir>/SingletonLock` — a symlink whose target is `<hostname>-<pid>`. On next launch, Chrome reads this symlink, sees a "running Chrome" PID, and forwards the launch command via a UNIX socket to that process instead of starting its own. If the previous Chrome crashed or was killed, the lock still points at a dead PID. Chrome tries to forward to that PID, the forward never resolves, and Playwright's spawned binary exits while waiting for a CDP handshake that will never arrive.

Meanwhile, Chrome itself still opens a window (via the singleton machinery) showing `Chrome is being controlled by automated test software` — which made the symptom confusing: the browser is visibly there, but Playwright has no control over it.

**Lesson.** You cannot point Playwright at a directory that might contain stale singleton files and expect it to work. Every persistent-mode launch needs a preflight that verifies the directory is in a clean, usable state.

---

### 2.3 Attempt 3 — Preflight: detect running Chrome + clear stale singleton files (1.1.19)

**What we shipped.** `tools/cli/src/browser/persistent-launch.ts` with three helpers:

- `inspectSingletonLock(userDataDir)` — reads the symlink, parses `<hostname>-<pid>`, tests liveness via `process.kill(pid, 0)`. Returns `{pid, stale}` or `null`.
- `clearSingletonFiles(userDataDir)` — removes `SingletonLock`, `SingletonCookie`, `SingletonSocket`. Safe only if no live Chrome holds them.
- `preflightPersistentLaunch({userDataDir, profileDirectory})` — validates directory layout, refuses to run when a live Chrome holds the profile (clear error naming the PID), otherwise clears stale singleton files.

Plus `PERSISTENT_LAUNCH_ARGS` (a curated set of flags including `--no-first-run`, `--no-default-browser-check`, `--disable-session-crashed-bubble`) and `PERSISTENT_LAUNCH_TIMEOUT_MS = 60_000` to upper-bound the launch.

**Goal of this attempt.** Fix the stale-lock hang so the persistent launch can actually return.

**What happened.** Initial tests against an empty profile worked. When the user re-ran their real AT&T automation, `launchPersistentContext` **still hung**. The log showed:

```
Resolved browser config  mode=persistent channel=chrome userDataDir=/home/.../google-chrome profileDirectory="Profile 2" stealth=false
Cleared stale Chrome singleton files from user data directory   ← preflight worked
(nothing — hangs here)
```

The preflight cleared the right files, but something else downstream was blocking the launch.

**Why it failed.** Two candidates, both plausible:

1. **Session restore from a crashed prior exit.** Chrome's `Preferences` file in the profile sub-directory (`Profile 2/Preferences`) stores `profile.exit_type` (set to `"Normal"` on clean exit, `"Crashed"` otherwise) and `profile.exited_cleanly` (bool). Every previous run that was interrupted (Ctrl+C, `pkill -f chrome`, Playwright close during a stuck state) left these at `"Crashed"` / `false`. On the next launch, Chrome fires session restore synchronously on startup, which can block Playwright's initial `Target.createTarget` CDP request indefinitely.

2. **Startup network calls.** A real profile has Chrome Sync enabled, which tries to contact `sync.chrome.google.com` on launch. Component Update Service, Safe Browsing, metrics upload, and extension update checks also fire on startup. Each blocks Chrome's main thread momentarily. In combination they can delay CDP availability by tens of seconds — or indefinitely on a slow / restricted network.

**Lesson.** Clearing the singleton lock is necessary but not sufficient. The profile carries in-file state (exit_type, exited_cleanly, sync config) that affects the next launch, and Chrome's startup has network-side effects that can block CDP regardless of what flags we pass.

---

### 2.4 Attempt 4 — Stealth mode (1.1.20)

**What we shipped.** `tools/cli/src/browser/stealth.ts` — tier 1 of a layered anti-detection strategy:

- Strip `--enable-automation` via `ignoreDefaultArgs`. This is the single most impactful change; it's the authoritative source of `navigator.webdriver === true`.
- Add `--disable-blink-features=AutomationControlled` and related feature flags.
- Inject a ~300-line init script via `context.addInitScript()` that patches 10 fingerprint signals: `navigator.webdriver`, `window.chrome` (fake `runtime` / `loadTimes` / `csi` / `app`), `navigator.plugins` (synthesized PDF viewer plugins), `navigator.languages`, `navigator.permissions.query` notification leak, WebGL `UNMASKED_VENDOR_WEBGL` / `UNMASKED_RENDERER_WEBGL`, `navigator.hardwareConcurrency`, `navigator.deviceMemory`, iframe `contentWindow.chrome` consistency, and `Function.prototype.toString` so patched getters return `[native code]`.

**Goal of this attempt.** Defeat bot detection once the browser is actually running. Combinable with any launch mode.

**What happened.** **We never got to test it end-to-end** because the persistent-mode launch was still hanging from attempt 2.3's unfixed session-restore layer. The 25 structural tests pass (verifying the init script contains each evasion patch), but real-world validation against AT&T or similar is still pending.

**Why it didn't close the loop.** Stealth is orthogonal to the launch-hang problem. Even if stealth is perfect, it doesn't help if the launch never returns a usable browser context in the first place.

**Lesson.** Don't ship layered features before the foundation works. Tier 1 stealth patches sit on top of a launch flow that isn't producing launches, so they cannot be validated.

---

### 2.5 Attempt 5 — Patch Preferences + network-suppression flags (1.1.21)

**What we shipped.** Building on attempt 2.3:

- New `patchProfilePreferences(userDataDir, profileDirectory)` helper that reads `<profile>/Preferences`, sets `profile.exit_type = "Normal"` and `profile.exited_cleanly = true`, writes back atomically via temp file + rename. Same trick `undetected-chromedriver` uses.
- Expanded `PERSISTENT_LAUNCH_ARGS` with **every network-suppression flag we could justify**: `--disable-background-networking`, `--disable-component-update`, `--disable-sync`, `--disable-default-apps`, `--disable-domain-reliability`, `--disable-client-side-phishing-detection`, `--metrics-recording-only`, `--disable-background-timer-throttling`, `--disable-breakpad`, `--disable-features=TranslateUI,OptimizationHints,MediaRouter,DialMediaRouteProvider`.
- Wired both into `preflightPersistentLaunch` so every persistent launch: (1) verifies no live Chrome, (2) clears stale singleton files, (3) patches the crashed-exit state, then calls `launchPersistentContext`.

**Goal of this attempt.** Close the session-restore and startup-network gaps left by 1.1.19 so `launchPersistentContext` finally returns cleanly.

**What happened.** **Still did not work.** User closed all Chrome instances, ran with 1.1.21, same symptom: browser launches, stays on `about:blank`, automation never advances. The log will show whether `Patched Chrome Preferences` fired; either way the downstream `browser launched (persistent context — real profile)` line is still missing.

**Why it failed.** Unknown as of this writing. Possible causes we haven't ruled out:

1. **Something in the extensions loaded on Profile 2** is blocking Chrome's startup until the extension finishes initializing, and that blocks CDP. A real profile with 10+ extensions (password manager, Duo, ad blocker, etc.) has far more startup work than Playwright's bundled chromium.
2. **`--profile-directory=Profile 2` interacts oddly with Chrome's profile picker**. When Chrome starts and sees multiple profiles in the user data dir, it may show a profile picker instead of going directly to Profile 2. That picker is a UI element that Playwright can't dismiss via command-line flags.
3. **Chrome is launching via singleton forwarding to a still-running Chrome subprocess we don't see**. `pkill -f chrome` sometimes misses lingering renderer / utility processes that still hold the user data dir. Our preflight checks `SingletonLock` (a file), not `ps -ef` for live processes.
4. **The Chrome version is incompatible with Playwright 1.50.1's CDP expectations**. Stable Chrome can upgrade at any time; Playwright's CDP client follows a specific version spec. If Chrome on the user's machine is significantly newer than what Playwright knows about, CDP protocol mismatches could silently fail.
5. **A profile picker / account chooser is being shown** on top of `about:blank`. Chrome's multi-account UI has its own startup sequence that blocks navigation.

**Lesson.** Every fix we've shipped for persistent mode has closed one hang source and left another. The failure mode is consistent — the browser opens, Playwright never gets control — but the root cause keeps moving. **We are layering mitigations on a fundamentally mismatched architecture**: Playwright was built to drive a specific Chromium binary with a known CDP contract, and the user's real Chrome is an unknowable, user-customized, auto-updating, extension-laden, multi-account environment. Fixing persistent mode to work reliably across every user's setup is a bottomless pit.

---

## 3. Patterns and Lessons Across All Attempts

### 3.1 The layering pattern (whack-a-mole)

Every time we fix a symptom, a deeper one appears:

```
SingletonLock hang          → clear stale files (1.1.19)
  ↓ reveals
Session restore blocks CDP  → patch Preferences (1.1.21)
  ↓ reveals
Startup network hangs       → disable-background-networking (1.1.21)
  ↓ reveals
???                          → current state
```

We cannot estimate how many more layers are between us and a working persistent launch. Each one takes 1–2 hours of diagnosis + a release. This is not converging.

### 3.2 The fundamental mismatch

**Playwright assumes control of Chromium from the moment the binary spawns.** It passes specific flags, establishes a CDP pipe, and expects Chrome to respond on that pipe before any other startup work happens. A fresh, minimal Chromium satisfies this cleanly.

**A real user profile breaks every assumption in that model**:

- The profile has state that requires startup work: session restore, extension initialization, sync, tab restoration, download list reload, permission prompts.
- The profile has extensions that run on startup and can pause the event loop.
- The profile has an `exit_type` flag that changes Chrome's startup path.
- The profile has multiple sub-profiles that trigger account chooser UI.
- The profile's Chrome is on a release channel the user updates automatically, so the Chromium version is unpredictable.

Every fix we've shipped has been "patch around a specific manifestation of this mismatch." The mismatch itself is not fixable — it is structural.

### 3.3 The bot-detection tax

Even **if** the persistent launch worked reliably, we still haven't validated stealth mode against a real bot-protected target. It's likely that some sites would still detect the automation via TLS fingerprinting, canvas fingerprinting, behavioral analysis, or enterprise-tier detection suites that stealth tier 1 doesn't touch.

The layered strategy (tier 1 stealth, tier 2 humanized input, tier 3 CDP attach) was designed to address this. **Tiers 2 and 3 have never been reached**, and we don't know how many tiers are enough for "all websites".

### 3.4 The unknowable environment

The user's machine is not our test harness. We cannot reproduce their exact Chrome version, exact extension set, exact profile state, or exact network conditions. Every fix we ship is a blind shot based on a log snippet and a screenshot. The gap between "passes our vitest suite" and "works on the user's Linux-Mini-PC with Profile 2" has been 100% for every persistent-mode fix we've tried.

### 3.5 The sunk-cost trap

We have invested 5 versions and ~1500 lines of code into the persistent-mode path. The temptation is to "just one more fix" — but the evidence from attempts 2.3, 2.4, and 2.5 is that we don't know how many more fixes are needed, and each one takes real time. **At some point the correct call is to abandon the approach, not iterate on it.**

This document exists in part to make that call explicit.

---

## 4. The Recommended Path Forward: Chrome Extension

### 4.1 Why an extension is different

The failing approach is: **PortalFlow launches Chrome** and tries to control it.

The extension approach is: **The user launches Chrome** (by clicking the icon, normally, as a human), and PortalFlow's code runs *inside* that Chrome as an extension that communicates out to the CLI.

This flips the hardest part of the problem on its head:

| Problem | Current approach | Extension approach |
|---|---|---|
| `navigator.webdriver` | Patch it after launch | Never set — Chrome wasn't launched by automation |
| Real profile with extensions | Fight SingletonLock / Preferences / sync | User's real Chrome is already running the real profile |
| Bot-detection fingerprint | Patch 10+ signals via init script | It's a real Chrome; every signal is genuine |
| MFA / saved logins | Inherit via profile directory (fragile) | Already loaded in the running browser |
| Startup network hang | Disable sync, background networking, etc. | Irrelevant — Chrome's startup already happened |
| Mouse/keyboard timing | Humanized input in tier 2 | `chrome.scripting.executeScript` + real user events |
| Session restore | Patch `exit_type` | Not our problem — user handles their own browser |
| Chrome version mismatch | Hope Playwright's CDP matches | Extensions are stable across Chrome versions |
| Unattended runs | Launch Chrome → hang | Extension can be scheduled via `chrome.alarms` or a persistent background worker |

**Every failure mode we've been fighting is solved, for free, by not launching the browser ourselves.**

### 4.2 What the extension does

A Manifest V3 extension with:

- A **service worker** (`background.js`) that stays alive via `chrome.alarms` and holds a **WebSocket connection** to the PortalFlow CLI daemon on `localhost:PORT`.
- **Content scripts** injected into the pages being automated. Content scripts have direct DOM access: they can query selectors, click elements, fill inputs, and read extracted values.
- `chrome.tabs.create` / `chrome.tabs.update` for navigation — these trigger the same full page load a user would experience, with no automation flag.
- `chrome.downloads` for capturing downloaded files.
- `chrome.scripting.executeScript` for running arbitrary JS in a tab when a content script isn't enough.
- `chrome.webNavigation.onCompleted` to detect when a page has finished loading instead of polling.
- `chrome.storage.local` for per-run state that persists across service-worker wake-ups.

### 4.3 Proposed architecture

```
┌──────────────────────┐           ┌──────────────────────┐
│   PortalFlow CLI     │           │   User's real Chrome │
│   (existing runner)  │  WebSocket│   (clicked the icon) │
│                      │ ◀────────▶│                      │
│  AutomationRunner    │  ws://    │  ┌────────────────┐  │
│  StepExecutor        │  127.0.0.1│  │  PortalFlow    │  │
│  LlmService          │  :7667    │  │  Extension     │  │
│                      │           │  │                │  │
│  websocket server ───┼───────────┼─▶│  - service wkr │  │
│                      │           │  │  - content scr │  │
│                      │           │  │  - chrome.*    │  │
│                      │           │  └────────────────┘  │
│                      │           │                      │
│                      │           │  Cookies, logins,    │
│                      │           │  extensions, MFA,    │
│                      │           │  real fingerprint    │
└──────────────────────┘           └──────────────────────┘
```

### 4.4 Communication protocol

The CLI runs a WebSocket server on `127.0.0.1:7667` (configurable). The extension connects on startup and stays connected.

**Message types (CLI → extension):**

```json
{"type": "navigate", "tabId": 123, "url": "https://..."}
{"type": "click",    "tabId": 123, "selector": "button#submit"}
{"type": "type",     "tabId": 123, "selector": "input[name=username]", "text": "..."}
{"type": "extract",  "tabId": 123, "selector": ".balance", "attribute": "textContent"}
{"type": "waitFor",  "tabId": 123, "selector": ".logged-in", "timeout": 10000}
{"type": "download", "tabId": 123, "url": "..."}
{"type": "screenshot", "tabId": 123}
```

**Message types (extension → CLI):**

```json
{"type": "ready", "chromeVersion": "134.0.6998.165"}
{"type": "result", "commandId": "...", "ok": true, "value": "..."}
{"type": "error",  "commandId": "...", "message": "element not found"}
{"type": "navigationComplete", "tabId": 123, "url": "..."}
```

Each command has a `commandId`; the extension responds with the same id so the CLI can correlate requests and responses across an async channel.

### 4.5 How step types map to extension messages

| Step type | Extension work |
|---|---|
| `navigate` | `chrome.tabs.update(tabId, {url})` + `chrome.webNavigation.onCompleted` |
| `interact: click` | content script: `document.querySelector(sel).click()` |
| `interact: type` | content script: simulate keypress events |
| `wait: selector` | content script polls `querySelector` until found or timeout |
| `wait: network_idle` | service worker counts `chrome.webRequest` events |
| `extract` | content script reads the DOM and returns the value |
| `download` | `chrome.downloads.download(...)` + listen for `onChanged` |
| `tool_call` | Unchanged — still run by the CLI locally |
| `condition` | Unchanged — CLI-side evaluation |
| `loop` | Unchanged — CLI-side iteration |
| `call` | Unchanged — CLI-side function invocation |
| `goto` | Unchanged — CLI-side jump |
| `aiscope` | The LLM calls stay in the CLI; observe/act messages flow through the extension |

**The runner stays intact.** Only the lowest layer (`PageService`) changes from "Playwright API calls" to "WebSocket messages to the extension". Every step executor, condition, jump, loop, and aiscope feature we've built continues to work — they just target a different transport.

### 4.6 What the extension inherits for free

- **Real `navigator.webdriver === undefined`** — because Chrome wasn't launched with `--enable-automation`.
- **Real `window.chrome`, real `navigator.plugins`, real WebGL, real fingerprint.** The stealth init script is deleted. We don't need it.
- **Real cookies, localStorage, sessionStorage, IndexedDB.** Whatever the user is logged into, the extension can see.
- **Real extensions.** Password managers, SSO agents, Duo — all loaded, all running.
- **Real user-agent, timezone, languages, OS detection.** Nothing lies.
- **No launch hangs.** Chrome is already running. There is nothing to launch.
- **No session restore issues.** Chrome handles its own session, extensions, update checks. PortalFlow is a passenger, not a driver.
- **Unattended runs.** The user sets Chrome to auto-start at login, pins the PortalFlow CLI to start at login, and on a schedule the CLI sends commands to the already-running browser.

### 4.7 What will still be hard

1. **Installation friction.** The user has to install the extension via `chrome://extensions` in developer mode (since unlisted extensions can't be installed directly on Chrome without enterprise policy). This is a one-time setup but more involved than `npm install`.

2. **The extension must be running when PortalFlow runs.** If the user's Chrome is closed, PortalFlow has no one to talk to. We'd need either:
   - An error like "no extension connected — is Chrome running with the PortalFlow extension?"
   - A fallback to launch Chrome ourselves (back to the failing approach)
   - A CLI helper that launches the user's Chrome via the desktop file and waits for the extension to connect

3. **Tab management.** The extension needs to pick a tab to act on. Options: "always use a fresh tab opened by PortalFlow", "reuse the active tab", "let the user specify". Simplest is "PortalFlow opens a new tab per automation and closes it at end".

4. **Content script injection on protected origins.** `chrome://` URLs, `chrome-extension://` pages, and the Chrome Web Store do not permit content scripts. PortalFlow already avoids these, so unlikely to be a real issue — but worth noting.

5. **Running multiple automations in parallel.** The WebSocket server would need to track which automation owns which tab, and the extension needs to refuse commands for tabs it doesn't own.

6. **Cross-origin iframes.** Some flows span iframe boundaries (Google SSO, Stripe checkout). Content scripts have to be injected into each frame separately. Manifest V3 handles this via `all_frames: true` in the content script manifest, but it means the CLI-side code needs to address frames explicitly.

7. **File uploads.** The current `extract` and `interact` paths don't handle `<input type="file">`. Playwright had `page.setInputFiles`; the extension has to simulate this via a content-script DataTransfer object construction, which is fiddly but doable.

8. **Network-level interception.** We lose Playwright's `page.route` for intercepting requests, mocking responses, or modifying headers. The `chrome.webRequest` API has similar capabilities but a different shape. Probably not needed for current automations but worth noting.

9. **Screenshots.** `chrome.tabs.captureVisibleTab` works for visible regions but not full-page captures. Full-page screenshots need multiple captures + stitching, which is annoying.

10. **The `aiscope` screenshot path.** aiscope sends a base64 PNG to the LLM. `captureVisibleTab` returns a data URL we can send over WebSocket. Fine, but adds a roundtrip.

11. **Bot detection may still catch us via behavioral signals**. Even in a real Chrome, if the extension issues clicks with perfect 0ms timing, sites doing behavioral analysis will notice. We'd still need tier 2 (humanized input) on top of the extension — but applied as content-script-level `setTimeout` jitter instead of Playwright `keyboard.press` options.

12. **Bidirectional errors and reconnection.** The WebSocket can disconnect. The extension needs to reconnect; the CLI needs to resume the run (or fail it with a clear error). Not hard but needs upfront design.

### 4.8 What this does NOT solve

- **CAPTCHAs.** If a site presents hCaptcha / reCAPTCHA / Turnstile, the automation still cannot solve it without a human. That was always true and extension-mode doesn't change it.
- **TLS fingerprinting** is a wash either way — whatever JA3 fingerprint the user's Chrome produces is what the site sees, regardless of whether it's driven by a human or the extension.
- **Chrome updates breaking our extension APIs.** `chrome.scripting` has been stable for years but `chrome.action` / Manifest V3 churn is real. The extension needs to be kept up to date with Chrome changes, same as any extension.

### 4.9 Rough implementation size

| Piece | Estimate |
|---|---|
| Extension manifest + service worker + content script skeleton | 300 lines |
| Command protocol (message types, request/response correlation) | 150 lines |
| Per-step handlers (click, type, extract, wait, navigate, download, screenshot) | 400 lines |
| CLI-side WebSocket server + new `ExtensionPageService` | 350 lines |
| Tab management / tab ownership / reconnection | 200 lines |
| `portalflow extension install` TUI helper + docs | 150 lines |
| Tests (mock WebSocket server, mock content script) | 400 lines |
| Documentation (user install guide, architecture doc, protocol ref) | 200 lines |
| **Total** | **~2,150 lines across ~15 files** |

Realistically 8–15 hours of work, shipped in 3–4 PRs (scaffold, step handlers, CLI wiring, tests + docs).

### 4.10 Migration path

The extension mode does **not** need to replace isolated or persistent mode immediately. It can ship as a new `browser.mode: "extension"` value alongside the existing modes, with:

- **Isolated mode**: kept for quick tests, CI, and users who don't need real profiles.
- **Persistent mode**: kept as a known-fragile option for sites that don't have bot protection. Mark as "legacy" or "experimental" in docs. Document the known failure modes.
- **Extension mode**: the recommended path for real-user automation of real websites, especially bot-protected ones.

Users can pick per-automation. A single-config-change switch lets them fall back to persistent if extension mode has a gap.

---

## 5. Decision Log: Things We Chose Not To Do

### 5.1 ❌ Firefox instead of Chrome

**Considered in:** The conversation between 1.1.19 and 1.1.20.

**Why rejected:** Playwright ships its own patched Firefox build, not the user's system Firefox. Every problem we're having with "real Chrome profile" would recur as "real Firefox profile with a different Firefox binary than the system one." The locking / Preferences / startup issues have Firefox equivalents. And the Chrome extension ecosystem — which is what the user actually depends on for password managers, SSO, Duo, etc. — doesn't come across.

### 5.2 ❌ `playwright-extra` + stealth plugin

**Considered in:** The stealth-mode design doc for 1.1.20.

**Why rejected:** Adds a transitive dependency we'd be at the mercy of. The core evasions were hand-rolled instead in ~300 lines. This was the right call in isolation, but stealth mode in any form doesn't help if the launch is hanging, which is what we've been dealing with.

### 5.3 ❌ `undetected-playwright` fork

**Considered in:** Tier 1 stealth discussion.

**Why rejected:** Requires pinning a Playwright fork that may lag upstream. The specific evasions it provides are a subset of what a hand-rolled init script can do.

### 5.4 ❌ Keep layering fixes on persistent mode

**Current state:** After 1.1.21 still broken.

**Why rejected from here forward:** The pattern in §3.1 is clear. We've committed 5 versions worth of fixes and the failure mode has moved deeper each time. Estimating the remaining work is impossible. Opportunity cost is real — every hour spent fixing persistent mode is an hour not building the extension path, which addresses the root cause.

### 5.5 ❌ CDP attach mode (tier 3)

**Status:** Deferred, not rejected.

**Why not yet:** The plan was to ship it as tier 3 of the layered anti-detection strategy, after stealth (tier 1) and humanized input (tier 2). CDP attach requires the user to start Chrome with `--remote-debugging-port=9222` before running the automation. The extension approach is strictly better:

- CDP attach still requires launching Chrome with a non-default flag, which the user's desktop environment doesn't do by default.
- CDP attach still uses the CDP channel, which has its own detection surface.
- Extension mode needs no launch flags at all — the user just opens Chrome normally.

If the extension approach fails in some unforeseen way, CDP attach is the fallback. Otherwise, skip it.

### 5.6 ❌ Rewrite in Puppeteer or Selenium

**Considered in:** Various debugging sessions.

**Why rejected:** Same fundamental problem — any library that drives Chrome from outside the process will hit the same persistent-mode issues. The problem isn't Playwright; it's the "drive a real user's Chrome from outside" architecture.

### 5.7 ❌ Dedicated automation-only Chrome profile

**Considered in:** The 1.1.19 discussion.

**Why partially-rejected:** This works (clone the user's profile to a separate dir, point PortalFlow at the clone) and was suggested as a workaround. The user's concern was that he doesn't want to maintain two profiles. The extension approach makes this moot — no cloning needed.

---

## 6. Open Questions for the Extension Approach

Before starting the extension implementation, the following decisions should be made explicitly:

1. **Installation model:** Unpacked in developer mode, or signed CRX distributed via a private channel? Developer-mode install requires a one-time Chrome settings toggle but has zero server infra. CRX requires signing infrastructure but is closer to "real install."

2. **WebSocket vs Native Messaging:** Native Messaging (chrome.runtime.connectNative) is more secure and doesn't need a local server; WebSocket is simpler and cross-platform. For the first iteration, WebSocket is less code.

3. **Tab ownership model:**
   - (a) PortalFlow opens a new tab per automation, owns it exclusively, closes it on exit.
   - (b) The user picks the active tab and PortalFlow uses that one.
   - Recommend (a) for predictability.

4. **How does the CLI know Chrome is running?** When `portalflow run` starts, the WebSocket server accepts extension connections. If no extension connects within N seconds, fail with a clear error: *"Chrome is not running with the PortalFlow extension installed. Open Chrome and ensure the extension is loaded."*

5. **What about headless operation?** Extension mode requires a visible Chrome. That kills headless unattended runs... unless we combine extension mode with a **dedicated headless Chrome launched by PortalFlow, with the extension preloaded**. This is a workflow we could build as "extension-mode headless" — it's isolated mode with the extension injected, which gets us the stealth benefits without the real-profile pain. Worth thinking about for CI scenarios.

6. **Multi-automation concurrency:** If two automations run at once against the same Chrome, they need to not collide. Easiest: the WebSocket server only accepts one active run at a time, queues others.

7. **Extension auto-update policy:** When the extension changes, how does the user's installed copy get updated? Manifest V3 auto-update works for CRX-signed extensions; developer-mode unpacked needs a manual reload.

8. **Logging / debugging story inside the extension:** Extension console logs go to `chrome://extensions` → service worker. That's a different debugging environment from our existing log file. The extension should forward its logs to the CLI over the same WebSocket so everything ends up in one file.

9. **What's the minimum viable demo?** Probably: extension + CLI + one supported step type (`navigate`) + one target (`https://example.com`). Once the pipeline works end-to-end, adding more step types is mechanical.

---

## 7. How to Use This Document

### 7.1 Before proposing a browser-control change

Read §2 (the attempts log) and §5 (the decision log). If your proposal is a variant of something already tried, don't repeat it — understand *why* it failed and address that specifically.

### 7.2 When a new failure mode appears

Add a new subsection to §2 (the attempts log) with the version number, what was shipped, what happened, why it failed, and what the lesson is. This document is the single source of truth for "what we've learned from building this".

### 7.3 When the current approach finally works

Update §3 to reflect what the resolution was. Mark the approach as "working as of version X" and keep the historical entries — future maintainers will want to see the full path, not just the successful endpoint.

### 7.4 When an attempt exceeds its time budget

If any approach takes more than 2 fix-versions without converging on "this works reliably for the user's real setup", stop and revisit §6 (open questions) and §5 (decision log). The pattern in §3.1 (whack-a-mole) is the signal that the architecture is wrong, not that one more fix will solve it.

### 7.5 When the user reports "still not working"

First check the log file for which log lines DID appear vs which are missing. That tells you which layer is now stuck. Add the observation to §2 under the current attempt. Do not immediately ship a fix — **first check whether the fix you're about to propose has already been tried** elsewhere in this document. If it has, you're whack-a-mole-ing.

---

## 8. Current Status (as of 1.1.21)

- **Persistent mode:** Broken in a new, unidentified way after 5 attempts. Do not invest more in this path without explicitly revisiting §5.4.
- **Isolated mode:** Works for trivial cases, fails against bot-protected sites.
- **Stealth mode (tier 1):** Shipped but never validated end-to-end because of the persistent-mode block.
- **Humanized input (tier 2):** Not started.
- **CDP attach (tier 3):** Not started.
- **Extension mode:** **RECOMMENDED — NOT STARTED.** This is the next path.

**Recommended next commit:** `feat(extension): scaffold PortalFlow Chrome extension with WebSocket transport`. Start with the manifest + service worker + a trivial "ping/pong" message round-trip. Don't ship any step handlers until that works end-to-end.

**Do not ship another fix to `persistent-launch.ts` or `stealth.ts` until the extension path is either working or explicitly abandoned.** That's the whack-a-mole trap.

---

*This document is the memory of what we've tried. Update it every time something new is learned.*
