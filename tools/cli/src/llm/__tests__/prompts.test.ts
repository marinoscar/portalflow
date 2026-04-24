import { describe, it, expect } from 'vitest';
import { buildToolsInventoryBlock } from '../prompts.js';
import type { ToolDescription } from '../../tools/tool.interface.js';

// ---------------------------------------------------------------------------
// Fixture: smscli describe() output (mirrors the adapter's actual output)
// ---------------------------------------------------------------------------
const smscliDesc: ToolDescription = {
  tool: 'smscli',
  description: 'Retrieves SMS OTP codes from a connected phone.',
  commands: [
    {
      command: 'otp-wait',
      description:
        'Waits for a NEW SMS OTP to arrive after this moment. Use when the site just triggered an OTP send.',
      args: [
        {
          name: 'timeout',
          required: false,
          description: 'Seconds to wait before giving up (default 60).',
        },
      ],
      resultDescription:
        'The OTP code extracted from the SMS body. Stored as smscli_otp_wait_result.',
    },
    {
      command: 'otp-latest',
      description:
        'Returns the most recent OTP already received. Use when the OTP may have arrived before you checked.',
      args: [],
      resultDescription: 'The most recent OTP code. Stored as smscli_otp_latest_result.',
    },
    {
      command: 'otp-extract',
      description: 'Parses an OTP out of a literal SMS body text. Rarely needed from aiscope.',
      args: [
        {
          name: 'message',
          required: true,
          description: 'The raw SMS text to parse.',
        },
      ],
      resultDescription:
        'The OTP code extracted from the given message. Stored as smscli_otp_extract_result.',
    },
  ],
};

const vaultcliDesc: ToolDescription = {
  tool: 'vaultcli',
  description: 'Retrieves secrets from the local vault.',
  commands: [
    {
      command: 'secrets-get',
      description: 'Fetches a secret by name. Returns all fields or a single field.',
      args: [
        { name: 'name', required: true, description: 'The name of the secret to retrieve.' },
        {
          name: 'field',
          required: false,
          description: 'If provided, returns only this field from the secret.',
        },
      ],
      resultDescription: 'The secret value(s). Stored as vaultcli_secrets_get_result.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildToolsInventoryBlock()', () => {
  it('returns empty string for empty tool list', () => {
    expect(buildToolsInventoryBlock([])).toBe('');
  });

  describe('with smscli only', () => {
    const block = buildToolsInventoryBlock([smscliDesc]);

    it('contains the section heading', () => {
      expect(block).toContain('## Tools available in this run');
    });

    it('contains smscli:otp-wait', () => {
      expect(block).toContain('smscli:otp-wait');
    });

    it('contains smscli:otp-latest', () => {
      expect(block).toContain('smscli:otp-latest');
    });

    it('contains smscli:otp-extract', () => {
      expect(block).toContain('smscli:otp-extract');
    });

    it('contains the smscli_otp_wait_result variable name', () => {
      expect(block).toContain('smscli_otp_wait_result');
    });

    it('contains the smscli_otp_latest_result variable name', () => {
      expect(block).toContain('smscli_otp_latest_result');
    });

    it('contains the smscli_otp_extract_result variable name', () => {
      expect(block).toContain('smscli_otp_extract_result');
    });

    // Regression guard: the old broken example must never reappear
    it('does NOT contain smscli:get-otp (old broken example)', () => {
      expect(block).not.toContain('smscli:get-otp');
    });

    it('does NOT contain smscli_get_otp_result (old broken variable)', () => {
      expect(block).not.toContain('smscli_get_otp_result');
    });

    it('shows timeout as optional for otp-wait', () => {
      expect(block).toMatch(/timeout \(optional\)/);
    });

    it('shows message as required for otp-extract', () => {
      expect(block).toMatch(/message \(required\)/);
    });
  });

  describe('with multiple tools', () => {
    const block = buildToolsInventoryBlock([smscliDesc, vaultcliDesc]);

    it('contains both tool names', () => {
      expect(block).toContain('smscli');
      expect(block).toContain('vaultcli');
    });

    it('contains vaultcli:secrets-get', () => {
      expect(block).toContain('vaultcli:secrets-get');
    });

    it('contains vaultcli_secrets_get_result', () => {
      expect(block).toContain('vaultcli_secrets_get_result');
    });

    it('shows name as required and field as optional for secrets-get', () => {
      expect(block).toMatch(/name \(required\)/);
      expect(block).toMatch(/field \(optional\)/);
    });
  });

  describe('with a tool that has no-arg commands', () => {
    const block = buildToolsInventoryBlock([smscliDesc]);

    it('shows "Args: none" for otp-latest', () => {
      expect(block).toContain('Args: none');
    });
  });
});
