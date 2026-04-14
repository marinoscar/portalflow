import { describe, it, expect } from 'vitest';
import type { Automation } from '@portalflow/schema';
import type { AutomationVersion } from '../../shared/types';
import {
  automationReducer,
  initialAutomationState,
  VERSION_CAP,
  type AutomationState,
} from './automation-state';

function makeAutomation(name: string): Automation {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    name,
    version: '1.0.0',
    description: 'test',
    goal: 'test',
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

function withAutomation(name: string): AutomationState {
  return automationReducer(initialAutomationState, {
    type: 'SET_AUTOMATION',
    automation: makeAutomation(name),
  });
}

describe('automationReducer — versions', () => {
  it('preserves versions/currentVersionId across SET_AUTOMATION', () => {
    const hydrated = automationReducer(initialAutomationState, {
      type: 'HYDRATE_VERSIONS',
      versions: [],
      currentVersionId: null,
    });
    const next = automationReducer(hydrated, {
      type: 'SET_AUTOMATION',
      automation: makeAutomation('a'),
    });
    expect(next.versions).toEqual([]);
    expect(next.currentVersionId).toBeNull();
  });

  it('COMMIT_VERSION appends a new version and updates currentVersionId', () => {
    const s1 = withAutomation('a');
    const s2 = automationReducer(s1, {
      type: 'COMMIT_VERSION',
      author: 'raw-recording',
      message: 'initial',
    });
    expect(s2.versions).toHaveLength(1);
    expect(s2.versions[0].author).toBe('raw-recording');
    expect(s2.versions[0].message).toBe('initial');
    expect(s2.currentVersionId).toBe(s2.versions[0].id);
  });

  it('COMMIT_VERSION deep-clones the automation so later edits do not mutate the stored version', () => {
    const s1 = withAutomation('a');
    const s2 = automationReducer(s1, {
      type: 'COMMIT_VERSION',
      author: 'raw-recording',
      message: 'initial',
    });
    const storedBefore = s2.versions[0].automation.name;

    // Mutate the working automation via a reducer action
    const s3 = automationReducer(s2, {
      type: 'UPDATE_METADATA',
      changes: { name: 'renamed' },
    });

    expect(storedBefore).toBe('a');
    expect(s2.versions[0].automation.name).toBe('a');
    expect(s3.versions[0].automation.name).toBe('a');
    expect(s3.automation?.name).toBe('renamed');
  });

  it('CHECKOUT_VERSION restores the stored automation and moves the head pointer', () => {
    let s = withAutomation('a');
    s = automationReducer(s, {
      type: 'COMMIT_VERSION',
      author: 'raw-recording',
      message: 'v1',
    });
    const v1Id = s.versions[0].id;

    s = automationReducer(s, {
      type: 'UPDATE_METADATA',
      changes: { name: 'edited' },
    });
    s = automationReducer(s, {
      type: 'COMMIT_VERSION',
      author: 'user-edit',
      message: 'v2',
    });
    expect(s.automation?.name).toBe('edited');
    expect(s.versions).toHaveLength(2);

    const out = automationReducer(s, { type: 'CHECKOUT_VERSION', versionId: v1Id });
    expect(out.automation?.name).toBe('a');
    expect(out.currentVersionId).toBe(v1Id);
    // CHECKOUT does not append a new version
    expect(out.versions).toHaveLength(2);
  });

  it('UNDO walks backwards through versions; REDO walks forward', () => {
    let s = withAutomation('a');
    s = automationReducer(s, { type: 'COMMIT_VERSION', author: 'raw-recording', message: 'v1' });
    s = automationReducer(s, { type: 'UPDATE_METADATA', changes: { name: 'b' } });
    s = automationReducer(s, { type: 'COMMIT_VERSION', author: 'user-edit', message: 'v2' });
    s = automationReducer(s, { type: 'UPDATE_METADATA', changes: { name: 'c' } });
    s = automationReducer(s, { type: 'COMMIT_VERSION', author: 'user-edit', message: 'v3' });

    expect(s.automation?.name).toBe('c');

    s = automationReducer(s, { type: 'UNDO' });
    expect(s.automation?.name).toBe('b');

    s = automationReducer(s, { type: 'UNDO' });
    expect(s.automation?.name).toBe('a');

    // Already at oldest — another UNDO is a no-op
    s = automationReducer(s, { type: 'UNDO' });
    expect(s.automation?.name).toBe('a');

    s = automationReducer(s, { type: 'REDO' });
    expect(s.automation?.name).toBe('b');

    s = automationReducer(s, { type: 'REDO' });
    expect(s.automation?.name).toBe('c');

    // Already at head — REDO is a no-op
    s = automationReducer(s, { type: 'REDO' });
    expect(s.automation?.name).toBe('c');
  });

  it('100-version cap prunes oldest non-pinned version and keeps the pinned one', () => {
    let s = withAutomation('raw');
    s = automationReducer(s, {
      type: 'COMMIT_VERSION',
      author: 'raw-recording',
      message: 'pinned',
    });
    const pinnedId = s.versions[0].id;

    // Commit VERSION_CAP + 5 additional versions to overshoot the cap
    for (let i = 0; i < VERSION_CAP + 5; i++) {
      s = automationReducer(s, {
        type: 'UPDATE_METADATA',
        changes: { name: `edit-${i}` },
      });
      s = automationReducer(s, {
        type: 'COMMIT_VERSION',
        author: 'user-edit',
        message: `edit ${i}`,
      });
    }

    expect(s.versions).toHaveLength(VERSION_CAP);
    // Pinned raw-recording is still at index 0
    expect(s.versions[0].id).toBe(pinnedId);
    expect(s.versions[0].author).toBe('raw-recording');
    // Latest user-edit is at the tail
    expect(s.versions[s.versions.length - 1].author).toBe('user-edit');
    expect(s.versions[s.versions.length - 1].message).toBe(`edit ${VERSION_CAP + 4}`);
  });

  it('HYDRATE_VERSIONS loads a versions array and current id', () => {
    const v: AutomationVersion = {
      id: 'x',
      createdAt: 1,
      author: 'raw-recording',
      message: 'm',
      automation: makeAutomation('hydrated'),
    };
    const out = automationReducer(initialAutomationState, {
      type: 'HYDRATE_VERSIONS',
      versions: [v],
      currentVersionId: 'x',
    });
    expect(out.versions).toHaveLength(1);
    expect(out.currentVersionId).toBe('x');
  });
});
