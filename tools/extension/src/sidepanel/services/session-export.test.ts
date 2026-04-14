/**
 * @vitest-environment node
 *
 * fflate's internal `instanceof Uint8Array` checks fail across realms
 * when vitest-jsdom injects its own TypedArray globals. We don't need
 * any DOM APIs in this test suite, so override to the node environment.
 */
import { describe, it, expect } from 'vitest';
import type { Automation } from '@portalflow/schema';
import type {
  AutomationVersion,
  ChatMessage,
  HtmlSnapshot,
  RawEvent,
  RecordingSession,
} from '../../shared/types';
import { exportSession } from './session-export';
import { importSession } from './session-import';

function makeAutomation(name: string): Automation {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    name,
    version: '1.0.0',
    description: 'round-trip test',
    goal: 'round-trip test',
    inputs: [],
    steps: [
      {
        id: 'step-1',
        name: 'Navigate',
        type: 'navigate',
        action: { url: 'https://example.com' },
        onFailure: 'abort',
        maxRetries: 3,
        timeout: 30000,
      },
    ],
  };
}

function makeVersion(
  id: string,
  author: AutomationVersion['author'],
  name: string,
): AutomationVersion {
  return {
    id,
    createdAt: 1_700_000_000_000,
    author,
    message: `${author}: ${name}`,
    automation: makeAutomation(name),
  };
}

function makeSnapshot(id: string, content: string): HtmlSnapshot {
  return {
    id,
    url: 'https://example.com/page',
    title: 'example',
    capturedAt: 1_700_000_000_000,
    sizeBytes: content.length,
    content,
  };
}

describe('exportSession / importSession round-trip', () => {
  it('round-trips a synthetic session with versions, snapshots, events, and chat', async () => {
    const current = makeAutomation('current');
    const original = makeAutomation('original');

    const versions = [
      makeVersion('v-1', 'raw-recording', 'original'),
      makeVersion('v-2', 'user-edit', 'edited once'),
      makeVersion('v-3', 'ai-chat', 'current'),
    ];

    const snapshots: Record<string, HtmlSnapshot> = {
      'hash-a': makeSnapshot('hash-a', '<body>a</body>'),
      'hash-b': makeSnapshot('hash-b', '<body>b</body>'),
      'hash-c': makeSnapshot('hash-c', '<body>c</body>'),
      'hash-d': makeSnapshot('hash-d', '<body>d</body>'),
      'hash-e': makeSnapshot('hash-e', '<body>e</body>'),
    };

    const events: RawEvent[] = [
      {
        kind: 'navigate',
        url: 'https://example.com',
        title: 'example',
        ts: 1_700_000_000_000,
        snapshotId: 'hash-a',
      },
      {
        kind: 'click',
        url: 'https://example.com',
        title: 'example',
        ts: 1_700_000_000_100,
        selector: '#btn',
        fallbacks: [],
        elementTag: 'button',
        isSubmitButton: false,
        snapshotId: 'hash-b',
      },
    ];

    const chatHistory: ChatMessage[] = [
      {
        id: 'm-1',
        role: 'user',
        content: 'please improve',
        createdAt: 1_700_000_000_000,
      },
      {
        id: 'm-2',
        role: 'assistant',
        content: 'done',
        createdAt: 1_700_000_000_500,
        proposal: {
          id: 'p-1',
          summary: 'Rename',
          changes: ['Renamed automation'],
          newAutomation: makeAutomation('renamed'),
          baseVersionId: 'v-2',
          status: 'approved',
        },
      },
    ];

    const session: RecordingSession = {
      id: 'session-1',
      status: 'stopped',
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_000_999,
      events,
      metadata: { name: 'test session', goal: 'round-trip', description: 'x' },
      snapshots,
      original,
      versions,
      currentVersionId: 'v-3',
      chatHistory,
    };

    const blob = await exportSession(session, current, 'v-3');
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(0);

    const imported = await importSession(new Uint8Array(await blob.arrayBuffer()));

    expect(imported.manifest.schemaVersion).toBe(1);
    expect(imported.manifest.sessionId).toBe('session-1');
    expect(imported.manifest.currentVersionId).toBe('v-3');
    expect(imported.manifest.counts.versions).toBe(3);
    expect(imported.manifest.counts.snapshots).toBe(5);
    expect(imported.manifest.counts.events).toBe(2);
    expect(imported.manifest.counts.chatMessages).toBe(2);

    expect(imported.currentAutomation.name).toBe('current');
    expect(imported.session.original?.name).toBe('original');

    expect(imported.session.versions).toHaveLength(3);
    expect(imported.session.versions?.[0].author).toBe('raw-recording');
    expect(imported.session.versions?.[2].automation.name).toBe('current');

    const snapIds = Object.keys(imported.session.snapshots ?? {}).sort();
    expect(snapIds).toEqual(['hash-a', 'hash-b', 'hash-c', 'hash-d', 'hash-e']);
    expect(imported.session.snapshots?.['hash-b'].content).toBe('<body>b</body>');

    expect(imported.session.events).toHaveLength(2);
    expect(imported.session.events[0].snapshotId).toBe('hash-a');
    expect(imported.session.chatHistory).toHaveLength(2);
    expect(imported.session.chatHistory?.[1].proposal?.summary).toBe('Rename');
  });

  it('refuses a zip with a bad manifest schemaVersion', async () => {
    // Build a minimal zip manually with an invalid manifest
    const { zip, strToU8 } = await import('fflate');
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify({ schemaVersion: 99 })),
      'automation.json': strToU8(JSON.stringify(makeAutomation('bad'))),
    };
    const bytes = await new Promise<Uint8Array>((resolve, reject) =>
      zip(files, (err, out) => (err ? reject(err) : resolve(out))),
    );
    await expect(importSession(bytes)).rejects.toThrow(/manifest\.json failed validation/i);
  });

  it('refuses a zip missing automation.json', async () => {
    const { zip, strToU8 } = await import('fflate');
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(
        JSON.stringify({
          schemaVersion: 1,
          sessionId: 's',
          exportedAt: 1,
          name: 'x',
          currentVersionId: null,
          counts: { versions: 0, snapshots: 0, events: 0, chatMessages: 0 },
        }),
      ),
    };
    const bytes = await new Promise<Uint8Array>((resolve, reject) =>
      zip(files, (err, out) => (err ? reject(err) : resolve(out))),
    );
    await expect(importSession(bytes)).rejects.toThrow(/Missing automation\.json/i);
  });
});
