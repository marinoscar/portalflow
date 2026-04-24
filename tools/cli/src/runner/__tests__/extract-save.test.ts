/**
 * Integration tests for the `extract` step with `target: 'html'` and the
 * `saveToFile` flag.  These tests verify that:
 *
 *  - The transformed file is written to disk with the correct extension.
 *  - The file path is registered as a run artifact.
 *  - The outputs map receives the transformed string under `outputName`.
 *  - When `saveToFile` is absent (or false) no file is created.
 *  - The correct extension is used for each format (yaml / md / html).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pino from 'pino';
import { StepExecutor } from '../step-executor.js';
import { RunContext } from '../run-context.js';
import { RunPresenter } from '../run-presenter.js';
import type { PageClient } from '../../browser/page-client.js';
import type { ElementResolver } from '../../browser/element-resolver.js';
import type { PageContextCapture } from '../../browser/context.js';
import type { LlmService } from '../../llm/llm.service.js';
import type { Step } from '@portalflow/schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const logger = pino({ level: 'silent' });

/** Small but structurally meaningful HTML fixture used across tests. */
const FIXTURE_HTML = `
<html>
  <head>
    <style>body { margin: 0; }</style>
    <script>console.log("drop me")</script>
  </head>
  <body>
    <h1 id="main-heading">Hello World</h1>
    <a href="/about">About</a>
  </body>
</html>
`;

function makePageClient(html: string = FIXTURE_HTML): PageClient {
  return {
    navigate: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue(undefined),
    uncheck: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    getText: vi.fn().mockResolvedValue('text'),
    getAttribute: vi.fn().mockResolvedValue('attr'),
    getHtml: vi.fn().mockResolvedValue(html),
    getUrl: vi.fn().mockResolvedValue('https://example.com'),
    getTitle: vi.fn().mockResolvedValue('Example'),
    elementExists: vi.fn().mockResolvedValue(true),
    countMatching: vi.fn().mockResolvedValue(0),
    waitForDownload: vi.fn().mockResolvedValue('/downloads/file.pdf'),
    screenshot: vi.fn().mockResolvedValue('/screenshots/test.png'),
  } as unknown as PageClient;
}

function makeElementResolver(): ElementResolver {
  return {
    resolve: vi.fn().mockImplementation(async (primary: string) => ({
      selector: primary ?? 'div',
      source: 'primary',
    })),
  } as unknown as ElementResolver;
}

function makeContextCapture(): PageContextCapture {
  return {
    capture: vi.fn().mockResolvedValue({
      url: 'https://example.com',
      title: 'Example',
      html: FIXTURE_HTML,
    }),
  } as unknown as PageContextCapture;
}

function makeLlmService(): LlmService {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    findElement: vi.fn().mockResolvedValue({ selector: 'div', confidence: 0.9 }),
    decideNextAction: vi.fn().mockResolvedValue({ action: 'done', reasoning: '' }),
    decidePlan: vi.fn().mockResolvedValue({
      summary: 'plan',
      milestones: [{ id: 'm1', description: 'done' }],
      reasoning: '',
    }),
    evaluateCondition: vi.fn().mockResolvedValue({ result: true, confidence: 0.9 }),
    findItems: vi.fn().mockResolvedValue({ items: [], explanation: '' }),
  } as unknown as LlmService;
}

/**
 * Build a StepExecutor wired to a fake PageClient that returns `html` from
 * `getHtml`, with all output written to `htmlDir`.
 */
function makeExecutor(htmlDir: string, html: string = FIXTURE_HTML) {
  const context = new RunContext('test-extract', logger);
  const pageClient = makePageClient(html);
  const elementResolver = makeElementResolver();
  const contextCapture = makeContextCapture();
  const llmService = makeLlmService();
  const presenter = new RunPresenter(false, '');

  const executor = new StepExecutor(
    pageClient,
    elementResolver,
    new Map(),
    context,
    false,
    contextCapture,
    llmService,
    new Map(),
    presenter,
    [],      // automationInputs
    htmlDir, // htmlDir — the new trailing parameter
  );

  return { executor, context, pageClient };
}

function makeExtractStep(overrides: {
  outputName?: string;
  format?: 'raw' | 'simplified' | 'markdown';
  saveToFile?: boolean;
}): Step {
  return {
    id: 'extract-step',
    name: 'Extract HTML',
    type: 'extract',
    action: {
      target: 'html',
      outputName: overrides.outputName ?? 'page_dump',
      format: overrides.format,
      saveToFile: overrides.saveToFile,
    },
    onFailure: 'abort',
    maxRetries: 0,
    timeout: 30000,
  } as Step;
}

/** Returns true if the file at `path` exists, false otherwise. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tests: saveToFile: true, format: 'simplified'
// ---------------------------------------------------------------------------

describe('extract html — saveToFile: true, format: simplified', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'portalflow-test-'));
  });

  it('writes page_dump.yaml to the html dir', async () => {
    const { executor } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_dump', format: 'simplified', saveToFile: true });

    await executor.executeWithPolicy(step);

    const expectedPath = join(tmpDir, 'page_dump.yaml');
    expect(await fileExists(expectedPath)).toBe(true);
  });

  it('written YAML file contains simplified content (tag: a, tag: html)', async () => {
    const { executor } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_dump', format: 'simplified', saveToFile: true });

    await executor.executeWithPolicy(step);

    const content = await readFile(join(tmpDir, 'page_dump.yaml'), 'utf8');
    expect(content).toContain('tag: a');
    expect(content).toContain('tag: html');
  });

  it('written YAML drops script and style content', async () => {
    const { executor } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_dump', format: 'simplified', saveToFile: true });

    await executor.executeWithPolicy(step);

    const content = await readFile(join(tmpDir, 'page_dump.yaml'), 'utf8');
    expect(content).not.toContain('console.log');
    expect(content).not.toContain('margin: 0');
  });

  it('registers the artifact path in runContext', async () => {
    const { executor, context } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_dump', format: 'simplified', saveToFile: true });

    await executor.executeWithPolicy(step);

    const expectedPath = join(tmpDir, 'page_dump.yaml');
    expect(context.artifacts).toContain(expectedPath);
  });

  it('stores the transformed string in the outputs map', async () => {
    const { executor, context } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_dump', format: 'simplified', saveToFile: true });

    await executor.executeWithPolicy(step);

    const output = context.outputs['page_dump'];
    expect(typeof output).toBe('string');
    expect(output as string).toContain('tag: html');
  });
});

// ---------------------------------------------------------------------------
// Tests: saveToFile absent / false — no file created
// ---------------------------------------------------------------------------

describe('extract html — saveToFile omitted', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'portalflow-test-'));
  });

  it('does not create a file when saveToFile is omitted', async () => {
    const { executor } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_dump', format: 'simplified' });

    await executor.executeWithPolicy(step);

    expect(await fileExists(join(tmpDir, 'page_dump.yaml'))).toBe(false);
  });

  it('does not register an artifact when saveToFile is omitted', async () => {
    const { executor, context } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_dump', format: 'simplified' });

    await executor.executeWithPolicy(step);

    expect(context.artifacts).toHaveLength(0);
  });

  it('still stores transformed output in the outputs map', async () => {
    const { executor, context } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_dump', format: 'simplified' });

    await executor.executeWithPolicy(step);

    expect(typeof context.outputs['page_dump']).toBe('string');
  });

  it('does not create a file when saveToFile is explicitly false', async () => {
    const { executor } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_dump', format: 'simplified', saveToFile: false });

    await executor.executeWithPolicy(step);

    expect(await fileExists(join(tmpDir, 'page_dump.yaml'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: format determines file extension
// ---------------------------------------------------------------------------

describe('extract html — format drives file extension', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'portalflow-test-'));
  });

  it('format: raw writes .html', async () => {
    const { executor } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_raw', format: 'raw', saveToFile: true });

    await executor.executeWithPolicy(step);

    expect(await fileExists(join(tmpDir, 'page_raw.html'))).toBe(true);
  });

  it('format: raw file content equals the original HTML', async () => {
    const { executor } = makeExecutor(tmpDir, FIXTURE_HTML);
    const step = makeExtractStep({ outputName: 'page_raw', format: 'raw', saveToFile: true });

    await executor.executeWithPolicy(step);

    const content = await readFile(join(tmpDir, 'page_raw.html'), 'utf8');
    expect(content).toBe(FIXTURE_HTML);
  });

  it('format: markdown writes .md', async () => {
    const { executor } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_md', format: 'markdown', saveToFile: true });

    await executor.executeWithPolicy(step);

    expect(await fileExists(join(tmpDir, 'page_md.md'))).toBe(true);
  });

  it('format: markdown file contains expected heading', async () => {
    const { executor } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_md', format: 'markdown', saveToFile: true });

    await executor.executeWithPolicy(step);

    const content = await readFile(join(tmpDir, 'page_md.md'), 'utf8');
    expect(content).toContain('# Hello World');
  });

  it('format: simplified writes .yaml', async () => {
    const { executor } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'page_simplified', format: 'simplified', saveToFile: true });

    await executor.executeWithPolicy(step);

    expect(await fileExists(join(tmpDir, 'page_simplified.yaml'))).toBe(true);
  });

  it('no extra files appear in the directory for a single extract', async () => {
    const { executor } = makeExecutor(tmpDir);
    const step = makeExtractStep({ outputName: 'only_one', format: 'simplified', saveToFile: true });

    await executor.executeWithPolicy(step);

    const { readdir } = await import('node:fs/promises');
    const files = await readdir(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('only_one.yaml');
  });
});
