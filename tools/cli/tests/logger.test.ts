import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveLoggingConfig } from '../src/runner/logger.js';
import type { LoggingConfig } from '../src/config/config.service.js';

describe('resolveLoggingConfig', () => {
  const originalLogLevel = process.env['LOG_LEVEL'];

  beforeEach(() => {
    delete process.env['LOG_LEVEL'];
  });

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env['LOG_LEVEL'];
    } else {
      process.env['LOG_LEVEL'] = originalLogLevel;
    }
  });

  it('defaults to info when nothing is set', () => {
    const r = resolveLoggingConfig(undefined);
    expect(r.level).toBe('info');
    expect(r.pretty).toBe(true);
    expect(r.redactSecrets).toBe(true);
    expect(r.file).toBeUndefined();
  });

  it('honours stored config when no CLI flag or env var is set', () => {
    const stored: LoggingConfig = {
      level: 'debug',
      file: '/tmp/run.log',
      pretty: false,
      redactSecrets: false,
    };
    const r = resolveLoggingConfig(stored);
    expect(r.level).toBe('debug');
    expect(r.file).toBe('/tmp/run.log');
    expect(r.pretty).toBe(false);
    expect(r.redactSecrets).toBe(false);
  });

  it('LOG_LEVEL env var overrides stored level', () => {
    process.env['LOG_LEVEL'] = 'warn';
    const stored: LoggingConfig = { level: 'info' };
    const r = resolveLoggingConfig(stored);
    expect(r.level).toBe('warn');
  });

  it('CLI flag overrides env var AND stored level', () => {
    process.env['LOG_LEVEL'] = 'warn';
    const stored: LoggingConfig = { level: 'error' };
    const r = resolveLoggingConfig(stored, 'trace');
    expect(r.level).toBe('trace');
  });

  it('invalid CLI flag falls through to env var', () => {
    process.env['LOG_LEVEL'] = 'debug';
    const r = resolveLoggingConfig(undefined, 'nonsense');
    expect(r.level).toBe('debug');
  });

  it('invalid env var falls through to stored config', () => {
    process.env['LOG_LEVEL'] = 'nonsense';
    const stored: LoggingConfig = { level: 'warn' };
    const r = resolveLoggingConfig(stored);
    expect(r.level).toBe('warn');
  });

  it('invalid everything falls back to info', () => {
    process.env['LOG_LEVEL'] = 'nonsense';
    const r = resolveLoggingConfig({ level: 'also-bad' as unknown as 'info' }, 'wrong');
    expect(r.level).toBe('info');
  });

  it('empty string file is treated as undefined (no file output)', () => {
    const r = resolveLoggingConfig({ file: '   ' });
    expect(r.file).toBeUndefined();
  });

  it('pretty defaults to true when not set', () => {
    const r = resolveLoggingConfig({ level: 'debug' });
    expect(r.pretty).toBe(true);
  });

  it('redactSecrets defaults to true when not set', () => {
    const r = resolveLoggingConfig({ level: 'debug' });
    expect(r.redactSecrets).toBe(true);
  });

  it('accepts all valid levels', () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
    for (const level of levels) {
      const r = resolveLoggingConfig(undefined, level);
      expect(r.level).toBe(level);
    }
  });
});
