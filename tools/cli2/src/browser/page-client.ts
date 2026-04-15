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

  /**
   * Scroll the page in a direction.
   *
   * TODO(task-6-or-8): scroll is not yet in the extension protocol. Wire up a
   * ScrollCommand when the extension side adds it. Until then this method
   * throws NotYetImplemented so the step executor surfaces a clear error
   * rather than a silent no-op.
   */
  async scroll(
    direction: 'up' | 'down' | 'top' | 'bottom',
    _amountPx?: number,
  ): Promise<void> {
    throw new Error(
      `scroll("${direction}") is not yet implemented in the extension protocol. ` +
      'It will be wired up in task 6 or 8.',
    );
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
      return await this.host.sendCommand<boolean>(cmd);
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
   * Wait for a download triggered by the given action.
   *
   * TODO(task-7): Full orchestration requires the extension to pre-register a
   * download listener before the trigger fires. This is wired up in task 7.
   * For now we throw so callers get an actionable error rather than a hang.
   */
  async waitForDownload(
    _triggerAction: () => Promise<void>,
    _timeout?: number,
  ): Promise<string> {
    throw new Error(
      'waitForDownload not implemented in task 5 — wired up in task 7',
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
      return await this.host.sendCommand<number>(cmd);
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
      return await this.host.sendCommand<string>(cmd);
    } catch (err) {
      throw this.wrapError('screenshot', filenameHint ? `"${filenameHint}"` : '', err);
    }
  }
}
