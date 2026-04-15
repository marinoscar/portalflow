import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import { PageClient } from '../page-client.js';
import { ExtensionCommandError } from '../extension-host.js';
import type { ExtensionHost } from '../extension-host.js';
import type { RunnerCommand } from '../protocol.js';

const logger = pino({ level: 'silent' });

/** Build a mock ExtensionHost with a spy on sendCommand. */
function makeFakeHost(returnValue: unknown = undefined): {
  host: ExtensionHost;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn().mockResolvedValue(returnValue);
  const host = { sendCommand: spy, isConnected: () => true } as unknown as ExtensionHost;
  return { host, spy };
}

/** Extract the single call argument (the command) from the spy. */
function capturedCommand(spy: ReturnType<typeof vi.fn>): RunnerCommand {
  expect(spy).toHaveBeenCalledOnce();
  return spy.mock.calls[0][0] as RunnerCommand;
}

describe('PageClient', () => {
  let host: ExtensionHost;
  let spy: ReturnType<typeof vi.fn>;
  let client: PageClient;

  beforeEach(() => {
    ({ host, spy } = makeFakeHost());
    client = new PageClient({ host, logger, defaultTimeoutMs: 30_000 });
  });

  // ---------------------------------------------------------------------------
  // navigate
  // ---------------------------------------------------------------------------

  it('navigate → NavigateCommand with correct shape', async () => {
    await client.navigate('https://example.com');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('navigate');
    expect((cmd as any).url).toBe('https://example.com');
    expect((cmd as any).tab).toEqual({ kind: 'active' });
    expect((cmd as any).timeoutMs).toBe(30_000);
    expect(typeof cmd.commandId).toBe('string');
  });

  it('navigate wraps errors with method name prefix', async () => {
    spy.mockRejectedValue(new Error('network error'));
    await expect(client.navigate('https://example.com')).rejects.toThrow(
      'navigate("https://example.com") failed:',
    );
  });

  // ---------------------------------------------------------------------------
  // click
  // ---------------------------------------------------------------------------

  it('click → InteractCommand with action=click', async () => {
    await client.click('#btn');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('interact');
    expect((cmd as any).action).toBe('click');
    expect((cmd as any).selectors).toEqual({ primary: '#btn' });
    expect((cmd as any).tab).toEqual({ kind: 'active' });
  });

  it('click wraps ExtensionCommandError with prefix', async () => {
    spy.mockRejectedValue(
      new ExtensionCommandError('element not found', 'selector_not_found', false, 'cmd-1'),
    );
    await expect(client.click('#btn')).rejects.toThrow('click("#btn") failed:');
  });

  // ---------------------------------------------------------------------------
  // type
  // ---------------------------------------------------------------------------

  it('type → InteractCommand with action=type and value', async () => {
    await client.type('#input', 'hello');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('interact');
    expect((cmd as any).action).toBe('type');
    expect((cmd as any).selectors).toEqual({ primary: '#input' });
    expect((cmd as any).value).toBe('hello');
  });

  // ---------------------------------------------------------------------------
  // selectOption
  // ---------------------------------------------------------------------------

  it('selectOption → InteractCommand with action=select and value', async () => {
    await client.selectOption('select#country', 'US');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('interact');
    expect((cmd as any).action).toBe('select');
    expect((cmd as any).selectors).toEqual({ primary: 'select#country' });
    expect((cmd as any).value).toBe('US');
  });

  // ---------------------------------------------------------------------------
  // check / uncheck / hover / focus
  // ---------------------------------------------------------------------------

  it('check → InteractCommand with action=check', async () => {
    await client.check('#agree');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('interact');
    expect((cmd as any).action).toBe('check');
  });

  it('uncheck → InteractCommand with action=uncheck', async () => {
    await client.uncheck('#agree');
    const cmd = capturedCommand(spy);
    expect((cmd as any).action).toBe('uncheck');
  });

  it('hover → InteractCommand with action=hover', async () => {
    await client.hover('.menu');
    const cmd = capturedCommand(spy);
    expect((cmd as any).action).toBe('hover');
  });

  it('focus → InteractCommand with action=focus', async () => {
    await client.focus('[name=email]');
    const cmd = capturedCommand(spy);
    expect((cmd as any).action).toBe('focus');
  });

  // ---------------------------------------------------------------------------
  // waitForSelector
  // ---------------------------------------------------------------------------

  it('waitForSelector → WaitCommand with condition=selector', async () => {
    await client.waitForSelector('.loaded');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('wait');
    expect((cmd as any).condition).toBe('selector');
    expect((cmd as any).selectors).toEqual({ primary: '.loaded' });
    expect((cmd as any).timeoutMs).toBe(30_000);
  });

  it('waitForSelector respects explicit timeout', async () => {
    await client.waitForSelector('.loaded', 5000);
    const cmd = capturedCommand(spy);
    expect((cmd as any).timeoutMs).toBe(5000);
  });

  // ---------------------------------------------------------------------------
  // waitForNavigation
  // ---------------------------------------------------------------------------

  it('waitForNavigation → WaitCommand with condition=navigation', async () => {
    await client.waitForNavigation('**/dashboard');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('wait');
    expect((cmd as any).condition).toBe('navigation');
    expect((cmd as any).urlPattern).toBe('**/dashboard');
  });

  it('waitForNavigation without pattern omits urlPattern', async () => {
    await client.waitForNavigation();
    const cmd = capturedCommand(spy);
    expect((cmd as any).urlPattern).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // waitForNetworkIdle
  // ---------------------------------------------------------------------------

  it('waitForNetworkIdle → WaitCommand with condition=network_idle', async () => {
    await client.waitForNetworkIdle();
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('wait');
    expect((cmd as any).condition).toBe('network_idle');
  });

  // ---------------------------------------------------------------------------
  // delay
  // ---------------------------------------------------------------------------

  it('delay → WaitCommand with condition=delay, durationMs, and buffered timeout', async () => {
    await client.delay(2000);
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('wait');
    expect((cmd as any).condition).toBe('delay');
    expect((cmd as any).durationMs).toBe(2000);
    // timeoutMs should be durationMs + 1000
    expect((cmd as any).timeoutMs).toBe(3000);
  });

  // ---------------------------------------------------------------------------
  // scroll
  // ---------------------------------------------------------------------------

  it('scroll throws NotYetImplemented error', async () => {
    await expect(client.scroll('down')).rejects.toThrow('not yet implemented');
  });

  // ---------------------------------------------------------------------------
  // getText
  // ---------------------------------------------------------------------------

  it('getText → ExtractCommand with target=text, resolves with string value', async () => {
    spy.mockResolvedValue('Hello World');
    const result = await client.getText('h1');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('extract');
    expect((cmd as any).target).toBe('text');
    expect((cmd as any).selectors).toEqual({ primary: 'h1' });
    expect(result).toBe('Hello World');
  });

  // ---------------------------------------------------------------------------
  // getAttribute
  // ---------------------------------------------------------------------------

  it('getAttribute → ExtractCommand with target=attribute and attribute field', async () => {
    spy.mockResolvedValue('https://link.example.com');
    const result = await client.getAttribute('a#link', 'href');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('extract');
    expect((cmd as any).target).toBe('attribute');
    expect((cmd as any).attribute).toBe('href');
    expect(result).toBe('https://link.example.com');
  });

  // ---------------------------------------------------------------------------
  // getHtml
  // ---------------------------------------------------------------------------

  it('getHtml with selector → ExtractCommand with selectors', async () => {
    spy.mockResolvedValue('<p>test</p>');
    await client.getHtml('#main');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('extract');
    expect((cmd as any).target).toBe('html');
    expect((cmd as any).selectors).toEqual({ primary: '#main' });
  });

  it('getHtml without selector → ExtractCommand with no selectors', async () => {
    spy.mockResolvedValue('<html></html>');
    await client.getHtml();
    const cmd = capturedCommand(spy);
    expect((cmd as any).selectors).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // getUrl
  // ---------------------------------------------------------------------------

  it('getUrl → ExtractCommand with target=url', async () => {
    spy.mockResolvedValue('https://example.com/page');
    const url = await client.getUrl();
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('extract');
    expect((cmd as any).target).toBe('url');
    expect(url).toBe('https://example.com/page');
  });

  // ---------------------------------------------------------------------------
  // getTitle
  // ---------------------------------------------------------------------------

  it('getTitle → ExtractCommand with target=title', async () => {
    spy.mockResolvedValue('Page Title');
    const title = await client.getTitle();
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('extract');
    expect((cmd as any).target).toBe('title');
    expect(title).toBe('Page Title');
  });

  // ---------------------------------------------------------------------------
  // elementExists
  // ---------------------------------------------------------------------------

  it('elementExists with ok result → resolves to true', async () => {
    spy.mockResolvedValue(true);
    const exists = await client.elementExists('#el');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('anyMatch');
    expect((cmd as any).selectors).toEqual({ primary: '#el' });
    expect(exists).toBe(true);
  });

  it('elementExists on ExtensionCommandError → returns false (mirrors PageService semantics)', async () => {
    spy.mockRejectedValue(
      new ExtensionCommandError('not found', 'selector_not_found', false, 'cmd-2'),
    );
    const exists = await client.elementExists('#missing');
    expect(exists).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // waitForDownload
  // ---------------------------------------------------------------------------

  it('waitForDownload throws not-implemented error', async () => {
    await expect(client.waitForDownload(async () => {})).rejects.toThrow(
      'waitForDownload not implemented in task 5',
    );
  });

  // ---------------------------------------------------------------------------
  // countMatching
  // ---------------------------------------------------------------------------

  it('countMatching → CountMatchingCommand with selectors', async () => {
    spy.mockResolvedValue(3);
    const count = await client.countMatching('li.item');
    const cmd = capturedCommand(spy);
    expect(cmd.type).toBe('countMatching');
    expect((cmd as any).selectors).toEqual({ primary: 'li.item' });
    expect(count).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // screenshot
  // ---------------------------------------------------------------------------

  it('screenshot → ScreenshotCommand with saveDir from getScreenshotDir', async () => {
    spy.mockResolvedValue('/tmp/screenshots/shot.png');
    const screenshotClient = new PageClient({
      host,
      logger,
      getScreenshotDir: () => '/tmp/screenshots',
      defaultTimeoutMs: 30_000,
    });
    const path = await screenshotClient.screenshot('login-page');
    const cmd = spy.mock.calls[0][0] as RunnerCommand;
    expect(cmd.type).toBe('screenshot');
    expect((cmd as any).saveDir).toBe('/tmp/screenshots');
    expect((cmd as any).filenameHint).toBe('login-page');
    expect(path).toBe('/tmp/screenshots/shot.png');
  });

  it('screenshot without getScreenshotDir falls back to "."', async () => {
    spy.mockResolvedValue('./shot.png');
    await client.screenshot();
    const cmd = spy.mock.calls[0][0] as RunnerCommand;
    expect((cmd as any).saveDir).toBe('.');
  });
});
