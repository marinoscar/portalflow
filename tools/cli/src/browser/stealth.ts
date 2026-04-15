/**
 * Anti-detection "stealth" helpers for PortalFlow's Chromium launches.
 *
 * The default Playwright-controlled Chromium is trivially detectable by
 * bot-detection libraries (Akamai Bot Manager, Cloudflare Turnstile,
 * DataDome, PerimeterX, Arkose). The detectors look at a short list of
 * signals that diverge between a human-driven browser and an
 * automation-driven one:
 *
 *  - `navigator.webdriver === true`      — set by --enable-automation
 *  - `window.chrome` partially populated  — Playwright Chromium is
 *                                            missing several sub-objects
 *                                            a real Chrome has
 *  - `navigator.plugins` is empty         — no real plugin list
 *  - `navigator.languages` is ['en-US']   — correct but a minority pattern
 *  - `navigator.permissions.query` leaks   — queries for 'notifications'
 *                                            return the automation state
 *  - WebGL UNMASKED_VENDOR/RENDERER = ''   — or bogus Mesa strings in CI
 *  - `navigator.hardwareConcurrency = 1`   — common under VM / containers
 *  - "Chrome is being controlled by automated test software" banner
 *
 * This module ships a curated set of patches that cover all of the above
 * at once. The philosophy is: match a plausible real-Chrome fingerprint
 * rather than try to be perfectly indistinguishable (which is impossible
 * without deeper patches to Chromium itself). Most bot detectors run a
 * finite checklist; patching every item on that checklist is enough to
 * pass the common case.
 *
 * Tier 1 of the layered defense strategy (per the 1.1.20 design doc).
 * Tier 2 adds humanized input timing; tier 3 is CDP-attach to a real
 * user-started Chrome. Both layer cleanly on top of this module.
 *
 * No third-party dependencies; the evasions are well-known techniques
 * that have been stable for years. The init script is injected into
 * every new document via `context.addInitScript()`, which runs BEFORE
 * any page script — so by the time bot-detection code inspects the
 * browser, our patches are already in place.
 */

/**
 * Launch arguments added when stealth is enabled. These strip the
 * automation banner, disable the `AutomationControlled` blink feature
 * (which is what sets `navigator.webdriver = true` on modern Chrome),
 * and turn off a few features that fingerprint libraries key on.
 *
 * Note that some of these overlap with PERSISTENT_LAUNCH_ARGS. That's
 * fine — Playwright de-duplicates by flag name.
 */
export const STEALTH_LAUNCH_ARGS: readonly string[] = [
  // The core anti-automation flag. Without this, Chromium will always
  // set navigator.webdriver = true regardless of any init script.
  '--disable-blink-features=AutomationControlled',
  // Suppress Chrome's own "being controlled by automated test software"
  // banner even if we somehow end up with --enable-automation.
  '--disable-features=Translate,OptimizationHints,MediaRouter,AutomationControlled',
  // Makes navigator.plugins look more like a real Chrome (the default
  // automated Chromium has no plugins at all).
  '--enable-features=NetworkService,NetworkServiceInProcess',
  // Disable the "automation" extension loaded at startup.
  '--no-service-autorun',
  // Prevent Chrome from prompting for OS keyring access during launch,
  // which stalls automation on Linux desktops running gnome-keyring.
  '--password-store=basic',
  // Make the renderer look more like a desktop Chrome (not Mesa).
  '--use-gl=desktop',
];

/**
 * Default args Playwright normally passes that we must REMOVE in stealth
 * mode. The single most important one is `--enable-automation`, which
 * is the authoritative source of `navigator.webdriver = true`. Without
 * removing this, the init script's patch would be reverted on every
 * navigation.
 *
 * Passed via Playwright's `ignoreDefaultArgs` launch option.
 */
export const STEALTH_IGNORE_DEFAULT_ARGS: readonly string[] = [
  '--enable-automation',
];

/**
 * The stealth init script. Injected into every new document via
 * `context.addInitScript(STEALTH_INIT_SCRIPT)`. Runs before any page
 * script, which means bot-detection libraries see our patched values
 * from the very first inspection.
 *
 * Each patch is wrapped in a try/catch so that a failure in one
 * evasion doesn't knock out the others. This matters for long-running
 * automations where we'd rather have 9/10 patches active than none.
 *
 * The script is a string (not a function) so it can be sent over the
 * CDP wire without serializing closures. Do NOT reference outer
 * variables — the script runs in the page's JS context, not ours.
 */
export const STEALTH_INIT_SCRIPT = `
(() => {
  'use strict';

  // ---------------------------------------------------------------
  // 1. navigator.webdriver
  // ---------------------------------------------------------------
  // The single most checked flag in bot detection. --disable-blink-
  // features=AutomationControlled handles this at the Chromium level,
  // but we also override the getter at the JS level as belt and
  // suspenders. If the Chromium flag did its job, navigator.webdriver
  // is already undefined and this is a no-op; if it didn't, this
  // patch rescues us.
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch (e) { /* swallow */ }

  // ---------------------------------------------------------------
  // 2. window.chrome
  // ---------------------------------------------------------------
  // Real Chrome exposes a \`window.chrome\` object with runtime, loadTimes,
  // csi, and app sub-objects. Automated Chromium has a partial stub.
  // Bot detectors check for specific properties to fingerprint.
  try {
    if (!window.chrome) {
      // eslint-disable-next-line no-undef
      window.chrome = {};
    }
    const chrome = window.chrome;

    // runtime: normally a real object with connect, sendMessage, id,
    // onConnect, onMessage. Detectors test for Object.getOwnPropertyNames.
    if (!chrome.runtime) {
      chrome.runtime = {
        PlatformOs: {
          MAC: 'mac',
          WIN: 'win',
          ANDROID: 'android',
          CROS: 'cros',
          LINUX: 'linux',
          OPENBSD: 'openbsd',
        },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
        RequestUpdateCheckStatus: {
          THROTTLED: 'throttled',
          NO_UPDATE: 'no_update',
          UPDATE_AVAILABLE: 'update_available',
        },
        OnInstalledReason: {
          INSTALL: 'install',
          UPDATE: 'update',
          CHROME_UPDATE: 'chrome_update',
          SHARED_MODULE_UPDATE: 'shared_module_update',
        },
        OnRestartRequiredReason: {
          APP_UPDATE: 'app_update',
          OS_UPDATE: 'os_update',
          PERIODIC: 'periodic',
        },
      };
    }

    // loadTimes: legacy Chrome API. Detectors check it exists and
    // returns a plausible object.
    if (!chrome.loadTimes) {
      chrome.loadTimes = function () {
        return {
          requestTime: Date.now() / 1000,
          startLoadTime: Date.now() / 1000,
          commitLoadTime: Date.now() / 1000,
          finishDocumentLoadTime: Date.now() / 1000,
          finishLoadTime: Date.now() / 1000,
          firstPaintTime: Date.now() / 1000,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      };
    }

    // csi: client-side instrumentation API. Similar deal.
    if (!chrome.csi) {
      chrome.csi = function () {
        return {
          startE: Date.now(),
          onloadT: Date.now(),
          pageT: Date.now() - performance.timing.navigationStart,
          tran: 15,
        };
      };
    }

    // app: exists on real Chrome even if empty.
    if (!chrome.app) {
      chrome.app = { isInstalled: false };
    }
  } catch (e) { /* swallow */ }

  // ---------------------------------------------------------------
  // 3. navigator.plugins
  // ---------------------------------------------------------------
  // Automated Chromium returns an empty PluginArray. Real Chrome
  // typically reports 3-5 built-in plugins (PDF viewer, Native Client
  // etc.). We synthesize a plausible list.
  try {
    const fakePlugin = (name, filename, description) => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name: { value: name },
        filename: { value: filename },
        description: { value: description },
        length: { value: 1 },
      });
      return plugin;
    };

    const plugins = [
      fakePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      fakePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      fakePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      fakePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      fakePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'),
    ];

    const pluginArray = Object.create(PluginArray.prototype);
    Object.defineProperties(pluginArray, {
      length: { value: plugins.length },
      item: { value: (i) => plugins[i] ?? null },
      namedItem: { value: (name) => plugins.find((p) => p.name === name) ?? null },
      refresh: { value: () => {} },
    });
    plugins.forEach((p, i) => {
      Object.defineProperty(pluginArray, i, { value: p, enumerable: true });
    });

    Object.defineProperty(Navigator.prototype, 'plugins', {
      get: () => pluginArray,
      configurable: true,
    });
  } catch (e) { /* swallow */ }

  // ---------------------------------------------------------------
  // 4. navigator.languages
  // ---------------------------------------------------------------
  // Automation Chromium defaults to ['en-US'] but real Chrome usually
  // reports at least 2 entries. The array being length-1 is a weak
  // signal by itself but used in combination with others.
  try {
    Object.defineProperty(Navigator.prototype, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true,
    });
  } catch (e) { /* swallow */ }

  // ---------------------------------------------------------------
  // 5. navigator.permissions.query leak
  // ---------------------------------------------------------------
  // Querying for the 'notifications' permission on a real browser
  // returns 'prompt' (the user hasn't granted or denied it). On
  // automated Chromium it sometimes returns a weird state like
  // 'denied' without a prompt ever being shown — a fingerprint.
  try {
    const originalQuery = window.navigator.permissions.query.bind(
      window.navigator.permissions,
    );
    window.navigator.permissions.query = (parameters) => {
      if (parameters && parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return originalQuery(parameters);
    };
  } catch (e) { /* swallow */ }

  // ---------------------------------------------------------------
  // 6. WebGL vendor / renderer
  // ---------------------------------------------------------------
  // Bot detectors query WebGL's UNMASKED_VENDOR_WEBGL and
  // UNMASKED_RENDERER_WEBGL which on a real Chrome return values like
  // 'Google Inc. (Intel)' and 'ANGLE (Intel, Intel(R) Iris(R) Xe ...)'.
  // On automated Chromium they return empty strings or 'Mesa Off-
  // Screen' which is a dead giveaway.
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      // UNMASKED_VENDOR_WEBGL
      if (parameter === 37445) return 'Google Inc. (Intel)';
      // UNMASKED_RENDERER_WEBGL
      if (parameter === 37446) {
        return 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      }
      return getParameter.apply(this, [parameter]);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) return 'Google Inc. (Intel)';
        if (parameter === 37446) {
          return 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        }
        return getParameter2.apply(this, [parameter]);
      };
    }
  } catch (e) { /* swallow */ }

  // ---------------------------------------------------------------
  // 7. navigator.hardwareConcurrency
  // ---------------------------------------------------------------
  // Automation Chromium under Docker / CI reports 1. Real laptops
  // report 4, 8, or 16. Bot detectors that see 1 assume automation.
  try {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
      get: () => 8,
      configurable: true,
    });
  } catch (e) { /* swallow */ }

  // ---------------------------------------------------------------
  // 8. navigator.deviceMemory
  // ---------------------------------------------------------------
  // Similar deal to hardwareConcurrency. 8 GB is the most common
  // value for real laptops today.
  try {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      get: () => 8,
      configurable: true,
    });
  } catch (e) { /* swallow */ }

  // ---------------------------------------------------------------
  // 9. iframe contentWindow chrome
  // ---------------------------------------------------------------
  // Bot detectors create a hidden iframe and read its contentWindow.
  // On automated Chromium the iframe's window has no 'chrome' property
  // while the main window does — a cheap fingerprint. We override
  // HTMLIFrameElement.contentWindow to return a proxy that exposes
  // the same \`chrome\` object as the parent.
  try {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      'contentWindow',
    );
    if (originalDescriptor && originalDescriptor.get) {
      const originalGet = originalDescriptor.get;
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function () {
          const w = originalGet.call(this);
          if (w && !w.chrome) {
            try { w.chrome = window.chrome; } catch (_) { /* cross-origin */ }
          }
          return w;
        },
        configurable: true,
      });
    }
  } catch (e) { /* swallow */ }

  // ---------------------------------------------------------------
  // 10. Function.prototype.toString detection
  // ---------------------------------------------------------------
  // Bot detectors call toString() on our patched getters to see if
  // they're native code. A real navigator.webdriver getter returns
  // "function get webdriver() { [native code] }". Our patch returns
  // something like "() => undefined" — a dead giveaway.
  // Override Function.prototype.toString so our patches pass the
  // "native code" check.
  try {
    const originalToString = Function.prototype.toString;
    const patchedFunctions = new WeakSet();

    // Mark the key patched functions so we can identify them later.
    // We can't enumerate them directly because they're getter-based,
    // but we can mark the getters via Object.getOwnPropertyDescriptor.
    const markGetter = (obj, prop) => {
      try {
        const desc = Object.getOwnPropertyDescriptor(obj, prop);
        if (desc && desc.get) patchedFunctions.add(desc.get);
      } catch (_) { /* swallow */ }
    };
    markGetter(Navigator.prototype, 'webdriver');
    markGetter(Navigator.prototype, 'plugins');
    markGetter(Navigator.prototype, 'languages');
    markGetter(Navigator.prototype, 'hardwareConcurrency');
    markGetter(Navigator.prototype, 'deviceMemory');

    Function.prototype.toString = function toString() {
      if (patchedFunctions.has(this)) {
        // Mimic the format Chrome uses for native getters.
        return 'function () { [native code] }';
      }
      return originalToString.call(this);
    };
  } catch (e) { /* swallow */ }
})();
`;

/**
 * Describe the patches this module applies for logging purposes.
 * Used by BrowserService to emit a single `stealth: enabled` info
 * line after applying the patches.
 */
export const STEALTH_EVASION_LIST = [
  'navigator.webdriver',
  'window.chrome',
  'navigator.plugins',
  'navigator.languages',
  'navigator.permissions.query',
  'WebGL vendor/renderer',
  'navigator.hardwareConcurrency',
  'navigator.deviceMemory',
  'iframe.contentWindow.chrome',
  'Function.prototype.toString',
] as const;
