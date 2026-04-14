import { describe, it, expect } from 'vitest';
import { parseChatEditResponse } from './chat-edit';

const VALID_AUTOMATION = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Demo',
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

describe('parseChatEditResponse', () => {
  it('parses a clarification reply with no proposal', () => {
    const raw = JSON.stringify({ reply: 'Step 2 clicks the login button.' });
    const out = parseChatEditResponse(raw);
    expect(out.reply).toBe('Step 2 clicks the login button.');
    expect(out.proposal).toBeNull();
  });

  it('parses a proposal with a valid newAutomation', () => {
    const raw = JSON.stringify({
      reply: 'I renamed the automation.',
      proposal: {
        summary: 'Rename automation',
        changes: ['Renamed from Demo to Renamed'],
        newAutomation: { ...VALID_AUTOMATION, name: 'Renamed' },
      },
    });
    const out = parseChatEditResponse(raw);
    expect(out.reply).toBe('I renamed the automation.');
    expect(out.proposal).not.toBeNull();
    expect(out.proposal?.summary).toBe('Rename automation');
    expect(out.proposal?.changes).toEqual(['Renamed from Demo to Renamed']);
    expect(out.proposal?.newAutomation.name).toBe('Renamed');
  });

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n' + JSON.stringify({ reply: 'ok' }) + '\n```';
    const out = parseChatEditResponse(raw);
    expect(out.reply).toBe('ok');
  });

  it('extracts the first JSON object when the model wraps it in prose', () => {
    const raw =
      'Here is my answer: ' +
      JSON.stringify({ reply: 'Extracted from prose' }) +
      ' Thanks!';
    const out = parseChatEditResponse(raw);
    expect(out.reply).toBe('Extracted from prose');
  });

  it('throws on unparseable JSON', () => {
    expect(() => parseChatEditResponse('not json at all')).toThrow(
      /not valid JSON/i,
    );
  });

  it('throws when reply is missing or empty', () => {
    expect(() => parseChatEditResponse(JSON.stringify({ reply: '' }))).toThrow(
      /missing a non-empty "reply"/i,
    );
    expect(() => parseChatEditResponse(JSON.stringify({}))).toThrow(
      /missing a non-empty "reply"/i,
    );
  });

  it('throws when proposal is present but malformed', () => {
    const raw = JSON.stringify({
      reply: 'ok',
      proposal: {
        summary: 'x',
        // missing `changes` and newAutomation
      },
    });
    expect(() => parseChatEditResponse(raw)).toThrow(/changes/);
  });

  it('throws when proposal newAutomation fails schema validation', () => {
    const raw = JSON.stringify({
      reply: 'ok',
      proposal: {
        summary: 'Bad',
        changes: ['x'],
        newAutomation: {
          // missing required `id`, `name`, etc.
          steps: [],
        },
      },
    });
    expect(() => parseChatEditResponse(raw)).toThrow(/schema validation/i);
  });

  it('throws when proposal changes is empty', () => {
    const raw = JSON.stringify({
      reply: 'ok',
      proposal: {
        summary: 'x',
        changes: [],
        newAutomation: VALID_AUTOMATION,
      },
    });
    expect(() => parseChatEditResponse(raw)).toThrow(/non-empty array/i);
  });

  it('treats null proposal as clarification', () => {
    const raw = JSON.stringify({ reply: 'hi', proposal: null });
    const out = parseChatEditResponse(raw);
    expect(out.proposal).toBeNull();
  });
});
