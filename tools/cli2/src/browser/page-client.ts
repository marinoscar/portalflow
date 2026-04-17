import { randomUUID } from 'node:crypto';
import type pino from 'pino';
import { ExtensionHost, ExtensionCommandError } from './extension-host.js';
import type {
  NavigateCommand,
  InteractCommand,
  WaitCommand,
  ExtractCommand,
  ScreenshotCommand,
  CountMatchingCommand,
  AnyMatchCommand,
  DownloadCommand,
  ScrollCommand,
  TabSelector,
} from './protocol.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const ACTIVE_TAB: TabSelector = { kind: 'active' };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PageClientOptions {
  host: ExtensionHost;
  logger: pino.Logger;
  getDownloadDir?: () => string;
  getScreenshotDir?: () => string;
  defaultTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// PageClient — mirrors tools/cli/src/browser/page.service.ts 1:1
// ---------------------------------------------------------------------------

export class PageClient {
  private readonly host: ExtensionHost;
  private readonly logger: pino.Logger;
  private readonly getDownloadDir: (() => string) | undefined;
  private readonly getScreenshotDir: (() => string) | undefined;
  private readonly defaultTimeoutMs: number;

  constructor(opts: PageClientOptions) {
    this.host = opts.host;
    this.logger = opts.logger;
    this.getDownloadDir = opts.getDownloadDir;
    this.getScreenshotDir = opts.getScreenshotDir;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private newId(): string {
    return randomUUID();
  }

  private wrapError(method: string, args: string, err: unknown): Error {
    const msg = err instanceof Error ? err.message : String(err);
    return new Error(`${method}(${args}) failed: ${msg}`);
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  async navigate(url: string): Promise<void> {
    const cmd: NavigateCommand = {
      type: 'navigate',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      url,
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('navigate', `"${url}"`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  async click(selector: string): Promise<void> {
    const cmd: InteractCommand = {
      type: 'interact',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      action: 'click',
      selectors: { primary: selector },
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('click', `"${selector}"`, err);
    }
  }

  async type(selector: string, text: string): Promise<void> {
    const cmd: InteractCommand = {
      type: 'interact',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      action: 'type',
      selectors: { primary: selector },
      value: text,
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('type', `"${selector}"`, err);
    }
  }

  async selectOption(selector: string, value: string): Promise<void> {
    const cmd: InteractCommand = {
      type: 'interact',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      action: 'select',
      selectors: { primary: selector },
      value,
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('selectOption', `"${selector}", "${value}"`, err);
    }
  }

  async check(selector: string): Promise<void> {
    const cmd: InteractCommand = {
      type: 'interact',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      action: 'check',
      selectors: { primary: selector },
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('check', `"${selector}"`, err);
    }
  }

  async uncheck(selector: string): Promise<void> {
    const cmd: InteractCommand = {
      type: 'interact',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      action: 'uncheck',
      selectors: { primary: selector },
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('uncheck', `"${selector}"`, err);
    }
  }

  async hover(selector: string): Promise<void> {
    const cmd: InteractCommand = {
      type: 'interact',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      action: 'hover',
      selectors: { primary: selector },
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('hover', `"${selector}"`, err);
    }
  }

  async focus(selector: string): Promise<void> {
    const cmd: InteractCommand = {
      type: 'interact',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      action: 'focus',
      selectors: { primary: selector },
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('focus', `"${selector}"`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Wait operations
  // ---------------------------------------------------------------------------

  async waitForSelector(selector: string, timeout?: number): Promise<void> {
    const cmd: WaitCommand = {
      type: 'wait',
      commandId: this.newId(),
      timeoutMs: timeout ?? this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      condition: 'selector',
      selectors: { primary: selector },
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('waitForSelector', `"${selector}"`, err);
    }
  }

  async waitForNavigation(urlPattern?: string, timeout?: number): Promise<void> {
    const cmd: WaitCommand = {
      type: 'wait',
      commandId: this.newId(),
      timeoutMs: timeout ?? this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      condition: 'navigation',
      urlPattern,
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('waitForNavigation', urlPattern ? `"${urlPattern}"` : '', err);
    }
  }

  async waitForNetworkIdle(timeout?: number): Promise<void> {
    const cmd: WaitCommand = {
      type: 'wait',
      commandId: this.newId(),
      timeoutMs: timeout ?? this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      condition: 'network_idle',
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('waitForNetworkIdle', '', err);
    }
  }

  async delay(ms: number): Promise<void> {
    const cmd: WaitCommand = {
      type: 'wait',
      commandId: this.newId(),
      // Add a 1-second buffer beyond the delay itself so the command doesn't
      // time out before the delay completes.
      timeoutMs: ms + 1000,
      tab: ACTIVE_TAB,
      condition: 'delay',
      durationMs: ms,
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('delay', String(ms), err);
    }
  }

  async scroll(
    direction: 'up' | 'down' | 'top' | 'bottom',
    amountPx?: number,
  ): Promise<void> {
    const cmd: ScrollCommand = {
      type: 'scroll',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      direction,
      amountPx,
    };
    try {
      await this.host.sendCommand(cmd);
    } catch (err) {
      throw this.wrapError('scroll', `"${direction}"`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Data extraction
  // ---------------------------------------------------------------------------

  async getText(selector: string): Promise<string> {
    const cmd: ExtractCommand = {
      type: 'extract',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      target: 'text',
      selectors: { primary: selector },
    };
    try {
      return await this.host.sendCommand<string>(cmd);
    } catch (err) {
      throw this.wrapError('getText', `"${selector}"`, err);
    }
  }

  async getAttribute(selector: string, attribute: string): Promise<string | null> {
    const cmd: ExtractCommand = {
      type: 'extract',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      target: 'attribute',
      selectors: { primary: selector },
      attribute,
    };
    try {
      return await this.host.sendCommand<string | null>(cmd);
    } catch (err) {
      throw this.wrapError('getAttribute', `"${selector}", "${attribute}"`, err);
    }
  }

  async getHtml(selector?: string): Promise<string> {
    const cmd: ExtractCommand = {
      type: 'extract',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      target: 'html',
      selectors: selector ? { primary: selector } : undefined,
    };
    try {
      return await this.host.sendCommand<string>(cmd);
    } catch (err) {
      throw this.wrapError(
        'getHtml',
        selector ? `"${selector}"` : '',
        err,
      );
    }
  }

  async getUrl(): Promise<string> {
    const cmd: ExtractCommand = {
      type: 'extract',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      target: 'url',
    };
    try {
      return await this.host.sendCommand<string>(cmd);
    } catch (err) {
      throw this.wrapError('getUrl', '', err);
    }
  }

  async getTitle(): Promise<string> {
    const cmd: ExtractCommand = {
      type: 'extract',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      target: 'title',
    };
    try {
      return await this.host.sendCommand<string>(cmd);
    } catch (err) {
      throw this.wrapError('getTitle', '', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Element presence
  // ---------------------------------------------------------------------------

  async elementExists(selector: string): Promise<boolean> {
    const cmd: AnyMatchCommand = {
      type: 'anyMatch',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      selectors: { primary: selector },
    };
    try {
      // The extension handler returns {exists: boolean}; also handle raw boolean
      // for backward compat with the fake extension in tests.
      const result = await this.host.sendCommand<{ exists: boolean } | boolean>(cmd);
      if (typeof result === 'object' && result !== null && 'exists' in result) {
        return result.exists;
      }
      return Boolean(result);
    } catch {
      // Mirror PageService semantics: return false on any error rather than
      // surfacing an exception to the caller.
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------------------

  /**
   * Download a file by sending a DownloadCommand to the extension.
   *
   * The extension pre-registers a download listener before triggering the
   * download action, so the event is never missed. The trigger can be:
   *   - 'click': click the element identified by `selectors.primary`
   *   - 'navigation': navigate to `url`
   *
   * Returns the actual filename chosen by Chrome (in the user's download dir).
   * The CLI is responsible for moving/renaming the file if `saveDir` was set.
   *
   * Note: Chrome controls download destination. `saveDir` is passed through
   * to the extension but cannot be enforced at the extension layer — Chrome
   * always saves to the user's configured download directory.
   */
  async download(opts: {
    trigger: 'click' | 'navigation';
    selectors?: { primary: string; fallbacks?: string[] };
    url?: string;
    saveDir?: string;
    timeoutMs?: number;
  }): Promise<string> {
    const saveDir = opts.saveDir ?? this.getDownloadDir?.() ?? '.';
    const cmd: DownloadCommand = {
      type: 'download',
      commandId: this.newId(),
      timeoutMs: opts.timeoutMs ?? this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      trigger: opts.trigger,
      selectors: opts.selectors,
      url: opts.url,
      saveDir,
    };
    try {
      const result = await this.host.sendCommand<{ filename: string; downloadId: number; bytesReceived: number }>(cmd);
      return result.filename;
    } catch (err) {
      throw this.wrapError('download', `trigger:${opts.trigger}`, err);
    }
  }

  /**
   * @deprecated Use download() instead. This shim is kept for backward
   * compatibility with step-executor callers that pass a closure trigger.
   * The closure is NOT executed — the extension handles the trigger side.
   * @internal
   */
  async waitForDownload(
    _triggerAction: () => Promise<void>,
    _timeout?: number,
  ): Promise<string> {
    throw new Error(
      'waitForDownload is not supported in the extension-backed runtime. ' +
      'Use pageClient.download({ trigger, selectors, url }) instead.',
    );
  }

  // ---------------------------------------------------------------------------
  // Extra methods (task-7 additions, mirrored here for interface parity)
  // ---------------------------------------------------------------------------

  async countMatching(selector: string): Promise<number> {
    const cmd: CountMatchingCommand = {
      type: 'countMatching',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      selectors: { primary: selector },
    };
    try {
      // The extension handler returns {count: number}; also handle raw number
      // for backward compat with the fake extension in tests.
      const result = await this.host.sendCommand<{ count: number } | number>(cmd);
      if (typeof result === 'object' && result !== null && 'count' in result) {
        return result.count;
      }
      return Number(result);
    } catch (err) {
      throw this.wrapError('countMatching', `"${selector}"`, err);
    }
  }

  async screenshot(filenameHint?: string): Promise<string> {
    const saveDir = this.getScreenshotDir?.() ?? '.';
    const cmd: ScreenshotCommand = {
      type: 'screenshot',
      commandId: this.newId(),
      timeoutMs: this.defaultTimeoutMs,
      tab: ACTIVE_TAB,
      saveDir,
      filenameHint,
    };
    try {
      // The extension returns {dataUrl: 'data:image/png;base64,...'}.
      // The CLI side writes it to disk and returns the file path.
      // For now, return the dataUrl itself — the step executor stores it as
      // an artifact path. The runner can decode it if it needs the bytes.
      const result = await this.host.sendCommand<{ dataUrl: string } | string>(cmd);
      if (typeof result === 'object' && result !== null && 'dataUrl' in result) {
        return result.dataUrl;
      }
      return String(result);
    } catch (err) {
      throw this.wrapError('screenshot', filenameHint ? `"${filenameHint}"` : '', err);
    }
  }
}
